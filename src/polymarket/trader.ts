// Polymarket's public API, read as one wallet's trading record.
//
// Every endpoint here answered on 2026-08-01 with no API key and no auth header,
// and that is the point: this lane checks a public claim against records the
// reader can pull themselves. Nothing below sends a credential, and if one of
// these ever starts demanding one the honest outcome is a failure sentence, not
// a quiet switch to some other source. ARGUS_PROVIDER_FALLBACKS is off by design
// (server/config.ts) and the rule holds inside a single provider too: /profit
// answers the profit question, /volume answers the volume question, and neither
// stands in for the other.
//
// Two shapes of dishonesty this module exists to refuse:
//   - Reading a number off the endpoint that happens to have one. See THE RANK
//     TRAP below, where the ranked metric is not the amount returned.
//   - Turning a missing answer into a zero. Every getter here returns null when
//     a source did not answer, and says so in one sentence.
//
// Callers that hold no wallet at all must not call this. An X handle does not
// resolve to a wallet by any public record, so a claim with no published address
// is not checkable as written, which is itself the finding. normalizeWalletInput
// is exported so a caller can reach that verdict without catching a throw.

import type { OpenPosition, PnlPoint, TraderRecord } from "./types";

const DATA_API = "https://data-api.polymarket.com";
const LB_API = "https://lb-api.polymarket.com";
const PNL_API = "https://user-pnl-api.polymarket.com";

/** Per-request ceiling. A slow source is a source that did not answer. */
const DEFAULT_TIMEOUT_MS = 9_000;

/**
 * Rows per activity page, per direction. The feed is fetched twice, ascending
 * for the start of the record and descending for the end, because one page
 * cannot hold both for a wallet with hundreds of markets: the subject verified
 * for these notes traded 592 of them. An ascending page always contains the true
 * first trade, so that end is exact whenever it answers. A descending page does
 * not, so when only the descending page survives, its earliest row is a page
 * boundary and the record's measured span is a floor: the wallet may have been
 * trading before it. That case sets activitySpanIsFloor, because a shorter
 * window makes profit-per-month look larger, and a reader must be able to see
 * that the window is a minimum rather than a measurement.
 */
export const ACTIVITY_ROW_CAP = 500;

/** Rows per positions request. A full page is a floor, never a total. */
export const POSITION_ROW_CAP = 500;

export const INVALID_INPUT_MESSAGE =
  "That is not a Polymarket wallet. Give a 0x address or a polymarket.com/profile link: a social handle does not resolve to a wallet by any public record, and a guessed one would be somebody else's trading history.";

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const PROFILE_PATH = /^\/profile\/(0x[0-9a-f]{40})\/?$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * A raw 0x address, or the profile link people actually paste out of a thread.
 * Null for everything else, and the caller finds out BEFORE any request goes
 * out. A profile link is only honoured on polymarket.com itself: an address
 * sitting in some other site's path was not published by Polymarket as this
 * trader's wallet, and treating it as one would attach a stranger's record to
 * whoever the page was about.
 */
export function normalizeWalletInput(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (EVM_ADDRESS.test(raw)) return raw.toLowerCase();
  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "polymarket.com" && !host.endsWith(".polymarket.com")) return null;
  const match = PROFILE_PATH.exec(url.pathname);
  return match ? match[1].toLowerCase() : null;
}

export interface TraderFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Rows per activity page, per direction. See ACTIVITY_ROW_CAP. */
  activityLimit?: number;
  /** Rows per positions request. See POSITION_ROW_CAP. */
  positionLimit?: number;
}

/** The same three buckets ProviderFailureNotice sorts failures into on screen. */
type FailureKind = "no_record" | "unavailable" | "rejected";

type Answer = { ok: true; body: unknown } | { ok: false; kind: FailureKind };

const FAILURE_VERB: Record<FailureKind, string> = {
  no_record: "has no record of this wallet",
  unavailable: "was temporarily unavailable",
  rejected: "rejected the request",
};

/**
 * One plain sentence, in proportion: a source with no record has answered, an
 * outage is retryable, and a rejected request is ours to fix. Each names what
 * went unmeasured, so nothing downstream has to guess why a field is null.
 */
function failureSentence(source: string, kind: FailureKind, consequence: string): string {
  return `${source} ${FAILURE_VERB[kind]}, so ${consequence}.`;
}

