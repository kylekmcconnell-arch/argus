import { describe, expect, it } from "vitest";
import { summarizeFundingEvidence } from "./fundingEvidence";

describe("summarizeFundingEvidence", () => {
  it("combines a source-backed Series B with a distinct indexed Series A", () => {
    const summary = summarizeFundingEvidence([{
      predicate: "funding",
      value: "Series B",
      status: "corroborated",
      sources: [{
        url: "https://news.example/uniswap-series-b",
        title: "Uniswap Labs Raises $165M in Polychain Capital-Led Round",
        excerpt: "Uniswap Labs raised $165 million in a Series B led by Polychain Capital.",
        provider: "public-web",
        sourceClass: "independent_press",
      }, {
        url: "https://second.example/uniswap-series-b",
        excerpt: "Uniswap Labs secured $165 million in a Series B led by Polychain Capital.",
        provider: "public-web",
        sourceClass: "independent_press",
      }],
    }], [{
      date: "2020-08-07",
      round: "Series A",
      amountUsd: 11_000_000,
      leadInvestors: [],
      otherInvestors: ["a16z"],
      valuationUsd: null,
    }]);

    expect(summary.totalKnownUsd).toBe(176_000_000);
    expect(summary.independentRoundCount).toBe(1);
    expect(summary.independentSourceCount).toBe(2);
    expect(summary.rounds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        round: "Series B",
        amountUsd: 165_000_000,
        leadInvestors: ["Polychain Capital"],
      }),
      expect.objectContaining({ round: "Series A", amountUsd: 11_000_000 }),
    ]));
  });

  it("does not turn an aggregator projection into independent corroboration", () => {
    const summary = summarizeFundingEvidence([{
      predicate: "funding",
      value: "2 funding rounds indexed · $11.0M disclosed",
      status: "verified",
      providerProjection: true,
      sources: [{
        url: "https://defillama.com/protocol/uniswap",
        provider: "defillama",
        sourceClass: "other_public",
      }],
    }]);

    expect(summary.independentRoundCount).toBe(0);
    expect(summary.totalKnownUsd).toBe(0);
  });

  it("lets a source-backed round replace a conflicting same-name indexed row", () => {
    const summary = summarizeFundingEvidence([{
      predicate: "funding",
      value: "Series B",
      status: "verified",
      sources: [{
        url: "https://official.example/series-b",
        excerpt: "We raised $165M in a Series B round.",
        provider: "public-web",
        sourceClass: "official_subject",
      }],
    }], [{
      date: "2022-01-01",
      round: "Series B",
      amountUsd: 11_000_000,
      leadInvestors: ["Wrong Investor"],
      otherInvestors: [],
      valuationUsd: null,
    }]);

    expect(summary.rounds).toHaveLength(1);
    expect(summary.rounds[0].amountUsd).toBe(165_000_000);
  });
});
