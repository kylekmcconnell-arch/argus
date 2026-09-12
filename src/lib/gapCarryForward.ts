import type { CheckStatus, ScanCheck } from "./scanChecklist";
import type { ResearchPlan } from "./researchDirector";

export const GAP_CARRY_FORWARD_SCHEMA_VERSION = 1 as const;

/**
 * A scoped gap follow-up re-runs a bounded slice of the collector. Everything it
 * was not authorized to assess comes back absent, not disproven, so the fresh
 * dossier alone is never a safe replacement for the source version.
 *
 * This module merges the two evidence sets under one rule: a check the
 * follow-up did not assess keeps the source version's outcome, its original
 * observation time and an explicit carry-forward provenance stamp. A carried
 * row is never presented as newly measured, and the merge reports exactly what
 * was recovered, reconfirmed, carried, still open or regressed so an analyst can
 * see the trade before promoting anything.
 */

/** Statuses that record an outcome the collector actually observed. */
const SETTLED_STATUSES: ReadonlySet<CheckStatus> = new Set([
  "confirmed",
  "reported",
  "finding",
  "checked-empty",
]);

const DEFAULT_FRESHNESS_HORIZON_DAYS = 90;

export type CarryForwardDisposition =
  /** Selected for the retry and closed by it. */
  | "recovered"
  /** Selected for the retry and settled both before and after. */
  | "reconfirmed"
  /** Selected for the retry and still without an outcome. */
  | "still_open"
  /** Selected for the retry, settled in the source, and the retry did not reproduce it. */
  | "retry_regressed"
  /** Outside the authorized scope; the source outcome is carried with provenance. */
  | "carried_forward"
  /** Carried, but the original observation is outside its freshness window. */
  | "carried_stale"
  /** Outside the authorized scope and open in the source version too. */
  | "not_selected_open"
  /** Present only in the fresh run. */
  | "newly_measured"
  /** Carried, and the check does not apply to this subject. */
  | "not_applicable";

export interface CarriedEvidenceProvenance {
  schemaVersion: typeof GAP_CARRY_FORWARD_SCHEMA_VERSION;
  /** The immutable version this outcome was actually measured in. */
  sourceReportVersionId: string;
  /** The original observation time. Never restamped by the follow-up. */
  observedAt: string;
  reason: "not_selected" | "retry_did_not_reproduce";
  note: string;
}

export interface CarryForwardRow {
  checkId: string;
  label: string;
  disposition: CarryForwardDisposition;
  /** Whether the authorization actually selected this check for the retry. */
  selected: boolean;
  decisionCritical: boolean;
  sourceStatus: CheckStatus | null;
  freshStatus: CheckStatus | null;
  /** The observation time behind the merged row. */
  observedAt: string | null;
  carried: boolean;
}

export interface ScopedFollowUpMergeSummary {
  recovered: number;
  reconfirmed: number;
  stillOpen: number;
  retryRegressed: number;
  carriedForward: number;
  carriedStale: number;
  notSelectedOpen: number;
  newlyMeasured: number;
  notApplicable: number;
}

export interface ScopedFollowUpMerge {
  schemaVersion: typeof GAP_CARRY_FORWARD_SCHEMA_VERSION;
  sourceReportVersionId: string;
  /** The merged checklist: fresh results inside scope, carried evidence outside it. */
  checks: ScanCheck[];
  rows: CarryForwardRow[];
  summary: ScopedFollowUpMergeSummary;
  /**
   * Whether the fresh run assessed everything the merged evidence contains.
   *
   * `fresh_scope_only` means carried evidence is present that the fresh scorer
   * never saw, so the fresh numeric score does not describe the merged report.
   */
  scoreBasis: "fresh_covers_merged_evidence" | "fresh_scope_only";
  carriedDecisionCriticalCount: number;
}

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const text = (value: unknown, max = 500): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Mirrors the provenance writer so merged rows keep stable check identity. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

export function checkIdentity(check: ScanCheck): string {
  return text(check.checkId, 160) || slug(text(check.label, 200));
}

function isSettled(status: CheckStatus | null | undefined): boolean {
  return status != null && SETTLED_STATUSES.has(status);
}

/** Legacy snapshots mark nothing explicitly; there every check stays critical. */
function decisionCritical(check: ScanCheck | undefined, hasExplicitCriticality: boolean): boolean {
  if (!check) return false;
  if (!hasExplicitCriticality) return true;
  return check.decisionCritical !== false;
}

