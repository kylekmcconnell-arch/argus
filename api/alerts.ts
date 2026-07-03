// The alerts feed (rows written by manual sweeps).
//   GET    /api/alerts            -> { alerts: [{ref, subject, label, type, detail, at}] }
//   DELETE /api/alerts?ref=<ref>  -> dismiss one alert
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 10 };

function creds(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const c = creds();
  if (!c) { res.status(200).json({ available: false, alerts: [] }); return; }
  try {
    if (req.method === "GET") {
      const r = await fetch(`${c.url}/rest/v1/reports?select=ref,payload,ts&kind=eq.alert&order=ts.desc&limit=100`, {
        headers: headers(c.key), signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) { res.status(200).json({ available: true, alerts: [], error: `read ${r.status}` }); return; }
      const rows = (await r.json()) as { ref: string; payload?: Record<string, unknown>; ts?: string }[];
      res.status(200).json({ available: true, alerts: rows.map((x) => ({ ref: x.ref, ts: x.ts, ...(x.payload ?? {}) })) });
      return;
    }
    if (req.method === "DELETE") {
      const ref = typeof req.query.ref === "string" ? req.query.ref : "";
      if (!ref.startsWith("al:")) { res.status(400).json({ error: "alert ref required" }); return; }
      const r = await fetch(`${c.url}/rest/v1/reports?ref=eq.${encodeURIComponent(ref)}&kind=eq.alert`, {
        method: "DELETE", headers: { ...headers(c.key), prefer: "return=minimal" }, signal: AbortSignal.timeout(8000),
      });
      res.status(200).json({ ok: r.ok });
      return;
    }
    res.status(405).json({ error: "GET or DELETE" });
  } catch (e) {
    res.status(200).json({ available: true, alerts: [], error: String(e) });
  }
}
