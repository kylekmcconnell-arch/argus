// Arkham entity labels. GET /api/arkham?addresses=a,b,c   (or ?address=a)
//
// The single biggest upgrade to the on-chain forensics: it puts a NAME on the
// anonymous wallets. Arkham resolves an address to its real-world entity —
// "Binance" (cex), "Wintermute" (fund), or a named individual like "Vitalik
// Buterin" WITH their Twitter/LinkedIn — across EVM and Solana. So a deployer,
// funder, top holder, or cluster wallet that read as "0x1a2b…" now reads as who
// it actually is. Batched + per-address cached (addresses recur across reports).
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 20 };

const ARKHAM = "https://api.arkm.com/intelligence/address/";

export type ArkhamLabel = {
  name: string;
  type?: string;      // cex | individual | fund | defi | dex | …
  sublabel?: string;  // e.g. "Cold Wallet", "Hot Wallet 3"
  twitter?: string;
  website?: string;
  isCex: boolean;
  isContract: boolean;
};

async function lookup(addr: string, key: string): Promise<ArkhamLabel | null> {
  const ck = `arkham:${addr.toLowerCase()}:v1`;
  const cached = await cacheGetJson<ArkhamLabel | { none: true }>(ck);
  if (cached) return (cached as { none?: true }).none ? null : (cached as ArkhamLabel);
  try {
    // api.arkhamintelligence.com 307-redirects to api.arkm.com; hit it directly.
    const r = await fetch(`${ARKHAM}${encodeURIComponent(addr)}`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      arkhamEntity?: { name?: string; type?: string; twitter?: string; website?: string } | null;
      arkhamLabel?: { name?: string } | null;
      contract?: boolean;
    };
    const e = d?.arkhamEntity, lbl = d?.arkhamLabel;
    const name = e?.name || lbl?.name || "";
    if (!name) { await cacheSetJson(ck, { none: true }); return null; }
    const out: ArkhamLabel = {
      name,
      type: e?.type,
      sublabel: lbl?.name && e?.name && lbl.name.toLowerCase() !== e.name.toLowerCase() ? lbl.name : undefined,
      twitter: typeof e?.twitter === "string" && e.twitter ? e.twitter : undefined,
      website: typeof e?.website === "string" && e.website ? e.website : undefined,
      isCex: e?.type === "cex",
      isContract: !!d?.contract,
    };
    await cacheSetJson(ck, out);
    return out;
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured (no ARKHAM_API_KEY)." }); return; }
  const raw = typeof req.query.addresses === "string" ? req.query.addresses : typeof req.query.address === "string" ? req.query.address : "";
  const addrs = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 30);
  if (!addrs.length) { res.status(400).json({ error: "addresses required" }); return; }
  try {
    const results = await Promise.all(addrs.map((a) => lookup(a, key).then((l) => [a.toLowerCase(), l] as const)));
    const labels: Record<string, ArkhamLabel> = {};
    for (const [a, l] of results) if (l && l.name) labels[a] = l;
    res.status(200).json({ available: true, labels });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Arkham lookup failed." });
  }
}
