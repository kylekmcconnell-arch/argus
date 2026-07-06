// 24h read-through cache for Grok live-search results, stored in the existing
// `reports` table (kind='grokcache', ref=<hashed key>) so it needs no new SQL.
// A subject's team/affiliations/acknowledgments don't change hour-to-hour, but a
// rescan re-bought every search — this makes same-day rescans nearly free.
// No-op when Supabase isn't configured (local dev): calls fall through live.
import { createHash } from "node:crypto";
import { env } from "./config";
import { recordCall } from "./cost";

const TTL_MS = 24 * 3600 * 1000;
const KIND = "grokcache";

function creds(): { url: string; key: string } | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
const hash = (s: string) => "g:" + createHash("sha256").update(s).digest("hex").slice(0, 40);

export async function cacheGet(key: string): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(
      `${c.url}/rest/v1/reports?select=payload&ref=eq.${encodeURIComponent(hash(key))}&kind=eq.${KIND}&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(4000) },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as { payload?: { text?: string; at?: number } }[];
    const p = rows?.[0]?.payload;
    if (!p?.text || typeof p.at !== "number" || Date.now() - p.at > TTL_MS) return null;
    recordCall("cache", "grok-hit", 0, "24h search cache");
    return p.text;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, text: string): Promise<void> {
  const c = creds();
  if (!c || !text) return;
  try {
    await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ref: hash(key), kind: KIND, query: key.slice(0, 180), payload: { text, at: Date.now() }, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* cache write is best-effort */
  }
}
