// What a Polymarket wallet's public history actually supports, and what it does not.
//
// The claim this lane exists to check reads "passive $6k / month". The record
// behind it is 53 days long, 81% of the profit landed in the last 30 of those
// days, and the wallet was published by the poster rather than proven to be his.
// Every rule below exists so the report can say that out loud instead of
// printing a confident monthly number.
//
// ATTRIBUTION. A published wallet proves what THAT WALLET did. It does not prove
// the poster controls it, and it does not prove there are no other wallets. This
// is the same proven-vs-attributed split as DeployerAttribution in
// src/token/audit.ts: a source that saw the creation signed earns the strong
// word, and everything else takes the cautious one. Here the strong word is
// never earned, because no free endpoint binds a wallet to a person, so every
// checkable verdict carries the attribution caveat in its notes.
//
// SAMPLE LENGTH IS AN OUTPUT, NOT A FOOTNOTE. A monthly figure derived from 53
// days is a backward-looking average over 53 days. It is not a run rate and it
// is never multiplied up: annualising a 53-day record invents four fifths of the
// evidence. So this module computes profit / windowDays * 30 and nothing wider,
// and it states the window in the same sentence as the rate.
//
// SHAPE BEATS TOTALS. The same $9,964 can be a steady grind or one accelerating
// month, and the difference is the whole question when somebody calls it
// passive. Drawdown, green-day share, best and worst day and the trailing-30-day
// share of profit all come off the CUMULATIVE daily series, which is what makes
// the curve legible.
//
// UNMEASURED IS NOT ZERO. An endpoint that did not answer leaves null, never 0.
// A drawdown of 0 means a series was read and never fell; a drawdown of null
// means nobody looked. The notes say which.
//
// REALIZED AND UNREALIZED STAY APART. Everything here is the realized record.
// Open-position cashPnl is a different question with a different resolution date
// and is never netted into these figures, only named beside them.

import type { TraderRecord } from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The month this lane uses everywhere: 30 days, so profit / days * 30 is checkable by hand. */
const MONTH_DAYS = 30;

/** How far back "recently" reaches when measuring how back-weighted the curve is. */
const RECENT_WINDOW_DAYS = 30;

/**
 * Below this many days a monthly figure cannot be offered as a run rate. Three
 * months is the shortest window that contains more than one of anything: a
 * single hot month, one market cycle, one lucky resolution. It is a floor on
 * honesty, not a claim that 90 days is predictive.
 */
const RUN_RATE_MIN_DAYS = 90;

/**
 * How far above a steady curve the trailing-30-day profit share has to sit
 * before the average counts as back-weighted. The comparison has to be relative:
 * on a 53-day record a perfectly steady curve already puts 57% of its profit in
 * the last 30 days, so a fixed threshold like "over 60% is back-weighted" would
 * fire on flat records and stay silent on short violent ones. 15 points above
 * the steady share is wide enough to survive an ordinary hot streak and narrow
 * enough to catch a curve that only started working recently.
 */
const BACK_WEIGHT_EXCESS_POINTS = 15;

/** A return on volume at or above this, over few enough markets, is a small sample rather than an edge. */
const HIGH_RETURN_ON_VOLUME_PCT = 10;
const SMALL_SAMPLE_MARKETS = 25;

/**
 * How far a claimed monthly figure may sit from the computed average and still
 * be called true. 15% is picked from the three slops that sit under any such
 * comparison, none of which the claimant controls:
 *   - the claim itself is quoted to one significant figure ("$6k"), which spans
 *     roughly 8% either side before the rounding even reaches the reader;
 *   - the window is measured to the nearest whole day, and on a two-month record
 *     one day moves the average by about 2%;
 *   - the profit endpoint and the daily series disagree by $6 on $9,964 here,
 *     because they settle redemptions at different instants.
 * Inside that band ARGUS cannot tell a rounded honest claim from an inflated
 * one, and calling it overstated would assert more than the evidence supports.
 * Outside it, the gap is larger than every source of slop combined.
 */
export const CLAIM_TOLERANCE_PCT = 15;

/**
 * A claim sitting exactly on the tolerance is inside it. Binary floating point
 * turns a deviation of exactly 15 into 15.000000000000002 often enough that
 * without this the verdict on an edge case would depend on which arithmetic
 * produced the claim.
 */
const TOLERANCE_EPSILON_PCT = 1e-9;

