import type { Dossier } from "../data/dossier";

/** Presentation only: never changes saved scores or evidence. */
export function scoringAccessFailure(dossier: Pick<Dossier, "scoringOutcome" | "providerFailures">, scoringIncomplete: boolean): string | undefined {
  if (!scoringIncomplete) return undefined;
  const failure = dossier.scoringOutcome?.failure;
  let status: number | undefined = failure?.kind === "provider_access" ? failure.httpStatus : undefined;
  // Older snapshots have only the physical-call ledger. Do not infer a scoring
  // failure from unrelated collection operations or a successful fallback.
  if (!dossier.scoringOutcome?.failure) {
    const rejected = dossier.providerFailures?.find((row) => row.provider === "grok" && row.op === "record_verdict" && row.failed > 0 && /\bhttp[_ ](401|403)\b/i.test(row.meta ?? ""));
    status = rejected ? Number(rejected.meta?.match(/\bhttp[_ ](401|403)\b/i)?.[1]) : undefined;
  }
  return status === 401 || status === 403
    ? `Grok rejected the scoring request (HTTP ${status}). An administrator must restore provider access before retrying. Saved sources remain available. This is a system failure, not an adverse finding about the project.`
    : undefined;
}
