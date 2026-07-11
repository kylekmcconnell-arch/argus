// Shared helpers for the api/ functions (NOT an exposed route — underscore files
// are importable siblings only). Two jobs:
//   1. 24h JSON cache in a service-only provider_cache table so cached provider
//      responses are never mixed with tenant report projections.
//   2. attachPanelCost: write post-report panel spend to the mutable cost ledger
//      linked to the immutable version. Evidence payloads are never rewritten.
// api/ functions cannot import server/ modules at runtime (bundling), hence the
// small duplication with server/cache.ts.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
