import { deadlineFetch } from "../providerDeadline.js";
// Stock-health adapter: when a company's applicable market instrument is a
// stock rather than a token, ARGUS assesses the stock's own health — penny
// stocks through mega-caps — instead of scoring token metrics that cannot
// exist. This reads one year of daily closes for a listing that was ALREADY
// verified against the SEC ticker/exchange registry, computes deterministic
// health facts (52-week position, trend, drawdown, volatility, penny-stock
// standing), and freezes them as a score-neutral point-in-time snapshot.
//
// Identity doctrine: the ticker alone is never the join. The read is anchored
// to the verified registry fact, and the market feed's own record must agree
// before anything is frozen: the instrument must be an equity, and the feed's
// issuer name or exchange must corroborate the registry's. A disagreement is
// an identity mismatch, never "close enough". Outages are "unavailable",
// never a judgment about the stock.
import { recordCall } from "../cost";
import { captureTimestamp } from "../captureTime";
import type { StockHealthSnapshot } from "../../src/data/evidence";

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT = "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)";

export interface VerifiedListing {
  ticker: string;
  issuer: string;
  exchange: string | null;
  registryFactId: string;
  registrySourceUrl: string;
}

export type StockHealthOutcome =
  | { available: true; value: StockHealthSnapshot }
  | { available: false; reason: "no_data" | "identity_mismatch" | "unavailable"; note: string };

type ChartMeta = {
  symbol?: unknown;
  currency?: unknown;
  fullExchangeName?: unknown;
  exchangeName?: unknown;
  longName?: unknown;
  instrumentType?: unknown;
  regularMarketPrice?: unknown;
  fiftyTwoWeekHigh?: unknown;
  fiftyTwoWeekLow?: unknown;
};

type ChartBody = {
  chart?: {
    result?: Array<{
      meta?: ChartMeta;
      timestamp?: unknown;
      indicators?: { quote?: Array<{ close?: unknown }> };
    }> | null;
    error?: { code?: unknown; description?: unknown } | null;
  };
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Legal-suffix noise shared with the SEC registry matcher's intent. */
const LEGAL_SUFFIX_TOKENS = new Set([
  "co", "company", "corp", "corporation", "inc", "incorporated", "limited", "llc", "ltd", "plc", "the",
]);

const identityTokens = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !LEGAL_SUFFIX_TOKENS.has(token));

/**
 * The feed's issuer name corroborates the registry issuer when one side's
 * meaningful tokens all appear in the other's ("Apple" vs "Apple Inc.",
 * "Coinbase Global" vs "Coinbase Global, Inc."). Empty token sets never agree.
 */
export function issuerNamesAgree(registryIssuer: string, feedLongName: string): boolean {
  const registry = identityTokens(registryIssuer);
  const feed = identityTokens(feedLongName);
  if (!registry.length || !feed.length) return false;
  const contains = (outer: string[], inner: string[]) => inner.every((token) => outer.includes(token));
  return contains(feed, registry) || contains(registry, feed);
}

const exchangesAgree = (registryExchange: string | null, feedExchange: string | null): boolean => {
  if (!registryExchange || !feedExchange) return false;
  const registry = registryExchange.toLowerCase();
  const feed = feedExchange.toLowerCase();
  if (registry.includes("nasdaq")) return feed.includes("nasdaq");
  if (registry.includes("nyse")) return feed.includes("nyse") || feed.includes("new york stock exchange");
  return false;
};

const pctChange = (from: number | undefined, to: number | undefined): number | null =>
  from && to && from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : null;

/** Deterministic health facts from a daily close series (oldest first). */
export function computeSeriesHealth(points: Array<{ date: string; close: number }>): {
  change30dPct: number | null;
  change90dPct: number | null;
  change1yPct: number | null;
  maxDrawdown1yPct: number | null;
  annualizedVolatilityPct: number | null;
  trend: Array<{ date: string; close: number }>;
} {
  const closes = points.map((point) => point.close);
  const last = closes[closes.length - 1];
  // Trading-day offsets: ~21 per month, ~63 per quarter.
  const at = (fromEnd: number) => (closes.length > fromEnd ? closes[closes.length - 1 - fromEnd] : undefined);
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (close - peak) / peak);
  }
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const annualizedVolatilityPct = returns.length > 20
    ? Math.round(Math.sqrt(variance) * Math.sqrt(252) * 1000) / 10
    : null;
  // Weekly downsample: every 5th trading day, always keeping the latest close.
  const trend: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < points.length; i += 5) trend.push(points[i]);
  if (trend[trend.length - 1] !== points[points.length - 1]) trend.push(points[points.length - 1]);
  return {
    change30dPct: pctChange(at(21), last),
    change90dPct: pctChange(at(63), last),
    change1yPct: closes.length >= 200 ? pctChange(closes[0], last) : null,
    maxDrawdown1yPct: maxDrawdown < 0 ? Math.round(maxDrawdown * 1000) / 10 : 0,
    annualizedVolatilityPct,
    trend,
  };
}

