import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  AXIS_SCORING_CONTRACT,
  persistProvenance,
  persistReportVersionBundle,
  prepareProvenanceRows,
} from "./_provenance";
import { getProfile, PROFILES, SubjectClass } from "../src/engine";
import type { AxisEvidenceRecord } from "../src/data/evidence";

const FOUNDER_WEIGHTS = getProfile(SubjectClass.FOUNDER).axes;
interface TestAxisScore {
  score: number;
  weight: number;
  rationale: string;
  role: string;
  evidenceRefs: string[];
  counterEvidenceRefs: string[];
  gaps: string[];
}
const founderAxes = (supportId: string): Record<string, TestAxisScore> => Object.fromEntries(
  Object.entries(FOUNDER_WEIGHTS).map(([axis, weight]) => [axis, {
    score: Math.floor(weight * 0.7),
    weight,
    rationale: `Verified evidence supports ${axis}.`,
    role: SubjectClass.FOUNDER,
    evidenceRefs: [supportId],
    counterEvidenceRefs: [],
    gaps: [],
  }]),
);

describe("API scoring contract", () => {
  it("keeps the provenance function inside the serverless API module boundary", () => {
    const provenanceSource = readFileSync(new URL("./_provenance.ts", import.meta.url), "utf8");

    expect(provenanceSource).not.toMatch(
      /(?:from\s*|import\s*\()\s*["']\.\.\/src(?:\/|["'])/,
    );
  });

  it("stays synchronized with the canonical engine profiles", () => {
    const engineContract = Object.fromEntries(
      Object.entries(PROFILES).map(([role, profile]) => [role, profile.axes]),
    );

    expect(AXIS_SCORING_CONTRACT).toEqual(engineContract);
  });
});

describe("frozen source artifact provenance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists strict catalog evidence and checks before ordered axis links", async () => {
    const supportId = `art_v1_${"a".repeat(64)}`;
    const counterId = `art_v1_${"b".repeat(64)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [
          {
            artifactId: supportId,
            contentHash: "a".repeat(64),
            kind: "axis_evidence",
            provider: "github",
            operation: "account-resolution",
            section: "identity",
            title: "GitHub account links to the audited X handle",
            excerpt: "twitter_username matched the audited handle",
            sourceUrl: "https://github.com/alice",
            capturedAt: "2026-07-11T07:00:00-05:00",
            eligibleAxes: Object.keys(FOUNDER_WEIGHTS),
            verification: "verified",
            scope: "direct_subject",
          },
          {
            artifactId: counterId,
            contentHash: "b".repeat(64),
            kind: "axis_evidence",
            provider: "google-news",
            operation: "exact-name-search",
            section: "reputation",
            title: "One adverse exact-name result",
            eligibleAxes: ["F1_identity_verifiability"],
            verification: "verified",
            counterEligibleAxes: ["F1_identity_verifiability"],
            scope: "direct_subject",
          },
        ],
        report: {
          composite_verdict: "PASS",
          governing_score: 81,
          roles: ["FOUNDER"],
          role_reports: [{
            role: "FOUNDER",
            axes: {
              ...founderAxes(supportId),
              F1_identity_verifiability: {
                ...founderAxes(supportId).F1_identity_verifiability,
                score: 9,
                counterEvidenceRefs: [counterId],
                gaps: ["No government registry artifact was collected."],
              },
            },
          }],
        },
      },
      [{
        checkId: "identity-resolution",
        label: "Identity resolution",
        status: "confirmed",
        decisionCritical: true,
        provider: "github",
        sourceCount: 1,
      }],
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/evidence_items?");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/check_runs?");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/report_axis_evidence?");

    const evidenceRows = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(evidenceRows).toHaveLength(2);
    expect(evidenceRows[0]).toMatchObject({
      evidence_key: supportId,
      provider: "github",
      source_type: "identity",
      content_hash: "a".repeat(64),
      captured_at: "2026-07-11T12:00:00.000Z",
      metadata: {
        strictLineage: true,
        axisCitationVersion: 1,
        operation: "account-resolution",
        eligibleAxes: Object.keys(FOUNDER_WEIGHTS),
        verification: "verified",
        scope: "direct_subject",
        catalogArtifact: {
          artifactId: supportId,
          kind: "axis_evidence",
          provider: "github",
          operation: "account-resolution",
          section: "identity",
          title: "GitHub account links to the audited X handle",
          excerpt: "twitter_username matched the audited handle",
          sourceUrl: "https://github.com/alice",
          capturedAt: "2026-07-11T12:00:00.000Z",
          contentHash: "a".repeat(64),
          eligibleAxes: Object.keys(FOUNDER_WEIGHTS),
          verification: "verified",
          scope: "direct_subject",
        },
      },
    });
    expect(evidenceRows[1].captured_at).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(evidenceRows[1].captured_at))).toBe(false);
    expect(evidenceRows[1].metadata).toMatchObject({
      counterEligibleAxes: ["F1_identity_verifiability"],
      catalogArtifact: {
        counterEligibleAxes: ["F1_identity_verifiability"],
      },
    });
    expect(Object.keys(evidenceRows[1]).sort()).toEqual(Object.keys(evidenceRows[0]).sort());

    const checkRows = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(checkRows).toHaveLength(1);
    expect(checkRows[0]).toMatchObject({
      check_id: "identity-resolution",
      metadata: { decisionCritical: true },
    });

    const axisRows = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    expect(axisRows).toHaveLength(7);
    expect(axisRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "FOUNDER",
        axis_id: "F1_identity_verifiability",
        artifact_id: supportId,
        relation: "support",
        ordinal: 0,
      }),
      expect.objectContaining({
        role: "FOUNDER",
        axis_id: "F1_identity_verifiability",
        artifact_id: counterId,
        relation: "counter",
        ordinal: 0,
      }),
    ]));
  });

  it.each([
    {
      label: "a scalar counterEligibleAxes value",
      counterEligibleAxes: "F1_identity_verifiability",
      verification: "verified",
    },
    {
      label: "an empty counterEligibleAxes array",
      counterEligibleAxes: [],
      verification: "verified",
    },
    {
      label: "duplicate counterEligibleAxes",
      counterEligibleAxes: ["F1_identity_verifiability", "F1_identity_verifiability"],
      verification: "verified",
    },
    {
      label: "a counter axis outside eligibleAxes",
      counterEligibleAxes: ["P1_team_and_identity"],
      verification: "verified",
    },
    {
      label: "counter eligibility on non-verified evidence",
      counterEligibleAxes: ["F1_identity_verifiability"],
      verification: "reported",
    },
  ])("rejects $label before any provenance write", async ({ counterEligibleAxes, verification }) => {
    const artifactId = `art_v1_${"a".repeat(64)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "test-provider",
          operation: "counter-contract-test",
          section: "findings",
          title: "Counter-evidence contract candidate",
          eligibleAxes: Object.keys(FOUNDER_WEIGHTS),
          verification,
          counterEligibleAxes,
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "PASS",
          governing_score: 75,
          roles: [SubjectClass.FOUNDER],
          role_reports: [{ role: SubjectClass.FOUNDER, axes: founderAxes(artifactId) }],
        },
      },
      [],
    )).rejects.toThrow(/counterEligibleAxes|counter eligibility/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires and re-enforces frozen PROJECT strength bands at persistence", async () => {
    const weights = getProfile(SubjectClass.PROJECT).axes;
    const artifacts: AxisEvidenceRecord[] = Object.keys(weights).map((axis, index) => {
      const contentHash = (index + 1).toString(16).repeat(64);
      return {
        artifactId: `art_v1_${contentHash}`,
        contentHash,
        kind: "axis_evidence",
        provider: "project-control",
        operation: "verified-project-anchor",
        section: "basicFacts",
        title: `Verified anchor for ${axis}`,
        eligibleAxes: [axis],
        verification: "verified",
        scope: "direct_subject",
      };
    });
    const projectStrengthBands = Object.fromEntries(Object.entries(weights).map(([axis, weight], index) => [axis, {
      tier: "emerging",
      minScore: Math.ceil(weight * 0.4),
      maxScore: Math.floor(weight * 0.69),
      reasons: [`Source-backed emerging evidence for ${axis}`],
      anchorArtifactIds: [artifacts[index].artifactId],
    }]));
    const payload = {
      axisCitationVersion: 1,
      axisEvidenceCatalog: artifacts,
      projectStrengthBands,
      report: {
        composite_verdict: "CAUTION",
        governing_score: 42,
        roles: ["PROJECT"],
        role_reports: [{
          role: "PROJECT",
          axes: Object.fromEntries(Object.entries(weights).map(([axis, weight], index) => [axis, {
            score: projectStrengthBands[axis].minScore,
            weight,
            rationale: `Emerging evidence supports ${axis}.`,
            role: "PROJECT",
            evidenceRefs: [artifacts[index].artifactId],
            counterEvidenceRefs: [],
            gaps: [],
          }])),
        }],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const credentials = { url: "https://database.example", key: "sb_secret_test" };
    const context = {
      organizationId: "00000000-0000-4000-8000-000000000011",
      reportVersionId: "00000000-0000-4000-8000-000000000022",
      attestationState: "server_collected" as const,
    };

    await expect(persistProvenance(credentials, context, payload, [])).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const missingBands = structuredClone(payload) as Partial<typeof payload>;
    Reflect.deleteProperty(missingBands, "projectStrengthBands");
    await expect(persistProvenance(credentials, context, missingBands, [])).rejects.toThrow(
      "missing project strength band",
    );

    const inflated = structuredClone(payload);
    inflated.report.role_reports[0].axes.P1_team_and_identity.score = 12;
    await expect(persistProvenance(credentials, context, inflated, [])).rejects.toThrow(
      "violates project strength band",
    );

    const positiveCounter = structuredClone(payload);
    const positiveCounterHash = "f".repeat(64);
    positiveCounter.axisEvidenceCatalog.push({
      artifactId: `art_v1_${positiveCounterHash}`,
      contentHash: positiveCounterHash,
      kind: "axis_evidence",
      provider: "project-control",
      operation: "positive-project-context",
      section: "basicFacts",
      title: "Additional positive identity context",
      eligibleAxes: ["P1_team_and_identity"],
      verification: "verified",
      scope: "direct_subject",
    });
    (positiveCounter.report.role_reports[0].axes.P1_team_and_identity.counterEvidenceRefs as string[])
      .push(`art_v1_${positiveCounterHash}`);
    await expect(persistProvenance(credentials, context, positiveCounter, [])).rejects.toThrow(
      "cites non-limiting project counter-evidence",
    );

    const verifiedDrawdown = structuredClone(payload);
    const drawdownHash = "e".repeat(64);
    verifiedDrawdown.axisEvidenceCatalog.push({
      artifactId: `art_v1_${drawdownHash}`,
      contentHash: drawdownHash,
      kind: "axis_evidence",
      provider: "coingecko/dexscreener",
      operation: "findings:ProjectTokenDrawdown",
      section: "findings",
      title: "Verified severe canonical-token market drawdown",
      eligibleAxes: ["P5_traction_and_liveness"],
      verification: "verified",
      counterEligibleAxes: ["P5_traction_and_liveness"],
      scope: "direct_subject",
    });
    verifiedDrawdown.projectStrengthBands.P5_traction_and_liveness = {
      ...verifiedDrawdown.projectStrengthBands.P5_traction_and_liveness,
      tier: "solid",
      minScore: 10,
      maxScore: 11,
      reasons: ["Current protocol usage remains verified; severe token drawdown caps the axis at solid"],
    };
    verifiedDrawdown.report.role_reports[0].axes.P5_traction_and_liveness.score = 10;
    (verifiedDrawdown.report.role_reports[0].axes.P5_traction_and_liveness.counterEvidenceRefs as string[])
      .push(`art_v1_${drawdownHash}`);
    await expect(persistProvenance(credentials, context, verifiedDrawdown, [])).resolves.toBeUndefined();

    const overPenalizedDrawdown = structuredClone(verifiedDrawdown);
    overPenalizedDrawdown.report.role_reports[0].axes.P5_traction_and_liveness.score = 9;
    await expect(persistProvenance(credentials, context, overPenalizedDrawdown, [])).rejects.toThrow(
      "violates project strength band",
    );

    const hiddenDrawdown = structuredClone(verifiedDrawdown);
    hiddenDrawdown.report.role_reports[0].axes.P5_traction_and_liveness.counterEvidenceRefs = [];
    await expect(persistProvenance(credentials, context, hiddenDrawdown, [])).rejects.toThrow(
      "omits required project counter-evidence",
    );

    const forgedAdverse = structuredClone(payload);
    forgedAdverse.projectStrengthBands.P1_team_and_identity = {
      tier: "adverse",
      minScore: 0,
      maxScore: 6,
      reasons: ["Purported adverse identity evidence"],
      anchorArtifactIds: [artifacts[0].artifactId],
    };
    forgedAdverse.report.role_reports[0].axes.P1_team_and_identity.score = 3;
    await expect(persistProvenance(credentials, context, forgedAdverse, [])).rejects.toThrow(
      "violates project strength band",
    );
  });

  it("rejects a scored role that omits any canonical axis", async () => {
    const artifactId = `art_v1_${"a".repeat(64)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Verified identity evidence",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "PASS",
          governing_score: 80,
          role_reports: [{
            role: "FOUNDER",
            axes: {
              F1_identity_verifiability: {
                score: 8,
                weight: 12,
                rationale: "Verified identity evidence.",
                role: "FOUNDER",
                evidenceRefs: [artifactId],
                counterEvidenceRefs: [],
                gaps: [],
              },
            },
          }],
        },
      },
      [],
    )).rejects.toThrow("FOUNDER axis set is incomplete or non-canonical");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a report that drops an entire declared role", async () => {
    const artifactId = `art_v1_${"a".repeat(64)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "test-provider",
          operation: "lookup",
          section: "profile",
          title: "Verified founder evidence",
          eligibleAxes: Object.keys(FOUNDER_WEIGHTS),
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "PASS",
          governing_score: 80,
          roles: ["FOUNDER", "INVESTOR"],
          role_reports: [{ role: "FOUNDER", axes: founderAxes(artifactId) }],
        },
      },
      [],
    )).rejects.toThrow("declared roles do not match role reports");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "an out-of-range score", patch: { score: 13 } },
    { label: "a fractional score", patch: { score: 8.5 } },
    { label: "a non-canonical weight", patch: { weight: 13 } },
    { label: "a mismatched role", patch: { role: "INVESTOR" } },
    { label: "a blank rationale", patch: { rationale: "   " } },
  ])("rejects $label in an otherwise complete role", async ({ patch }) => {
    const artifactId = `art_v1_${"a".repeat(64)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const axes = founderAxes(artifactId);
    axes.F1_identity_verifiability = { ...axes.F1_identity_verifiability, ...patch };

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "test-provider",
          operation: "lookup",
          section: "profile",
          title: "Verified founder evidence",
          eligibleAxes: Object.keys(FOUNDER_WEIGHTS),
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "PASS",
          governing_score: 80,
          role_reports: [{ role: "FOUNDER", axes }],
        },
      },
      [],
    )).rejects.toThrow("violates the scoring contract");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists a strict INCOMPLETE catalog with zero scored axes and no link write", async () => {
    const artifactId = `art_v1_${"d".repeat(64)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "d".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "account-resolution",
          section: "identity",
          title: "A frozen collector artifact remains available for review",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "observed",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          roles: ["FOUNDER"],
          role_reports: [{ role: "FOUNDER", score_total: null, axes: {} }],
        },
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/evidence_items?");
    const rows = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(rows).toEqual([expect.objectContaining({ evidence_key: artifactId })]);
  });

  it("persists PROJECT none bands as unscored INCOMPLETE evidence, never numeric zero", async () => {
    const artifactId = `art_v1_${"e".repeat(64)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const projectStrengthBands = Object.fromEntries(Object.keys(getProfile(SubjectClass.PROJECT).axes)
      .map((axis) => [axis, {
        tier: "none",
        minScore: 0,
        maxScore: 0,
        reasons: [],
        anchorArtifactIds: [],
      }]));

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "e".repeat(64),
          kind: "axis_evidence",
          provider: "argus-coverage",
          operation: "coverage_gap:P1_team_and_identity",
          section: "axisGaps",
          title: "No retained project identity evidence",
          eligibleAxes: ["P1_team_and_identity"],
          verification: "unavailable",
          scope: "direct_subject",
        }],
        projectStrengthBands,
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          roles: ["PROJECT"],
          role_reports: [{ role: "PROJECT", score_total: null, axes: {} }],
        },
      },
      [],
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an undefined lineage version as legacy payload shape", async () => {
    const contentHash = "e".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: undefined,
        sourceArtifacts: [{
          kind: "profile",
          provider: "github",
          title: "Legacy profile artifact",
          contentHash,
        }],
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/evidence_items?");
  });

  it("rejects a scored server-collected report that drops the lineage marker", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        report: {
          composite_verdict: "PASS",
          governing_score: 80,
          role_reports: [{ role: "FOUNDER", axes: { F1_identity_verifiability: { score: 8 } } }],
        },
      },
      [],
    )).rejects.toThrow("omitted axisCitationVersion");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "unsupported lineage version",
      payload: { axisCitationVersion: 2 },
    },
    {
      label: "malformed artifact id",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: "not-an-artifact",
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: { role_reports: [] },
      },
    },
    {
      label: "reference outside the catalog",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          role_reports: [{
            role: "FOUNDER",
            axes: {
              F1_identity_verifiability: {
                score: 8,
                evidenceRefs: [`art_v1_${"c".repeat(64)}`],
                counterEvidenceRefs: [],
                gaps: [],
              },
            },
          }],
        },
      },
    },
    {
      label: "zero axes for a scored verdict",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "PASS",
          governing_score: 88,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "an incomplete verdict with a non-null governing score",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: 1,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a catalog artifact without the required kind",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a source URL containing userinfo",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          sourceUrl: "https://user:secret@example.com/evidence",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a source URL containing a sensitive query parameter",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          sourceUrl: "https://example.com/evidence?api_key=secret",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a non-canonical source URL that would otherwise leak raw metadata",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          sourceUrl: "https://example.com/evidence#raw-fragment",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
  ])("rejects $label before making any persistence request", async ({ payload }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      payload,
      [],
    )).rejects.toThrow("invalid axis evidence lineage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "an AWS signed credential", extra: { sourceUrl: "https://example.com/evidence?X-Amz-Signature=secret" } },
    { label: "an encoded AWS credential key", extra: { sourceUrl: "https://example.com/evidence?%58%2DAmz%2DCredential=secret" } },
    { label: "a Google signed credential", extra: { sourceUrl: "https://example.com/evidence?X-Goog-Credential=secret" } },
    { label: "an out-of-range URL port", extra: { sourceUrl: "https://example.com:65536/evidence" } },
    { label: "an unknown catalog property", extra: { rawProviderResponse: "must-not-persist" } },
  ])("rejects $label before persistence", async ({ extra }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "observed",
          scope: "direct_subject",
          ...extra,
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
      [],
    )).rejects.toThrow("invalid axis evidence lineage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "checked_empty"])(
    "rejects %s support without an explicit gap before persistence",
    async (verification) => {
      const artifactId = `art_v1_${"a".repeat(64)}`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(persistProvenance(
        { url: "https://database.example", key: "sb_secret_test" },
        {
          organizationId: "00000000-0000-4000-8000-000000000011",
          reportVersionId: "00000000-0000-4000-8000-000000000022",
          attestationState: "server_collected",
        },
        {
          axisCitationVersion: 1,
          axisEvidenceCatalog: [{
            artifactId,
            contentHash: "a".repeat(64),
            kind: "axis_evidence",
            provider: "github",
            operation: "lookup",
            section: "identity",
            title: "Coverage absence",
            eligibleAxes: ["F1_identity_verifiability"],
            verification,
            scope: "direct_subject",
          }],
          report: {
            composite_verdict: "PASS",
            governing_score: 80,
            role_reports: [{
              role: "FOUNDER",
              axes: {
                F1_identity_verifiability: {
                  score: 8,
                  evidenceRefs: [artifactId],
                  counterEvidenceRefs: [],
                  gaps: [],
                },
              },
            }],
          },
        },
        [],
      )).rejects.toThrow("absence evidence without a gap");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["unavailable", "checked_empty"])(
    "rejects %s as the only support even when the coverage gap is disclosed",
    async (verification) => {
      const artifactId = `art_v1_${"a".repeat(64)}`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(persistProvenance(
        { url: "https://database.example", key: "sb_secret_test" },
        {
          organizationId: "00000000-0000-4000-8000-000000000011",
          reportVersionId: "00000000-0000-4000-8000-000000000022",
          attestationState: "server_collected",
        },
        {
          axisCitationVersion: 1,
          axisEvidenceCatalog: [{
            artifactId,
            contentHash: "a".repeat(64),
            kind: "axis_evidence",
            provider: "github",
            operation: "lookup",
            section: "identity",
            title: "Coverage absence",
            eligibleAxes: ["F1_identity_verifiability"],
            verification,
            scope: "direct_subject",
          }],
          report: {
            composite_verdict: "PASS",
            governing_score: 80,
            role_reports: [{
              role: "FOUNDER",
              axes: {
                F1_identity_verifiability: {
                  score: 8,
                  evidenceRefs: [artifactId],
                  counterEvidenceRefs: [],
                  gaps: ["This provider returned no substantive result."],
                },
              },
            }],
          },
        },
        [],
      )).rejects.toThrow("lacks substantive support");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["unavailable", "checked_empty"])(
    "rejects %s as counter-evidence before persistence",
    async (verification) => {
      const supportId = `art_v1_${"a".repeat(64)}`;
      const counterId = `art_v1_${"b".repeat(64)}`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(persistProvenance(
        { url: "https://database.example", key: "sb_secret_test" },
        {
          organizationId: "00000000-0000-4000-8000-000000000011",
          reportVersionId: "00000000-0000-4000-8000-000000000022",
          attestationState: "server_collected",
        },
        {
          axisCitationVersion: 1,
          axisEvidenceCatalog: [
            {
              artifactId: supportId,
              contentHash: "a".repeat(64),
              kind: "axis_evidence",
              provider: "github",
              operation: "lookup",
              section: "identity",
              title: "Verified support",
              eligibleAxes: ["F1_identity_verifiability"],
              verification: "verified",
              scope: "direct_subject",
            },
            {
              artifactId: counterId,
              contentHash: "b".repeat(64),
              kind: "axis_evidence",
              provider: "github",
              operation: "lookup",
              section: "identity",
              title: "Coverage absence",
              eligibleAxes: ["F1_identity_verifiability"],
              verification,
              scope: "direct_subject",
            },
          ],
          report: {
            composite_verdict: "PASS",
            governing_score: 80,
            role_reports: [{
              role: "FOUNDER",
              axes: {
                F1_identity_verifiability: {
                  score: 8,
                  evidenceRefs: [supportId],
                  counterEvidenceRefs: [counterId],
                  gaps: ["The coverage absence is disclosed."],
                },
              },
            }],
          },
        },
        [],
      )).rejects.toThrow("absence evidence as counter-evidence");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("preserves artifact hashes, source kind, capture metadata, and match semantics", async () => {
    const contentHash = "a".repeat(64);
    const sourceContentHash = "b".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        sourceArtifacts: [{
          kind: "sanctions_screen",
          provider: "opensanctions",
          title: "OFAC exact-name screen",
          sourceUrl: "https://data.example/latest.csv",
          capturedAt: "2026-07-11T12:00:00.000Z",
          publishedAt: "2026-07-10T12:00:00.000Z",
          match: "no_match",
          excerpt: "No exact match.",
          contentHash,
          sourceContentHash,
        }],
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toContain("evidence_items");
    const rows = JSON.parse(String((request[1] as RequestInit).body)) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      evidence_key: contentHash,
      source_type: "sanctions_screen",
      content_hash: contentHash,
      metadata: {
        capturedAt: "2026-07-11T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        match: "no_match",
        sourceContentHash,
      },
    });
  });

  it("persists a deterministic hash-only artifact without inventing a public URL", async () => {
    const contentHash = "c".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        sourceArtifacts: [{
          kind: "trust_graph",
          provider: "argus-graph",
          title: "Organization trust-graph reconciliation",
          capturedAt: "2026-07-11T12:00:00.000Z",
          match: "risk_signal",
          excerpt: "Exact report-version graph tie.",
          contentHash,
          sourceContentHash: contentHash,
        }],
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    const rows = JSON.parse(String((request[1] as RequestInit).body)) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      evidence_key: contentHash,
      provider: "argus-graph",
      source_type: "trust_graph",
      source_url: null,
      content_hash: contentHash,
      metadata: {
        hashOnly: true,
        match: "risk_signal",
        sourceContentHash: contentHash,
      },
    });
  });
});

describe("atomic immutable report bundle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const payload = {
    handle: "@alice",
    checkRuns: [{
      checkId: "identity-resolution",
      label: "Identity resolution",
      status: "confirmed",
      provider: "official-site",
      sourceCount: 1,
    }],
    sourceArtifacts: [{
      provider: "official-site",
      kind: "team",
      title: "Alice is the current founder and CEO",
      sourceUrl: "https://alice.example/team",
      capturedAt: "2026-07-13T12:00:00.000Z",
    }],
    report: {
      audit_id: "bundle-audit-1",
      composite_verdict: "INCOMPLETE",
      governing_score: null,
      roles: [],
      role_reports: [],
    },
  };

  it("sends one unbound child bundle and accepts only matching materialized counts", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000022";
    const prepared = prepareProvenanceRows(
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        attestationState: "analyst_submitted",
      },
      payload,
      payload.checkRuns,
    );
    expect(prepared.evidenceItems.length).toBeGreaterThan(0);
    expect(prepared.checkRuns).toHaveLength(1);
    expect(prepared.axisEvidence).toEqual([]);
    for (const row of [...prepared.evidenceItems, ...prepared.checkRuns]) {
      expect(row).not.toHaveProperty("organization_id");
      expect(row).not.toHaveProperty("report_version_id");
      expect(row).not.toHaveProperty("attestation_state");
    }

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      report_version_id: reportVersionId,
      evidence_count: prepared.evidenceItems.length,
      check_count: prepared.checkRuns.length,
      axis_evidence_count: prepared.axisEvidence.length,
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistReportVersionBundle(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        kind: "person",
        canonicalRef: "alice",
        query: "@alice",
        createdBy: "00000000-0000-4000-8000-000000000010",
        payload,
        checks: payload.checkRuns,
        runId: "bundle-audit-1",
        attestationState: "analyst_submitted",
        verdict: "INCOMPLETE",
        score: null,
        completenessState: "partial",
        methodologyVersion: null,
        providerSnapshot: {},
        cost: {},
      },
    )).resolves.toBe(reportVersionId);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://database.example/rest/v1/rpc/persist_report_version_bundle",
    );
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      p_organization_id: "00000000-0000-4000-8000-000000000011",
      p_payload: payload,
      p_check_runs: [expect.objectContaining({ check_id: "identity-resolution" })],
    });
    expect(body.p_evidence_items.length).toBe(prepared.evidenceItems.length);
  });

  it("rejects incomplete check materialization before issuing the parent RPC", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const duplicateChecks = [payload.checkRuns[0], payload.checkRuns[0]];

    await expect(persistReportVersionBundle(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        kind: "person",
        canonicalRef: "alice",
        query: "@alice",
        createdBy: "00000000-0000-4000-8000-000000000010",
        payload: { ...payload, checkRuns: duplicateChecks },
        checks: duplicateChecks,
        runId: "bundle-audit-invalid",
        attestationState: "analyst_submitted",
        verdict: "INCOMPLETE",
        score: null,
        completenessState: "partial",
        methodologyVersion: null,
        providerSnapshot: {},
        cost: {},
      },
    )).rejects.toThrow("every frozen check must have one unique row");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC reports child counts that do not match the frozen payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      report_version_id: "00000000-0000-4000-8000-000000000022",
      evidence_count: 0,
      check_count: 0,
      axis_evidence_count: 0,
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistReportVersionBundle(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        kind: "person",
        canonicalRef: "alice",
        query: "@alice",
        createdBy: "00000000-0000-4000-8000-000000000010",
        payload,
        checks: payload.checkRuns,
        runId: "bundle-audit-count-mismatch",
        attestationState: "analyst_submitted",
        verdict: "INCOMPLETE",
        score: null,
        completenessState: "partial",
        methodologyVersion: null,
        providerSnapshot: {},
        cost: {},
      },
    )).rejects.toThrow("inconsistent child counts");
  });
});

describe("report bundle migration contract (static SQL assertions only)", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260713184728_persist_report_version_bundle.sql", import.meta.url),
    "utf8",
  );

  it("creates parent and provenance children inside one bounded service-only RPC", () => {
    const parentWrite = sql.indexOf("from public.persist_report_version(");
    const evidenceWrite = sql.indexOf("insert into public.evidence_items");
    const checkWrite = sql.indexOf("insert into public.check_runs");
    const axisWrite = sql.indexOf("insert into public.report_axis_evidence");
    expect(sql).toContain("create or replace function public.persist_report_version_bundle");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '120s'");
    expect(parentWrite).toBeGreaterThan(-1);
    expect(evidenceWrite).toBeGreaterThan(parentWrite);
    expect(checkWrite).toBeGreaterThan(evidenceWrite);
    expect(axisWrite).toBeGreaterThan(checkWrite);
    expect(sql).toContain("payload checkRuns were not fully materialized");
    expect(sql).toContain("immutable report provenance materialization mismatch");
    expect(sql).toContain("immutable evidence item replay content mismatch");
    expect(sql).toContain("immutable check run replay content mismatch");
    expect(sql).toContain("immutable axis evidence replay content mismatch");
    expect(sql).toContain("actual.metadata is distinct from incoming.value -> 'metadata'");
    expect(sql).toContain("actual.state is distinct from incoming.value ->> 'state'");
    expect(sql).toContain("actual.artifact_id is distinct from incoming.value ->> 'artifact_id'");
  });

  it("keeps the mutation surface restricted to the service role", () => {
    expect(sql).toContain(") from public, anon, authenticated, service_role;");
    expect(sql).toContain(") to service_role;");
  });
});

describe("report bundle ambiguity repair migration", () => {
  const originalSql = readFileSync(
    new URL("../supabase/migrations/20260713184728_persist_report_version_bundle.sql", import.meta.url),
    "utf8",
  );
  const sql = readFileSync(
    new URL(
      "../supabase/migrations/20260713190341_fix_persist_report_version_bundle_ambiguity.sql",
      import.meta.url,
    ),
    "utf8",
  );

  it("uses named constraints instead of ambiguous RETURNS TABLE output names", () => {
    expect(sql).toContain(
      "on conflict on constraint evidence_items_report_key_unique do nothing",
    );
    expect(sql).toContain(
      "on conflict on constraint check_runs_report_version_id_check_id_key do nothing",
    );
    expect(sql).toContain(
      "on conflict on constraint report_axis_evidence_pkey do nothing",
    );
    expect(sql).not.toMatch(/on conflict\s*\(\s*report_version_id\b/i);
  });

  it("changes only the three ambiguous conflict targets", () => {
    const functionStart = sql.indexOf("-- Persist the immutable report parent");
    const normalizedRepair = sql
      .slice(functionStart)
      .replace(
        "on conflict on constraint evidence_items_report_key_unique do nothing",
        "on conflict (report_version_id, evidence_key) do nothing",
      )
      .replace(
        "on conflict on constraint check_runs_report_version_id_check_id_key do nothing",
        "on conflict (report_version_id, check_id) do nothing",
      )
      .replace(
        "on conflict on constraint report_axis_evidence_pkey do nothing",
        "on conflict (report_version_id, role, axis_id, relation, ordinal) do nothing",
      );
    expect(functionStart).toBeGreaterThan(-1);
    expect(normalizedRepair).toBe(originalSql);
  });

  it("preserves the bounded service-only atomic RPC contract", () => {
    expect(sql).toContain("create or replace function public.persist_report_version_bundle");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("immutable report provenance materialization mismatch");
    expect(sql).toContain(") from public, anon, authenticated, service_role;");
    expect(sql).toContain(") to service_role;");
  });
});

describe("axis evidence migration contract (static SQL assertions only)", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260711212542_axis_evidence_lineage.sql", import.meta.url),
    "utf8",
  );
  const substantiveSql = readFileSync(
    new URL("../supabase/migrations/20260712014526_require_substantive_axis_support.sql", import.meta.url),
    "utf8",
  );
  const requiredFieldsSql = readFileSync(
    new URL("../supabase/migrations/20260712015001_require_scoring_axis_fields.sql", import.meta.url),
    "utf8",
  );
  const roleSetSql = readFileSync(
    new URL("../supabase/migrations/20260712015647_require_scoring_role_set.sql", import.meta.url),
    "utf8",
  );
  const counterEligibilitySql = readFileSync(
    new URL("../supabase/migrations/20260713115507_accept_counter_eligible_axes.sql", import.meta.url),
    "utf8",
  );
  const provenanceSource = readFileSync(new URL("./_provenance.ts", import.meta.url), "utf8");

  it("declares tenant-safe lineage tables, RLS, and immutable certification", () => {
    expect(sql).toContain("create table public.report_axis_evidence");
    expect(sql).toContain("create table public.report_lineage_certifications");
    expect(sql).toContain("foreign key (organization_id, report_version_id, artifact_id)");
    expect(sql).toContain("alter table public.report_axis_evidence enable row level security");
    expect(sql).toContain("alter table public.report_lineage_certifications enable row level security");
    expect(sql).toContain("prevent_certified_lineage_mutation");
    expect(sql).toContain("to service_role");
  });

  it("gates strict publication and inserts the graph before base activation", () => {
    expect(sql).toContain("axisCitationVersion");
    expect(sql).toContain("report_lineage_certifications");
    expect(sql).toContain("reports_enforce_axis_evidence_lineage");
    const graphUpsert = sql.indexOf("insert into public.graph_contributions");
    const baseActivation = sql.lastIndexOf("perform public.activate_report_version");
    expect(graphUpsert).toBeGreaterThan(-1);
    expect(baseActivation).toBeGreaterThan(graphUpsert);
  });

  it("certifies honest incomplete reports and hardens retry and catalog semantics", () => {
    expect(sql).toContain("v_is_incomplete");
    expect(sql).toContain("{report,composite_verdict}' = 'INCOMPLETE'");
    expect(sql).toContain("{report,governing_score}') = 'null'");
    expect(sql).toContain("v_version.score is null");
    expect(sql).toContain("new.score is null");
    expect(sql).toContain("scored_axis_count = 0 and link_count = 0");
    expect(sql).toContain("incomplete strict report must not contain scored axes");
    expect(sql).toContain("coalesce(artifact.item ->> 'kind', '') <> 'axis_evidence'");
    expect(sql).toContain("!~ '^https?://(\\[[0-9a-f:.]+\\]|[a-z0-9]");
    expect(sql).toContain("artifact.item ->> 'sourceUrl' ~* '^https?://[^/?#]*@'");
    expect(sql).toContain("pg_catalog.regexp_split_to_table");
    expect(sql).toContain("access[_-]?token|api[_-]?key|key|token|signature|sig|auth");
    expect(sql).toContain("x[-_]?(amz|goog)");
    expect(sql).toContain("v_port_text::integer > 65535");
    expect(sql).toContain("non-canonical or invalid sourceUrl port");
    expect(sql).toContain("if tg_op = 'INSERT' then");
    expect(sql).toContain("evidence.evidence_key = pg_catalog.to_jsonb(new) ->> 'evidence_key'");
    expect(sql).toContain("link.ordinal = (pg_catalog.to_jsonb(new) ->> 'ordinal')::integer");
    expect(sql).toContain("pg_catalog.string_agg(catalog_artifact::text");
    expect(sql).toContain("verification' in ('unavailable', 'checked_empty')");
    expect(sql).toContain("absence evidence cannot be used as counter-evidence");
  });

  it("keeps the API and final SQL artifact-key contracts synchronized", () => {
    const apiKeyBlock = provenanceSource.match(
      /const CATALOG_ARTIFACT_KEYS = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1];
    const sqlKeyBlock = counterEligibilitySql.match(
      /artifact\.item - array\[([\s\S]*?)\]::text\[\]/,
    )?.[1];
    expect(apiKeyBlock).toBeDefined();
    expect(sqlKeyBlock).toBeDefined();

    const apiKeys = [...(apiKeyBlock ?? "").matchAll(/"([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    const sqlKeys = [...(sqlKeyBlock ?? "").matchAll(/'([^']+)'/g)]
      .map((match) => match[1])
      .sort();

    expect(sqlKeys).toEqual(apiKeys);
    expect(sqlKeys).toContain("counterEligibleAxes");
  });

  it("validates and freezes optional counter eligibility identically at the SQL boundary", () => {
    expect(counterEligibilitySql).toContain(
      "pg_catalog.jsonb_typeof(artifact.item -> 'counterEligibleAxes') <> 'array'",
    );
    expect(counterEligibilitySql).toContain(
      "pg_catalog.jsonb_array_length(artifact.item -> 'counterEligibleAxes') not between 1 and 80",
    );
    expect(counterEligibilitySql).toContain(
      "pg_catalog.jsonb_array_elements(artifact.item -> 'counterEligibleAxes') counter_axis(item)",
    );
    expect(counterEligibilitySql).toContain(
      "pg_catalog.count(distinct counter_axis.item)",
    );
    expect(counterEligibilitySql).toContain(
      "where not (artifact.item -> 'eligibleAxes' ? counter_axis.item)",
    );
    expect(counterEligibilitySql).toContain(
      "artifact.item ->> 'verification' <> 'verified'",
    );
    expect(counterEligibilitySql.match(
      /case when artifact\.item \? 'counterEligibleAxes'/g,
    )).toHaveLength(2);
    expect(counterEligibilitySql).toContain(
      "'catalogArtifact', normalized.catalog_artifact",
    );
  });

  it("adds a forward database gate requiring substantive support on every scored axis", () => {
    expect(substantiveSql).toContain("create or replace function public.enforce_axis_scoring_contract()");
    expect(substantiveSql).toContain("reports_enforce_axis_evidence_scoring_contract");
    expect(substantiveSql).toContain("before insert or update on public.reports");
    for (const [role, profile] of Object.entries(PROFILES)) {
      expect(substantiveSql).toContain(`"${role}": {`);
      for (const [axis, weight] of Object.entries(profile.axes)) {
        expect(substantiveSql).toContain(`"${axis}": ${weight}`);
      }
    }
    expect(substantiveSql).toContain("strict report role axis set is incomplete or non-canonical");
    expect(substantiveSql).toContain("strict report axis violates the canonical scoring contract");
    expect(substantiveSql).toContain("where not exists (");
    expect(substantiveSql).toContain("'verification' not in ('unavailable', 'checked_empty')");
    expect(substantiveSql).toContain("strict report axis lacks substantive support");
    expect(substantiveSql).toContain("new server-collected scored person report requires strict axis lineage");
    expect(substantiveSql).toContain("revoke all on function public.enforce_axis_scoring_contract()");
  });

  it("requires every canonical scoring field without relying on nullable SQL inequalities", () => {
    expect(requiredFieldsSql).toContain("create or replace function public.enforce_axis_scoring_required_fields()");
    expect(requiredFieldsSql).toContain("axis.item ?& array[");
    expect(requiredFieldsSql).toContain("coalesce(pg_catalog.jsonb_typeof(axis.item -> 'weight'), '') <> 'number'");
    expect(requiredFieldsSql).toContain("strict report axis is missing a required scoring field");
    expect(requiredFieldsSql).toContain("reports_enforce_axis_evidence_scoring_required_fields");
  });

  it("binds declared roles to the exact role-report set", () => {
    expect(roleSetSql).toContain("create or replace function public.enforce_axis_scoring_role_set()");
    expect(roleSetSql).toContain("pg_catalog.jsonb_array_elements_text(v_declared_roles)");
    expect(roleSetSql).toContain("strict report declared roles do not match role reports");
    expect(roleSetSql).toContain("reports_enforce_axis_evidence_scoring_role_set");
  });

  it("hashes and freezes the complete certified decision", () => {
    expect(sql).toContain("pg_catalog.to_jsonb(v_version)::text");
    expect(sql).toContain("--active-projection--");
    expect(sql).toContain("'payload', new.payload");
    expect(sql).toContain("'verdict', new.verdict");
    expect(sql).toContain("'score', new.score");
    expect(sql).toContain("prevent_certified_report_version_mutation");
    expect(sql).toContain("certified report version decision payload is immutable");
    expect(sql).toContain("prevent_certified_report_projection_mutation");
    expect(sql).toContain("certified active report projection is immutable");
  });

  it("allows only full-row idempotent retries and canonical artifacts", () => {
    expect(sql).toContain("pg_catalog.to_jsonb(evidence) - 'id' - 'captured_at'");
    expect(sql).toContain("pg_catalog.to_jsonb(link) - 'created_at'");
    expect(sql).toContain("certified lineage retry payload does not match the existing row");
    expect(sql).toContain("'catalogArtifact', normalized.catalog_artifact");
    expect(sql).toContain("evidence.excerpt is not distinct from artifact.item ->> 'excerpt'");
    expect(sql).toContain("evidence.source_url is not distinct from artifact.item ->> 'sourceUrl'");
    expect(sql).toContain("axis evidence catalog contains an invalid capturedAt timestamp");
  });

  it("binds and freezes the exact authoritative graph even through base activation", () => {
    expect(sql).toContain("prevent_certified_graph_mutation");
    expect(sql).toContain("argus.activating_graph_report_version");
    expect(sql).toContain("graph.nodes = v_version.payload #> '{graph,nodes}'");
    expect(sql).toContain("graph.edges = v_version.payload #> '{graph,edges}'");
    expect(sql).toContain("graph.contributor_user_id is not distinct from v_version.created_by");
    expect(sql).toContain("complete strict person report requires its exact authoritative graph");
  });

  it("builds the tenant-qualified evidence key inside a bounded Supabase-compatible transaction", () => {
    const schemaTransaction = sql.indexOf("\nbegin;\n\nset local");
    const boundedIndex = sql.indexOf("create unique index if not exists evidence_items_org_report_key_uidx");
    const attachConstraint = sql.indexOf("unique using index evidence_items_org_report_key_uidx");
    expect(sql).toContain("and not index_state.indisvalid");
    expect(sql).toContain("execute 'drop index public.evidence_items_org_report_key_uidx'");
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '120s'");
    expect(sql).not.toContain("create unique index concurrently");
    expect(schemaTransaction).toBeGreaterThan(-1);
    expect(boundedIndex).toBeGreaterThan(schemaTransaction);
    expect(attachConstraint).toBeGreaterThan(boundedIndex);
  });

  it("marks and independently guards the certified archive lifecycle", () => {
    expect(sql).toContain("manage_case_lifecycle_without_lineage_marker");
    expect(sql).toContain("argus.lifecycle_action");
    expect(sql).toContain("argus.lifecycle_subjects");
    expect(sql).toContain("membership.role = 'owner'");
    expect(sql).toContain("case_row.status = 'archived'");
    expect(sql).toContain("version_row.payload = old.payload");
  });
});
