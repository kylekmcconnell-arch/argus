import { describe, expect, it } from "vitest";
import { parseBetaQualityRow, summarizeBetaQuality, type BetaQualityRow } from "./betaQuality";

describe("beta quality summary", () => {
  it("joins conversion, adjudication, decision lift, costs, and confusion without PII", () => {
    const rows: BetaQualityRow[] = [
      { type: "participant", participantId: "p_01", invitedAt: "2026-08-01T00:00:00Z", signedUpAt: "2026-08-01T01:00:00Z", firstInvestigationStartedAt: "2026-08-01T01:05:00Z", firstInvestigationCompletedAt: "2026-08-01T01:35:00Z" },
      { type: "participant", participantId: "p_02", invitedAt: "2026-08-01T00:00:00Z" },
      { type: "investigation", participantId: "p_01", reportVersionId: "r_01", reportType: "token", completedAt: "2026-08-01T01:35:00Z", providerFailures: 1 },
      { type: "eye_question", participantId: "p_01", questionId: "q_01", reportVersionId: "r_01", substantive: true, adjudication: "unsupported", confidenceBefore: 2, confidenceAfter: 4, decisionChanged: true },
      { type: "eye_question", participantId: "p_01", questionId: "q_ui", reportVersionId: "r_01", substantive: false, adjudication: "unreviewed" },
      { type: "provider_cost", reportVersionId: "r_01", provider: "serper", calls: 2, usd: 0.4 },
      { type: "provider_cost", reportVersionId: "r_01", provider: "serper", calls: 1, usd: 0.1 },
      { type: "feedback", participantId: "p_01", feedbackId: "f_01", tags: ["copy-confusing", "Copy-Confusing", "eye-too-dense"] },
    ];

    expect(summarizeBetaQuality(rows)).toMatchObject({
      invited: 2,
      signedUp: 1,
      signupRate: 0.5,
      signupToFirstInvestigationRate: 1,
      medianMinutesToFirstCompletedReport: 35,
      completedInvestigations: 1,
      providerFailureRate: 1,
      substantiveEyeQuestions: 1,
      adjudicatedEyeQuestions: 1,
      unsupportedClaimRate: 1,
      averageConfidenceLift: 2,
      decisionChangeRate: 1,
      totalMeasuredCostUsd: 0.5,
      costPerCompletedInvestigationUsd: 0.5,
      costByProvider: { serper: 0.5 },
      confusionTags: { "copy-confusing": 1, "eye-too-dense": 1 },
    });
  });

  it("does not turn missing denominators into zero performance", () => {
    const summary = summarizeBetaQuality([]);
    expect(summary.signupRate).toBeNull();
    expect(summary.unsupportedClaimRate).toBeNull();
    expect(summary.costPerCompletedInvestigationUsd).toBeNull();
    expect(summary.exitCriteria.firstHundredQuestionsAdjudicated).toBe(false);
  });

  it("fails closed on malformed measurement rows", () => {
    expect(() => parseBetaQualityRow({ type: "provider_cost", reportVersionId: "r_01", provider: "serper", calls: 1, usd: -1 })).toThrow("usd");
    expect(() => parseBetaQualityRow({ type: "eye_question", participantId: "p_01", questionId: "q_01", reportVersionId: "r_01", substantive: true, adjudication: "clean" })).toThrow("adjudication");
  });
});
