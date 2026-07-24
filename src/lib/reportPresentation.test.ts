import { describe, expect, it } from "vitest";
import {
  coverageQualifiedCompleteness,
  exactReportPath,
  presentPublicReport,
  publicReportDescription,
  publicReportTitle,
  publicScoreLabel,
  type PublicReportReadinessSummary,
} from "./reportPresentation";

const provisionalReadiness: PublicReportReadinessSummary = {
  status: "provisional",
  coveragePercent: 76,
  roleCount: 1,
  decisionAxisTotal: 6,
  evidenceBackedAxes: 6,
  neededEvidenceSummary: "3 of 13 applicable evidence checks remain open.",
};

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
      secondarySignal: "EARLY SCORE · PASS 94/100",
      final: false,
    });
  });

  it("presents a fully supported PASS as provisional when only non-axis evidence checks remain open", () => {
    const presentation = presentPublicReport({
      verdict: "PASS",
      score: 71,
      completeness: "partial",
      readiness: provisionalReadiness,
    });

    expect(presentation).toMatchObject({
      rawVerdict: "PASS",
      displayVerdict: "PROVISIONAL",
      resultLabel: "DECISION READINESS",
      readinessLabel: "ASSESSMENT PROVISIONAL",
      coverageLabel: "PARTIAL COVERAGE",
      primaryScore: "71",
      scoreLabel: "PROVISIONAL SCORE",
      secondarySignal: "PASS SIGNAL",
      final: false,
    });
    expect(presentation.note).toContain("All 6 parts of the score have saved sources");
    expect(presentation.note).toContain("3 of 13 applicable evidence checks remain open");
    expect(presentation.note).toContain("Do not rely on this result");
    expect(publicReportTitle("@jupiterexchange", presentation)).toBe(
      "@jupiterexchange · PROVISIONAL · 71/100 · assessment provisional · ARGUS",
    );
  });

  it.each([
    ["readiness is incomplete", { status: "incomplete" }],
    ["coverage is below 70%", { coveragePercent: 69 }],
    ["routing did not resolve a role", { roleCount: 0 }],
    ["scoring returned zero axes", { decisionAxisTotal: 0, evidenceBackedAxes: 0 }],
    ["one governing axis lacks support", { evidenceBackedAxes: 5 }],
    ["the evidence-gap summary is absent", { neededEvidenceSummary: "" }],
    ["the coverage claim is internally inconsistent", { coveragePercent: 100 }],
  ])("fails closed instead of presenting provisional when %s", (_case, override) => {
    const presentation = presentPublicReport({
      verdict: "PASS",
      score: 71,
      completeness: "partial",
      readiness: { ...provisionalReadiness, ...override } as PublicReportReadinessSummary,
    });

    expect(presentation).toMatchObject({
      displayVerdict: "INCOMPLETE",
      primaryScore: "",
      scoreLabel: null,
      final: false,
    });
  });

  it("fails closed when a provisional PASS score does not match the PASS band", () => {
    expect(presentPublicReport({
      verdict: "PASS",
      score: 69,
      completeness: "partial",
      readiness: provisionalReadiness,
    })).toMatchObject({
      displayVerdict: "INCOMPLETE",
      primaryScore: "",
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
        scoreLabel: score == null ? null : "RISK SCORE",
        final: false,
      });
      expect(presentation.note).toContain("some checks are still open");
    },
  );

  it("describes an incomplete CAUTION as a score band, not a material risk finding", () => {
    const partial = presentPublicReport({ verdict: "CAUTION", score: 42, completeness: "partial" });
    const failed = presentPublicReport({ verdict: "CAUTION", score: 42, completeness: "failed" });
    const inconsistent = presentPublicReport({ verdict: "CAUTION", score: 82, completeness: "partial" });
    const fail = presentPublicReport({ verdict: "FAIL", score: 34, completeness: "partial" });

    expect(partial.note).toBe(
      "The score is in the caution range, but some checks are still open.",
    );
    expect(failed.note).toBe(
      "The score is in the caution range, but the scan failed before all checks finished.",
    );
    expect(inconsistent.note).toBe(
      "The saved score does not match the caution result, and some checks are still open.",
    );
    expect(fail.note).toContain("ARGUS found a serious risk");
  });

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

  it("lets only explicitly decision-critical checks govern completeness", () => {
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [
        { status: "confirmed", decisionCritical: true },
        { status: "unavailable", decisionCritical: false },
      ],
    })).toBe("complete");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [
        { status: "unknown", decisionCritical: true },
        { status: "confirmed", decisionCritical: false },
      ],
    })).toBe("partial");
  });

  it("reads decision criticality from stored check metadata and preserves legacy semantics", () => {
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [
        { state: "complete", metadata: { decisionCritical: true } },
        { state: "not_run", metadata: { decisionCritical: false } },
      ],
    })).toBe("complete");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: [
        { state: "complete" },
        { state: "not_run" },
      ],
    })).toBe("partial");
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
      /^Some checks did not finish\. Do not rely on the early score yet\./,
    );
  });
});
