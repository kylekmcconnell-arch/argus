// Shared helpers for the api/ functions (NOT an exposed route — underscore files
// are importable siblings only). Two jobs:
//   1. 24h JSON cache in a service-only provider_cache table so cached provider
//      responses are never mixed with tenant report projections.
//   2. append exact-version provider usage events; the database maintains the
//      backwards-compatible mutable cost projection. Evidence is never rewritten.
// api/ functions cannot import server/ modules at runtime (bundling), hence the
// small duplication with server/cache.ts.
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TTL_MS = 24 * 3600 * 1000;
const PANEL_COST_TOKEN_TTL_MS = 30 * 60 * 1000;

function creds() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key) => ({
  apikey: key,
  ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}),
  "content-type": "application/json",
});
// API cache values use a distinct namespace from the server text cache. The
// payload envelopes differ, so sharing a raw hash could turn a valid hit into a
// silent miss when two callers happen to use the same logical key.
const hash = (s) => "gj:" + createHash("sha256").update(s).digest("hex").slice(0, 40);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function panelCostTokenSecret() {
  return process.env.PANEL_COST_TOKEN_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || null;
}

// Browser-triggered supplemental panels must never be allowed to nominate an
// arbitrary historical version for cost attribution. The report route issues
// this short-lived capability only after it has authenticated the tenant and
// persisted the exact version; panel routes bind it back to the authenticated
// tenant before writing a cost line.
export function issuePanelCostToken(organizationId, reportVersionId) {
  const secret = panelCostTokenSecret();
  if (!secret || !UUID.test(organizationId || "") || !UUID.test(reportVersionId || "")) return undefined;

  const payload = Buffer.from(JSON.stringify({
    v: 1,
    org: organizationId.toLowerCase(),
    report: reportVersionId.toLowerCase(),
    exp: Math.floor((Date.now() + PANEL_COST_TOKEN_TTL_MS) / 1000),
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function resolvePanelCostVersion(organizationId, token) {
  const secret = panelCostTokenSecret();
  if (!secret || !UUID.test(organizationId || "") || typeof token !== "string" || token.length > 2048) return undefined;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return undefined;

  try {
    const expected = createHmac("sha256", secret).update(parts[0]).digest();
    const provided = Buffer.from(parts[1], "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;

    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload?.v !== 1
      || !UUID.test(payload.org || "")
      || !UUID.test(payload.report || "")
      || payload.org.toLowerCase() !== organizationId.toLowerCase()
      || !Number.isSafeInteger(payload.exp)
      || payload.exp <= Math.floor(Date.now() / 1000)) return undefined;
    return payload.report.toLowerCase();
  } catch {
    return undefined;
  }
}

export async function cacheGetJson(key) {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/provider_cache?select=payload,expires_at&cache_key=eq.${encodeURIComponent(hash(key))}&limit=1`, {
      headers: headers(c.key), signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const p = rows?.[0]?.payload;
    const expiresAt = rows?.[0]?.expires_at ? Date.parse(rows[0].expires_at) : Number.NaN;
    if (p?.value == null || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return p.value;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key, value) {
  const c = creds();
  if (!c || value == null) return;
  try {
    const now = Date.now();
    await fetch(`${c.url}/rest/v1/provider_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        cache_key: hash(key),
        payload: { value },
        expires_at: new Date(now + TTL_MS).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* best-effort */ }
}



// Append one idempotent provider call to the exact immutable version and let
// the database update the legacy report_cost_lines aggregate in the same
// transaction. A display ref is never sufficient: a newer version may publish
// while a panel request is in flight.
export async function recordProviderUsageEvent(organizationId, reportVersionId, line) {
  const c = creds();
  if (!c || !UUID.test(organizationId || "") || !UUID.test(reportVersionId || "") || !line?.provider || !line?.op) return;

  const initiatedBy = line.initiatedBy == null ? null : String(line.initiatedBy).toLowerCase();
  if (initiatedBy != null && !UUID.test(initiatedBy)) return;

  const allowedStatuses = new Set(["succeeded", "failed", "partial", "cached"]);
  const status = line.status == null ? "succeeded" : String(line.status);
  if (!allowedStatuses.has(status)) return;

  const suppliedKey = line.idempotencyKey == null ? null : String(line.idempotencyKey).trim();
  if (suppliedKey != null && (suppliedKey.length < 1 || suppliedKey.length > 200)) return;

  const calls = Number.isFinite(line.calls) ? Math.max(0, Math.floor(line.calls)) : 0;
  // Keep micro-cost estimates visible. Several keyed APIs cost far less than a
  // cent per call, so four-decimal rounding incorrectly turned real spend into
  // a zero-price event.
  const usd = Number.isFinite(line.usd) ? Math.max(0, Math.round(line.usd * 100000000) / 100000000) : 0;
  const body = JSON.stringify({
    p_organization_id: organizationId.toLowerCase(),
    p_report_version_id: reportVersionId.toLowerCase(),
    p_idempotency_key: suppliedKey || `api:${randomUUID()}`,
    p_provider: String(line.provider).slice(0, 100),
    p_operation: String(line.op).slice(0, 160),
    p_calls: calls,
    p_usd: usd,
    p_initiated_by: initiatedBy,
    p_status: status,
    p_meta: typeof line.meta === "string" ? line.meta.slice(0, 500) : null,
  });

  // A response can be lost after the database commits. Reusing the same body
  // for one transport retry lets the RPC's idempotency constraint return the
  // original event instead of double counting it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${c.url}/rest/v1/rpc/record_provider_usage_event`, {
        method: "POST",
        headers: headers(c.key),
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 1) {
        console.error("[cost] provider usage event attribution failed", response.status);
        return;
      }
    } catch {
      if (attempt === 1) {
        console.error("[cost] provider usage event attribution failed", "transport");
      }
    }
  }
}

