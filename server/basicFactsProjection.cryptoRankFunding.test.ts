import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { emptyEvidence, type CollectedEvidence, type CryptoRankFundingSnapshot } from "../src/data/evidence";
import { cryptoRankRecordMatch, projectProviderBackedBasicFacts } from "./basicFactsProjection";

const TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001";

function projectEvidence(): CollectedEvidence {
  const evidence = emptyEvidence("@ammalgam");
  evidence.roles = [SubjectClass.PROJECT];
  evidence.profile.website = "https://ammalgam.xyz/";
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  return evidence;
}

function withVerifiedToken(evidence: CollectedEvidence): void {
  evidence.projectToken = {
    verified: true,
    verification: "official_x",
    name: "Ammalgam",
    symbol: "AMLG",
    rank: null,
    address: TOKEN_ADDRESS,
    chain: "ethereum",
    sourceUrl: "https://www.coingecko.com/en/coins/ammalgam",
    capturedAt: "2026-09-01T00:00:00.000Z",
  };
}

function cryptoRankSnapshot(over: Partial<CryptoRankFundingSnapshot> = {}): CryptoRankFundingSnapshot {
  return {
    currencyId: 42,
    key: "ammalgam",
    name: "Ammalgam",
    symbol: "AMLG",
    binding: { method: "canonical_token_address", address: TOKEN_ADDRESS, platform: "Ethereum" },
    hasFundingRounds: true,
    rounds: [
      {
        stage: "SEED",
        date: "2024-06-01",
        amountUsd: 2_500_000,
        valuationUsd: 25_000_000,
        leadInvestors: ["Lightspeed Faction", "Framework Ventures"],
        otherInvestors: ["Small Cap Partners"],
        announcementUrl: "https://example.com/seed",
      },
    ],
    totalRaisedUsd: 2_500_000,
    funds: [],
    access: { fundingRounds: "ok", fullMetadata: "not_needed" },
    sourceUrl: "https://cryptorank.io/price/ammalgam",
    capturedAt: "2026-09-16T00:00:00.000Z",
    ...over,
  };
}

describe("cryptoRankRecordMatch", () => {
  it("re-validates a contract binding against the verified canonical token", () => {
    const evidence = projectEvidence();
    withVerifiedToken(evidence);
    expect(cryptoRankRecordMatch(evidence, cryptoRankSnapshot())).toBe(true);
    expect(cryptoRankRecordMatch(evidence, cryptoRankSnapshot({
      binding: { method: "canonical_token_address", address: "0x0000000000000000000000000000000000000002", platform: "Ethereum" },
    }))).toBe(false);
  });

  it("fails closed when the evidence has no verified token to re-join", () => {
    const evidence = projectEvidence();
    expect(cryptoRankRecordMatch(evidence, cryptoRankSnapshot())).toBe(false);
  });

  it("re-validates an official-identity binding through the handle/domain doctrine", () => {
    const evidence = projectEvidence();
    expect(cryptoRankRecordMatch(evidence, cryptoRankSnapshot({
      binding: { method: "official_identity", officialTwitter: "ammalgam", officialUrl: "https://ammalgam.xyz/" },
    }))).toBe(true);
    expect(cryptoRankRecordMatch(evidence, cryptoRankSnapshot({
      binding: { method: "official_identity", officialTwitter: "someoneelse", officialUrl: "https://ammalgam.xyz/" },
    }))).toBe(false);
  });
});

