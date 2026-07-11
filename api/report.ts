// Organization-scoped report projections plus immutable case versions.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type AuthContext,
  type ServiceCredentials,
} from "./_auth.js";
import { persistProvenance } from "./_provenance.js";
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
const CASE_KINDS = new Set(["person", "token", "investigation", "site"]);
const STORED_KINDS = new Set([...CASE_KINDS, "watch"]);
type JsonRecord = Record<string, unknown>;

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
  const minimumRole = req.method === "DELETE" ? "owner" : req.method === "POST" ? "analyst" : "viewer";
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
      if (req.query.list != null) {
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
        const versions = await loadVersionMetadata(credentials, auth.organizationId, versionIds);
        const reports = rows.map((row) => {
          const versionId = typeof row.report_version_id === "string" ? row.report_version_id : "";
          const metadata = versionId ? versions.get(versionId) : null;
          return metadata ? { ...row, ...metadata } : row;
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
      const versionContext = reportVersionId
        ? await loadVersionContext(credentials, auth.organizationId, reportVersionId)
        : null;
      res.status(200).json({
        available: true,
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
      }

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
      const kindFilter = requestedKind ? `&kind=eq.${requestedKind}` : "";
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?${orgFilter}&ref=eq.${encodeURIComponent(ref)}${kindFilter}`,
        {
          method: "DELETE",
          headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error(`report projection delete failed (${response.status})`);
      // Immutable report_versions remain as the auditable history of what ran.
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).setHeader("Allow", "GET, POST, DELETE").json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[report] failed", error);
    res.status(502).json({ error: "report_store_failed", message: String(error) });
  }
}