const PROFIT_SOURCE = "Polymarket's all-time profit leaderboard";
const VOLUME_SOURCE = "Polymarket's all-time volume leaderboard";
const RANK_SOURCE = "Polymarket's leaderboard rank";
const VALUE_SOURCE = "Polymarket's portfolio value source";
const TRADED_SOURCE = "Polymarket's markets-traded source";
const POSITIONS_SOURCE = "Polymarket's open positions source";
const ACTIVITY_SOURCE = "Polymarket's activity feed";
const PNL_SOURCE = "Polymarket's daily profit and loss series";

/**
 * One keyless GET. No headers at all: no key, no cookie, nothing that could
 * authenticate. A timeout, a dropped socket and a DNS failure are the same fact
 * to a reader, so they share the retryable bucket.
 */
async function getJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Answer> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      if (response.status === 404) return { ok: false, kind: "no_record" };
      if (response.status >= 500) return { ok: false, kind: "unavailable" };
      return { ok: false, kind: "rejected" };
    }
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Some rows carry money as a numeric string. An empty string is not a zero.
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** lb-api answers with a one-row array; the data-api value route does too. */
function firstRow(body: unknown): Record<string, unknown> | null {
  const row = Array.isArray(body) ? body[0] : body;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

/**
 * Unix SECONDS, which is what both the activity feed and the pnl series stamp
 * rows with. Read as milliseconds a 2026 row lands in January 1970, which would
 * turn a 53-day record into a 56-year one. The split is unambiguous for any live
 * record: 1e12 seconds is the year 33658 and 1e12 milliseconds is 2001.
 */
function isoFromUnix(value: unknown): string | null {
  const raw = num(value);
  if (raw === null || raw <= 0) return null;
  const at = new Date(raw < 1e12 ? raw * 1000 : raw);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

function msFromUnix(value: unknown): number | null {
  const iso = isoFromUnix(value);
  return iso === null ? null : Date.parse(iso);
}

/**
 * Trade timestamps in a page, ascending. REDEEM rows are dropped: a redemption
 * is a payout on a market that already settled, so counting one would stretch
 * "last trade" past the last time the wallet actually traded, and the length of
 * the record is the figure this lane refuses to overstate.
 */
function tradeTimesMs(rows: unknown): number[] {
  if (!Array.isArray(rows)) return [];
  const times: number[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as { type?: unknown; timestamp?: unknown };
    if (String(entry.type ?? "").toUpperCase() !== "TRADE") continue;
    const at = msFromUnix(entry.timestamp);
    if (at !== null) times.push(at);
  }
  return times.sort((a, b) => a - b);
}

/**
 * The leaderboard's label for the wallet. Absent is fine and stays null.
 *
 * Read from whichever leaderboard row answered, which is not a source
 * substitution: /profit and /volume return the same lb-api profile record beside
 * their own amount, and a label is not a performance claim. The money figures
 * stay strictly one endpoint per question.
 */
function leaderboardName(row: Record<string, unknown> | null): string | null {
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  const pseudonym = typeof row?.pseudonym === "string" ? row.pseudonym.trim() : "";
  return name || pseudonym || null;
}

/**
 * One wallet's record, assembled from the public endpoints. Every field is
 * fetched independently and concurrently, so one source falling over costs its
 * own field and nothing else.
 *
 * Throws only for an input that is not a wallet, and throws before any request:
 * there is nothing to fetch, and the report for such a claim is "not checkable
 * as written".
 */
export async function fetchTraderRecord(
  input: string,
  options: TraderFetchOptions = {},
): Promise<TraderRecord> {
  const wallet = normalizeWalletInput(input);
  if (!wallet) throw new Error(INVALID_INPUT_MESSAGE);

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const activityLimit = options.activityLimit ?? ACTIVITY_ROW_CAP;
  const positionLimit = options.positionLimit ?? POSITION_ROW_CAP;
  const user = encodeURIComponent(wallet);
  const get = (url: string) => getJson(url, fetchImpl, timeoutMs);

  const [profit, volume, rank, value, traded, positions, ascending, descending, pnl] = await Promise.all([
    get(`${LB_API}/profit?window=all&limit=1&address=${user}`),
    get(`${LB_API}/volume?window=all&limit=1&address=${user}`),
    // rankType=pnl is the profit leaderboard's rank. rankType=volume and
    // rankType=profit come back empty, so pnl and vol are the only live values.
    get(`${LB_API}/rank?address=${user}&window=all&rankType=pnl`),
    get(`${DATA_API}/value?user=${user}`),
    get(`${DATA_API}/traded?user=${user}`),
    get(`${DATA_API}/positions?user=${user}&limit=${positionLimit}`),
    get(`${DATA_API}/activity?user=${user}&limit=${activityLimit}&sortBy=TIMESTAMP&sortDirection=ASC`),
    get(`${DATA_API}/activity?user=${user}&limit=${activityLimit}&sortBy=TIMESTAMP&sortDirection=DESC`),
    get(`${PNL_API}/user-pnl?user_address=${user}&interval=all&fidelity=1d`),
  ]);

  const failures: string[] = [];

  const profitRow = profit.ok ? firstRow(profit.body) : null;
  const volumeRow = volume.ok ? firstRow(volume.body) : null;

  let profitUsd: number | null = null;
  if (!profit.ok) {
    failures.push(failureSentence(PROFIT_SOURCE, profit.kind, "all-time profit is unmeasured"));
  } else {
    profitUsd = num(profitRow?.amount);
    if (profitUsd === null) failures.push(failureSentence(PROFIT_SOURCE, "no_record", "all-time profit is unmeasured"));
  }

  let volumeUsd: number | null = null;
  if (!volume.ok) {
    failures.push(failureSentence(VOLUME_SOURCE, volume.kind, "all-time volume is unmeasured"));
  } else {
    volumeUsd = num(volumeRow?.amount);
    if (volumeUsd === null) failures.push(failureSentence(VOLUME_SOURCE, "no_record", "all-time volume is unmeasured"));
  }

  // THE RANK TRAP, verified live on 2026-08-01 and the reason this reads one
  // field and discards the rest of the payload.
  //
  // /rank?rankType=pnl returned amount=403657 rank=14765, and /rank?rankType=vol
  // returned the SAME amount=403657 with rank=44756. That amount is the wallet's
  // volume, matching /volume at 403462.20, while its actual profit was 9964.30.
  // So `amount` is volume whatever metric was ranked. Publishing "ranked #14,765
  // with $403,657 profit" would invent a number forty times the real one, which
  // is precisely the fabrication this product exists to catch.
  //
  // Read `rank` here and nothing else. Profit comes from /profit and volume from
  // /volume, one endpoint per question. Do not "fix" this back.
  const rankRow = rank.ok ? firstRow(rank.body) : null;
  let rankValue: number | null = null;
  if (!rank.ok) {
    failures.push(failureSentence(RANK_SOURCE, rank.kind, "the leaderboard rank is unmeasured"));
  } else {
    const parsed = num(rankRow?.rank);
    rankValue = parsed === null ? null : Math.round(parsed);
    if (rankValue === null) failures.push(failureSentence(RANK_SOURCE, "no_record", "the leaderboard rank is unmeasured"));
  }

  let portfolioValueUsd: number | null = null;
  if (!value.ok) {
    failures.push(failureSentence(VALUE_SOURCE, value.kind, "the current portfolio value is unmeasured"));
  } else {
    portfolioValueUsd = num(firstRow(value.body)?.value);
    if (portfolioValueUsd === null) {
      failures.push(failureSentence(VALUE_SOURCE, "no_record", "the current portfolio value is unmeasured"));
    }
  }

  let marketsTraded: number | null = null;
  if (!traded.ok) {
    failures.push(failureSentence(TRADED_SOURCE, traded.kind, "the count of markets traded is unmeasured"));
  } else {
    const parsed = num(firstRow(traded.body)?.traded);
    marketsTraded = parsed === null ? null : Math.round(parsed);
    if (marketsTraded === null) {
      failures.push(failureSentence(TRADED_SOURCE, "no_record", "the count of markets traded is unmeasured"));
    }
  }

  // Unrealized, and kept apart from /profit for the whole of its life. The
  // realized figure and the mark-to-market on an open book are different
  // questions, and adding them produces a headline neither source supports.
  const openPositions: OpenPosition[] = [];
  let unrealizedPnlUsd: number | null = null;
  let openPositionsCapped = false;
  if (!positions.ok) {
    failures.push(failureSentence(POSITIONS_SOURCE, positions.kind, "the open book and its unrealized profit and loss are unmeasured"));
  } else if (!Array.isArray(positions.body)) {
    failures.push(failureSentence(POSITIONS_SOURCE, "no_record", "the open book and its unrealized profit and loss are unmeasured"));
  } else {
    // A row whose money will not parse is dropped rather than counted as zero,
    // and dropping one leaves the same hole a full page does: the book we hold
    // is a floor, so the flag covers both.
    let unreadableRows = 0;
    for (const row of positions.body) {
      if (!row || typeof row !== "object") continue;
      const entry = row as { title?: unknown; cashPnl?: unknown; currentValue?: unknown };
      const cashPnlUsd = num(entry.cashPnl);
      const currentValueUsd = num(entry.currentValue);
      if (cashPnlUsd === null || currentValueUsd === null) {
        unreadableRows += 1;
        continue;
      }
      openPositions.push({
        title: typeof entry.title === "string" ? entry.title : "",
        cashPnlUsd,
        currentValueUsd,
      });
    }
    // An answered empty book is a measured zero: the wallet holds nothing open.
    // A book that did not answer stays null above. The two must not collapse.
    unrealizedPnlUsd = openPositions.reduce((sum, position) => sum + position.cashPnlUsd, 0);
    openPositionsCapped = positions.body.length >= positionLimit || unreadableRows > 0;
  }

  const ascendingRows = ascending.ok && Array.isArray(ascending.body) ? ascending.body : null;
  const descendingRows = descending.ok && Array.isArray(descending.body) ? descending.body : null;
  const ascendingTimes = tradeTimesMs(ascendingRows);
  const descendingTimes = tradeTimesMs(descendingRows);
  const ascendingFilled = ascendingRows !== null && ascendingRows.length >= activityLimit;
  const descendingFilled = descendingRows !== null && descendingRows.length >= activityLimit;

  let firstTradeAt: string | null = null;
  let lastTradeAt: string | null = null;
  let activitySpanIsFloor = false;
  if (ascendingTimes.length) {
    // The ascending page opens at the true beginning of the feed, so this end is
    // exact even when the page filled.
    firstTradeAt = new Date(ascendingTimes[0]).toISOString();
  } else if (descendingTimes.length) {
    firstTradeAt = new Date(descendingTimes[0]).toISOString();
    if (descendingFilled) activitySpanIsFloor = true;
  }
  if (descendingTimes.length) {
    lastTradeAt = new Date(descendingTimes[descendingTimes.length - 1]).toISOString();
  } else if (ascendingTimes.length) {
    lastTradeAt = new Date(ascendingTimes[ascendingTimes.length - 1]).toISOString();
    if (ascendingFilled) activitySpanIsFloor = true;
  }

  const activityKind: FailureKind | null = !ascending.ok
    ? ascending.kind
    : !descending.ok
      ? descending.kind
      : null;
  if (activityKind) {
    // One sentence for the feed however many of its two pages missed, and the
    // tail says what the miss actually cost rather than assuming the worst.
    const consequence = firstTradeAt === null && lastTradeAt === null
      ? "the first and last trade dates are unmeasured"
      : activitySpanIsFloor
        ? "the record is dated from a capped page and its span is a minimum, not a measured length"
        : "the record was dated from the page that did answer, which covered the whole feed";
    failures.push(failureSentence(ACTIVITY_SOURCE, activityKind, consequence));
  } else if (firstTradeAt === null && lastTradeAt === null) {
    failures.push(failureSentence(ACTIVITY_SOURCE, "no_record", "the first and last trade dates are unmeasured"));
  }

  // Cumulative, confirmed against /profit: the last point read 9970.38 against a
  // reported 9964.30. Points are passed through untouched and in order; a caller
  // that wants a day's gain subtracts neighbours.
  const pnlSeries: PnlPoint[] = [];
  if (!pnl.ok) {
    failures.push(failureSentence(PNL_SOURCE, pnl.kind, "the daily profit and loss curve is unmeasured"));
  } else {
    const rows = Array.isArray(pnl.body) ? pnl.body : [];
    const points: Array<{ ms: number; cumulativeUsd: number }> = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const entry = row as { t?: unknown; p?: unknown };
      const ms = msFromUnix(entry.t);
      const cumulativeUsd = num(entry.p);
      if (ms === null || cumulativeUsd === null) continue;
      points.push({ ms, cumulativeUsd });
    }
    points.sort((a, b) => a.ms - b.ms);
    for (const point of points) {
      pnlSeries.push({ at: new Date(point.ms).toISOString(), cumulativeUsd: point.cumulativeUsd });
    }
    if (!pnlSeries.length) {
      failures.push(failureSentence(PNL_SOURCE, "no_record", "the daily profit and loss curve is unmeasured"));
    }
  }

  return {
    wallet,
    displayName: leaderboardName(profitRow) ?? leaderboardName(volumeRow),
    profitUsd,
    volumeUsd,
    portfolioValueUsd,
    marketsTraded,
    rank: rankValue,
    firstTradeAt,
    lastTradeAt,
    pnlSeries,
    openPositions,
    unrealizedPnlUsd,
    failures,
    activitySpanIsFloor,
    openPositionsCapped,
  };
}
