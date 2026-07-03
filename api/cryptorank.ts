// Market intelligence via CryptoRank. GET /api/cryptorank?symbol=&contract=&chain=
//
// The fundamentals + connections a DEX scan can't see:
//   - drawdown from all-time high (the headline: "-99% from ATH")
//   - dilution (circulating vs max supply, FDV/mcap gap) + unlock/vesting flags
//   - rank, and rank WITHIN its sector (peer placement)
//   - cross-chain footprint (every chain the token is deployed on)
//   - IMPERSONATION: a token using a ranked project's ticker at a DIFFERENT
//     contract is ticker-squatting a legit name — a strong scam tell
//   - macro context (is it launching into a rising or dead funding market)
// Resolved by ticker then verified against the on-chain contract. Heavy static
// data (categories, sector lists, global) is 24h-cached. CRYPTORANK_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 25 };

const CR = "https://api.cryptorank.io/v2";
const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

async function cr(path: string, key: string): Promise<any | null> {
  try {
    const r = await fetch(`${CR}${path}`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(10000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Category id -> name (rarely changes; 7d cache).
async function categoryName(id: number, key: string): Promise<string | null> {
  if (!id) return null;
  const cached = await cacheGetJson<Record<string, string>>("cr:categories");
  let map = cached;
  if (!map) {
    const d = await cr("/currencies/categories", key);
    map = Object.fromEntries((d?.data ?? []).map((c: any) => [String(c.id), c.name]));
    if (Object.keys(map).length) await cacheSetJson("cr:categories", map);
  }
  return map?.[String(id)] ?? null;
}

// Where this token's global rank sits among its sector's ranked peers (24h cache
// per category). Returns { peersRanked, position } — "12th of 500 ranked GameFi".
async function categoryPlacement(categoryId: number, rank: number | null, key: string): Promise<{ position: number; peersRanked: number } | null> {
  if (!categoryId || rank == null) return null;
  const ck = `cr:catranks:${categoryId}`;
  let ranks = await cacheGetJson<number[]>(ck);
  if (!ranks) {
    const d = await cr(`/currencies?limit=500&categoryId=${categoryId}&sortBy=rank&sortDirection=ASC`, key);
    ranks = (d?.data ?? []).map((x: any) => x.rank).filter((r: any) => typeof r === "number").sort((a: number, b: number) => a - b);
    if (ranks && ranks.length) await cacheSetJson(ck, ranks);
  }
  if (!ranks?.length) return null;
  const position = ranks.filter((r) => r <= rank).length;
  return { position, peersRanked: ranks.length };
}

async function macro(key: string): Promise<{ investmentActivity: number | null; btcDominance: number | null; mcapChange: number | null } | null> {
  const cached = await cacheGetJson<any>("cr:global");
  if (cached) return cached;
  const d = await cr("/global", key);
  if (!d?.data) return null;
  const out = { investmentActivity: num(d.data.investmentActivity), btcDominance: num(d.data.btcDominance), mcapChange: num(d.data.totalMarketCapChange) };
  await cacheSetJson("cr:global", out);
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.CRYPTORANK_API_KEY;
  const symbol = q(req.query.symbol).replace(/^\$/, "").toUpperCase();
  const contract = q(req.query.contract).toLowerCase();
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "CryptoRank not configured." }); return; }

  const search = await cr(`/currencies?symbol=${encodeURIComponent(symbol)}`, key);
  const candidates: any[] = Array.isArray(search?.data) ? search.data : [];
  if (!candidates.length) { res.status(200).json({ available: true, matched: false, note: "not listed on CryptoRank" }); return; }

  // Resolve: prefer the candidate whose on-chain contract matches; else the
  // highest-ranked namesake (candidates come rank-sorted).
  let d: any = null;
  let matchedBy: "contract" | "ticker" = "ticker";
  if (contract) {
    for (const c of candidates.slice(0, 5)) {
      const det = await cr(`/currencies/${c.id}`, key);
      if ((det?.data?.contracts ?? []).some((x: any) => String(x.address).toLowerCase() === contract)) { d = det.data; matchedBy = "contract"; break; }
    }
  }

  // IMPERSONATION: a contract was given, it matched NO candidate, yet a ranked
  // project owns this exact ticker → the audited token is squatting a real name.
  let impersonation: any = null;
  if (contract && matchedBy === "ticker" && !d) {
    const ranked = candidates.find((c) => typeof c.rank === "number" && c.rank <= 3000);
    if (ranked) {
      const det = await cr(`/currencies/${ranked.id}`, key);
      const real = det?.data ?? ranked;
      const realContract = (real.contracts ?? [])[0];
      impersonation = { realName: real.name, realRank: real.rank ?? null, realContract: realContract?.address ?? null, realChain: realContract?.platform?.name ?? null, url: real.key ? `https://cryptorank.io/price/${real.key}` : null };
    }
  }

  if (!d) { const det = await cr(`/currencies/${candidates[0].id}`, key); d = det?.data ?? candidates[0]; }
  if (!d) { res.status(200).json({ available: true, matched: false, impersonation, note: "lookup failed" }); return; }

  const circ = num(d.circulatingSupply);
  const max = num(d.maxSupply) ?? num(d.totalSupply);
  const dilutionPct = circ != null && max ? Math.round((circ / max) * 100) : null;
  const volume = num(d.volume24h);
  const mcap = num(d.marketCap);
  const volMcap = volume != null && mcap ? Number((volume / mcap).toFixed(2)) : null;
  const atlValue = num(d.atl?.value);
  const price = num(d.price);
  const recoveryPct = atlValue && price ? Math.round(((price - atlValue) / atlValue) * 100) : null;

  const [catName, placement, mac] = await Promise.all([
    categoryName(d.categoryId, key),
    categoryPlacement(d.categoryId, d.rank ?? null, key),
    macro(key),
  ]);

  res.status(200).json({
    available: true,
    matched: true,
    matchedBy,
    impersonation,
    name: d.name,
    symbol: d.symbol,
    rank: d.rank ?? null,
    price,
    marketCap: mcap,
    fdv: num(d.fullyDilutedValuation),
    volume24h: volume,
    volMcapRatio: volMcap, // >1 with flat price = wash-trade signal
    circulatingSupply: circ,
    maxSupply: max,
    dilutionPct,
    ath: d.ath ? { value: num(d.ath.value), date: d.ath.date, drawdownPct: d.ath.percentChange != null ? Number(d.ath.percentChange) : null } : null,
    atl: d.atl ? { value: atlValue, date: d.atl.date, recoveryPct } : null,
    percentChange: d.percentChange ?? null,
    flags: {
      hasTeam: !!d.hasTeam,
      hasFundingRounds: !!d.hasFundingRounds,
      hasCrowdsales: !!d.hasCrowdsales,
      hasVesting: !!d.hasVesting,
      hasNextUnlock: !!d.hasNextUnlock,
    },
    category: catName ? { name: catName, position: placement?.position ?? null, peersRanked: placement?.peersRanked ?? null } : null,
    contracts: (d.contracts ?? []).map((c: any) => ({ chain: c.platform?.name ?? c.platform?.key ?? "?", address: c.address })),
    macro: mac,
    url: d.key ? `https://cryptorank.io/price/${d.key}` : null,
  });
}
