// What ARGUS can honestly say about one Polymarket wallet, and nothing wider.
//
// A wallet is not a person. Every figure below is the record of THE WALLET: a
// published address proves that wallet's trading, it does not prove the poster
// owns it, and it does not prove the poster has no other wallets. That is the
// same proven-versus-attributed split DeployerAttribution draws in
// src/token/audit.ts, where only a source that watched the creation signed earns
// the strong word. A report built on this type keeps the same discipline: a
// wallet somebody pasted into a thread is an attributed wallet.
//
// Every field is `| null` because every field comes from its own endpoint and
// each one can miss on its own. `null` here means UNMEASURED: the source did not
// answer, or it answered with no record of this wallet. It never means zero. A
// reader who cannot tell those apart reads a failed request as a flat month.

/**
 * One point on Polymarket's daily profit and loss series.
 *
 * CUMULATIVE, confirmed live against the profit endpoint: the last point read
 * 9970.38 while /profit read 9964.30 for the same wallet. Summing these points
 * would produce a six-figure profit out of a five-figure one, so nothing
 * downstream may treat a point as a day's gain. Day-over-day deltas are a
 * difference between neighbouring points, and the caller derives them.
 */
export interface PnlPoint {
  at: string;
  cumulativeUsd: number;
}

/**
 * One market the wallet still has money in. `cashPnlUsd` is UNREALIZED: it is
 * what the position is up or down at the current mark, and it is a different
 * question from realized profit. The two are never summed into one headline.
 */
export interface OpenPosition {
  title: string;
  cashPnlUsd: number;
  currentValueUsd: number;
}

export interface TraderRecord {
  /** Lowercase 0x address. The subject of every figure here. */
  wallet: string;
  /** Leaderboard pseudonym or name, null if absent. A label, never an identity. */
  displayName: string | null;
  /** All-time realized profit from lb-api /profit. Never the rank endpoint's amount. */
  profitUsd: number | null;
  /** All-time volume from lb-api /volume. Never the rank endpoint's amount. */
  volumeUsd: number | null;
  /** Current portfolio value from data-api /value. */
  portfolioValueUsd: number | null;
  /** Distinct markets traded from data-api /traded. */
  marketsTraded: number | null;
  /**
   * The RANK ONLY, from lb-api /rank. That endpoint also returns an `amount`
   * which is volume no matter which rankType was asked for, so the adapter
   * never reads it. See the trap comment in trader.ts before touching this.
   */
  rank: number | null;
  /** Earliest trade the activity feed showed, ISO. */
  firstTradeAt: string | null;
  /** Latest trade the activity feed showed, ISO. */
  lastTradeAt: string | null;
  /** Daily cumulative profit and loss. See PnlPoint: cumulative, not deltas. */
  pnlSeries: PnlPoint[];
  /** Markets still open. Capped by the request, so see openPositionsCapped. */
  openPositions: OpenPosition[];
  /** Sum of open cashPnl, null if positions were unavailable. Unrealized only. */
  unrealizedPnlUsd: number | null;
  /** One plain sentence per endpoint that did not answer. */
  failures: string[];

  /**
   * True when the activity feed was capped and an end above is a page boundary
   * rather than a proven first or last trade. The span between the two ends is
   * then a MINIMUM: the real record can start earlier, which makes any rate
   * derived by dividing profit over that span a maximum. A rate that flatters
   * the trader must carry the caveat, so this flag travels with the record.
   *
   * Optional so a hand-built fixture that never touched the feed reads as
   * "nothing was capped" rather than being forced to answer the question.
   */
  activitySpanIsFloor?: boolean;
  /**
   * True when the open book here is incomplete: the positions request came back
   * full, or a row could not be read and was dropped rather than counted as a
   * zero. Either way the list is a floor and not a total, and so is the
   * unrealized sum taken from it. A capped list is never published as a count of
   * everything the wallet holds.
   */
  openPositionsCapped?: boolean;
}
