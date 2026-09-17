import { deadlineFetch } from "../providerDeadline.js";
// Stock-health adapter: when a company's applicable market instrument is a
// stock rather than a token, ARGUS assesses the stock's own health — penny
// stocks through mega-caps — instead of scoring token metrics that cannot
// exist. This reads one year of daily closes for a listing that was ALREADY
// verified against the SEC ticker/exchange registry, computes deterministic
// health facts (52-week position, trend, drawdown, volatility, penny-stock
// standing), and freezes them as a score-neutral point-in-time snapshot.
//
// The same equity reader powers the tokenized-stock pairing lane: tokens that
// ARE tokenized stocks (xStocks AAPLx, Dinari AAPL.d, Backed bXXXX) and tokens
// PAIRED against tokenized stocks (StonkBroker-class venues, Robinhood-chain
// stock tokens) get the underlying stock's health attached to the assessment.
//
// Identity doctrine: a ticker alone is never the join. The registry path
// anchors to the verified SEC fact and requires the feed's own issuer name or
// exchange to agree. The tokenized path requires equity CONTEXT (a tokenized
// symbol pattern, tokenized-stock language in the token's own name, or a
// native stock-token chain) plus the feed's agreement with whatever issuer
// name the token itself declares. Disagreements are identity mismatches,
// never "close enough". Outages are "unavailable", never a judgment.
import { recordCall } from "../cost";
import { captureTimestamp } from "../captureTime";
import type { StockHealthSnapshot, TokenizedStockPairingSnapshot } from "../../src/data/evidence";

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
 * The feed's issuer name corroborates the claimed issuer when one side's
 * meaningful tokens all appear in the other's ("Apple" vs "Apple Inc.",
 * "Coinbase Global" vs "Coinbase Global, Inc."). Empty token sets never agree.
 */
export function issuerNamesAgree(claimedIssuer: string, feedLongName: string): boolean {
  const claimed = identityTokens(claimedIssuer);
  const feed = identityTokens(feedLongName);
  if (!claimed.length || !feed.length) return false;
  const contains = (outer: string[], inner: string[]) => inner.every((token) => outer.includes(token));
  return contains(feed, claimed) || contains(claimed, feed);
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

export interface EquityRecord {
  ticker: string;
  currency: string | null;
  exchange: string | null;
  feedLongName: string | null;
  instrumentType: string | null;
  price: number;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekPositionPct: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  change1yPct: number | null;
  maxDrawdown1yPct: number | null;
  annualizedVolatilityPct: number | null;
  pennyStock: boolean | null;
  trend: Array<{ date: string; close: number }>;
  sourceUrl: string;
}

export type EquityReadOutcome =
  | { ok: true; record: EquityRecord }
  | { ok: false; reason: "no_data" | "unavailable"; note: string };

/**
 * One bounded market-feed read: a year of daily closes plus the feed's own
 * identity fields. Callers apply their identity gates on top; this function
 * only distinguishes "no listing" from an outage and never throws.
 */
export async function readEquityRecord(
  ticker: string,
  fetcher: typeof fetch = deadlineFetch,
): Promise<EquityReadOutcome> {
  const clean = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(clean)) {
    return { ok: false, reason: "no_data", note: `"${ticker}" is not a market-feed-safe ticker.` };
  }
  const sourceUrl = `${CHART_BASE}/${encodeURIComponent(clean)}?range=1y&interval=1d`;
  let body: ChartBody;
  try {
    const response = await fetcher(sourceUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(9_000),
    });
    if (response.status === 404) {
      recordCall("market-feed", "equity-read", 0, `${clean} · not_found`, "succeeded");
      return { ok: false, reason: "no_data", note: `The market feed has no listing for ${clean}.` };
    }
    if (!response.ok) {
      recordCall("market-feed", "equity-read", 0, `${clean} · http_${response.status}`, "failed");
      return { ok: false, reason: "unavailable", note: `The market feed answered HTTP ${response.status} for ${clean}.` };
    }
    body = await response.json() as ChartBody;
  } catch (error) {
    recordCall("market-feed", "equity-read", 0, `${clean} · error`, "failed");
    return { ok: false, reason: "unavailable", note: `Market-feed read failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const result = body.chart?.result?.[0];
  if (!result?.meta) {
    const description = asString(body.chart?.error?.description);
    recordCall("market-feed", "equity-read", 0, `${clean} · empty`, "succeeded");
    return { ok: false, reason: "no_data", note: description ?? `The market feed returned no chart record for ${clean}.` };
  }
  const meta = result.meta;
  const price = asNumber(meta.regularMarketPrice);
  if (price === null || price <= 0) {
    recordCall("market-feed", "equity-read", 0, `${clean} · no_price`, "succeeded");
    return { ok: false, reason: "no_data", note: `The market feed carries no current price for ${clean}.` };
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
  const currency = asString(meta.currency);
  recordCall("market-feed", "equity-read", 0, `${clean} · ${points.length}_closes`, "succeeded");
  return {
    ok: true,
    record: {
      ticker: clean,
      currency,
      exchange: asString(meta.fullExchangeName) ?? asString(meta.exchangeName),
      feedLongName: asString(meta.longName),
      instrumentType: asString(meta.instrumentType),
      price,
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekLow: low,
      fiftyTwoWeekPositionPct: high !== null && low !== null && high > low
        ? Math.round(((price - low) / (high - low)) * 100)
        : null,
      ...series,
      pennyStock: currency === "USD" ? price < 5 : null,
      sourceUrl,
    },
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
  const read = await readEquityRecord(listing.ticker, options.fetcher ?? deadlineFetch);
  if (!read.ok) return { available: false, reason: read.reason, note: read.note };
  const record = read.record;

  // Identity agreement, fail closed: the instrument must be an equity, and the
  // feed must corroborate the verified registry identity by issuer name or by
  // exchange. A ticker whose feed record is a fund, a crypto quote, or a
  // different company never becomes "the stock".
  if (record.instrumentType !== "EQUITY") {
    return {
      available: false,
      reason: "identity_mismatch",
      note: `The market feed's record for ${record.ticker} is ${record.instrumentType ?? "an unknown instrument type"}, not an equity.`,
    };
  }
  const nameAgrees = record.feedLongName ? issuerNamesAgree(listing.issuer, record.feedLongName) : false;
  const exchangeAgrees = exchangesAgree(listing.exchange, record.exchange);
  if (!nameAgrees && !exchangeAgrees) {
    return {
      available: false,
      reason: "identity_mismatch",
      note: `The market feed's record for ${record.ticker} (${record.feedLongName ?? "no issuer name"}, ${record.exchange ?? "no exchange"}) does not corroborate the verified listing ${listing.issuer} (${listing.exchange ?? "exchange unknown"}).`,
    };
  }

  const { sourceUrl, instrumentType, feedLongName, ...health } = record;
  return {
    available: true,
    value: {
      mode: "point_in_time",
      scoringImpact: "none",
      ...health,
      exchange: record.exchange ?? listing.exchange,
      issuer: listing.issuer,
      binding: {
        registryFactId: listing.registryFactId,
        registrySourceUrl: listing.registrySourceUrl,
        feedLongName,
        instrumentType,
      },
      sourceUrl,
      capturedAt: captureTimestamp(),
    },
  };
}

