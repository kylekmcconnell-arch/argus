import { CLEARANCE_COVERAGE_FLOOR_PERCENT, NEVER_WAIVE_CHECK_IDS } from "./scanChecklist";

export type PublicCompleteness = "complete" | "partial" | "failed";

export interface PublicReportPresentation {
  rawVerdict: string;
  displayVerdict: string;
  resultLabel: "VERDICT" | "RISK SIGNAL" | "DECISION READINESS";
  readinessLabel: "EVIDENCE COVERAGE COMPLETE" | "ASSESSMENT PROVISIONAL" | "INVESTIGATION INCOMPLETE" | "INVESTIGATION FAILED" | "DECISION OUTPUT INCOMPLETE";
  coverageLabel: "COMPLETE COVERAGE" | "PARTIAL COVERAGE" | "FAILED COVERAGE";
  color: string;
  primaryScore: string;
  scoreLabel: "SCORE" | "PROVISIONAL SCORE" | "MODEL SCORE" | null;
  secondarySignal: string | null;
  note: string;
  final: boolean;
}

export interface PublicReportReadinessSummary {
  status: "ready" | "provisional" | "incomplete";
  coveragePercent: number;
  roleCount: number;
  decisionAxisTotal: number | null;
  evidenceBackedAxes: number | null;
  neededEvidenceSummary: string;
}

const VERDICT_COLORS: Readonly<Record<string, string>> = Object.freeze({
  PASS: "#16a34a",
  CAUTION: "#d97706",
  FAIL: "#ea580c",
  AVOID: "#dc2626",
  UNVERIFIABLE_IDENTITY: "#7c3aed",
  INCOMPLETE: "#a1a1aa",
  PROVISIONAL: "#d97706",
});

const ADVERSE_VERDICTS = new Set([
  "CAUTION",
  "FAIL",
  "AVOID",
  "UNVERIFIABLE_IDENTITY",
]);

const FINAL_VERDICTS = new Set([
  "PASS",
  ...ADVERSE_VERDICTS,
]);

function normalizedVerdict(value: unknown): string {
  if (typeof value !== "string") return "INCOMPLETE";
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_").slice(0, 50);
  return normalized || "INCOMPLETE";
}

function normalizedCompleteness(value: unknown): PublicCompleteness {
  if (value === "complete" || value === "failed") return value;
  return "partial";
}

const TRUSTED_ATTESTATIONS = new Set(["server_collected", "analyst_submitted"]);
const SUCCESSFUL_CHECK_STATES = new Set(["confirmed", "finding", "checked-empty", "complete"]);

function checkRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function checkIsStale(check: Record<string, unknown>, nowMs: number): boolean {
  const deadline = check.stale_at ?? check.staleAt;
  if (typeof deadline !== "string" || !deadline.trim()) return false;
  const deadlineMs = Date.parse(deadline);
  return Number.isFinite(deadlineMs) && deadlineMs <= nowMs;
}

function checkDecisionCriticality(value: unknown): boolean | undefined {
  const check = checkRecord(value);
  const metadata = checkRecord(check.metadata);
  const criticality = typeof check.decisionCritical === "boolean"
    ? check.decisionCritical
    : metadata.decisionCritical;
  return typeof criticality === "boolean" ? criticality : undefined;
}

