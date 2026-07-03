// Holder / distribution forensics for a token. GET /api/holders?mint=&chain=
//
// The question a diligence tool exists to answer for a token: is the ownership a
// healthy base, or a rug wearing a costume? For Solana we use RugCheck, which
// exposes what nobody else does cheaply — total holders, top-holder concentration
// (with DEX/CEX/LP holdings separated out so exchange liquidity isn't mistaken for
// insider concentration), CONNECTED insider clusters (wallets funded from a common
// source, collapsed into one operator), creator holdings, and LP-lock. Keyless.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const short = (a?: string) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "");
// Addresses that are market infrastructure, not a concentrated holder: an AMM pool
// or a CEX wallet holding 20% is liquidity/custody, not a rug setup.
const MARKET = /amm|dex|pool|cex|exchange|program|vault|locker|market|raydium|meteora|orca|pump/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mint = q(req.query.mint);
  const chain = q(req.query.chain).toLowerCase();
  if (!mint) { res.status(400).json({ error: "mint required" }); return; }
  if (chain !== "solana") { res.status(200).json({ available: false, note: "Deep holder forensics (RugCheck) is Solana-only for now." }); return; }

  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
    if (!r.ok) { res.status(200).json({ available: false, error: `rugcheck ${r.status}` }); return; }
    const d = (await r.json()) as any;

    const supply = Number(d.token?.supply ?? 0);
    const ka: Record<string, { name?: string; type?: string }> = d.knownAccounts ?? {};
    const labelOf = (h: any) => ka[h.address] || ka[h.owner] || null;
    const top = (d.topHolders ?? []).slice(0, 10).map((h: any) => {
      const lab = labelOf(h);
      return { addr: short(h.owner || h.address), pct: Number(h.pct ?? 0), insider: !!h.insider, label: lab?.name ?? (h.insider ? "insider" : null), market: !!(lab?.type && MARKET.test(lab.type)) };
    });
    const sumN = (n: number) => top.slice(0, n).reduce((a: number, x: any) => a + x.pct, 0);
    const marketPct = top.filter((h: any) => h.market).reduce((a: number, h: any) => a + h.pct, 0);
    const top10 = sumN(10);
    const top10NonMarket = Math.max(0, top10 - marketPct);

    const nets = (d.insiderNetworks ?? []).map((n: any) => ({ size: Number(n.size ?? n.activeAccounts ?? 0), pct: supply ? (Number(n.tokenAmount ?? 0) / supply) * 100 : 0 }));
    const insiderClusteredPct = nets.reduce((a: number, n: any) => a + n.pct, 0);
    const creatorPct = supply ? (Number(d.creatorBalance ?? 0) / supply) * 100 : 0;
    const totalHolders = Number(d.totalHolders ?? 0);

    // The read: separate concentration (in real wallets) + insider clustering + dev
    // holdings from benign market/exchange liquidity.
    let tone: "good" | "warn" | "bad" = "good";
    const bump = (t: "warn" | "bad") => { if (t === "bad" || tone === "good") tone = t; };
    const bits: string[] = [];
    if (d.rugged) { bump("bad"); bits.push("RugCheck flags this token as rugged"); }
    if (top10NonMarket >= 40) { bump("bad"); bits.push(`top 10 non-market wallets hold ${top10NonMarket.toFixed(0)}% — highly concentrated`); }
    else if (top10NonMarket >= 20) { bump("warn"); bits.push(`top 10 non-market wallets hold ${top10NonMarket.toFixed(0)}%`); }
    if (insiderClusteredPct >= 15) { bump("warn"); bits.push(`${insiderClusteredPct.toFixed(0)}% of supply sits in connected insider clusters (${Number(d.graphInsidersDetected ?? 0).toLocaleString()} linked wallets)`); }
    if (creatorPct >= 10) { bump("warn"); bits.push(`the creator still holds ${creatorPct.toFixed(0)}%`); }
    const line = bits.length
      ? bits.join("; ") + "."
      : `Distribution looks healthy: ${totalHolders.toLocaleString()} holders, top 10 hold ${top10.toFixed(0)}%${marketPct > 1 ? ` (${marketPct.toFixed(0)}% is DEX/CEX/LP, not private wallets)` : ""}.`;

    res.status(200).json({
      available: true, source: "rugcheck", mint,
      totalHolders,
      top,
      concentration: { top1: sumN(1), top5: sumN(5), top10, top10NonMarket, marketPct },
      insiders: { detected: Number(d.graphInsidersDetected ?? 0), networks: nets.length, clusteredPct: insiderClusteredPct },
      creatorPct,
      lpLockedPct: Number(d.lpLockedPct ?? 0),
      rugged: !!d.rugged,
      verdict: { tone, line },
    });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e) });
  }
}