function timestamp(value: unknown): string {
  const raw = text(value, 60);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

/**
 * The exact checks an authorization put in scope.
 *
 * Only tasks named by the authorization contribute, and only the check ids the
 * frozen plan already bound to them. A task with no check ids (an identity or
 * synthesis gate) authorizes provider work but claims no checklist row.
 */
export function selectedCheckIdsForScope(
  plan: ResearchPlan | null,
  taskIds: readonly string[],
): string[] {
  if (!plan) return [];
  const wanted = new Set(taskIds.map((id) => text(id, 160)).filter(Boolean));
  const selected = new Set<string>();
  for (const task of plan.tasks) {
    if (!wanted.has(task.id)) continue;
    for (const checkId of task.checkIds ?? []) {
      const id = text(checkId, 160);
      if (id) selected.add(id);
    }
  }
  return [...selected];
}

export interface ScopedFollowUpMergeInput {
  /** The frozen checklist of the version the follow-up was authorized against. */
  sourceChecks: readonly ScanCheck[];
  /** The checklist the bounded re-run produced. */
  freshChecks: readonly ScanCheck[];
  /** Check ids the authorization actually selected. */
  selectedCheckIds: readonly string[];
  sourceReportVersionId: string;
  /** When the source version froze, used when a carried row has no own timestamp. */
  sourceObservedAt: string;
  now?: string;
  freshnessHorizonDays?: number;
}

function carriedRow(
  source: ScanCheck,
  provenance: CarriedEvidenceProvenance,
  stale: boolean,
): ScanCheck {
  // The carried row keeps the source status, note, provider, source count and
  // completion time exactly. Only the freshness qualification and the
  // carry-forward stamp are added.
  return {
    ...source,
    ...(stale ? { status: "stale" as CheckStatus } : {}),
    carriedForward: provenance,
  };
}

/**
 * Merge a bounded follow-up's fresh checklist onto the source version.
 *
 * Inside the authorized scope the fresh outcome wins, except when the retry
 * failed to reproduce an outcome the source already had: that evidence is
 * carried rather than dropped, and flagged as a retry regression. Outside the
 * scope the source outcome is always carried, because an unassessed check is
 * absent, not disproven.
 */
export function mergeScopedFollowUpChecks(input: ScopedFollowUpMergeInput): ScopedFollowUpMerge {
  const sourceReportVersionId = text(input.sourceReportVersionId, 80);
  const sourceObservedAt = timestamp(input.sourceObservedAt);
  const nowMs = Date.parse(timestamp(input.now) || new Date().toISOString());
  const horizonDays = Number.isFinite(input.freshnessHorizonDays as number)
    && (input.freshnessHorizonDays as number) > 0
    ? input.freshnessHorizonDays as number
    : DEFAULT_FRESHNESS_HORIZON_DAYS;
  const horizonMs = horizonDays * 24 * 60 * 60 * 1_000;

  const selected = new Set(input.selectedCheckIds.map((id) => text(id, 160)).filter(Boolean));
  const sourceById = new Map<string, ScanCheck>();
  for (const check of input.sourceChecks) {
    const id = checkIdentity(check);
    if (id && !sourceById.has(id)) sourceById.set(id, check);
  }
  const freshById = new Map<string, ScanCheck>();
  for (const check of input.freshChecks) {
    const id = checkIdentity(check);
    if (id && !freshById.has(id)) freshById.set(id, check);
  }
  const hasExplicitCriticality = [...input.sourceChecks, ...input.freshChecks]
    .some((check) => check.decisionCritical !== undefined);

  // Fresh order first so recovered work reads at the top, then any source-only
  // rows in their original order.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const check of input.freshChecks) {
    const id = checkIdentity(check);
    if (id && !seen.has(id)) { seen.add(id); order.push(id); }
  }
  for (const check of input.sourceChecks) {
    const id = checkIdentity(check);
    if (id && !seen.has(id)) { seen.add(id); order.push(id); }
  }

  const checks: ScanCheck[] = [];
  const rows: CarryForwardRow[] = [];
  const summary: ScopedFollowUpMergeSummary = {
    recovered: 0,
    reconfirmed: 0,
    stillOpen: 0,
    retryRegressed: 0,
    carriedForward: 0,
    carriedStale: 0,
    notSelectedOpen: 0,
    newlyMeasured: 0,
    notApplicable: 0,
  };
  let carriedDecisionCriticalCount = 0;

  for (const id of order) {
    const source = sourceById.get(id);
    const fresh = freshById.get(id);
    const inScope = selected.has(id);
    const critical = decisionCritical(source ?? fresh, hasExplicitCriticality);
    const sourceStatus = source?.status ?? null;
    const freshStatus = fresh?.status ?? null;

    const push = (
      merged: ScanCheck,
      disposition: CarryForwardDisposition,
      carried: boolean,
    ): void => {
      checks.push(merged);
      rows.push({
        checkId: id,
        label: text(merged.label, 200),
        disposition,
        selected: inScope,
        decisionCritical: critical,
        sourceStatus,
        freshStatus,
        observedAt: carried
          ? text(merged.carriedForward?.observedAt, 60) || null
          : timestamp(merged.completedAt) || null,
        carried,
      });
      if (carried && critical) carriedDecisionCriticalCount += 1;
    };

    // Present only in the fresh run: genuinely new measured work.
    if (!source && fresh) {
      push({ ...fresh }, "newly_measured", false);
      summary.newlyMeasured += 1;
      continue;
    }
    if (!source) continue;

    const observedAt = timestamp(source.completedAt) || sourceObservedAt;
    const stale = isSettled(source.status)
      && Boolean(observedAt)
      && Number.isFinite(nowMs)
      && nowMs - Date.parse(observedAt) > horizonMs;

    if (source.status === "not-applicable") {
      // Applicability is a property of the subject, not of this retry's budget.
      push(
        carriedRow(source, {
          schemaVersion: GAP_CARRY_FORWARD_SCHEMA_VERSION,
          sourceReportVersionId,
          observedAt: observedAt || sourceObservedAt,
          reason: "not_selected",
          note: "Carried from the source version: this check does not apply to this subject.",
        }, false),
        "not_applicable",
        true,
      );
      summary.notApplicable += 1;
      continue;
    }

    if (inScope) {
      if (isSettled(fresh?.status)) {
        push({ ...(fresh as ScanCheck) }, isSettled(source.status) ? "reconfirmed" : "recovered", false);
        if (isSettled(source.status)) summary.reconfirmed += 1;
        else summary.recovered += 1;
        continue;
      }
      if (isSettled(source.status)) {
        // The retry ran and came back without the outcome the source already
        // held. Keep the evidence, say plainly that the retry did not
        // reproduce it, and let the promotion gate see the regression.
        push(
          carriedRow(source, {
            schemaVersion: GAP_CARRY_FORWARD_SCHEMA_VERSION,
            sourceReportVersionId,
            observedAt: observedAt || sourceObservedAt,
            reason: "retry_did_not_reproduce",
            note: fresh
              ? `Carried from the source version: the follow-up re-ran this check and returned ${fresh.status} instead of a result.`
              : "Carried from the source version: the follow-up did not return this check.",
          }, stale),
          "retry_regressed",
          true,
        );
        summary.retryRegressed += 1;
        continue;
      }
      // Open before, open after. The fresh row carries the newest failure
      // reason, so prefer it when the retry produced one.
      push({ ...(fresh ?? source) }, "still_open", false);
      summary.stillOpen += 1;
      continue;
    }

    // Outside the authorized scope.
    if (isSettled(source.status)) {
      push(
        carriedRow(source, {
          schemaVersion: GAP_CARRY_FORWARD_SCHEMA_VERSION,
          sourceReportVersionId,
          observedAt: observedAt || sourceObservedAt,
          reason: "not_selected",
          note: stale
            ? "Carried from the source version and outside its freshness window; the follow-up was not authorized to re-check it."
            : "Carried from the source version; the follow-up was not authorized to re-check it.",
        }, stale),
        stale ? "carried_stale" : "carried_forward",
        true,
      );
      if (stale) summary.carriedStale += 1;
      else summary.carriedForward += 1;
      continue;
    }
    if (isSettled(fresh?.status)) {
      // The bounded collector closed a check the authorization did not name.
      // It is still measured work in this run, so it is not carried evidence.
      push({ ...(fresh as ScanCheck) }, "newly_measured", false);
      summary.newlyMeasured += 1;
      continue;
    }
    push({ ...source }, "not_selected_open", false);
    summary.notSelectedOpen += 1;
  }

  return {
    schemaVersion: GAP_CARRY_FORWARD_SCHEMA_VERSION,
    sourceReportVersionId,
    checks,
    rows,
    summary,
    scoreBasis: carriedDecisionCriticalCount > 0 ? "fresh_scope_only" : "fresh_covers_merged_evidence",
    carriedDecisionCriticalCount,
  };
}

