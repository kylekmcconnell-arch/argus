// Pure classification helpers for the provider sentinel. No I/O: every probe
// hands its HTTP outcome here so the status/reason vocabulary stays uniform
// across providers and can be unit-tested without a network.
import type { SentinelBalance, SentinelReason, SentinelStatus } from "./types.js";

export interface Classification {
  status: SentinelStatus;
  reason?: SentinelReason;
}

// Same idea as the request-local Grok circuit on the provider-access branch:
// read only a bounded slice of the body and map it to a controlled category.
const BILLING_RE = /credit|billing|payment|spending.?limit|insufficient.?(?:balance|funds|quota)|quota.?exceeded|out of (?:credits|units)|no.?plan|exhausted|top.?up/i;
const RATE_RE = /rate.?limit|too many requests|max calls per sec/i;
const AUTH_RE = /invalid.?api.?key|invalid.?key|unauthori[sz]ed|forbidden|api.?key.*(?:disabled|revoked|blocked|expired)|authentication/i;

/** Map an HTTP status (plus a bounded body snippet) to status + reason. */
export function classifyHttp(httpStatus: number, bodySnippet = ""): Classification {
  if (httpStatus >= 200 && httpStatus < 300) return { status: "ok" };
  if (httpStatus === 402) return { status: "down", reason: "out_of_credits" };
  if (httpStatus === 429) {
    // Some providers answer an exhausted monthly quota with 429.
    if (BILLING_RE.test(bodySnippet) && !RATE_RE.test(bodySnippet)) return { status: "down", reason: "out_of_credits" };
    return { status: "degraded", reason: "rate_limited" };
  }
  if (httpStatus === 401) return { status: "down", reason: "auth_invalid" };
  if (httpStatus === 403) {
    if (BILLING_RE.test(bodySnippet)) return { status: "down", reason: "out_of_credits" };
    return { status: "down", reason: "auth_invalid" };
  }
  if (httpStatus >= 500) return { status: "degraded", reason: "provider_error_5xx" };
  if (BILLING_RE.test(bodySnippet)) return { status: "down", reason: "out_of_credits" };
  if (AUTH_RE.test(bodySnippet)) return { status: "down", reason: "auth_invalid" };
  return { status: "degraded", reason: "unexpected_response" };
}

/** Map a thrown fetch error (abort/timeout/DNS) to status + reason. */
export function classifyError(error: unknown): Classification {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out|aborted/i.test(message)) {
    return { status: "down", reason: "timeout" };
  }
  return { status: "down", reason: "unexpected_response" };
}

/** Classify a 200 response whose body itself reports an error (Etherscan, GMGN, xAI key flags). */
export function classifyBodyError(bodySnippet: string): Classification {
  if (RATE_RE.test(bodySnippet)) return { status: "degraded", reason: "rate_limited" };
  if (BILLING_RE.test(bodySnippet)) return { status: "down", reason: "out_of_credits" };
  if (AUTH_RE.test(bodySnippet)) return { status: "down", reason: "auth_invalid" };
  return { status: "degraded", reason: "unexpected_response" };
}

/**
 * Reduce provider text to a short, single-line, credential-free message.
 * Strips anything that looks like a token or key before truncating.
 */
export function sanitizeMessage(text: string, secrets: readonly string[] = [], max = 140): string {
  let clean = text.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    if (secret && secret.length >= 6) clean = clean.split(secret).join("[redacted]");
  }
  clean = clean
    .replace(/(api[-_]?key|apikey|token|bearer|secret|key)(["'=:\s]+)[A-Za-z0-9._-]{12,}/gi, "$1$2[redacted]")
    .replace(/\b(?:sk-|sk_|pk_|xai-|sb_secret_|re_|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Pull a provider message out of a JSON or text error body. */
export function providerMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const visit = (value: unknown, depth: number): string => {
      if (depth > 3 || value == null) return "";
      if (typeof value === "string") return value;
      if (typeof value !== "object") return "";
      const record = value as Record<string, unknown>;
      for (const key of ["message", "error_description", "detail", "error", "msg", "result", "title"]) {
        const found = visit(record[key], depth + 1);
        if (found) return found;
      }
      return "";
    };
    return visit(parsed, 0) || "";
  } catch {
    return trimmed.startsWith("<") ? "" : trimmed;
  }
}

export interface Thresholds {
  lowUsd: number;
  lowQuotaPct: number;
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = value == null || value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function thresholdsFromEnv(env: Record<string, string | undefined> = process.env): Thresholds {
  return {
    lowUsd: envNumber(env.SENTINEL_LOW_USD, 20),
    lowQuotaPct: envNumber(env.SENTINEL_LOW_QUOTA_PCT, 10),
  };
}

/** True when a reported balance/quota is under the configured floor. */
export function isLowCredit(balance: SentinelBalance | undefined, thresholds: Thresholds): boolean {
  if (!balance) return false;
  if (typeof balance.usd === "number" && balance.usd < thresholds.lowUsd) return true;
  const quota = balance.quota;
  if (quota && typeof quota.limit === "number" && quota.limit > 0 && typeof quota.remaining === "number") {
    return (quota.remaining / quota.limit) * 100 < thresholds.lowQuotaPct;
  }
  return false;
}
