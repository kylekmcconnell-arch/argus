import { describe, expect, it } from "vitest";
import {
  coverageQualifiedCompleteness,
  exactReportPath,
  presentPublicReport,
  publicReportDescription,
  publicReportTitle,
  publicScoreLabel,
} from "./reportPresentation";

describe("public report presentation policy", () => {
  it("never presents an incomplete positive report as final PASS", () => {
    const presentation = presentPublicReport({ verdict: "PASS", score: 94, completeness: "partial" });

    expect(presentation).toMatchObject({
      rawVerdict: "PASS",
      displayVerdict: "INCOMPLETE",
      resultLabel: "DECISION READINESS",
      readinessLabel: "INVESTIGATION INCOMPLETE",
      coverageLabel: "PARTIAL COVERAGE",
      primaryScore: "",
      secondarySignal: "PRELIMINARY MODEL SIGNAL · PASS 94/100",
      final: false,
    });
  });

  it.each(["CAUTION", "FAIL", "AVOID", "UNVERIFIABLE_IDENTITY"])(
    "preserves an incomplete %s as a risk signal without calling it final",
    (verdict) => {
      const score = verdict === "CAUTION" ? 54 : verdict === "AVOID" ? 9 : verdict === "UNVERIFIABLE_IDENTITY" ? null : 34;
      const presentation = presentPublicReport({ verdict, score, completeness: "partial" });

      expect(presentation).toMatchObject({
        rawVerdict: verdict,
        resultLabel: "RISK SIGNAL",
        readinessLabel: "INVESTIGATION INCOMPLETE",
        coverageLabel: "PARTIAL COVERAGE",
        primaryScore: score == null ? "" : String(score),
        scoreLabel: score == null ? null : "MODEL SCORE",
        final: false,
      });
      expect(presentation.note).toContain("missing coverage");
    },
  );

  it("publishes PASS as a verdict only with complete coverage", () => {
    expect(presentPublicReport({ verdict: "PASS", score: 88, completeness: "complete" })).toMatchObject({
      displayVerdict: "PASS",
      resultLabel: "VERDICT",
      readinessLabel: "EVIDENCE COVERAGE COMPLETE",
      coverageLabel: "COMPLETE COVERAGE",
      primaryScore: "88",
      scoreLabel: "SCORE",
      final: true,
    });
  });

  it("requires complete frozen checks and a trusted attestation", () => {
    const completeCheck = [{ state: "complete", metadata: { notApplicable: false } }];
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: completeCheck,
    })).toBe("complete");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [{ state: "not_run" }],
    })).toBe("partial");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "legacy_unattested",
      checks: completeCheck,
    })).toBe("partial");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [{ state: "not_run", metadata: { notApplicable: true } }, ...completeCheck],
    })).toBe("complete");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [{ state: "complete", stale_at: "2020-01-01T00:00:00.000Z" }],
    })).toBe("partial");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [{ state: "complete", stale_at: "2100-01-01T00:00:00.000Z" }],
    })).toBe("complete");
  });

  it("fails closed when a complete verdict conflicts with its score band", () => {
    expect(presentPublicReport({ verdict: "PASS", score: 1, completeness: "complete" })).toMatchObject({
      displayVerdict: "INCOMPLETE",
      primaryScore: "",
      final: false,
    });
    expect(presentPublicReport({ verdict: "FAIL", score: 90, completeness: "complete" })).toMatchObject({
      displayVerdict: "FAIL",
      resultLabel: "RISK SIGNAL",
      primaryScore: "",
      final: false,
    });
  });

  it.each(["UNKNOWN", "ERROR", "PASS_FAIL", "future_state"])(
    "fails closed for an unrecognized complete verdict %s",
    (verdict) => {
      expect(presentPublicReport({ verdict, score: 88, completeness: "complete" })).toMatchObject({
        rawVerdict: verdict.toUpperCase(),
        displayVerdict: "INCOMPLETE",
        resultLabel: "DECISION READINESS",
        readinessLabel: "DECISION OUTPUT INCOMPLETE",
        coverageLabel: "COMPLETE COVERAGE",
        primaryScore: "",
        secondarySignal: null,
        final: false,
      });
    },
  );

  it.each([null, undefined, "", Number.NaN, Number.POSITIVE_INFINITY, -1, 101])(
    "fails closed for complete PASS with invalid score %s",
    (score) => {
      expect(presentPublicReport({ verdict: "PASS", score, completeness: "complete" })).toMatchObject({
        rawVerdict: "PASS",
        displayVerdict: "INCOMPLETE",
        resultLabel: "DECISION READINESS",
        readinessLabel: "DECISION OUTPUT INCOMPLETE",
        coverageLabel: "COMPLETE COVERAGE",
        primaryScore: "",
        final: false,
      });
    },
  );

  it("keeps a scoreless complete adverse verdict visible only as a non-final risk signal", () => {
    expect(presentPublicReport({ verdict: "FAIL", score: null, completeness: "complete" })).toMatchObject({
      rawVerdict: "FAIL",
      displayVerdict: "FAIL",
      resultLabel: "RISK SIGNAL",
      readinessLabel: "DECISION OUTPUT INCOMPLETE",
      coverageLabel: "COMPLETE COVERAGE",
      primaryScore: "",
      final: false,
    });
  });

  it("distinguishes a failed investigation from partial coverage", () => {
    expect(presentPublicReport({ verdict: "PASS", score: 72, completeness: "failed" })).toMatchObject({
      displayVerdict: "INCOMPLETE",
      readinessLabel: "INVESTIGATION FAILED",
      coverageLabel: "FAILED COVERAGE",
      final: false,
    });
    expect(presentPublicReport({ verdict: "FAIL", score: 12, completeness: "failed" })).toMatchObject({
      displayVerdict: "FAIL",
      resultLabel: "RISK SIGNAL",
      readinessLabel: "INVESTIGATION FAILED",
      final: false,
    });
  });

  it("normalizes scores and builds exact-version public metadata", () => {
    const presentation = presentPublicReport({ verdict: "PASS", score: 88.25, completeness: "partial" });

    expect(publicScoreLabel(88.25)).toBe("88.3");
    expect(publicScoreLabel(101)).toBe("");
    expect(publicScoreLabel(null)).toBe("");
    expect(publicScoreLabel("")).toBe("");
    expect(exactReportPath("version/id with spaces")).toBe("/?version=version%2Fid%20with%20spaces");
    expect(publicReportTitle("@alice", presentation)).toBe(
      "@alice · INCOMPLETE · investigation incomplete · ARGUS",
    );
    expect(publicReportDescription("Strong operator.", "SERVER-COLLECTED REPORT", presentation)).toMatch(
      /^Evidence coverage is incomplete\. Do not treat the preliminary score as investment clearance\./,
    );
  });
});
