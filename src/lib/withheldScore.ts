import type { Dossier } from "../data/dossier";

// Why a saved report published no score.
//
// A withheld score is an honest outcome: the engine publishes INCOMPLETE with
// null totals rather than turning missing evidence into an adverse number. But
// the saved report used to render that outcome as a bare "N/A, not measured",
// which reads to a user as a broken product rather than as a stated coverage
// limit. The reason already exists in the frozen dossier (the routing state,
// the analyst check outcome, the axis coverage); this reads it back and says it
// in the report, so the reader knows whether to rescan, wait for a provider, or
// accept that the subject could not be routed at all.
//
// Every branch reports something the dossier actually recorded. When nothing
// in the record explains the gap, that is said plainly too, rather than
// inventing a cause.

const ANALYST_CHECK_IDS = new Set(["ai-analyst", "analyst", "decision-review"]);

/** The scan-time check row for the analyst pass, if the report froze one. */
function analystCheck(dossier: Pick<Dossier, "checkRuns">) {
  return (dossier.checkRuns ?? []).find((check) => {
    const id = (check.checkId ?? "").toLowerCase();
    if (ANALYST_CHECK_IDS.has(id)) return true;
    return /\banalyst\b/i.test(check.label ?? "");
  });
}

/**
 * One sentence explaining why this report carries no score, or null when it
 * does carry one. Reads only frozen fields, so it is stable for a saved
 * version and never re-derives a live opinion.
 */
export function withheldScoreReason(
  dossier: Pick<Dossier, "report" | "checkRuns" | "profile_collection_state" | "scoringOutcome"> | null | undefined,
): string | null {
  if (!dossier) return null;
  const report = dossier.report;
  if (!report) return null;
  if (typeof report.governing_score === "number") return null;

  const roles = report.roles ?? [];

  // The scan's own sentence about the scoring pass, frozen with the report,
  // is the most precise answer available and outranks anything inferred from
  // the surrounding state. Older reports predate the field and fall through.
  const outcome = dossier.scoringOutcome;
  if (outcome?.detail?.trim() && outcome.state !== "executed") {
    return `No score was published because the decision review that scores the evidence did not complete: ${outcome.detail.trim()}. The evidence it would have scored is still collected and shown below.`;
  }

  // 1. The account itself was never resolved by its provider. Nothing
  // downstream can route or score, so this outranks every other explanation.
  // Only an explicit "unavailable" counts: the field is optional, and an older
  // report that never recorded it must not be read as a failed profile read.
  if (dossier.profile_collection_state === "unavailable") {
    return "No score was published because the subject's own profile could not be read from its provider on this scan, so no methodology could be selected. This is a collection gap, not a finding about the subject; a rescan can close it.";
  }

  // 2. The profile was read but no provider-backed evidence selected a role.
  // Model role candidates stay visible as leads and never route on their own.
  if (roles.length === 0) {
    return "No score was published because no provider-backed evidence established what this subject is (project, person, token or investor), and ARGUS does not score a subject through a methodology it cannot justify. Model role candidates remain visible as leads only.";
  }

  // 3. A role was held, so the axes were requested, but the analyst pass that
  // scores them did not return a usable result.
  const analyst = analystCheck(dossier);
  if (analyst && (analyst.status === "unavailable" || analyst.status === "unknown")) {
    const note = (analyst.note ?? "").trim();
    return note
      ? `No score was published because the decision review that scores the evidence did not complete: ${note}. The evidence it would have scored is still collected and shown below.`
      : "No score was published because the decision review that scores the evidence did not complete on this scan. The evidence it would have scored is still collected and shown below.";
  }

  // 4. The roles were held and the analyst ran, but no axis carried a finite
  // score, so there was no weight to total.
  const coverage = report.score_coverage;
  if (coverage && coverage.assessedAxes === 0 && coverage.totalAxes > 0) {
    return `No score was published because none of the ${coverage.totalAxes} scoring dimensions for this methodology received a validated score on this scan. A partial scan still publishes its evidence; it does not publish a total it cannot support.`;
  }

  // 5. Some axes scored but the engine still withheld a total. Name them.
  if (coverage && coverage.missingAxes?.length) {
    const missing = coverage.missingAxes.slice(0, 3).join(", ");
    const more = coverage.missingAxes.length > 3 ? `, and ${coverage.missingAxes.length - 3} more` : "";
    return `No score was published because required scoring dimensions were left unmeasured on this scan (${missing}${more}). The dimensions that were measured are shown below.`;
  }

  // 6. Nothing in the record explains it. Say exactly that rather than
  // inventing a cause the report cannot support.
  return "No score was published on this scan, and the saved record does not state which step fell short. Rescanning re-runs the routing and decision review that produce the score.";
}
