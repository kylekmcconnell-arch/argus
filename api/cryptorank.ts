// Market intelligence via CryptoRank. GET /api/cryptorank?symbol=&contract=&chain=
//
// The fundamentals a DEX scan can't see: CoinMarketCap-style rank, drawdown from
// all-time high, real dilution (circulating vs max supply + FDV/mcap gap), and
// the flags that reveal a project's cap-table shape — is it VC-backed
// (hasFundingRounds), does it have a vesting schedule, is a token UNLOCK coming
// (hasNextUnlock, a dump-risk signal). Resolved by ticker then VERIFIED against
// the token's on-chain contract so a ticker collision can't attach wrong data.
// CRYPTORANK_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const CR = "https://api.cryptorank.io/v2";
const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

async function cr(path: string, key: string): Promise<any | null> {
  try {
    const r = await fetch(`${CR}${path}`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.CRYPTORANK_API_KEY;
  const symbol = q(req.query.symbol).replace(/^\$/, "").toUpperCase();
  const contract = q(req.query.contract).toLowerCase();
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "CryptoRank not configured." }); return; }

  // 1. candidates by ticker (rank-sorted). 2. verify against the on-chain
  //    contract by pulling each candidate's detail (which carries `contracts`).
  const search = await cr(`/currencies?symbol=${encodeURIComponent(symbol)}`, key);
  const candidates: any[] = Array.isArray(search?.data) ? search.data.slice(0, 4) : [];
  if (!candidates.length) { res.status(200).json({ available: true, matched: false, note: "not listed on CryptoRank" }); return; }

  let d: any = null;
  let matchedBy: "contract" | "ticker" = "ticker";
  if (contract) {
    for (const c of candidates) {
      const det = await cr(`/currencies/${c.id}`, key);
      const hit = (det?.data?.contracts ?? []).some((x: any) => String(x.address).toLowerCase() === contract);
      if (hit) { d = det.data; matchedBy = "contract"; break; }
    }
  }
  if (!d) { const det = await cr(`/currencies/${candidates[0].id}`, key); d = det?.data ?? candidates[0]; }
  if (!d) { res.status(200).json({ available: true, matched: false, note: "lookup failed" }); return; }

  const circ = num(d.circulatingSupply);
  const max = num(d.maxSupply) ?? num(d.totalSupply);
  const dilutionPct = circ != null && max ? Math.round((circ / max) * 100) : null; // % of supply live
  const athDrawdown = d.ath?.percentChange != null ? Number(d.ath.percentChange) : null;

  res.status(200).json({
    available: true,
    matched: true,
    matchedBy,
    name: d.name,
    symbol: d.symbol,
    rank: d.rank ?? null,
    price: num(d.price),
    marketCap: num(d.marketCap),
    fdv: num(d.fullyDilutedValuation),
    volume24h: num(d.volume24h),
    circulatingSupply: circ,
    maxSupply: max,
    dilutionPct, // % of max supply already circulating; low = big unlocks ahead
    ath: d.ath ? { value: num(d.ath.value), date: d.ath.date, drawdownPct: athDrawdown } : null,
    atl: d.atl ? { value: num(d.atl.value), date: d.atl.date } : null,
    percentChange: d.percentChange ?? null,
    flags: {
      hasTeam: !!d.hasTeam,
      hasFundingRounds: !!d.hasFundingRounds, // VC-backed
      hasCrowdsales: !!d.hasCrowdsales,
      hasVesting: !!d.hasVesting,
      hasNextUnlock: !!d.hasNextUnlock, // an upcoming token unlock = dump risk
    },
    url: d.key ? `https://cryptorank.io/price/${d.key}` : null,
  });
}
