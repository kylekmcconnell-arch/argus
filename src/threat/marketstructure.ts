// Market structure read from raw OHLCV: where the trading ranges are, where
// volume has concentrated (volume profile: point of control + value area),
// whether volume is building or drying up, and which ranges look like
// accumulation vs distribution. Classification is mechanical: a range is a
// contiguous band of above-average volume bins; its character comes from
// close-position money flow (Chaikin A/D style) of the candles that closed
// inside it; fib retracement levels from the window's swing give confluence.
// Pure math, no fetching - the component feeds it candles from fetchOhlcv.
//
// Honesty rules follow priceHistory's: a candle whose high/low are missing or
// incoherent is a point at its close, and a missing volume column is
// unmeasured, not zero - it contributes nothing to the profile or the trend.

import type { Candle } from "../lib/priceHistory";

export interface ProfileBin {
  low: number;
  high: number;
  volume: number; // USD volume attributed to this price band
}

export type RangeKind = "accumulation" | "distribution" | "consolidation";

export interface RangeZone {
  low: number;
  high: number;
  poc: number;          // heaviest price inside the range (its own point of control)
  kind: RangeKind;
  volumeShare: number;  // 0..1 of total window volume traded in this band
  timeShare: number;    // 0..1 of candles that closed inside this band
  flowRatio: number;    // -1..1 net money flow / band volume (buyers vs sellers)
  fibHits: number[];    // fib ratios whose level lands inside this band
  active: boolean;      // last close sits inside this band
}

export interface FibLevel {
  ratio: number;
  price: number;
}

export interface StructureVolumeTrend {
  direction: "rising" | "falling" | "flat";
  changePct: number;      // recent avg vs prior avg, % (measured candles only)
  recentAvg: number;
  priorAvg: number;
  recentUpShare: number;  // 0..1 of recent measured volume on candles that closed up
  recentCount: number;    // candles in the "recent" window
}

export interface MarketStructure {
  priceLow: number;
  priceHigh: number;
  bins: ProfileBin[];
  pocPrice: number;                      // window-wide point of control
  valueArea: { low: number; high: number }; // 70% of volume around the POC
  ranges: RangeZone[];                   // sorted low -> high
  fib: { swingLow: number; swingHigh: number; direction: "up" | "down"; levels: FibLevel[] };
  volume: StructureVolumeTrend;
  lastClose: number;
  support: number | null;                // nearest volume shelf below the last close
  resistance: number | null;             // nearest volume shelf above the last close
}

const BIN_COUNT = 24;
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const VALUE_AREA_PCT = 0.7;
// A bin must beat the average to count as concentration; a merged band must
// carry a real share of the window's volume to be reported as a range.
const BIN_THRESHOLD = 1.0;
const MIN_RANGE_VOLUME_SHARE = 0.08;
const MAX_RANGES = 4;
const FLOW_THRESHOLD = 0.12;

// A candle's extremes count only when both are present and bracket its own
// close (priceHistory's coherence rule); otherwise it is a point at the close.
const isMeasured = (k: Candle): k is Candle & { high: number; low: number } =>
  k.high !== undefined && k.low !== undefined && k.high >= k.low && k.close <= k.high && k.close >= k.low;
const effHigh = (k: Candle) => (isMeasured(k) ? k.high : k.close);
const effLow = (k: Candle) => (isMeasured(k) ? k.low : k.close);

// Close-position money flow multiplier: +1 when the candle closed at its high
// (buyers absorbed everything offered), -1 at its low. A point candle falls
// back to its direction against the previous close.
function moneyFlowMult(k: Candle, prevClose: number | undefined): number {
  if (isMeasured(k) && k.high > k.low) return ((k.close - k.low) - (k.high - k.close)) / (k.high - k.low);
  if (prevClose === undefined) return 0;
  return k.close > prevClose ? 1 : k.close < prevClose ? -1 : 0;
}

function valueArea(bins: ProfileBin[], pocIndex: number, total: number): { low: number; high: number } {
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = bins[pocIndex].volume;
  while (acc < total * VALUE_AREA_PCT && (lo > 0 || hi < bins.length - 1)) {
    const below = lo > 0 ? bins[lo - 1].volume : -1;
    const above = hi < bins.length - 1 ? bins[hi + 1].volume : -1;
    if (above >= below) { hi += 1; acc += bins[hi].volume; }
    else { lo -= 1; acc += bins[lo].volume; }
  }
  return { low: bins[lo].low, high: bins[hi].high };
}

