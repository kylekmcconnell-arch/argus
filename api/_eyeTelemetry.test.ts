import { describe, expect, it } from "vitest";
import {
  buildEyeQuestionTelemetry,
  buildEyeDecisionLift,
  claudeUsageFromMessages,
  estimateEyeCost,
  fingerprintQuestion,
  publicEyeTelemetry,
} from "./_eyeTelemetry";

describe("ARGUS Eye telemetry", () => {
  it("creates a tenant-keyed fingerprint without retaining dialogue", () => {
    const first = fingerprintQuestion("Who controls it?", "org-a", "test-secret");
    expect(first).toHaveLength(64);
    expect(first).not.toBe(fingerprintQuestion("Who controls it?", "org-b", "test-secret"));
    expect(fingerprintQuestion("Who controls it?", "org-a", "")).toBeNull();
  });

  it("normalizes Claude usage and estimates the existing rate card", () => {
    const usage = claudeUsageFromMessages({ usage: { input_tokens: 1_000, output_tokens: 100 } });
    expect(usage).toEqual({ inputTokens: 1_000, outputTokens: 100 });
    expect(estimateEyeCost("claude", usage)).toBe(0.0045);
  });

  it("keeps tenant identity and question fingerprint out of the client projection", () => {
    const event = buildEyeQuestionTelemetry({
      organizationId: "org-secret",
      reportVersionId: "version-1",
      question: "Is Alice the founder?",
      provider: "grok",
      model: "grok-test",
      usage: { inputTokens: 100, outputTokens: 20 },
      latencyMs: 123.6,
      route: { intent: "identity", reasoningMode: "trace" },
      answerBasis: "not_established",
      abstained: true,
      receiptCompleteness: { graphPath: true, contradictions: true, citations: true, complete: true },
    });
    const client = publicEyeTelemetry(event);
    expect(client).not.toHaveProperty("organizationId");
    expect(client).not.toHaveProperty("questionFingerprint");
    expect(client).not.toHaveProperty("question");
    expect(client.decisionLift).toBeNull();
  });

  it("derives decision lift only from explicit bounded analyst judgments", () => {
    expect(buildEyeDecisionLift({
      organizationId: "org-a",
      questionEventId: "question-1",
      reportVersionId: "version-1",
      analystId: "analyst-1",
      before: 35,
      after: 70,
      reason: "changed_confidence",
    }).lift).toBe(35);
    expect(() => buildEyeDecisionLift({
      organizationId: "org-a",
      questionEventId: "question-1",
      reportVersionId: "version-1",
      analystId: "analyst-1",
      before: 0,
      after: 101,
      reason: "changed_confidence",
    })).toThrow(/0 to 100/);
  });
});
