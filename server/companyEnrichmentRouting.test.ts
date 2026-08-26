import { describe, expect, it } from "vitest";
import { emptyEvidence, type BasicFact, type BasicFactPredicate, type WebTeamMember } from "../src/data/evidence";
import { projectCompanyEnrichmentSections } from "./orchestrate";

const projectEvidence = () => {
  const evidence = emptyEvidence("@aave");
  evidence.profile.website = "https://aave.com";
  evidence.projectToken = {
    verified: true,
    verification: "official_domain",
    name: "Aave",
    symbol: "AAVE",
    coingeckoId: "aave",
    rank: null,
    address: "0x0000000000000000000000000000000000000001",
    chain: "ethereum",
    homepage: "https://aave.com",
    sourceUrl: "https://www.coingecko.com/en/coins/aave",
    capturedAt: "2026-08-26T00:00:00.000Z",
  };
  return evidence;
};

const fact = (predicate: BasicFactPredicate, value: string): BasicFact => ({
  factId: `fact-${predicate}`,
  subjectKey: "@aave",
  predicate,
  value,
  normalizedValue: value.toLowerCase(),
  status: "verified",
  critical: false,
  sources: [{
    url: `https://aave.com/${predicate}`,
    sourceClass: "official_subject",
    relation: "supports",
    excerpt: value,
    contentHash: predicate.padEnd(64, "0").slice(0, 64),
    capturedAt: "2026-08-26T00:00:00.000Z",
    provider: "public-web",
    artifactVerified: true,
  }],
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
});

const leader = (index: number): WebTeamMember => ({
  name: `Leader ${index}`,
  role: index === 1 ? "Founder and CEO" : index === 2 ? "CTO" : "COO",
  linkedin: `https://www.linkedin.com/in/leader-${index}`,
  evidence: `Leader ${index} previously led Company ${index}.`,
  source: "Official leadership page",
  sourceUrl: `https://aave.com/team#leader-${index}`,
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "team-page",
});

describe("projectCompanyEnrichmentSections", () => {
  it("requests every section when no equivalent evidence is frozen", () => {
    expect(projectCompanyEnrichmentSections(projectEvidence())).toEqual([
      "funding_detail",
      "management_profile",
      "firmographic",
    ]);
  });

  it("omits funding only after an exact canonical CoinGecko join with indexed rounds", () => {
    const evidence = projectEvidence();
    evidence.protocolFunding = {
      slug: "aave",
      name: "Aave",
      geckoId: "AAVE",
      rounds: [{
        date: "2020-10-12",
        round: "Strategic",
        amountUsd: 25_000_000,
        leadInvestors: ["Blockchain Capital"],
        otherInvestors: [],
        valuationUsd: null,
      }],
      totalRaisedUsd: 25_000_000,
      leadInvestors: ["Blockchain Capital"],
      sourceUrl: "https://defillama.com/protocol/aave",
      capturedAt: "2026-08-26T00:00:00.000Z",
    };
    expect(projectCompanyEnrichmentSections(evidence)).toEqual([
      "management_profile",
      "firmographic",
    ]);

    evidence.protocolFunding.geckoId = "aave-v2";
    expect(projectCompanyEnrichmentSections(evidence)).toContain("funding_detail");
  });

  it("keeps management unless the first-party leadership roster is detailed", () => {
    const evidence = projectEvidence();
    evidence.webTeam = [leader(1), leader(2)];
    expect(projectCompanyEnrichmentSections(evidence)).toContain("management_profile");

    evidence.webTeam.push(leader(3));
    expect(projectCompanyEnrichmentSections(evidence)).not.toContain("management_profile");

    evidence.webTeam[2].sourceUrl = "https://unrelated.example/team";
    expect(projectCompanyEnrichmentSections(evidence)).toContain("management_profile");
  });

  it("omits firmographics only when all four provider fields have strict public substitutes", () => {
    const evidence = projectEvidence();
    evidence.basicFacts = [
      fact("legal_entity", "Aave Labs, Inc."),
      fact("founded", "Founded in 2017"),
      fact("traction", "The company has 120 employees"),
      fact("governance", "The company is privately held and venture-backed"),
    ];
    expect(projectCompanyEnrichmentSections(evidence)).not.toContain("firmographic");

    evidence.basicFacts[2].floorEligible = false;
    expect(projectCompanyEnrichmentSections(evidence)).toContain("firmographic");
  });
});
