// View helpers for the owner API-status dashboard. Pure so the uptime strip
// and pill logic are testable without rendering.

export type SentinelStatus = "ok" | "degraded" | "down" | "not_configured";
export type PillTone = "green" | "amber" | "red" | "grey";

export interface SentinelHistoryPoint {
  status: SentinelStatus;
  lowCredit: boolean;
  checkedAt: string;
  latencyMs: number | null;
}

export interface SentinelBalanceView {
  usd?: number;
  credits?: number;
  quota?: { limit?: number; remaining?: number; period?: string; resetAt?: string };
  label?: string;
}

export interface SentinelCurrent {
  status: SentinelStatus;
  reason: string | null;
  detail: string;
  latencyMs: number | null;
  httpStatus: number | null;
  lowCredit: boolean;
  balance: SentinelBalanceView | null;
  checkedAt: string;
  lastOkAt: string | null;
  lastChangeAt: string | null;
  advice: string;
}

export interface SentinelProviderView {
  provider: string;
  label: string;
  optional: boolean;
  costly: boolean;
  costNote: string;
  endpoint: string;
  console: string;
  envVars: string[];
  current: SentinelCurrent | null;
  uptime24h: number | null;
  history: SentinelHistoryPoint[];
}

export interface SentinelStatusPayload {
  available: boolean;
  generatedAt: string;
  thresholds: { lowUsd: number; lowQuotaPct: number };
  lastRun: { startedAt: string; finishedAt: string; trigger: string; emailStatus: string; alertsSent: number } | null;
  summary: { ok: number; lowCredit: number; degraded: number; down: number; notConfigured: number; unchecked: number };
  providers: SentinelProviderView[];
}

export function pillTone(current: Pick<SentinelCurrent, "status" | "lowCredit"> | null): PillTone {
  if (!current) return "grey";
  if (current.status === "down") return "red";
  if (current.status === "degraded" || current.lowCredit) return "amber";
  if (current.status === "ok") return "green";
  return "grey";
}

export function pillLabel(current: Pick<SentinelCurrent, "status" | "lowCredit"> | null): string {
  if (!current) return "Not checked";
  if (current.status === "ok") return current.lowCredit ? "Low credit" : "OK";
  if (current.status === "degraded") return "Degraded";
  if (current.status === "down") return "Down";
  return "Not configured";
}

const SEVERITY: Record<PillTone, number> = { grey: 0, green: 1, amber: 2, red: 3 };

/**
 * Bucket 24h of checks into `slots` equal windows ending at `now`. Each slot
 * takes the worst tone observed in it; a slot with no check is null (gap).
 */
export function uptimeStrip(history: readonly SentinelHistoryPoint[], now: Date, slots = 48, windowMs = 24 * 60 * 60 * 1000): (PillTone | null)[] {
  const out: (PillTone | null)[] = Array.from({ length: slots }, () => null);
  const start = now.getTime() - windowMs;
  const width = windowMs / slots;
  for (const point of history) {
    const at = Date.parse(point.checkedAt);
    if (!Number.isFinite(at) || at < start || at > now.getTime()) continue;
    const index = Math.min(slots - 1, Math.floor((at - start) / width));
    const tone = pillTone(point);
    const existing = out[index];
    if (existing === null || SEVERITY[tone] > SEVERITY[existing]) out[index] = tone;
  }
  return out;
}

export function formatBalance(balance: SentinelBalanceView | null | undefined): string | null {
  if (!balance) return null;
  const parts: string[] = [];
  if (typeof balance.usd === "number") parts.push(`$${balance.usd.toFixed(2)}`);
  if (typeof balance.credits === "number" && typeof balance.usd !== "number") parts.push(`${Math.round(balance.credits).toLocaleString("en-US")}`);
  const quota = balance.quota;
  if (quota && typeof quota.limit === "number" && typeof quota.remaining === "number" && typeof balance.usd !== "number") {
    const pct = quota.limit > 0 ? Math.round((quota.remaining / quota.limit) * 100) : 0;
    parts.push(`${quota.remaining.toLocaleString("en-US")} / ${quota.limit.toLocaleString("en-US")} (${pct}%)`);
  }
  if (!parts.length) return null;
  return balance.label ? `${parts.join(" · ")} ${balance.label}` : parts.join(" · ");
}

export function relativeTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  const seconds = Math.max(0, Math.round((now.getTime() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Sort: down, degraded/low credit, ok, not configured; then label. */
export function sortProviders(providers: readonly SentinelProviderView[]): SentinelProviderView[] {
  return [...providers].sort((a, b) => {
    const severity = SEVERITY[pillTone(b.current)] - SEVERITY[pillTone(a.current)];
    if (severity !== 0) {
      // grey (not configured / unchecked) sinks to the bottom.
      const aGrey = pillTone(a.current) === "grey";
      const bGrey = pillTone(b.current) === "grey";
      if (aGrey !== bGrey) return aGrey ? 1 : -1;
      return severity;
    }
    return a.label.localeCompare(b.label);
  });
}
