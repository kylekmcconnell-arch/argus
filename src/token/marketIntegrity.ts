// Shared guards for market figures that DexScreener sometimes returns in the
// wrong unit, under the wrong field, or for a venue id that is actually a
// contract address. Presentation and scoring both fail closed: an unusable
// number is unmeasured, never a headline.

/** Larger than any plausible crypto circulating cap or FDV (BTC is far below this). */
export const MAX_PLAUSIBLE_USD = 20_000_000_000_000;

export function finiteUsd(value: unknown, allowZero = false): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && (allowZero ? value >= 0 : value > 0)
    && value <= MAX_PLAUSIBLE_USD;
}

export function looksLikeAddress(value: string | undefined | null): boolean {
  const raw = (value ?? "").trim();
  if (/^0x[a-f0-9]{40}$/i.test(raw)) return true;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw);
}

const VENUE_NAMES: Record<string, string> = {
  uniswap: "Uniswap",
  uniswapv2: "Uniswap",
  uniswapv3: "Uniswap",
  uniswapv4: "Uniswap",
  pancakeswap: "PancakeSwap",
  pancakeswapv2: "PancakeSwap",
  pancakeswapv3: "PancakeSwap",
  sushiswap: "SushiSwap",
  raydium: "Raydium",
  orca: "Orca",
  meteora: "Meteora",
  pumpswap: "PumpSwap",
  pumpfun: "Pump.fun",
  aerodrome: "Aerodrome",
  curve: "Curve",
  balancer: "Balancer",
};

export function marketVenueName(dexId: string | undefined, labels: string[] = []): string {
  const labelled = labels.find((label) => label && !looksLikeAddress(label) && !/^\d+$/.test(label));
  const raw = (dexId ?? "").trim();
  if (!raw || raw === "unlisted" || looksLikeAddress(raw)) {
    return labelled ? (VENUE_NAMES[labelled.toLowerCase().replace(/[\s_-]/g, "")] ?? labelled) : "this pool";
  }
  const key = raw.toLowerCase().replace(/[\s_-]/g, "");
  return VENUE_NAMES[key] ?? raw;
}

export function poolIdentityTag(symbol: string | undefined, quote: string | undefined, venue: string): string {
  const base = (symbol ?? "").trim();
  const quoteSymbol = (quote ?? "").trim();
  if (base && quoteSymbol) {
    return venue === "this pool" ? ` (${base}/${quoteSymbol} pool)` : ` (${base}/${quoteSymbol} on ${venue})`;
  }
  if (venue && venue !== "this pool") return ` (${venue})`;
  return "";
}

export interface MarketValuation {
  marketCap: number | undefined;
  fdv: number | undefined;
  marketCapSource: "coingecko" | "dexscreener" | null;
  fdvSource: "coingecko" | "dexscreener" | null;
  discardedPairMarketCap: boolean;
  discardedPairFdv: boolean;
}

const wildDisagreement = (a: number, b: number): boolean => Math.max(a, b) / Math.min(a, b) >= 10;

export function resolveMarketValuation(input: {
  pairMarketCap?: number;
  pairFdv?: number;
  geckoMcap?: number | null;
  geckoFdv?: number | null;
}): MarketValuation {
  const gecko = finiteUsd(input.geckoMcap) ? input.geckoMcap : undefined;
  const geckoFdv = finiteUsd(input.geckoFdv) ? input.geckoFdv : undefined;
  const pairMcap = finiteUsd(input.pairMarketCap) ? input.pairMarketCap : undefined;
  const pairFdv = finiteUsd(input.pairFdv) ? input.pairFdv : undefined;
  const discardedPairMarketCap = input.pairMarketCap != null
    && Number.isFinite(input.pairMarketCap)
    && (pairMcap == null || (gecko != null && wildDisagreement(pairMcap, gecko)));
  const discardedPairFdv = input.pairFdv != null && Number.isFinite(input.pairFdv) && pairFdv == null;

  let marketCap: number | undefined;
  let marketCapSource: MarketValuation["marketCapSource"] = null;
  if (gecko) {
    marketCap = gecko;
    marketCapSource = "coingecko";
  } else if (pairMcap) {
    marketCap = pairMcap;
    marketCapSource = "dexscreener";
  }

  let fdv: number | undefined;
  let fdvSource: MarketValuation["fdvSource"] = null;
  const usablePairFdv = pairFdv && (marketCap == null || pairFdv >= marketCap * 0.5) ? pairFdv : undefined;
  if (usablePairFdv && geckoFdv && !wildDisagreement(usablePairFdv, geckoFdv)) {
    fdv = geckoFdv;
    fdvSource = "coingecko";
  } else if (geckoFdv && (marketCap == null || geckoFdv >= marketCap * 0.5)) {
    fdv = geckoFdv;
    fdvSource = "coingecko";
  } else if (usablePairFdv) {
    fdv = usablePairFdv;
    fdvSource = "dexscreener";
  }

  return {
    marketCap,
    fdv,
    marketCapSource,
    fdvSource,
    discardedPairMarketCap,
    discardedPairFdv,
  };
}

export function poolTapeUsable(input: {
  volumeUsd: number;
  buys: number;
  sells: number;
  liquidityUsd: number;
}): boolean {
  const { volumeUsd, buys, sells, liquidityUsd } = input;
  if (![volumeUsd, buys, sells, liquidityUsd].every((value) => Number.isFinite(value) && value >= 0)) return false;
  const trades = buys + sells;
  if (trades === 0) return volumeUsd <= 0;
  if (volumeUsd <= 0) return false;
  const averageTrade = volumeUsd / trades;
  // v3/v4 feeds often report millions of volume with a handful of swaps. Those
  // counts are not an authenticity signal and must not appear as "1 buys".
  if (trades < 8 && volumeUsd >= 50_000) return false;
  if (liquidityUsd > 0 && averageTrade > liquidityUsd) return false;
  return true;
}
