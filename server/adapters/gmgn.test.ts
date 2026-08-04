import { afterEach, describe, expect, it, vi } from "vitest";
import { describeGmgnHolders, fetchGmgnTokenIntel } from "./gmgn";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

/** Shaped like the live payload, trimmed to the fields the adapter reads. */
function trader(overrides: Record<string, unknown> = {}) {
  return {
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    amount_percentage: 0.0768,
    usd_value: 19141848.5,
    total_cost: 7660130.38,
    realized_profit: 1000,
    unrealized_profit: 500,
    is_suspicious: false,
    exchange: "",
    ...overrides,
  };
}

function stub(body: unknown, status = 200) {
  return vi.fn(async () => json(body, status)) as unknown as typeof fetch;
}

describe("GMGN is asked only when it can answer", () => {
  it("does not call out without a key, and says so", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const intel = await fetchGmgnTokenIntel("solana", BONK, { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(intel.available).toBe(false);
    expect(intel.note).toContain("no API key");
  });

  it("does not call out on a chain GMGN does not cover", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const intel = await fetchGmgnTokenIntel("avalanche", "0xabc", { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(intel.available).toBe(false);
    // An unsupported chain is a question that cannot be asked, not a clean answer.
    expect(intel.note).toContain("does not cover avalanche");
  });

  it("sends the key as a header and never in the url", async () => {
    vi.stubEnv("GMGN_API_KEY", "secret-key-value");
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      expect(String(url)).not.toContain("secret-key-value");
      expect((init as RequestInit).headers).toMatchObject({ "X-APIKEY": "secret-key-value" });
      return json({ code: 0, data: { list: [trader()] } });
    }) as unknown as typeof fetch;

    const intel = await fetchGmgnTokenIntel("solana", BONK, { fetchImpl });
    expect(intel.available).toBe(true);
  });
});

describe("a GMGN failure is a gap, never a clean reading", () => {
  it.each([
    [429, "rate limited"],
    [500, "HTTP 500"],
  ])("reports HTTP %s as uncollected", async (status, expected) => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnTokenIntel("solana", BONK, { fetchImpl: stub({}, status) });

    expect(intel.available).toBe(false);
    expect(intel.holders).toEqual([]);
    expect(intel.note).toContain(expected);
  });

  it("treats a non-zero envelope code as a refusal, not an empty holder list", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnTokenIntel("solana", BONK, { fetchImpl: stub({ code: 40001, message: "bad key" }) });

    expect(intel.available).toBe(false);
    expect(intel.note).toContain("declined");
  });

  it("never throws when the provider is unreachable", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;

    const intel = await fetchGmgnTokenIntel("solana", BONK, { fetchImpl });
    expect(intel.available).toBe(false);
    expect(intel.note).toContain("did not respond");
  });

  it("does not call a position label a flag", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    // Live BONK payload shape: every top holder carries these, and none of them
    // is an accusation.
    const intel = await fetchGmgnTokenIntel("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: {
          list: [trader({ tags: ["top_holder", "TOP1", "transfer_in"] }),
                 trader({ address: "B", tags: ["bluechip_owner", "diamond_hands"] })],
        },
      }),
    });

    expect(intel.available).toBe(true);
    const claims = describeGmgnHolders(intel);
    expect(claims.some((claim) => /flags \d+ of/.test(claim))).toBe(false);
  });

  it("publishes nothing at all from an unavailable reading", () => {
    expect(describeGmgnHolders({ available: false, holders: [], note: "down", capped: false })).toEqual([]);
  });
});

describe("what GMGN reported, read honestly", () => {
  it("carries cost basis, profit, tags and the X attribution", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnTokenIntel("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: {
          list: [trader({
            tags: ["sniper"],
            is_suspicious: true,
            twitter_username: "@somedev",
            exchange: "Binance",
          })],
        },
      }),
    });

    expect(intel.available).toBe(true);
    const [holder] = intel.holders;
    expect(holder.costUsd).toBeCloseTo(7660130.38);
    expect(holder.profitUsd).toBe(1500);
    expect(holder.tags).toContain("sniper");
    expect(holder.suspicious).toBe(true);
    expect(holder.xHandle).toBe("somedev");
    expect(holder.exchange).toBe("Binance");
  });

  it("converts the share ratio and discards an impossible one", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnTokenIntel("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: { list: [trader({ amount_percentage: 0.0768 }), trader({ address: "B", amount_percentage: 4200 })] },
      }),
    });

    expect(intel.holders[0].percent).toBeCloseTo(7.68);
    // 4200 cannot be a share of supply. Unmeasured beats a fabricated number.
    expect(intel.holders[1].percent).toBeNull();
  });

  it("keeps an unreported cost unmeasured rather than zero", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnTokenIntel("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: { list: [{ address: "C", amount_percentage: 0.01 }] },
      }),
    });

    expect(intel.holders[0].costUsd).toBeNull();
    expect(intel.holders[0].profitUsd).toBeNull();
    expect(intel.holders[0].suspicious).toBe(false);
  });

  it("attributes every published sentence to GMGN and calls a capped list a floor", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const list = Array.from({ length: 20 }, (_, i) => trader({
      address: `W${i}`,
      is_suspicious: i < 4,
      tags: i < 4 ? ["bundler"] : [],
    }));
    const intel = await fetchGmgnTokenIntel("solana", BONK, {
      fetchImpl: stub({ code: 0, data: { list } }),
      limit: 20,
    });

    const claims = describeGmgnHolders(intel);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim).toContain("GMGN");
    expect(claims[0]).toContain("floor");
    // The report states who classified the wallets; it does not adopt the call.
    expect(claims[0]).toContain("not findings ARGUS verified independently");
  });
});
