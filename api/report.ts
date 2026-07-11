// Organization-scoped report projections plus immutable case versions.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type AuthContext,
  type ServiceCredentials,
} from "./_auth.js";
import { activateReportVersion, persistProvenance } from "./_provenance.js";
import {
  mapStoredCheckRuns,
  type ReportAttestationState,
  type ReportCompletenessState,
  type ReportVersionContext,
  type ReportVersionMetadata,
  type StoredCheckRun,
} from "../src/lib/reportVersion.js";

export const config = { maxDuration: 15 };

const TABLE = "reports";
const MAX_BODY = 1_800_000;
const MAX_LIFECYCLE_BODY = 25_000;
const CASE_KINDS = new Set(["person", "token", "investigation", "site"]);
const STORED_KINDS = new Set([...CASE_KINDS, "watch"]);
type JsonRecord = Record<string, unknown>;

interface CaseSubject {
  kind: string;
  ref: string;
}

interface ResolvedCaseSubject extends CaseSubject {
  caseId: string;
  query: string;
  status: "open" | "archived";
  updatedAt?: string;
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const normRef = (value: string) => {
  const clean = value.trim().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
  if (SOLANA_ADDRESS.test(clean)) return clean;
  if (EVM_ADDRESS.test(clean)) return clean.toLowerCase();
  return clean.toLowerCase();
};

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

function lifecycleSubjects(value: unknown): CaseSubject[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const unique = new Map<string, CaseSubject>();
  for (const candidate of value) {
    const row = asRecord(candidate);
    const kind = typeof row.kind === "string" ? row.kind : "";
    const ref = normRef(typeof row.ref === "string" ? row.ref : "");
    if (!CASE_KINDS.has(kind) || !ref || ref.length > 500) return null;
    unique.set(`${kind}\u0000${ref}`, { kind, ref });
  }
  return [...unique.values()];
}

async function manageLifecycle(
  credentials: ServiceCredentials,
  auth: AuthContext,
  action: "archive" | "restore",
  subjects: readonly CaseSubject[],
): Promise<unknown[]> {
  const response = await fetch(`${credentials.url}/rest/v1/rpc/manage_case_lifecycle`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: auth.organizationId,
      p_actor_user_id: auth.userId,
      p_action: action,
      p_subjects: subjects,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`case lifecycle failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  const rows = await response.json() as unknown;
  return Array.isArray(rows) ? rows : [];
}

async function resolveCaseSubjects(
  credentials: ServiceCredentials,
  organizationId: string,
  input: string,
): Promise<ResolvedCaseSubject[]> {
  const response = await fetch(`${credentials.url}/rest/v1/rpc/resolve_case_subject`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_input: input,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`case subject resolution failed (${response.status})`);
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((candidate): ResolvedCaseSubject[] => {
    const row = asRecord(candidate);
    const kind = typeof row.subject_kind === "string" ? row.subject_kind : "";
    const ref = typeof row.subject_ref === "string" ? row.subject_ref : "";
    const status = row.case_status === "open" || row.case_status === "archived"
      ? row.case_status
      : null;
    if (
      typeof row.case_id !== "string"
      || !CASE_KINDS.has(kind)
      || !ref
      || typeof row.display_query !== "string"
      || !status
    ) return [];
    return [{
      caseId: row.case_id,
      kind,
      ref,
      query: row.display_query,
      status,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
    }];
  });
}

async function subjectsForRef(
  credentials: ServiceCredentials,
  organizationId: string,
  ref: string,
): Promise<CaseSubject[]> {
  const response = await fetch(
    `${credentials.url}/rest/v1/cases?select=kind,canonical_ref&organization_id=eq.${encodeURIComponent(organizationId)}&canonical_ref=eq.${encodeURIComponent(ref)}&kind=in.%28person%2Ctoken%2Cinvestigation%2Csite%29`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error(`case lookup failed (${response.status})`);
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    const row = asRecord(value);
    return typeof row.kind === "string" && typeof row.canonical_ref === "string"
      ? [{ kind: row.kind, ref: row.canonical_ref }]
      : [];
  });
}

async function caseStatusForRef(
  credentials: ServiceCredentials,
  organizationId: string,
  ref: string,
  kind: string,
): Promise<"open" | "archived" | "missing"> {
  if (kind && !CASE_KINDS.has(kind)) return "missing";
  const kindFilter = kind ? `&kind=eq.${encodeURIComponent(kind)}` : "";
  const response = await fetch(
    `${credentials.url}/rest/v1/cases?select=status&organization_id=eq.${encodeURIComponent(organizationId)}&canonical_ref=eq.${encodeURIComponent(ref)}${kindFilter}&order=updated_at.desc&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error(`case status lookup failed (${response.status})`);
  const rows = await response.json() as unknown;
  const status = Array.isArray(rows) ? asRecord(rows[0]).status : null;
  return status === "open" || status === "archived" ? status : "missing";
}

function completeness(payload: unknown, requested: unknown): "complete" | "partial" | "failed" {
  if (requested === "complete" || requested === "partial" || requested === "failed") return requested;
  const root = asRecord(payload);
  const candidate = root.completeness_state
    ?? asRecord(root.completeness).state
    ?? asRecord(root.completion).state;
  if (candidate === "complete" || candidate === "partial" || candidate === "failed") return candidate;
  if (root.error || root.status === "failed") return "failed";
  return "partial";
}

const completenessState = (value: unknown): ReportCompletenessState | null =>
  value === "complete" || value === "partial" || value === "failed" ? value : null;

const attestationState = (value: unknown): ReportAttestationState | null =>
  value === "server_collected" || value === "analyst_submitted" || value === "legacy_unattested"
    ? value
    : null;

function versionMetadata(value: unknown): ReportVersionMetadata | null {
  const row = asRecord(value);
  const reportVersionId = typeof row.id === "string" ? row.id : "";
  const completeness = completenessState(row.completeness_state);
  const attestation = attestationState(row.attestation_state);
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  const methodologyVersion = typeof row.methodology_version === "string" ? row.methodology_version : null;
  if (!reportVersionId || !completeness || !attestation || !createdAt) return null;
  return {
    reportVersionId,
    completenessState: completeness,
    attestationState: attestation,
    methodologyVersion,
    createdAt,
  };
}

function mergedCost(baseValue: unknown, panelValues: readonly JsonRecord[] = []): JsonRecord {
  const base = asRecord(baseValue);
  if (!panelValues.length) return base;
  const baseCalls = Array.isArray(base.calls)
    ? base.calls.map(asRecord).filter((line) => typeof line.provider === "string" && typeof line.op === "string")
    : [];
  const panelKeys = new Set(panelValues.map((line) => `${String(line.provider)}\u0000${String(line.operation)}`));
  const replacedBaseUsd = baseCalls.reduce((sum, line) => {
    const key = `${String(line.provider)}\u0000${String(line.op)}`;
    return panelKeys.has(key) && typeof line.usd === "number" ? sum + line.usd : sum;
  }, 0);
  const callsByKey = new Map<string, JsonRecord>();
  for (const line of baseCalls) callsByKey.set(`${String(line.provider)}\u0000${String(line.op)}`, line);
  for (const line of panelValues) {
    const provider = typeof line.provider === "string" ? line.provider : "panel";
    const operation = typeof line.operation === "string" ? line.operation : "panel";
    callsByKey.set(`${provider}\u0000${operation}`, {
      provider,
      op: operation,
      calls: typeof line.calls === "number" ? line.calls : 0,
      usd: typeof line.usd === "number" ? line.usd : 0,
      ...(typeof line.meta === "string" && line.meta ? { meta: line.meta } : {}),
    });
  }
  const calls = [...callsByKey.values()].sort((a, b) =>
    (typeof b.usd === "number" ? b.usd : 0) - (typeof a.usd === "number" ? a.usd : 0)
    || (typeof b.calls === "number" ? b.calls : 0) - (typeof a.calls === "number" ? a.calls : 0));
  const baseUsd = typeof base.usd === "number"
    ? base.usd
    : baseCalls.reduce((sum, line) => typeof line.usd === "number" ? sum + line.usd : sum, 0);
  const panelUsd = panelValues.reduce((sum, line) => typeof line.usd === "number" ? sum + line.usd : sum, 0);
  return {
    ...base,
    usd: Math.round(Math.max(0, baseUsd - replacedBaseUsd + panelUsd) * 100) / 100,
    calls,
  };
}

async function loadCostLines(
  credentials: ServiceCredentials,
  organizationId: string,
  reportVersionIds: readonly string[],
): Promise<Map<string, JsonRecord[]>> {
  const ids = [...new Set(reportVersionIds.filter(Boolean))];
  const result = new Map<string, JsonRecord[]>();
  try {
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += 60) chunks.push(ids.slice(index, index + 60));
    const responses = await Promise.all(chunks.map(async (chunk) => {
      const filter = encodeURIComponent(`in.(${chunk.join(",")})`);
      const response = await fetch(
        `${credentials.url}/rest/v1/report_cost_lines?select=report_version_id,provider,operation,calls,usd,meta&organization_id=eq.${encodeURIComponent(organizationId)}&report_version_id=${filter}`,
        { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`report cost ledger read failed (${response.status})`);
      const rows = await response.json() as unknown;
      return Array.isArray(rows) ? rows : [];
    }));
    for (const value of responses.flat()) {
      const row = asRecord(value);
      const versionId = typeof row.report_version_id === "string" ? row.report_version_id : "";
      if (!versionId) continue;
      const current = result.get(versionId) ?? [];
      current.push(row);
      result.set(versionId, current);
    }
  } catch (error) {
    console.warn("[report] panel cost ledger unavailable", error);
  }
  return result;
}

async function loadVersionMetadata(
  credentials: ServiceCredentials,
  organizationId: string,
  reportVersionIds: readonly string[],
): Promise<Map<string, ReportVersionMetadata>> {
  const uniqueIds = [...new Set(reportVersionIds.filter(Boolean))];
  const result = new Map<string, ReportVersionMetadata>();
  if (!uniqueIds.length) return result;

  // Keep each PostgREST URL comfortably below common proxy limits while still
  // avoiding an N+1 lookup for the report library.
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 60) {
    chunks.push(uniqueIds.slice(index, index + 60));
  }
  const responses = await Promise.all(chunks.map(async (ids) => {
    const filter = encodeURIComponent(`in.(${ids.join(",")})`);
    const response = await fetch(
      `${credentials.url}/rest/v1/report_versions?select=id,completeness_state,attestation_state,methodology_version,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&id=${filter}`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`report version metadata read failed (${response.status})`);
    return await response.json() as unknown;
  }));

  for (const responseRows of responses) {
    if (!Array.isArray(responseRows)) continue;
    for (const row of responseRows) {
      const metadata = versionMetadata(row);
      if (metadata) result.set(metadata.reportVersionId, metadata);
    }
  }
  return result;
}

async function loadArchivedReports(
  credentials: ServiceCredentials,
  organizationId: string,
): Promise<JsonRecord[]> {
  const caseResponse = await fetch(
    `${credentials.url}/rest/v1/cases?select=id,kind,canonical_ref,display_query,updated_at&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.archived&order=updated_at.desc&limit=200`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
  );
  if (!caseResponse.ok) throw new Error(`archived case list failed (${caseResponse.status})`);
  const rawCases = await caseResponse.json() as unknown;
  const cases = Array.isArray(rawCases) ? rawCases.map(asRecord) : [];
  const caseIds = cases
    .map((row) => typeof row.id === "string" ? row.id : "")
    .filter(Boolean);
  if (!caseIds.length) return [];

  const versionChunks: string[][] = [];
  for (let index = 0; index < caseIds.length; index += 60) {
    versionChunks.push(caseIds.slice(index, index + 60));
  }
  const rawVersions = (await Promise.all(versionChunks.map(async (ids) => {
    const caseFilter = encodeURIComponent(`in.(${ids.join(",")})`);
    const response = await fetch(
      `${credentials.url}/rest/v1/report_versions?select=id,case_id,version,verdict,score,completeness_state,attestation_state,methodology_version,created_at,cost,contributor_label&organization_id=eq.${encodeURIComponent(organizationId)}&case_id=${caseFilter}&order=version.desc`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`archived report versions failed (${response.status})`);
    const rows = await response.json() as unknown;
    return Array.isArray(rows) ? rows : [];
  }))).flat();
  const latestByCase = new Map<string, JsonRecord>();
  for (const value of rawVersions) {
    const row = asRecord(value);
    const caseId = typeof row.case_id === "string" ? row.case_id : "";
    if (caseId && !latestByCase.has(caseId)) latestByCase.set(caseId, row);
  }
  const latestVersionIds = [...latestByCase.values()]
    .map((row) => typeof row.id === "string" ? row.id : "")
    .filter(Boolean);
  const costLines = await loadCostLines(credentials, organizationId, latestVersionIds);

  return cases.flatMap((reportCase) => {
    const caseId = typeof reportCase.id === "string" ? reportCase.id : "";
    const kind = typeof reportCase.kind === "string" ? reportCase.kind : "";
    const ref = typeof reportCase.canonical_ref === "string" ? reportCase.canonical_ref : "";
    const version = latestByCase.get(caseId);
    const metadata = version ? versionMetadata(version) : null;
    if (!caseId || !CASE_KINDS.has(kind) || !ref || !version || !metadata) return [];
    return [{
      ref,
      kind,
      query: typeof reportCase.display_query === "string" ? reportCase.display_query : ref,
      contributor: typeof version.contributor_label === "string" ? version.contributor_label : "anonymous",
      verdict: typeof version.verdict === "string" ? version.verdict : null,
      score: typeof version.score === "number" ? version.score : null,
      ts: metadata.createdAt,
      cost: mergedCost(version.cost, costLines.get(metadata.reportVersionId)),
      status: "archived",
      archivedAt: typeof reportCase.updated_at === "string" ? reportCase.updated_at : metadata.createdAt,
      ...metadata,
    }];
  });
}

async function loadVersionContext(
  credentials: ServiceCredentials,
  organizationId: string,
  reportVersionId: string,
): Promise<ReportVersionContext | null> {
  const [versions, checkResponse] = await Promise.all([
    loadVersionMetadata(credentials, organizationId, [reportVersionId]),
    fetch(
      `${credentials.url}/rest/v1/check_runs?select=check_id,provider,state,source_count,finished_at,stale_at,error_code,error_detail,metadata&organization_id=eq.${encodeURIComponent(organizationId)}&report_version_id=eq.${encodeURIComponent(reportVersionId)}`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
    ),
  ]);
  if (!checkResponse.ok) throw new Error(`report check runs read failed (${checkResponse.status})`);
  const metadata = versions.get(reportVersionId);
  if (!metadata) return null;
  const rawChecks = await checkResponse.json() as unknown;
  const checks = Array.isArray(rawChecks)
    ? mapStoredCheckRuns(rawChecks as StoredCheckRun[])
    : [];
  return { ...metadata, checks };
}

async function createImmutableVersion(
  credentials: ServiceCredentials,
  auth: AuthContext,
  row: Record<string, unknown>,
  raw: JsonRecord,
): Promise<string> {
  const payload = row.payload;
  const payloadRecord = asRecord(payload);
  const response = await fetch(`${credentials.url}/rest/v1/rpc/persist_report_version`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: auth.organizationId,
      p_kind: row.kind,
      p_canonical_ref: row.ref,
      p_query: row.query,
      p_created_by: auth.userId,
      p_payload: payload,
      // Client-computed token/site reports never choose an idempotency key for
      // a server-attested run. Each explicit submission is a new version.
      p_run_id: null,
      p_attestation_state: "analyst_submitted",
      p_verdict: row.verdict,
      p_score: row.score,
      p_completeness_state: completeness(payload, raw?.completenessState),
      p_methodology_version: process.env.ARGUS_METHODOLOGY_VERSION || null,
      p_provider_snapshot: payloadRecord.providerSnapshot ?? payloadRecord.providers ?? {},
      p_cost: Object.keys(asRecord(payloadRecord.cost)).length ? asRecord(payloadRecord.cost) : {},
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`immutable version write failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  const rows = (await response.json()) as unknown;
  const versionId = Array.isArray(rows) && typeof rows[0]?.report_version_id === "string"
    ? rows[0].report_version_id
    : "";
  if (!versionId) throw new Error("immutable version write returned no id");
  await persistProvenance(
    credentials,
    { organizationId: auth.organizationId, reportVersionId: versionId, attestationState: "analyst_submitted" },
    payload,
    raw.checkRuns,
  );
  await activateReportVersion(credentials, auth.organizationId, versionId);
  return versionId;
}

async function attachServerVersion(
  credentials: ServiceCredentials,
  auth: AuthContext,
  ref: string,
  payload: JsonRecord,
): Promise<string> {
  const persistence = asRecord(payload.persistence);
  const versionId = typeof persistence.reportVersionId === "string"
    ? persistence.reportVersionId
    : "";
  if (!versionId) throw new Error("server-attested person report version required");

  const versionResponse = await fetch(
    `${credentials.url}/rest/v1/report_versions?select=id,case_id,payload,attestation_state&id=eq.${encodeURIComponent(versionId)}&organization_id=eq.${encodeURIComponent(auth.organizationId)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  if (!versionResponse.ok) throw new Error(`server report lookup failed (${versionResponse.status})`);
  const versions = (await versionResponse.json()) as Array<{
    id?: unknown;
    case_id?: unknown;
    payload?: unknown;
    attestation_state?: unknown;
  }>;
  const version = Array.isArray(versions) ? versions[0] : null;
  if (!version || version.attestation_state !== "server_collected") {
    throw new Error("person report is not server-attested");
  }

  const caseResponse = await fetch(
    `${credentials.url}/rest/v1/cases?select=id,canonical_ref,kind&id=eq.${encodeURIComponent(String(version.case_id))}&organization_id=eq.${encodeURIComponent(auth.organizationId)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  if (!caseResponse.ok) throw new Error(`server case lookup failed (${caseResponse.status})`);
  const cases = (await caseResponse.json()) as Array<{
    id?: unknown;
    canonical_ref?: unknown;
    kind?: unknown;
  }>;
  const reportCase = Array.isArray(cases) ? cases[0] : null;
  if (!reportCase || reportCase.kind !== "person" || reportCase.canonical_ref !== ref) {
    throw new Error("server report does not match this person case");
  }

  const storedPayload = asRecord(version.payload);
  const storedAuditId = asRecord(storedPayload.report).audit_id;
  const submittedAuditId = asRecord(payload.report).audit_id;
  if (typeof storedAuditId !== "string" || storedAuditId !== submittedAuditId) {
    throw new Error("server report content does not match its immutable version");
  }
  await persistProvenance(
    credentials,
    { organizationId: auth.organizationId, reportVersionId: versionId, attestationState: "server_collected" },
    storedPayload,
    storedPayload.checkRuns,
  );
  await activateReportVersion(credentials, auth.organizationId, versionId);
  return versionId;
}

function projection(kind: string, payload: unknown): { verdict: string | null; score: number | null } {
  const root = asRecord(payload);
  const source = kind === "investigation"
    ? asRecord(root.token)
    : kind === "site"
      ? asRecord(asRecord(root.recon).verdict)
      : root;
  const report = asRecord(source.report);
  const verdict = typeof source.verdict === "string"
    ? source.verdict
    : typeof report.composite_verdict === "string"
      ? report.composite_verdict
      : null;
  const score = typeof source.score === "number" && Number.isFinite(source.score) && source.score >= 0 && source.score <= 100
    ? source.score
    : typeof report.governing_score === "number" && Number.isFinite(report.governing_score)
        && report.governing_score >= 0 && report.governing_score <= 100
      ? report.governing_score
      : null;
  return { verdict: verdict?.slice(0, 40) ?? null, score };
}

function payloadRef(kind: string, payload: unknown): string | null {
  const root = asRecord(payload);
  if (kind === "token") return typeof root.address === "string" ? normRef(root.address) : null;
  if (kind === "investigation") {
    const token = asRecord(root.token);
    return typeof token.address === "string" ? normRef(token.address) : null;
  }
  const retrieval = asRecord(asRecord(root.recon).retrieval);
  if (kind === "site" && typeof retrieval.url === "string") {
    try { return new URL(retrieval.url).hostname.replace(/^www\./, "").toLowerCase(); }
    catch { return null; }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestedDeleteKind = typeof req.query.kind === "string" ? req.query.kind : "";
  const minimumRole = req.method === "PATCH"
    ? "owner"
    : req.method === "DELETE"
      ? requestedDeleteKind === "watch" ? "analyst" : "owner"
      : req.method === "POST"
        ? "analyst"
        : "viewer";
  const auth = await requireArgusAuth(req, res, minimumRole);
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured" });
    return;
  }
  const orgFilter = `organization_id=eq.${encodeURIComponent(auth.organizationId)}`;

  try {
    if (req.method === "GET") {
      if (req.query.resolve != null) {
        const input = typeof req.query.resolve === "string" ? req.query.resolve.trim() : "";
        if (!input || input.length > 500) {
          res.status(400).json({ error: "valid_case_input_required" });
          return;
        }
        const subjects = await resolveCaseSubjects(credentials, auth.organizationId, input);
        res.status(200).json({ available: true, subjects });
        return;
      }

      if (req.query.list != null) {
        const requestedStatus = typeof req.query.status === "string" ? req.query.status : "open";
        if (requestedStatus !== "open" && requestedStatus !== "archived") {
          res.status(400).json({ error: "invalid_report_status" });
          return;
        }
        if (requestedStatus === "archived") {
          const reports = await loadArchivedReports(credentials, auth.organizationId);
          res.status(200).json({ available: true, reports });
          return;
        }
        const response = await fetch(
          `${credentials.url}/rest/v1/${TABLE}?select=ref,kind,query,contributor,verdict,score,ts,report_version_id,attestation_state,cost:payload->cost&${orgFilter}&kind=in.%28person%2Ctoken%2Cinvestigation%2Csite%29&order=ts.desc&limit=200`,
          { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
        );
        if (!response.ok) throw new Error(`report list failed (${response.status})`);
        const rawRows = await response.json() as unknown;
        const rows = Array.isArray(rawRows) ? rawRows.map(asRecord) : [];
        const versionIds = rows
          .map((row) => typeof row.report_version_id === "string" ? row.report_version_id : "")
          .filter(Boolean);
        const [versions, costLines] = await Promise.all([
          loadVersionMetadata(credentials, auth.organizationId, versionIds),
          loadCostLines(credentials, auth.organizationId, versionIds),
        ]);
        const reports = rows.map((row) => {
          const versionId = typeof row.report_version_id === "string" ? row.report_version_id : "";
          const metadata = versionId ? versions.get(versionId) : null;
          const cost = mergedCost(row.cost, versionId ? costLines.get(versionId) : undefined);
          return metadata
            ? { ...row, cost, status: "open", ...metadata }
            : { ...row, cost, status: "open" };
        });
        res.status(200).json({ available: true, reports });
        return;
      }

      if (req.query.watches != null) {
        const response = await fetch(
          `${credentials.url}/rest/v1/${TABLE}?select=ref,payload,ts&${orgFilter}&kind=eq.watch&order=ts.desc&limit=100`,
          { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
        );
        if (!response.ok) throw new Error(`watchlist read failed (${response.status})`);
        const rows = (await response.json()) as Array<{ payload?: unknown }>;
        res.status(200).json({
          available: true,
          watches: Array.isArray(rows) ? rows.map((item) => asRecord(item.payload).item).filter(Boolean) : [],
        });
        return;
      }

      const rawRef = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      if (!rawRef) {
        res.status(400).json({ error: "ref_required" });
        return;
      }
      const requestedKind = typeof req.query.kind === "string" ? req.query.kind : "";
      if (requestedKind && !STORED_KINDS.has(requestedKind)) {
        res.status(400).json({ error: "invalid_kind" });
        return;
      }
      const resolvedSubjects = await resolveCaseSubjects(credentials, auth.organizationId, rawRef);
      const eligibleSubjects = requestedKind
        ? resolvedSubjects.filter((subject) => subject.kind === requestedKind)
        : resolvedSubjects;
      const distinctRefs = new Set(eligibleSubjects.map((subject) => subject.ref));
      if (distinctRefs.size > 1) {
        res.status(409).json({
          error: "case_subject_ambiguous",
          subjects: eligibleSubjects,
        });
        return;
      }
      const resolvedSubject = eligibleSubjects[0];
      const ref = resolvedSubject?.ref ?? normRef(rawRef);
      if (!ref) {
        res.status(400).json({ error: "ref_required" });
        return;
      }
      const kindFilter = requestedKind ? `&kind=eq.${requestedKind}` : "";
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?select=ref,kind,query,contributor,payload,verdict,score,ts,report_version_id,attestation_state&${orgFilter}&ref=eq.${encodeURIComponent(ref)}&kind=in.%28person%2Ctoken%2Cinvestigation%2Csite%29${kindFilter}&order=ts.desc&limit=1`,
        { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`report read failed (${response.status})`);
      const rows = (await response.json()) as unknown;
      const report = Array.isArray(rows) && rows[0] ? asRecord(rows[0]) : null;
      const reportVersionId = typeof report?.report_version_id === "string"
        ? report.report_version_id
        : "";
      if (!report) {
        const caseStatus = await caseStatusForRef(
          credentials,
          auth.organizationId,
          ref,
          requestedKind,
        );
        res.status(200).json({ available: true, report: null, caseStatus });
        return;
      }
      const versionContext = reportVersionId
        ? await loadVersionContext(credentials, auth.organizationId, reportVersionId)
        : null;
      res.status(200).json({
        available: true,
        caseStatus: "open",
        report: report && versionContext ? { ...report, versionContext } : report,
      });
      return;
    }

    if (req.method === "POST") {
      const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
      const body: JsonRecord = raw && typeof raw === "object" ? raw as JsonRecord : {};
      if (JSON.stringify(body).length > MAX_BODY) {
        res.status(413).json({ error: "report_too_large" });
        return;
      }
      const ref = normRef(typeof body.ref === "string" ? body.ref : "");
      const kind = typeof body.kind === "string" ? body.kind : "";
      if (!ref || !STORED_KINDS.has(kind) || body.payload == null) {
        res.status(400).json({ error: "ref_kind_payload_required" });
        return;
      }

      if (kind === "person") {
        const reportVersionId = await attachServerVersion(
          credentials,
          auth,
          ref,
          asRecord(body.payload),
        );
        // The server stream already wrote the immutable payload and latest
        // projection. Client re-posts may only attach check outcomes.
        res.status(200).json({ ok: true, reportVersionId, linked: true });
        return;
      }

      if (CASE_KINDS.has(kind)) {
        const boundRef = payloadRef(kind, body.payload);
        if (!boundRef || boundRef !== ref) {
          res.status(409).json({ error: "payload_subject_mismatch" });
          return;
        }
      }

      const derived = projection(kind, body.payload);
      const row: Record<string, unknown> = {
        organization_id: auth.organizationId,
        ref,
        kind,
        query: typeof body.query === "string" ? body.query.slice(0, 200) : ref,
        contributor: auth.displayName.slice(0, 80),
        created_by: auth.userId,
        payload: body.payload,
        verdict: derived.verdict,
        score: derived.score,
        attestation_state: "analyst_submitted",
        ts: new Date().toISOString(),
      };

      if (CASE_KINDS.has(kind)) {
        row.report_version_id = await createImmutableVersion(credentials, auth, row, body);
        // The RPC atomically wrote both the immutable version and its active
        // projection. A second HTTP write would reintroduce partial persistence.
        res.status(200).json({ ok: true, reportVersionId: row.report_version_id });
        return;
      }

      // Watch rows are mutable shared state, not case reports.
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?on_conflict=organization_id,ref,kind`,
        {
          method: "POST",
          headers: serviceHeaders(credentials.key, {
            prefer: "resolution=merge-duplicates,return=minimal",
          }),
          body: JSON.stringify(row),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        throw new Error(`report projection write failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
      }
      res.status(200).json({ ok: true, reportVersionId: row.report_version_id ?? null });
      return;
    }

    if (req.method === "PATCH") {
      const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
      const body: JsonRecord = raw && typeof raw === "object" ? raw as JsonRecord : {};
      if (JSON.stringify(body).length > MAX_LIFECYCLE_BODY) {
        res.status(413).json({ error: "lifecycle_request_too_large" });
        return;
      }
      const action = body.action === "archive" || body.action === "restore" ? body.action : null;
      const subjects = lifecycleSubjects(body.subjects);
      if (!action || !subjects) {
        res.status(400).json({ error: "valid_action_and_subjects_required" });
        return;
      }
      const results = await manageLifecycle(credentials, auth, action, subjects);
      res.status(200).json({ ok: true, action, results });
      return;
    }

    if (req.method === "DELETE") {
      const ref = normRef(typeof req.query.ref === "string" ? req.query.ref : "");
      if (!ref) {
        res.status(400).json({ error: "ref_required" });
        return;
      }
      const requestedKind = typeof req.query.kind === "string" ? req.query.kind : "";
      if (requestedKind && !STORED_KINDS.has(requestedKind)) {
        res.status(400).json({ error: "invalid_kind" });
        return;
      }
      if (requestedKind === "watch") {
        const response = await fetch(
          `${credentials.url}/rest/v1/${TABLE}?${orgFilter}&ref=eq.${encodeURIComponent(ref)}&kind=eq.watch`,
          {
            method: "DELETE",
            headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) throw new Error(`watch projection delete failed (${response.status})`);
        res.status(200).json({ ok: true, deleted: "watch" });
        return;
      }

      const subjects = requestedKind
        ? [{ kind: requestedKind, ref }]
        : await subjectsForRef(credentials, auth.organizationId, ref);
      const results = subjects.length
        ? await manageLifecycle(credentials, auth, "archive", subjects)
        : [];
      res.status(200).json({ ok: true, action: "archive", results });
      return;
    }

    res.status(405).setHeader("Allow", "GET, POST, PATCH, DELETE").json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[report] failed", error);
    res.status(502).json({ error: "report_store_failed", message: String(error) });
  }
}
