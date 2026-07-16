// Arkham risk paths — WHY a wallet is risky. GET /api/arkham-risk-paths?address=<addr>
//
// The risk score says "flagged"; this says why: the seed→target trace showing which
// hacker / mixer / sanctioned entity the wallet is exposed to, in which direction,
// how many hops away, and how much USD flowed. Turns "risk" into "$72M, 1 hop from
// Tornado.Cash". Seeds are labeled with their Arkham entity so they read as names,
// not hashes. The trace itself lives in ./_arkham-core (shared with the scan-time
// deployer trace); this route adds auth, panel-cost accounting, and caching.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";
import { fetchAddressRiskPaths } from "./_arkham-core.js";

export const config = { maxDuration: 20 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured." }); return; }
  const addr = (typeof req.query.address === "string" ? req.query.address : "").trim();
  if (!addr || addr.length < 8) { res.status(400).json({ error: "address required" }); return; }

  const ck = `arkham-paths:${providerAddressKey(addr)}:v1`;
  const cached = await cacheGetJson<{ available: boolean; paths: unknown[] }>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const result = await fetchAddressRiskPaths(addr, key);
  try {
    if (!result.available) {
      res.status(200).json({ available: false, note: "Risk paths lookup failed." });
      return;
    }
    const out = { available: true, paths: result.paths };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } finally {
    if (result.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "arkham",
        op: "panel:arkham-risk-paths",
        calls: result.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: result.succeeded === result.calls ? "succeeded" : result.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
