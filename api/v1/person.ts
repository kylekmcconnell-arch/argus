// Public API: GET /api/v1/person?handle=<@handle>
// Multi-class principal audit as JSON. Returns the curated dossier when no
// provider keys are configured; live collection when they are. CORS-open.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAudit } from "../_collector.js";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "public, max-age=30");
  const handle = req.query.handle as string | undefined;
  if (!handle) {
    res.status(400).json({ error: "pass ?handle=<@handle>" });
    return;
  }
  try {
    const dossier = await runAudit(handle, () => {});
    if (!dossier) {
      res.status(404).json({ error: "could not resolve subject (no keys configured for live people audits)" });
      return;
    }
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
      links: { app: `https://argus-one-flax.vercel.app/?s=${dossier.handle.replace(/^@/, "")}` },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
