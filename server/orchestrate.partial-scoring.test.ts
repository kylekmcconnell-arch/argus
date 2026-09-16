import { describe, expect, it } from "vitest";
import type { AxisEvidenceRecord, ProjectStrengthBandRecord } from "../src/data/evidence";
import { partialScoringHeadline, reconcileScoredPacketLineage } from "./orchestrate";

const artifact = (seed: string, eligibleAxes: string[]): AxisEvidenceRecord => {
  const contentHash = seed.repeat(64).slice(0, 64);
  return {
    artifactId: `art_v1_${contentHash}`,
    kind: "axis_evidence",
    provider: "test",
    operation: "test:op",
    section: "basicFacts",
    title: `artifact ${seed}`,
    contentHash,
    eligibleAxes,
    verification: "verified",
    scope: "direct_subject",
  };
};

const band = (tier: ProjectStrengthBandRecord["tier"], anchor: string): ProjectStrengthBandRecord => ({
  tier,
  minScore: 0,
  maxScore: tier === "none" ? 0 : 10,
  reasons: tier === "none" ? [] : [`${tier} control`],
  anchorArtifactIds: tier === "none" ? [] : [anchor],
});

// E4 (2026-09-14 deep-dive): the engine publishes a provisional governing
// score on the same immutable version, so the headline must not claim that
// ARGUS produced no overall score.
describe("partial scoring headline", () => {
  const requestedAxes = [
    { axis: "P1_team_and_identity", weight: 16 },
    { axis: "P2_product_substance", weight: 24 },
    { axis: "P3_token_conduct", weight: 20 },
    { axis: "P4_backing_and_partners", weight: 14 },
    { axis: "P5_traction_and_liveness", weight: 14 },
    { axis: "P6_transparency_integrity", weight: 12 },
  ];

  it("states the provisional score, the assessed share, and keeps the analyst headline second", () => {
    const headline = partialScoringHeadline({
      scoredAxes: requestedAxes.filter(({ axis }) => axis !== "P2_product_substance" && axis !== "P4_backing_and_partners"),
      requestedAxes,
      missingAxes: ["P2_product_substance", "P4_backing_and_partners"],
      analystHeadline: "A named team operates a live token with verified disclosures.",
    });
    expect(headline).toMatch(/^Provisional assessment: ARGUS scored 4 of 6 decision areas \(62% of the methodology weight\)\./);
    expect(headline).toContain("Product and execution and Backers and partnerships remain unmeasured, so the score is provisional and may change when those areas are assessed.");
    expect(headline).toMatch(/A named team operates a live token with verified disclosures\.$/);
    expect(headline).not.toMatch(/did not produce an overall score/);
  });

  it("lists three or more unmeasured areas as a comma list", () => {
    const headline = partialScoringHeadline({
      scoredAxes: requestedAxes.slice(0, 3),
      requestedAxes,
      missingAxes: requestedAxes.slice(3).map(({ axis }) => axis),
    });
    expect(headline).toContain("Backers and partnerships, Traction and usage and Transparency and integrity remain unmeasured");
  });

  it("uses singular copy for one unmeasured area and tolerates a missing analyst headline", () => {
    const headline = partialScoringHeadline({
      scoredAxes: requestedAxes.slice(0, 5),
      requestedAxes,
      missingAxes: ["P6_transparency_integrity"],
    });
    expect(headline).toContain("5 of 6 decision areas (88% of the methodology weight)");
    expect(headline).toContain("remains unmeasured, so the score is provisional and may change when that area is assessed.");
    expect(headline.trim().endsWith("assessed.")).toBe(true);
  });
});

// E5 (2026-09-14 deep-dive): the persisted catalog and bands must describe
// the packet the analyst actually scored, not the full packet it never saw.
describe("scored packet lineage", () => {
  const shared = artifact("a", ["P1_team_and_identity", "P2_product_substance"]);
  const prunedFromFull = artifact("b", ["P1_team_and_identity"]);
  const fullOnly = artifact("c", ["P2_product_substance"]);

  it("returns the full packet lineage untouched when every axis was scored", () => {
    const result = reconcileScoredPacketLineage({
      partialAxisScoring: false,
      fullCatalog: [shared, fullOnly],
      fullBands: { P1_team_and_identity: band("solid", shared.artifactId) },
      scoredCatalog: [shared, fullOnly],
      scoredBands: { P1_team_and_identity: band("solid", shared.artifactId) },
    });
    expect(result.catalog.map((row) => row.artifactId)).toEqual([shared.artifactId, fullOnly.artifactId]);
    expect(result.bands.P1_team_and_identity.tier).toBe("solid");
  });

  it("keeps subset-only artifacts and prefers the scored packet's bands for scored axes", () => {
    const result = reconcileScoredPacketLineage({
      partialAxisScoring: true,
      fullCatalog: [shared, fullOnly],
      fullBands: {
        P1_team_and_identity: band("emerging", shared.artifactId),
        P2_product_substance: band("none", ""),
      },
      scoredCatalog: [shared, prunedFromFull],
      scoredBands: { P1_team_and_identity: band("solid", prunedFromFull.artifactId) },
    });
    // The artifact the analyst cited (retained only in the subset packet) is
    // persisted, and the full packet's remaining artifacts are kept.
    expect(result.catalog.map((row) => row.artifactId)).toEqual([
      shared.artifactId, fullOnly.artifactId, prunedFromFull.artifactId,
    ]);
    // The scored axis carries the band the validator actually enforced; the
    // unmeasured axis keeps the full packet's band so the set stays canonical.
    expect(result.bands.P1_team_and_identity).toMatchObject({ tier: "solid", anchorArtifactIds: [prunedFromFull.artifactId] });
    expect(result.bands.P2_product_substance.tier).toBe("none");
  });
});
