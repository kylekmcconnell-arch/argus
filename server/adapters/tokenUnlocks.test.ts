import { afterEach, describe, expect, it, vi } from "vitest";
import { getCost, withCostLedger } from "../cost";
import { collectUpcomingUnlocks } from "./tokenUnlocks";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const mapBody = {
  data: [
    { id: 11, slug: "uniswap", symbol: "UNI", name: "Uniswap" },
    { id: 12, slug: "unicorn-chain", symbol: "UNI", name: "Unicorn Chain" },
    { id: 13, slug: "aave", symbol: "AAVE", name: "Aave" },
  ],
};

const CANONICAL_ADDRESS = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
const CANONICAL_TOKEN = { address: CANONICAL_ADDRESS, chain: "ethereum" };

const contractsBody = {
  data: [
    { chain: { slug: "ethereum" }, address: CANONICAL_ADDRESS.toUpperCase().replace(/^0X/, "0x") },
  ],
};

const eventsBody = {
  data: [
    {
      time: Date.UTC(2026, 7, 1),
      allocationName: "Team",
      unlockTokens: "12000000",
      percentOfSupply: 1.2,
      unlockValue: "27000000",
      percentOfMcap: 1.8,
      cumulativeUnlockedPercent: 63,
    },
    {
      time: Date.UTC(2026, 8, 1),
      allocationName: "Investors",
      percentOfSupply: 0.8,
      unlockValue: "18000000",
      percentOfMcap: 1.2,
      cumulativeUnlockedPercent: 64.2,
    },
  ],
};

const completeEventsBody = {
  ...eventsBody,
  meta: { hasNextPage: false, total: 2, offset: 0 },
};

const fixtureResponse = (
  url: string,
  options: { contracts?: unknown; events?: unknown } = {},
): Response => {
  if (url.includes("/currencies/map")) return jsonResponse(mapBody);
  if (url.includes("/contracts")) return jsonResponse(options.contracts ?? contractsBody);
  return jsonResponse(options.events ?? eventsBody);
};

