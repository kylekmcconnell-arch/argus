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
  capturedAt?: string;   // present when the series is frozen into a report
}

const GT = "https://api.geckoterminal.com/api/v2";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

async function gt(path: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${GT}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Resolve the deepest pool for a token when we weren't handed a pair address.
async function topPool(network: string, address: string): Promise<string | null> {
  const d = await gt(`/networks/${network}/tokens/${address}/pools?page=1`);
  const rows = record(d).data;
  const first = Array.isArray(rows) ? record(rows[0]) : {};
  const attributes = record(first.attributes);
  const id = typeof attributes.address === "string"
    ? attributes.address
    : typeof first.id === "string"
      ? first.id
      : undefined;
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
    const rawList = record(record(record(d).data).attributes).ohlcv_list;
    const list = Array.isArray(rawList)
      ? rawList.filter((row): row is number[] =>
          Array.isArray(row) && row.length >= 5 && row.every((value) => typeof value === "number"))
      : [];
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
      capturedAt: new Date().toISOString(),
    };
  }
  return null;
}