export interface RecordAnalysis {
  windowDays: number | null;
  returnOnVolumePct: number | null;  // profit / volume * 100
  maxDrawdownUsd: number | null;
  maxDrawdownPct: number | null;
  greenDayPct: number | null;
  bestDayUsd: number | null;
  worstDayUsd: number | null;
  recentSharePct: number | null;     // share of total profit earned in the last 30 days
  monthlyRateUsd: number | null;     // profit / windowDays * 30, a BACKWARD-LOOKING average
  notes: string[];                   // honest caveats, e.g. the window is too short to support a rate
}

/**
 * "holds" and the two miss directions are statements about the published
 * wallet's record. "not_checkable" is a statement about the CLAIM: no wallet, or
 * no record behind the wallet. It is a legitimate outcome and the correct one
 * for most claims of this kind, and it is never a soft way of saying false.
 */
export type ClaimVerdict = "holds" | "overstated" | "understated" | "not_checkable";

export interface ClaimComparison {
  verdict: ClaimVerdict;
  /** The figure as claimed, in USD per month. Null when no usable figure was quoted. */
  claimedMonthlyUsd: number | null;
  /**
   * The backward-looking average the record supports. Null when there was no
   * record to average, and that is the usual not_checkable case. It survives one
   * not_checkable: a window read off a capped page still yields a number, it is
   * just a ceiling rather than an average, and the statement says so. Withholding
   * it there would hide the only figure the read did produce.
   */
  observedMonthlyUsd: number | null;
  /** Days between the first and last trade on record. The rate above means nothing without it. */
  windowDays: number | null;
  /** Signed: positive means the claim sits above the record. Null when there is nothing to divide by. */
  deviationPct: number | null;
  /** One sentence carrying the verdict, the observed average and the window it came from, together. */
  statement: string;
  /** The record's caveats, plus the attribution caveat that a wallet is not a person. */
  notes: string[];
}

interface Point { ms: number; cumulativeUsd: number }

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The daily series, oldest first, with unparseable rows dropped rather than
 * coerced. The adapter reports the endpoint failure; a row that cannot be read
 * must not become a point at the epoch worth $0.
 */
function usablePoints(record: TraderRecord): Point[] {
  const points: Point[] = [];
  for (const row of record.pnlSeries ?? []) {
    const ms = toMs(row?.at);
    if (ms === null || !isNumber(row?.cumulativeUsd)) continue;
    points.push({ ms, cumulativeUsd: row.cumulativeUsd });
  }
  return points.sort((a, b) => a.ms - b.ms);
}

/**
 * Whole days between two instants. Rounded, and then reused as the denominator
 * of the monthly rate, so a reader who divides the published profit by the
 * published window gets the published rate back. A window that rounds to zero
 * stays zero: hours of trading are not a day, and inventing one would hand the
 * subject a monthly figure extrapolated from an afternoon.
 */
function spanDays(fromMs: number, toMsValue: number): number {
  return Math.max(0, Math.round((toMsValue - fromMs) / DAY_MS));
}

function measureWindow(record: TraderRecord, points: Point[]): { days: number | null; fromSeries: boolean } {
  const first = toMs(record.firstTradeAt);
  const last = toMs(record.lastTradeAt);
  if (first !== null && last !== null && last >= first) return { days: spanDays(first, last), fromSeries: false };
  // The activity endpoint is the one that dies under rate limits. The daily
  // series covers the same span from another host, so a record that lost its
  // trade timestamps still gets a measured window, flagged as second choice.
  if (points.length >= 2) return { days: spanDays(points[0].ms, points[points.length - 1].ms), fromSeries: true };
  return { days: null, fromSeries: false };
}

/**
 * Deepest fall from a running peak, in dollars and as a share of the peak it
 * fell from. Zero is a real answer here: a series that was read and never fell
 * has a measured drawdown of nothing. The percent is withheld when the peak was
 * never above water, because a percentage of a losing balance is arithmetic
 * without a meaning.
 */
function measureDrawdown(points: Point[]): { usd: number | null; pct: number | null } {
  if (points.length < 2) return { usd: null, pct: null };
  let peak = points[0].cumulativeUsd;
  let worstUsd = 0;
  let peakAtWorst = peak;
  for (const point of points) {
    if (point.cumulativeUsd > peak) peak = point.cumulativeUsd;
    const fall = peak - point.cumulativeUsd;
    if (fall > worstUsd) { worstUsd = fall; peakAtWorst = peak; }
  }
  return { usd: worstUsd, pct: peakAtWorst > 0 ? (worstUsd / peakAtWorst) * 100 : null };
}

/** Day-over-day change, which is what the cumulative series has to be differenced to give. */
function dailyChanges(points: Point[]): number[] {
  const changes: number[] = [];
  for (let i = 1; i < points.length; i += 1) changes.push(points[i].cumulativeUsd - points[i - 1].cumulativeUsd);
  return changes;
}

