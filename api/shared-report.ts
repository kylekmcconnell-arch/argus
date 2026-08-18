// Serve one immutable report version to the holder of a share capability.
// GET /api/shared-report?share=<token>
//
// The token (minted by /api/share, 30-day TTL, revocable) is the entire
// authority: no ARGUS account is needed to read. The response is the same
// frozen version payload the in-app evidence review renders, minus workspace
// internals (cost ledgers, persistence capabilities) — the recipient gets the
// whole interactive report, and nothing that lets them act on the workspace.
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serviceCredentials, serviceHeaders } from "./_auth.js";
import { loadExactVersionReport } from "./report.js";

export const config = { maxDuration: 15 };

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;

// Workspace-internal keys that never leave with a shared payload. Applied to
// the top level and to the embedded dossiers an investigation carries.
const WORKSPACE_KEYS = ["cost", "persistence", "viewPersistence"] as const;

function stripWorkspaceKeys(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const key of WORKSPACE_KEYS) delete record[key];
}

export function sanitizeSharedPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  stripWorkspaceKeys(clone);
  stripWorkspaceKeys(clone.token);
  stripWorkspaceKeys(clone.projectAccount);
  return clone;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  res.setHeader("referrer-policy", "no-referrer");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const token = typeof req.query.share === "string" ? req.query.share.trim() : "";
  if (!TOKEN_SHAPE.test(token)) {
    res.status(400).json({ error: "invalid_share_token" });
    return;
  }
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured" });
    return;
  }

  try {
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const linkResponse = await fetch(
      `${credentials.url}/rest/v1/share_links?select=organization_id,report_version_id,expires_at,revoked_at&token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
    );
    if (!linkResponse.ok) throw new Error(`share link read failed (${linkResponse.status})`);
    const rows = (await linkResponse.json()) as {
      organization_id?: unknown;
      report_version_id?: unknown;
      expires_at?: unknown;
      revoked_at?: unknown;
    }[];
    const link = Array.isArray(rows) ? rows[0] : undefined;
    const organizationId = typeof link?.organization_id === "string" ? link.organization_id : "";
    const reportVersionId = typeof link?.report_version_id === "string" ? link.report_version_id : "";
    const expiresAt = typeof link?.expires_at === "string" ? link.expires_at : null;
    const revoked = link?.revoked_at != null;
    const expired = expiresAt != null && Date.parse(expiresAt) <= Date.now();
    if (!organizationId || !reportVersionId || revoked || expired) {
      // One honest state for absent, revoked, and expired: the capability no
      // longer opens anything, and which of the three it was is not the
      // recipient's business.
      res.status(404).json({ error: "share_link_not_available", message: "This share link is no longer available. Ask the sender for a fresh one." });
      return;
    }

    const exact = await loadExactVersionReport(credentials, organizationId, reportVersionId);
    if (!exact?.report) {
      res.status(404).json({ error: "share_link_not_available", message: "This share link is no longer available. Ask the sender for a fresh one." });
      return;
    }
    res.status(200).json({
      available: true,
      report: { ...exact.report, payload: sanitizeSharedPayload(exact.report.payload) },
      expiresAt,
    });
  } catch (error) {
    console.error("[shared-report] read failed", error);
    res.status(502).json({ error: "shared_report_unavailable" });
  }
}
