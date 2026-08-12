// The alerts feed (rows written by manual sweeps).
//   GET    /api/alerts            -> { alerts: [{ref, subject, label, type, detail, at}] }
//   DELETE /api/alerts?ref=<ref>  -> dismiss one alert
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
} from "./_auth.js";

export const config = { maxDuration: 10 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "DELETE") {
    res.status(405).setHeader("Allow", "GET, DELETE").json({ error: "method_not_allowed" });
    return;
  }

  const auth = await requireArgusAuth(req, res, req.method === "GET" ? "viewer" : "analyst");
  if (!auth) return;

  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ available: false, alerts: [], error: "storage_not_configured" });
    return;
  }

  res.setHeader("Cache-Control", "private, no-store");
  const organizationFilter = `organization_id=eq.${encodeURIComponent(auth.organizationId)}`;
  try {
    if (req.method === "GET") {
      const r = await fetch(`${credentials.url}/rest/v1/reports?select=ref,payload,ts&${organizationFilter}&kind=eq.alert&order=ts.desc&limit=100`, {
        headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        res.status(502).json({ available: true, alerts: [], error: "alert_read_failed" });
        return;
      }
      const rows = (await r.json()) as { ref: string; payload?: Record<string, unknown>; ts?: string }[];
      res.status(200).json({ available: true, alerts: rows.map((x) => ({ ref: x.ref, ts: x.ts, ...(x.payload ?? {}) })) });
      return;
    }

    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    if (!ref.startsWith("al:")) {
      res.status(400).json({ error: "alert_ref_required" });
      return;
    }
    const r = await fetch(`${credentials.url}/rest/v1/reports?${organizationFilter}&ref=eq.${encodeURIComponent(ref)}&kind=eq.alert`, {
      method: "DELETE",
      headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: "alert_delete_failed" });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[alerts] storage request failed", error);
    res.status(503).json({ available: true, alerts: [], error: "alerts_unavailable" });
  }
}
