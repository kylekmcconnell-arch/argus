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

// ── Cap-table intel (unlocked on the paid tier 2026-07-03) ──────────────────
// Who funded this project and when their tokens unlock. Field names vary, so parse
// defensively across the shapes CryptoRank has used. Tries a couple candidate paths
// since the exact route differs by API version.
async function fundingRounds(id: number, key: string): Promise<{ rounds: any[]; totalRaisedUsd: number | null; investors: { name: string; lead: boolean }[] } | null> {
  for (const path of [`/currencies/${id}/funding-rounds`, `/currencies/${id}/rounds`, `/currencies/${id}/fundraising`]) {
    const d = await cr(path, key);
    const rows = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : null;
    if (rows && rows.length) {
      const rounds = rows.map((r: any) => ({
        type: r.type ?? r.stage ?? r.name ?? r.round ?? null,
        date: r.date ?? r.announcedAt ?? r.createdAt ?? r.closedAt ?? null,
        raisedUsd: num(r.raise ?? r.raised ?? r.amount ?? r.totalRaised ?? r.raisedUsd),
        investors: (r.investors ?? r.funds ?? []).map((i: any) => ({ name: (i?.name ?? i?.fund?.name ?? (typeof i === "string" ? i : "")).trim(), lead: !!(i?.isLead ?? i?.lead ?? i?.type === "lead") })).filter((i: any) => i.name),
      }));
      const totalRaisedUsd = rounds.reduce((s: number, r: any) => s + (r.raisedUsd ?? 0), 0) || null;
      // Dedup investors across rounds, keeping lead status.
      const byName = new Map<string, { name: string; lead: boolean }>();
      for (const r of rounds) for (const inv of r.investors) { const k = inv.name.toLowerCase(); const ex = byName.get(k); if (!ex) byName.set(k, inv); else if (inv.lead) ex.lead = true; }
      const investors = [...byName.values()].sort((a, b) => Number(b.lead) - Number(a.lead));
      return { rounds, totalRaisedUsd, investors };
    }
  }
  return null;
}

async function vesting(id: number, key: string): Promise<{ nextUnlock: { date: string; amountUsd: number | null; percentOfSupply: number | null } | null; allocations: { name: string; percent: number | null }[] } | null> {
  for (const path of [`/currencies/${id}/vesting`, `/currencies/${id}/unlocks`, `/currencies/${id}/token-unlock`]) {
    const d = await cr(path, key);
    const root = d?.data ?? d;
    if (!root) continue;
    const nu = root.nextUnlock ?? root.next_unlock ?? (Array.isArray(root.events) ? root.events.find((e: any) => new Date(e.date ?? e.unlockDate ?? 0).getTime() > Date.now()) : null);
    const allocs = root.allocations ?? root.rounds ?? root.buckets ?? [];
    const nextUnlock = nu ? { date: nu.date ?? nu.unlockDate ?? nu.at ?? "", amountUsd: num(nu.amountUsd ?? nu.usd ?? nu.valueUsd ?? nu.amount), percentOfSupply: num(nu.percent ?? nu.percentOfSupply ?? nu.pct) } : null;
    const allocations = (Array.isArray(allocs) ? allocs : []).map((a: any) => ({ name: (a.name ?? a.type ?? a.title ?? "").trim(), percent: num(a.percent ?? a.pct ?? a.allocation) })).filter((a: any) => a.name);
    if (nextUnlock || allocations.length) return { nextUnlock, allocations };
  }
  return null;
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

  // TEMP v3 probe: the public API moved to v3; discover the working routes/shapes.
  if (q(req.query.probe)) {
    const hit = async (base: string, p: string) => {
      try {
        const r = await fetch(`https://api.cryptorank.io/${base}${p}`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(9000) });
        let sample: any = null;
        if (r.ok) { const j = await r.json().catch(() => null); const root = j?.data ?? j; sample = Array.isArray(root) ? { len: root.length, first0: root[0] } : root && typeof root === "object" ? Object.keys(root) : root; }
        else sample = (await r.text().catch(() => "")).slice(0, 120);
        return { status: r.status, sample };
      } catch (e) { return { error: String(e) }; }
    };
    // Resolve a v3 id via v3 search first, fall back to the v2 id.
    const v3search = await hit("v3", `/currencies?symbol=${encodeURIComponent(symbol)}`);
    let id = candidates[0].id;
    try { const r = await fetch(`https://api.cryptorank.io/v3/currencies?symbol=${encodeURIComponent(symbol)}`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(9000) }); if (r.ok) { const j: any = await r.json(); id = (j?.data ?? j)?.[0]?.id ?? id; } } catch { /* keep v2 id */ }
    // Pull the OpenAPI spec (behind the key) → list every real v3 route.
    let routes: string[] = [];
    try {
      const r = await fetch(`https://api.cryptorank.io/v3/openapi.json`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(9000) });
      if (r.ok) { const spec: any = await r.json(); routes = Object.keys(spec?.paths ?? {}); }
    } catch { /* */ }
    const relevant = routes.filter((p) => /fund|vest|unlock|invest|round|currenc|categor|global|metric/i.test(p));
    res.status(200).json({ v2id: candidates[0].id, v3id: id, totalRoutes: routes.length, relevant }); return;
  }

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

  // If this is an impersonator, DON'T attach the real project's market data to
  // it — return only the warning. Otherwise (no contract given, or a ticker-only
  // match with no impersonation) fall back to the top-ranked namesake.
  if (impersonation) { res.status(200).json({ available: true, matched: false, impersonation }); return; }
  if (!d) { const det = await cr(`/currencies/${candidates[0].id}`, key); d = det?.data ?? candidates[0]; }
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

  const [catName, placement, mac, rounds, vest] = await Promise.all([
    categoryName(d.categoryId, key),
    categoryPlacement(d.categoryId, d.rank ?? null, key),
    macro(key),
    // Cap-table endpoints are paid-tier; only spend the call when the flag says
    // there's something there (avoids a guaranteed-empty fetch on retail tokens).
    d.hasFundingRounds ? fundingRounds(d.id, key) : Promise.resolve(null),
    d.hasVesting || d.hasNextUnlock ? vesting(d.id, key) : Promise.resolve(null),
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
    // Real cap-table (paid tier): who backed it + when tokens unlock.
    funding: rounds && (rounds.investors.length || rounds.rounds.length) ? { totalRaisedUsd: rounds.totalRaisedUsd, roundCount: rounds.rounds.length, investors: rounds.investors.slice(0, 12), rounds: rounds.rounds.slice(0, 8) } : null,
    vesting: vest && (vest.nextUnlock || vest.allocations.length) ? { nextUnlock: vest.nextUnlock, allocations: vest.allocations.slice(0, 8) } : null,
    macro: mac,
    url: d.key ? `https://cryptorank.io/price/${d.key}` : null,
  });
}