/**
 * Read one year of daily market data for a registry-verified listing and
 * freeze the health snapshot. Never throws; distinguishes "the feed does not
 * know this listing" and "the feed's record disagrees with the verified
 * identity" from a plain outage.
 */
export async function collectStockHealth(
  listing: VerifiedListing,
  options: { fetcher?: typeof fetch } = {},
): Promise<StockHealthOutcome> {
  const fetcher = options.fetcher ?? deadlineFetch;
  const ticker = listing.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    return { available: false, reason: "no_data", note: `"${listing.ticker}" is not a market-feed-safe ticker.` };
  }
  const sourceUrl = `${CHART_BASE}/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  let body: ChartBody;
  try {
    const response = await fetcher(sourceUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(9_000),
    });
    if (response.status === 404) {
      recordCall("market-feed", "stock-health", 0, `${ticker} · not_found`, "succeeded");
      return { available: false, reason: "no_data", note: `The market feed has no listing for ${ticker}.` };
    }
    if (!response.ok) {
      recordCall("market-feed", "stock-health", 0, `${ticker} · http_${response.status}`, "failed");
      return { available: false, reason: "unavailable", note: `The market feed answered HTTP ${response.status} for ${ticker}.` };
    }
    body = await response.json() as ChartBody;
  } catch (error) {
    recordCall("market-feed", "stock-health", 0, `${ticker} · error`, "failed");
    return { available: false, reason: "unavailable", note: `Market-feed read failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const result = body.chart?.result?.[0];
  if (!result?.meta) {
    const description = asString(body.chart?.error?.description);
    recordCall("market-feed", "stock-health", 0, `${ticker} · empty`, "succeeded");
    return { available: false, reason: "no_data", note: description ?? `The market feed returned no chart record for ${ticker}.` };
  }
  const meta = result.meta;
  const instrumentType = asString(meta.instrumentType);
  const feedLongName = asString(meta.longName);
  const feedExchange = asString(meta.fullExchangeName) ?? asString(meta.exchangeName);

  // Identity agreement, fail closed: the instrument must be an equity, and the
  // feed must corroborate the verified registry identity by issuer name or by
  // exchange. A ticker whose feed record is a fund, a crypto quote, or a
  // different company never becomes "the stock".
  if (instrumentType !== "EQUITY") {
    recordCall("market-feed", "stock-health", 0, `${ticker} · not_equity`, "succeeded");
    return {
      available: false,
      reason: "identity_mismatch",
      note: `The market feed's record for ${ticker} is ${instrumentType ?? "an unknown instrument type"}, not an equity.`,
    };
  }
  const nameAgrees = feedLongName ? issuerNamesAgree(listing.issuer, feedLongName) : false;
  const exchangeAgrees = exchangesAgree(listing.exchange, feedExchange);
  if (!nameAgrees && !exchangeAgrees) {
    recordCall("market-feed", "stock-health", 0, `${ticker} · identity_mismatch`, "succeeded");
    return {
      available: false,
      reason: "identity_mismatch",
      note: `The market feed's record for ${ticker} (${feedLongName ?? "no issuer name"}, ${feedExchange ?? "no exchange"}) does not corroborate the verified listing ${listing.issuer} (${listing.exchange ?? "exchange unknown"}).`,
    };
  }

  const price = asNumber(meta.regularMarketPrice);
  if (price === null || price <= 0) {
    recordCall("market-feed", "stock-health", 0, `${ticker} · no_price`, "succeeded");
    return { available: false, reason: "no_data", note: `The market feed carries no current price for ${ticker}.` };
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const rawCloses = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators!.quote![0].close as unknown[] : [];
  const points: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < rawCloses.length; i += 1) {
    const close = asNumber(rawCloses[i]);
    const stamp = asNumber(timestamps[i]);
    if (close === null || close <= 0 || stamp === null) continue;
    points.push({ date: new Date(stamp * 1000).toISOString().slice(0, 10), close });
  }
  const series = computeSeriesHealth(points);

  const high = asNumber(meta.fiftyTwoWeekHigh);
  const low = asNumber(meta.fiftyTwoWeekLow);
  const fiftyTwoWeekPositionPct = high !== null && low !== null && high > low
    ? Math.round(((price - low) / (high - low)) * 100)
    : null;
  const currency = asString(meta.currency);

  recordCall("market-feed", "stock-health", 0, `${ticker} · ${points.length}_closes`, "succeeded");
  return {
    available: true,
    value: {
      mode: "point_in_time",
      scoringImpact: "none",
      ticker,
      issuer: listing.issuer,
      exchange: feedExchange ?? listing.exchange,
      currency,
      binding: {
        registryFactId: listing.registryFactId,
        registrySourceUrl: listing.registrySourceUrl,
        feedLongName,
        instrumentType,
      },
      price,
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekLow: low,
      fiftyTwoWeekPositionPct,
      ...series,
      pennyStock: currency === "USD" ? price < 5 : null,
      sourceUrl,
      capturedAt: captureTimestamp(),
    },
  };
}
