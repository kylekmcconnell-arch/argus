// Authenticated person investigation stream.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveInput, runAudit } from "./_collector.js";
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
import { issuePanelCostToken, recordProviderUsageBatch, type PanelCostLine } from "./_cache.js";
import { coverageQualifiedCompleteness } from "../src/lib/reportPresentation.js";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  AUDIT_SSE_HEARTBEAT_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
} from "../src/lib/investigationRuntime.js";
import { activateReportVersionWithAuthoritativeGraph } from "./_graph.js";

export const config = { maxDuration: 600 };

interface ServerDossier extends Dossier {
  completeness_state?: "complete" | "partial" | "failed";
  providers?: unknown;
}

const LINEAGE_METHODOLOGY_VERSION = "argus-person-v3-lineage";
const FINAL_GRAPH_VERDICTS = new Set(["PASS", "CAUTION", "FAIL", "AVOID", "UNVERIFIABLE_IDENTITY"]);

const normRef = (value: string) =>
  value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");

/**
 * A strict scan can legitimately finish without a governing score, but an
 * INCOMPLETE report with no scored axes is not a new decision. Persist that
 * attempt for auditability without publishing it over a prior decision-bearing
 * report, whether subject routing failed or the scorer failed after routing.
 */
export function isDecisionlessIncomplete(dossier: ServerDossier): boolean {
  const report = dossier.report;
  if (
    report?.composite_verdict !== "INCOMPLETE"
    || report?.governing_score !== null
    || !Array.isArray(report?.roles)
    || !Array.isArray(report?.role_reports)
  ) return false;

  return report.role_reports.every((roleReport) =>
    !roleReport?.axes
    || typeof roleReport.axes !== "object"
    || Array.isArray(roleReport.axes)
    || Object.keys(roleReport.axes).length === 0,
  );
}

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
  const decisionComplete = Boolean(verdict && FINAL_GRAPH_VERDICTS.has(verdict));
  const qualifiedCompleteness = coverageQualifiedCompleteness({
    completeness: decisionComplete ? dossier?.completeness_state || "partial" : "partial",
    attestation: attestationState,
    checks: dossier.checkRuns ?? [],
  });

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
      p_completeness_state: qualifiedCompleteness,
      p_methodology_version: process.env.ARGUS_METHODOLOGY_VERSION
        || (dossier.axisCitationVersion === 1 ? LINEAGE_METHODOLOGY_VERSION : null),
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
  const cost = dossier.cost && typeof dossier.cost === "object" && !Array.isArray(dossier.cost)
    ? dossier.cost as { schemaVersion?: unknown; calls?: unknown }
    : {};
  const hasObservedLedger = cost.schemaVersion === 1 && Array.isArray(cost.calls);
  const costLines = hasObservedLedger ? cost.calls as PanelCostLine[] : [];
  if (dossier.live && !hasObservedLedger) {
    throw new Error("live provider usage ledger is missing");
  }
  if (costLines.length > 0) {
    await recordProviderUsageBatch(
      auth.organizationId,
      reportVersionId,
      auth.userId,
      costLines,
    );
  }
  await persistProvenance(
    credentials,
    { organizationId: auth.organizationId, reportVersionId, attestationState },
    dossier,
    dossier.checkRuns,
  );
  if (isDecisionlessIncomplete(dossier)) {
    console.warn("[api/audit] decisionless incomplete report version saved without activation", JSON.stringify({
      organizationId: auth.organizationId,
      reportVersionId,
      ref,
    }));
  } else {
    const activatedWithGraph = await activateReportVersionWithAuthoritativeGraph(
      credentials,
      {
        organizationId: auth.organizationId,
        reportVersionId,
        userId: auth.userId,
        attestationState,
        completeness: qualifiedCompleteness,
      },
    );
    if (!activatedWithGraph) {
      await activateReportVersion(credentials, auth.organizationId, reportVersionId);
    }
  }
  return reportVersionId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestStartedAt = Date.now();
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }

  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;

  const rawHandle = typeof req.query.handle === "string" ? req.query.handle.trim() : "";
  const resolved = rawHandle ? resolveInput(rawHandle) : null;
  const handle = resolved?.kind === "handle" ? resolved.ref : "";
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
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
  const heartbeat = setInterval(() => {
    try {
      res.write(": argus-heartbeat\n\n");
    } catch {
      // Persistence continues even if the browser has disconnected.
    }
  }, AUDIT_SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const collectionStartedAt = Date.now();
    console.info("[audit-route-runtime]", JSON.stringify({
      stage: "collection-start",
      elapsedMs: collectionStartedAt - requestStartedAt,
    }));
    const dossier = await runAudit(handle, emit, {
      organizationId: auth.organizationId,
      analystDeadlineAt: requestStartedAt
        + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000
        - ANALYST_FINALIZATION_RESERVE_MS,
    }) as ServerDossier | null;
    console.info("[audit-route-runtime]", JSON.stringify({
      stage: "collection-complete",
      stageMs: Date.now() - collectionStartedAt,
      elapsedMs: Date.now() - requestStartedAt,
    }));
    if (!dossier) {
      send("error", { error: "not_found" });
    } else {
      let reportVersionId: string | null = null;
      let persistence: "private" | "persisted" | "failed" = req.query.private === "1" ? "private" : "persisted";
      if (req.query.private !== "1") {
        const persistenceStartedAt = Date.now();
        console.info("[audit-route-runtime]", JSON.stringify({
          stage: "persistence-start",
          elapsedMs: persistenceStartedAt - requestStartedAt,
        }));
        try {
          reportVersionId = await persistServerDossier(handle, dossier, auth);
        } catch (persistenceError) {
          persistence = "failed";
          console.error("[api/audit] persistence failed", persistenceError);
          send("persistence", { state: "failed" });
        } finally {
          console.info("[audit-route-runtime]", JSON.stringify({
            stage: "persistence-complete",
            state: persistence,
            stageMs: Date.now() - persistenceStartedAt,
            elapsedMs: Date.now() - requestStartedAt,
          }));
        }
      }
      const panelCostToken = persistence === "persisted" && reportVersionId
        ? issuePanelCostToken(auth.organizationId, reportVersionId)
        : undefined;
      send("done", {
        ...dossier,
        persistence: {
          state: persistence,
          reportVersionId,
          ...(panelCostToken ? { panelCostToken } : {}),
        },
      });
    }
  } catch (error) {
    console.error("[api/audit] failed", error);
    send("error", { error: "investigation_failed", message: String(error) });
  }
  console.info("[audit-route-runtime]", JSON.stringify({
    stage: "request-complete",
    elapsedMs: Date.now() - requestStartedAt,
  }));
  clearInterval(heartbeat);
  res.end();
}
