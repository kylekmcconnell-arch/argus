// Authenticated API: GET /api/v1/person?handle=<@handle>
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveInput, runAudit } from "../_collector.js";
import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { persistServerDossier } from "../audit.js";
import type { Dossier } from "../../src/data/dossier.js";
import { deriveDecisionReadiness } from "../../src/lib/decisionReadiness.js";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
} from "../../src/lib/investigationRuntime.js";
import {
  coverageQualifiedCompleteness,
  presentPublicReport,
} from "../../src/lib/reportPresentation.js";

export const config = { maxDuration: 600 };

function cors(req: VercelRequest, res: VercelResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowed = new Set((process.env.ARGUS_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (origin && allowed.has(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
}

function rawRoles(dossier: Dossier) {
  return dossier.report.role_reports.map((role) => ({
    role: role.role,
    verdict: role.verdict,
    score: role.score_total,
    cap: role.cap_applied,
  }));
}

function canonicalApiVerdict(value: string): string {
  return value === "UNVERIFIABLE" ? "UNVERIFIABLE_IDENTITY" : value;
}

/**
 * Project the immutable scorer output through the same fail-closed readiness
 * policy used by the dashboard. The raw model result stays auditable, but it
 * cannot occupy the API's final verdict/score fields until every applicable
 * frozen check has a successful outcome.
 */
export function personApiResult(dossier: Dossier, reportVersionId: string | null) {
  const report = dossier.report;
  const checks = dossier.checkRuns ?? [];
  const attestation = dossier.live ? "server_collected" : "analyst_submitted";
  const completeness = coverageQualifiedCompleteness({
    completeness: dossier.completeness_state ?? "partial",
    attestation,
    checks,
  });
  const presentation = presentPublicReport({
    verdict: report.composite_verdict,
    score: report.governing_score,
    completeness,
  });
  const coverage = deriveDecisionReadiness(checks);
  const roles = rawRoles(dossier);
  const decisionReady = presentation.final;
  const finalScore = decisionReady && presentation.primaryScore
    ? Number(presentation.primaryScore)
    : null;
  const readinessState = decisionReady
    ? "ready"
    : completeness === "failed"
      ? "failed"
      : coverage.status === "provisional"
        ? "provisional"
        : "incomplete";
  const hasRawModelSignal = report.composite_verdict !== "INCOMPLETE"
    || report.governing_score !== null
    || roles.some((role) => role.verdict !== "INCOMPLETE" || role.score !== null);

  return {
    api: "argus/v1",
    kind: "person",
    handle: dossier.handle,
    display_name: dossier.display_name,
    live: dossier.live,
    // These two fields are the final, coverage-qualified decision output.
    verdict: decisionReady ? canonicalApiVerdict(presentation.displayVerdict) : "INCOMPLETE",
    score: finalScore,
    decision_ready: decisionReady,
    completeness_state: completeness,
    decision_readiness: {
      state: readinessState,
      coverage_percent: coverage.coveragePercent,
      successful_checks: coverage.successful,
      applicable_checks: coverage.applicable,
      unresolved_checks: coverage.unresolved,
      note: presentation.note,
    },
    preliminary_model_signal: !decisionReady && hasRawModelSignal ? {
      verdict: report.composite_verdict,
      score: report.governing_score,
      headline: dossier.headline,
      roles,
      classification: presentation.resultLabel === "RISK SIGNAL" ? "risk_signal" : "preliminary",
    } : null,
    governing_role: report.governing_role,
    cap_applied: report.cap_applied,
    identity: report.identity_confidence,
    headline: decisionReady ? dossier.headline : presentation.note,
    roles: roles.map((role) => ({
      ...role,
      verdict: decisionReady ? role.verdict : "INCOMPLETE",
      score: decisionReady ? role.score : null,
      status: decisionReady ? "final" : "preliminary",
    })),
    findings: report.publishable_findings,
    report_version_id: reportVersionId,
    links: { app: `https://argus-one-flax.vercel.app/?s=${dossier.handle.replace(/^@/, "")}` },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestStartedAt = Date.now();
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).setHeader("Allow", "GET, OPTIONS").json({ error: "method_not_allowed" }); return; }
  res.setHeader("cache-control", "private, no-store");
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const rawHandle = typeof req.query.handle === "string" ? req.query.handle.trim() : "";
  const resolved = rawHandle ? resolveInput(rawHandle) : null;
  const handle = resolved?.kind === "handle" ? resolved.ref : "";
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    res.status(400).json({ error: "pass ?handle=<@handle>" });
    return;
  }
  const quota = await consumeInvestigationQuota(auth, "/api/v1/person", { kind: "person_api" });
  if (quota.error) { res.status(503).json({ error: quota.error }); return; }
  if (!quota.allowed) { res.status(429).json({ error: "daily_investigation_limit_reached", remaining: 0 }); return; }
  try {
    const dossier = await runAudit(handle, () => {}, {
      organizationId: auth.organizationId,
      analystDeadlineAt: requestStartedAt
        + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000
        - ANALYST_FINALIZATION_RESERVE_MS,
    });
    if (!dossier) {
      res.status(404).json({ error: "could not resolve subject (no keys configured for live people audits)" });
      return;
    }
    const reportVersionId = await persistServerDossier(handle, dossier, auth);
    res.status(200).json(personApiResult(dossier, reportVersionId));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
