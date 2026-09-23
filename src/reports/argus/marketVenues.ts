/* Additional market snapshot for the Market chapter (design §8).

   A separately dated, read-only observation of where the token trades, taken
   when the chapter is opened. It never changes the saved report: saved market
   figures, scores and verdicts stay in their own modules. Pool volume and
   liquidity come from DexScreener; two-sided ±2% depth comes from CoinGecko's
   venue/pair tickers and is attributed to that scope, never summed, and never
   presented as a guaranteed execution quote. Both APIs are keyless and
   CORS-open (the token audit already calls them from the browser). */

import { retryFetchWithFreshTimeout } from "../../lib/retry";

export interface VenueRow {
  key: string;
  venue: string;
  venueUrl: string | null;
  type: "DEX" | "CEX";
  pair: string;
  poolAddress: string | null;
  chartUrl: string | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  depthUpUsd: number | null;
  depthDownUsd: number | null;
  /** Why depth is withheld for a matched venue (a provider stale/anomaly flag). */
  depthNote?: string;
  secondary: boolean;
}

export interface VenueSnapshot {
  capturedAt: string;
  rows: VenueRow[];
  cexChecked: boolean;
  dexSourceUrl: string;
  coingeckoUrl: string | null;
}

interface DexScreenerPool {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[];
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
}

interface CoinGeckoTickerRow {
  base?: string;
  target?: string;
  market?: { name?: string; identifier?: string };
  cost_to_move_up_usd?: number;
  cost_to_move_down_usd?: number;
  converted_volume?: { usd?: number };
  trade_url?: string | null;
  is_stale?: boolean;
  is_anomaly?: boolean;
}

const DEX_NAMES: Record<string, string> = {
  uniswap: "Uniswap",
  aerodrome: "Aerodrome",
  pancakeswap: "PancakeSwap",
  sushiswap: "SushiSwap",
  raydium: "Raydium",
  orca: "Orca",
  meteora: "Meteora",
  curve: "Curve",
  balancer: "Balancer",
  baseswap: "BaseSwap",
  camelot: "Camelot",
  traderjoe: "Trader Joe",
  velodrome: "Velodrome",
  pumpswap: "PumpSwap",
};

const CG_DEX = /swap|uniswap|aerodrome|pancake|sushi|raydium|orca|meteora|curve|balancer|dex|camelot|velodrome|trader.?joe|jupiter|pump/i;

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function venueName(pool: Pick<DexScreenerPool, "dexId" | "labels">): string {
  const id = String(pool.dexId ?? "").toLowerCase();
  const base = DEX_NAMES[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : "DEX");
  const version = (pool.labels ?? []).find((label) => /^v\d/i.test(label));
  if (version) return `${base} ${version.toUpperCase()}`;
  if (id === "aerodrome" && (pool.labels ?? []).some((label) => /cl|slipstream/i.test(label))) return "Aerodrome SlipStream";
  return base;
}