export interface PromotionBlock {
  code:
    | "carried_evidence_not_rescored"
    | "decision_critical_evidence_regression"
    | "no_progress";
  note: string;
}

/**
 * Decide whether a scoped proposal may replace the active version.
 *
 * The gate fails closed. A merged proposal that contains carried evidence the
 * fresh scorer never saw cannot publish a coherent number, because its coverage
 * and its score would have different bases. A merged proposal that still drops
 * a decision-critical outcome the source held is a regression regardless of
 * cause. Neither is promoted; both are shown.
 */
export interface PromotionGateOptions {
  /**
   * True when the proposal's numeric score was computed by the bounded re-run
   * itself (a person follow-up). False when the score comes from evidence the
   * proposal preserves rather than re-derives — a token + project follow-up
   * keeps the frozen token score, and an integrated token re-run rescores
   * everything it collected.
   */
  scoreFollowsFreshRun: boolean;
}

export function scopedFollowUpPromotionBlocks(
  merge: ScopedFollowUpMerge,
  options: PromotionGateOptions = { scoreFollowsFreshRun: true },
): PromotionBlock[] {
  const blocks: PromotionBlock[] = [];

  // Invariant check. A correct merge never drops decision-critical evidence, so
  // this is the fail-closed backstop rather than the expected path.
  const regressions = merge.rows.filter((row) =>
    row.decisionCritical
    && isSettled(row.sourceStatus)
    && !row.carried
    && !isSettled(row.freshStatus));
  if (regressions.length) {
    blocks.push({
      code: "decision_critical_evidence_regression",
      note: `This proposal loses ${regressions.length} decision-critical result the active version already holds (${regressions.map((row) => row.label).slice(0, 5).join(", ")}). Promotion is blocked.`,
    });
  }

  if (options.scoreFollowsFreshRun && merge.scoreBasis === "fresh_scope_only") {
    blocks.push({
      code: "carried_evidence_not_rescored",
      note: `The follow-up scored only the ${merge.summary.recovered + merge.summary.reconfirmed + merge.summary.stillOpen + merge.summary.newlyMeasured} checks it assessed, while this proposal also carries ${merge.carriedDecisionCriticalCount} decision-critical result(s) it never saw. Promoting it would publish a score that does not describe its own evidence. Run a fresh full assessment to get an authoritative score.`,
    });
  }

  if (
    merge.summary.recovered === 0
    && merge.summary.newlyMeasured === 0
    && merge.summary.reconfirmed === 0
  ) {
    blocks.push({
      code: "no_progress",
      note: "The follow-up closed no check the active version was missing, so there is nothing to promote.",
    });
  }

  return blocks;
}

