import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier } from "./dossier";
import { emptyEvidence } from "./evidence";

describe("dossier evidence-ledger persistence", () => {
  it("freezes exact domain-bound company rows and all nested attribution", () => {
    const evidence = emptyEvidence("@fixture");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.website = "https://app.fixture.xyz";
    evidence.companyEnrichment = {
      name: "Fixture Labs",
      uuid: "company-fixture",
      identityMatch: "official_domain",
      requestedDomain: "app.fixture.xyz",
      matchedDomain: "fixture.xyz",
      matchMethod: "parent_or_subdomain",
      firmographic: {
        legalName: "Fixture Labs, Inc.",
        foundedYear: "2022",
        headcountRange: "11-50",
        ownership: "Private",
      },
      funding: {
        totalRaisedUsd: 15_000_000,
        leadInvestors: ["Lead Capital"],
        rounds: [{
          date: "2025-03-04",
          round: "Series A",
          amountUsd: 15_000_000,
          leadInvestors: ["Lead Capital"],
          otherInvestors: ["Other Ventures"],
        }],
      },
      management: [{
        name: "Ada Example",
        title: "Chief Executive Officer",
        priorCompanies: ["Prior Co"],
        linkedin: "https://www.linkedin.com/in/ada-example",
        startYear: "2022",
      }],
      sourceUrl: "https://fixture.xyz",
      capturedAt: "2026-08-06T12:00:00.000Z",
    };

    const dossier = assembleDossier(evidence, true);

    expect(dossier.companyEnrichment).toEqual(evidence.companyEnrichment);
    evidence.companyEnrichment.funding?.rounds[0].leadInvestors.push("Later mutation");
    evidence.companyEnrichment.funding?.rounds[0].otherInvestors.push("Later mutation");
    evidence.companyEnrichment.funding?.leadInvestors.push("Later mutation");
    evidence.companyEnrichment.management?.[0].priorCompanies.push("Later mutation");
    if (evidence.companyEnrichment.firmographic) {
      evidence.companyEnrichment.firmographic.legalName = "Changed later";
    }

    expect(dossier.companyEnrichment?.funding?.rounds[0].leadInvestors).toEqual(["Lead Capital"]);
    expect(dossier.companyEnrichment?.funding?.rounds[0].otherInvestors).toEqual(["Other Ventures"]);
    expect(dossier.companyEnrichment?.funding?.leadInvestors).toEqual(["Lead Capital"]);
    expect(dossier.companyEnrichment?.management?.[0].priorCompanies).toEqual(["Prior Co"]);
    expect(dossier.companyEnrichment?.firmographic?.legalName).toBe("Fixture Labs, Inc.");
  });

  it("freezes incident rows, domain registration, and the exact latest-post time", () => {
    const evidence = emptyEvidence("@fixture");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.last_post_at = "2026-08-05T08:30:00.000Z";
    evidence.domainRegistration = {
      domain: "fixture.xyz",
      hostname: "app.fixture.xyz",
      registeredAt: "2022-01-02T00:00:00.000Z",
      ageMonths: 55,
      source: "https://rdap.example/fixture.xyz",
      capturedAt: "2026-08-06T12:00:00.000Z",
    };
    evidence.protocolTvl = {
      slug: "fixture",
      name: "Fixture",
      symbol: "FIX",
      tvlUsd: 10_000_000,
      chains: ["Ethereum"],
      chainBreakdown: [{ chain: "Ethereum", tvlUsd: 10_000_000 }],
      geckoId: "fixture",
      governanceIds: ["snapshot:fixture.eth"],
      trend: [{ date: "2026-08-01", tvlUsd: 9_000_000 }],
      hacks: [{
        date: "2024-02-01",
        amountUsd: 1_500_000,
        returnedFunds: true,
        returnedAmountUsd: 500_000,
        classification: "Protocol Logic",
        technique: "Oracle manipulation",
      }],
      sourceUrl: "https://defillama.com/protocol/fixture",
      capturedAt: "2026-08-06T12:00:00.000Z",
    };
    evidence.protocolFunding = {
      slug: "fixture",
      name: "Fixture",
      geckoId: "fixture",
      rounds: [{
        date: "2025-01-01",
        round: "Seed",
        amountUsd: 1_000_000,
        leadInvestors: ["Lead One"],
        otherInvestors: ["Other One"],
        valuationUsd: null,
      }],
      totalRaisedUsd: 1_000_000,
      leadInvestors: ["Lead One"],
      sourceUrl: "https://defillama.com/protocol/fixture",
      capturedAt: "2026-08-06T12:00:00.000Z",
    };

    const dossier = assembleDossier(evidence, true);

    expect(dossier.last_post_at).toBe("2026-08-05T08:30:00.000Z");
    expect(dossier.domainRegistration).toEqual(evidence.domainRegistration);
    expect(dossier.protocolTvl?.hacks).toEqual(evidence.protocolTvl.hacks);
    evidence.domainRegistration.domain = "mutated.xyz";
    if (evidence.protocolTvl.hacks?.[0]) {
      evidence.protocolTvl.hacks[0].classification = "Changed later";
    }
    evidence.protocolTvl.governanceIds?.push("later");
    evidence.protocolTvl.trend?.push({ date: "2026-08-02", tvlUsd: 11_000_000 });
    evidence.protocolFunding.rounds[0].leadInvestors.push("Later lead");
    evidence.protocolFunding.rounds[0].otherInvestors.push("Later other");

    expect(dossier.domainRegistration?.domain).toBe("fixture.xyz");
    expect(dossier.protocolTvl?.hacks?.[0].classification).toBe("Protocol Logic");
    expect(dossier.protocolTvl?.governanceIds).toEqual(["snapshot:fixture.eth"]);
    expect(dossier.protocolTvl?.trend).toHaveLength(1);
    expect(dossier.protocolFunding?.rounds[0].leadInvestors).toEqual(["Lead One"]);
    expect(dossier.protocolFunding?.rounds[0].otherInvestors).toEqual(["Other One"]);
  });
});
