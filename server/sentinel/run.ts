// One sentinel pass: probe every provider, persist current state and history,
// and email the owner on transitions. Shared by the cron route and the owner
// "Run check now" action so both follow exactly the same logic.
import { randomUUID } from "node:crypto";
import { adviceFor, alertRecipients, alertSubject, alertText, ALERT_DEDUPE_MS, dedupeAlerts, detectTransitions } from "./alerts.js";
import { thresholdsFromEnv } from "./classify.js";
import { PROBES, runProbes, type ProbeDefinition } from "./probes.js";
import {
  insertAlerts,
  insertChecks,
  insertRun,
  loadRecentAlerts,
  loadStatuses,
  pruneHistory,
  sentinelStore,
  upsertStatuses,
  type AlertRow,
} from "./store.js";
import type { ProbeResult, ProviderStatusRow, SentinelAlert } from "./types.js";

type Env = Record<string, string | undefined>;

export interface RunSentinelOptions {
  trigger: "cron" | "manual";
  /** Run costly probes even when they are not due. */
  includeCostly?: boolean;
  env?: Env;
  fetcher?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface RunSentinelResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  stored: boolean;
  results: ProbeResult[];
  skipped: string[];
  alerts: SentinelAlert[];
  email: "sent" | "not_configured" | "failed" | "none";
  errors: string[];
}

export function costlyIntervalMs(env: Env): number {
  const hours = Number(env.SENTINEL_COSTLY_INTERVAL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60 * 1000;
}

/** A costly probe runs when forced, when never checked, or when its last check is older than the interval. */
export function costlyProbeDue(def: ProbeDefinition, previous: ProviderStatusRow | undefined, now: Date, intervalMs: number, includeCostly: boolean): boolean {
  if (!def.costly || includeCostly) return true;
  if (!previous || previous.status === "not_configured") return true;
  const last = Date.parse(previous.checked_at);
  // A failing costly probe is rechecked on the normal cadence so recovery is noticed.
  if (previous.status !== "ok") return true;
  return !Number.isFinite(last) || now.getTime() - last >= intervalMs;
}

export function nextStatusRow(result: ProbeResult, previous: ProviderStatusRow | undefined): ProviderStatusRow {
  const changed = !previous || previous.status !== result.status || previous.low_credit !== result.lowCredit;
  return {
    provider: result.provider,
    label: result.label,
    status: result.status,
    reason: result.reason ?? null,
    detail: result.detail,
    latency_ms: result.latencyMs,
    http_status: result.httpStatus ?? null,
    costly: result.costly,
    optional: result.optional,
    low_credit: result.lowCredit,
    balance: result.balance ?? null,
    checked_at: result.checkedAt,
    last_ok_at: result.status === "ok" ? result.checkedAt : previous?.last_ok_at ?? null,
    last_change_at: changed ? result.checkedAt : previous?.last_change_at ?? result.checkedAt,
  };
}

async function sendAlertEmail(env: Env, alerts: readonly SentinelAlert[], fetcher: typeof fetch): Promise<"sent" | "not_configured" | "failed"> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = alertRecipients(env.SENTINEL_ALERT_EMAILS);
  if (!apiKey || !to.length) return "not_configured";
  const origin = env.ARGUS_APP_ORIGIN?.trim().replace(/\/$/, "");
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM || "ARGUS <onboarding@resend.dev>",
        to,
        subject: alertSubject(alerts),
        text: alertText(alerts, origin ? `${origin}/?apis` : undefined),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export async function runSentinel(options: RunSentinelOptions): Promise<RunSentinelResult> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.info(`[provider-sentinel] ${message}`));
  const runId = randomUUID();
  const started = now();
  const errors: string[] = [];
  const store = sentinelStore(env, fetcher);

  let previousRows: ProviderStatusRow[] = [];
  let previousLoaded = false;
  if (store) {
    try {
      previousRows = await loadStatuses(store);
      previousLoaded = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "status read failed");
    }
  } else {
    errors.push("Supabase service credentials are not configured; results are not stored.");
  }
  const previous = new Map(previousRows.map((row) => [row.provider, row]));

  const intervalMs = costlyIntervalMs(env);
  const { results, skipped } = await runProbes({
    env,
    fetcher,
    now,
    thresholds: thresholdsFromEnv(env),
    shouldRun: (def) => costlyProbeDue(def, previous.get(def.id), started, intervalMs, Boolean(options.includeCostly)),
  });

  let stored = false;
  let alerts: SentinelAlert[] = [];
  let email: RunSentinelResult["email"] = "none";

  if (store && previousLoaded) {
    try {
      await upsertStatuses(store, results.map((result) => nextStatusRow(result, previous.get(result.provider))));
      await insertChecks(store, runId, results);
      stored = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "status write failed");
    }

    // Without a readable previous state every provider would look "new" and
    // alert, so alerting only runs when the prior state was loaded.
    const transitions = detectTransitions(results, previous);
    if (transitions.length) {
      try {
        const sent = await loadRecentAlerts(store, new Date(started.getTime() - ALERT_DEDUPE_MS).toISOString());
        alerts = dedupeAlerts(transitions, sent, started);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "alert history read failed");
        alerts = [];
      }
    }
    if (alerts.length) {
      email = await sendAlertEmail(env, alerts, fetcher);
      if (email === "not_configured") log(`${alerts.length} alert(s) not emailed: set RESEND_API_KEY and SENTINEL_ALERT_EMAILS.`);
      if (email === "failed") log(`${alerts.length} alert(s) failed to send via Resend.`);
      const sentAt = now().toISOString();
      const rows: AlertRow[] = alerts.map((alert) => ({
        run_id: runId,
        provider: alert.provider,
        kind: alert.kind,
        status: alert.status,
        detail: alert.detail,
        delivered: email === "sent",
        sent_at: sentAt,
      }));
      try {
        await insertAlerts(store, rows);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "alert log write failed");
      }
    }
    try {
      await pruneHistory(store, started);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "history prune failed");
    }
  }

  const finishedAt = now().toISOString();
  if (store && stored) {
    const count = (status: string) => results.filter((result) => result.status === status).length;
    try {
      await insertRun(store, {
        id: runId,
        trigger: options.trigger,
        started_at: started.toISOString(),
        finished_at: finishedAt,
        summary: {
          ok: count("ok"),
          degraded: count("degraded"),
          down: count("down"),
          not_configured: count("not_configured"),
          low_credit: results.filter((result) => result.lowCredit).length,
          skipped,
          errors: errors.length,
        },
        alerts_sent: email === "sent" ? alerts.length : 0,
        email_status: email,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "run log write failed");
    }
  }

  return { runId, startedAt: started.toISOString(), finishedAt, stored, results, skipped, alerts, email, errors };
}

/** Advice for a stored row, for the status API. */
export function rowAdvice(row: Pick<ProviderStatusRow, "provider" | "status" | "reason" | "http_status" | "low_credit">): string {
  return adviceFor(row.provider, row.status, row.reason, row.http_status, row.low_credit);
}

export { PROBES };
