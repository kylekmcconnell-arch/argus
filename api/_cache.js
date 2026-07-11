// Shared helpers for the api/ functions (NOT an exposed route — underscore files
// are importable siblings only). Two jobs:
//   1. 24h JSON cache in a service-only provider_cache table so cached provider
//      responses are never mixed with tenant report projections.
//   2. attachPanelCost: write post-report panel spend to the mutable cost ledger
//      linked to the immutable version. Evidence payloads are never rewritten.
// api/ functions cannot import server/ modules at runtime (bundling), hence the
// small duplication with server/cache.ts.
import { createHash } from "node:crypto";

const TTL_MS = 24 * 3600 * 1000;

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



// Record a panel's spend against one exact immutable version. A display ref is
// not sufficient: token + investigation cases intentionally share a contract
// ref, and a newer version may publish while a panel request is in flight.
export async function attachPanelCost(organizationId, reportVersionId, line) {
  const c = creds();
  if (!c || !organizationId || !UUID.test(reportVersionId || "") || !line?.provider || !line?.op) return;
  try {
    const calls = Number.isFinite(line.calls) ? Math.max(0, Math.floor(line.calls)) : 0;
    const usd = Number.isFinite(line.usd) ? Math.max(0, Math.round(line.usd * 10000) / 10000) : 0;
    const response = await fetch(`${c.url}/rest/v1/rpc/upsert_report_cost_line`, {
      method: "POST",
      headers: headers(c.key),
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_report_version_id: reportVersionId,
        p_provider: String(line.provider).slice(0, 100),
        p_operation: String(line.op).slice(0, 160),
        p_calls: calls,
        p_usd: usd,
        p_meta: typeof line.meta === "string" ? line.meta.slice(0, 500) : null,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("[cost] exact panel attribution failed", response.status);
    }
  } catch { /* accounting is best-effort */ }
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
