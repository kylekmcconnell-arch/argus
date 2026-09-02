// Persistent reports: push the full rendered audit up on completion, pull it back
// down when a recent audit is re-opened — so a click shows the real report even
// after a reload or from another analyst, instead of re-running. No-op when no
// backend is configured. Local session cache still handles the same-session case.
import type { Dossier } from "../data/dossier";
import type { Recon } from "../collect/recon";
import type { Investigation } from "./investigation";
import type { TokenDossier } from "../token/audit";
import { clearanceCoverage, personChecks, reconcileInvestigationChecks, tokenChecks, type ScanCheck } from "./scanChecklist";
import type { ResearchPlan } from "./researchDirector";
import { normalizeSubjectRef } from "./subjectRef";
import { applyReportCheckContract, hasExplicitReportCheckContract } from "./reportCheckContract";
import type {
  ReportAttestationState,
  ReportCompletenessState,
  ReportVersionContext,
} from "./reportVersion";
import type { MaterialReportDelta } from "./reportDelta";

export type ReportKind = "person" | "token" | "investigation" | "site";
export type ReportStatus = "open" | "archived";
export type ReportLifecycleAction = "archive" | "restore";

export type ReportSyncResult =
  | {
    state: "persisted";
    reportVersionId: string;
    caseId: string;
    version: number;
    panelCostToken: string;
    /** Present when the save re-linked an existing server-collected version. */
    attestationState?: ReportAttestationState;
    reportDelta?: MaterialReportDelta;
  }
  | { state: "failed"; reason: string };

const payloadCaseId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const context = (payload as { versionContext?: { caseId?: unknown } }).versionContext;
  return typeof context?.caseId === "string" && context.caseId.trim() ? context.caseId.trim() : undefined;
};

/** Build the live saved-report identity from the persist receipt plus local checks. */
export function savedVersionContext(
  kind: ReportKind,
  payload: unknown,
  receipt: { caseId: string; reportVersionId: string; version: number; attestationState?: ReportAttestationState },
): ReportVersionContext {
  const checks = reportChecks(kind, payload);
  return {
    caseId: receipt.caseId,
    reportVersionId: receipt.reportVersionId,
    version: receipt.version,
    completenessState: reportCompleteness(kind, payload, checks),
    attestationState: receipt.attestationState ?? "analyst_submitted",
    methodologyVersion: null,
    createdAt: new Date().toISOString(),
    checks,
  };
}

const RETRYABLE_SAVE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function reportSaveFailure(status: number, serverError?: string): string {
  if (status === 401) return "Your sign-in expired before the report could be saved.";
  if (status === 403) return "Your account does not have permission to save this report.";
  if (status === 413) return "The report was too large to save.";
  if (serverError === "storage_not_configured") return "Report storage is not configured.";
  if (serverError === "person_token_subject_mismatch") {
    return "The project report is saved, but the linked-token result could not be bound to a token the server attributed to this subject, so the combined report was not saved.";
  }
  if (serverError === "person_token_overlay_invalid") {
    return "The project report is saved, but the linked-token result was incomplete, so the combined report was not saved.";
  }
  return "Report storage did not accept the save.";
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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
    const checks = dossier.versionContext
      ? dossier.versionContext.checks.map((check) => ({ ...check }))
      : tokenChecks(dossier);
    return applyReportCheckContract("token", checks);
  }
  if (kind === "investigation") {
    const investigation = payload as Investigation;
    const base = investigation.versionContext
      ? investigation.versionContext.checks.map((check) => ({ ...check }))
      : tokenChecks(investigation.token);
    // Credit org-side outcomes the bound project scan recorded in this same
    // payload; without a confirmed canonical binding this is a no-op.
    return applyReportCheckContract("investigation", reconcileInvestigationChecks(
      base,
      investigation.token.address,
      investigation.projectAccount,
      investigation.projectAccountAudit,
      investigation.projectAccountBinding,
    ));
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
  if (dossier?.checkRuns?.length && dossier.completeness_state === "failed") return "failed";
  if (dossier?.checkRuns?.length
    && dossier.completeness_state === "partial"
    && !hasExplicitReportCheckContract("person", checks)) return "partial";
  const contractedChecks = kind === "site"
    ? checks
    : applyReportCheckContract(kind, checks);
  if (kind !== "site") return clearanceCoverage(contractedChecks).sufficient ? "complete" : "partial";
  const inScope = checks.filter((check) => check.status !== "not-applicable");
  return inScope.length > 0 && inScope.every((check) =>
    check.status === "confirmed" || check.status === "reported" || check.status === "finding" || check.status === "checked-empty"
  ) ? "complete" : "partial";
}

