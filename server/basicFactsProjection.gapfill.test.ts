import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
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
    expect(funding?.value).toContain("2 public funding rounds");
    expect(funding?.value).toContain("Blockchain Capital");
    expect(funding?.sources[0]?.url).toContain("defillama.com/protocol/aave");
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
    expect(funding?.value).toContain("$49M");
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
