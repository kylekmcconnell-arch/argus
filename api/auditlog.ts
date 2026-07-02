// Shared "Recent audits" log — the community feed so Kyle + Enigma see each
// other's scans. Same env-gated pattern as api/graph.ts: backend configured →
// shared; not configured → available:false and the client stays local-only.
// Unlike graph_contributions (latest-wins upsert), this is APPEND-ONLY history —
// a re-audit is a new row.
//   GET  /api/auditlog        -> { available, entries: LogEntry[] } (newest 200)
//   POST /api/auditlog  body=LogEntry+contributor -> { ok } (idempotent by client_id)
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const TABLE = "audit_log";

function creds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function headers(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const c = creds();
  if (!c) { res.status(200).json({ available: false, entries: [], note: "Shared audit log not configured." }); return; }

  try {
    if (req.method === "GET") {
      const r = await fetch(
        `${c.url}/rest/v1/${TABLE}?select=client_id,ts,kind,query,ref,image,verdict,score,summary,coverage,flags,contributor&order=ts.desc&limit=200`,
        { headers: headers(c.key), signal: AbortSignal.timeout(10000) },
      );
      if (!r.ok) { res.status(200).json({ available: true, entries: [], error: `read ${r.status}` }); return; }
      const rows = (await r.json()) as any[];
      const entries = (Array.isArray(rows) ? rows : []).map((x) => ({
        id: x.client_id,
        ts: Date.parse(x.ts) || 0,
        kind: x.kind,
        query: x.query,
        ref: x.ref ?? undefined,
        image: x.image ?? undefined,
        verdict: x.verdict ?? undefined,
        score: x.score ?? undefined,
        summary: x.summary ?? "",
        coverage: x.coverage ?? undefined,
        flags: Array.isArray(x.flags) ? x.flags : [],
        contributor: x.contributor,
      }));
      res.status(200).json({ available: true, entries });
      return;
    }

    if (req.method === "POST") {
      const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
      const kind = str(raw?.kind, 20);
      const query = str(raw?.query, 500);
      const contributor = str(raw?.contributor, 80) || "anonymous";
      if (!kind || !query) { res.status(400).json({ error: "kind and query required" }); return; }
      const id = str(raw?.id, 120) || `${Date.now()}`;
      const tsNum = typeof raw?.ts === "number" ? raw.ts : Date.now();
      // Updates may target a row written by ANOTHER analyst (shared entries carry
      // client_id as their id) — honor a verbatim client_id there so the update
      // hits the existing row instead of minting a duplicate.
      const clientId = raw?.mode === "update" && str(raw?.client_id, 200) ? str(raw.client_id, 200) : `${contributor}:${id}`;
      const row = {
        client_id: clientId,
        ts: new Date(tsNum).toISOString(),
        kind,
        query,
        ref: raw?.ref != null ? str(raw.ref, 300) : null,
        image: raw?.image != null ? str(raw.image, 600) : null,
        verdict: raw?.verdict != null ? str(raw.verdict, 40) : null,
        score: typeof raw?.score === "number" ? raw.score : null,
        summary: str(raw?.summary, 500),
        coverage: raw?.coverage != null ? str(raw.coverage, 40) : null,
        flags: Array.isArray(raw?.flags) ? raw.flags.filter((f: unknown) => typeof f === "string").slice(0, 20) : [],
        contributor,
      };
      // Default stays append-only (history never silently mutates). mode:"update"
      // upsert-merges the row instead — used by re-categorization, which rewrites
      // the role flags on EXISTING entries without rerunning the audits.
      const resolution = raw?.mode === "update" ? "merge-duplicates" : "ignore-duplicates";
      const r = await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=client_id`, {
        method: "POST",
        headers: { ...headers(c.key), prefer: `resolution=${resolution},return=minimal` },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { res.status(200).json({ ok: false, error: `write ${r.status}: ${(await r.text()).slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    res.status(200).json({ available: true, entries: [], error: String(e) });
  }
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