function sameAddress(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

/** Merge the two provider views. Depth attaches to the deepest pool of the same venue and quote only. */
export function mergeVenues(tokenAddress: string, pools: DexScreenerPool[], tickers: CoinGeckoTickerRow[]): VenueRow[] {
  const isDex = (ticker: CoinGeckoTickerRow) => CG_DEX.test(`${ticker.market?.identifier ?? ""} ${ticker.market?.name ?? ""}`);
  const flagged = (ticker: CoinGeckoTickerRow) => Boolean(ticker.is_stale || ticker.is_anomaly);
  const dexTickers = tickers.filter(isDex);
  const cexTickers = tickers.filter((ticker) => !isDex(ticker));
  const used = new Set<CoinGeckoTickerRow>();

  const sortedPools = [...pools]
    .filter((pool) => pool.pairAddress && (sameAddress(pool.baseToken?.address, tokenAddress) || sameAddress(pool.quoteToken?.address, tokenAddress)))
    .sort((left, right) => (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0));

  const seenVenuePair = new Set<string>();
  const rows: VenueRow[] = sortedPools.slice(0, 10).map((pool) => {
    const isBase = sameAddress(pool.baseToken?.address, tokenAddress);
    const own = isBase ? pool.baseToken : pool.quoteToken;
    const other = isBase ? pool.quoteToken : pool.baseToken;
    const venue = venueName(pool);
    const venuePair = `${String(pool.dexId).toLowerCase()}::${String(other?.address ?? other?.symbol).toLowerCase()}`;
    const secondary = seenVenuePair.has(venuePair);
    seenVenuePair.add(venuePair);
    const ticker = secondary ? undefined : dexTickers.find((candidate) =>
      !used.has(candidate)
      && sameAddress(candidate.target, other?.address)
      && String(candidate.market?.identifier ?? candidate.market?.name ?? "").toLowerCase().includes(String(pool.dexId ?? "").toLowerCase()));
    if (ticker) used.add(ticker);
    const depthOk = ticker && !flagged(ticker);
    const tickerVenue = ticker?.market?.name?.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return {
      key: String(pool.pairAddress),
      venue: tickerVenue || venue,
      venueUrl: safeUrl(ticker?.trade_url),
      type: "DEX",
      pair: `${own?.symbol ?? "TOKEN"}/${other?.symbol ?? "?"}`,
      poolAddress: pool.pairAddress ?? null,
      chartUrl: safeUrl(pool.url),
      volume24hUsd: finiteOrNull(pool.volume?.h24),
      liquidityUsd: finiteOrNull(pool.liquidity?.usd),
      depthUpUsd: depthOk ? finiteOrNull(ticker?.cost_to_move_up_usd) : null,
      depthDownUsd: depthOk ? finiteOrNull(ticker?.cost_to_move_down_usd) : null,
      ...(ticker && !depthOk ? { depthNote: `depth withheld: CoinGecko flags this ticker as ${ticker.is_anomaly ? "anomalous" : "stale"}` } : {}),
      secondary,
    };
  });

  for (const ticker of cexTickers.filter((candidate) => !flagged(candidate)).slice(0, 10)) {
    rows.push({
      key: `cex:${ticker.market?.identifier ?? ticker.market?.name}:${ticker.target}`,
      venue: ticker.market?.name ?? "Exchange",
      venueUrl: safeUrl(ticker.trade_url),
      type: "CEX",
      pair: `${ticker.base ?? "TOKEN"}/${ticker.target ?? "?"}`.replace(/^0X[0-9A-F]{40}/i, "TOKEN"),
      poolAddress: null,
      chartUrl: null,
      volume24hUsd: finiteOrNull(ticker.converted_volume?.usd),
      liquidityUsd: null,
      depthUpUsd: finiteOrNull(ticker.cost_to_move_up_usd),
      depthDownUsd: finiteOrNull(ticker.cost_to_move_down_usd),
      secondary: false,
    });
  }
  return rows;
}

export async function fetchVenueSnapshot(input: {
  chain: string;
  address: string;
  coingeckoId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<VenueSnapshot | null> {
  const request = (url: string) => retryFetchWithFreshTimeout(url, 9_000, {}, 2, input.fetchImpl ?? fetch);
  const chain = input.chain.trim().toLowerCase();
  const dexSourceUrl = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(input.address)}`;
  const [poolsResult, tickersResult] = await Promise.allSettled([
    request(dexSourceUrl).then(async (response) => (response.ok ? (await response.json()) as unknown : null)),
    input.coingeckoId
      ? request(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(input.coingeckoId)}/tickers?depth=true`)
        .then(async (response) => (response.ok ? (await response.json()) as { tickers?: CoinGeckoTickerRow[] } : null))
      : Promise.resolve(null),
  ]);
  const pools = poolsResult.status === "fulfilled" && Array.isArray(poolsResult.value) ? poolsResult.value as DexScreenerPool[] : null;
  const tickers = tickersResult.status === "fulfilled" && tickersResult.value && Array.isArray(tickersResult.value.tickers)
    ? tickersResult.value.tickers
    : null;
  if (!pools && !tickers) return null;
  return {
    capturedAt: new Date().toISOString(),
    rows: mergeVenues(input.address, pools ?? [], tickers ?? []),
    cexChecked: Boolean(tickers),
    dexSourceUrl,
    coingeckoUrl: input.coingeckoId ? `https://www.coingecko.com/en/coins/${encodeURIComponent(input.coingeckoId)}#markets` : null,
  };
}
