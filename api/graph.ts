// Shared trust graph — the community-wide persistent store behind src/graph.
//   GET  /api/graph        -> { available, contributions: GraphContribution[] }
//   POST /api/graph  body=GraphContribution  -> { ok } (upsert, latest-wins per subject)
//
// Talks to Supabase over PostgREST with the SERVICE ROLE key (server-side only),
// so no client dependency and no exposed credentials. Gated on SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY — with those unset it returns available:false and the
// client silently stays local-only (nothing breaks). See supabase/schema.sql.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const TABLE = "graph_contributions";
const READ_LIMIT = 500; // most-recent subjects returned to the client
const MAX_NODES = 4000; // per-contribution sanity caps (abuse / runaway payloads)
const MAX_EDGES = 4000;
const MAX_BODY = 1_500_000; // ~1.5MB

function creds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function headers(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}
// Mirror of src/graph/network.ts canonical(): collapse @x / $X / "X" to one id.
const ALIAS: Record<string, string> = { zenith: "zenithdao", $zenith: "zenithdao" };
function canonical(raw: string): string {
  const k = String(raw).trim().toLowerCase().replace(/^[@$]/, "").replace(/\s+/g, "");
  return ALIAS[k] ?? k;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const c = creds();
  if (!c) { res.status(200).json({ available: false, contributions: [], note: "Shared graph not configured (no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." }); return; }

  try {
    if (req.method === "GET") {
      const r = await fetch(
        `${c.url}/rest/v1/${TABLE}?select=handle,verdict,nodes,edges&order=updated_at.desc&limit=${READ_LIMIT}`,
        { headers: headers(c.key), signal: AbortSignal.timeout(10000) },
      );
      if (!r.ok) { res.status(200).json({ available: true, contributions: [], error: `read ${r.status}` }); return; }
      const rows = (await r.json()) as any[];
      const contributions = (Array.isArray(rows) ? rows : []).map((x) => ({
        handle: x.handle, verdict: x.verdict ?? undefined, nodes: x.nodes ?? [], edges: x.edges ?? [],
      }));
      res.status(200).json({ available: true, contributions });
      return;
    }

    if (req.method === "POST") {
      const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
      if (raw && JSON.stringify(raw).length > MAX_BODY) { res.status(413).json({ error: "contribution too large" }); return; }
      const handle = typeof raw?.handle === "string" ? raw.handle.trim().slice(0, 200) : "";
      const nodes = Array.isArray(raw?.nodes) ? raw.nodes.slice(0, MAX_NODES) : [];
      const edges = Array.isArray(raw?.edges) ? raw.edges.slice(0, MAX_EDGES) : [];
      if (!handle || !nodes.length) { res.status(400).json({ error: "handle and nodes required" }); return; }
      const row = {
        canonical_key: canonical(handle),
        handle,
        verdict: typeof raw?.verdict === "string" ? raw.verdict : null,
        nodes,
        edges,
        contributor: typeof raw?.contributor === "string" ? raw.contributor.slice(0, 80) : null,
      };
      const r = await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=canonical_key`, {
        method: "POST",
        headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { res.status(200).json({ ok: false, error: `write ${r.status}: ${(await r.text()).slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    res.status(200).json({ available: true, contributions: [], error: String(e) });
  }
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
