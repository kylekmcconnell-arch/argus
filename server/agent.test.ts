import { describe, expect, it } from "vitest";
import {
  ANALYST_EVIDENCE_MAX_CHARS,
  buildAnalystEvidencePacket,
  validateAnalystVerdict,
  type AnalystAxis,
} from "./agent";

const catalog: AnalystAxis[] = [
  { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
  { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
];

describe("analyst verdict integrity", () => {
  it("accepts exactly one finite, in-range score per requested axis", () => {
    const result = validateAnalystVerdict({
      axes: [
        { axis: "F2_track_record", score: 20, rationale: "documented history" },
        { axis: "F1_identity_verifiability", score: 10, rationale: "named identity" },
      ],
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog);

    expect(result?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
    expect(result?.axes.map((axis) => axis.score)).toEqual([10, 20]);
  });

  it.each([
    {
      label: "missing axis",
      axes: [{ axis: "F1_identity_verifiability", score: 10, rationale: "ok" }],
    },
    {
      label: "duplicate axis",
      axes: [
        { axis: "F1_identity_verifiability", score: 10, rationale: "first" },
        { axis: "F1_identity_verifiability", score: 11, rationale: "duplicate" },
      ],
    },
    {
      label: "unknown axis",
      axes: [
        { axis: "F1_identity_verifiability", score: 10, rationale: "ok" },
        { axis: "MADE_UP", score: 1, rationale: "not requested" },
      ],
    },
    {
      label: "non-finite score",
      axes: [
        { axis: "F1_identity_verifiability", score: Number.NaN, rationale: "bad" },
        { axis: "F2_track_record", score: 20, rationale: "ok" },
      ],
    },
    {
      label: "out-of-range score",
      axes: [
        { axis: "F1_identity_verifiability", score: 13, rationale: "over max" },
        { axis: "F2_track_record", score: 20, rationale: "ok" },
      ],
    },
  ])("rejects a $label response", ({ axes }) => {
    expect(validateAnalystVerdict({ axes, headline: "bad", identity_note: "bad" }, catalog)).toBeNull();
  });

  it("builds bounded valid JSON without allowing long context to cut off findings", () => {
    const packet = buildAnalystEvidencePacket({
      profile: { handle: "@subject", bio: "b".repeat(20_000) },
      recentActivity: Array.from({ length: 100 }, (_, i) => `post ${i} ${"x".repeat(4_000)}`),
      ventures: Array.from({ length: 100 }, (_, i) => ({ project_name: `project-${i}`, notes: "v".repeat(4_000) })),
      testimonials: Array.from({ length: 100 }, (_, i) => ({ claimed_endorser_name: `person-${i}`, notes: "t".repeat(4_000) })),
      findings: [{
        finding_type: "DeterministicFinding",
        claim: "material finding survives",
        source_url: "https://example.com/artifact",
        verification_status: "Verified",
        independent_source_count: 1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    });

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    const parsed = JSON.parse(packet);
    expect(parsed.findings[0].claim).toBe("material finding survives");
    expect(parsed.findings[0].source_url).toBe("https://example.com/artifact");
    expect(parsed.coverage.recentActivity.available).toBe(100);
    expect(parsed.coverage.recentActivity.included).toBeLessThanOrEqual(12);
  });
});
