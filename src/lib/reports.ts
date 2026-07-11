// Persistent reports: push the full rendered audit up on completion, pull it back
// down when a recent audit is re-opened — so a click shows the real report even
// after a reload or from another analyst, instead of re-running. No-op when no
// backend is configured. Local session cache still handles the same-session case.
import type { Dossier } from "../data/dossier";
import type { Investigation } from "./investigation";
import type { TokenDossier } from "../token/audit";
import { personChecks, tokenChecks, type ScanCheck } from "./scanChecklist";
import type {
  ReportAttestationState,
  ReportCompletenessState,
  ReportVersionContext,
} from "./reportVersion";

export type ReportKind = "person" | "token" | "investigation" | "site";
export type ReportStatus = "open" | "archived";
export type ReportLifecycleAction = "archive" | "restore";

export interface ReportSubject {
  kind: ReportKind;
  ref: string;
}

export function reportChecks(
  kind: ReportKind,
  payload: unknown,
): ScanCheck[] {
  if (kind === "token") {
    const dossier = payload as TokenDossier;
    return dossier.versionContext
      ? dossier.versionContext.checks.map((check) => ({ ...check }))
      : tokenChecks(dossier);
  }
  if (kind === "investigation") {
    const investigation = payload as Investigation;
    return investigation.versionContext
      ? investigation.versionContext.checks.map((check) => ({ ...check }))
      : tokenChecks(investigation.token);
  }
  if (kind === "person") {
    const dossier = payload as Dossier;
    // A live collector dossier owns its completed-check record. Re-deriving
    // from rendered evidence would turn fixture seeds or lazy panels into work
    // the server did not actually perform.
    if (Array.isArray(dossier.checkRuns) && dossier.checkRuns.length) {
      return dossier.checkRuns.map((check) => ({ ...check }));
    }
    if (dossier.versionContext) {
      return dossier.versionContext.checks.map((check) => ({ ...check }));
    }
    return personChecks({
      identityConfidence: dossier.report.identity_confidence ?? undefined,
      realName: (dossier.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
      roles: dossier.report.roles ?? [],
      hasAssociates: (dossier.evidence.associates ?? []).length > 0,
    });
  }
  return [];
}

export function reportCompleteness(
  kind: ReportKind,
  payload: unknown,
  checks = reportChecks(kind, payload),
): ReportCompletenessState {
  const dossier = kind === "person" ? payload as Dossier : null;
  if (dossier?.checkRuns?.length && (
    dossier.completeness_state === "complete"
    || dossier.completeness_state === "partial"
    || dossier.completeness_state === "failed"
  )) {
    return dossier.completeness_state;
  }
  const inScope = checks.filter((check) => check.status !== "not-applicable");
  return inScope.length > 0 && inScope.every((check) =>
    check.status === "confirmed" || check.status === "finding" || check.status === "checked-empty"
  ) ? "complete" : "partial";
}

export async function syncReport(
  kind: ReportKind,
  ref: string,
  query: string,
  payload: unknown,
  verdict?: string,
  score?: number | null,
): Promise<void> {
  try {
    const checkRuns = reportChecks(kind, payload);
    const completenessState = reportCompleteness(kind, payload, checkRuns);
    await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ref, query, payload, verdict, score, checkRuns, completenessState }),
    });
  } catch {
    /* offline or no backend — the session cache still holds it */
  }
}

export interface StoredReport {
  kind: ReportKind;
  query?: string;
  contributor?: string;
  payload: unknown;
  ts?: string;
  versionContext?: ReportVersionContext;
}

export interface ReportLookup {
  status: ReportStatus | "missing" | "unavailable";
  report: StoredReport | null;
}

/** Attach read-only version context without modifying the immutable payload. */
export function storedPersonDossier(report: StoredReport): Dossier {
  const payload = report.payload as Dossier;
  return report.versionContext
    ? { ...payload, versionContext: report.versionContext }
    : { ...payload };
}

/** Attach frozen token check outcomes without mutating the immutable payload. */
export function storedTokenDossier(report: StoredReport): TokenDossier {
  const payload = report.payload as TokenDossier;
  return report.versionContext
    ? { ...payload, versionContext: report.versionContext }
    : { ...payload };
}

