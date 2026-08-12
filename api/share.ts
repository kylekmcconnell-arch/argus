// Create a capability-style public link for one immutable report version.
// The opaque token is returned once; only its SHA-256 digest is persisted.
import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type ServiceCredentials,
} from "./_auth.js";

export const config = { maxDuration: 15 };

const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const SHAREABLE_KINDS = new Set(["person", "token", "investigation", "site"]);
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function normalizeRef(value: string): string {
  const clean = value.trim().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
  if (SOLANA_ADDRESS.test(clean)) return clean;
  if (EVM_ADDRESS.test(clean)) return clean.toLowerCase();
  return clean.toLowerCase();
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

async function jsonRows<T>(response: Response, operation: string): Promise<T[]> {
  if (!response.ok) {
    throw new Error(`${operation} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as T[]) : [];
}

async function resolveShareableVersion(
  credentials: ServiceCredentials,
  organizationId: string,
  kind: string,
  ref: string,
  requestedReportVersionId?: string,
): Promise<string | null> {
  let reportVersionId = requestedReportVersionId ?? "";
  if (!reportVersionId) {
    const reportsResponse = await fetch(
      `${credentials.url}/rest/v1/reports?select=report_version_id&organization_id=eq.${encodeURIComponent(organizationId)}&kind=eq.${encodeURIComponent(kind)}&ref=eq.${encodeURIComponent(ref)}&report_version_id=not.is.null&order=ts.desc&limit=1`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
    );
    const reports = await jsonRows<{ report_version_id?: unknown }>(reportsResponse, "current report lookup");
    reportVersionId = typeof reports[0]?.report_version_id === "string"
      ? reports[0].report_version_id
      : "";
  }
  if (!reportVersionId) return null;

  // Whether selected explicitly or through the mutable projection, verify the
  // immutable version and case against the exact workspace and subject.
  const versionsResponse = await fetch(
    `${credentials.url}/rest/v1/report_versions?select=id,case_id&id=eq.${encodeURIComponent(reportVersionId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const versions = await jsonRows<{ id?: unknown; case_id?: unknown }>(versionsResponse, "report version lookup");
  const caseId = typeof versions[0]?.case_id === "string" ? versions[0].case_id : "";
  if (!caseId || versions[0]?.id !== reportVersionId) return null;

  const casesResponse = await fetch(
    `${credentials.url}/rest/v1/cases?select=kind,canonical_ref&id=eq.${encodeURIComponent(caseId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
  );
  const cases = await jsonRows<{ kind?: unknown; canonical_ref?: unknown }>(casesResponse, "case lookup");
  if (cases[0]?.kind !== kind || cases[0]?.canonical_ref !== ref) return null;
  return reportVersionId;
}

async function insertShareLink(
  credentials: ServiceCredentials,
  row: Record<string, unknown>,
): Promise<string> {
  // A collision is cryptographically implausible, but retrying once keeps the
  // unique token_hash constraint from ever surfacing as a user-facing failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const response = await fetch(`${credentials.url}/rest/v1/share_links`, {
      method: "POST",
      headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
      body: JSON.stringify({ ...row, token_hash: tokenHash }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return token;
    if (response.status !== 409 || attempt === 1) {
      throw new Error(`share link write failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
  }
  throw new Error("share link token could not be allocated");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured", message: "Secure sharing is not configured." });
    return;
  }

  const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "";
  const ref = typeof body.ref === "string" ? normalizeRef(body.ref) : "";
  if (!SHAREABLE_KINDS.has(kind) || !ref || ref.length > 500) {
    res.status(400).json({ error: "invalid_share_subject", message: "A valid report kind and reference are required." });
    return;
  }
  const hasRequestedVersion = Object.prototype.hasOwnProperty.call(body, "reportVersionId");
  const requestedReportVersionId = hasRequestedVersion && typeof body.reportVersionId === "string"
    ? body.reportVersionId.trim().toLowerCase()
    : "";
  if (hasRequestedVersion && !UUID.test(requestedReportVersionId)) {
    res.status(400).json({ error: "invalid_report_version", message: "A valid immutable report version is required." });
    return;
  }

  try {
    const reportVersionId = await resolveShareableVersion(
      credentials,
      auth.organizationId,
      kind,
      ref,
      hasRequestedVersion ? requestedReportVersionId : undefined,
    );
    if (!reportVersionId) {
      res.status(404).json({
        error: "shareable_report_not_found",
        message: hasRequestedVersion
          ? "That immutable report version is not available for this workspace and subject."
          : "This report has not finished saving as an immutable version yet.",
      });
      return;
    }

    const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
    const token = await insertShareLink(credentials, {
      organization_id: auth.organizationId,
      report_version_id: reportVersionId,
      created_by: auth.userId,
      expires_at: expiresAt,
    });

    res.status(201).json({
      url: `/api/card?share=${encodeURIComponent(token)}`,
      expiresAt,
    });
  } catch (error) {
    console.error("[share] creation failed", error);
    res.status(502).json({ error: "share_unavailable", message: "A secure share link could not be created right now." });
  }
}
