// Shared types for the provider sentinel: live key/credit probes, their stored
// history, and the alert transitions derived from them. Kept free of runtime
// imports so the API layer, the store, and tests can all share them.

export type SentinelStatus = "ok" | "degraded" | "down" | "not_configured";

/**
 * Machine reason for a non-ok result. Categories are hints read from the HTTP
 * status and a bounded slice of the response, never raw provider text, and
 * never include a credential.
 */
export type SentinelReason =
  | "missing_key"
  | "auth_invalid"
  | "out_of_credits"
  | "rate_limited"
  | "timeout"
  | "provider_error_5xx"
  | "unexpected_response";

export interface SentinelBalance {
  /** Provider-reported USD balance or remaining key limit. */
  usd?: number;
  /** Provider-native credits/units remaining when there is no USD figure. */
  credits?: number;
  /** Request/credit quota where the provider reports a limit. */
  quota?: { limit?: number; remaining?: number; period?: string; resetAt?: string };
  /** Short human label for the figure, e.g. "wallet balance" or "monthly calls". */
  label?: string;
}

export interface ProbeResult {
  provider: string;
  label: string;
  status: SentinelStatus;
  reason?: SentinelReason;
  /** Human-readable detail: status code + short provider message. Never a key. */
  detail: string;
  latencyMs: number | null;
  httpStatus?: number;
  costly: boolean;
  optional: boolean;
  balance?: SentinelBalance;
  lowCredit: boolean;
  checkedAt: string;
}

/** Row shape of public.provider_status (the current row per provider). */
export interface ProviderStatusRow {
  provider: string;
  label: string;
  status: SentinelStatus;
  reason: SentinelReason | null;
  detail: string;
  latency_ms: number | null;
  http_status: number | null;
  costly: boolean;
  optional: boolean;
  low_credit: boolean;
  balance: SentinelBalance | null;
  checked_at: string;
  last_ok_at: string | null;
  last_change_at: string | null;
}

export type AlertKind = "down" | "degraded" | "recovered" | "low_credit";

export interface SentinelAlert {
  provider: string;
  label: string;
  kind: AlertKind;
  status: SentinelStatus;
  reason?: SentinelReason;
  detail: string;
  advice: string;
}

/** Row shape of public.provider_alerts used for the 6h de-duplication window. */
export interface SentAlertRow {
  provider: string;
  kind: AlertKind;
  sent_at: string;
}
