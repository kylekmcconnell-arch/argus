import { decisionCriticalChecks, summarizeChecks, type ScanCheck } from "./scanChecklist";

/**
 * Coverage below this floor is too thin to describe an assessment as
 * provisional. Only 100% applicable coverage is ever `ready`.
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
    readiness.unknown ? `${readiness.unknown} not completed` : "",
    readiness.providerUnavailable
      ? `${plural(readiness.providerUnavailable, "provider path")} unavailable`
      : "",
    readiness.stale ? `${readiness.stale} stale` : "",
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

  const status: DecisionReadinessStatus = !decisionFrameworkUnavailable
    && decisionBlockers === 0
    && applicable > 0
    && successful === applicable
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
      title: "Subject routing unresolved",
      guidance: "Provider checks recorded intelligence, but ARGUS did not resolve an evidence-backed role and scoring methodology. Treat this as collected intelligence only, not a decision-ready assessment.",
    };
  }

  if (scoringOutputIncomplete) {
    return {
      ...base,
      title: "Scoring output incomplete",
      guidance: "ARGUS resolved an evidence-backed role, but the analyst did not return a complete, valid governing-axis score. Treat the provider evidence as collected intelligence only until the scoring pass completes.",
    };
  }

  if (missingAxisSupport > 0) {
    // The title must agree with the computed status: a report that is still
    // "incomplete" (below the provisional coverage floor) must never present
    // itself with provisional wording.
    return {
      ...base,
      title: evidenceBackedAxes === 0
        ? "Decision evidence missing"
        : status === "provisional"
          ? "Assessment is provisional"
          : "Investigation incomplete",
      guidance: `${plural(missingAxisSupport, "governing axis", "governing axes")} ${missingAxisSupport === 1 ? "has" : "have"} no qualifying frozen support. ${status === "provisional"
        ? "Treat the score and verdict as provisional until the decision evidence is complete."
        : "Do not treat the score or verdict as decision-ready until the decision evidence is complete."}`,
    };
  }

  if (status === "ready") {
    return {
      ...base,
      title: coverage.findings > 0
        ? "Evidence coverage complete: findings require review"
        : "Evidence coverage complete",
      guidance: coverage.findings > 0
        ? `All ${plural(applicable, "applicable check")} have recorded outcomes, including ${plural(coverage.findings, "finding")}. Coverage is complete, but this is not an investment recommendation.`
        : `All ${plural(applicable, "applicable check")} have recorded outcomes. Review the underlying evidence before making an investment decision.`,
    };
  }

  if (applicable === 0) {
    return {
      ...base,
      title: "Investigation incomplete",
      guidance: "No applicable checks are defined for this report. Do not treat its score or verdict as investment-ready.",
    };
  }

  const gaps = gapDescription(base);
  const coverageStatement = `${successful} of ${applicable} applicable checks have recorded outcomes${gaps ? ` (${gaps})` : ""}.`;

  if (status === "provisional") {
    return {
      ...base,
      title: "Assessment is provisional",
      guidance: `${coverageStatement} Treat the score and verdict as provisional until the remaining evidence gaps are resolved.`,
    };
  }

  return {
    ...base,
    title: "Investigation incomplete",
    guidance: `${coverageStatement} Do not treat the score or verdict as investment-ready.`,
  };
}