/** Cross-check a stored completeness claim against its frozen check outcomes. */
export function coverageQualifiedCompleteness(input: {
  completeness: unknown;
  attestation?: unknown;
  checks?: readonly unknown[];
}): PublicCompleteness {
  const completeness = normalizedCompleteness(input.completeness);
  if (completeness === "failed") return "failed";
  if (input.attestation !== undefined && !TRUSTED_ATTESTATIONS.has(input.attestation as string)) {
    return "partial";
  }
  if (input.checks === undefined) return completeness;

  const hasExplicitCriticality = input.checks.some((value) => checkDecisionCriticality(value) !== undefined);
  const governingChecks = hasExplicitCriticality
    ? input.checks.filter((value) => checkDecisionCriticality(value) === true)
    : input.checks;
  const applicable = governingChecks.filter((value) => {
    const check = checkRecord(value);
    const metadata = checkRecord(check.metadata);
    return check.status !== "not-applicable"
      && check.state !== "not-applicable"
      && check.notApplicable !== true
      && metadata.notApplicable !== true;
  });
  if (!applicable.length) return "partial";
  // Full-clearance coverage policy (mirrors clearanceCoverage in scanChecklist):
  // every never-waive safety screen recorded, plus recorded coverage at the
  // clearance floor. An enrichment gap no longer withholds completeness
  // indefinitely; an unrecorded sanctions / identity / trust-graph screen
  // always does. Frozen rows without stable check ids keep the strict
  // everything-recorded rule.
  const nowMs = Date.now();
  const rows = applicable.map((value) => {
    const check = checkRecord(value);
    const id = typeof check.checkId === "string"
      ? check.checkId
      : typeof check.check_id === "string"
        ? check.check_id
        : "";
    const recorded = !checkIsStale(check, nowMs)
      && SUCCESSFUL_CHECK_STATES.has(String(check.status ?? check.state ?? ""));
    return { id, recorded };
  });
  const hasStableIds = rows.some((row) => row.id);
  const recordedCount = rows.filter((row) => row.recorded).length;
  const openNeverWaive = hasStableIds
    && rows.some((row) => row.id && NEVER_WAIVE_CHECK_IDS.has(row.id) && !row.recorded);
  const recordedPercent = Math.floor((recordedCount / rows.length) * 100);
  const coverageSufficient = hasStableIds
    ? !openNeverWaive && recordedPercent >= CLEARANCE_COVERAGE_FLOOR_PERCENT
    : recordedCount === rows.length;
  return completeness === "complete" && coverageSufficient ? "complete" : "partial";
}

export function publicScoreLabel(value: unknown): string {
  const score = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(score) || score < 0 || score > 100) return "";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function visibleVerdict(value: string): string {
  return value === "UNVERIFIABLE_IDENTITY" ? "UNVERIFIABLE" : value;
}

function modelSignal(verdict: string, score: string, prefix: string): string {
  return `${prefix} · ${visibleVerdict(verdict)}${score ? ` ${score}/100` : ""}`;
}

function scoreMatchesVerdict(verdict: string, score: string): boolean {
  if (!score) return false;
  const value = Number(score);
  if (verdict === "PASS") return value >= 70 && value <= 100;
  if (verdict === "CAUTION") return value >= 40 && value < 70;
  if (verdict === "FAIL") return value >= 0 && value < 40;
  if (verdict === "AVOID") return value >= 0 && value <= 10;
  // Identity blocks are preserved as risk signals, not final numeric verdicts.
  return false;
}

function strictNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function cleanNeededEvidenceSummary(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

function qualifiesForProvisionalPass(
  rawVerdict: string,
  score: string,
  readiness: PublicReportReadinessSummary | undefined,
): readiness is PublicReportReadinessSummary {
  if (!readiness || rawVerdict !== "PASS" || !scoreMatchesVerdict(rawVerdict, score)) return false;
  const coveragePercent = strictNonNegativeInteger(readiness.coveragePercent);
  const roleCount = strictNonNegativeInteger(readiness.roleCount);
  const decisionAxisTotal = strictNonNegativeInteger(readiness.decisionAxisTotal);
  const evidenceBackedAxes = strictNonNegativeInteger(readiness.evidenceBackedAxes);
  return readiness.status === "provisional"
    && coveragePercent !== null
    && coveragePercent >= 70
    && coveragePercent < 100
    && roleCount !== null
    && roleCount > 0
    && decisionAxisTotal !== null
    && decisionAxisTotal > 0
    && evidenceBackedAxes === decisionAxisTotal
    && Boolean(cleanNeededEvidenceSummary(readiness.neededEvidenceSummary));
}

/**
 * One fail-closed presentation contract for every public ARGUS surface.
 *
 * Coverage answers whether the assessment is decision-ready; verdict answers
 * what the scored evidence found. Thin positive evidence can never become
 * public clearance. Existing adverse evidence remains visible, but is labelled
 * as a risk signal until the investigation has complete coverage.
 */
export function presentPublicReport(input: {
  verdict: unknown;
  score: unknown;
  completeness: unknown;
  attestation?: unknown;
  checks?: readonly unknown[];
  readiness?: PublicReportReadinessSummary;
}): PublicReportPresentation {
  const rawVerdict = normalizedVerdict(input.verdict);
  const completeness = coverageQualifiedCompleteness({
    completeness: input.completeness,
    attestation: input.attestation,
    ...(input.checks !== undefined ? { checks: input.checks } : {}),
  });
  const score = publicScoreLabel(input.score);
  const adverse = ADVERSE_VERDICTS.has(rawVerdict);
  const coverageLabel = completeness === "complete"
    ? "COMPLETE COVERAGE"
    : completeness === "failed"
      ? "FAILED COVERAGE"
      : "PARTIAL COVERAGE";
  const readinessLabel = completeness === "complete"
    ? "EVIDENCE COVERAGE COMPLETE"
    : completeness === "failed"
      ? "INVESTIGATION FAILED"
      : "INVESTIGATION INCOMPLETE";

  if (completeness !== "complete") {
    if (completeness === "partial" && qualifiesForProvisionalPass(rawVerdict, score, input.readiness)) {
      const axisTotal = input.readiness.decisionAxisTotal;
      const neededEvidenceSummary = cleanNeededEvidenceSummary(input.readiness.neededEvidenceSummary);
      return Object.freeze({
        rawVerdict,
        displayVerdict: "PROVISIONAL",
        resultLabel: "DECISION READINESS",
        readinessLabel: "ASSESSMENT PROVISIONAL",
        coverageLabel,
        color: VERDICT_COLORS.PROVISIONAL,
        primaryScore: score,
        scoreLabel: "PROVISIONAL SCORE",
        secondarySignal: "PASS SIGNAL",
        note: `All ${axisTotal} governing axes have frozen evidence support. ${neededEvidenceSummary} Final clearance remains withheld.`,
        final: false,
      });
    }

    if (adverse) {
      const consistentScore = scoreMatchesVerdict(rawVerdict, score) ? score : "";
      return Object.freeze({
        rawVerdict,
        displayVerdict: visibleVerdict(rawVerdict),
        resultLabel: "RISK SIGNAL",
        readinessLabel,
        coverageLabel,
        color: VERDICT_COLORS[rawVerdict] ?? VERDICT_COLORS.INCOMPLETE,
        primaryScore: consistentScore,
        scoreLabel: consistentScore ? "MODEL SCORE" : null,
        secondarySignal: null,
        note: score && !consistentScore
          ? "A material risk signal was recorded, but its stored score conflicts with the verdict and coverage is incomplete."
          : completeness === "failed"
            ? "A material risk signal was recorded, but the investigation failed before coverage could be completed."
            : "A material risk signal was recorded, but missing coverage prevents a complete assessment.",
        final: false,
      });
    }

    const hasPreliminarySignal = rawVerdict === "PASS" || rawVerdict === "PROVISIONAL";
    return Object.freeze({
      rawVerdict,
      displayVerdict: "INCOMPLETE",
      resultLabel: "DECISION READINESS",
      readinessLabel,
      coverageLabel,
      color: VERDICT_COLORS.INCOMPLETE,
      primaryScore: "",
      scoreLabel: null,
      secondarySignal: hasPreliminarySignal
        ? modelSignal(
            rawVerdict,
            rawVerdict === "PASS" && !scoreMatchesVerdict(rawVerdict, score) ? "" : score,
            "PRELIMINARY MODEL SIGNAL",
          )
        : null,
      note: completeness === "failed"
        ? "The investigation failed before ARGUS could publish a decision-ready assessment."
        : "Evidence coverage is incomplete. Do not treat the preliminary score as investment clearance.",
      final: false,
    });
  }

  if (!FINAL_VERDICTS.has(rawVerdict)) {
    const recognizedNonFinal = rawVerdict === "INCOMPLETE" || rawVerdict === "PROVISIONAL";
    return Object.freeze({
      rawVerdict,
      displayVerdict: recognizedNonFinal ? rawVerdict : "INCOMPLETE",
      resultLabel: "DECISION READINESS",
      readinessLabel: "DECISION OUTPUT INCOMPLETE",
      coverageLabel,
      color: recognizedNonFinal
        ? VERDICT_COLORS[rawVerdict] ?? VERDICT_COLORS.INCOMPLETE
        : VERDICT_COLORS.INCOMPLETE,
      primaryScore: "",
      scoreLabel: null,
      secondarySignal: null,
      note: recognizedNonFinal
        ? "The evidence checks completed, but ARGUS did not publish a final scored verdict."
        : "The stored verdict is not a recognized ARGUS decision state, so no public verdict can be published.",
      final: false,
    });
  }

  if (!scoreMatchesVerdict(rawVerdict, score)) {
    if (adverse) {
      return Object.freeze({
        rawVerdict,
        displayVerdict: visibleVerdict(rawVerdict),
        resultLabel: "RISK SIGNAL",
        readinessLabel: "DECISION OUTPUT INCOMPLETE",
        coverageLabel,
        color: VERDICT_COLORS[rawVerdict] ?? VERDICT_COLORS.INCOMPLETE,
        primaryScore: "",
        scoreLabel: null,
        secondarySignal: null,
        note: score
          ? "A material risk verdict conflicts with its stored score. Preserve the warning, but do not treat it as a complete assessment."
          : "A material risk verdict was stored without a valid score. Preserve the warning, but do not treat it as a complete assessment.",
        final: false,
      });
    }

    return Object.freeze({
      rawVerdict,
      displayVerdict: "INCOMPLETE",
      resultLabel: "DECISION READINESS",
      readinessLabel: "DECISION OUTPUT INCOMPLETE",
      coverageLabel,
      color: VERDICT_COLORS.INCOMPLETE,
      primaryScore: "",
      scoreLabel: null,
      secondarySignal: null,
      note: score
        ? "The stored verdict conflicts with its score band. ARGUS cannot publish investment clearance."
        : "Evidence coverage is complete, but no valid score was stored. ARGUS cannot publish investment clearance.",
      final: false,
    });
  }

  return Object.freeze({
    rawVerdict,
    displayVerdict: visibleVerdict(rawVerdict),
    resultLabel: "VERDICT",
    readinessLabel: "EVIDENCE COVERAGE COMPLETE",
    coverageLabel,
    color: VERDICT_COLORS[rawVerdict] ?? "#38e1c4",
    primaryScore: score,
    scoreLabel: score ? "SCORE" : null,
    secondarySignal: null,
    note: "Evidence coverage is complete. Review the underlying sources before making an investment decision.",
    final: true,
  });
}

export function exactReportPath(reportVersionId: string): string {
  return `/?version=${encodeURIComponent(reportVersionId)}`;
}

export function publicReportTitle(subject: string, presentation: PublicReportPresentation): string {
  const score = presentation.primaryScore ? ` · ${presentation.primaryScore}/100` : "";
  const readiness = presentation.final ? "" : ` · ${presentation.readinessLabel.toLowerCase()}`;
  return `${subject} · ${presentation.displayVerdict}${score}${readiness} · ARGUS`;
}

export function publicReportDescription(
  headline: string,
  attestation: string,
  presentation: PublicReportPresentation,
): string {
  const decisionContext = presentation.final
    ? [headline, presentation.note]
    : [presentation.note, headline];
  return [...decisionContext, presentation.coverageLabel, attestation]
    .filter(Boolean)
    .join(" · ");
}
