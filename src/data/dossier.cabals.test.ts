import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier } from "./dossier";
import { emptyEvidence } from "./evidence";
import { CABAL_MEMBERSHIP_FINDING, CABAL_REGISTRY_PROVIDER, cabalEvidenceForSubject } from "./cabals";

describe("cabal registry wiring into assembleDossier", () => {
  it("adds a benign ring's members as in_cabal_kb associates and no finding", () => {
    const evidence = emptyEvidence("@Altcoinist");
    evidence.roles = [SubjectClass.KOL];

    const dossier = assembleDossier(evidence, true);

    // Audit.addAssociate keys handles as lowercase "@handle".
    const keys = dossier.evidence.associates.map((x) => x.associate_key);
    expect(keys).toContain("@konstantinsebeo");
    expect(keys).toContain("@wrestler_galaxy");
    expect(keys).not.toContain("@altcoinist");
    for (const x of dossier.evidence.associates) {
      expect(x.in_cabal_kb).toBe(true);
      expect(x.provider).toBe(CABAL_REGISTRY_PROVIDER);
    }
    // The graph node carries the flag src/graph/network.ts reads.
    const node = dossier.graph.nodes.find((n) => n.key === "@konstantinsebeo") as { in_cabal_kb?: boolean } | undefined;
    expect(node?.in_cabal_kb).toBe(true);
    expect(dossier.evidence.associates.length).toBeGreaterThan(3);
    expect(cabalEvidenceForSubject("@Altcoinist").findings).toEqual([]);
  });

  it("adds a CabalMembership finding for a subject recorded in a nefarious cluster", () => {
    const evidence = emptyEvidence("@TradeOnPrism");
    evidence.roles = [SubjectClass.PROJECT];

    const { findings } = cabalEvidenceForSubject("@TradeOnPrism");
    expect(findings).toHaveLength(1);
    expect(findings[0].finding_type).toBe(CABAL_MEMBERSHIP_FINDING);
    expect(findings[0].polarity).toBe(-1);
    expect(findings[0].evidence_origin).toBe("human_verified");
    expect(findings[0].finding_scope.target_entity_key).toBe("@TradeOnPrism");

    const dossier = assembleDossier(evidence, true);
    expect(dossier.report.publishable_findings.some((f) => f.finding_type === CABAL_MEMBERSHIP_FINDING)).toBe(true);
  });

  it("does not overwrite a collected associate with the same handle", () => {
    const evidence = emptyEvidence("@Altcoinist");
    evidence.roles = [SubjectClass.KOL];
    evidence.associates.push({
      associate_handle: "@KonstantinSebeo",
      relation: "co-founder (collected from bio)",
      kind: "person",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "twitterapi",
    });

    const dossier = assembleDossier(evidence, true);
    const rows = dossier.evidence.associates.filter((x) => x.associate_key === "@konstantinsebeo");
    expect(rows).toHaveLength(1);
    expect(rows[0].relation).toBe("co-founder (collected from bio)");
    expect(rows[0].provider).toBe("twitterapi");
  });

  it("leaves a subject outside the registry untouched", () => {
    const evidence = emptyEvidence("@someone_else");
    evidence.roles = [SubjectClass.FOUNDER];
    const dossier = assembleDossier(evidence, true);
    expect(dossier.evidence.associates).toEqual([]);
    expect(dossier.report.publishable_findings.some((f) => f.finding_type === CABAL_MEMBERSHIP_FINDING)).toBe(false);
  });
});
