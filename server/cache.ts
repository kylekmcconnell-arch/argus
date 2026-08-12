// 24h read-through cache for public provider results. Cache entries live in a
// service-only table, never in tenant report projections.
// A subject's team/affiliations/acknowledgments don't change hour-to-hour, but a
// rescan re-bought every search — this makes same-day rescans nearly free.
// No-op when Supabase isn't configured (local dev): calls fall through live.
import { createHash } from "node:crypto";
import { env } from "./config";
import { recordCall } from "./cost";

const TTL_MS = 24 * 3600 * 1000;

function creds(): { url: string; key: string } | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({
  apikey: key,
  ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}),
  "content-type": "application/json",
});
const hash = (s: string) => "gt:" + createHash("sha256").update(s).digest("hex").slice(0, 40);

export async function cacheGet(
  key: string,
  usage: { operation?: string; meta?: string } = {},
): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(
      `${c.url}/rest/v1/provider_cache?select=payload,expires_at&cache_key=eq.${encodeURIComponent(hash(key))}&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(4000) },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as { payload?: { text?: string }; expires_at?: string }[];
    const p = rows?.[0]?.payload;
    const expiresAt = rows?.[0]?.expires_at ? Date.parse(rows[0].expires_at) : Number.NaN;
    if (!p?.text || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    recordCall("cache", usage.operation ?? "grok-hit", 0, usage.meta ?? "24h search cache", "cached");
    return p.text;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, text: string): Promise<void> {
  const c = creds();
  if (!c || !text) return;
  try {
    const now = Date.now();
    await fetch(`${c.url}/rest/v1/provider_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        cache_key: hash(key),
        payload: { text },
        expires_at: new Date(now + TTL_MS).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* cache write is best-effort */
  }
}