const TOKEN_RESCAN_CHECK_IDS = new Set([
  "contract-safety",
  "buy-sell-simulation",
  "holder-distribution",
  "wallet-clustering",
  "operator-funding-trace",
  "market-intelligence",
  "ofac-sanctions-address",
]);
export const TOKEN_GAP_TASK_ID = "token-evidence-refresh";
export const TOKEN_GAP_DELEGATES = [
  "dexscreener",
  "goplus",
  "honeypot-is",
  "rugcheck",
  "blockscout",
  "coingecko",
  "geckoterminal",
  "ofac-sdn",
  "arkham",
  "clone-check",
  "social-activity",
] as const;

/**
 * Freeze one coarse, honest token-rescan task alongside a saved token report.
 *
 * The token collector is an integrated safety audit rather than a collection
 * of independently callable person-research specialists. The authorization
 * therefore exposes one task whose delegate set exactly describes that audit,
 * and only for retryable checks the audit can actually attempt. Project docs,
 * news, GitHub, and trust-graph gaps are intentionally excluded because a
 * standalone token rescan cannot answer them.
 */
export function withTokenGapInvestigationPlan(
  payload: TokenDossier,
  checks: readonly ScanCheck[],
  createdAt = new Date().toISOString(),
): TokenDossier {
  const open = checks.filter((check) =>
    Boolean(check.checkId)
    && TOKEN_RESCAN_CHECK_IDS.has(check.checkId as string)
    && check.retryable !== false
    && (check.status === "unknown" || check.status === "unavailable" || check.status === "stale"));
  if (!open.length) return payload;

  const questions = open.map((check) => ({
    id: `token-gap:${check.checkId}`,
    prompt: `Can a fresh token scan complete the ${check.label.toLowerCase()} check?`,
    state: check.status,
    materiality: check.decisionCritical === false ? "important" : "critical",
  }));
  const taskId = TOKEN_GAP_TASK_ID;
  const researchPlan: ResearchPlan = {
    schemaVersion: 1,
    intent: "investment_due_diligence",
    subject: payload.address,
    roles: ["TOKEN"],
    createdAt,
    tasks: [{
      id: taskId,
      capability: "token_and_market",
      question: "Re-run the token's contract, trading, holder, sanctions, market, and wallet checks.",
      why: "These checks share one integrated token audit and must be refreshed together to preserve a coherent score.",
      priority: questions.some((question) => question.materiality === "critical") ? "critical" : "high",
      delegates: [...TOKEN_GAP_DELEGATES],
      checkIds: open.map((check) => check.checkId as string),
      triggeredBy: questions.map((question) => question.id),
      rank: 1,
      decisionImpact: 5,
      costClass: "medium",
      dispatchReason: "A retryable token-safety question remains open in the saved report.",
      stopWhen: "The integrated token audit finishes and its immutable proposal is ready for analyst review.",
      blockedBy: [],
      state: "planned",
    }],
    nextActions: [{
      rank: 1,
      taskId,
      capability: "token_and_market",
      action: "Run a fresh integrated token audit and compare it with the saved report.",
      whyNow: "One or more retryable token checks do not have a completed outcome.",
      delegates: [...TOKEN_GAP_DELEGATES],
    }],
  };
  const current = payload as TokenDossier & {
    intelligence?: Record<string, unknown>;
    researchPlan?: ResearchPlan;
  };
  return {
    ...current,
    researchPlan,
    intelligence: {
      ...(current.intelligence ?? {}),
      questions,
    },
  } as TokenDossier;
}

