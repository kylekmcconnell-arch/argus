// Persistent reports: push the full rendered audit up on completion, pull it back
// down when a recent audit is re-opened — so a click shows the real report even
// after a reload or from another analyst, instead of re-running. No-op when no
// backend is configured. Local session cache still handles the same-session case.
import type { Dossier } from "../data/dossier";
import type { Recon } from "../collect/recon";
import type { Investigation } from "./investigation";
import type { TokenDossier } from "../token/audit";
import { personChecks, reconcileInvestigationChecks, tokenChecks, type ScanCheck } from "./scanChecklist";
import { normalizeSubjectRef } from "./subjectRef";
import type {
  ReportAttestationState,
  ReportCompletenessState,
  ReportVersionContext,
} from "./reportVersion";

export type ReportKind = "person" | "token" | "investigation" | "site";
export type ReportStatus = "open" | "archived";
export type ReportLifecycleAction = "archive" | "restore";

export type ReportSyncResult =
  | { state: "persisted"; reportVersionId: string; panelCostToken: string }
  | { state: "failed" };

export interface ReportSubject {
  kind: ReportKind;
  ref: string;
}

export interface StoredCaseSubject extends ReportSubject {
  caseId: string;
  query: string;
  status: ReportStatus;
  updatedAt?: string;
}

export type StoredCaseResolution =
  | { status: "ok"; subjects: StoredCaseSubject[] }
  | { status: "unavailable"; subjects: [] };

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
    const base = investigation.versionContext
      ? investigation.versionContext.checks.map((check) => ({ ...check }))
      : tokenChecks(investigation.token);
    // Credit org-side outcomes the bound project scan recorded in this same
    // payload; without a confirmed canonical binding this is a no-op.
    return reconcileInvestigationChecks(
      base,
      investigation.token.address,
      investigation.projectAccount,
      investigation.projectAccountAudit,
    );
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
): Promise<ReportSyncResult> {
  try {
    const checkRuns = reportChecks(kind, payload);
    const completenessState = reportCompleteness(kind, payload, checkRuns);
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ref, query, payload, verdict, score, checkRuns, completenessState }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return { state: "failed" };
    const body = (await response.json().catch(() => ({}))) as {
      reportVersionId?: unknown;
      panelCostToken?: unknown;
    };
    if (typeof body.reportVersionId !== "string" || typeof body.panelCostToken !== "string") {
      return { state: "failed" };
    }
    return {
      state: "persisted",
      reportVersionId: body.reportVersionId,
      panelCostToken: body.panelCostToken,
    };
  } catch {
    /* offline or no backend — the session cache still holds it */
    return { state: "failed" };
  }
}

export interface StoredReport {
  kind: ReportKind;
  ref?: string;
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

/** Recover a persisted site recon without launching the collector again. */
export function storedSiteRecon(report: StoredReport): Recon | null {
  if (!report.payload || typeof report.payload !== "object" || Array.isArray(report.payload)) return null;
  const recon = (report.payload as Record<string, unknown>).recon;
  if (!recon || typeof recon !== "object" || Array.isArray(recon)) return null;
  const candidate = recon as Record<string, unknown>;
  const retrieval = candidate.retrieval;
  const team = candidate.team;
  if (!retrieval || typeof retrieval !== "object" || Array.isArray(retrieval)) return null;
  if (!team || typeof team !== "object" || Array.isArray(team)) return null;
  const retrievalRow = retrieval as Record<string, unknown>;
  const teamRow = team as Record<string, unknown>;
  if (
    typeof retrievalRow.url !== "string"
    || !["rendered", "recovered", "gap"].includes(String(retrievalRow.status))
    || typeof candidate.identityLine !== "string"
    || !Array.isArray(candidate.socials)
    || !Array.isArray(candidate.funding)
    || !Array.isArray(candidate.tokenSignals)
    || !Array.isArray(candidate.findings)
    || !Array.isArray(teamRow.names)
    || typeof teamRow.note !== "string"
  ) return null;
  return candidate as unknown as Recon;
}

// One row per persisted report (no payload — heavy; fetched per-ref on open).
export interface ReportListing {
  caseId?: string;
  ref: string;
  kind: ReportKind;
  query?: string;
  contributor?: string;
  verdict?: string | null;
  score?: number | null;
  ts?: string;
  reportVersionId?: string;
  version?: number;
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

// The identifier a report should be resolved by for entity unification. Token
// and investigation facets are always contract-backed: tickers are labels, not
// identities. Solana case remains exact.
export function entityKey(r: ReportListing): string {
  return normalizeSubjectRef(r.ref).replace(/\/.*$/, "");
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
    const key = r.kind === "token" || r.kind === "investigation"
      ? `contract:${id}`
      : resolve(id) || id || `${r.kind}:${r.ref}`;
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

/**
 * Resolve user-facing labels and legacy case-folded refs to exact durable case
 * identities. This reads `cases`, not the active report cache, so archived
 * subjects remain discoverable before any scan is allowed to start.
 */
export async function resolveStoredCases(input: string): Promise<StoredCaseResolution> {
  const url = `/api/report?${new URLSearchParams({ resolve: input.trim() }).toString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        if (attempt === 0) continue;
        return { status: "unavailable", subjects: [] };
      }
      const body = await response.json() as { available?: unknown; subjects?: unknown };
      if (body.available !== true || !Array.isArray(body.subjects)) {
        return { status: "unavailable", subjects: [] };
      }
      const subjects: StoredCaseSubject[] = [];
      for (const candidate of body.subjects) {
        if (!candidate || typeof candidate !== "object") {
          return { status: "unavailable", subjects: [] };
        }
        const row = candidate as Record<string, unknown>;
        if (
          typeof row.caseId !== "string"
          || (row.kind !== "person" && row.kind !== "token" && row.kind !== "investigation" && row.kind !== "site")
          || typeof row.ref !== "string"
          || typeof row.query !== "string"
          || (row.status !== "open" && row.status !== "archived")
        ) return { status: "unavailable", subjects: [] };
        subjects.push({
          caseId: row.caseId,
          kind: row.kind,
          ref: row.ref,
          query: row.query,
          status: row.status,
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
        });
      }
      return { status: "ok", subjects };
    } catch {
      if (attempt === 0) continue;
      return { status: "unavailable", subjects: [] };
    }
  }
  return { status: "unavailable", subjects: [] };
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

/** Load one immutable evidence snapshot by version id, even after archiving. */
export async function fetchReportVersion(reportVersionId: string): Promise<StoredReport | null> {
  try {
    const response = await fetch(`/api/report?${new URLSearchParams({ versionId: reportVersionId }).toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { report?: StoredReport | null };
    return body.report ?? null;
  } catch {
    return null;
  }
}
