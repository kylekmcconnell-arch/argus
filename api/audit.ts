// Authenticated person investigation stream.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveInput, runAudit } from "./_collector.js";
import type { TraceStep } from "../src/data/evidence";
import type { Dossier } from "../src/data/dossier";
import {
  consumeInvestigationQuota,
  requireArgusAuth,
  serviceCredentials,
  type AuthContext,
} from "./_auth.js";
import { activateReportVersion, persistReportVersionBundle } from "./_provenance.js";
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

const LINEAGE_METHODOLOGY_VERSION = "argus-person-v5-project-strength-bands";
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

  const cost = dossier.cost && typeof dossier.cost === "object" && !Array.isArray(dossier.cost)
    ? dossier.cost as { schemaVersion?: unknown; calls?: unknown }
    : {};
  const hasObservedLedger = cost.schemaVersion === 1 && Array.isArray(cost.calls);
  const costLines = hasObservedLedger ? cost.calls as PanelCostLine[] : [];
  if (dossier.live && !hasObservedLedger) {
    throw new Error("live provider usage ledger is missing");
  }
  const reportVersionId = await persistReportVersionBundle(credentials, {
    organizationId: auth.organizationId,
    kind: "person",
    canonicalRef: ref,
    query,
    createdBy: auth.userId,
    payload: dossier,
    checks: dossier.checkRuns,
    runId,
    attestationState,
    verdict,
    score,
    completenessState: qualifiedCompleteness,
    methodologyVersion: process.env.ARGUS_METHODOLOGY_VERSION
      || (dossier.axisCitationVersion === 1 ? LINEAGE_METHODOLOGY_VERSION : null),
    providerSnapshot: dossier?.providerSnapshot ?? dossier?.providers ?? {},
    cost: dossier?.cost ?? {},
  });
  if (costLines.length > 0) {
    await recordProviderUsageBatch(
      auth.organizationId,
      reportVersionId,
      auth.userId,
      costLines,
    );
  }
  // Always run the activation path and let the DATABASE decide what supersedes
  // what: activate_report_version_with_graph self-skips unless completeness is
  // "complete" (a decisionless INCOMPLETE report is always partial), and the
  // plain activate_report_version RPC preserves a prior decision-bearing
  // projection when the fresh scan is routing-failed. Skipping activation here
  // was broader than that DB guard — it stranded a brand-new subject's first
  // INCOMPLETE report, which should still become its visible current report.
  if (isDecisionlessIncomplete(dossier)) {
    console.info("[api/audit] decisionless incomplete report version saved; DB guard governs whether it supersedes a prior decision report", JSON.stringify({
      organizationId: auth.organizationId,
      reportVersionId,
      ref,
    }));
  }
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
