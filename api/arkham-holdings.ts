// Arkham holdings. GET /api/arkham-holdings?address=<addr>&symbol=<own-token>
//
// What a wallet actually HOLDS right now — net worth, 24h move, and the token
// breakdown, straight from Arkham's balances endpoint (live prices baked in). For
// a token's deployer this answers the questions the risk score can't: has the
// operator cashed out, or is their whole net worth still their own coin? How much
// is parked in stables vs at-risk in illiquid tokens? A deployer whose net worth
// IS the token they launched has every incentive to defend the price — and nothing
// realized. Deduped to the top holdings by USD, self-token + stable share flagged.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 20 };

const BAL = "https://api.arkm.com/balances/address/";
const STABLES = new Set(["usdt", "usdc", "dai", "busd", "tusd", "usde", "fdusd", "usdt0", "pyusd", "usdp", "gusd", "lusd", "frax", "usds"]);

export type Holding = { name: string; symbol: string; usd: number; balance: number; change24h: number; chain: string };
type Out = {
  available: boolean;
  totalUsd: number;
  totalUsd24hAgo: number;
  deltaPct: number;
  chains: number;
  holdings: Holding[];
  concentrationPct: number; // top holding's share of net worth
  stablePct: number;        // share parked in stablecoins
  selfToken?: { symbol: string; usd: number; pct: number }; // if ?symbol= matches a holding
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured." }); return; }
  const addr = (typeof req.query.address === "string" ? req.query.address : "").trim();
  const symbol = (typeof req.query.symbol === "string" ? req.query.symbol : "").trim().toUpperCase();
  if (!addr || addr.length < 8) { res.status(400).json({ error: "address required" }); return; }

  const ck = `arkham-hold:${addr.toLowerCase()}:${symbol || "-"}:v1`;
  const cached = await cacheGetJson<Out>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  try {
    const r = await fetch(`${BAL}${encodeURIComponent(addr)}`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) { res.status(200).json({ available: false, note: `Arkham ${r.status}` }); return; }
    const d = (await r.json()) as { totalBalance?: Record<string, number>; totalBalance24hAgo?: Record<string, number>; balances?: Record<string, any[]> };

    const totalUsd = Object.values(d.totalBalance ?? {}).reduce((s, v) => s + num(v), 0);
    const totalUsd24hAgo = Object.values(d.totalBalance24hAgo ?? {}).reduce((s, v) => s + num(v), 0);

    // Merge the same token across chains (an operator can hold ETH on 5 chains).
    const byToken = new Map<string, Holding>();
    const chainsWithBalance = new Set<string>();
    for (const [chain, list] of Object.entries(d.balances ?? {})) {
      if (!Array.isArray(list)) continue;
      let chainHas = false;
      for (const t of list) {
        const usd = num(t?.usd);
        if (usd < 1) continue; // ignore dust
        chainHas = true;
        const sym = (String(t?.symbol ?? "").trim() || "?").toUpperCase();
        const idKey = String(t?.id || sym).toLowerCase();
        const ex = byToken.get(idKey);
        if (ex) { ex.usd += usd; ex.balance += num(t?.balance); }
        else byToken.set(idKey, { name: String(t?.name ?? sym), symbol: sym, usd, balance: num(t?.balance), change24h: num(t?.priceChange24hPercent), chain });
      }
      if (chainHas) chainsWithBalance.add(chain);
    }

    const all = [...byToken.values()].sort((a, b) => b.usd - a.usd);
    const holdings = all.slice(0, 8);
    const stableUsd = all.filter((h) => STABLES.has(h.symbol.toLowerCase())).reduce((s, h) => s + h.usd, 0);
    const selfHold = symbol ? all.find((h) => h.symbol === symbol) : undefined;

    const out: Out = {
      available: true,
      totalUsd,
      totalUsd24hAgo,
      deltaPct: totalUsd24hAgo > 0 ? ((totalUsd - totalUsd24hAgo) / totalUsd24hAgo) * 100 : 0,
      chains: chainsWithBalance.size,
      holdings,
      concentrationPct: totalUsd > 0 && all.length ? (all[0].usd / totalUsd) * 100 : 0,
      stablePct: totalUsd > 0 ? (stableUsd / totalUsd) * 100 : 0,
      selfToken: selfHold && totalUsd > 0 ? { symbol: selfHold.symbol, usd: selfHold.usd, pct: (selfHold.usd / totalUsd) * 100 } : undefined,
    };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Holdings lookup failed." });
  }
}
