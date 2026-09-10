export type EvidenceAttemptOutcome = "accepted" | "source_supported" | "rejected" | "fetch_failed" | "budget_deferred";
export interface EvidenceAttempt {
  questionId: string;
  sourceUrl: string;
  predicate: string;
  outcome: EvidenceAttemptOutcome;
  reason: string;
}
/** Never pay to repeat a semantic rejection against the same unchanged source. */
export function evidenceRetryPlan(attempts: readonly EvidenceAttempt[]) {
  const groups = new Map<string, EvidenceAttempt[]>();
  for (const attempt of attempts) {
    const key = attempt.questionId || attempt.predicate;
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }
  return [...groups].flatMap(([questionId, rows]) => {
    if (rows.some(r => r.outcome === "accepted")) return [];
    const transient = rows.some(r => r.outcome === "fetch_failed" && !/unsafe|unsupported|rejected/.test(r.reason));
    const deferred = rows.some(r => r.outcome === "budget_deferred");
    return [{ questionId, action: transient ? "retry_retrieval" : deferred ? "fetch_deferred_source" : "find_alternate_source", reasons: [...new Set(rows.map(r => r.reason))], sourceUrls: [...new Set(rows.map(r => r.sourceUrl))], estimatedCostUsd: null }];
  });
}

export function evidenceRetryReason(reason: string): string {
  const labels: Record<string,string> = {
    non_atomic_claim: "The candidate combines claims that must be checked separately",
    missing_event_attribution: "The event or affected entity was not specified",
    no_supporting_passage: "The fetched page did not support the candidate claim",
    no_governing_claim: "The claim could not be tied to the subject in the same passage",
    subject_binding_failed: "The source could not be tied to this exact subject",
    uncertain_relationship: "The source describes an uncertain relationship",
    venture_token_binding_failed: "Ownership of the venture token was not established",
    token_language_missing: "The source does not identify an official crypto token",
    value_not_supported: "The claimed value was not supported by the source",
    event_attribution_not_supported: "The source did not establish the event's status and affected entity",
    source_budget: "This source was deferred when the scan reached its retrieval budget",
    source_supported: "The claim has source support but still needs verification",
  };
  return labels[reason] ?? "The source could not be retrieved or verified; see its check record";
}
