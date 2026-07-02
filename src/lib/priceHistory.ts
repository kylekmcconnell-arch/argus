// Token price history from GeckoTerminal's free API (no key). Powers the
// performance sparkline on token audits and, for a KOL, the outcome of each
// token they called (down how far from its peak). Read-only.

// DexScreener chainId -> GeckoTerminal network slug.
const NETWORK: Record<string, string> = {
  solana: "solana", ethereum: "eth", eth: "eth", bsc: "bsc", base: "base",
  arbitrum: "arbitrum", polygon: "polygon_pos", "polygon_pos": "polygon_pos",
  avalanche: "avax", avax: "avax", optimism: "optimism", fantom: "ftm",
  sui: "sui", ton: "ton", tron: "tron", blast: "blast", sei: "sei-evm",
};

export interface PriceHistory {
  points: number[];      // close prices, oldest -> newest
  first: number;         // oldest close in the window
  last: number;          // current-ish close
  peak: number;          // max close in the window
  changePct: number;     // last vs first, %
  drawdownPct: number;   // last vs peak, % (<= 0)
  timeframe: string;     // "day" | "hour"
}

const GT = "https://api.geckoterminal.com/api/v2";

async function gt(path: string): Promise<any | null> {
  try {
    const r = await fetch(`${GT}${path}`, { headers: { accept: "application/json" } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Resolve the deepest pool for a token when we weren't handed a pair address.
async function topPool(network: string, address: string): Promise<string | null> {
  const d = await gt(`/networks/${network}/tokens/${address}/pools?page=1`);
  const first = d?.data?.[0];
  const id: string | undefined = first?.attributes?.address ?? first?.id;
  return id ? id.replace(`${network}_`, "") : null;
}

export async function fetchPriceHistory(
  address: string,
  chain: string,
  pairAddress?: string,
): Promise<PriceHistory | null> {
  const network = NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !address) return null;
  const pool = pairAddress || (await topPool(network, address));
  if (!pool) return null;

  // Prefer daily candles for a real history; fall back to hourly for young
  // tokens that have no daily data yet.
  for (const timeframe of ["day", "hour"]) {
    const d = await gt(`/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=1&limit=200&currency=usd`);
    const list: number[][] = d?.data?.attributes?.ohlcv_list ?? [];
    if (list.length < 3) continue;
    // GeckoTerminal returns newest-first; sort oldest -> newest by timestamp.
    const rows = [...list].sort((a, b) => a[0] - b[0]);
    const points = rows.map((r) => r[4]).filter((n) => typeof n === "number" && n > 0);
    if (points.length < 3) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const peak = Math.max(...points);
    return {
      points,
      first,
      last,
      peak,
      changePct: first > 0 ? ((last - first) / first) * 100 : 0,
      drawdownPct: peak > 0 ? ((last - peak) / peak) * 100 : 0,
      timeframe,
    };
  }
  return null;
}
