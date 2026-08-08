import { beforeEach, describe, expect, it } from "vitest";
import { getCost, withCostLedger } from "../cost";
import {
  collectProtocolAuditLinks,
  collectProtocolFees,
  collectProtocolFunding,
  collectProtocolTvl,
  defiLlamaLookupName,
  defiLlamaSlug,
  describeFunding,
  formatTvlUsd,
  formatUsd,
  resetDefiLlamaScanMemo,
} from "./defiLlama";

// Every test below is its own "scan": the read memo must not carry a document
// from one case into the next any more than it may carry one between subjects.
beforeEach(() => resetDefiLlamaScanMemo());

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

  it("freezes incident technique and numeric recovery state from the same protocol record", async () => {
    const out = await collectProtocolTvl("Drift", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({
        name: "Drift",
        gecko_id: "drift-protocol",
        hacks: [
          {
            date: 1_775_001_600,
            amount: 295_000_000,
            returnedFunds: null,
            classification: "Infrastructure",
            technique: "Compromised Admin + Fake Token Price Manipulation",
          },
          {
            date: 1_652_227_200,
            amount: 14_500_000,
            returnedFunds: 14_500_000,
            classification: "Protocol Logic",
            technique: "realized PnL withdrawal bug",
          },
        ],
      }))),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.hacks).toEqual([
      expect.objectContaining({
        date: "2026-04-01",
        amountUsd: 295_000_000,
        returnedFunds: null,
        returnedAmountUsd: null,
        classification: "Infrastructure",
        technique: "Compromised Admin + Fake Token Price Manipulation",
      }),
      expect.objectContaining({
        returnedFunds: true,
        returnedAmountUsd: 14_500_000,
      }),
    ]);
  });
});

