import { buildHolderIntelligence } from "../src/lib/holderIntelligence.js";
// Holder / distribution forensics for a token. GET /api/holders?mint=&chain=
//
// The question a diligence tool exists to answer for a token: is the ownership a
// healthy base, or a rug wearing a costume? For Solana we use RugCheck, which
// exposes what nobody else does cheaply — total holders, top-holder concentration
// (with DEX/CEX/LP holdings separated out so exchange liquidity isn't mistaken for
// insider concentration), CONNECTED insider clusters (wallets funded from a common
// source, collapsed into one operator), creator holdings, and LP-lock. Keyless.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { creatorSupplyPercent, lockedShare } from "../src/token/sources.js";

export const config = { maxDuration: 20 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const short = (a?: string) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "");
// Addresses that are market infrastructure, not a concentrated holder: an AMM pool
// or a CEX wallet holding 20% is liquidity/custody, not a rug setup.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mint = q(req.query.mint);
  const chain = q(req.query.chain).toLowerCase();
  if (!mint) { res.status(400).json({ error: "mint required" }); return; }
  if (chain !== "solana") { res.status(200).json({ available: false, note: "Deep holder forensics (RugCheck) is Solana-only for now." }); return; }

  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
    if (!r.ok) { res.status(200).json({ available: false, error: `rugcheck ${r.status}` }); return; }
    const d = (await r.json()) as any;

    if (!Array.isArray(d.topHolders)) { res.status(200).json({ available: false, note: "Holder records unavailable from RugCheck." }); return; }
    const supply = Number(d.token?.supply ?? 0);
    const ka: Record<string, { name?: string; type?: string }> = d.knownAccounts ?? {};

    const holderIntelligence = buildHolderIntelligence({
      chain, tokenAddress: mint, capturedAt: new Date().toISOString(),
      source: "rugcheck", sourceUrl: `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
      ranked: false, aggregateOwners: true, knownAccounts: ka,
      rows: d.topHolders.map((h: any) => ({ address: String(h.address ?? ""), owner: String(h.owner ?? ""), percent: Number(h.pct) })),
    });
    const top = holderIntelligence.rows.map(h => ({ addr: short(h.address), owner: h.address, pct: h.percent,
      insider: false, label: h.roleEvidence, market: ["pool", "exchange", "locker", "burn"].includes(h.role) }));
    const sumN = (n: number) => top.slice(0, n).reduce((a: number, x: any) => a + x.pct, 0);
    const marketPct = top.slice(0, 10).filter((h: any) => h.market).reduce((a: number, h: any) => a + h.pct, 0);
    const top10 = sumN(10);
    const top10NonMarket = Math.max(0, top10 - marketPct);

    // Networks OVERLAP (a wallet can be in several), so summing over-counts — take
    // the single LARGEST connected cluster as the honest "% in one hidden hand".
    const nets = (d.insiderNetworks ?? []).map((n: any) => ({ size: Number(n.size ?? n.activeAccounts ?? 0), pct: supply ? Math.min(100, (Number(n.tokenAmount ?? 0) / supply) * 100) : 0 }));
    const insiderClusteredPct = nets.length ? Math.min(100, Math.max(...nets.map((n: any) => n.pct))) : 0;
    const insidersDetected = Number(d.graphInsidersDetected ?? 0);
    // A ratio outside 0-100% is a bad payload, and publishing it would put a
    // fabricated number on screen. Null means unmeasured, never zero.
    const creatorPct = creatorSupplyPercent(d.creatorBalance, supply);
    const totalHolders = Number(d.totalHolders ?? 0);
    // Concentration only reads as risk on a THIN base. A mega-holder token (BONK,
    // WIF) with a high top-10 is exchanges + whales in a liquid market, not a rug —
    // and RugCheck doesn't label every CEX, so we don't cry wolf on the top-10 alone.
    const large = totalHolders >= 50000;

    let tone: "good" | "warn" | "bad" = "good";
    const bump = (t: "warn" | "bad") => { if (t === "bad" || tone === "good") tone = t; };
    const bits: string[] = [];
    if (d.rugged) { bump("bad"); bits.push("RugCheck flags this token as rugged"); }
    // On a THIN base (young memecoins — the real diligence target) the connected
    // clusters + top-10 are the story. On a mega-holder token the transfer graph
    // balloons and the top-10 is exchanges, so we don't alarm on either.
    if (!large) {
      if (insidersDetected >= 15 && insiderClusteredPct >= 30) { bump("bad"); bits.push(`${insidersDetected.toLocaleString()} wallets funded from a common source hold ${insiderClusteredPct.toFixed(0)}% of supply. RugCheck reports this relationship; common funding alone does not establish one controller`); }
      else if (insidersDetected >= 15 && insiderClusteredPct >= 12) { bump("warn"); bits.push(`${insidersDetected.toLocaleString()} connected wallets cluster ${insiderClusteredPct.toFixed(0)}% of supply`); }
      if (top10 >= 60) { bump("bad"); bits.push(`the first 10 observed owners hold ${top10.toFixed(0)}% of a thin base of ${totalHolders.toLocaleString()} holders`); }
      else if (top10 >= 40) { bump("warn"); bits.push(`the first 10 observed owners hold ${top10.toFixed(0)}% (only ${totalHolders.toLocaleString()} holders)`); }
    }
    if (creatorPct != null && creatorPct >= 15) { bump("bad"); bits.push(`the creator or authority wallet still holds ${creatorPct.toFixed(0)}%`); }
    else if (creatorPct != null && creatorPct >= 7) { bump("warn"); bits.push(`the creator or authority wallet holds ${creatorPct.toFixed(0)}%`); }
    const line = `RugCheck returned ${top.length} observed owners. This sample does not establish the global top 25 or common control. ${bits.length ? bits.join("; ") + "." : "No conclusion about ownership quality is established by missing labels."}`;

    res.status(200).json({
      available: true, source: "rugcheck", mint,
      totalHolders,
      top, holderIntelligence,
      concentration: { top1: sumN(1), top5: sumN(5), top10, top10NonMarket, marketPct },
      insiders: { detected: Number(d.graphInsidersDetected ?? 0), networks: nets.length, clusteredPct: insiderClusteredPct },
      creatorPct,
      // RugCheck reports 0 both for a pool it examined and found unlocked and
      // for a mint it holds no market for. Null means unmeasured, never "0%
      // locked" (the same rule the token audit applies to this field).
      lpLockedPct: lockedShare(d.lpLockedPct, d.markets),
      rugged: !!d.rugged,
      verdict: { tone, line },
    });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e) });
  }
}
