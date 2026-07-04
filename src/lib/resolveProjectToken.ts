// Resolve a project's official token from its name — safely. A site recon of a
// JS app (jup.ag) often renders too thin to surface token signals, so the report
// never reaches the token where the real diligence lives. This bridges that: given
// the project name, it asks CoinGecko (which dedupes to the CANONICAL coin, unlike
// a raw DexScreener name-search that returns a $641M Ethereum "Jupiter" namesake)
// for the real token and its contract. Requires a market-cap rank + a name match,
// so an unrelated same-name coin doesn't produce a false pivot.
export interface ResolvedProjectToken {
  symbol: string;
  name: string;
  id: string;
  rank: number | null;
  contract: string;
  chain: string;
}

const CHAIN_MAP: Record<string, string> = {
  solana: "solana", ethereum: "ethereum", "binance-smart-chain": "bsc",
  "polygon-pos": "polygon", "arbitrum-one": "arbitrum", base: "base",
  "optimistic-ethereum": "optimism", avalanche: "avalanche",
};
// Prefer the chain most likely to be the token's native home / unambiguous.
const CHAIN_PREF = ["solana", "ethereum", "base", "binance-smart-chain", "arbitrum-one", "polygon-pos", "avalanche"];

// Strip a marketing tagline: "Jupiter: The Home of Onchain Finance" → "Jupiter".
function cleanName(raw: string): string {
  return (raw || "").split(/[:|–—·・\-–]/)[0].replace(/\s+/g, " ").trim();
}

export async function resolveProjectToken(rawName: string): Promise<ResolvedProjectToken | null> {
  const name = cleanName(rawName);
  if (name.length < 2) return null;
  const nlow = name.toLowerCase();
  try {
    const s = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
    if (!s.ok) return null;
    const sd = (await s.json()) as { coins?: { id: string; name?: string; symbol?: string; market_cap_rank?: number | null }[] };
    const coins = Array.isArray(sd?.coins) ? sd.coins : [];
    // A real token has a market-cap rank; require the coin name to actually match
    // the project name (or the project name to be the ticker) so we never pivot to
    // an unrelated same-name coin.
    const cand =
      coins.find((c) => c.market_cap_rank != null && String(c.name ?? "").toLowerCase().includes(nlow)) ||
      coins.find((c) => c.market_cap_rank != null && nlow.includes(String(c.symbol ?? "").toLowerCase()) && String(c.symbol ?? "").length >= 3);
    if (!cand) return null;

    const c = await fetch(`https://api.coingecko.com/api/v3/coins/${cand.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`, { signal: AbortSignal.timeout(8000) });
    if (!c.ok) return null;
    const cd = (await c.json()) as { symbol?: string; name?: string; platforms?: Record<string, string> };
    const plats = cd?.platforms ?? {};
    let contract = "", chain = "";
    for (const p of CHAIN_PREF) { if (plats[p]) { contract = plats[p]; chain = CHAIN_MAP[p]; break; } }
    if (!contract) { const first = Object.entries(plats).find(([, v]) => v); if (first) { contract = first[1]; chain = CHAIN_MAP[first[0]] ?? first[0]; } }
    if (!contract) return null;

    return { symbol: String(cd.symbol ?? cand.symbol ?? "").toUpperCase(), name: cd.name ?? cand.name ?? name, id: cand.id, rank: cand.market_cap_rank ?? null, contract, chain };
  } catch { return null; }
}
