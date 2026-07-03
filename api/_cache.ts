// Shared helpers for the api/ functions (NOT an exposed route — underscore files
// are importable siblings only). Two jobs:
//   1. 24h JSON cache in the existing `reports` table (kind='grokcache') so the
//      expensive browser panels (namesake, VC portfolio) don't re-buy the same
//      Grok search on every report open.
//   2. attachPanelCost: fold a panel's provider spend back into the subject's
//      STORED report, so the library's per-audit cost chip becomes the full
//      picture (core run + panels), not just the collector.
// api/ functions cannot import server/ modules at runtime (bundling), hence the
// small duplication with server/cache.ts.
import { createHash } from "node:crypto";

const KIND = "grokcache";
const TTL_MS = 24 * 3600 * 1000;

function creds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
const hash = (s: string) => "g:" + createHash("sha256").update(s).digest("hex").slice(0, 40);
const normRef = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?select=payload&ref=eq.${encodeURIComponent(hash(key))}&kind=eq.${KIND}&limit=1`, {
      headers: headers(c.key), signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as { payload?: { value?: T; at?: number } }[];
    const p = rows?.[0]?.payload;
    if (p?.value == null || typeof p.at !== "number" || Date.now() - p.at > TTL_MS) return null;
    return p.value;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown): Promise<void> {
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

export interface PanelCostLine { provider: string; op: string; calls: number; usd: number; meta?: string }

// Merge a panel's spend into the subject's stored report payload.cost. REPLACE
// semantics per op (a re-opened panel overwrites its own line instead of
// inflating the total on every view).
export async function attachPanelCost(rawRef: string, line: PanelCostLine): Promise<void> {
  const c = creds();
  if (!c || !rawRef) return;
  try {
    const ref = normRef(rawRef);
    const r = await fetch(
      `${c.url}/rest/v1/reports?select=ref,kind,query,contributor,payload,verdict,score&ref=eq.${encodeURIComponent(ref)}&kind=neq.${KIND}&order=ts.desc&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) return;
    const rows = (await r.json()) as any[];
    const row = rows?.[0];
    if (!row?.payload) return;
    const cost = row.payload.cost ?? { usd: 0, grokUsd: 0, claudeUsd: 0, grokCalls: 0, claudeCalls: 0, sources: 0, estimated: true, calls: [] };
    const calls: PanelCostLine[] = Array.isArray(cost.calls) ? cost.calls : [];
    const idx = calls.findIndex((l) => l.provider === line.provider && l.op === line.op);
    const clean = { ...line, usd: Math.round(line.usd * 10000) / 10000 };
    if (idx >= 0) calls[idx] = clean; else calls.push(clean);
    cost.calls = calls.sort((a, b) => b.usd - a.usd || b.calls - a.calls);
    cost.usd = Math.round(calls.reduce((a, l) => a + l.usd, 0) * 100) / 100;
    row.payload.cost = cost;
    await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ...row, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* accounting is best-effort */ }
}

// Grok pricing (list rates) for panel endpoints computing their own spend.
export function grokUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined, toolCalls = 0): number {
  const tin = usage?.input_tokens ?? 0;
  const tout = usage?.output_tokens ?? 0;
  return tin * 0.2 / 1e6 + tout * 0.5 / 1e6 + toolCalls * 5 * 0.025;
}
export function claudeUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined): number {
  return (usage?.input_tokens ?? 0) * 3 / 1e6 + (usage?.output_tokens ?? 0) * 15 / 1e6;
}
