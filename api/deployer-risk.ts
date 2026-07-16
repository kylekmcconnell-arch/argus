// Scan-time Arkham deployer funding/risk trace. GET /api/deployer-risk?address=<addr>
//
// The panel route (api/arkham-risk-paths) requires a persisted-report panel-cost
// token, which a live scan does not yet have. This route runs the same shared
// trace during collection: the token audit calls it on the resolved deployer to
// record who funded it and any mixer / hacker / sanctioned exposure.
//
// Unlike the keyless /api/sanctions screen (viewer-reachable + unmetered), this
// route is deliberately left analyst-metered by middleware: Arkham is a paid
// subscription with finite credits, so the daily API-budget gate is the abuse
// guard against burning them. Budget exhaustion degrades the trace to "not run"
// (never a false clean), which the checklist records as unknown.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";
import { fetchAddressRiskPaths } from "./_arkham-core.js";

export const config = { maxDuration: 20 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const addr = (typeof req.query.address === "string" ? req.query.address : "").trim();
  if (!addr || addr.length < 8) { res.status(400).json({ error: "address required" }); return; }
  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured." }); return; }

  // Share the panel cache: a scan-time trace warms the on-demand panel and vice versa.
  const ck = `arkham-paths:${providerAddressKey(addr)}:v1`;
  const cached = await cacheGetJson<{ available: boolean; paths: unknown[] }>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const result = await fetchAddressRiskPaths(addr, key);
  if (!result.available) { res.status(200).json({ available: false }); return; }
  const out = { available: true, paths: result.paths };
  await cacheSetJson(ck, out);
  res.status(200).json(out);
}