export function analyzeMarketStructure(candles: Candle[]): MarketStructure | null {
  const series = [...candles].sort((a, b) => a.ts - b.ts).filter((k) => k.close > 0);
  if (series.length < 12) return null;
  const priceLow = Math.min(...series.map(effLow));
  const priceHigh = Math.max(...series.map(effHigh));
  if (!(priceHigh > priceLow)) return null;
  const totalVol = series.reduce((s, k) => s + (k.volumeUsd ?? 0), 0);
  if (totalVol <= 0) return null;

  // Volume profile: spread each measured candle's volume across the price bins
  // its low..high range overlaps, proportional to overlap; a point candle's
  // volume lands in the bin holding its close.
  const step = (priceHigh - priceLow) / BIN_COUNT;
  const bins: ProfileBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    low: priceLow + i * step,
    high: priceLow + (i + 1) * step,
    volume: 0,
  }));
  const binOf = (p: number) => Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((p - priceLow) / step)));
  for (const k of series) {
    const v = k.volumeUsd ?? 0;
    if (v <= 0) continue;
    const h = effHigh(k);
    const l = effLow(k);
    if (h <= l) { bins[binOf(k.close)].volume += v; continue; }
    for (let i = binOf(l); i <= binOf(h); i++) {
      const overlap = Math.min(h, bins[i].high) - Math.max(l, bins[i].low);
      if (overlap > 0) bins[i].volume += v * (overlap / (h - l));
    }
  }
  let pocIndex = 0;
  for (let i = 1; i < BIN_COUNT; i++) if (bins[i].volume > bins[pocIndex].volume) pocIndex = i;
  const pocPrice = (bins[pocIndex].low + bins[pocIndex].high) / 2;
  const va = valueArea(bins, pocIndex, totalVol);

  // Fib retracement from the window's swing. Which extreme came first sets the
  // direction the retracement is measured against.
  const iLow = series.reduce((best, k, i) => (effLow(k) < effLow(series[best]) ? i : best), 0);
  const iHigh = series.reduce((best, k, i) => (effHigh(k) > effHigh(series[best]) ? i : best), 0);
  const direction: "up" | "down" = iLow <= iHigh ? "up" : "down";
  const span = priceHigh - priceLow;
  const levels: FibLevel[] = FIB_RATIOS.map((ratio) => ({
    ratio,
    // Up-move: 0 sits at the high and retracement walks down toward the low.
    // Down-move: 0 sits at the low and retracement walks back up.
    price: direction === "up" ? priceHigh - span * ratio : priceLow + span * ratio,
  }));

  // Trading ranges: merge contiguous above-average bins into bands.
  const avgBinVol = totalVol / BIN_COUNT;
  const bands: { from: number; to: number }[] = [];
  for (let i = 0; i < BIN_COUNT; i++) {
    if (bins[i].volume < avgBinVol * BIN_THRESHOLD) continue;
    const last = bands[bands.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else bands.push({ from: i, to: i });
  }
  const lastClose = series[series.length - 1].close;
  const retraceRatios = FIB_RATIOS.slice(1, -1);
  let ranges: RangeZone[] = bands.map((b) => {
    const low = bins[b.from].low;
    const high = bins[b.to].high;
    const bandVol = bins.slice(b.from, b.to + 1).reduce((s, x) => s + x.volume, 0);
    let bandPoc = b.from;
    for (let i = b.from + 1; i <= b.to; i++) if (bins[i].volume > bins[bandPoc].volume) bandPoc = i;
    let insideCount = 0;
    let insideVol = 0;
    let flow = 0;
    series.forEach((k, i) => {
      if (k.close < low || k.close > high) return;
      insideCount += 1;
      const v = k.volumeUsd ?? 0;
      insideVol += v;
      flow += moneyFlowMult(k, series[i - 1]?.close) * v;
    });
    const flowRatio = insideVol > 0 ? Math.max(-1, Math.min(1, flow / insideVol)) : 0;
    const kind: RangeKind =
      flowRatio >= FLOW_THRESHOLD ? "accumulation" : flowRatio <= -FLOW_THRESHOLD ? "distribution" : "consolidation";
    return {
      low,
      high,
      poc: (bins[bandPoc].low + bins[bandPoc].high) / 2,
      kind,
      volumeShare: bandVol / totalVol,
      timeShare: insideCount / series.length,
      flowRatio,
      fibHits: retraceRatios.filter((r) => {
        const p = levels.find((l) => l.ratio === r)!.price;
        return p >= low && p <= high;
      }),
      active: lastClose >= low && lastClose <= high,
    };
  });
  ranges = ranges
    .filter((r) => r.volumeShare >= MIN_RANGE_VOLUME_SHARE)
    .sort((a, b) => b.volumeShare - a.volumeShare)
    .slice(0, MAX_RANGES)
    .sort((a, b) => a.low - b.low);

  // Volume trend: the tail of the window against everything before it, averaged
  // over the candles that actually carried a volume column.
  const recentCount = Math.min(30, Math.max(5, Math.round(series.length * 0.2)));
  const recent = series.slice(-recentCount);
  const prior = series.slice(0, series.length - recentCount);
  const measuredAvg = (w: Candle[]) => {
    const m = w.filter((k) => k.volumeUsd !== undefined);
    return m.length ? m.reduce((s, k) => s + k.volumeUsd!, 0) / m.length : 0;
  };
  const recentAvg = measuredAvg(recent);
  const priorAvg = prior.length ? measuredAvg(prior) : recentAvg;
  const changePct = priorAvg > 0 ? (recentAvg / priorAvg - 1) * 100 : 0;
  let recentTotal = 0;
  let recentUp = 0;
  const offset = series.length - recent.length;
  recent.forEach((k, j) => {
    const v = k.volumeUsd ?? 0;
    recentTotal += v;
    const prevClose = series[offset + j - 1]?.close;
    if (prevClose !== undefined && k.close > prevClose) recentUp += v;
  });
  const volume: StructureVolumeTrend = {
    direction: changePct >= 25 ? "rising" : changePct <= -25 ? "falling" : "flat",
    changePct,
    recentAvg,
    priorAvg,
    recentUpShare: recentTotal > 0 ? recentUp / recentTotal : 0,
    recentCount,
  };

  // Nearest volume shelves around the last close: the practical support and
  // resistance the profile implies.
  const shelves = ranges.map((r) => r.poc);
  const below = shelves.filter((p) => p < lastClose);
  const above = shelves.filter((p) => p > lastClose);
  const support = below.length ? Math.max(...below) : lastClose > priceLow ? priceLow : null;
  const resistance = above.length ? Math.min(...above) : lastClose < priceHigh ? priceHigh : null;

  return {
    priceLow,
    priceHigh,
    bins,
    pocPrice,
    valueArea: va,
    ranges,
    fib: { swingLow: priceLow, swingHigh: priceHigh, direction, levels },
    volume,
    lastClose,
    support,
    resistance,
  };
}
