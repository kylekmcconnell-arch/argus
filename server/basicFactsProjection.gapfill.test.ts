import { describe, expect, it } from "vitest";
import { SubjectClass, VentureOutcome } from "../src/engine";
import { emptyEvidence } from "../src/data/evidence";
import { projectProviderBackedBasicFacts } from "./basicFactsProjection";

// Wiring the diligence gap-fillers into the projection: funding → P4_backing_and_partners,
// TVL → P5 traction, Monid/Akta management → founder identity. Additive, PROJECT-only.
describe("projectProviderBackedBasicFacts: diligence gap-fillers", () => {
  const projectEvidence = () => {
    const evidence = emptyEvidence("@aavetest");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = { ...evidence.profile, display_name: "Aave" };
    return evidence;
  };

  it("mints a funding fact (→P4) from DeFiLlama funding rounds", () => {
    const evidence = projectEvidence();
    evidence.protocolFunding = {
      slug: "aave",
      name: "Aave",
      rounds: [
        { date: "2020-10-12", round: "Strategic", amountUsd: 25_000_000, leadInvestors: ["Blockchain Capital", "Standard Crypto"], otherInvestors: [], valuationUsd: null },
        { date: "2017-11-30", round: "ICO", amountUsd: 16_200_000, leadInvestors: [], otherInvestors: [], valuationUsd: null },
      ],
      totalRaisedUsd: 41_200_000,
      leadInvestors: ["Blockchain Capital", "Standard Crypto"],
      sourceUrl: "https://defillama.com/protocol/aave",
      capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    const funding = evidence.basicFacts?.find((fact) => fact.predicate === "funding");
    expect(funding).toBeTruthy();
    expect(funding?.value).toContain("2 funding rounds indexed");
    expect(funding?.value).toContain("Blockchain Capital");
    expect(funding?.sources[0]?.url).toContain("defillama.com/protocol/aave");
    expect(funding?.floorEligible).toBe(false);
  });

  it("mints a traction fact (→P5) from on-chain TVL", () => {
    const evidence = projectEvidence();
    evidence.protocolTvl = {
      slug: "aave",
      name: "Aave",
      symbol: "AAVE",
      tvlUsd: 14_000_000_000,
      chains: ["Ethereum", "Arbitrum", "Base"],
      chainBreakdown: [{ chain: "Ethereum", tvlUsd: 12_000_000_000 }],
      geckoId: "aave",
      sourceUrl: "https://defillama.com/protocol/aave",
      capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    const traction = evidence.basicFacts?.find((fact) => fact.predicate === "traction");
    expect(traction).toBeTruthy();
    expect(traction?.value).toContain("total value locked");
  });

  it("falls back to Monid/Akta for funding + mints the founder from the management record", () => {
    const evidence = projectEvidence();
    evidence.companyEnrichment = {
      name: "Aave",
      uuid: "00005d7",
      funding: {
        totalRaisedUsd: 49_000_000,
        rounds: [{ date: "2020-10-12", round: "Strategic", amountUsd: 25_000_000, leadInvestors: ["Blockchain Capital"], otherInvestors: [] }],
        leadInvestors: ["Blockchain Capital"],
      },
      management: [{ name: "Stani Kulechov", title: "CEO and Founder", priorCompanies: ["ETHLend"], linkedin: "https://www.linkedin.com/in/stani-kulechov", startYear: "2017" }],
      firmographic: { legalName: "Aave Labs", foundedYear: "2020", headcountRange: "101-250", ownership: "Venture Growth Investor Backed" },
      sourceUrl: "https://akta.pro/company/00005d7",
      capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    const founder = evidence.basicFacts?.find((fact) => fact.predicate === "founder" && fact.value === "Stani Kulechov");
    expect(founder).toBeTruthy();
    const funding = evidence.basicFacts?.find((fact) => fact.predicate === "funding");
    expect(funding?.value).toContain("$49.0M");
  });

  it("mints a venture-scoped funding fact for a FOUNDER from the company record", () => {
    const evidence = emptyEvidence("@stanitest");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = { ...evidence.profile, display_name: "Stani" };
    evidence.companyEnrichment = {
      name: "Aave",
      uuid: "00005d7",
      funding: {
        totalRaisedUsd: 49_000_000,
        rounds: [{ date: "2020-10-12", round: "Strategic", amountUsd: 25_000_000, leadInvestors: ["Blockchain Capital"], otherInvestors: [] }],
        leadInvestors: ["Blockchain Capital"],
      },
      sourceUrl: "https://akta.pro/company/00005d7",
      capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    const funding = evidence.basicFacts?.find((fact) => fact.predicate === "funding");
    expect(funding).toBeTruthy();
    // Venture-scoped: the value names the company so the person is never
    // presented as having raised the money themselves.
    expect(funding?.value.startsWith("Aave: ")).toBe(true);
    expect(funding?.qualifier).toBe("venture financing");
    expect(funding?.value).toContain("$49.0M disclosed");
    expect(funding?.floorEligible).toBe(false);
  });

  it("does not add an aggregator summary beside stronger funding evidence", () => {
    const evidence = projectEvidence();
    evidence.basicFacts = [{
      factId: "funding-series-b",
      subjectKey: "@aavetest",
      predicate: "funding",
      value: "Series B",
      normalizedValue: "series b",
      status: "corroborated",
      critical: false,
      provider: "public-web",
      evidence_origin: "deterministic",
      artifact_verified: true,
      sources: [{
        url: "https://news.example/aave-series-b",
        title: "Aave Series B",
        excerpt: "Aave raised $25M in a Series B.",
        provider: "public-web",
        relation: "supports",
        capturedAt: "2026-07-14T00:00:00.000Z",
        contentHash: "funding-series-b-source",
        sourceClass: "independent_press",
        artifactVerified: true,
      }],
    }];
    evidence.protocolFunding = {
      slug: "aave",
      name: "Aave",
      rounds: [{ date: null, round: "Seed", amountUsd: 1_000_000, leadInvestors: [], otherInvestors: [], valuationUsd: null }],
      totalRaisedUsd: 1_000_000,
      leadInvestors: [],
      sourceUrl: "https://defillama.com/protocol/aave",
      capturedAt: "2026-07-14T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts?.filter((fact) => fact.predicate === "funding")).toHaveLength(1);
    expect(evidence.basicFacts?.[0].value).toBe("Series B");
  });

  it("mints nothing for a non-project subject", () => {
    const evidence = emptyEvidence("@person");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.protocolFunding = {
      slug: "x", name: "X", rounds: [{ date: null, round: "Seed", amountUsd: 1, leadInvestors: [], otherInvestors: [], valuationUsd: null }],
      totalRaisedUsd: 1, leadInvestors: [], sourceUrl: "https://defillama.com/protocol/x", capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "funding")).toBeFalsy();
  });
});

describe("projectProviderBackedBasicFacts: independent audits (corroboration hop)", () => {
  const projectEvidence = () => {
    const evidence = emptyEvidence("@aavetest");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = { ...evidence.profile, display_name: "Aave" };
    return evidence;
  };

  it("mints verified audit facts only for auditor-domain corroborated entries", () => {
    const evidence = projectEvidence();
    evidence.securityAudits = {
      securityPageUrl: "https://aave.com/security",
      selfAttested: ["Trail of Bits", "OpenZeppelin", "CertiK"],
      corroborated: [
        { auditor: "Trail of Bits", auditorUrl: "https://www.trailofbits.com/publications/aave-v3", excerpt: "Our security review of the Aave protocol v3." },
      ],
      capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    const auditFacts = evidence.basicFacts?.filter((fact) => fact.predicate === "audit") ?? [];
    expect(auditFacts).toHaveLength(1);
    expect(auditFacts[0].value).toContain("Trail of Bits");
    expect(auditFacts[0].status).toBe("verified");
    expect(auditFacts[0].sources[0]).toMatchObject({ sourceClass: "official_counterparty" });
    expect(auditFacts[0].sources[0].url).toContain("trailofbits.com");
    const lead = evidence.basicFactLeads?.find((candidate) => candidate.predicate === "audit");
    expect(lead).toBeTruthy();
    expect(lead?.value).toContain("OpenZeppelin");
    expect(lead?.value).not.toContain("Trail of Bits");
    expect(lead?.artifact_verified).toBe(false);
  });

  it("a purely self-attested security page mints NO audit fact, only a lead", () => {
    const evidence = projectEvidence();
    evidence.securityAudits = {
      securityPageUrl: "https://rugcoin.example/security",
      selfAttested: ["Trail of Bits"],
      corroborated: [],
      capturedAt: "2026-07-14T00:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "audit")).toBe(false);
    const lead = evidence.basicFactLeads?.find((candidate) => candidate.predicate === "audit");
    expect(lead?.value).toContain("Trail of Bits");
    expect(lead?.evidence_origin).toBe("deterministic_bootstrap");
  });
});

describe("corroborateVenturesAgainstFirstPartySources", () => {
  const ventureRow = (name: string) => ({
    project_name: name,
    role: "product",
    period: "2022-present",
    outcome: VentureOutcome.ACTIVE,
    evidence_origin: "model_lead" as const,
    artifact_verified: false,
  });

  it("verifies a claim-extracted venture when a first-party source names it", () => {
    const evidence = emptyEvidence("@aavetest");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = { ...evidence.profile, display_name: "Aave" };
    evidence.ventures = [ventureRow("GHO"), ventureRow("Aave Horizon"), ventureRow("Nonexistent Thing")];
    evidence.basicFacts = [{
      predicate: "product",
      value: "Aave App, Aave Kit, Aave Protocol",
      status: "verified",
      artifact_verified: true,
      sources: [{
        url: "https://aave.com/",
        sourceClass: "official_subject",
        relation: "supports",
        excerpt: "Aave offers the GHO stablecoin and Aave Horizon for institutions.",
        contentHash: "a".repeat(64),
        capturedAt: "2026-07-15T00:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
    } as never];
    projectProviderBackedBasicFacts(evidence);
    const byName = Object.fromEntries(evidence.ventures.map((venture) => [venture.project_name, venture]));
    expect(byName.GHO.artifact_verified).toBe(true);
    expect(byName.GHO.evidence_url).toContain("aave.com");
    expect(byName["Aave Horizon"].artifact_verified).toBe(true);
    expect(byName["Nonexistent Thing"].artifact_verified).toBe(false);
    // Discovery provenance is preserved: verification never rewrites origin.
    expect(byName.GHO.evidence_origin).toBe("model_lead");
  });

  it("press or other-public mentions never corroborate a venture claim", () => {
    const evidence = emptyEvidence("@aavetest");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.ventures = [ventureRow("GHO")];
    evidence.basicFacts = [{
      predicate: "product",
      value: "GHO coverage",
      status: "verified",
      artifact_verified: true,
      sources: [{
        url: "https://news.example/gho",
        sourceClass: "independent_press",
        relation: "supports",
        excerpt: "The GHO stablecoin grew this quarter.",
        contentHash: "b".repeat(64),
        capturedAt: "2026-07-15T00:00:00.000Z",
        provider: "google-news",
        artifactVerified: true,
      }],
    } as never];
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.ventures[0].artifact_verified).toBe(false);
  });
});