// ── Tokenized-stock pairing ─────────────────────────────────────────────────

/** First-party language that marks a token as a tokenized stock. */
const TOKENIZED_STOCK_NAME = /\b(?:xstocks?|dshares?|dinari|backed finance|tokeni[sz]ed (?:stock|share|equit\w*)|(?:stock|equity) token)\b/i;

/** Issuer-name noise from tokenized-stock product naming. */
const TOKENIZED_NAME_NOISE = new Set([
  "xstock", "xstocks", "dshare", "dshares", "dinari", "backed", "finance",
  "tokenized", "tokenised", "stock", "stocks", "share", "shares", "equity",
  "token", "tokens", "wrapped", "onchain", "on", "chain",
]);

export interface UnderlyingCandidate {
  ticker: string;
  pattern: "xstocks" | "dinari" | "backed" | "bare";
}

/** Pure symbol-shape read; a bare ticker candidate carries no context by itself. */
export function underlyingTickerCandidate(symbol: string): UnderlyingCandidate | null {
  const clean = symbol.trim();
  const xstocks = clean.match(/^([A-Z]{1,6})[xX]$/);
  if (xstocks) return { ticker: xstocks[1], pattern: "xstocks" };
  const dinari = clean.match(/^([A-Z]{1,6})\.[dD]$/);
  if (dinari) return { ticker: dinari[1], pattern: "dinari" };
  const backed = clean.match(/^b([A-Z]{2,6})$/);
  if (backed) return { ticker: backed[1], pattern: "backed" };
  if (/^[A-Z]{1,5}$/.test(clean)) return { ticker: clean, pattern: "bare" };
  return null;
}

/** Chains whose native stock tokens carry the bare listed ticker as symbol. */
const NATIVE_STOCK_TOKEN_CHAINS = new Set(["robinhood"]);

export interface TokenizedStockSide {
  symbol: string;
  name: string | null;
  chain: string | null;
}

export type UnderlyingResolution =
  | { resolved: true; record: EquityRecord; basis: string[] }
  | { resolved: false; reason: "not_tokenized_stock" | "no_data" | "identity_mismatch" | "unavailable"; note: string };

/**
 * Resolve a token surface (the scanned token itself, or the token its pool
 * quotes in) to the listed stock underneath it. Fails closed: without equity
 * context (a tokenized symbol pattern, tokenized-stock language in the name,
 * or a native stock-token chain) an ordinary crypto ticker that happens to
 * collide with a stock symbol is never treated as stock exposure.
 */
