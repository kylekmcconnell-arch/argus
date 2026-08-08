import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier } from "./dossier";
import { emptyEvidence, type CollectedEvidence } from "./evidence";

function projectEvidence(): CollectedEvidence {
  const evidence = emptyEvidence("@argusprotocol");
  evidence.roles = [SubjectClass.PROJECT];
  evidence.profile.display_name = "Argus Protocol";
  evidence.projectToken = {
    verified: true,
    verification: "official_x",
    symbol: "ARG",
    name: "Argus",
    rank: null,
    chain: "ethereum",
    address: "0x0000000000000000000000000000000000000001",
    sourceUrl: "https://www.coingecko.com/en/coins/argus",
    capturedAt: "2026-08-01T10:00:00.000Z",
    marketCapUsd: 100_000_000,
    fdvUsd: 200_000_000,
    liquidityUsd: 12_000_000,
    circulatingSupply: 500_000_000,
    totalSupply: 1_000_000_000,
  } as CollectedEvidence["projectToken"];
  evidence.basicFacts = [{
    factId: "product-dex",
    subjectKey: "argusprotocol",
    predicate: "product",
    value: "A decentralized exchange protocol",
    normalizedValue: "a decentralized exchange protocol",
    status: "verified",
    critical: true,
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
    sources: [{
      url: "https://argus.example/docs/product",
      title: "Argus product documentation",
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: "Argus is a decentralized exchange protocol.",
      contentHash: "a".repeat(64),
      capturedAt: "2026-08-01T09:58:00.000Z",
      provider: "public-web",
      artifactVerified: true,
    }],
  }];
  return evidence;
}

describe("assembleDossier point in time intelligence", () => {
  it("freezes one deterministic, score-neutral decision snapshot into PROJECT reports", () => {
    const evidence = projectEvidence();
    const first = assembleDossier(evidence, true);
    const second = assembleDossier(evidence, true);

    expect(first.intelligence).toEqual(second.intelligence);
    expect(first.intelligence).toMatchObject({
      schemaVersion: 1,
      rulesetVersion: "argus-point-in-time-v1",
      mode: "point_in_time",
      scoringImpact: "none",
      subject: {
        archetypes: { state: "resolved", primary: "dex" },
      },
    });
    expect(first.intelligence?.lenses.map((lens) => lens.id)).toEqual([
      "investment",
      "alpha_research",
      "counterparty",
      "general_diligence",
    ]);

    evidence.projectToken!.marketCapUsd = 1;
    evidence.basicFacts![0].value = "Rewritten after persistence";
    expect(first.intelligence?.measurements.find((row) => row.id === "market_cap_usd"))
      .toMatchObject({ value: 100_000_000 });
    expect(first.intelligence?.subject.archetypes.primary).toBe("dex");
  });

  it("freezes a score-neutral entity snapshot for non-project report classes", () => {
    const evidence = emptyEvidence("@person");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile.identity_binding = "licensed_exact_social";

    const dossier = assembleDossier(evidence, true);
    expect(dossier.identity_binding).toBe("licensed_exact_social");
    expect(dossier.intelligence).toMatchObject({
      rulesetVersion: "argus-entity-point-in-time-v1",
      mode: "point_in_time",
      scoringImpact: "none",
      subject: { entityKind: "person" },
    });
  });
});
