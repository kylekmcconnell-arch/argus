export type EyeAdjudication = "supported" | "partly_supported" | "unsupported" | "unreviewed";

export type BetaQualityRow =
  | {
    type: "participant";
    participantId: string;
    invitedAt: string;
    signedUpAt?: string;
    firstInvestigationStartedAt?: string;
    firstInvestigationCompletedAt?: string;
  }
  | {
    type: "investigation";
    participantId: string;
    reportVersionId: string;
    reportType: string;
    completedAt?: string;
    providerFailures: number;
  }
  | {
    type: "eye_question";
    participantId: string;
    questionId: string;
    reportVersionId: string;
    substantive: boolean;
    adjudication: EyeAdjudication;
    confidenceBefore?: number;
    confidenceAfter?: number;
    decisionChanged?: boolean;
  }
  | {
    type: "provider_cost";
    reportVersionId: string;
    provider: string;
    calls: number;
    usd: number;
  }
  | {
    type: "feedback";
    participantId: string;
    feedbackId: string;
    tags: string[];
  };

export interface BetaQualitySummary {
  invited: number;
  signedUp: number;
  signupRate: number | null;
  startedFirstInvestigation: number;
  completedFirstInvestigation: number;
  signupToFirstInvestigationRate: number | null;
  medianMinutesToFirstCompletedReport: number | null;
  completedInvestigations: number;
  investigationCompletionRate: number | null;
  providerFailureRate: number | null;
  substantiveEyeQuestions: number;
  adjudicatedEyeQuestions: number;
  unsupportedClaimRate: number | null;
  partlySupportedClaimRate: number | null;
  averageConfidenceLift: number | null;
  decisionChangeRate: number | null;
  totalMeasuredCostUsd: number;
  costPerCompletedInvestigationUsd: number | null;
  costByProvider: Record<string, number>;
  confusionTags: Record<string, number>;
  exitCriteria: {
    tenCompletedFirstInvestigations: boolean;
    firstHundredQuestionsAdjudicated: boolean;
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("row must be an object");
  return value as Record<string, unknown>;
}

function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalTimestamp(row: Record<string, unknown>, key: string): void {
  const value = row[key];
  if (value !== undefined && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) {
    throw new Error(`${key} must be an ISO timestamp`);
  }
}

export function parseBetaQualityRow(value: unknown): BetaQualityRow {
  const row = object(value);
  const type = requiredText(row, "type");
  if (type === "participant") {
    requiredText(row, "participantId");
    requiredText(row, "invitedAt");
    for (const key of ["invitedAt", "signedUpAt", "firstInvestigationStartedAt", "firstInvestigationCompletedAt"]) optionalTimestamp(row, key);
  } else if (type === "investigation") {
    requiredText(row, "participantId");
    requiredText(row, "reportVersionId");
    requiredText(row, "reportType");
    optionalTimestamp(row, "completedAt");
    if (!Number.isInteger(row.providerFailures) || (row.providerFailures as number) < 0) throw new Error("providerFailures must be a non-negative integer");
  } else if (type === "eye_question") {
    requiredText(row, "participantId");
    requiredText(row, "questionId");
    requiredText(row, "reportVersionId");
    if (typeof row.substantive !== "boolean") throw new Error("substantive must be boolean");
    if (!["supported", "partly_supported", "unsupported", "unreviewed"].includes(String(row.adjudication))) throw new Error("adjudication is invalid");
    for (const key of ["confidenceBefore", "confidenceAfter"]) {
      const score = row[key];
      if (score !== undefined && (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5)) throw new Error(`${key} must be an integer from 1 to 5`);
    }
    if (row.decisionChanged !== undefined && typeof row.decisionChanged !== "boolean") throw new Error("decisionChanged must be boolean");
  } else if (type === "provider_cost") {
    requiredText(row, "reportVersionId");
    requiredText(row, "provider");
    if (!Number.isInteger(row.calls) || (row.calls as number) < 0) throw new Error("calls must be a non-negative integer");
    if (typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd < 0) throw new Error("usd must be a non-negative number");
  } else if (type === "feedback") {
    requiredText(row, "participantId");
    requiredText(row, "feedbackId");
    if (!Array.isArray(row.tags) || !row.tags.length || !row.tags.every((tag) => typeof tag === "string" && tag.trim())) throw new Error("tags must contain non-empty strings");
  } else {
    throw new Error(`unknown row type: ${type}`);
  }
  return row as BetaQualityRow;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeBetaQuality(rows: BetaQualityRow[]): BetaQualitySummary {
  const participants = rows.filter((row): row is Extract<BetaQualityRow, { type: "participant" }> => row.type === "participant");
  const investigations = rows.filter((row): row is Extract<BetaQualityRow, { type: "investigation" }> => row.type === "investigation");
  const questions = rows.filter((row): row is Extract<BetaQualityRow, { type: "eye_question" }> => row.type === "eye_question" && row.substantive);
  const costs = rows.filter((row): row is Extract<BetaQualityRow, { type: "provider_cost" }> => row.type === "provider_cost");
  const feedback = rows.filter((row): row is Extract<BetaQualityRow, { type: "feedback" }> => row.type === "feedback");

  const signedUp = participants.filter((row) => row.signedUpAt);
  const started = participants.filter((row) => row.firstInvestigationStartedAt);
  const completedFirst = participants.filter((row) => row.firstInvestigationCompletedAt);
  const minutesToComplete = completedFirst.flatMap((row) => {
    if (!row.signedUpAt || !row.firstInvestigationCompletedAt) return [];
    const elapsed = Date.parse(row.firstInvestigationCompletedAt) - Date.parse(row.signedUpAt);
    return Number.isFinite(elapsed) && elapsed >= 0 ? [elapsed / 60_000] : [];
  });
  const completedInvestigations = investigations.filter((row) => row.completedAt);
  const adjudicated = questions.filter((row) => row.adjudication !== "unreviewed");
  const unsupported = adjudicated.filter((row) => row.adjudication === "unsupported");
  const partlySupported = adjudicated.filter((row) => row.adjudication === "partly_supported");
  const confidenceLifts = adjudicated.flatMap((row) =>
    typeof row.confidenceBefore === "number" && typeof row.confidenceAfter === "number"
      ? [row.confidenceAfter - row.confidenceBefore]
      : []);
  const decisionRows = adjudicated.filter((row) => typeof row.decisionChanged === "boolean");
  const costByProvider: Record<string, number> = {};
  for (const row of costs) costByProvider[row.provider] = (costByProvider[row.provider] ?? 0) + row.usd;
  const totalMeasuredCostUsd = costs.reduce((sum, row) => sum + row.usd, 0);
  const confusionTags: Record<string, number> = {};
  for (const row of feedback) {
    for (const tag of new Set(row.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))) {
      confusionTags[tag] = (confusionTags[tag] ?? 0) + 1;
    }
  }

  return {
    invited: participants.length,
    signedUp: signedUp.length,
    signupRate: rate(signedUp.length, participants.length),
    startedFirstInvestigation: started.length,
    completedFirstInvestigation: completedFirst.length,
    signupToFirstInvestigationRate: rate(started.length, signedUp.length),
    medianMinutesToFirstCompletedReport: median(minutesToComplete),
    completedInvestigations: completedInvestigations.length,
    investigationCompletionRate: rate(completedInvestigations.length, investigations.length),
    providerFailureRate: rate(investigations.filter((row) => row.providerFailures > 0).length, investigations.length),
    substantiveEyeQuestions: questions.length,
    adjudicatedEyeQuestions: adjudicated.length,
    unsupportedClaimRate: rate(unsupported.length, adjudicated.length),
    partlySupportedClaimRate: rate(partlySupported.length, adjudicated.length),
    averageConfidenceLift: confidenceLifts.length
      ? confidenceLifts.reduce((sum, value) => sum + value, 0) / confidenceLifts.length
      : null,
    decisionChangeRate: rate(decisionRows.filter((row) => row.decisionChanged).length, decisionRows.length),
    totalMeasuredCostUsd,
    costPerCompletedInvestigationUsd: completedInvestigations.length
      ? totalMeasuredCostUsd / completedInvestigations.length
      : null,
    costByProvider,
    confusionTags,
    exitCriteria: {
      tenCompletedFirstInvestigations: completedFirst.length >= 10,
      firstHundredQuestionsAdjudicated: questions.length > 0 && adjudicated.length >= Math.min(100, questions.length),
    },
  };
}