// Persist the server-owned provider ledger for a completed core audit in one
// database transaction. Unlike supplemental panel accounting, this is a
// publication invariant: callers must fail the report activation when the
// batch cannot be durably attributed to its exact immutable version.
export async function recordProviderUsageBatch(organizationId, reportVersionId, initiatedBy, lines) {
  if (!UUID.test(organizationId || "") || !UUID.test(reportVersionId || "") || !UUID.test(initiatedBy || "")) {
    throw new Error("valid provider usage batch context required");
  }
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200) {
    throw new Error("valid provider usage batch required");
  }

  const allowedStatuses = new Set(["succeeded", "failed", "partial", "cached"]);
  const seen = new Set();
  const normalized = lines.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("invalid provider usage batch line");
    }
    const provider = typeof candidate.provider === "string" ? candidate.provider.trim() : "";
    const operation = typeof candidate.op === "string" ? candidate.op.trim() : "";
    const calls = candidate.calls;
    const usd = candidate.usd;
    const status = candidate.status == null ? "succeeded" : String(candidate.status);
    const meta = candidate.meta == null ? null : String(candidate.meta).trim() || null;
    if (!provider || provider.length > 100
      || !operation || operation.length > 160
      || !Number.isSafeInteger(calls) || calls < 0 || calls > 2147483647
      || !Number.isFinite(usd) || usd < 0
      || !allowedStatuses.has(status)
      || (meta != null && meta.length > 500)) {
      throw new Error("invalid provider usage batch line");
    }
    const identity = `${provider}\u0000${operation}`;
    if (seen.has(identity)) throw new Error("duplicate provider usage batch line");
    seen.add(identity);
    const digest = createHash("sha256").update(identity).digest("hex").slice(0, 40);
    return {
      idempotency_key: `core:${reportVersionId.toLowerCase()}:${digest}`,
      provider,
      operation,
      calls,
      usd: Math.round(usd * 100000000) / 100000000,
      status,
      meta,
    };
  });
  const c = creds();
  if (!c) throw new Error("provider usage storage is unavailable");
  const body = JSON.stringify({
    p_organization_id: organizationId.toLowerCase(),
    p_report_version_id: reportVersionId.toLowerCase(),
    p_initiated_by: initiatedBy.toLowerCase(),
    p_lines: normalized,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${c.url}/rest/v1/rpc/record_provider_usage_batch`, {
        method: "POST",
        headers: headers(c.key),
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) return;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 1) {
        throw new Error(`provider usage batch attribution failed (${response.status})`);
      }
    } catch (error) {
      if (attempt === 1 || (error instanceof Error && /\([1-4][0-9]{2}\)$/.test(error.message))) {
        throw error instanceof Error ? error : new Error("provider usage batch attribution failed");
      }
    }
  }
}

// Compatibility name used throughout the provider routes. Each invocation is
// now one append-only event; callers may supply idempotencyKey for a replayable
// request, otherwise recordProviderUsageEvent generates a fresh request key.
export async function attachPanelCost(organizationId, reportVersionId, line) {
  return recordProviderUsageEvent(organizationId, reportVersionId, line);
}

// Grok pricing (list rates) for panel endpoints computing their own spend.
export function grokUsd(usage, toolCalls = 0) {
  const tin = usage?.input_tokens ?? 0;
  const tout = usage?.output_tokens ?? 0;
  return tin * 0.2 / 1e6 + tout * 0.5 / 1e6 + toolCalls * 5 * 0.025;
}
export function claudeUsd(usage) {
  return (usage?.input_tokens ?? 0) * 3 / 1e6 + (usage?.output_tokens ?? 0) * 15 / 1e6;
}
