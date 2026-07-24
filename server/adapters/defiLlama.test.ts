import { describe, expect, it } from "vitest";
import {
  collectProtocolFees,
  collectProtocolFunding,
  collectProtocolTvl,
  defiLlamaSlug,
  describeFunding,
  formatTvlUsd,
  formatUsd,
} from "./defiLlama";

const protocolBody = (over: Record<string, unknown> = {}) => ({
  name: "Aave",
  symbol: "AAVE",
  gecko_id: "aave",
  currentChainTvls: {
    Ethereum: 11_000_000_000,
    Arbitrum: 400_000_000,
    borrowed: 9_000_000_000, // pseudo-segment — must be excluded
    "Ethereum-staking": 200_000_000, // pseudo-segment — must be excluded
  },
  tvl: [
    { date: 1, totalLiquidityUSD: 100 },
    { date: 2, totalLiquidityUSD: 13_700_000_000 },
  ],
  raises: [
    { date: 1602460800, round: "Strategic", amount: 25, leadInvestors: ["Blockchain Capital", "Standard Crypto"], otherInvestors: [], valuation: null },
    { date: 1512000000, round: "ICO", amount: 16.2, leadInvestors: [], otherInvestors: [] },
  ],
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetcherReturning = (make: () => Response) =>
  ((input: string | URL | Request) => {
    void input;
    return Promise.resolve(make());
  }) as unknown as typeof fetch;

describe("collectProtocolTvl", () => {
  it("returns the latest TVL and a chain breakdown, excluding pseudo-segments", async () => {
    const out = await collectProtocolTvl("Aave", { fetcher: fetcherReturning(() => jsonResponse(protocolBody())) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.tvlUsd).toBe(13_700_000_000);
    expect(out.value.symbol).toBe("AAVE");
    expect(out.value.geckoId).toBe("aave");
    expect(out.value.chainBreakdown.map((c) => c.chain)).toEqual(["Ethereum", "Arbitrum"]);
    expect(out.value.chains).toEqual(["Ethereum", "Arbitrum"]);
    expect(out.value.sourceUrl).toBe("https://defillama.com/protocol/aave");
  });

  it("freezes a weekly downsampled trend ending on the latest reading", async () => {
    const day = 86_400;
    const latest = 1_760_000_000;
    // Daily points over ~30 days: the weekly downsample keeps ~1 in 7 and the
    // latest reading is always the final point.
    const tvl = Array.from({ length: 30 }, (_, index) => ({
      date: latest - (29 - index) * day,
      totalLiquidityUSD: 10_000_000_000 + index * 50_000_000,
    }));
    const out = await collectProtocolTvl("Aave", { fetcher: fetcherReturning(() => jsonResponse(protocolBody({ tvl }))) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.trend.length).toBeGreaterThanOrEqual(4);
    expect(out.value.trend.length).toBeLessThanOrEqual(6);
    const lastPoint = out.value.trend[out.value.trend.length - 1];
    expect(lastPoint.date).toBe(new Date(latest * 1000).toISOString().slice(0, 10));
    expect(lastPoint.tvlUsd).toBe(10_000_000_000 + 29 * 50_000_000);
    // Points ascend in time and every value is positive.
    const dates = out.value.trend.map((point) => point.date);
    expect([...dates].sort()).toEqual(dates);
    expect(out.value.trend.every((point) => point.tvlUsd > 0)).toBe(true);
  });

  it("treats a 400 (protocol not found) as a completed no-match, not an outage", async () => {
    const out = await collectProtocolTvl("Nonexistent Thing", {
      fetcher: fetcherReturning(() => new Response("Protocol not found", { status: 400 })),
    });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.note).toContain("No DeFiLlama protocol matched");
  });

  it("does not claim TVL when the series is empty", async () => {
    const out = await collectProtocolTvl("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({ tvl: [] }))),
    });
    expect(out.available).toBe(false);
  });

  it("does not claim TVL when the latest point is zero or non-numeric", async () => {
    const out = await collectProtocolTvl("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({ tvl: [{ date: 2, totalLiquidityUSD: 0 }] }))),
    });
    expect(out.available).toBe(false);
  });

  it("is resilient to a transport error", async () => {
    const throwing = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    const out = await collectProtocolTvl("Aave", { fetcher: throwing });
    expect(out.available).toBe(false);
  });

  it("respects an explicit slug override", async () => {
    let seen = "";
    const spy = ((input: string | URL | Request) => {
      seen = String(input);
      return Promise.resolve(jsonResponse(protocolBody({ name: "Aave V3" })));
    }) as unknown as typeof fetch;
    const out = await collectProtocolTvl("Aave", { fetcher: spy, slug: "aave-v3" });
    expect(seen).toContain("/protocol/aave-v3");
    expect(out.available).toBe(true);
  });
});

describe("defiLlamaSlug", () => {
  it("slugifies a project name", () => {
    expect(defiLlamaSlug("Aave V3")).toBe("aave-v3");
    expect(defiLlamaSlug("  Curve!!  Finance ")).toBe("curve-finance");
    expect(defiLlamaSlug("Uniswap")).toBe("uniswap");
  });
});

describe("collectProtocolFunding", () => {
  it("returns funding rounds, lead investors, and total raised, oldest-first", async () => {
    const out = await collectProtocolFunding("Aave", { fetcher: fetcherReturning(() => jsonResponse(protocolBody())) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.rounds.map((r) => r.round)).toEqual(["ICO", "Strategic"]); // sorted by date ascending
    expect(out.value.rounds[1].amountUsd).toBe(25_000_000); // millions → USD
    expect(out.value.rounds[1].date).toBe("2020-10-12");
    expect(out.value.geckoId).toBe("aave");
    expect(out.value.leadInvestors).toEqual(["Blockchain Capital", "Standard Crypto"]);
    expect(out.value.totalRaisedUsd).toBe(41_200_000);
    expect(describeFunding(out)).toMatchObject({ status: "confirmed" });
    expect(describeFunding(out).note).toContain("Blockchain Capital");
  });

  it("rejects investor-only relationship rows that are not funding rounds", async () => {
    const out = await collectProtocolFunding("Uniswap", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({
        name: "Uniswap",
        gecko_id: "uniswap",
        raises: [
          {
            date: 1770768000,
            round: null,
            amount: null,
            valuation: null,
            leadInvestors: ["BlackRock"],
            otherInvestors: [],
          },
          {
            date: 1596758400,
            round: "Series A",
            amount: 11,
            valuation: null,
            leadInvestors: [],
            otherInvestors: ["a16z"],
          },
        ],
      }))),
    });

    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.rounds).toHaveLength(1);
    expect(out.value.rounds[0]).toMatchObject({ round: "Series A", amountUsd: 11_000_000 });
    expect(out.value.leadInvestors).toEqual([]);
    expect(out.value.totalRaisedUsd).toBe(11_000_000);
  });

  it("reports no_data (not an outage) when the protocol has no raises", async () => {
    const out = await collectProtocolFunding("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({ raises: [] }))),
    });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("no_data");
    expect(describeFunding(out).status).toBe("checked-empty");
  });

  it("reports no_data for a protocol that does not exist (400)", async () => {
    const out = await collectProtocolFunding("Nope", {
      fetcher: fetcherReturning(() => new Response("Protocol not found", { status: 400 })),
    });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("no_data");
  });

  it("reports unavailable (outage) on a transport error, never 'unfunded'", async () => {
    const throwing = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    const out = await collectProtocolFunding("Aave", { fetcher: throwing });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("unavailable");
    expect(describeFunding(out).status).toBe("unavailable");
  });
});

