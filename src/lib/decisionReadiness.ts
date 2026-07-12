import { summarizeChecks, type ScanCheck } from "./scanChecklist";

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
  title: string;
  guidance: string;
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
export function deriveDecisionReadiness(checks: readonly ScanCheck[]): DecisionReadiness {
  const coverage = summarizeChecks(checks);
  const applicable = coverage.inScope;
  const successful = coverage.successful;
  const unresolved = coverage.unknownOrFailed;

  // Floor rather than round so an unresolved check can never display as 100%.
  const coveragePercent = applicable > 0
    ? Math.floor((successful / applicable) * 100)
    : 0;

  const status: DecisionReadinessStatus = applicable > 0 && successful === applicable
    ? "ready"
    : coveragePercent >= PROVISIONAL_COVERAGE_FLOOR_PERCENT
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
  };

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