describe("defiLlamaSlug", () => {
  it("slugifies a project name", () => {
    expect(defiLlamaSlug("Aave V3")).toBe("aave-v3");
    expect(defiLlamaSlug("  Curve!!  Finance ")).toBe("curve-finance");
    expect(defiLlamaSlug("Uniswap")).toBe("uniswap");
  });

  it("removes only the generic Protocol suffix used by CoinGecko display names", () => {
    expect(defiLlamaLookupName("Drift Protocol")).toBe("Drift");
    expect(defiLlamaLookupName("Protocol Labs")).toBe("Protocol Labs");
    expect(defiLlamaLookupName("Aave")).toBe("Aave");
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

describe("one document, one read", () => {
  // The recorded Uniswap scan fetched https://api.llama.fi/protocol/uniswap
  // three times, 1.86 MB each: TVL and funding concurrently, then audit links
  // straight after. All three read the same document.
  const countingFetcher = (make: (url: string) => Response) => {
    const urls: string[] = [];
    const fetcher = ((input: string | URL | Request) => {
      urls.push(String(input));
      return Promise.resolve(make(String(input)));
    }) as unknown as typeof fetch;
    return { fetcher, urls };
  };

  it("collapses three concurrent reads of one protocol document into a single request", async () => {
    const { fetcher, urls } = countingFetcher(() => jsonResponse(protocolBody({ name: "Uniswap", gecko_id: "uniswap" })));

    const [a, b, c] = await Promise.all([
      collectProtocolTvl("Uniswap", { fetcher }),
      collectProtocolTvl("Uniswap", { fetcher }),
      collectProtocolTvl("Uniswap", { fetcher }),
    ]);

    expect(urls).toEqual(["https://api.llama.fi/protocol/uniswap"]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.available).toBe(true);
  });

  it("shares one request across the TVL, funding and audit-link collectors", async () => {
    const { fetcher, urls } = countingFetcher(() => jsonResponse(protocolBody({
      name: "Uniswap",
      gecko_id: "uniswap",
      audit_links: ["https://example.org/audit.pdf"],
    })));

    const [tvl, funding, audits] = await Promise.all([
      collectProtocolTvl("Uniswap", { fetcher }),
      collectProtocolFunding("Uniswap", { fetcher }),
      collectProtocolAuditLinks("Uniswap", { fetcher }),
    ]);

    expect(urls).toHaveLength(1);
    expect(tvl.available && funding.available && audits.available).toBe(true);
  });

  it("serves a repeat read that arrives after the first one landed", async () => {
    const { fetcher, urls } = countingFetcher(() => jsonResponse(protocolBody({ name: "Uniswap", gecko_id: "uniswap" })));

    await collectProtocolTvl("Uniswap", { fetcher });
    const audits = await collectProtocolAuditLinks("Uniswap", { fetcher });

    expect(urls).toHaveLength(1);
    expect(audits.available).toBe(false); // no audit links in this document
  });

  it("books a reused document as cached, never as a second provider attempt", async () => {
    const { fetcher } = countingFetcher(() => jsonResponse(protocolBody({ name: "Uniswap", gecko_id: "uniswap" })));

    const cost = await withCostLedger(async () => {
      await collectProtocolTvl("Uniswap", { fetcher });
      await collectProtocolFunding("Uniswap", { fetcher });
      return getCost();
    });

    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "defillama", op: "tvl", calls: 1, succeeded: 1, cached: 0,
    }));
    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "defillama", op: "funding", calls: 1, succeeded: 0, cached: 1, status: "cached",
    }));
  });

  it("never memoises a failure, so one blip cannot freeze into an absence", async () => {
    let attempt = 0;
    const { fetcher, urls } = countingFetcher(() => {
      attempt += 1;
      return attempt === 1
        ? new Response("upstream error", { status: 503 })
        : jsonResponse(protocolBody({ name: "Uniswap", gecko_id: "uniswap" }));
    });

    const blip = await collectProtocolFunding("Uniswap", { fetcher });
    expect(blip.available).toBe(false);
    if (blip.available) throw new Error("expected unavailable");
    expect(blip.reason).toBe("unavailable");

    // The very next caller must ask again rather than inherit "no rounds".
    const retry = await collectProtocolFunding("Uniswap", { fetcher });
    expect(urls).toHaveLength(2);
    expect(retry.available).toBe(true);
  });

  // The subtlest way a memo can lie: a caller that JOINS a read already in
  // flight. If it were handed a success shape regardless of what the shared
  // read returned, one outage would publish as "no funding rounds on record"
  // for every concurrent caller in the burst.
  it("hands a joiner the shared read's failure, never a clean answer", async () => {
    const { fetcher, urls } = countingFetcher(() => new Response("upstream error", { status: 503 }));

    const [tvl, funding] = await Promise.all([
      collectProtocolTvl("Uniswap", { fetcher }),
      collectProtocolFunding("Uniswap", { fetcher }),
    ]);

    expect(urls).toHaveLength(1);
    expect(tvl.available).toBe(false);
    expect(funding.available).toBe(false);
    if (funding.available) throw new Error("expected unavailable");
    // Not "no_data": the provider never answered, so there is no absence to report.
    expect(funding.reason).toBe("unavailable");

    // And the failure left nothing behind for the next caller to inherit.
    const after = await collectProtocolTvl("Uniswap", { fetcher });
    expect(urls).toHaveLength(2);
    expect(after.available).toBe(false);
  });

  it("never memoises a completed no-match either", async () => {
    const { fetcher, urls } = countingFetcher(() => new Response("Protocol not found", { status: 400 }));

    await collectProtocolTvl("Ghost", { fetcher });
    await collectProtocolTvl("Ghost", { fetcher });

    expect(urls).toHaveLength(2);
  });

  it("keys on the full URL, so a different slug or endpoint is its own read", async () => {
    const { fetcher, urls } = countingFetcher((url) => (
      url.includes("/summary/fees/")
        ? jsonResponse({ total24h: 1_000, total30d: 30_000 })
        : jsonResponse(protocolBody())
    ));

    await Promise.all([
      collectProtocolTvl("Aave", { fetcher }),
      collectProtocolTvl("Aave", { fetcher, slug: "aave-v3" }),
      collectProtocolFees("Aave", { fetcher }),
      collectProtocolFees("Aave", { fetcher }),
    ]);

    expect([...urls].sort()).toEqual([
      "https://api.llama.fi/protocol/aave",
      "https://api.llama.fi/protocol/aave-v3",
      "https://api.llama.fi/summary/fees/aave",
    ]);
  });

  it("drops every memoised document on an explicit scan boundary", async () => {
    const { fetcher, urls } = countingFetcher(() => jsonResponse(protocolBody()));

    await collectProtocolTvl("Aave", { fetcher });
    resetDefiLlamaScanMemo();
    await collectProtocolTvl("Aave", { fetcher });

    expect(urls).toHaveLength(2);
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
