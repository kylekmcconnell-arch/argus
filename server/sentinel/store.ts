// Supabase REST persistence for the provider sentinel. Service-role only: the
// tables have RLS enabled with no policies and are revoked from anon and
// authenticated (see supabase/migrations/*_provider_sentinel.sql).
import type { AlertKind, ProbeResult, ProviderStatusRow, SentAlertRow, SentinelStatus } from "./types.js";

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export interface SentinelStore {
  url: string;
  key: string;
  fetcher: Fetcher;
}

export interface CheckRow {
  provider: string;
  status: SentinelStatus;
  reason: string | null;
  low_credit: boolean;
  latency_ms: number | null;
  checked_at: string;
}

export interface AlertRow {
  run_id: string;
  provider: string;
  kind: AlertKind;
  status: SentinelStatus;
  detail: string;
  delivered: boolean;
  sent_at: string;
}

export interface RunRow {
  id: string;
  trigger: "cron" | "manual";
  started_at: string;
  finished_at: string;
  summary: Record<string, unknown>;
  alerts_sent: number;
  email_status: string;
}

export function sentinelStore(env: Env = process.env, fetcher: Fetcher = fetch): SentinelStore | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  return url && key ? { url, key: key.trim(), fetcher } : null;
}

function headers(store: SentinelStore, extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = { apikey: store.key, "content-type": "application/json", ...extra };
  // Opaque sb_secret_* keys must never be sent as Bearer JWTs.
  if (!store.key.startsWith("sb_secret_")) result.authorization = `Bearer ${store.key}`;
  return result;
}

async function rest(store: SentinelStore, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await store.fetcher(`${store.url}/rest/v1/${path}`, {
    ...init,
    headers: headers(store, init.headers as Record<string, string> | undefined),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Status only: PostgREST bodies can echo filters, never credentials, but keep it short.
    throw new Error(`sentinel store ${init.method ?? "GET"} ${path.split("?")[0]} failed (${response.status})`);
  }
  return response;
}

export async function loadStatuses(store: SentinelStore): Promise<ProviderStatusRow[]> {
  const response = await rest(store, "provider_status?select=*&order=provider.asc");
  const rows = await response.json() as unknown;
  return Array.isArray(rows) ? rows as ProviderStatusRow[] : [];
}

export async function loadRecentAlerts(store: SentinelStore, sinceIso: string): Promise<SentAlertRow[]> {
  const query = new URLSearchParams({ select: "provider,kind,sent_at", delivered: "eq.true", sent_at: `gte.${sinceIso}` });
  const response = await rest(store, `provider_alerts?${query}`);
  const rows = await response.json() as unknown;
  return Array.isArray(rows) ? rows as SentAlertRow[] : [];
}

export async function upsertStatuses(store: SentinelStore, rows: readonly ProviderStatusRow[]): Promise<void> {
  if (!rows.length) return;
  await rest(store, "provider_status?on_conflict=provider", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}

export async function insertChecks(store: SentinelStore, runId: string, results: readonly ProbeResult[]): Promise<void> {
  if (!results.length) return;
  const rows = results.map((result) => ({
    run_id: runId,
    provider: result.provider,
    status: result.status,
    reason: result.reason ?? null,
    detail: result.detail,
    latency_ms: result.latencyMs,
    http_status: result.httpStatus ?? null,
    low_credit: result.lowCredit,
    balance: result.balance ?? null,
    checked_at: result.checkedAt,
  }));
  await rest(store, "provider_checks", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
}

export async function insertAlerts(store: SentinelStore, rows: readonly AlertRow[]): Promise<void> {
  if (!rows.length) return;
  await rest(store, "provider_alerts", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
}

export async function insertRun(store: SentinelStore, row: RunRow): Promise<void> {
  await rest(store, "provider_sentinel_runs", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
}

/** Delete history older than the retention windows. */
export async function pruneHistory(store: SentinelStore, now: Date): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  const checksBefore = new Date(now.getTime() - 30 * day).toISOString();
  const alertsBefore = new Date(now.getTime() - 90 * day).toISOString();
  await Promise.all([
    rest(store, `provider_checks?checked_at=lt.${encodeURIComponent(checksBefore)}`, { method: "DELETE", headers: { prefer: "return=minimal" } }),
    rest(store, `provider_sentinel_runs?started_at=lt.${encodeURIComponent(checksBefore)}`, { method: "DELETE", headers: { prefer: "return=minimal" } }),
    rest(store, `provider_alerts?sent_at=lt.${encodeURIComponent(alertsBefore)}`, { method: "DELETE", headers: { prefer: "return=minimal" } }),
  ]);
}

/** History rows since `sinceIso`, oldest first. Paginates past PostgREST's max-rows cap. */
export async function loadChecksSince(store: SentinelStore, sinceIso: string, maxRows = 20_000): Promise<CheckRow[]> {
  const page = 1000;
  const out: CheckRow[] = [];
  for (let offset = 0; offset < maxRows; offset += page) {
    const query = new URLSearchParams({
      select: "provider,status,reason,low_credit,latency_ms,checked_at",
      checked_at: `gte.${sinceIso}`,
      order: "checked_at.asc",
      limit: String(page),
      offset: String(offset),
    });
    const response = await rest(store, `provider_checks?${query}`);
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) break;
    out.push(...rows as CheckRow[]);
    if (rows.length < page) break;
  }
  return out;
}

export async function loadLastRun(store: SentinelStore): Promise<RunRow | null> {
  const response = await rest(store, "provider_sentinel_runs?select=*&order=started_at.desc&limit=1");
  const rows = await response.json() as unknown;
  return Array.isArray(rows) && rows[0] ? rows[0] as RunRow : null;
}
