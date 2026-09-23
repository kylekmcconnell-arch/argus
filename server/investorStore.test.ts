// The cross-scan investor store derives one row per (investor x subject x
// round) from a scan's frozen funding snapshots, and the registry endpoint
// folds those rows into the derived VC ranking. Both are pure; the tests
// exercise idempotence, the residue filter, lead merging across indexes, and
// the ranking order.
import { describe, expect, it } from "vitest";

import { investorObservationsFromEvidence } from "./investorStore";
import { buildInvestorRanking, type InvestorRegistryRow } from "../api/investor-registry";
import type { CryptoRankFundingSnapshot, ProtocolFundingSnapshot } from "../src/data/evidence";

const ORG = "00000000-0000-4000-8000-000000000001";

const cryptoRank = (rounds: CryptoRankFundingSnapshot["rounds"]): CryptoRankFundingSnapshot => ({
  currencyId: 1,
  key: "definitive",
  name: "Definitive",
  symbol: "EDGE",
  binding: { method: "official_identity", officialTwitter: "DefinitiveFi", officialUrl: "https://www.definitive.fi/" },
  hasFundingRounds: true,
  rounds,
  totalRaisedUsd: 4_100_000,
  funds: [],
  access: { fundingRounds: "ok", fullMetadata: "ok" },
  sourceUrl: "https://cryptorank.io/ico/definitive",
  capturedAt: "2026-09-17T00:00:00.000Z",
});

describe("investorObservationsFromEvidence", () => {
  it("derives one row per backer per round, leads flagged, aggregator named", () => {
    const rows = investorObservationsFromEvidence(ORG, "definitivefi", "project", {
      cryptoRankFunding: cryptoRank([{
        stage: "Seed",
        date: "2023-11-08",
        amountUsd: 4_100_000,
        valuationUsd: null,
        leadInvestors: ["BlockTower Capital"],
        otherInvestors: ["Nascent", "Coinbase Ventures", "CMT Digital"],
        announcementUrl: "https://www.theblock.co/news/definitive-raise",
      }]),
      website: "https://www.definitive.fi/",
    });

    expect(rows).toHaveLength(4);
    const lead = rows.find((row) => row.display_name === "BlockTower Capital");
    expect(lead).toMatchObject({
      organization_id: ORG,
      investor_key: "name:blocktower capital",
      subject_ref: "definitivefi",
      is_lead: true,
      backer_type: "venture_fund",
      round_date: "2023-11-08",
      amount_usd: 4_100_000,
      providers: ["cryptorank"],
    });
    expect(rows.filter((row) => row.is_lead)).toHaveLength(1);
    // The same round from two rows can never double-count: keys are identical.
    expect(new Set(rows.map((row) => row.round_key)).size).toBe(1);
  });

  it("refuses aggregator relationship residue: a round with no amount, valuation, or token terms", () => {
    const rows = investorObservationsFromEvidence(ORG, "uniswap", "project", {
      cryptoRankFunding: cryptoRank([{
        stage: "Undisclosed",
        date: null,
        amountUsd: null,
        valuationUsd: null,
        leadInvestors: ["BlackRock"],
        otherInvestors: [],
        announcementUrl: null,
      }]),
    });
    expect(rows).toEqual([]);
  });

  it("returns nothing when the scan carries no funding snapshots", () => {
    expect(investorObservationsFromEvidence(ORG, "subject", "person", {})).toEqual([]);
  });
});

describe("buildInvestorRanking", () => {
  const row = (over: Partial<InvestorRegistryRow>): InvestorRegistryRow => ({
    investor_key: "name:fund",
    display_name: "Fund",
    backer_type: "venture_fund",
    subject_ref: "subject-a",
    round_key: "2024-01|26",
    is_lead: false,
    round_date: "2024-01-15",
    amount_usd: 1_000_000,
    valuation_usd: null,
    providers: ["cryptorank"],
    updated_at: "2026-09-17T00:00:00.000Z",
    ...over,
  });

  it("folds observations per investor and ranks by subjects, then leads", () => {
    const ranking = buildInvestorRanking([
      row({ investor_key: "name:big fund", display_name: "Big Fund", subject_ref: "a", is_lead: true }),
      row({ investor_key: "name:big fund", display_name: "Big Fund", subject_ref: "b", round_key: "2024-06|26", round_date: "2024-06-01" }),
      row({ investor_key: "name:small fund", display_name: "Small Fund", subject_ref: "a" }),
    ]);

    expect(ranking.map((investor) => investor.displayName)).toEqual(["Big Fund", "Small Fund"]);
    expect(ranking[0]).toMatchObject({
      rounds: 2,
      leadRounds: 1,
      subjects: 2,
      firstRoundDate: "2024-01-15",
      lastRoundDate: "2024-06-01",
      disclosedUsd: 2_000_000,
    });
  });

  it("reads the valuation direction across an investor's dated, valued rounds", () => {
    const ranking = buildInvestorRanking([
      row({ subject_ref: "a", round_key: "r1", round_date: "2023-01-01", valuation_usd: 10_000_000 }),
      row({ subject_ref: "b", round_key: "r2", round_date: "2024-01-01", valuation_usd: 40_000_000 }),
    ]);
    expect(ranking[0].valuationDirection).toBe("rising");

    const single = buildInvestorRanking([row({})]);
    expect(single[0].valuationDirection).toBe("insufficient");
  });
});
