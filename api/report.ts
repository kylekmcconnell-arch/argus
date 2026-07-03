// Persistent reports — the full rendered audit payload, stored so a recent audit
// re-opens the actual report (surviving reload) and analysts can pull up each
// other's reports instead of re-running. Same env-gating as api/graph.ts.
//   GET  /api/report?ref=<id>[&kind=]  -> { available, report }  (latest for ref)
//   POST /api/report  body={ref,kind,query,contributor,payload,verdict,score}
//        -> { ok } (upsert latest-wins per ref+kind)
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const TABLE = "reports";
const MAX_BODY = 1_800_000; // ~1.8MB — a big dossier still fits

function creds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function headers(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}
const normRef = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const c = creds();
  if (!c) { res.status(200).json({ available: false }); return; }

  try {
    if (req.method === "GET") {
      // Library listing: every persisted report (all analysts), newest first,
      // WITHOUT payloads (those are heavy — fetched per-ref on open).
      if (req.query.list != null) {
        // cost:payload->cost lifts the per-audit spend out of the stored dossier
        // without shipping the whole heavy payload.
        const r = await fetch(
          `${c.url}/rest/v1/${TABLE}?select=ref,kind,query,contributor,verdict,score,ts,cost:payload->cost&kind=neq.grokcache&order=ts.desc&limit=200`,
          { headers: headers(c.key), signal: AbortSignal.timeout(10000) },
        );
        if (!r.ok) { res.status(200).json({ available: true, reports: [], error: `read ${r.status}` }); return; }
        const rows = (await r.json()) as any[];
        res.status(200).json({ available: true, reports: Array.isArray(rows) ? rows : [] });
        return;
      }
      const ref = normRef(typeof req.query.ref === "string" ? req.query.ref : "");
      if (!ref) { res.status(400).json({ error: "ref required" }); return; }
      const kindF = typeof req.query.kind === "string" ? `&kind=eq.${encodeURIComponent(req.query.kind)}` : "";
      const r = await fetch(
        `${c.url}/rest/v1/${TABLE}?select=ref,kind,query,contributor,payload,verdict,score,ts&ref=eq.${encodeURIComponent(ref)}&kind=neq.grokcache${kindF}&order=ts.desc&limit=1`,
        { headers: headers(c.key), signal: AbortSignal.timeout(10000) },
      );
      if (!r.ok) { res.status(200).json({ available: true, report: null, error: `read ${r.status}` }); return; }
      const rows = (await r.json()) as any[];
      res.status(200).json({ available: true, report: Array.isArray(rows) && rows[0] ? rows[0] : null });
      return;
    }

    if (req.method === "POST") {
      const raw = typeof req.body === "string" ? safeParse(req.body) : req.body;
      if (raw && JSON.stringify(raw).length > MAX_BODY) { res.status(413).json({ error: "report too large" }); return; }
      const ref = normRef(typeof raw?.ref === "string" ? raw.ref : "");
      const kind = typeof raw?.kind === "string" ? raw.kind.slice(0, 20) : "";
      if (!ref || !kind || raw?.payload == null) { res.status(400).json({ error: "ref, kind, payload required" }); return; }
      const row = {
        ref,
        kind,
        query: typeof raw?.query === "string" ? raw.query.slice(0, 200) : ref,
        contributor: typeof raw?.contributor === "string" ? raw.contributor.slice(0, 80) : "anonymous",
        payload: raw.payload,
        verdict: typeof raw?.verdict === "string" ? raw.verdict.slice(0, 40) : null,
        score: typeof raw?.score === "number" ? raw.score : null,
        ts: new Date().toISOString(),
      };
      const r = await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=ref,kind`, {
        method: "POST",
        headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { res.status(200).json({ ok: false, error: `write ${r.status}: ${(await r.text()).slice(0, 200)}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    // Delete the stored report(s) for a subject — used with the audit-log purge
    // so a wrongly-categorized subject can be fully re-done from scratch.
    if (req.method === "DELETE") {
      const ref = normRef(typeof req.query.ref === "string" ? req.query.ref : "");
      if (!ref) { res.status(400).json({ error: "ref required" }); return; }
      const kindF = typeof req.query.kind === "string" && req.query.kind ? `&kind=eq.${encodeURIComponent(req.query.kind)}` : "";
      const r = await fetch(`${c.url}/rest/v1/${TABLE}?ref=eq.${encodeURIComponent(ref)}${kindF}`, {
        method: "DELETE",
        headers: { ...headers(c.key), prefer: "return=minimal" },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { res.status(200).json({ ok: false, error: `delete ${r.status}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "GET, POST or DELETE" });
  } catch (e) {
    res.status(200).json({ available: true, report: null, error: String(e) });
  }
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
