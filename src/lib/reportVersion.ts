import type { CheckStatus, ScanCheck } from "./scanChecklist";

export type ReportCompletenessState = "complete" | "partial" | "failed";
export type ReportAttestationState = "server_collected" | "analyst_submitted" | "legacy_unattested";

/** Immutable metadata shared by full report reads and lightweight listings. */
export interface ReportVersionMetadata {
  reportVersionId: string;
  completenessState: ReportCompletenessState;
  attestationState: ReportAttestationState;
  methodologyVersion: string | null;
  createdAt: string;
}

/** Full immutable context attached only when a stored report is opened. */
export interface ReportVersionContext extends ReportVersionMetadata {
  checks: ScanCheck[];
}

export interface StoredCheckRun {
  check_id?: unknown;
  provider?: unknown;
  state?: unknown;
  source_count?: unknown;
  finished_at?: unknown;
  stale_at?: unknown;
  error_code?: unknown;
  error_detail?: unknown;
  metadata?: unknown;
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const storedStatus = (value: unknown): CheckStatus | null => {
  switch (value) {
    case "confirmed":
    case "finding":
    case "checked-empty":
    case "not-applicable":
    case "unknown":
    case "unavailable":
    case "stale":
      return value;
    default:
      return null;
  }
};

const readableCheckId = (value: unknown): string => {
  const id = text(value) || "Unnamed check";
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

function isPast(value: unknown, nowMs: number): boolean {
  const raw = text(value);
  if (!raw) return false;
  const time = Date.parse(raw);
  return Number.isFinite(time) && time <= nowMs;
}

function statusForRun(run: StoredCheckRun, metadata: JsonRecord, nowMs: number): CheckStatus {
  const state = text(run.state);
  const detailed = storedStatus(metadata.status);

  if (state === "not_run" && (detailed === "not-applicable" || metadata.notApplicable === true)) {
    return "not-applicable";
  }
  if (state === "complete" && isPast(run.stale_at, nowMs)) return "stale";

  switch (state) {
    case "complete":
      return detailed === "finding" || detailed === "checked-empty" || detailed === "confirmed"
        ? detailed
        : "confirmed";
    case "unavailable":
      return "unavailable";
    case "partial":
      return detailed === "stale" ? "stale" : "unknown";
    case "failed":
    case "not_run":
    default:
      return "unknown";
  }
}

/**
 * Restore persisted database check rows to the UI's evidence-coverage model.
 * Database state remains authoritative; metadata only restores distinctions
 * (finding vs checked-empty, or not-applicable) that share a storage state.
 */
export function mapStoredCheckRuns(
  rows: readonly StoredCheckRun[],
  nowMs = Date.now(),
): ScanCheck[] {
  return rows
    .map((run, index) => {
      const metadata = asRecord(run.metadata);
      const order = typeof metadata.order === "number" && Number.isFinite(metadata.order)
        ? metadata.order
        : index;
      const status = statusForRun(run, metadata, nowMs);
      const label = text(metadata.label) || readableCheckId(run.check_id);
      const checkId = text(run.check_id) || undefined;
      const provider = text(run.provider) || undefined;
      const sourceCount = typeof run.source_count === "number" && Number.isFinite(run.source_count)
        ? Math.max(0, Math.floor(run.source_count))
        : undefined;
      const completedAt = text(run.finished_at) || text(metadata.completedAt) || undefined;
      const storedNote = text(metadata.note);
      const failureDetail = text(run.error_detail);
      const failureCode = text(run.error_code);
      const note = storedNote
        || failureDetail
        || (status === "unknown" && failureCode ? `Check failed (${failureCode})` : undefined);
      return {
        order,
        check: {
          label,
          status,
          ...(note ? { note } : {}),
          ...(checkId ? { checkId } : {}),
          ...(provider ? { provider } : {}),
          ...(sourceCount != null ? { sourceCount } : {}),
          ...(completedAt ? { completedAt } : {}),
        } satisfies ScanCheck,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ check }) => check);
}
