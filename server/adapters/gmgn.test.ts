import { afterEach, describe, expect, it, vi } from "vitest";
import { describeGmgnBundle, describeGmgnHolders, fetchGmgnBundleReading, fetchGmgnTokenIntel } from "./gmgn";

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

  it("sends the key as a header and never in the url, with the auth nonces they require", async () => {
    vi.stubEnv("GMGN_API_KEY", "secret-key-value");
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      expect(String(url)).not.toContain("secret-key-value");
      expect((init as RequestInit).headers).toMatchObject({ "X-APIKEY": "secret-key-value" });
      // Read routes answer 401 without these, which their public demo key hid.
      expect(String(url)).toMatch(/[?&]timestamp=\d{9,13}/);
      expect(String(url)).toMatch(/[?&]client_id=[0-9a-f-]{8,}/i);
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

  it("shaped like the live /v1/token/info payload, reads the launch-pattern fields", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    // Trimmed from the live BONK response of 2026-08-05.
    const intel = await fetchGmgnBundleReading("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: {
          holder_count: 992549,
          image_dup_count: 46,
          stat: {
            top_rat_trader_percentage: 0.0006,
            top_bundler_trader_percentage: 0.1234,
            top_entrapment_trader_percentage: 0.7185,
            top_bot_degen_percentage: 0,
            bot_degen_count: 130,
            fresh_wallet_rate: 0.0465,
            top_10_holder_rate: 0.3117,
            dev_team_hold_rate: 0.0096,
            creator_hold_rate: 0.0096,
            top70_sniper_hold_rate: 0.0095,
            creator_created_count: 4,
          },
          dev: {
            creator_address: "BpH4h6pdBLBnpwiZAhmGqhvkhFXknWU7QSBLQRHGi1Gt",
            creator_token_status: "creator_close",
            twitter_name_change_history: [{ twitter_username: "old_handle", rename_timestamp: 1700000000 }],
            cto_flag: 1,
            dexscr_boost_fee: 99,
          },
          wallet_tags_stat: { sniper_wallets: 34, bundler_wallets: 249, rat_trader_wallets: 12, fresh_wallets: 802 },
        },
      }),
    });

    expect(intel.available).toBe(true);
    expect(intel.bundlerVolumePct).toBeCloseTo(12.34);
    expect(intel.entrapmentVolumePct).toBeCloseTo(71.85);
    expect(intel.insiderVolumePct).toBeCloseTo(0.06);
    expect(intel.top10HolderPct).toBeCloseTo(31.17);
    expect(intel.imageDupCount).toBe(46);
    expect(intel.creatorCreatedCount).toBe(4);
    expect(intel.tagged.sniper).toEqual({ count: 34, atCap: false });
    expect(intel.tagged.bundler).toEqual({ count: 249, atCap: false });
    expect(intel.creatorAddress).toBe("BpH4h6pdBLBnpwiZAhmGqhvkhFXknWU7QSBLQRHGi1Gt");
    expect(intel.creatorStillHolds).toBe(false);
    expect(intel.twitterRenames).toBe(1);
    expect(intel.communityTakeover).toBe(true);
    expect(intel.dexscreenerBoost).toBe(99);
  });

  it("treats a wallet-tag count at 1,000 as a floor, never a total", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    // BONK live: sniper, bundler, rat, whale and fresh all report exactly 1000.
    // Five identical populations is the counter cap showing, not a coincidence.
    const intel = await fetchGmgnBundleReading("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: { wallet_tags_stat: { sniper_wallets: 1000, bundler_wallets: 1000, fresh_wallets: 1000 } },
      }),
    });

    expect(intel.tagged.sniper).toEqual({ count: 1000, atCap: true });
    expect(intel.tagged.bundler).toEqual({ count: 1000, atCap: true });

    const claims = describeGmgnBundle(intel);
    const tagClaim = claims.find((claim) => claim.includes("at least 1,000"));
    expect(tagClaim).toBeDefined();
    expect(tagClaim).toContain("floor, never a total");
  });

  it("discards an impossible ratio instead of publishing it", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnBundleReading("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: { stat: { top_bundler_trader_percentage: 42, fresh_wallet_rate: -0.2, top_10_holder_rate: 0.31 } },
      }),
    });

    // 42 and -0.2 cannot be 0-1 ratios. Unmeasured beats a fabricated number.
    expect(intel.bundlerVolumePct).toBeNull();
    expect(intel.freshWalletHolderPct).toBeNull();
    expect(intel.top10HolderPct).toBeCloseTo(31);
  });

  it("keeps a refusal and an unsupported chain from posing as a clean launch shape", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const refused = await fetchGmgnBundleReading("solana", BONK, { fetchImpl: stub({ code: 40001 }) });
    expect(refused.available).toBe(false);
    expect(refused.note).toContain("declined");
    expect(describeGmgnBundle(refused)).toEqual([]);

    const uncovered = await fetchGmgnBundleReading("avalanche", "0xabc", { fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(uncovered.available).toBe(false);
    expect(uncovered.note).toContain("does not cover avalanche");
  });

  it("attributes every bundle sentence to GMGN and reports shape, not a verdict", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const intel = await fetchGmgnBundleReading("solana", BONK, {
      fetchImpl: stub({
        code: 0,
        data: {
          image_dup_count: 3,
          stat: { top_bundler_trader_percentage: 0.249, top_rat_trader_percentage: 0.02, creator_created_count: 7 },
          dev: { dexscr_boost_fee: 99, twitter_name_change_history: ["a", "b"] },
          wallet_tags_stat: { sniper_wallets: 34, bundler_wallets: 249 },
        },
      }),
    });

    const claims = describeGmgnBundle(intel);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim).toContain("GMGN");
    // The report never adopts the conclusion; "bundled" may only appear as
    // GMGN's wallet classification (bundler), not as a verdict on the launch.
    for (const claim of claims) expect(claim).not.toMatch(/was bundled|launch was/i);
    expect(claims[0]).toContain("not findings ARGUS verified independently");
    // The logo-duplicate count must cut both ways explicitly.
    const dupClaim = claims.find((claim) => claim.includes("logo"));
    expect(dupClaim).toContain("does not say which");
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
