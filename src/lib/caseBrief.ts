export type CaseBriefRecommendation = "undecided" | "advance" | "monitor" | "decline";
export type CaseBriefCaseKind = "person" | "token" | "investigation" | "site";
export type CaseBriefCaseStatus = "open" | "archived";
export type CaseBriefAssigneeRole = "owner" | "analyst";

export interface CaseBriefContent {
  summary: string;
  strongestEvidence: string[];
  highestRisks: string[];
  unresolvedQuestions: string[];
  changeConditions: string[];
  nextActions: string[];
}

export interface CaseBrief {
  caseId: string;
  revision: number;
  anchorReportVersionId: string;
  recommendation: CaseBriefRecommendation;
  assigneeUserId: string | null;
  assigneeDisplayName: string | null;
  dueAt: string | null;
  content: CaseBriefContent;
  createdByUserId: string | null;
  createdByDisplayName: string;
  createdAt: string;
  updatedByUserId: string | null;
  updatedByDisplayName: string;
  updatedAt: string;
}

export interface CaseBriefRevision {
  id: string;
  caseId: string;
  revision: number;
  anchorReportVersionId: string;
  recommendation: CaseBriefRecommendation;
  assigneeUserId: string | null;
  assigneeDisplayName: string | null;
  dueAt: string | null;
  content: CaseBriefContent;
  createdByUserId: string | null;
  authorDisplayName: string;
  createdAt: string;
}

export interface CaseBriefNote {
  id: string;
  caseId: string;
  clientId: string;
  body: string;
  createdByUserId: string | null;
  createdAt: string;
  authorDisplayName: string;
}

export interface CaseBriefAssignee {
  userId: string;
  displayName: string;
  role: CaseBriefAssigneeRole;
}

export interface CaseBriefCase {
  caseId: string;
  kind: CaseBriefCaseKind;
  ref: string;
  query: string;
  status: CaseBriefCaseStatus;
  currentReportVersionId: string | null;
  updatedAt: string;
}

export interface CaseBriefVersion {
  reportVersionId: string;
  version: number;
  verdict: string | null;
  score: number | null;
  completenessState: "complete" | "partial" | "failed";
  attestationState: "server_collected" | "analyst_submitted" | "legacy_unattested";
  methodologyVersion: string | null;
  contributor: string | null;
  createdAt: string;
}

export interface CaseBriefViewer {
  case: CaseBriefCase;
  currentVersion: CaseBriefVersion | null;
  anchorVersions: CaseBriefVersion[];
  brief: CaseBrief | null;
  hasNewEvidence: boolean;
  revisions: CaseBriefRevision[];
  hasOlderRevisions: boolean;
  notes: CaseBriefNote[];
  hasOlderNotes: boolean;
  assignees: CaseBriefAssignee[];
  canEdit: boolean;
  currentUserId: string;
}

export interface CaseBriefRevisionPage {
  revisions: CaseBriefRevision[];
  anchorVersions: CaseBriefVersion[];
  hasOlderRevisions: boolean;
}

export interface CaseBriefNotePage {
  notes: CaseBriefNote[];
  hasOlderNotes: boolean;
}

export type CaseBriefLocator =
  | { caseId: string; kind?: never; ref?: never; expectedReportVersionId?: string }
  | { caseId?: never; kind: CaseBriefCaseKind; ref: string; expectedReportVersionId?: string };

/** Product-facing name retained for drawers and report actions. */
export type CaseBriefTarget = CaseBriefLocator;

export interface CaseBriefFetchOptions {
  /** Number of retries after the first request while report persistence settles. */
  settleRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export interface SaveCaseBriefInput {
  caseId: string;
  expectedRevision: number;
  anchorReportVersionId: string;
  reanchor?: boolean;
  recommendation: CaseBriefRecommendation;
  assigneeUserId: string | null;
  dueAt: string | null;
  content: CaseBriefContent;
}

export interface AppendCaseBriefNoteInput {
  caseId: string;
  body: string;
  clientId?: string;
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
  currentBrief?: CaseBrief | null;
}

export class CaseBriefConflictError extends Error {
  readonly currentBrief: CaseBrief | null;

  constructor(message: string, currentBrief: CaseBrief | null) {
    super(message);
    this.name = "CaseBriefConflictError";
    this.currentBrief = currentBrief;
  }
}

export class CaseBriefAnchorConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseBriefAnchorConflictError";
  }
}