/** The reviewer-facing comparison frozen onto the proposal payload. */
export interface ScopedFollowUpComparison {
  schemaVersion: typeof GAP_CARRY_FORWARD_SCHEMA_VERSION;
  sourceReportVersionId: string;
  summary: ScopedFollowUpMergeSummary;
  scoreBasis: ScopedFollowUpMerge["scoreBasis"];
  /** Whether the proposal's number came from the bounded re-run itself. */
  scoreFollowsFreshRun: boolean;
  carriedDecisionCriticalCount: number;
  promotable: boolean;
  promotionBlocks: PromotionBlock[];
  areas: {
    recovered: string[];
    reconfirmed: string[];
    stillOpen: string[];
    carried: string[];
    carriedStale: string[];
    retryRegressed: string[];
    notSelectedOpen: string[];
    newlyMeasured: string[];
  };
}

const labelsFor = (
  rows: readonly CarryForwardRow[],
  disposition: CarryForwardDisposition,
): string[] => rows.filter((row) => row.disposition === disposition).map((row) => row.label).slice(0, 40);

export function scopedFollowUpComparison(
  merge: ScopedFollowUpMerge,
  options: PromotionGateOptions = { scoreFollowsFreshRun: true },
): ScopedFollowUpComparison {
  const promotionBlocks = scopedFollowUpPromotionBlocks(merge, options);
  return {
    schemaVersion: GAP_CARRY_FORWARD_SCHEMA_VERSION,
    sourceReportVersionId: merge.sourceReportVersionId,
    summary: merge.summary,
    scoreBasis: merge.scoreBasis,
    scoreFollowsFreshRun: options.scoreFollowsFreshRun,
    carriedDecisionCriticalCount: merge.carriedDecisionCriticalCount,
    promotable: promotionBlocks.length === 0,
    promotionBlocks,
    areas: {
      recovered: labelsFor(merge.rows, "recovered"),
      reconfirmed: labelsFor(merge.rows, "reconfirmed"),
      stillOpen: labelsFor(merge.rows, "still_open"),
      carried: labelsFor(merge.rows, "carried_forward"),
      carriedStale: labelsFor(merge.rows, "carried_stale"),
      retryRegressed: labelsFor(merge.rows, "retry_regressed"),
      notSelectedOpen: labelsFor(merge.rows, "not_selected_open"),
      newlyMeasured: labelsFor(merge.rows, "newly_measured"),
    },
  };
}

/** Read a frozen comparison back off a proposed payload. */
export function savedScopedFollowUpComparison(payload: unknown): ScopedFollowUpComparison | null {
  const marker = record(record(payload).gapInvestigation);
  const comparison = record(marker.evidenceComparison);
  if (comparison.schemaVersion !== GAP_CARRY_FORWARD_SCHEMA_VERSION) return null;
  return comparison as unknown as ScopedFollowUpComparison;
}