const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("collectUpcomingUnlocks", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  it("stays dormant with zero requests until CRYPTORANK_API_KEY is set", async () => {
    delete process.env.CRYPTORANK_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 6, 23),
    });
    expect(out.available).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves the currency by symbol+name agreement and summarizes the next unlock", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return fixtureResponse(String(url), { events: completeEventsBody });
    }));

    // Pinned clock: both fixture events sit in 2026, so a real-clock run
    // silently changes what "the next 90 days" contains once the first one
    // passes (it did, on 2026-08-01 UTC).
    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, { nowMs: Date.UTC(2026, 6, 15) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.nextUnlockDate).toBe("2026-08-01");
    expect(out.value.allocationName).toBe("Team");
    expect(out.value.percentOfSupply).toBe(1.2);
    expect(out.value.unlockValueUsd).toBe(27_000_000);
    expect(out.value.cumulativeUnlockedPercent).toBe(63);
    // Both events fall inside the 90-day window from the capture time.
    expect(out.value.next90dPercentOfSupply).toBe(2);
    expect(out.value.sourceUrl).toBe("https://cryptorank.io/price/uniswap/vesting");
    expect(out.value.canonicalAddress).toBe(CANONICAL_ADDRESS);
    expect(out.value.chain).toBe("ethereum");
    expect(out.value.currencyId).toBe(11);
    expect(out.value.contractSourceUrl).toBe("https://api.cryptorank.io/v3/currencies/11/contracts");
    expect(out.value.eventsSourceUrl).toContain("/currencies/11/vesting/events?");
    expect(out.value.percentageValidation.invalidFields).toEqual([]);
    expect(Number.isFinite(Date.parse(out.value.capturedAt))).toBe(true);
    // Resolved to id 11 (name agreement), never the same-symbol impostor id 12.
    expect(urls.some((url) => url.includes("/currencies/11/contracts"))).toBe(true);
    expect(urls.some((url) => url.includes("/currencies/11/vesting/events"))).toBe(true);
  });

  it("withholds the 90-day total when the response has no completeness metadata", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => fixtureResponse(String(url))));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 6, 15),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.nextUnlockDate).toBe("2026-08-01");
    expect(out.value.next90dPercentOfSupply).toBeNull();
  });

  it("withholds the 90-day total when pagination says another page exists", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const paginatedEvents = {
      ...eventsBody,
      meta: { hasNextPage: true, total: 2, offset: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      fixtureResponse(String(url), { events: paginatedEvents })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 6, 15),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.next90dPercentOfSupply).toBeNull();
  });

  it("does not count distant events as unlocking within 90 days", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      fixtureResponse(String(url), { events: completeEventsBody })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 0, 1),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.nextUnlockDate).toBe("2026-08-01");
    expect(out.value.next90dPercentOfSupply).toBeNull();
  });

  it("withholds the 90-day total when any in-horizon event omits its supply percentage", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const incompleteMeasurement = {
      data: [eventsBody.data[0], { ...eventsBody.data[1], percentOfSupply: undefined }],
      meta: { hasNextPage: false, total: 2, offset: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      fixtureResponse(String(url), { events: incompleteMeasurement })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 6, 15),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.percentOfSupply).toBe(1.2);
    expect(out.value.next90dPercentOfSupply).toBeNull();
  });

  it("withholds impossible provider percentages while retaining the bound schedule receipt", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const impossiblePercentages = {
      data: [{
        ...eventsBody.data[0],
        percentOfSupply: 120,
        percentOfMcap: -1,
        cumulativeUnlockedPercent: 101,
      }],
      meta: { hasNextPage: false, total: 1, offset: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      fixtureResponse(String(url), { events: impossiblePercentages })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 6, 15),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.nextUnlockDate).toBe("2026-08-01");
    expect(out.value.unlockValueUsd).toBe(27_000_000);
    expect(out.value.percentOfSupply).toBeNull();
    expect(out.value.percentOfMcap).toBeNull();
    expect(out.value.cumulativeUnlockedPercent).toBeNull();
    expect(out.value.next90dPercentOfSupply).toBeNull();
    expect(out.value.percentageValidation.invalidFields).toEqual([
      "cumulativeUnlockedPercent",
      "next90dPercentOfSupply",
      "percentOfMcap",
      "percentOfSupply",
    ]);
    expect(out.value.contractSourceUrl).toContain("/currencies/11/contracts");
    expect(out.value.eventsSourceUrl).toContain("/currencies/11/vesting/events");
  });

  it("rejects a complete 90-day percentage aggregate above one hundred", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const impossibleAggregate = {
      data: [
        { ...eventsBody.data[0], percentOfSupply: 60 },
        { ...eventsBody.data[1], percentOfSupply: 50 },
      ],
      meta: { hasNextPage: false, total: 2, offset: 0 },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      fixtureResponse(String(url), { events: impossibleAggregate })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN, {
      nowMs: Date.UTC(2026, 6, 15),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.percentOfSupply).toBe(60);
    expect(out.value.next90dPercentOfSupply).toBeNull();
    expect(out.value.percentageValidation.invalidFields).toEqual(["next90dPercentOfSupply"]);
  });

  it("fails closed on a symbol collision without name agreement", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/currencies/map")
        ? jsonResponse({ data: [
          { id: 21, slug: "alpha-one", symbol: "ALP", name: "Alpha One" },
          { id: 22, slug: "alpha-two", symbol: "ALP", name: "Alpha Two" },
        ] })
        : jsonResponse(eventsBody)));
    const out = await collectUpcomingUnlocks("Alpha", "ALP", CANONICAL_TOKEN);
    expect(out.available).toBe(false);
  });

  it("rejects a same-name same-symbol listing whose contract is not canonical", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return fixtureResponse(String(url), {
        contracts: { data: [{ chain: "Ethereum", address: "0x0000000000000000000000000000000000000001" }] },
        events: completeEventsBody,
      });
    }));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);

    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.note).toContain("exact canonical token contract");
    expect(urls.some((url) => url.includes("/vesting/events"))).toBe(false);
  });

  it("rejects the canonical address when CryptoRank maps it to a different chain", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => fixtureResponse(String(url), {
      contracts: { data: [{ chain: "Base", address: CANONICAL_ADDRESS }] },
      events: completeEventsBody,
    })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);

    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.note).toContain("canonical chain");
  });

  it("rejects an exact address whose provider chain cannot be normalized", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return fixtureResponse(String(url), {
        contracts: { data: [{ chain: "Mystery Chain", address: CANONICAL_ADDRESS }] },
        events: completeEventsBody,
      });
    }));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);

    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.note).toContain("recognizable chain");
    expect(urls.some((url) => url.includes("/vesting/events"))).toBe(false);
  });

  it("rejects duplicate exact contract mappings as ambiguous", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => fixtureResponse(String(url), {
      contracts: { data: [
        { chain: "Ethereum", address: CANONICAL_ADDRESS },
        { chain: "ETH", address: CANONICAL_ADDRESS },
      ] },
      events: completeEventsBody,
    })));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);

    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.note).toContain("ambiguous");
  });

  it("fails before provider discovery when the canonical chain cannot be normalized", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const out = await collectUpcomingUnlocks("Uniswap", "UNI", {
      address: CANONICAL_ADDRESS,
      chain: "unknown-chain",
    });

    expect(out.available).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a completed no-upcoming outcome instead of fabricating a schedule", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      fixtureResponse(String(url), { events: { data: [] } })));
    const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected no-data");
    expect(out.note).toContain("no upcoming unlock events");
  });

  it("fails currency-contracts with the HTTP status after a non-OK response", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/currencies/map")) return jsonResponse(mapBody);
      if (String(url).includes("/contracts")) return new Response("nope", { status: 404 });
      return jsonResponse(completeEventsBody);
    }));

    const cost = await withCostLedger(async () => {
      const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);
      expect(out.available).toBe(false);
      if (out.available) throw new Error("expected unavailable");
      expect(out.note).toContain("unavailable");
      return getCost();
    });

    expect(cost.calls.find((line) => line.op === "currency-contracts")).toMatchObject({
      status: "failed",
      meta: expect.stringContaining("http_404"),
    });
  });

  it("retries a timed-out contracts call once, then fails as timeout", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    let contractCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/currencies/map")) return jsonResponse(mapBody);
      if (String(url).includes("/contracts")) {
        contractCalls += 1;
        throw timeoutError();
      }
      return jsonResponse(completeEventsBody);
    }));

    const cost = await withCostLedger(async () => {
      const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);
      expect(out.available).toBe(false);
      if (out.available) throw new Error("expected unavailable");
      expect(out.note).toContain("unavailable");
      return getCost();
    });

    expect(contractCalls).toBe(2);
    expect(cost.calls.find((line) => line.op === "currency-contracts")).toMatchObject({
      status: "failed",
      meta: expect.stringContaining("timeout"),
    });
  });

  it("treats a 2xx contracts response with no canonical join as succeeded no-data, not unavailable", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const urls: string[] = [];
    const cost = await withCostLedger(async () => {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        urls.push(String(url));
        return fixtureResponse(String(url), { contracts: { data: [] } });
      }));
      const out = await collectUpcomingUnlocks("Uniswap", "UNI", CANONICAL_TOKEN);
      expect(out.available).toBe(false);
      if (out.available) throw new Error("expected no-data");
      expect(out.note).toContain("exact canonical token contract");
      expect(out.note).not.toContain("unavailable");
      return getCost();
    });

    expect(urls.some((url) => url.includes("/vesting/events"))).toBe(false);
    expect(cost.calls.find((line) => line.op === "currency-contracts")).toMatchObject({
      status: "succeeded",
      meta: expect.stringContaining("canonical_contract_missing"),
    });
  });
});