export async function syncReport(
  kind: ReportKind,
  ref: string,
  query: string,
  payload: unknown,
  verdict?: string,
  score?: number | null,
): Promise<ReportSyncResult> {
  const checkRuns = reportChecks(kind, payload);
  const persistedPayload = kind === "token"
    ? withTokenGapInvestigationPlan(payload as TokenDossier, checkRuns)
    : payload;
  const completenessState = reportCompleteness(kind, persistedPayload, checkRuns);
  // The server binds this id to the immutable version. Every retry below sends
  // the same value, so a response lost after a successful commit cannot create
  // duplicate report versions or charge downstream work twice.
  const clientRunId = crypto.randomUUID();
  const priorCaseId = payloadCaseId(payload);
  const requestBody = JSON.stringify({
    kind,
    ref,
    query,
    payload: persistedPayload,
    verdict,
    score,
    checkRuns,
    completenessState,
    clientRunId,
    ...(priorCaseId ? { caseId: priorCaseId, versionContext: { caseId: priorCaseId } } : {}),
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) {
        if (RETRYABLE_SAVE_STATUS.has(response.status) && attempt < 2) {
          await pause(250 * (attempt + 1));
          continue;
        }
        const failure = (await response.json().catch(() => ({}))) as { error?: unknown };
        return {
          state: "failed",
          reason: reportSaveFailure(
            response.status,
            typeof failure.error === "string" ? failure.error : undefined,
          ),
        };
      }
      const body = (await response.json().catch(() => ({}))) as {
        reportVersionId?: unknown;
        caseId?: unknown;
        version?: unknown;
        panelCostToken?: unknown;
        attestationState?: unknown;
        reportDelta?: unknown;
      };
      if (
        typeof body.reportVersionId !== "string"
        || typeof body.panelCostToken !== "string"
        || typeof body.caseId !== "string"
        || typeof body.version !== "number"
        || !Number.isSafeInteger(body.version)
        || body.version < 1
      ) {
        return { state: "failed", reason: "Report storage returned an incomplete save receipt." };
      }
      return {
        state: "persisted",
        reportVersionId: body.reportVersionId,
        caseId: body.caseId,
        version: body.version,
        panelCostToken: body.panelCostToken,
        ...(body.attestationState === "server_collected" || body.attestationState === "analyst_submitted"
          ? { attestationState: body.attestationState }
          : {}),
        ...(body.reportDelta && typeof body.reportDelta === "object"
          ? { reportDelta: body.reportDelta as MaterialReportDelta }
          : {}),
      };
    } catch {
      if (attempt < 2) {
        await pause(250 * (attempt + 1));
        continue;
      }
      return { state: "failed", reason: "The report save timed out or lost its connection." };
    }
  }
  return { state: "failed", reason: "The report could not be saved." };
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
  status: ReportStatus | "missing" | "unavailable" | "ambiguous";
  report: StoredReport | null;
  /**
   * The distinct durable subjects a label resolved to when the server answered
   * `409 case_subject_ambiguous`. Present only with status "ambiguous". This is
   * a deterministic answer, not an outage: the analyst chooses one, ARGUS never
   * guesses and never starts a scan.
   */
  subjects?: StoredCaseSubject[];
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

/** Strict shape check for server-supplied durable case subjects; null when any row is malformed. */
function parseStoredCaseSubjects(rows: unknown): StoredCaseSubject[] | null {
  if (!Array.isArray(rows)) return null;
  const subjects: StoredCaseSubject[] = [];
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object") return null;
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.caseId !== "string"
      || (row.kind !== "person" && row.kind !== "token" && row.kind !== "investigation" && row.kind !== "site")
      || typeof row.ref !== "string"
      || typeof row.query !== "string"
      || (row.status !== "open" && row.status !== "archived")
    ) return null;
    subjects.push({
      caseId: row.caseId,
      kind: row.kind,
      ref: row.ref,
      query: row.query,
      status: row.status,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    });
  }
  return subjects;
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
      if (body.available !== true) return { status: "unavailable", subjects: [] };
      const subjects = parseStoredCaseSubjects(body.subjects);
      if (!subjects) return { status: "unavailable", subjects: [] };
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
      if (r.status === 409) {
        // Deterministic: the label maps to more than one durable case. A retry
        // returns the same answer, and "unavailable" would read as an outage
        // and dead-end the analyst on a report that exists.
        const body = await r.json().catch(() => null) as { error?: unknown; subjects?: unknown } | null;
        const subjects = body?.error === "case_subject_ambiguous" ? parseStoredCaseSubjects(body.subjects) : null;
        return subjects && subjects.length
          ? { status: "ambiguous", report: null, subjects }
          : { status: "unavailable", report: null };
      }
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
