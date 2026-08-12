import { describe, expect, it } from "vitest";
import type { AxisEvidenceRecord } from "../data/evidence";
import type { RoleReport } from "../engine";
import { buildDecisionBasis } from "./decisionBasis";

const hashFor = (value: string): string => Array.from(value)
  .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
  .join("")
  .padEnd(64, "0")
  .slice(0, 64);

const artifact = (
  artifactId: string,
  axis: string,
  overrides: Partial<AxisEvidenceRecord> = {},
): AxisEvidenceRecord => ({
  artifactId: `art_v1_${hashFor(artifactId)}`,
  kind: "axis_evidence",
  provider: "github",
  operation: "profile-resolution",
  section: "code-footprint",
  title: `Evidence ${artifactId}`,
  excerpt: "Frozen evidence excerpt.",
  sourceUrl: `https://example.com/${artifactId}`,
  capturedAt: "2026-07-11T15:00:00.000Z",
  contentHash: hashFor(artifactId),
  eligibleAxes: [axis],
  verification: "verified",
  scope: "direct_subject",
  ...overrides,
});

const report = (axes: RoleReport["axes"]): RoleReport => ({
  role: "FOUNDER",
  verdict: "PASS",
  raw_total: 80,
  score_total: 80,
  cap_applied: null,
  dox_bonus: 0,
  axes,
});

describe("buildDecisionBasis", () => {
  it("grounds an axis only from explicit eligible support citations", () => {
    const support = artifact("support-1", "F2_track_record");
    const model = buildDecisionBasis(report({
      F2_track_record: {
        score: 24,
        weight: 28,
        role: "FOUNDER",
        rationale: "Strong record.",
        evidenceRefs: [support.artifactId],
        counterEvidenceRefs: [],
        gaps: [],
      },
    }), [support], 1);

    expect(model).toMatchObject({ available: true, evidenceBacked: 1, grounded: 1, partial: 0, contested: 0, gaps: 0 });
    expect(model.rows[0]).toMatchObject({
      axis: "F2_track_record",
      status: "grounded",
      support: [{ artifactId: support.artifactId }],
      counter: [],
      gaps: [],
    });
  });

  it("separates contested evidence, partial support, and explicit sanitized gaps", () => {
    const support = artifact("support-1", "F2_track_record");
    const counter = artifact("counter-1", "F2_track_record", { verification: "reported" });
    const model = buildDecisionBasis(report({
      F2_track_record: {
        score: 16,
        weight: 28,
        role: "FOUNDER",
        rationale: "Mixed record.",
        evidenceRefs: [support.artifactId],
        counterEvidenceRefs: [counter.artifactId],
        gaps: ["  Exit   outcome remains unresolved.  ", "Exit outcome remains unresolved.", ""],
      },
      F4_build_substance: {
        score: 0,
        weight: 15,
        role: "FOUNDER",
        rationale: "No evidence.",
        evidenceRefs: [],
        counterEvidenceRefs: [],
        gaps: ["Repository ownership was not resolved."],
      },
      F5_governance_controls: {
        score: 8,
        weight: 12,
        role: "FOUNDER",
        rationale: "Support exists, but a gap remains.",
        evidenceRefs: [artifact("support-2", "F5_governance_controls").artifactId],
        counterEvidenceRefs: [],
        gaps: ["Control rights remain unresolved."],
      },
    }), [support, counter, artifact("support-2", "F5_governance_controls")], 1);

    expect(model).toMatchObject({ evidenceBacked: 2, grounded: 0, partial: 1, contested: 1, gaps: 1 });
    expect(model.rows[0]).toMatchObject({
      status: "contested",
      support: [{ artifactId: support.artifactId }],
      counter: [{ artifactId: counter.artifactId }],
      gaps: ["Exit outcome remains unresolved."],
    });
    expect(model.rows[1]).toMatchObject({ status: "gap", gaps: ["Repository ownership was not resolved."] });
    expect(model.rows[2]).toMatchObject({ status: "partial", gaps: ["Control rights remain unresolved."] });
  });

  it("excludes unsafe citations while preserving unavailable artifacts as explicit gaps", () => {
    const wrongAxis = artifact("wrong-axis", "F1_identity_verifiability");
    const malformed = artifact("malformed", "F2_track_record", { contentHash: "not-a-hash" });
    const unavailable = artifact("unavailable", "F2_track_record", { verification: "unavailable" });
    const duplicateA = artifact("duplicate", "F2_track_record");
    const duplicateB = artifact("duplicate", "F2_track_record", { title: "Conflicting duplicate" });
    const model = buildDecisionBasis(report({
      F2_track_record: {
        score: 12,
        weight: 28,
        role: "FOUNDER",
        rationale: "Unsupported score.",
        evidenceRefs: ["missing", wrongAxis.artifactId, malformed.artifactId, unavailable.artifactId, duplicateA.artifactId],
        counterEvidenceRefs: [],
        gaps: ["No qualifying artifact remains."],
      },
    }), [wrongAxis, malformed, unavailable, duplicateA, duplicateB], 1);

    expect(model.rows[0]).toMatchObject({
      status: "gap",
      support: [],
      counter: [],
      gapArtifacts: [{ artifactId: unavailable.artifactId }],
      gaps: ["No qualifying artifact remains."],
    });
  });

  it("does not turn a completed clear screen into a gap or open question", () => {
    const support = artifact("support-1", "F5_reputation_integrity");
    const clearScreen = artifact("ofac-clear", "F5_reputation_integrity", {
      provider: "opensanctions",
      operation: "ofac-sanctions-name",
      title: "OFAC sanctions name screen found no exact match",
      verification: "checked_empty",
    });
    const model = buildDecisionBasis(report({
      F5_reputation_integrity: {
        score: 18,
        weight: 20,
        role: "FOUNDER",
        rationale: "No verified adverse conduct was found.",
        evidenceRefs: [support.artifactId, clearScreen.artifactId],
        counterEvidenceRefs: [],
        gaps: [],
      },
    }), [support, clearScreen], 1);

    expect(model.rows[0]).toMatchObject({
      status: "grounded",
      support: [{ artifactId: support.artifactId }],
      counter: [],
      gapArtifacts: [],
      gaps: [],
    });
  });

  it("never infers lineage for legacy or unsupported versions", () => {
    const support = artifact("support-1", "F2_track_record");
    const role = report({
      F2_track_record: {
        score: 24,
        weight: 28,
        role: "FOUNDER",
        rationale: "Strong prose must not become lineage.",
        evidenceRefs: [support.artifactId],
      },
    });

    expect(buildDecisionBasis(role, [support], undefined)).toEqual(expect.objectContaining({ available: false, rows: [] }));
    expect(buildDecisionBasis(role, [support], 2)).toEqual(expect.objectContaining({ available: false, rows: [] }));
    expect(buildDecisionBasis(undefined, [support], 1)).toEqual(expect.objectContaining({ available: false, rows: [] }));
  });
});