/**
 * Share of the record's profit earned in the trailing 30 days, against the share
 * a perfectly steady curve over the same span would have put there. The pair is
 * the point: 81% means nothing until you know a flat 53-day record would already
 * read 57%.
 *
 * The baseline is the last series point at or before the cutoff; when the record
 * is shorter than 30 days the baseline is the start of the record, so the share
 * is 100% and says only that the whole record is recent.
 *
 * Withheld when the record is not in profit, because a share of a loss inverts
 * its own sign and cannot be read as "how much of the win is recent".
 */
function measureRecentShare(points: Point[]): { pct: number | null; steadyPct: number | null } {
  if (points.length < 2) return { pct: null, steadyPct: null };
  const last = points[points.length - 1];
  const total = last.cumulativeUsd;
  if (!(total > 0)) return { pct: null, steadyPct: null };

  const cutoff = last.ms - RECENT_WINDOW_DAYS * DAY_MS;
  let baseline = 0;
  for (const point of points) {
    if (point.ms > cutoff) break;
    baseline = point.cumulativeUsd;
  }

  const seriesDays = (last.ms - points[0].ms) / DAY_MS;
  return {
    pct: ((total - baseline) / total) * 100,
    steadyPct: seriesDays > 0 ? (Math.min(RECENT_WINDOW_DAYS, seriesDays) / seriesDays) * 100 : null,
  };
}

/**
 * Money the reader can check by hand. usdCompact in src/lib/format.ts renders
 * $5,640.17 as $5.64K, which is right for a market cap column and wrong here:
 * this copy exists so a reader can divide the profit by the window and land on
 * the rate, and compacted digits hide the arithmetic.
 */
