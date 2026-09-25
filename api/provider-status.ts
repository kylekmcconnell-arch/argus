// Owner-only provider sentinel status. GET /api/provider-status
//
// Current state per provider (from the last sentinel pass), last-24h history
// for the uptime strip, fix advice, and the last run time. Read-only: it never
// calls a provider. "Run check now" POSTs /api/provider-sentinel instead.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { PROBES, rowAdvice } from "../server/sentinel/run.js";
import { loadChecksSince, loadLastRun, loadStatuses, sentinelStore, type CheckRow } from "../server/sentinel/store.js";
import { thresholdsFromEnv } from "../server/sentinel/classify.js";
import type { ProviderStatusRow } from "../server/sentinel/types.js";

export const config = { maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;

  const store = sentinelStore();
  if (!store) {
    res.status(503).json({ available: false, error: "store_not_configured" });
    return;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let rows: ProviderStatusRow[];
  let checks: CheckRow[];
  let lastRun: Awaited<ReturnType<typeof loadLastRun>>;
  try {
    [rows, checks, lastRun] = await Promise.all([loadStatuses(store), loadChecksSince(store, since), loadLastRun(store)]);
  } catch {
    res.status(503).json({
      available: false,
      error: "sentinel_tables_unavailable",
      message: "Provider sentinel tables could not be read. Apply the provider_sentinel migration.",
    });
    return;
  }

  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const history = new Map<string, CheckRow[]>();
  for (const check of checks) {
    const list = history.get(check.provider) ?? [];
    list.push(check);
    history.set(check.provider, list);
  }

  const providers = PROBES.map((def) => {
    const row = byProvider.get(def.id);
    const events = history.get(def.id) ?? [];
    const counted = events.filter((event) => event.status !== "not_configured");
    const up = counted.filter((event) => event.status === "ok").length;
    return {
      provider: def.id,
      label: def.label,
      optional: Boolean(def.optional),
      costly: def.costly,
      costNote: def.costNote,
      endpoint: def.endpoint,
      console: def.console,
      envVars: [...def.env, ...(def.anyEnv ? [def.anyEnv.join(" | ")] : [])],
      current: row
        ? {
          status: row.status,
          reason: row.reason,
          detail: row.detail,
          latencyMs: row.latency_ms,
          httpStatus: row.http_status,
          lowCredit: row.low_credit,
          balance: row.balance,
          checkedAt: row.checked_at,
          lastOkAt: row.last_ok_at,
          lastChangeAt: row.last_change_at,
          advice: rowAdvice(row),
        }
        : null,
      uptime24h: counted.length ? up / counted.length : null,
      history: events.map((event) => ({ status: event.status, lowCredit: event.low_credit, checkedAt: event.checked_at, latencyMs: event.latency_ms })),
    };
  });

  const current = providers.map((provider) => provider.current).filter((value): value is NonNullable<typeof value> => value !== null);
  res.status(200).json({
    available: true,
    generatedAt: new Date().toISOString(),
    thresholds: thresholdsFromEnv(),
    lastRun: lastRun
      ? { startedAt: lastRun.started_at, finishedAt: lastRun.finished_at, trigger: lastRun.trigger, emailStatus: lastRun.email_status, alertsSent: lastRun.alerts_sent }
      : null,
    summary: {
      ok: current.filter((row) => row.status === "ok" && !row.lowCredit).length,
      lowCredit: current.filter((row) => row.lowCredit).length,
      degraded: current.filter((row) => row.status === "degraded").length,
      down: current.filter((row) => row.status === "down").length,
      notConfigured: current.filter((row) => row.status === "not_configured").length,
      unchecked: providers.length - current.length,
    },
    providers,
  });
}
