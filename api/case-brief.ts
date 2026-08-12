import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type AuthContext,
  type ServiceCredentials,
} from "./_auth.js";
import type {
  CaseBrief,
  CaseBriefAssignee,
  CaseBriefCase,
  CaseBriefCaseKind,
  CaseBriefContent,
  CaseBriefNote,
  CaseBriefRecommendation,
  CaseBriefRevision,
  CaseBriefVersion,
  CaseBriefViewer,
} from "../src/lib/caseBrief.js";

export const config = { maxDuration: 20 };

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PERSON_REF = /^[A-Za-z0-9_]{1,15}$/;
const CASE_KINDS = new Set<CaseBriefCaseKind>(["person", "token", "investigation", "site"]);
const RECOMMENDATIONS = new Set<CaseBriefRecommendation>(["undecided", "advance", "monitor", "decline"]);
const CONTENT_KEYS = [
  "summary",
  "strongestEvidence",
  "highestRisks",
  "unresolvedQuestions",
  "changeConditions",
  "nextActions",
] as const;
const MAX_REQUEST_BYTES = 70_000;
const MAX_CONTENT_BYTES = 65_536;
const MAX_NOTE_BYTES = 10_000;
const REVISION_PAGE_SIZE = 10;
const NOTE_PAGE_SIZE = 20;

interface CaseRow {
  id: string;
  kind: CaseBriefCaseKind;
  canonical_ref: string;
  display_query: string;
  status: "open" | "archived";
  updated_at: string;
}