describe("projectProviderBackedBasicFacts · CryptoRank funding", () => {
  it("projects a reported-tier funding fact and per-backer facts when DeFiLlama is empty", () => {
    const evidence = projectEvidence();
    withVerifiedToken(evidence);
    evidence.cryptoRankFunding = cryptoRankSnapshot();

    projectProviderBackedBasicFacts(evidence);

    const funding = (evidence.basicFacts ?? []).find((fact) => fact.predicate === "funding");
    expect(funding).toBeDefined();
    expect(funding?.floorEligible).toBe(false);
    expect(funding?.sources[0].provider).toBe("cryptorank");
    expect(funding?.value).toContain("Lightspeed Faction");

    const investors = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor");
    expect(investors.map((fact) => fact.value)).toEqual(["Lightspeed Faction", "Framework Ventures", "Small Cap Partners"]);
    for (const investor of investors) {
      expect(investor.floorEligible).toBe(false);
      expect(investor.sources[0].provider).toBe("cryptorank");
      expect(investor.sources[0].excerpt).toContain("CryptoRank's funding index");
    }
  });

  it("prefers the identity-bound DeFiLlama record so one project never carries two backer lists", () => {
    const evidence = projectEvidence();
    withVerifiedToken(evidence);
    evidence.projectToken!.coingeckoId = "ammalgam";
    evidence.protocolFunding = {
      slug: "ammalgam",
      name: "Ammalgam",
      geckoId: "ammalgam",
      rounds: [{ date: "2024-06-01", round: "Seed", amountUsd: 2_500_000, leadInvestors: ["Lightspeed Faction"], otherInvestors: [], valuationUsd: null }],
      totalRaisedUsd: 2_500_000,
      leadInvestors: ["Lightspeed Faction"],
      sourceUrl: "https://defillama.com/protocol/ammalgam",
      capturedAt: "2026-09-16T00:00:00.000Z",
    };
    evidence.cryptoRankFunding = cryptoRankSnapshot();

    projectProviderBackedBasicFacts(evidence);

    const fundingProviders = (evidence.basicFacts ?? [])
      .filter((fact) => fact.predicate === "funding")
      .flatMap((fact) => fact.sources.map((sourceEntry) => sourceEntry.provider));
    expect(fundingProviders).toEqual(["defillama"]);
    const investorProviders = new Set((evidence.basicFacts ?? [])
      .filter((fact) => fact.predicate === "investor")
      .flatMap((fact) => fact.sources.map((sourceEntry) => sourceEntry.provider)));
    expect(investorProviders).toEqual(new Set(["defillama"]));
  });

  it("publishes the plan-gated partial answer as a partial answer, never as round detail", () => {
    const evidence = projectEvidence();
    withVerifiedToken(evidence);
    evidence.cryptoRankFunding = cryptoRankSnapshot({
      rounds: [],
      totalRaisedUsd: null,
      funds: [
        { name: "Lightspeed Faction", isLead: true },
        { name: "Framework Ventures", isLead: true },
      ],
      access: { fundingRounds: "plan_gated", fullMetadata: "ok" },
    });

    projectProviderBackedBasicFacts(evidence);

    const funding = (evidence.basicFacts ?? []).find((fact) => fact.predicate === "funding");
    expect(funding).toBeDefined();
    expect(funding?.floorEligible).toBe(false);
    expect(funding?.value).toContain("named backers include Lightspeed Faction, Framework Ventures");
    expect(funding?.sources[0].excerpt).toContain("unknown here, not zero");
    expect((evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor")).toHaveLength(0);
  });

  it("projects nothing from a record whose binding no longer re-validates", () => {
    const evidence = projectEvidence();
    withVerifiedToken(evidence);
    evidence.cryptoRankFunding = cryptoRankSnapshot({
      binding: { method: "canonical_token_address", address: "0x00000000000000000000000000000000000000ff", platform: "Ethereum" },
    });

    projectProviderBackedBasicFacts(evidence);

    expect((evidence.basicFacts ?? []).some((fact) => fact.predicate === "funding" || fact.predicate === "investor")).toBe(false);
  });
});

describe("self-published site backers", () => {
  it("mints reported-tier investor facts from the official site's backer wall, deduplicated against indexed names", () => {
    const evidence = projectEvidence();
    withVerifiedToken(evidence);
    evidence.cryptoRankFunding = cryptoRankSnapshot();
    evidence.siteBackers = {
      heading: "Backed by the best in DeFi",
      names: ["Lightspeed Faction", "Selini Capital", "Robot Ventures"],
      excerpt: "Backed by the best in DeFi · Lightspeed Faction, Selini Capital, Robot Ventures",
      sourceUrl: "https://ammalgam.xyz/",
      capturedAt: "2026-09-17T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const investors = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor");
    const byName = new Map(investors.map((fact) => [fact.value, fact]));
    // The indexed round already names Lightspeed Faction; the wall adds only
    // the names no index attributed.
    expect(investors.filter((fact) => fact.value === "Lightspeed Faction")).toHaveLength(1);
    expect(byName.get("Selini Capital")?.sources[0].sourceClass).toBe("official_subject");
    expect(byName.get("Selini Capital")?.floorEligible).toBe(false);
    expect(byName.get("Selini Capital")?.sources[0].excerpt).toContain("Self-published by the subject");
    expect(byName.get("Robot Ventures")).toBeDefined();
  });
});
