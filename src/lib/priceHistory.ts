// Token price history from GeckoTerminal's free API (no key). Powers the
// performance sparkline on token audits and, for a KOL, the outcome of each
// token they called (down how far from its peak). Read-only.
//
// A GeckoTerminal candle is [timestamp, open, high, low, close, volume]. Reading
// only the close cannot answer either question diligence actually asks: how far
// the price ran inside a period, and whether the market is still trading at all.
// A token that spiked 40x intraday and closed flat looks identical on closes to
// one that never moved. So the whole candle is read here, and this derivation is
// shared with server/adapters/projectToken.ts, which pulls the same endpoint for
// the frozen snapshot: one summary, worded one way, for both paths.

// DexScreener chainId -> GeckoTerminal network slug.
const NETWORK: Record<string, string> = {
  solana: "solana", ethereum: "eth", eth: "eth", bsc: "bsc", base: "base",
  arbitrum: "arbitrum", polygon: "polygon_pos", "polygon_pos": "polygon_pos",
  avalanche: "avax", avax: "avax", optimism: "optimism", fantom: "ftm",
  sui: "sui", ton: "ton", tron: "tron", blast: "blast", sei: "sei-evm",
};

/** Seconds in one candle, per timeframe we ask GeckoTerminal for. */
const PERIOD_SECONDS: Record<string, number> = { day: 86_400, hour: 3_600 };

/** Candles per side of the volume comparison, capped at a week of dailies. */
const VOLUME_WINDOW_MAX = 7;

/**
 * One OHLCV row, reduced to what is actually load-bearing. `high`, `low` and
 * `volumeUsd` are optional because a source that omits or garbles a column has
 * left it unmeasured, and unmeasured is not zero.
 */
export interface Candle {
  ts: number;
  close: number;
  high?: number;
  low?: number;
  volumeUsd?: number;
}

/**
 * The window's reported extremes. A candle's high is the highest price ONE
 * source recorded inside that single period: it is that period's high as
 * GeckoTerminal reported it, never a proven all-time high, and copy rendering
 * it must not claim otherwise.
 */
export interface CandleRange {
  /** Highest per-candle high in the window, as this source reported it. */
  high: number;
  /** Lowest per-candle low in the window, as this source reported it. */
  low: number;
  /** Latest close against `high`, % (<= 0). The fall from the intraday peak, not from a peak measured on closes. */
  drawdownFromHighPct: number;
  /** Candles whose high and low were present and bracketed their own close. The rest are unmeasured. */
  measuredPoints: number;
  /** Per-candle highs, index aligned with `points`. Present ONLY when every candle was measured. */
  highs?: number[];
  /** Per-candle lows, index aligned with `points`. Present ONLY when every candle was measured. */
  lows?: number[];
}

/** One side of the volume comparison. */
export interface VolumeWindow {
  /** Volume reported across the measured candles here. A FLOOR whenever `measured` is below `candles`. */
  usd: number;
  /** Candles in the window. */
  candles: number;
  /** Candles that carried a volume column; the remainder are unmeasured, not zero. */
  measured: number;
}

/**
 * Recent traded volume against the window immediately before it, so a market
 * that went quiet can say so. Both windows name their own width, because "down
 * 84%" means nothing without the span it is measured over.
 */
export interface VolumeTrend {
  recent: VolumeWindow;
  prior: VolumeWindow;
  /** `recent` against `prior`, %. */
  changePct: number;
  /** A candle in either window reported no volume, so at least one sum is a floor and the change is approximate. */
  isFloor: boolean;
}

/** Everything derivable from a candle window alone, with no fetch context. */
export interface CandleSummary {
  points: number[];      // close prices, oldest -> newest
  first: number;         // oldest close in the window
  last: number;          // current-ish close
  peak: number;          // max CLOSE in the window (see `range.high` for the reported intraday peak)
  changePct: number;     // last vs first, %
  drawdownPct: number;   // last vs peak close, % (<= 0)
  /** Reported intra-period extremes, when the source carried high and low columns. */
  range?: CandleRange;
  /** Reported volume, recent window against the one before it. */
  volume?: VolumeTrend;
  /** Periods the returned candles span end to end, when the timestamps sit on the requested cadence. */
  spanPeriods?: number;
  /** True when candles are missing inside that span: the series is a partial read of its own window. */
  windowIsPartial?: boolean;
}