interface Locator {
  caseId?: string;
  kind?: CaseBriefCaseKind;
  ref?: string;
  expectedReportVersionId?: string;
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

function firstRecord(value: unknown): JsonRecord | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uuid(value: unknown): string | null {
  const candidate = text(value);
  return candidate && UUID.test(candidate) ? candidate : null;
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  const candidate = uuid(value);
  return candidate ?? undefined;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requestBody(req: VercelRequest): JsonRecord | null {
  try {
    const serialized = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
    if (byteLength(serialized) > MAX_REQUEST_BYTES) return null;
    const value = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : null;
  } catch {
    return null;
  }
}

function onlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const names = Object.keys(value);
  return names.every((name) => allowed.includes(name));
}

function contentValue(value: unknown): CaseBriefContent | null {
  const row = asRecord(value);
  if (Object.keys(row).length !== CONTENT_KEYS.length || !onlyKeys(row, CONTENT_KEYS)) return null;
  if (typeof row.summary !== "string") return null;
  const summary = row.summary.trim();
  if ([...summary].length > 4_000) return null;

  const list = (candidate: unknown): string[] | null => {
    if (!Array.isArray(candidate) || candidate.length > 20) return null;
    const result: string[] = [];
    for (const item of candidate) {
      if (typeof item !== "string") return null;
      const clean = item.trim();
      if (!clean || [...clean].length > 2_000) return null;
      result.push(clean);
    }
    return result;
  };

  const strongestEvidence = list(row.strongestEvidence);
  const highestRisks = list(row.highestRisks);
  const unresolvedQuestions = list(row.unresolvedQuestions);
  const changeConditions = list(row.changeConditions);
  const nextActions = list(row.nextActions);
  if (!strongestEvidence || !highestRisks || !unresolvedQuestions || !changeConditions || !nextActions) {
    return null;
  }
  const content: CaseBriefContent = {
    summary,
    strongestEvidence,
    highestRisks,
    unresolvedQuestions,
    changeConditions,
    nextActions,
  };
  return byteLength(JSON.stringify(content)) <= MAX_CONTENT_BYTES ? content : null;
}

function recommendationValue(value: unknown): CaseBriefRecommendation | null {
  return typeof value === "string" && RECOMMENDATIONS.has(value as CaseBriefRecommendation)
    ? value as CaseBriefRecommendation
    : null;
}

function dueAtValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !value || value.length > 40) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function locatorFromQuery(req: VercelRequest): Locator | null {
  const expectedRaw = req.query.expectedReportVersionId;
  const expectedReportVersionId = expectedRaw == null
    ? undefined
    : typeof expectedRaw === "string" ? uuid(expectedRaw) ?? null : null;
  if (expectedReportVersionId === null) return null;
  if (req.query.caseId != null) {
    const caseId = typeof req.query.caseId === "string" ? uuid(req.query.caseId) : null;
    return caseId ? { caseId, expectedReportVersionId } : null;
  }
  const kind = typeof req.query.kind === "string" && CASE_KINDS.has(req.query.kind as CaseBriefCaseKind)
    ? req.query.kind as CaseBriefCaseKind
    : null;
  const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
  if (!kind || !ref || ref.length > 500 || ref.startsWith("$") || ref.startsWith("@")) return null;
  if (kind === "person" && !PERSON_REF.test(ref)) return null;
  if ((kind === "token" || kind === "investigation") && !EVM_ADDRESS.test(ref) && !SOLANA_ADDRESS.test(ref)) {
    return null;
  }
  if (kind === "site" && (/^https?:\/\//i.test(ref) || ref.includes("/"))) return null;
  return { kind, ref, expectedReportVersionId };
}

function caseRow(value: unknown): CaseRow | null {
  const row = asRecord(value);
  const kind = typeof row.kind === "string" && CASE_KINDS.has(row.kind as CaseBriefCaseKind)
    ? row.kind as CaseBriefCaseKind
    : null;
  const status = row.status === "open" || row.status === "archived" ? row.status : null;
  return uuid(row.id) && kind && text(row.canonical_ref) && text(row.display_query) && status && text(row.updated_at)
    ? {
        id: String(row.id),
        kind,
        canonical_ref: String(row.canonical_ref),
        display_query: String(row.display_query),
        status,
        updated_at: String(row.updated_at),
      }
    : null;
}

async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return await response.json();
}

async function resolveCase(
  credentials: ServiceCredentials,
  organizationId: string,
  locator: Locator,
): Promise<CaseRow | null> {
  const identityFilter = locator.caseId
    ? `id=eq.${encodeURIComponent(locator.caseId)}`
    : `kind=eq.${encodeURIComponent(String(locator.kind))}&canonical_ref=eq.${encodeURIComponent(String(locator.ref))}`;
  const response = await fetch(
    `${credentials.url}/rest/v1/cases?select=id,kind,canonical_ref,display_query,status,updated_at&organization_id=eq.${encodeURIComponent(organizationId)}&${identityFilter}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const rows = await readJson(response, "case brief case lookup");
  return Array.isArray(rows) ? caseRow(rows[0]) : null;
}

function storedContent(value: unknown): CaseBriefContent {
  const content = contentValue(value);
  if (!content) throw new Error("case brief content is malformed");
  return content;
}

function briefFromRow(value: unknown, names: ReadonlyMap<string, string> = new Map()): CaseBrief | null {
  const row = asRecord(value);
  if (!Object.keys(row).length) return null;
  const caseId = uuid(row.case_id);
  const anchor = uuid(row.anchor_report_version_id);
  const recommendation = recommendationValue(row.recommendation);
  const revision = typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision > 0
    ? row.revision
    : null;
  const assignee = nullableUuid(row.assignee_user_id);
  const assigneeLabel = text(row.assignee_label);
  const dueAt = row.due_at === null ? null : text(row.due_at);
  const createdBy = row.created_by === null ? null : uuid(row.created_by);
  const updatedBy = row.updated_by === null ? null : uuid(row.updated_by);
  const createdAt = text(row.created_at);
  const updatedAt = text(row.updated_at);
  const createdByLabel = text(row.created_by_label);
  const updatedByLabel = text(row.updated_by_label);
  if (
    !caseId || !anchor || !recommendation || !revision || assignee === undefined
    || (row.created_by !== null && !createdBy) || (row.updated_by !== null && !updatedBy)
    || !createdAt || !updatedAt
  ) throw new Error("case brief head is malformed");
  return {
    caseId,
    revision,
    anchorReportVersionId: anchor,
    recommendation,
    assigneeUserId: assignee,
    assigneeDisplayName: assigneeLabel || (assignee ? names.get(assignee) || "Former analyst" : null),
    dueAt,
    content: storedContent(row.content),
    createdByUserId: createdBy,
    createdByDisplayName: createdByLabel || (createdBy ? names.get(createdBy) || "Former analyst" : "Former analyst"),
    createdAt,
    updatedByUserId: updatedBy,
    updatedByDisplayName: updatedByLabel || (updatedBy ? names.get(updatedBy) || "Former analyst" : "Former analyst"),
    updatedAt,
  };
}

function revisionFromRow(
  value: unknown,
  names: ReadonlyMap<string, string> = new Map(),
): CaseBriefRevision | null {
  const row = asRecord(value);
  const id = uuid(row.id);
  const caseId = uuid(row.case_id);
  const anchor = uuid(row.anchor_report_version_id);
  const recommendation = recommendationValue(row.recommendation);
  const revision = typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision > 0
    ? row.revision
    : null;
  const assignee = nullableUuid(row.assignee_user_id);
  const assigneeLabel = text(row.assignee_label);
  const dueAt = row.due_at === null ? null : text(row.due_at);
  const createdBy = row.created_by === null ? null : uuid(row.created_by);
  const createdAt = text(row.created_at);
  const createdByLabel = text(row.created_by_label);
  if (
    !id || !caseId || !anchor || !recommendation || !revision || assignee === undefined
    || (row.created_by !== null && !createdBy) || !createdAt
  ) return null;
  try {
    return {
      id,
      caseId,
      revision,
      anchorReportVersionId: anchor,
      recommendation,
      assigneeUserId: assignee,
      assigneeDisplayName: assigneeLabel || (assignee ? names.get(assignee) || "Former analyst" : null),
      dueAt,
      content: storedContent(row.content),
      createdByUserId: createdBy,
      authorDisplayName: createdByLabel || (createdBy ? names.get(createdBy) || "Former analyst" : "Former analyst"),
      createdAt,
    };
  } catch {
    return null;
  }
}

function noteFromRow(value: unknown, names: ReadonlyMap<string, string>): CaseBriefNote | null {
  const row = asRecord(value);
  const id = uuid(row.id);
  const caseId = uuid(row.case_id);
  const clientId = uuid(row.client_id);
  const body = text(row.body);
  const createdBy = row.created_by === null ? null : uuid(row.created_by);
  const createdAt = text(row.created_at);
  const createdByLabel = text(row.created_by_label);
  if (!id || !caseId || !clientId || !body || (row.created_by !== null && !createdBy) || !createdAt) return null;
  return {
    id,
    caseId,
    clientId,
    body,
    createdByUserId: createdBy,
    createdAt,
    authorDisplayName: createdByLabel || (createdBy ? names.get(createdBy) || "Former analyst" : "Former analyst"),
  };
}

function versionFromRow(value: unknown): CaseBriefVersion | null {
  const row = asRecord(value);
  const id = uuid(row.id);
  const version = typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version > 0
    ? row.version
    : null;
  const completeness = row.completeness_state === "complete"
    || row.completeness_state === "partial"
    || row.completeness_state === "failed"
    ? row.completeness_state
    : null;
  const attestation = row.attestation_state === "server_collected"
    || row.attestation_state === "analyst_submitted"
    || row.attestation_state === "legacy_unattested"
    ? row.attestation_state
    : null;
  const createdAt = text(row.created_at);
  if (!id || !version || !completeness || !attestation || !createdAt) return null;
  return {
    reportVersionId: id,
    version,
    verdict: typeof row.verdict === "string" ? row.verdict : null,
    score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null,
    completenessState: completeness,
    attestationState: attestation,
    methodologyVersion: typeof row.methodology_version === "string" ? row.methodology_version : null,
    contributor: typeof row.contributor_label === "string" ? row.contributor_label : null,
    createdAt,
  };
}

function assigneeRows(value: unknown): { allNames: Map<string, string>; assignable: CaseBriefAssignee[] } {
  const allNames = new Map<string, string>();
  const assignable: CaseBriefAssignee[] = [];
  if (!Array.isArray(value)) return { allNames, assignable };
  for (const candidate of value) {
    const row = asRecord(candidate);
    const userId = uuid(row.user_id);
    const displayName = text(row.display_name);
    const role = row.role === "owner" || row.role === "analyst" ? row.role : null;
    if (!userId || !displayName || !role) continue;
    allNames.set(userId, displayName);
    assignable.push({ userId, displayName, role });
  }
  assignable.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { allNames, assignable };
}

async function loadViewer(
  credentials: ServiceCredentials,
  auth: AuthContext,
  reportCase: CaseRow,
): Promise<CaseBriefViewer> {
  const response = await fetch(`${credentials.url}/rest/v1/rpc/get_case_brief_snapshot`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: auth.organizationId,
      p_actor_user_id: auth.userId,
      p_case_id: reportCase.id,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const snapshot = asRecord(await readJson(response, "case brief snapshot lookup"));
  const snapshotCase = caseRow(snapshot.case);
  if (!snapshotCase || snapshotCase.id !== reportCase.id) {
    throw new Error("case brief snapshot returned the wrong case");
  }
  const currentVersion = versionFromRow(snapshot.current_version);
  const anchorVersions = Array.isArray(snapshot.anchor_versions)
    ? snapshot.anchor_versions
        .map((value) => versionFromRow(value))
        .filter((value): value is CaseBriefVersion => Boolean(value))
    : [];
  const members = assigneeRows(snapshot.assignees);
  const brief = briefFromRow(snapshot.brief, members.allNames);
  const revisionsRaw = snapshot.revisions;
  const revisions = Array.isArray(revisionsRaw)
    ? revisionsRaw
        .map((value) => revisionFromRow(value, members.allNames))
        .filter((value): value is CaseBriefRevision => Boolean(value))
    : [];
  const loadedAnchorIds = new Set(anchorVersions.map((version) => version.reportVersionId));
  if (
    (brief && !loadedAnchorIds.has(brief.anchorReportVersionId))
    || revisions.some((revision) => !loadedAnchorIds.has(revision.anchorReportVersionId))
  ) {
    throw new Error("case brief snapshot is missing decision-basis metadata");
  }
  const notesRaw = snapshot.notes;
  const notes = Array.isArray(notesRaw)
    ? notesRaw.map((value) => noteFromRow(value, members.allNames)).filter((value): value is CaseBriefNote => Boolean(value))
    : [];
  const snapshotViewer = asRecord(snapshot.viewer);
  const currentUserId = uuid(snapshotViewer.user_id);
  if (!currentUserId || currentUserId !== auth.userId) {
    throw new Error("case brief snapshot returned the wrong viewer");
  }
  const caseView: CaseBriefCase = {
    caseId: snapshotCase.id,
    kind: snapshotCase.kind,
    ref: snapshotCase.canonical_ref,
    query: snapshotCase.display_query,
    status: snapshotCase.status,
    currentReportVersionId: currentVersion?.reportVersionId ?? null,
    updatedAt: snapshotCase.updated_at,
  };
  return {
    case: caseView,
    currentVersion,
    anchorVersions,
    brief,
    hasNewEvidence: Boolean(brief && currentVersion && brief.anchorReportVersionId !== currentVersion.reportVersionId),
    revisions,
    hasOlderRevisions: snapshot.has_older_revisions === true,
    notes,
    hasOlderNotes: snapshot.has_older_notes === true,
    assignees: members.assignable,
    canEdit: snapshotCase.status === "open" && snapshotViewer.can_edit === true,
    currentUserId,
  };
}

async function loadRevisionPage(
  credentials: ServiceCredentials,
  organizationId: string,
  caseId: string,
  beforeRevision: number,
): Promise<{ revisions: CaseBriefRevision[]; anchorVersions: CaseBriefVersion[]; hasOlderRevisions: boolean }> {
  const response = await fetch(
    `${credentials.url}/rest/v1/case_brief_revisions?select=id,case_id,anchor_report_version_id,revision,recommendation,assignee_user_id,assignee_label,due_at,content,created_by,created_by_label,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&case_id=eq.${encodeURIComponent(caseId)}&revision=lt.${beforeRevision}&order=revision.desc&limit=${REVISION_PAGE_SIZE + 1}`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
  );
  const raw = await readJson(response, "older case brief revisions lookup");
  if (!Array.isArray(raw)) throw new Error("older case brief revisions response is malformed");
  const rows = raw.slice(0, REVISION_PAGE_SIZE).map((value) => revisionFromRow(value));
  if (rows.some((value) => !value)) throw new Error("older case brief revision is malformed");
  const revisions = rows as CaseBriefRevision[];
  const anchorIds = [...new Set(revisions.map((revision) => revision.anchorReportVersionId))];
  let anchorVersions: CaseBriefVersion[] = [];
  if (anchorIds.length) {
    const anchorFilter = encodeURIComponent(`in.(${anchorIds.join(",")})`);
    const anchorResponse = await fetch(
      `${credentials.url}/rest/v1/report_versions?select=id,version,verdict,score,completeness_state,attestation_state,methodology_version,contributor_label,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&case_id=eq.${encodeURIComponent(caseId)}&id=${anchorFilter}`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
    );
    const anchorRaw = await readJson(anchorResponse, "older revision decision-basis lookup");
    if (!Array.isArray(anchorRaw)) throw new Error("older revision decision-basis response is malformed");
    anchorVersions = anchorRaw.map((value) => versionFromRow(value)).filter((value): value is CaseBriefVersion => Boolean(value));
    const returnedIds = new Set(anchorVersions.map((version) => version.reportVersionId));
    if (anchorIds.some((id) => !returnedIds.has(id))) {
      throw new Error("older revision decision-basis metadata is incomplete");
    }
  }
  return {
    revisions,
    anchorVersions,
    hasOlderRevisions: raw.length > REVISION_PAGE_SIZE,
  };
}

async function loadNotePage(
  credentials: ServiceCredentials,
  organizationId: string,
  caseId: string,
  cursor: { createdAt: string; id: string },
): Promise<{ notes: CaseBriefNote[]; hasOlderNotes: boolean }> {
  const keyset = encodeURIComponent(
    `(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`,
  );
  const response = await fetch(
    `${credentials.url}/rest/v1/case_notes?select=id,case_id,client_id,body,created_by,created_by_label,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&case_id=eq.${encodeURIComponent(caseId)}&or=${keyset}&order=created_at.desc,id.desc&limit=${NOTE_PAGE_SIZE + 1}`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
  );
  const raw = await readJson(response, "older case notes lookup");
  if (!Array.isArray(raw)) throw new Error("older case notes response is malformed");
  const rows = raw.slice(0, NOTE_PAGE_SIZE).map((value) => noteFromRow(value, new Map()));
  if (rows.some((value) => !value)) throw new Error("older case note is malformed");
  return {
    notes: rows as CaseBriefNote[],
    hasOlderNotes: raw.length > NOTE_PAGE_SIZE,
  };
}

async function validAnchor(
  credentials: ServiceCredentials,
  organizationId: string,
  caseId: string,
  reportVersionId: string,
): Promise<boolean> {
  const response = await fetch(
    `${credentials.url}/rest/v1/report_versions?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&case_id=eq.${encodeURIComponent(caseId)}&id=eq.${encodeURIComponent(reportVersionId)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const rows = await readJson(response, "case brief anchor lookup");
  return Array.isArray(rows) && rows.length === 1;
}

async function validAssignee(
  credentials: ServiceCredentials,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const response = await fetch(
    `${credentials.url}/rest/v1/argus_members?select=user_id&organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(userId)}&active=is.true&role=in.%28owner%2Canalyst%29&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const rows = await readJson(response, "case brief assignee validation");
  return Array.isArray(rows) && rows.length === 1;
}

async function rpcFailure(response: Response): Promise<{ code: string; message: string }> {
  const body = asRecord(await response.json().catch(() => ({})));
  return {
    code: typeof body.code === "string" ? body.code : "",
    message: typeof body.message === "string" ? body.message : "",
  };
}

function setCors(req: VercelRequest, res: VercelResponse): void {
  const rawOrigin = req.headers.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  const allowed = new Set(
    (process.env.ARGUS_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
  );
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
  if (origin && allowed.has(origin)) res.setHeader("access-control-allow-origin", origin);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "PATCH" && req.method !== "POST") {
    res.status(405).setHeader("Allow", "GET, POST, PATCH, OPTIONS").json({ error: "method_not_allowed" });
    return;
  }

  const auth = await requireArgusAuth(req, res, req.method === "GET" ? "viewer" : "analyst");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured" });
    return;
  }

  try {
    if (req.method === "GET") {
      const locator = locatorFromQuery(req);
      if (!locator) {
        res.status(400).json({ error: "exact_case_identity_required" });
        return;
      }
      const reportCase = await resolveCase(credentials, auth.organizationId, locator);
      if (!reportCase) {
        res.status(404).json({
          error: "case_not_found",
          message: "The exact case has not reached durable storage yet.",
          settling: true,
        });
        return;
      }
      const history = typeof req.query.history === "string" ? req.query.history : "";
      if (history) {
        if (!locator.caseId || (history !== "revisions" && history !== "notes")) {
          res.status(400).json({ error: "valid_case_history_cursor_required" });
          return;
        }
        if (history === "revisions") {
          const rawBefore = typeof req.query.beforeRevision === "string"
            ? Number(req.query.beforeRevision)
            : Number.NaN;
          if (!Number.isSafeInteger(rawBefore) || rawBefore < 2 || rawBefore > 1_000_001) {
            res.status(400).json({ error: "valid_case_history_cursor_required" });
            return;
          }
          res.status(200).json(await loadRevisionPage(
            credentials,
            auth.organizationId,
            reportCase.id,
            rawBefore,
          ));
          return;
        }
        const beforeCreatedAt = typeof req.query.beforeCreatedAt === "string"
          && req.query.beforeCreatedAt.length <= 40
          && ISO_TIMESTAMP.test(req.query.beforeCreatedAt)
          && Number.isFinite(Date.parse(req.query.beforeCreatedAt))
          ? req.query.beforeCreatedAt
          : null;
        const beforeId = typeof req.query.beforeId === "string" ? uuid(req.query.beforeId) : null;
        if (!beforeCreatedAt || !beforeId) {
          res.status(400).json({ error: "valid_case_history_cursor_required" });
          return;
        }
        res.status(200).json(await loadNotePage(
          credentials,
          auth.organizationId,
          reportCase.id,
          { createdAt: beforeCreatedAt, id: beforeId },
        ));
        return;
      }
      const viewer = await loadViewer(credentials, auth, reportCase);
      if (!viewer.currentVersion) {
        res.status(409).json({
          error: "case_version_pending",
          message: "The expected immutable report version is still settling.",
          settling: true,
        });
        return;
      }
      if (
        locator.expectedReportVersionId
        && viewer.currentVersion.reportVersionId !== locator.expectedReportVersionId
      ) {
        const expectedExists = await validAnchor(
          credentials,
          auth.organizationId,
          reportCase.id,
          locator.expectedReportVersionId,
        );
        if (expectedExists) {
          res.status(409).json({
            error: "case_version_changed",
            message: "This report view was superseded by newer immutable evidence. Reopen the report before editing its Case Brief.",
            currentVersion: viewer.currentVersion,
          });
          return;
        }
        res.status(409).json({
          error: "case_version_pending",
          message: "The expected immutable report version is still settling.",
          settling: true,
        });
        return;
      }
      res.status(200).json(viewer);
      return;
    }

    const body = requestBody(req);
    if (!body) {
      res.status(400).json({ error: "valid_bounded_json_body_required" });
      return;
    }

    if (req.method === "PATCH") {
      if (!onlyKeys(body, [
        "caseId",
        "expectedRevision",
        "anchorReportVersionId",
        "reanchor",
        "recommendation",
        "assigneeUserId",
        "dueAt",
        "content",
      ])) {
        res.status(400).json({ error: "invalid_case_brief_fields" });
        return;
      }
      const caseId = uuid(body.caseId);
      const expectedRevision = typeof body.expectedRevision === "number"
        && Number.isSafeInteger(body.expectedRevision)
        && body.expectedRevision >= 0
        && body.expectedRevision <= 1_000_000
        ? body.expectedRevision
        : null;
      const anchorReportVersionId = uuid(body.anchorReportVersionId);
      const reanchor = body.reanchor === undefined ? false : body.reanchor;
      const recommendation = recommendationValue(body.recommendation);
      const assigneeUserId = nullableUuid(body.assigneeUserId);
      const dueAt = dueAtValue(body.dueAt);
      const content = contentValue(body.content);
      if (
        !caseId || expectedRevision === null || !anchorReportVersionId
        || typeof reanchor !== "boolean" || !recommendation
        || assigneeUserId === undefined || dueAt === undefined || !content
      ) {
        res.status(400).json({ error: "invalid_case_brief" });
        return;
      }

      const reportCase = await resolveCase(credentials, auth.organizationId, { caseId });
      if (!reportCase) {
        res.status(404).json({ error: "case_not_found" });
        return;
      }
      if (reportCase.status === "archived") {
        res.status(409).json({ error: "case_archived", message: "Archived cases are read-only." });
        return;
      }
      const [anchorOkay, assigneeOkay] = await Promise.all([
        validAnchor(credentials, auth.organizationId, caseId, anchorReportVersionId),
        assigneeUserId ? validAssignee(credentials, auth.organizationId, assigneeUserId) : Promise.resolve(true),
      ]);
      if (!anchorOkay) {
        res.status(409).json({ error: "invalid_brief_anchor", message: "The anchor is not a version of this case." });
        return;
      }
      if (!assigneeOkay) {
        res.status(400).json({ error: "invalid_case_assignee" });
        return;
      }

      const response = await fetch(`${credentials.url}/rest/v1/rpc/save_case_brief`, {
        method: "POST",
        headers: serviceHeaders(credentials.key),
        body: JSON.stringify({
          p_organization_id: auth.organizationId,
          p_actor_user_id: auth.userId,
          p_case_id: caseId,
          p_expected_revision: expectedRevision,
          p_anchor_report_version_id: anchorReportVersionId,
          p_allow_reanchor: reanchor,
          p_recommendation: recommendation,
          p_assignee_user_id: assigneeUserId,
          p_due_at: dueAt,
          p_content: content,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const failure = await rpcFailure(response);
        if (failure.code === "40001" || /case brief revision conflict/i.test(failure.message)) {
          const current = await loadViewer(credentials, auth, reportCase);
          res.status(409).json({
            error: "case_brief_revision_conflict",
            message: "This brief changed while you were editing. Your draft was not discarded.",
            currentBrief: current.brief,
          });
          return;
        }
        if (/archived/i.test(failure.message)) {
          res.status(409).json({ error: "case_archived", message: "Archived cases are read-only." });
          return;
        }
        if (
          /reanchor/i.test(failure.message)
          || /anchor[^.]{0,80}(active|current|published)/i.test(failure.message)
          || /(active|current|published)[^.]{0,80}report version/i.test(failure.message)
        ) {
          res.status(409).json({
            error: "case_brief_anchor_conflict",
            message: "The brief anchor no longer matches the active published report. Refresh before reanchoring.",
          });
          return;
        }
        if (/case not found in organization/i.test(failure.message)) {
          res.status(404).json({ error: "case_not_found" });
          return;
        }
        if (/active analyst or owner access required/i.test(failure.message)) {
          res.status(403).json({ error: "insufficient_role" });
          return;
        }
        if (
          /case brief assignee/i.test(failure.message)
          || /invalid case brief (recommendation|content)/i.test(failure.message)
          || /expected revision/i.test(failure.message)
        ) {
          res.status(400).json({ error: "invalid_case_brief" });
          return;
        }
        throw new Error(`case brief save failed (${response.status})`);
      }
      const brief = briefFromRow(
        firstRecord(await response.json()),
        new Map([[auth.userId, auth.displayName]]),
      );
      if (!brief) throw new Error("case brief save returned no head");
      res.status(200).json({ brief });
      return;
    }

    if (!onlyKeys(body, ["caseId", "clientId", "body"])) {
      res.status(400).json({ error: "invalid_case_note_fields" });
      return;
    }
    const caseId = uuid(body.caseId);
    const clientId = uuid(body.clientId);
    const noteBody = typeof body.body === "string" ? body.body.trim() : "";
    if (
      !caseId || !clientId || !noteBody || [...noteBody].length > 10_000
      || byteLength(noteBody) > MAX_NOTE_BYTES
    ) {
      res.status(400).json({ error: "invalid_case_note" });
      return;
    }
    const reportCase = await resolveCase(credentials, auth.organizationId, { caseId });
    if (!reportCase) {
      res.status(404).json({ error: "case_not_found" });
      return;
    }
    // The note RPC checks an existing idempotency key before archived state, so
    // a response-lost retry can recover its immutable row even after archiving.
    const response = await fetch(`${credentials.url}/rest/v1/rpc/append_case_note`, {
      method: "POST",
      headers: serviceHeaders(credentials.key),
      body: JSON.stringify({
        p_organization_id: auth.organizationId,
        p_actor_user_id: auth.userId,
        p_case_id: caseId,
        p_client_id: clientId,
        p_body: noteBody,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const failure = await rpcFailure(response);
      if (failure.code === "23505" || /client id already exists/i.test(failure.message)) {
        res.status(409).json({
          error: "case_note_id_conflict",
          message: "This note id already belongs to different immutable content.",
        });
        return;
      }
      if (/archived/i.test(failure.message)) {
        res.status(409).json({ error: "case_archived", message: "Archived cases are read-only." });
        return;
      }
      if (/case not found in organization/i.test(failure.message)) {
        res.status(404).json({ error: "case_not_found" });
        return;
      }
      if (/active analyst or owner access required/i.test(failure.message)) {
        res.status(403).json({ error: "insufficient_role" });
        return;
      }
      if (/invalid case note body|case note client id/i.test(failure.message)) {
        res.status(400).json({ error: "invalid_case_note" });
        return;
      }
      throw new Error(`case note save failed (${response.status})`);
    }
    const note = noteFromRow(firstRecord(await response.json()), new Map([[auth.userId, auth.displayName]]));
    if (!note) throw new Error("case note save returned no note");
    res.status(201).json({ note });
  } catch (error) {
    console.error("[case-brief] request failed", error);
    res.status(503).json({ error: "case_brief_unavailable", message: "Case Brief is unavailable right now." });
  }
}
