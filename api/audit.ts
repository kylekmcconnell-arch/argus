// Authenticated person investigation stream.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAudit } from "./_collector.js";
import type { TraceStep } from "../src/data/evidence";
import type { Dossier } from "../src/data/dossier";
import {
  consumeInvestigationQuota,
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type AuthContext,
} from "./_auth.js";
import { activateReportVersion, persistProvenance } from "./_provenance.js";

export const config = { maxDuration: 180 };

interface ServerDossier extends Dossier {
  completeness_state?: "complete" | "partial" | "failed";
  providers?: unknown;
}

const normRef = (value: string) =>
  value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");

export async function persistServerDossier(
  handle: string,
  dossier: ServerDossier,
  auth: AuthContext,
): Promise<string | null> {
  const credentials = serviceCredentials();
  if (!credentials || !dossier) return null;
  const ref = normRef(dossier.handle || handle);
  if (!ref) return null;
  const query = typeof dossier.handle === "string" ? dossier.handle.slice(0, 200) : ref;
  const verdict = typeof dossier?.report?.composite_verdict === "string"
    ? dossier.report.composite_verdict.slice(0, 40)
    : null;
  const score = typeof dossier?.report?.governing_score === "number"
    ? dossier.report.governing_score
    : null;
  const runId = typeof dossier?.report?.audit_id === "string"
    ? dossier.report.audit_id.slice(0, 200)
    : null;
  // A curated fallback may be assembled server-side, but it was not collected
  // from live providers. Keep that distinction in every immutable surface.
  const attestationState = dossier.live ? "server_collected" : "analyst_submitted";

  const versionResponse = await fetch(`${credentials.url}/rest/v1/rpc/persist_report_version`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: auth.organizationId,
      p_kind: "person",
      p_canonical_ref: ref,
      p_query: query,
      p_created_by: auth.userId,
      p_payload: dossier,
      p_run_id: runId,
      p_attestation_state: attestationState,
      p_verdict: verdict,
      p_score: score,
      p_completeness_state: dossier?.completeness_state || "partial",
      p_methodology_version: process.env.ARGUS_METHODOLOGY_VERSION || null,
      p_provider_snapshot: dossier?.providerSnapshot ?? dossier?.providers ?? {},
      p_cost: dossier?.cost ?? {},
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!versionResponse.ok) {
    throw new Error(`immutable report write failed (${versionResponse.status}): ${(await versionResponse.text()).slice(0, 240)}`);
  }
  const versions = (await versionResponse.json()) as Array<{ report_version_id?: unknown }>;
  const reportVersionId = Array.isArray(versions) && typeof versions[0]?.report_version_id === "string"
    ? versions[0].report_version_id
    : null;
  if (!reportVersionId) throw new Error("immutable report write returned no id");
  await persistProvenance(
    credentials,
    { organizationId: auth.organizationId, reportVersionId, attestationState },
    dossier,
    dossier.checkRuns,
  );
  await activateReportVersion(credentials, auth.organizationId, reportVersionId);
  return reportVersionId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }

  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;

  const handle = typeof req.query.handle === "string" ? req.query.handle.trim() : "";
  if (!handle || handle.length > 200) {
    res.status(400).json({ error: "valid_handle_required" });
    return;
  }

  const quota = await consumeInvestigationQuota(auth, "/api/audit", {
    private: req.query.private === "1",
  });
  if (quota.error) {
    res.status(503).json({ error: quota.error, message: "Usage controls are temporarily unavailable." });
    return;
  }
  if (!quota.allowed) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    res.setHeader("Retry-After", Math.max(1, Math.ceil((tomorrow.getTime() - Date.now()) / 1_000)));
    res.status(429).json({
      error: "daily_investigation_limit_reached",
      used: quota.used,
      remaining: 0,
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store, no-transform",
    "x-accel-buffering": "no",
    "x-argus-quota-remaining": String(quota.remaining),
    connection: "keep-alive",
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // The investigation continues and persists even if the client disconnects.
    }
  };
  const emit = (step: TraceStep) => send("step", step);
  send("quota", { remaining: quota.remaining });

  try {
    const dossier = await runAudit(handle, emit) as ServerDossier | null;
    if (!dossier) {
      send("error", { error: "not_found" });
    } else {
      let reportVersionId: string | null = null;
      let persistence: "private" | "persisted" | "failed" = req.query.private === "1" ? "private" : "persisted";
      if (req.query.private !== "1") {
        try {
          reportVersionId = await persistServerDossier(handle, dossier, auth);
        } catch (persistenceError) {
          persistence = "failed";
          console.error("[api/audit] persistence failed", persistenceError);
          send("persistence", { state: "failed" });
        }
      }
      send("done", { ...dossier, persistence: { state: persistence, reportVersionId } });
    }
  } catch (error) {
    console.error("[api/audit] failed", error);
    send("error", { error: "investigation_failed", message: String(error) });
  }
  res.end();
}
