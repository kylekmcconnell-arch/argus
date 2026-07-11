// Authenticated API: GET /api/v1/person?handle=<@handle>
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveInput, runAudit } from "../_collector.js";
import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { persistServerDossier } from "../audit.js";

export const config = { maxDuration: 180 };

function cors(req: VercelRequest, res: VercelResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowed = new Set((process.env.ARGUS_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (origin && allowed.has(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    const dossier = await runAudit(handle, () => {});
    if (!dossier) {
      res.status(404).json({ error: "could not resolve subject (no keys configured for live people audits)" });
      return;
    }
    const reportVersionId = await persistServerDossier(handle, dossier, auth);
    const r = dossier.report;
    res.status(200).json({
      api: "argus/v1",
      kind: "person",
      handle: dossier.handle,
      display_name: dossier.display_name,
      live: dossier.live,
      verdict: r.composite_verdict,
      score: r.governing_score,
      governing_role: r.governing_role,
      cap_applied: r.cap_applied,
      identity: r.identity_confidence,
      headline: dossier.headline,
      roles: r.role_reports.map((rr) => ({ role: rr.role, verdict: rr.verdict, score: rr.score_total, cap: rr.cap_applied })),
      findings: r.publishable_findings,
      report_version_id: reportVersionId,
      links: { app: `https://argus-one-flax.vercel.app/?s=${dossier.handle.replace(/^@/, "")}` },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
