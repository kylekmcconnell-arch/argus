import { clearanceCoverage, decisionCriticalChecks, summarizeChecks, type ScanCheck } from "./scanChecklist";

/**
 * Coverage below this floor is too thin to describe an assessment as
 * provisional. `ready` follows the full-clearance coverage policy in
 * scanChecklist (clearanceCoverage): every never-waive safety screen recorded
 * plus recorded coverage at the clearance floor; an enrichment gap does not
 * withhold clearance indefinitely, an unrecorded safety screen always does.
 */
export const PROVISIONAL_COVERAGE_FLOOR_PERCENT = 70;

export type DecisionReadinessStatus = "ready" | "provisional" | "incomplete";

export interface DecisionReadiness {
  status: DecisionReadinessStatus;
  coveragePercent: number;
  total: number;
  applicable: number;
  successful: number;
  unresolved: number;
  unknown: number;
  providerUnavailable: number;
  stale: number;
  notApplicable: number;
  findings: number;
  checkedEmpty: number;
  decisionAxisTotal: number | null;
  evidenceBackedAxes: number | null;
  decisionBlockers: number;
  title: string;
  guidance: string;
}

export interface DecisionReadinessContext {
  /** Governing methodology axes stored for this report. */
  decisionAxisTotal?: number;
  /** Governing axes with qualifying frozen support. */
  evidenceBackedAxes?: number;
  /** Evidence-backed subject roles selected before scoring. */
  roleCount?: number;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

function gapDescription(readiness: Pick<DecisionReadiness, "unknown" | "providerUnavailable" | "stale">): string {
  const gaps = [
    readiness.unknown ? `${readiness.unknown} did not finish` : "",
    readiness.providerUnavailable
      ? `${plural(readiness.providerUnavailable, "source")} unavailable`
      : "",
    readiness.stale ? `${readiness.stale} out of date` : "",
  ].filter(Boolean);

  return gaps.join("; ");
}

/**
 * Derive decision-readiness from stored check outcomes only. This deliberately
 * measures whether evidence was collected, not whether the evidence was clean:
 * a finding is a successful check execution and still requires human review.
 */
export function deriveDecisionReadiness(
  checks: readonly ScanCheck[],
  context: DecisionReadinessContext = {},
): DecisionReadiness {
  const readinessChecks = decisionCriticalChecks(checks);
  const coverage = summarizeChecks(readinessChecks);
  const applicable = coverage.inScope;
  const successful = coverage.successful;
  const decisionAxisTotal = typeof context.decisionAxisTotal === "number"
    ? Math.max(0, Math.floor(context.decisionAxisTotal))
    : null;
  const evidenceBackedAxes = typeof context.evidenceBackedAxes === "number"
    ? Math.max(0, Math.floor(context.evidenceBackedAxes))
    : null;
  const roleCount = typeof context.roleCount === "number"
    ? Math.max(0, Math.floor(context.roleCount))
    : null;
  const routingUnresolved = roleCount === 0;
  const scoringOutputIncomplete = roleCount !== null
    && roleCount > 0
    && decisionAxisTotal === 0;
  const decisionFrameworkUnavailable = routingUnresolved || scoringOutputIncomplete;
  const missingAxisSupport = decisionAxisTotal !== null && evidenceBackedAxes !== null
    ? Math.max(0, decisionAxisTotal - evidenceBackedAxes)
    : 0;
  const decisionBlockers = decisionFrameworkUnavailable ? 1 : missingAxisSupport;
  const unresolved = coverage.unknownOrFailed + decisionBlockers;

  // Floor rather than round so an unresolved check can never display as 100%.
  const checkCoveragePercent = applicable > 0
    ? Math.floor((successful / applicable) * 100)
    : 0;
  const axisCoveragePercent = decisionAxisTotal !== null && evidenceBackedAxes !== null
    ? decisionAxisTotal > 0
      ? Math.floor((Math.min(evidenceBackedAxes, decisionAxisTotal) / decisionAxisTotal) * 100)
      : 0
    : 100;
  const coveragePercent = decisionFrameworkUnavailable
    ? 0
    : Math.min(checkCoveragePercent, axisCoveragePercent);

  const clearance = clearanceCoverage(checks);
  const status: DecisionReadinessStatus = !decisionFrameworkUnavailable
    && decisionBlockers === 0
    && clearance.sufficient
    ? "ready"
    : !decisionFrameworkUnavailable && coveragePercent >= PROVISIONAL_COVERAGE_FLOOR_PERCENT
      ? "provisional"
      : "incomplete";

  const base: Omit<DecisionReadiness, "title" | "guidance"> = {
    status,
    coveragePercent,
    total: coverage.total,
    applicable,
    successful,
    unresolved,
    unknown: coverage.unknown,
    providerUnavailable: coverage.unavailable,
    stale: coverage.stale,
    notApplicable: coverage.notApplicable,
    findings: coverage.findings,
    checkedEmpty: coverage.checkedEmpty,
    decisionAxisTotal,
    evidenceBackedAxes,
    decisionBlockers,
  };

  if (routingUnresolved) {
    return {
      ...base,
      title: "ARGUS could not identify what this account represents",
      guidance: "Some checks finished, but ARGUS could not confirm whether this is a person, project, or investor. Use the facts as research, not as a final result.",
    };
  }

  if (scoringOutputIncomplete) {
    return {
      ...base,
      title: "The score is not ready",
      guidance: "ARGUS identified the subject, but part of the scoring step did not finish. You can still read the facts, but do not rely on the score yet.",
    };
  }

  if (missingAxisSupport > 0) {
    // The title must agree with the computed status: a report that is still
    // "incomplete" (below the provisional coverage floor) must never present
    // itself with provisional wording.
    return {
      ...base,
      title: evidenceBackedAxes === 0
        ? "The score is missing source support"
        : status === "provisional"
          ? "Review with gaps"
          : "Report not ready",
      guidance: `${plural(missingAxisSupport, "part of the score", "parts of the score")} ${missingAxisSupport === 1 ? "does" : "do"} not have a saved source. ${status === "provisional"
        ? "Treat the result as an early read until those sources are added."
        : "Do not rely on the result until those sources are added."}`,
    };
  }

  if (status === "ready") {
    if (successful === applicable) {
      return {
        ...base,
        title: coverage.findings > 0
          ? "Safety checks finished: review the warnings"
          : "Safety checks finished",
        guidance: coverage.findings > 0
          ? `All ${plural(applicable, "required check")} finished, and ${plural(coverage.findings, "warning")} ${coverage.findings === 1 ? "needs" : "need"} your review. Other questions are follow-ups, not failed safety checks. This is research, not financial advice.`
          : `All ${plural(applicable, "required check")} finished. Other questions are follow-ups, not failed safety checks. Read the sources before making a decision. This is not financial advice.`,
      };
    }
    // Clearance granted under the coverage policy with enrichment gaps waived.
    // The gaps stay disclosed; only their power to withhold clearance changed.
    const readyGaps = gapDescription(base);
    return {
      ...base,
      title: coverage.findings > 0
        ? "Safety checks finished: review the warnings"
        : "Safety checks finished",
      guidance: `${successful} of ${applicable} checks finished${readyGaps ? ` (${readyGaps})` : ""}. Every required safety check finished. The remaining questions may add detail, but they are not failed safety checks. This is research, not financial advice.`,
    };
  }

  if (applicable === 0) {
    return {
      ...base,
      title: "Report not ready",
      guidance: "No checks were available for this report. Do not rely on its score or result.",
    };
  }

  const gaps = gapDescription(base);
  const coverageStatement = `${successful} of ${applicable} checks finished${gaps ? ` (${gaps})` : ""}.`;

  if (status === "provisional") {
    return {
      ...base,
      title: "Review with gaps",
      guidance: `${coverageStatement} Treat the result as an early read until the open checks finish.`,
    };
  }

  return {
    ...base,
    title: "Report not ready",
    guidance: `${coverageStatement} Do not rely on the score or result yet.`,
  };
}