/** Attach frozen investigation check outcomes without mutating the payload. */
export function storedInvestigation(report: StoredReport): Investigation {
  const payload = report.payload as Investigation;
  return report.versionContext
    ? { ...payload, versionContext: report.versionContext }
    : { ...payload };
}

// One row per persisted report (no payload — heavy; fetched per-ref on open).
export interface ReportListing {
  ref: string;
  kind: ReportKind;
  query?: string;
  contributor?: string;
  verdict?: string | null;
  score?: number | null;
  ts?: string;
  reportVersionId?: string;
  completenessState?: ReportCompletenessState;
  attestationState?: ReportAttestationState;
  methodologyVersion?: string | null;
  createdAt?: string;
  status?: ReportStatus;
  archivedAt?: string;
  // Provider spend of the audit run (person audits; token audits are keyless-free).
  cost?: {
    usd?: number;
    grokUsd?: number;
    claudeUsd?: number;
    sources?: number;
    // the full A-to-Z ledger: one line per provider+op, priciest first
    calls?: { provider: string; op: string; calls: number; usd: number; meta?: string }[];
  } | null;
}

// The identifier a report should be resolved by for entity unification. A token /
// investigation audit keys its cross-facet linkage on its $SYMBOL (carried in the
// query), so it groups by that; a person/site groups by its ref (handle / domain).
// Normalized to the bare form the alias resolver's canonical() expects.
export function entityKey(r: ReportListing): string {
  return ((r.kind === "token" || r.kind === "investigation" ? (r.query ?? r.ref) : r.ref) ?? "")
    .trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^[@$]/, "");
}

// Group report listings into entities: the $TOKEN audit, the @handle person audit
// and the site recon of ONE project collapse into a single group. `resolve` is the
// alias resolver (built from the graph contributions), which unions the facets from
// the audits' own edges — never name similarity. Insertion order is preserved, so
// a newest-first input stays newest-first. Falls back to the report's own key when
// nothing links it, so a lone audit is just a group of one.
export function groupReportsByEntity(reports: ReportListing[], resolve: (k: string) => string): ReportListing[][] {
  const byKey = new Map<string, ReportListing[]>();
  const order: string[] = [];
  for (const r of reports) {
    const id = entityKey(r);
    const key = resolve(id) || id || `${r.kind}:${r.ref}`;
    if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
    byKey.get(key)!.push(r);
  }
  return order.map((k) => byKey.get(k)!);
}

// The report library: every persisted report from every analyst, newest first.
export async function listReports(status: ReportStatus = "open"): Promise<ReportListing[]> {
  const url = status === "archived"
    ? "/api/report?list=1&status=archived"
    : "/api/report?list=1";
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  const body = await response.json().catch(() => ({})) as { reports?: ReportListing[]; message?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : `Report library unavailable (${response.status}).`);
  }
  return Array.isArray(body.reports) ? body.reports : [];
}

export async function changeReportLifecycle(
  action: ReportLifecycleAction,
  subjects: readonly ReportSubject[],
): Promise<void> {
  const response = await fetch("/api/report", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, subjects }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as { message?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : `Case ${action} failed (${response.status}).`);
  }
}

// Retry once with real headroom: a cold serverless start (functions scale to zero
// after idle) can blow past a single short timeout, and a null here wrongly sends
// a click on a STORED audit into a fresh live re-run (or "No live dossier yet").
export async function fetchReportState(ref: string, kind?: ReportKind): Promise<ReportLookup> {
  const params = new URLSearchParams({ ref: ref.replace(/^[@$]/, "") });
  if (kind) params.set("kind", kind);
  const url = `/api/report?${params.toString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (attempt === 0) continue; return { status: "unavailable", report: null }; }
      const d = await r.json() as { report?: StoredReport | null; caseStatus?: ReportStatus | "missing" };
      const report = d?.report ?? null;
      if (kind && report && report.kind !== kind) return { status: "missing", report: null };
      return {
        status: report ? "open" : d.caseStatus === "archived" || d.caseStatus === "open" ? d.caseStatus : "missing",
        report,
      };
    } catch {
      if (attempt === 0) continue;
      return { status: "unavailable", report: null };
    }
  }
  return { status: "unavailable", report: null };
}

export async function fetchReport(ref: string, kind?: ReportKind): Promise<StoredReport | null> {
  return (await fetchReportState(ref, kind)).report;
}