function usd(value: number): string {
  const abs = Math.abs(value);
  // Cents are noise on a monthly rate and are the whole point on a $196.80 open
  // position, so the cut sits at a thousand rather than at a hundred.
  const digits = abs >= 1_000 ? 0 : 2;
  const body = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? "-" : ""}$${body}`;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

/** Enough of the address to identify it, never so little that two wallets collide on screen. */
function shortWallet(wallet: string): string {
  return wallet.length > 14 ? `${wallet.slice(0, 8)}...${wallet.slice(-4)}` : wallet;
}

/**
 * Turn a fetched record into the shape of the curve behind it. Pure: it invents
 * no data, and every figure it cannot support comes back null with a note saying
 * so rather than a zero that reads like a measurement.
 */
export function analyzeRecord(record: TraderRecord): RecordAnalysis {
  const points = usablePoints(record);
  const notes: string[] = [];

  const window = measureWindow(record, points);
  const windowDays = window.days;

  const profitUsd = isNumber(record.profitUsd) ? record.profitUsd : null;
  const volumeUsd = isNumber(record.volumeUsd) ? record.volumeUsd : null;
  const returnOnVolumePct = profitUsd !== null && volumeUsd !== null && volumeUsd > 0
    ? (profitUsd / volumeUsd) * 100
    : null;

  const drawdown = measureDrawdown(points);
  const changes = dailyChanges(points);
  const greenDayPct = changes.length > 0
    ? (changes.filter((change) => change > 0).length / changes.length) * 100
    : null;
  const bestDayUsd = changes.length > 0 ? changes.reduce((a, b) => Math.max(a, b)) : null;
  const worstDayUsd = changes.length > 0 ? changes.reduce((a, b) => Math.min(a, b)) : null;

  const recent = measureRecentShare(points);
  const monthlyRateUsd = profitUsd !== null && windowDays !== null && windowDays >= 1
    ? (profitUsd / windowDays) * MONTH_DAYS
    : null;

  if (windowDays === null) {
    notes.push("Neither the trade history nor the daily series gave a first and last date, so the length of this record is unmeasured and no monthly figure can be derived from it.");
  } else if (windowDays < 1) {
    notes.push("The first and last trade fall inside a single day, so there is no window to average over. A monthly figure extrapolated from hours would be an invention.");
  } else if (windowDays < RUN_RATE_MIN_DAYS) {
    notes.push(`This is a ${windowDays}-day record. A window that short cannot support a monthly figure as a run rate: the rate is a backward-looking average of the days on record, not a forecast, and it is never annualised.`);
  }
  if (window.fromSeries && windowDays !== null) {
    notes.push("The window came from the daily profit series because the trade history did not report a first and last trade, so it is the span the series covers rather than the span between trades.");
  }
  // The adapter sets this when an end of the record is a page boundary rather
  // than a proven trade. It changes what the window IS: not a measurement but a
  // lower bound, which makes every figure divided by it an upper bound. A
  // shorter window flatters the trader, so the direction of the error has to be
  // on the page next to the figure that carries it.
  if (record.activitySpanIsFloor === true && windowDays !== null) {
    notes.push(`The activity feed was read to its page limit, so ${windowDays} days is the shortest this record can be rather than its measured length: the wallet may have been trading before the earliest row this scan could see. Any figure divided by that window is a ceiling, not an average.`);
  }

  if (points.length < 2) {
    notes.push("No usable daily profit series was available, so the shape of the curve (drawdown, green days, best and worst day, and how recent the profit is) is unmeasured rather than flat.");
  }
  if (drawdown.usd !== null && drawdown.pct === null) {
    notes.push("The record never held a peak above water, so the drawdown is reported in dollars only: a percentage off a losing balance would not mean anything.");
  }

  if (returnOnVolumePct === null) {
    notes.push("Profit or volume was not reported, so return on volume is unmeasured, not zero.");
  } else if (
    returnOnVolumePct >= HIGH_RETURN_ON_VOLUME_PCT
    && isNumber(record.marketsTraded)
    && record.marketsTraded < SMALL_SAMPLE_MARKETS
  ) {
    notes.push(`A return on volume of ${returnOnVolumePct.toFixed(1)}% was earned across ${record.marketsTraded} markets, which is a small sample: at that count a handful of resolutions carries the whole figure, and it should not be read as an edge that repeats.`);
  }

  if (recent.pct !== null && recent.steadyPct !== null && recent.pct - recent.steadyPct >= BACK_WEIGHT_EXCESS_POINTS) {
    notes.push(`${pct(recent.pct)} of the profit on this record was earned in the last ${RECENT_WINDOW_DAYS} days, against the ${pct(recent.steadyPct)} a steady curve over the same span would put there. The average is back-weighted: this is an accelerating curve caught mid-acceleration, not a steady rate.`);
  }

  if (isNumber(record.unrealizedPnlUsd) && record.unrealizedPnlUsd !== 0) {
    const carried = record.unrealizedPnlUsd > 0 ? "unrealized gain" : "unrealized loss";
    notes.push(`Every figure here is the realized record. The wallet separately carries ${usd(Math.abs(record.unrealizedPnlUsd))} of ${carried} on positions still open, which is a different question with a different resolution date and is not netted into any number above.`);
  } else if (record.unrealizedPnlUsd === null) {
    notes.push("Open positions were not readable, so unrealized profit or loss is unmeasured rather than zero, and nothing above accounts for what the wallet is still holding.");
  }
  // A cut-short book fires whatever the sum came to, including zero: a partial
  // read that happens to net to nothing is not an empty book, and without this
  // the one case that most looks like "nothing open" is the one case with no
  // caveat. Note the sum is a PARTIAL, not a floor: the rows this scan never saw
  // carry signed money and could move it in either direction, so "at least" is
  // the wrong word here even though the COUNT is genuinely a floor.
  if (record.openPositionsCapped === true) {
    notes.push("The open position list was cut short, so it is a floor rather than a count of everything the wallet holds. Any unrealized figure taken from it covers only the positions this scan could read, and the rows it missed could move that figure in either direction.");
  }

  return {
    windowDays,
    returnOnVolumePct,
    maxDrawdownUsd: drawdown.usd,
    maxDrawdownPct: drawdown.pct,
    greenDayPct,
    bestDayUsd,
    worstDayUsd,
    recentSharePct: recent.pct,
    monthlyRateUsd,
    notes,
  };
}

/** A wallet is what the poster published, never what ARGUS proved about the poster. */
function attributionNote(wallet: string): string {
  return `This is the record of the published wallet ${shortWallet(wallet)} and nothing wider. A published wallet proves what that wallet did; it does not prove the poster controls it, and it does not rule out other wallets, which are unmeasured rather than absent.`;
}

/**
 * windowDays survives a not_checkable verdict wherever it was measured: "the
 * wallet has 53 days of history but never reported a profit figure" is a more
 * useful thing for the report to say than a row of nulls.
 */
function notCheckable(
  reason: string,
  claimedMonthlyUsd: number | null,
  notes: string[],
  windowDays: number | null = null,
): ClaimComparison {
  return {
    verdict: "not_checkable",
    claimedMonthlyUsd,
    observedMonthlyUsd: null,
    windowDays,
    deviationPct: null,
    statement: reason,
    notes,
  };
}

/**
 * Compare a claimed monthly figure against the wallet's record.
 *
 * The comparison is always against the backward-looking average over the days on
 * record, and the statement names that window in the same breath as the rate,
 * because the rate on its own is the exact number a reader would otherwise
 * multiply by twelve. Nothing here annualises.
 *
 * A missing wallet or a missing record produces "not_checkable", which is the
 * honest reading of a claim nobody published evidence for and is a finding in
 * its own right. It is never downgraded to false.
 */
export function compareMonthlyClaim(
  claimedMonthlyUsd: number | null | undefined,
  record: TraderRecord | null | undefined,
): ClaimComparison {
  const claimed = isNumber(claimedMonthlyUsd) ? claimedMonthlyUsd : null;
  const wallet = record?.wallet?.trim() ?? "";

  if (!record || !wallet) {
    return notCheckable(
      "No wallet was published alongside this claim, so it is not checkable as written. That is a finding about the claim and not a finding against the person: an unpublished record is unmeasured, never disproved.",
      claimed,
      ["Resolving a social handle to a wallet is not reliably possible and is never guessed here. Without a wallet the poster published, there is nothing to read."],
    );
  }
  if (claimed === null) {
    return notCheckable(
      `No monthly figure was quoted precisely enough to check against wallet ${shortWallet(wallet)}.`,
      null,
      [attributionNote(wallet)],
    );
  }

  const analysis = analyzeRecord(record);
  const notes = [attributionNote(wallet), ...analysis.notes];
  if (analysis.monthlyRateUsd === null || analysis.windowDays === null) {
    return notCheckable(
      `Wallet ${shortWallet(wallet)} did not return the profit and dated history a monthly average needs, so the claim of ${usd(claimed)} per month is not checkable against it. The inputs are missing, which is not evidence either way.`,
      claimed,
      notes,
      analysis.windowDays,
    );
  }

  const observed = analysis.monthlyRateUsd;
  const windowDays = analysis.windowDays;
  const observedText = `${usd(observed)} per month averaged across the ${windowDays} days on record`;

  // A rate of exactly nothing has no denominator to be a percentage of, so the
  // direction is reported without one rather than as an infinite miss.
  if (observed === 0) {
    const verdict: ClaimVerdict = claimed > 0 ? "overstated" : claimed < 0 ? "understated" : "holds";
    return {
      verdict,
      claimedMonthlyUsd: claimed,
      observedMonthlyUsd: observed,
      windowDays,
      deviationPct: null,
      statement: `Claimed ${usd(claimed)} per month. The wallet is exactly flat across the ${windowDays} days on record, so the claim ${verdict === "holds" ? "holds" : "is not supported by anything in the record"}.`,
      notes,
    };
  }

  const deviationPct = ((claimed - observed) / Math.abs(observed)) * 100;
  const band = CLAIM_TOLERANCE_PCT + TOLERANCE_EPSILON_PCT;
  const verdict: ClaimVerdict = deviationPct > band
    ? "overstated"
    : deviationPct < -band ? "understated" : "holds";

  // A window read off a capped page is a MINIMUM, so profit divided by it is a
  // MAXIMUM. That asymmetry decides which verdicts survive. "overstated" does:
  // a claim that clears even the highest rate this record could support clears
  // the real one too, however much earlier the wallet turns out to have started.
  // "holds" and "understated" do not: both rest on the observed rate being the
  // rate, and the true one can be arbitrarily lower. Publishing either would be
  // a verdict on a denominator nobody measured, so the claim is not checkable
  // against this record yet, which is a statement about the read and not about
  // the claimant. The ceiling still goes out, named as a ceiling.
  if (record.activitySpanIsFloor === true && verdict !== "overstated") {
    return {
      ...notCheckable(
        `Claimed ${usd(claimed)} per month. Polymarket's activity feed was read to its page limit for wallet ${shortWallet(wallet)}, so its ${windowDays} days are a minimum and the ${usd(observed)} per month they imply is a ceiling rather than an average. A ceiling that sits at or above the claim cannot settle it either way.`,
        claimed,
        notes,
        windowDays,
      ),
      observedMonthlyUsd: observed,
    };
  }

  const tail = verdict === "holds"
    ? `so the claim holds to within ${pct(Math.abs(deviationPct))}`
    : verdict === "overstated"
      ? `so the claim runs ${pct(deviationPct)} above the record`
      : `so the claim runs ${pct(Math.abs(deviationPct))} below the record`;

  return {
    verdict,
    claimedMonthlyUsd: claimed,
    observedMonthlyUsd: observed,
    windowDays,
    deviationPct,
    statement: `Claimed ${usd(claimed)} per month. The wallet made ${observedText}, ${tail}.`,
    notes,
  };
}