function apiMessage(body: ErrorBody, fallback: string): string {
  return typeof body.message === "string" && body.message.trim() ? body.message : fallback;
}

function locatorUrl(locator: CaseBriefLocator): string {
  const params = new URLSearchParams();
  if ("caseId" in locator && locator.caseId) {
    params.set("caseId", locator.caseId);
    if (locator.expectedReportVersionId) params.set("expectedReportVersionId", locator.expectedReportVersionId);
    return `/api/case-brief?${params.toString()}`;
  }
  if ("kind" in locator && typeof locator.kind === "string" && typeof locator.ref === "string") {
    params.set("kind", locator.kind);
    params.set("ref", locator.ref);
    if (locator.expectedReportVersionId) params.set("expectedReportVersionId", locator.expectedReportVersionId);
    return `/api/case-brief?${params.toString()}`;
  }
  throw new Error("An exact case identity is required.");
}

function settlingResponse(response: Response, body: ErrorBody): boolean {
  return (response.status === 404 && body.error === "case_not_found")
    || (response.status === 409 && body.error === "case_version_pending")
    || response.status === 425;
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Load the brief for an exact case identity. A short, bounded retry closes the
 * race where the report response reaches the browser just before persistence.
 */
export async function fetchCaseBrief(
  locator: CaseBriefLocator,
  options: CaseBriefFetchOptions = {},
): Promise<CaseBriefViewer | null> {
  const retries = Math.min(4, Math.max(0, options.settleRetries ?? 2));
  const delayMs = Math.min(2_000, Math.max(0, options.retryDelayMs ?? 180));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(12_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const response = await fetch(locatorUrl(locator), {
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => ({})) as ErrorBody & Partial<CaseBriefViewer>;
    if (response.ok) return body as CaseBriefViewer;
    if (settlingResponse(response, body)) {
      if (attempt === retries) return null;
      await wait(delayMs * (attempt + 1), options.signal);
      continue;
    }
    throw new Error(apiMessage(body, `Case brief unavailable (${response.status}).`));
  }
  return null;
}

async function fetchHistoryPage<T>(params: URLSearchParams, fallback: string): Promise<T> {
  const response = await fetch(`/api/case-brief?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as ErrorBody & T;
  if (!response.ok) throw new Error(apiMessage(body, fallback));
  return body;
}

export async function fetchOlderCaseBriefRevisions(
  caseId: string,
  beforeRevision: number,
): Promise<CaseBriefRevisionPage> {
  return await fetchHistoryPage<CaseBriefRevisionPage>(new URLSearchParams({
    caseId,
    history: "revisions",
    beforeRevision: String(beforeRevision),
  }), "Older Case Brief revisions are unavailable right now.");
}

export async function fetchOlderCaseBriefNotes(
  caseId: string,
  cursor: { createdAt: string; id: string },
): Promise<CaseBriefNotePage> {
  return await fetchHistoryPage<CaseBriefNotePage>(new URLSearchParams({
    caseId,
    history: "notes",
    beforeCreatedAt: cursor.createdAt,
    beforeId: cursor.id,
  }), "Older Case Brief notes are unavailable right now.");
}

export async function saveCaseBrief(input: SaveCaseBriefInput): Promise<CaseBrief> {
  const response = await fetch("/api/case-brief", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as ErrorBody & { brief?: CaseBrief };
  if (response.status === 409 && body.error === "case_brief_revision_conflict") {
    throw new CaseBriefConflictError(
      apiMessage(body, "This brief changed while you were editing."),
      body.currentBrief ?? null,
    );
  }
  if (response.status === 409 && body.error === "case_brief_anchor_conflict") {
    throw new CaseBriefAnchorConflictError(
      apiMessage(body, "New evidence was published before this re-anchor could be saved."),
    );
  }
  if (!response.ok || !body.brief) {
    throw new Error(apiMessage(body, `Case brief save failed (${response.status}).`));
  }
  return body.brief;
}

export async function appendCaseBriefNote(input: AppendCaseBriefNoteInput): Promise<CaseBriefNote> {
  const response = await fetch("/api/case-brief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      clientId: input.clientId ?? crypto.randomUUID(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as ErrorBody & { note?: CaseBriefNote };
  if (!response.ok || !body.note) {
    throw new Error(apiMessage(body, `Case note save failed (${response.status}).`));
  }
  return body.note;
}

/** Concise alias for callers that already live inside the Case Brief feature. */
export const appendCaseNote = appendCaseBriefNote;