describe("formatUsd", () => {
  it("formats compact USD (formatTvlUsd is a back-compat alias)", () => {
    expect(formatUsd(13_699_712_109)).toBe("$13.7B");
    expect(formatUsd(1_500_000)).toBe("$1.50M");
    expect(formatUsd(2_400)).toBe("$2.40K");
    expect(formatUsd(500)).toBe("$500");
    expect(formatTvlUsd).toBe(formatUsd);
  });
});

describe("collectProtocolTvl 30d trend", () => {
  const DAY = 86_400;
  const NOW = 1_750_000_000;

  it("computes TVL vs the point nearest 30 days back", async () => {
    const out = await collectProtocolTvl("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({
        tvl: [
          { date: NOW - 35 * DAY, totalLiquidityUSD: 2_900_000_000 },
          { date: NOW - 30 * DAY, totalLiquidityUSD: 3_000_000_000 },
          { date: NOW - 10 * DAY, totalLiquidityUSD: 3_500_000_000 },
          { date: NOW, totalLiquidityUSD: 3_180_000_000 },
        ],
      }))),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    // (3.18B - 3.0B) / 3.0B = +6%; the 10-day-old point is too recent to be a baseline.
    expect(out.value.change30dPct).toBe(6);
  });

  it("yields a null trend for a short or undated series instead of guessing", async () => {
    const out = await collectProtocolTvl("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody())),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.change30dPct).toBe(null);
  });
});

describe("collectProtocolFees", () => {
  it("returns fee totals plus the 30d-over-30d trend percent", async () => {
    const out = await collectProtocolFees("Aave", {
      fetcher: fetcherReturning(() => jsonResponse({ total24h: 3_840_000, total30d: 80_400_000, change_30dover30d: -12.34 })),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.total30dUsd).toBe(80_400_000);
    expect(out.value.total24hUsd).toBe(3_840_000);
    expect(out.value.change30dOver30dPct).toBe(-12.3);
  });

  it("drops an absent or absurd trend to null instead of misleading", async () => {
    const absent = await collectProtocolFees("Aave", {
      fetcher: fetcherReturning(() => jsonResponse({ total24h: 1_000, total30d: 30_000 })),
    });
    expect(absent.available && absent.value.change30dOver30dPct).toBe(null);
    // A listing gap can produce absurd multiples; those must not be reported.
    const absurd = await collectProtocolFees("Aave", {
      fetcher: fetcherReturning(() => jsonResponse({ total30d: 30_000, change_30dover30d: 250_000 })),
    });
    expect(absurd.available && absurd.value.change30dOver30dPct).toBe(null);
  });
});