export interface PriceHistory extends CandleSummary {
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse one OHLCV row. Only the timestamp and the close are required: a row
 * that omits or garbles its high, low or volume still carries a real close, and
 * dropping the whole row would silently shorten the window we then report on.
 * The missing columns stay undefined so nothing downstream can read them as a
 * measured zero.
 */
export function readCandle(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const ts = finiteNumber(row[0]);
  const close = finiteNumber(row[4]);
  if (ts === undefined || close === undefined) return null;
  const high = finiteNumber(row[2]);
  const low = finiteNumber(row[3]);
  const volumeUsd = finiteNumber(row[5]);
  return {
    ts,
    close,
    ...(high === undefined ? {} : { high }),
    ...(low === undefined ? {} : { low }),
    ...(volumeUsd === undefined || volumeUsd < 0 ? {} : { volumeUsd }),
  };
}

/**
 * The window's reported extremes. A candle only counts when its high and low
 * bracket its own close: an incoherent row is unmeasured, not a new record. The
 * per-candle arrays ship only when EVERY candle was measured, because a band
 * drawn across a hole would invent prices that were never reported.
 */
function candleRange(series: Candle[], last: number): { range?: CandleRange } {
  const measured = series.filter((candle): candle is Candle & { high: number; low: number } =>
    candle.high !== undefined
    && candle.low !== undefined
    && candle.low > 0
    && candle.low <= candle.close
    && candle.high >= candle.close);
  if (!measured.length) return {};
  const high = Math.max(...measured.map((candle) => candle.high));
  const low = Math.min(...measured.map((candle) => candle.low));
  return {
    range: {
      high,
      low,
      drawdownFromHighPct: high > 0 ? ((last - high) / high) * 100 : 0,
      measuredPoints: measured.length,
      ...(measured.length === series.length ? {
        highs: measured.map((candle) => candle.high),
        lows: measured.map((candle) => candle.low),
      } : {}),
    },
  };
}

function volumeWindow(candles: Candle[]): VolumeWindow {
  const measured = candles.filter((candle): candle is Candle & { volumeUsd: number } => candle.volumeUsd !== undefined);
  return {
    usd: measured.reduce((total, candle) => total + candle.volumeUsd, 0),
    candles: candles.length,
    measured: measured.length,
  };
}

/**
 * Recent volume against the window before it. Silent when either side carried
 * no volume column at all, because an unmeasured window is a gap in the feed
 * and must never be presented as a market that stopped trading.
 */
function volumeTrend(series: Candle[]): { volume?: VolumeTrend } {
  const width = Math.min(VOLUME_WINDOW_MAX, Math.floor(series.length / 2));
  if (width < 2) return {};
  const recent = volumeWindow(series.slice(series.length - width));
  const prior = volumeWindow(series.slice(series.length - width * 2, series.length - width));
  if (!recent.measured || !prior.measured || prior.usd <= 0) return {};
  return {
    volume: {
      recent,
      prior,
      changePct: ((recent.usd - prior.usd) / prior.usd) * 100,
      isFloor: recent.measured < recent.candles || prior.measured < prior.candles,
    },
  };
}

/**
 * How many periods the returned candles actually span, so a series with holes
 * can say it is a partial read of its own window instead of passing 74 candles
 * off as 74 consecutive days. Silent when the timestamps do not sit on the
 * cadence we asked for: a span we cannot count is not a span we can report.
 */
function windowShape(
  series: Candle[],
  count: number,
  timeframe: string,
): { spanPeriods?: number; windowIsPartial?: boolean } {
  const period = PERIOD_SECONDS[timeframe];
  const span = series[series.length - 1].ts - series[0].ts;
  if (!period || span <= 0) return {};
  const spanPeriods = Math.round(span / period) + 1;
  if (spanPeriods < count) return {};
  return { spanPeriods, windowIsPartial: count < spanPeriods };
}

/**
 * Reduce a candle window to the summary both the live sparkline and the frozen
 * project-token snapshot publish. Sorts oldest to newest and drops candles with
 * no usable close; every other honesty rule lives in the helpers above.
 */
export function summarizeCandles(candles: Candle[], timeframe: string): CandleSummary | null {
  const series = [...candles]
    .sort((left, right) => left.ts - right.ts)
    .filter((candle) => candle.close > 0);
  if (!series.length) return null;
  const points = series.map((candle) => candle.close);
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
    ...candleRange(series, last),
    ...volumeTrend(series),
    ...windowShape(series, points.length, timeframe),
  };
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
    const candles = Array.isArray(rawList)
      ? rawList.map(readCandle).filter((candle): candle is Candle => candle !== null)
      : [];
    if (candles.length < 3) continue;
    const summary = summarizeCandles(candles, timeframe);
    if (!summary || summary.points.length < 3) continue;
    return { ...summary, timeframe, capturedAt: new Date().toISOString() };
  }
  return null;
}

/**
 * Raw candle window for the market-structure read: the same endpoint and row
 * parse as fetchPriceHistory, returning the candles themselves instead of a
 * summary. Pass a timeframe to force it; otherwise daily candles with an
 * hourly fallback for young tokens that have no daily data yet.
 */
export interface OhlcvWindow {
  candles: Candle[];     // oldest -> newest, closes > 0
  timeframe: "day" | "hour";
}

export async function fetchOhlcv(
  address: string,
  chain: string,
  pairAddress?: string,
  timeframe?: "day" | "hour",
): Promise<OhlcvWindow | null> {
  const network = NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !address) return null;
  const pool = pairAddress || (await topPool(network, address));
  if (!pool) return null;

  for (const tf of timeframe ? [timeframe] : (["day", "hour"] as const)) {
    const d = await gt(`/networks/${network}/pools/${pool}/ohlcv/${tf}?aggregate=1&limit=200&currency=usd`);
    const rawList = record(record(record(d).data).attributes).ohlcv_list;
    const candles = (Array.isArray(rawList)
      ? rawList.map(readCandle).filter((candle): candle is Candle => candle !== null)
      : [])
      .filter((candle) => candle.close > 0)
      .sort((left, right) => left.ts - right.ts);
    if (candles.length < 3) continue;
    return { candles, timeframe: tf };
  }
  return null;
}
