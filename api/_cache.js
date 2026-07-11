// Shared helpers for the api/ functions (NOT an exposed route — underscore files
// are importable siblings only). Two jobs:
//   1. 24h JSON cache in the existing `reports` table (kind='grokcache') so the
//      expensive browser panels (namesake, VC portfolio) don't re-buy the same
//      Grok search on every report open.
//   2. attachPanelCost: write post-report panel spend to the mutable cost ledger
//      linked to the immutable version. Evidence payloads are never rewritten.
// api/ functions cannot import server/ modules at runtime (bundling), hence the
// small duplication with server/cache.ts.
import { createHash } from "node:crypto";

const KIND = "grokcache";
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
const hash = (s) => "g:" + createHash("sha256").update(s).digest("hex").slice(0, 40);
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const normRef = (s) => {
  const clean = s.trim().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
  if (SOLANA_ADDRESS.test(clean)) return clean;
  if (EVM_ADDRESS.test(clean)) return clean.toLowerCase();
  return clean.toLowerCase();
};

export async function cacheGetJson(key) {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=payload&ref=eq.${encodeURIComponent(hash(key))}&kind=eq.${KIND}&limit=1`, {
      headers: headers(c.key), signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const p = rows?.[0]?.payload;
    if (p?.value == null || typeof p.at !== "number" || Date.now() - p.at > TTL_MS) return null;
    return p.value;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key, value) {
  const c = creds();
  if (!c || value == null) return;
  try {
    await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ref: hash(key), kind: KIND, query: key.slice(0, 180), payload: { value, at: Date.now() }, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* best-effort */ }
}



// Record a panel's spend against the subject's current immutable version.
// REPLACE semantics per provider+op prevent a re-opened panel from inflating
// totals, while organization scoping prevents cross-workspace attribution.
export async function attachPanelCost(organizationId, rawRef, line, requestedKind) {
  const c = creds();
  if (!c || !organizationId || !rawRef || !line?.provider || !line?.op) return;
  try {
    const ref = normRef(rawRef);
    const kindFilter = requestedKind ? `&kind=eq.${encodeURIComponent(requestedKind)}` : "";
    const r = await fetch(
      `${c.url}/rest/v1/reports?select=report_version_id&organization_id=eq.${encodeURIComponent(organizationId)}&ref=eq.${encodeURIComponent(ref)}&kind=in.%28person%2Ctoken%2Cinvestigation%2Csite%29${kindFilter}&report_version_id=not.is.null&order=ts.desc&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) return;
    const rows = await r.json();
    const reportVersionId = rows?.[0]?.report_version_id;
    if (typeof reportVersionId !== "string") return;
    const calls = Number.isFinite(line.calls) ? Math.max(0, Math.floor(line.calls)) : 0;
    const usd = Number.isFinite(line.usd) ? Math.max(0, Math.round(line.usd * 10000) / 10000) : 0;
    await fetch(`${c.url}/rest/v1/rpc/upsert_report_cost_line`, {
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
