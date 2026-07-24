import { describe, expect, it } from "vitest";
import { auditStoredReportQuality, type StoredReportQualityInput } from "./reportQualityAudit";

const base = (payload: Record<string, unknown>): StoredReportQualityInput => ({
  kind: "person",
  ref: "subject",
  query: "@subject",
  version: 1,
  verdict: "CAUTION",
  score: 50,
  completeness: "complete",
  attestation: "server_collected",
  createdAt: "2026-07-23T12:05:00.000Z",
  payload,
});

const cleanReport = {
  composite_verdict: "CAUTION",
  governing_score: 50,
  governing_role: "PROJECT",
  finalized_at: "2026-07-23T12:00:00.000Z",
  publishable_findings: [],
  investigative_leads: [],
  role_reports: [{
    role: "PROJECT",
    axes: {
      P1_team_and_identity: {
        score: 8,
        weight: 16,
        evidenceRefs: ["artifact-1"],
        counterEvidenceRefs: [],
      },
    },
  }],
};

describe("auditStoredReportQuality", () => {
  it("passes a source-backed, internally consistent frozen report", () => {
    const result = auditStoredReportQuality(base({
      report: cleanReport,
      axisCitationVersion: 1,
      contradictions: [],
      basicFacts: [{
        predicate: "product",
        value: "A live protocol",
        status: "verified",
        floorEligible: false,
        sources: [{
          url: "https://subject.example/docs",
          sourceClass: "official_subject",
          artifactVerified: true,
        }],
      }],
    }));

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it("blocks unrelated company funding and leadership contamination", () => {
    const result = auditStoredReportQuality(base({
      report: cleanReport,
      axisCitationVersion: 1,
      contradictions: [{
        severity: "high",
        confidence: "high",
        claim: "The report attributes $30.2M in funding to SuperGemma.",
        conflict: "The source belongs to an unrelated company. Supergut data was attributed to the wrong entity.",
      }],
    }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", code: "identity_contamination" }),
    ]));
  });

  it("catches impossible timestamps and unsourced investigative clutter", () => {
    const result = auditStoredReportQuality(base({
      report: {
        ...cleanReport,
        finalized_at: "1970-01-01T00:00:00.000Z",
        investigative_leads: [{
          claim: "Model role guess",
          source_url: "",
          evidence_origin: "model_lead",
        }],
      },
      axisCitationVersion: 1,
    }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "impossible_finalized_at" }),
      expect.objectContaining({ code: "unactionable_investigative_leads" }),
    ]));
  });

  it("treats an impossible timestamp as legacy warning without strict axis lineage", () => {
    const result = auditStoredReportQuality(base({
      report: { ...cleanReport, finalized_at: "1970-01-01T00:00:00.000Z" },
    }));

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "impossible_finalized_at",
    }));
  });

  it("applies subject-specific product judgments", () => {
    const result = auditStoredReportQuality(base({
      report: { ...cleanReport, composite_verdict: "INCOMPLETE", governing_score: null },
      axisCitationVersion: 1,
    }), {
      neverIncomplete: true,
      expectedRole: "FOUNDER",
      mustSurface: ["ethereum"],
      mustNotAppear: ["unrelated brand"],
    });

    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "expected_decision_missing",
      "governing_role_mismatch",
      "required_finding_missing",
    ]));
  });

  it("blocks aggregator-only funding from lifting a score floor", () => {
    const result = auditStoredReportQuality(base({
      report: cleanReport,
      axisCitationVersion: 1,
      basicFacts: [{
        predicate: "funding",
        value: "2 public rounds · $11M raised",
        status: "verified",
        sources: [{
          url: "https://defillama.com/protocol/example",
          provider: "defillama",
          sourceClass: "other_public",
          artifactVerified: true,
        }],
      }],
    }));

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "aggregator_funding_can_lift_score",
    }));
  });
});
