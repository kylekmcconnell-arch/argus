// Arkham counterparties. GET /api/arkham-counterparties?address=<addr>
//
// Who a wallet actually transacts with — the real on-chain relationships, and
// Arkham hands them back already NAMED. For a token's deployer this answers "whose
// money moves through this operator": named funds, individuals, mixers, and the
// exchanges it cashes out to, each with total USD volume and direction. The named,
// non-exchange counterparties become verified relationship edges in the trust
// graph — ground truth, not inference. Deduped by entity, cached 24h.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";

export const config = { maxDuration: 20 };

const CP = "https://api.arkm.com/counterparties/address/";

export type Counterparty = {
  name: string;
  type?: string;
  address: string;
  twitter?: string;
  usd: number;
  txCount: number;
  flow: "in" | "out" | "both";
  isCex: boolean;
  isContract: boolean;
};

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

  const ck = `arkham-cp:${providerAddressKey(addr)}:v1`;
  const cached = await cacheGetJson<any>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  let providerCalls = 0;
  let providerSucceeded = 0;
  try {
    providerCalls += 1;
    const r = await fetch(`${CP}${encodeURIComponent(addr)}`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) { res.status(200).json({ available: false, note: `Arkham ${r.status}` }); return; }
    const d = (await r.json()) as Record<string, unknown>;
    providerSucceeded += 1;
    // Response is keyed by chain → array of counterparties. Flatten every chain.
    const rows: any[] = [];
    for (const v of Object.values(d)) if (Array.isArray(v)) rows.push(...v);

    // Dedupe by entity (an entity spreads across many wallets); sum volume + tx,
    // and collapse direction to "both" when it flows in and out.
    const byEntity = new Map<string, Counterparty>();
    for (const row of rows) {
      const a = row?.address;
      const e = a?.arkhamEntity;
      const name = e?.name;
      if (!name) continue; // only NAMED counterparties are useful here
      const idKey = String(e?.id || name).toLowerCase();
      const flow: "in" | "out" = row?.flow === "out" ? "out" : "in";
      const ex = byEntity.get(idKey);
      if (ex) {
        ex.usd += Number(row?.usd ?? 0);
        ex.txCount += Number(row?.transactionCount ?? 0);
        if (ex.flow !== flow) ex.flow = "both";
      } else {
        byEntity.set(idKey, {
          name,
          type: e?.type,
          address: a?.address ?? addr,
          twitter: typeof e?.twitter === "string" && e.twitter ? e.twitter : undefined,
          usd: Number(row?.usd ?? 0),
          txCount: Number(row?.transactionCount ?? 0),
          flow,
          isCex: e?.type === "cex",
          isContract: !!a?.contract,
        });
      }
    }
    const counterparties = [...byEntity.values()].sort((a, b) => b.usd - a.usd).slice(0, 14);
    const out = { available: true, counterparties, total: rows.length };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Counterparties lookup failed." });
  } finally {
    if (providerCalls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "arkham",
        op: "panel:arkham-counterparties",
        calls: providerCalls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: providerSucceeded === providerCalls ? "succeeded" : providerSucceeded > 0 ? "partial" : "failed",
      });
    }
  }
}
