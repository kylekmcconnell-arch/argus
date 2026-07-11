// Arkham entity labels. GET /api/arkham?addresses=a,b,c   (or ?address=a)
//
// The single biggest upgrade to the on-chain forensics: it puts a NAME on the
// anonymous wallets. Arkham resolves an address to its real-world entity —
// "Binance" (cex), "Wintermute" (fund), or a named individual like "Vitalik
// Buterin" WITH their Twitter/LinkedIn — across EVM and Solana. So a deployer,
// funder, top holder, or cluster wallet that read as "0x1a2b…" now reads as who
// it actually is. Batched + per-address cached (addresses recur across reports).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";

export const config = { maxDuration: 20 };

const ARKHAM_INTEL = "https://api.arkm.com/intelligence/address/";
const ARKHAM_RISK = "https://api.arkm.com/risk/address/";

export type ArkhamRisk = {
  level: string;        // NONE | LOW | MEDIUM | HIGH | SEVERE
  category?: string;    // hacker | privacy | sanctioned | …
  score: number;        // 0-100
  incomingUsd?: number; // $ received, risk-weighted (exposure to bad sources)
  isSeed: boolean;      // this address IS a flagged bad actor (hacker/mixer/sanctioned)
};

export type ArkhamLabel = {
  name: string;
  type?: string;      // cex | individual | fund | defi | dex | …
  sublabel?: string;  // e.g. "Cold Wallet", "Hot Wallet 3"
  twitter?: string;
  website?: string;
  isCex: boolean;
  isContract: boolean;
  risk?: ArkhamRisk;  // present only when the wallet carries real risk (level != NONE or a seed)
};

interface CallCounter { calls: number; succeeded: number }
const getJson = async (url: string, key: string, usage: CallCounter) => {
  usage.calls += 1;
  try {
    const r = await fetch(url, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const data = await r.json();
    usage.succeeded += 1;
    return data;
  } catch {
    return null;
  }
};

async function lookup(addr: string, key: string, usage: CallCounter): Promise<ArkhamLabel | null> {
  const ck = `arkham:${providerAddressKey(addr)}:v2`;
  const cached = await cacheGetJson<ArkhamLabel | { none: true }>(ck);
  if (cached) return (cached as { none?: true }).none ? null : (cached as ArkhamLabel);
  try {
    // Entity label + risk score in parallel (api.arkhamintelligence.com 307s to arkm).
    const [d, rk] = await Promise.all([
      getJson(`${ARKHAM_INTEL}${encodeURIComponent(addr)}`, key, usage) as Promise<{ arkhamEntity?: { name?: string; type?: string; twitter?: string; website?: string } | null; arkhamLabel?: { name?: string } | null; contract?: boolean } | null>,
      getJson(`${ARKHAM_RISK}${encodeURIComponent(addr)}`, key, usage) as Promise<{ risk_level?: string; greatest_risk_category?: string; max_score?: number; risk_weighted_incoming_usd?: number; is_seed?: boolean } | null>,
    ]);
    const e = d?.arkhamEntity, lbl = d?.arkhamLabel;
    const name = e?.name || lbl?.name || "";
    // Only keep risk that actually matters — an elevated level or a flagged seed.
    const risk: ArkhamRisk | undefined = rk && ((rk.risk_level && rk.risk_level !== "NONE") || rk.is_seed)
      ? { level: String(rk.risk_level ?? "NONE"), category: rk.greatest_risk_category || undefined, score: Number(rk.max_score ?? 0), incomingUsd: rk.risk_weighted_incoming_usd ? Number(rk.risk_weighted_incoming_usd) : undefined, isSeed: !!rk.is_seed }
      : undefined;
    if (!name && !risk) { await cacheSetJson(ck, { none: true }); return null; }
    const out: ArkhamLabel = {
      name,
      type: e?.type,
      sublabel: lbl?.name && e?.name && lbl.name.toLowerCase() !== e.name.toLowerCase() ? lbl.name : undefined,
      twitter: typeof e?.twitter === "string" && e.twitter ? e.twitter : undefined,
      website: typeof e?.website === "string" && e.website ? e.website : undefined,
      isCex: e?.type === "cex",
      isContract: !!d?.contract,
      risk,
    };
    await cacheSetJson(ck, out);
    return out;
  } catch { return null; }
}

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
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured (no ARKHAM_API_KEY)." }); return; }
  const raw = typeof req.query.addresses === "string" ? req.query.addresses : typeof req.query.address === "string" ? req.query.address : "";
  const addrs = [...new Set(raw.split(",").map(providerAddressKey).filter(Boolean))].slice(0, 30);
  if (!addrs.length) { res.status(400).json({ error: "addresses required" }); return; }
  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const results = await Promise.all(addrs.map((a) => lookup(a, key, usage).then((l) => [providerAddressKey(a), l] as const)));
    const labels: Record<string, ArkhamLabel> = {};
    for (const [a, l] of results) if (l && (l.name || l.risk)) labels[a] = l;
    res.status(200).json({ available: true, labels });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Arkham lookup failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "arkham",
        op: "panel:arkham-labels",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
