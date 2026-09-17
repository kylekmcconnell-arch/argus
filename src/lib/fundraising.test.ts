import { describe, expect, it } from "vitest";
import { classifyBacker, fundraisingTrajectory, mergeFundraisingRounds } from "./fundraising";

const defiLlama = {
  slug: "ammalgam",
  name: "Ammalgam",
  geckoId: null,
  rounds: [
    { date: "2023-04-10", round: "Pre-seed", amountUsd: 750_000, leadInvestors: [], otherInvestors: ["Angel Collective"], valuationUsd: null },
    { date: "2024-06-01", round: "Seed", amountUsd: 2_500_000, leadInvestors: ["Lightspeed Faction"], otherInvestors: [], valuationUsd: 25_000_000 },
  ],
  totalRaisedUsd: 3_250_000,
  leadInvestors: ["Lightspeed Faction"],
  sourceUrl: "https://defillama.com/protocol/ammalgam",
  capturedAt: "2026-09-17T00:00:00.000Z",
};

const cryptoRank = {
  currencyId: 42,
  key: "ammalgam",
  name: "Ammalgam",
  symbol: "AMLG",
  binding: { method: "canonical_token_address" as const, address: "0x1", platform: "Ethereum" },
  hasFundingRounds: true,
  rounds: [
    {
      stage: "SEED",
      date: "2024-06-01",
      amountUsd: 2_500_000,
      valuationUsd: 25_000_000,
      tokenPriceUsd: 0.05,
      tokensForSale: 50_000_000,
      allocationOfSupplyPct: 5,
      leadInvestors: ["Framework Ventures"],
      otherInvestors: [],
      announcementUrl: "https://example.com/seed",
    },
  ],
  totalRaisedUsd: 2_500_000,
  funds: [],
  access: { fundingRounds: "ok" as const, fullMetadata: "not_needed" as const },
  sourceUrl: "https://cryptorank.io/price/ammalgam",
  capturedAt: "2026-09-17T00:00:00.000Z",
};

describe("mergeFundraisingRounds", () => {
  it("merges the same round across indexes, unions leads, and keeps the token terms", () => {
    const rounds = mergeFundraisingRounds({ protocolFunding: defiLlama, cryptoRankFunding: cryptoRank, website: undefined });
    expect(rounds).toHaveLength(2);
    const seed = rounds[1];
    expect(seed.date).toBe("2024-06-01");
    expect(seed.instrument).toBe("token_sale");
    expect(seed.tokenPriceUsd).toBe(0.05);
    expect(seed.allocationOfSupplyPct).toBe(5);
    expect(seed.leadInvestors.sort()).toEqual(["Framework Ventures", "Lightspeed Faction"]);
    expect(seed.sources.map((source) => source.provider).sort()).toEqual(["cryptorank", "defillama"]);
    // The pre-seed stays its own round with its own source.
    expect(rounds[0]).toMatchObject({ date: "2023-04-10", amountUsd: 750_000, instrument: "unstated" });
  });

  it("orders rounds chronologically with undated rounds last", () => {
    const rounds = mergeFundraisingRounds({
      protocolFunding: {
        ...defiLlama,
        rounds: [
          { date: null, round: "Strategic", amountUsd: 1_000_000, leadInvestors: [], otherInvestors: [], valuationUsd: null },
          { date: "2022-01-05", round: "Angel", amountUsd: 200_000, leadInvestors: [], otherInvestors: [], valuationUsd: null },
        ],
      },
      cryptoRankFunding: undefined,
      website: undefined,
    });
    expect(rounds.map((round) => round.date)).toEqual(["2022-01-05", null]);
  });

  it("only admits the licensed enrichment record when it is domain-bound", () => {
    const enrichment = {
      name: "Ammalgam",
      uuid: "u",
      identityMatch: "name_only" as const,
      requestedDomain: "ammalgam.xyz",
      matchedDomain: "ammalgam.xyz",
      matchMethod: "exact_name" as const,
      funding: { totalRaisedUsd: 9_000_000, rounds: [{ date: "2024-01-01", round: "Series A", amountUsd: 9_000_000, leadInvestors: [], otherInvestors: [] }], leadInvestors: [] },
      sourceUrl: "https://monid.ai/company/u",
      capturedAt: "2026-09-17T00:00:00.000Z",
    };
    const rounds = mergeFundraisingRounds({
      protocolFunding: undefined,
      cryptoRankFunding: undefined,
      companyEnrichment: enrichment as never,
      website: "https://ammalgam.xyz/",
    });
    expect(rounds).toHaveLength(0);
  });
});

describe("classifyBacker", () => {
  it("classifies by name shape and the launch-venue registry, defaulting to a plain backer", () => {
    expect(classifyBacker("Lightspeed Faction")).toBe("backer");
    expect(classifyBacker("Framework Ventures")).toBe("venture_fund");
    expect(classifyBacker("Angel Collective")).toBe("angel");
    expect(classifyBacker("Smith Family Office")).toBe("family_office");
    expect(classifyBacker("Apex Private Equity")).toBe("private_equity");
    expect(classifyBacker("pump.fun")).toBe("launchpad");
    expect(classifyBacker("Binance Exchange")).toBe("platform");
  });
});

describe("fundraisingTrajectory", () => {
  it("reads count, span, disclosed total, and the valuation direction", () => {
    const rounds = mergeFundraisingRounds({ protocolFunding: defiLlama, cryptoRankFunding: cryptoRank, website: undefined });
    const trajectory = fundraisingTrajectory(rounds);
    expect(trajectory).toMatchObject({
      roundCount: 2,
      firstDate: "2023-04-10",
      lastDate: "2024-06-01",
      totalDisclosedUsd: 3_250_000,
      valuationDirection: "insufficient",
    });
  });

  it("reads a rising valuation series", () => {
    const trajectory = fundraisingTrajectory([
      { date: "2023-01-01", label: "Seed", amountUsd: 1, valuationUsd: 10, leadInvestors: [], otherInvestors: [], instrument: "unstated", sources: [] },
      { date: "2024-01-01", label: "A", amountUsd: 1, valuationUsd: 30, leadInvestors: [], otherInvestors: [], instrument: "unstated", sources: [] },
    ]);
    expect(trajectory.valuationDirection).toBe("rising");
  });
});

describe("aggregator residue", () => {
  it("never renders a round that states neither an amount, a valuation, nor token terms", () => {
    const rounds = mergeFundraisingRounds({
      protocolFunding: {
        slug: "uniswap",
        name: "Uniswap",
        geckoId: "uniswap",
        rounds: [
          { date: "2020-08-07", round: "Series A", amountUsd: 11_000_000, leadInvestors: [], otherInvestors: ["a16z"], valuationUsd: null },
          // The false "led by BlackRock" shape: a relationship row with no
          // amount, no valuation, and no terms.
          { date: "2026-02-11", round: "Undisclosed round", amountUsd: null, leadInvestors: ["BlackRock"], otherInvestors: [], valuationUsd: null },
        ],
        totalRaisedUsd: 11_000_000,
        leadInvestors: ["BlackRock"],
        sourceUrl: "https://defillama.com/protocol/uniswap",
        capturedAt: "2026-09-17T00:00:00.000Z",
      },
      cryptoRankFunding: undefined,
      website: undefined,
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0].label).toBe("Series A");
    expect(JSON.stringify(rounds)).not.toContain("BlackRock");
  });
});
