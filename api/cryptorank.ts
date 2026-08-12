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
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 25 };

const CR = "https://api.cryptorank.io/v2";
const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
interface CallCounter { calls: number; succeeded: number }

async function cr(path: string, key: string, usage: CallCounter): Promise<any | null> {
  usage.calls += 1;
  try {
    const r = await fetch(`${CR}${path}`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    usage.succeeded += 1;
    return data;
  } catch { return null; }
}

// Category id -> name (rarely changes; 7d cache).
async function categoryName(id: number, key: string, usage: CallCounter): Promise<string | null> {
  if (!id) return null;
  const cached = await cacheGetJson<Record<string, string>>("cr:categories");
  let map = cached;
  if (!map) {
    const d = await cr("/currencies/categories", key, usage);
    map = Object.fromEntries((d?.data ?? []).map((c: any) => [String(c.id), c.name]));
    if (Object.keys(map).length) await cacheSetJson("cr:categories", map);
  }
  return map?.[String(id)] ?? null;
}

// Where this token's global rank sits among its sector's ranked peers (24h cache
// per category). Returns { peersRanked, position } — "12th of 500 ranked GameFi".
interface CategoryPeer {
  name: string;
  symbol: string;
  rank: number;
  marketCap: number | null;
}

async function categoryContext(categoryId: number, rank: number | null, key: string, usage: CallCounter): Promise<{ position: number; peersRanked: number; leaders: CategoryPeer[] } | null> {
  if (!categoryId || rank == null) return null;
  const ck = `cr:category-context:v2:${categoryId}`;
  let peers = await cacheGetJson<CategoryPeer[]>(ck);
  if (!peers) {
    const d = await cr(`/currencies?limit=500&categoryId=${categoryId}&sortBy=rank&sortDirection=ASC`, key, usage);
    const collected: CategoryPeer[] = (d?.data ?? [])
      .filter((entry: any) => typeof entry?.rank === "number" && typeof entry?.name === "string")
      .map((entry: any) => ({
        name: entry.name,
        symbol: String(entry.symbol ?? "").toUpperCase(),
        rank: entry.rank,
        marketCap: num(entry.marketCap),
      }))
      .sort((left: CategoryPeer, right: CategoryPeer) => left.rank - right.rank);
    peers = collected;
    if (collected.length) await cacheSetJson(ck, collected);
  }
  if (!peers?.length) return null;
  const position = peers.filter((peer) => peer.rank <= rank).length;
  return { position, peersRanked: peers.length, leaders: peers.slice(0, 5) };
}

async function macro(key: string, usage: CallCounter): Promise<{ investmentActivity: number | null; btcDominance: number | null; mcapChange: number | null } | null> {
  const cached = await cacheGetJson<any>("cr:global");
  if (cached) return cached;
  const d = await cr("/global", key, usage);
  if (!d?.data) return null;
  const out = { investmentActivity: num(d.data.investmentActivity), btcDominance: num(d.data.btcDominance), mcapChange: num(d.data.totalMarketCapChange) };
  await cacheSetJson("cr:global", out);
  return out;
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

  const key = process.env.CRYPTORANK_API_KEY;
  const symbol = q(req.query.symbol).replace(/^\$/, "").toUpperCase();
  const contract = q(req.query.contract).toLowerCase();
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "CryptoRank not configured." }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
  const search = await cr(`/currencies?symbol=${encodeURIComponent(symbol)}`, key, usage);
  const candidates: any[] = Array.isArray(search?.data) ? search.data : [];
  if (!candidates.length) { res.status(200).json({ available: true, matched: false, note: "not listed on CryptoRank" }); return; }

  // Resolve: prefer the candidate whose on-chain contract matches; else the
  // highest-ranked namesake (candidates come rank-sorted).
  let d: any = null;
  let matchedBy: "contract" | "ticker" = "ticker";
  if (contract) {
    for (const c of candidates.slice(0, 5)) {
      const det = await cr(`/currencies/${c.id}`, key, usage);
      if ((det?.data?.contracts ?? []).some((x: any) => String(x.address).toLowerCase() === contract)) { d = det.data; matchedBy = "contract"; break; }
    }
  }

  // IMPERSONATION: a contract was given, it matched NO candidate, yet a ranked
  // project owns this exact ticker → the audited token is squatting a real name.
  let impersonation: any = null;
  if (contract && matchedBy === "ticker" && !d) {
    const ranked = candidates.find((c) => typeof c.rank === "number" && c.rank <= 3000);
    if (ranked) {
      const det = await cr(`/currencies/${ranked.id}`, key, usage);
      const real = det?.data ?? ranked;
      const realContract = (real.contracts ?? [])[0];
      impersonation = { realName: real.name, realRank: real.rank ?? null, realContract: realContract?.address ?? null, realChain: realContract?.platform?.name ?? null, url: real.key ? `https://cryptorank.io/price/${real.key}` : null };
    }
  }

  // If this is an impersonator, DON'T attach the real project's market data to
  // it — return only the warning. Otherwise (no contract given, or a ticker-only
  // match with no impersonation) fall back to the top-ranked namesake.
  if (impersonation) { res.status(200).json({ available: true, matched: false, impersonation }); return; }
  if (!d) { const det = await cr(`/currencies/${candidates[0].id}`, key, usage); d = det?.data ?? candidates[0]; }
  if (!d) { res.status(200).json({ available: true, matched: false, note: "lookup failed" }); return; }

  const circ = num(d.circulatingSupply);
  const max = num(d.maxSupply) ?? num(d.totalSupply);
  const dilutionPct = circ != null && max ? Math.round((circ / max) * 100) : null;
  const volume = num(d.volume24h);
  const mcap = num(d.marketCap);
  const volMcap = volume != null && mcap ? Number((volume / mcap).toFixed(2)) : null;
  const atlValue = num(d.atl?.value);
  const price = num(d.price);
  const recoveryPct = atlValue && price ? Math.round(((price - atlValue) / atlValue) * 100) : null;

  const [catName, category, mac] = await Promise.all([
    categoryName(d.categoryId, key, usage),
    categoryContext(d.categoryId, d.rank ?? null, key, usage),
    macro(key, usage),
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
    category: catName ? {
      name: catName,
      position: category?.position ?? null,
      peersRanked: category?.peersRanked ?? null,
      leaders: category?.leaders ?? [],
    } : null,
    contracts: (d.contracts ?? []).map((c: any) => ({ chain: c.platform?.name ?? c.platform?.key ?? "?", address: c.address })),
    macro: mac,
    url: d.key ? `https://cryptorank.io/price/${d.key}` : null,
  });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "cryptorank",
        op: "panel:cryptorank",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