export async function resolveTokenizedStockUnderlying(
  side: TokenizedStockSide,
  options: { fetcher?: typeof fetch } = {},
): Promise<UnderlyingResolution> {
  const candidate = underlyingTickerCandidate(side.symbol.trim().toUpperCase());
  const nameContext = Boolean(side.name && TOKENIZED_STOCK_NAME.test(side.name));
  const chainContext = Boolean(side.chain && NATIVE_STOCK_TOKEN_CHAINS.has(side.chain.trim().toLowerCase()));
  const patternContext = candidate !== null && candidate.pattern !== "bare";
  if (!candidate || (!patternContext && !nameContext && !chainContext)) {
    return {
      resolved: false,
      reason: "not_tokenized_stock",
      note: `"${side.symbol}" carries no tokenized-stock context (no tokenized symbol pattern, no tokenized-stock language in its name, and not a native stock-token chain).`,
    };
  }

  const read = await readEquityRecord(candidate.ticker, options.fetcher ?? deadlineFetch);
  if (!read.ok) return { resolved: false, reason: read.reason, note: read.note };
  const record = read.record;
  if (record.instrumentType !== "EQUITY") {
    return {
      resolved: false,
      reason: "identity_mismatch",
      note: `The market feed's record for ${candidate.ticker} is ${record.instrumentType ?? "an unknown instrument type"}, not an equity.`,
    };
  }

  const basis: string[] = [];
  const declaredIssuer = side.name
    ? side.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2 && !TOKENIZED_NAME_NOISE.has(token))
        .join(" ")
    : "";
  if (declaredIssuer) {
    // The token names its own issuer; that claim must be fully explained by
    // the feed's authoritative name. Direction matters: two-way overlap would
    // let "Definitely Not Apple" agree with "Apple Inc.".
    const claimedTokens = identityTokens(declaredIssuer);
    const feedTokens = record.feedLongName ? identityTokens(record.feedLongName) : [];
    const claimExplained = claimedTokens.length > 0
      && feedTokens.length > 0
      && claimedTokens.every((token) => feedTokens.includes(token));
    if (!claimExplained) {
      return {
        resolved: false,
        reason: "identity_mismatch",
        note: `The token's own name points at "${declaredIssuer}", but the market feed's ${candidate.ticker} record is ${record.feedLongName ?? "unnamed"}; the underlying was not resolved.`,
      };
    }
    basis.push(`The token's own name declares the issuer and the market feed's ${candidate.ticker} record (${record.feedLongName}) agrees.`);
  } else if (patternContext) {
    basis.push(`The symbol follows the ${candidate.pattern === "xstocks" ? "xStocks" : candidate.pattern === "dinari" ? "Dinari dShares" : "Backed"} tokenized-stock pattern and the market feed confirms ${candidate.ticker} as a listed equity${record.feedLongName ? ` (${record.feedLongName})` : ""}.`);
  } else if (chainContext) {
    basis.push(`The pool lives on a native stock-token chain and the market feed confirms ${candidate.ticker} as a listed equity${record.feedLongName ? ` (${record.feedLongName})` : ""}.`);
  } else {
    // Bare symbol whose only context was tokenized-stock language in a name
    // that reduced to nothing identity-bearing: not enough to bind.
    return {
      resolved: false,
      reason: "identity_mismatch",
      note: `"${side.symbol}" reads as a tokenized stock but names no issuer, and neither a symbol pattern nor a native stock-token chain binds it to ${candidate.ticker}.`,
    };
  }
  return { resolved: true, record, basis };
}

/** Assemble the frozen pairing snapshot from a resolved underlying. */
export function tokenizedStockPairingSnapshot(
  exposure: TokenizedStockPairingSnapshot["exposure"],
  side: TokenizedStockSide,
  resolution: { record: EquityRecord; basis: string[] },
): TokenizedStockPairingSnapshot {
  const { record, basis } = resolution;
  return {
    mode: "point_in_time",
    scoringImpact: "none",
    exposure,
    tokenizedSymbol: side.symbol,
    tokenizedName: side.name,
    underlying: {
      ticker: record.ticker,
      feedLongName: record.feedLongName,
      exchange: record.exchange,
      currency: record.currency,
      price: record.price,
      fiftyTwoWeekPositionPct: record.fiftyTwoWeekPositionPct,
      change30dPct: record.change30dPct,
      change90dPct: record.change90dPct,
      change1yPct: record.change1yPct,
      maxDrawdown1yPct: record.maxDrawdown1yPct,
      annualizedVolatilityPct: record.annualizedVolatilityPct,
      pennyStock: record.pennyStock,
    },
    basis,
    sourceUrl: record.sourceUrl,
    capturedAt: captureTimestamp(),
  };
}
