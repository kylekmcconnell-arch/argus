// Provider sentinel run. GET /api/provider-sentinel (Vercel cron, every 15 min)
// or POST from the owner dashboard ("Run check now").
//
// Probes every configured provider with its cheapest authenticated request,
// stores current state + history, and emails SENTINEL_ALERT_EMAILS on status
// transitions. Costly probes run every SENTINEL_COSTLY_INTERVAL_HOURS (6h)
// unless the owner explicitly asks for them with ?costly=1.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { runSentinel } from "../server/sentinel/run.js";

export const config = { maxDuration: 60 };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  // Same shape as /api/threat-recheck: Vercel cron carries Bearer CRON_SECRET;
  // anything else must be an authenticated owner.
  const secret = process.env.CRON_SECRET;
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const isCron = Boolean(secret && timingSafeEqual(authorization, `Bearer ${secret}`));
  if (!isCron) {
    const auth = await requireArgusAuth(req, res, "owner");
    if (!auth) return;
  }
  const costlyParam = Array.isArray(req.query?.costly) ? req.query.costly[0] : req.query?.costly;
  const includeCostly = !isCron && (costlyParam === "1" || costlyParam === "true");

  try {
    const result = await runSentinel({ trigger: isCron ? "cron" : "manual", includeCostly });
    const count = (status: string) => result.results.filter((row) => row.status === status).length;
    res.status(200).json({
      runId: result.runId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      stored: result.stored,
      summary: {
        ok: count("ok"),
        degraded: count("degraded"),
        down: count("down"),
        notConfigured: count("not_configured"),
        lowCredit: result.results.filter((row) => row.lowCredit).length,
        skipped: result.skipped,
      },
      alerts: result.alerts.map((alert) => ({ provider: alert.provider, kind: alert.kind })),
      email: result.email,
      errors: result.errors,
    });
  } catch (error) {
    console.error("[provider-sentinel] run failed", error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "sentinel_run_failed" });
  }
}
