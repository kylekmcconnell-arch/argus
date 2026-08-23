import { createHmac, randomUUID } from "node:crypto";

export type EyeProvider = "grok" | "claude";
export type EyeAnswerBasis = "cited_evidence" | "project_attribution" | "coverage_record" | "not_established";

export interface EyeUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface EyeReceiptCompleteness {
  graphPath: boolean;
  contradictions: boolean;
  citations: boolean;
  complete: boolean;
}

/**
 * Append-only operational event. It deliberately excludes question/answer text,
 * dialogue history, source excerpts, URLs, credentials, and provider payloads.
 */
export interface EyeQuestionTelemetryEvent {
  schemaVersion: "argus-eye-question.v1";
  eventId: string;
  occurredAt: string;
  organizationId: string;
  reportVersionId: string;
  questionFingerprint: string | null;
  provider: EyeProvider;
  model: string;
  usage: EyeUsage;
  latencyMs: number;
  estimatedCostUsd: number | null;
  rateCard: "argus-2026-08-22";
  route: {
    intent: string | null;
    reasoningMode: string | null;
  };
  answerBasis: EyeAnswerBasis | null;
  abstained: boolean;
  receiptCompleteness: EyeReceiptCompleteness;
}

export interface EyeDecisionLiftEvent {
  schemaVersion: "argus-eye-decision-lift.v1";
  eventId: string;
  occurredAt: string;
  organizationId: string;
  questionEventId: string;
  reportVersionId: string;
  analystId: string;
  before: number;
  after: number;
  lift: number;
  reason: "changed_action" | "changed_confidence" | "confirmed_view" | "no_change";
}

const RATE_USD_PER_TOKEN: Record<EyeProvider, { input: number; output: number }> = {
  grok: { input: 0.2 / 1_000_000, output: 0.5 / 1_000_000 },
  claude: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

const safeCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

export function claudeUsageFromMessages(data: unknown): EyeUsage {
  const usage = data && typeof data === "object" && "usage" in data
    ? (data as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage
    : undefined;
  return { inputTokens: safeCount(usage?.input_tokens), outputTokens: safeCount(usage?.output_tokens) };
}

export function normalizeGrokUsage(usage: { input_tokens?: number; output_tokens?: number }): EyeUsage {
  return { inputTokens: safeCount(usage.input_tokens), outputTokens: safeCount(usage.output_tokens) };
}

export function estimateEyeCost(provider: EyeProvider, usage: EyeUsage): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  const rate = RATE_USD_PER_TOKEN[provider];
  return Number((usage.inputTokens * rate.input + usage.outputTokens * rate.output).toFixed(8));
}

export function fingerprintQuestion(question: string, organizationId: string, secret = process.env.ARGUS_TELEMETRY_HASH_KEY): string | null {
  if (!secret?.trim()) return null;
  return createHmac("sha256", secret).update(`${organizationId}\0${question.trim()}`).digest("hex");
}

export function buildEyeQuestionTelemetry(input: {
  organizationId: string;
  reportVersionId: string;
  question: string;
  provider: EyeProvider;
  model: string;
  usage: EyeUsage;
  latencyMs: number;
  route: unknown;
  answerBasis: EyeAnswerBasis | null;
  abstained: boolean;
  receiptCompleteness: EyeReceiptCompleteness;
}): EyeQuestionTelemetryEvent {
  const route = input.route && typeof input.route === "object" ? input.route as Record<string, unknown> : {};
  const routeText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
  return {
    schemaVersion: "argus-eye-question.v1",
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId,
    reportVersionId: input.reportVersionId,
    questionFingerprint: fingerprintQuestion(input.question, input.organizationId),
    provider: input.provider,
    model: input.model,
    usage: input.usage,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    estimatedCostUsd: estimateEyeCost(input.provider, input.usage),
    rateCard: "argus-2026-08-22",
    route: { intent: routeText(route.intent), reasoningMode: routeText(route.reasoningMode) },
    answerBasis: input.answerBasis,
    abstained: input.abstained,
    receiptCompleteness: input.receiptCompleteness,
  };
}

/** Client-safe projection; organization identity and cross-request fingerprint stay server-side. */
export function publicEyeTelemetry(event: EyeQuestionTelemetryEvent) {
  return {
    eventId: event.eventId,
    provider: event.provider,
    model: event.model,
    usage: event.usage,
    latencyMs: event.latencyMs,
    estimatedCostUsd: event.estimatedCostUsd,
    rateCard: event.rateCard,
    route: event.route,
    answerBasis: event.answerBasis,
    abstained: event.abstained,
    receiptCompleteness: event.receiptCompleteness,
    decisionLift: null,
  };
}

/** Decision lift is accepted only as a bounded, explicit analyst judgment. */
export function buildEyeDecisionLift(input: {
  organizationId: string;
  questionEventId: string;
  reportVersionId: string;
  analystId: string;
  before: number;
  after: number;
  reason: EyeDecisionLiftEvent["reason"];
}): EyeDecisionLiftEvent {
  if (!Number.isInteger(input.before) || !Number.isInteger(input.after)
    || input.before < 0 || input.before > 100 || input.after < 0 || input.after > 100) {
    throw new Error("Decision judgments must be integer analyst ratings from 0 to 100.");
  }
  return {
    schemaVersion: "argus-eye-decision-lift.v1",
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId,
    questionEventId: input.questionEventId,
    reportVersionId: input.reportVersionId,
    analystId: input.analystId,
    before: input.before,
    after: input.after,
    lift: input.after - input.before,
    reason: input.reason,
  };
}
