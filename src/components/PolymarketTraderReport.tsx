import { usdCompact } from "../lib/format";

/**
 * POLYMARKET TRADER REPORT: a claim about a trading record, read against the
 * record itself.
 *
 * The subject is a post ("passive $6k / month") and a wallet. Polymarket's
 * public endpoints answer for the wallet without a key, so what the wallet did
 * is checkable. Who holds the wallet is not, and the two are kept apart on
 * screen the same way DeployerAttribution keeps a proven deployer apart from an
 * attributed creator in src/token/audit.ts: only the chain proves what an
 * address did, and nothing here proves who controls it.
 *
 * Four rules this panel exists to hold:
 *
 *   1. A claim with no published wallet is NOT CHECKABLE AS WRITTEN. It is
 *      never false. An X handle cannot be resolved to a wallet, and guessing
 *      one would invent the record the panel is meant to verify.
 *   2. Sample length is an output, not a footnote. A 53-day window is stated
 *      next to every rate derived from it, and no figure here is ever
 *      annualised.
 *   3. Realized and unrealized are different questions. The all-time profit
 *      figure and the sum of open-position cash PnL are never added together
 *      into one headline number.
 *   4. An absent value is unmeasured, never zero, and a capped list is a floor,
 *      never a total.
 *
 * The prop types mirror TraderRecord (src/polymarket/types.ts) and
 * RecordAnalysis (src/polymarket/record.ts) field for field. They are restated
 * here, with the "View" suffix this codebase already uses for a restated prop
 * type (OperatorLaunchHistoryView), so the report surface can be built and
 * tested without the adapter and derivation modules in place.
 */

/** One open bet: what it is, its cash PnL so far, and what it is worth now. */
export interface TraderOpenPositionView {
  title: string;
  cashPnlUsd: number;
  currentValueUsd: number;
}

export interface TraderRecordView {
  wallet: string;
  /** Leaderboard pseudonym or name. Null when the leaderboard carried neither. */
  displayName: string | null;
  profitUsd: number | null;
  volumeUsd: number | null;
  portfolioValueUsd: number | null;
  marketsTraded: number | null;
  /**
   * The leaderboard's rank field and nothing else. The same endpoint returns an
   * `amount` that is the wallet's VOLUME whatever the rankType asked for, so
   * publishing it next to a profit rank would print a fabricated profit. The
   * adapter drops it; this panel never had it.
   */
  rank: number | null;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  /** Daily cumulative realized profit. Cumulative, not per-day deltas. */
  pnlSeries: Array<{ at: string; cumulativeUsd: number }>;
  openPositions: TraderOpenPositionView[];
  /** Sum of open-position cash PnL. Null when positions were unavailable, which is not zero. */
  unrealizedPnlUsd: number | null;
  /** One human sentence per endpoint that did not answer. */
  failures: string[];
  /**
   * True when the activity feed was read to its page limit, so the span between
   * the first and last trade is a MINIMUM. Every rate divided by that span is
   * then a maximum, and a rate that flatters the wallet has to say so.
   */
  activitySpanIsFloor?: boolean;
  /**
   * True when the open book is incomplete: the request came back full, or a row
   * could not be read and was dropped rather than counted as a zero. Either way
   * the list is a floor and so is the unrealized sum taken from it.
   */
  openPositionsCapped?: boolean;
}

export interface RecordAnalysisView {
  windowDays: number | null;
  returnOnVolumePct: number | null;
  maxDrawdownUsd: number | null;
  maxDrawdownPct: number | null;
  greenDayPct: number | null;
  bestDayUsd: number | null;
  worstDayUsd: number | null;
  /** Share of total profit earned in the last 30 days. */
  recentSharePct: number | null;
  /** profit / windowDays * 30. A backward-looking average over the window, never a forecast. */
  monthlyRateUsd: number | null;
  notes: string[];
}

export interface PolymarketClaimView {
  /** The claim in the poster's own words. Quoted, never paraphrased. */
  quote: string;
  /** The account that posted it. A handle is never resolved to a wallet here. */
  handle?: string;
  url?: string;
  /**
   * The claim reduced to dollars per 30 days, when it states a rate at all.
   * Null when it does not, which is not a mark against the claim: it means this
   * panel has no number to measure it against and says so.
   */
  monthlyUsd?: number | null;
  /**
   * Whether the post under review published the wallet itself. False means the
   * wallet reached this audit some other way, so the record below is some
   * wallet's record and nothing at all ties it to the poster.
   */
  walletPublished?: boolean;
}

/**
 * The derivation lane's own reading of the claim against the record
 * (ClaimComparison in src/polymarket/record.ts, restated field for field).
 *
 * When one is supplied it WINS: the panel prints its verdict and its sentence
 * instead of deriving a second one. Two places computing the same verdict is
 * two places that can publish different verdicts, which is the rule
 * OperatorTrackRecord already follows by reading the server's own launch
 * ordinal rather than recomputing it.
 */
export interface ClaimComparisonView {
  verdict: "holds" | "overstated" | "understated" | "not_checkable";
  claimedMonthlyUsd: number | null;
  observedMonthlyUsd: number | null;
  windowDays: number | null;
  /** Signed: positive means the claim sits above the record. */
  deviationPct: number | null;
  /** One sentence carrying the verdict, the observed average, and the window together. */
  statement: string;
  notes: string[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** An absent figure is unmeasured. It never renders as a zero. */
const UNMEASURED = "not reported";

const usd = (value?: number | null): string => (finite(value) ? usdCompact(value) : UNMEASURED);

/** Money that carries a direction, so a loss reads as a loss instead of a total. */
const usdSigned = (value?: number | null): string =>
  finite(value) ? `${value < 0 ? "-" : "+"}${usdCompact(Math.abs(value))}` : UNMEASURED;

const pct1 = (value?: number | null): string => (finite(value) ? `${value.toFixed(1)}%` : UNMEASURED);

/**
 * Return on volume gets a second decimal the other percentages do not. A thin
 * edge is the whole finding on a high-churn wallet, and 2.47% and 2.5% do not
 * read the same when the reader is deciding whether the edge is real.
 */
const pct2 = (value?: number | null): string => (finite(value) ? `${value.toFixed(2)}%` : UNMEASURED);

const count = (value?: number | null): string => (finite(value) ? value.toLocaleString("en-US") : UNMEASURED);

function fullDay(at?: string | null): string | null {
  const parsed = at ? new Date(at) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;
}

function shortDay(at?: string | null): string | null {
  const parsed = at ? new Date(at) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : null;
}

const shortWallet = (wallet: string): string =>
  wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;

/**
 * The positions endpoint is read one page deep at limit=500, so a list that
 * long is a floor and not a count. Anything at the cap is published as "at
 * least", the same rule that keeps an absent value from becoming a zero.
 *
 * The floor is always the number of rows actually in hand, never this constant.
 * The adapter also raises its cap flag when a single row would not parse and was
 * dropped, and a book of sixteen that lost one row is a floor of fifteen: saying
 * "at least 500" there would invent 485 positions to avoid overstating none.
 */
const POSITIONS_PAGE_LIMIT = 500;

/**
 * How far the record may sit from a claimed rate and still be the same
 * statement. A round number in a post ("$6k a month") is not a measurement, and
 * an average taken over a window this short moves by more than this band inside
 * a week, so a gap under it is not a difference this panel can see.
 */
const CLAIM_TOLERANCE_PCT = 15;

type ClaimStanding = "not_checkable" | "supported" | "under" | "ahead" | "untested";

const STANDING_CHIP: Record<ClaimStanding, { label: string; tint: string }> = {
  not_checkable: { label: "not checkable as written", tint: "tint-unverifiable" },
  supported: { label: "claim holds on this wallet", tint: "tint-pass" },
  under: { label: "record runs under the claim", tint: "tint-caution" },
  ahead: { label: "record runs ahead of the claim", tint: "tint-neutral" },
  untested: { label: "no rate under test", tint: "tint-signal" },
};

/**
 * The answer, first. A rate is compared only when both sides carry a number:
 * no claimed figure, or no window to average over, and the panel leads with the
 * verified figures instead of manufacturing a verdict.
 *
 * The fallback only runs when the derivation lane supplied no ClaimComparison.
 * It has to reach the same verdict that lane would, which is why it carries the
 * page-limit rule too rather than being the one path that forgets it.
 */
function standingOf(
  claimedMonthlyUsd: number | null,
  recordMonthlyUsd: number | null,
  windowIsFloor: boolean,
): ClaimStanding {
  if (!finite(claimedMonthlyUsd) || claimedMonthlyUsd <= 0 || !finite(recordMonthlyUsd)) return "untested";
  const gapPct = ((recordMonthlyUsd - claimedMonthlyUsd) / claimedMonthlyUsd) * 100;
  const standing: ClaimStanding =
    Math.abs(gapPct) <= CLAIM_TOLERANCE_PCT ? "supported" : gapPct < 0 ? "under" : "ahead";
  // A rate divided by a floored window is the highest rate the record could
  // support, not the rate. A ceiling that still falls short of the claim settles
  // the claim: the true figure is lower again. A ceiling at or above it settles
  // nothing, because the true figure can be anywhere below. So "under" survives
  // a page-limited read and the two flattering verdicts do not.
  return windowIsFloor && standing !== "under" ? "not_checkable" : standing;
}

/** "overstated" is a statement about the claim; "under" is the same fact said about the record. */
const VERDICT_STANDING: Record<ClaimComparisonView["verdict"], ClaimStanding> = {
  holds: "supported",
  overstated: "under",
  understated: "ahead",
  not_checkable: "not_checkable",
};

const CHART_W = 560;
const CHART_H = 130;
const CHART_PAD = 4;

interface CurvePlot {
  x: (index: number) => number;
  y: (value: number) => number;
  polyline: string;
}

/**
 * Zero stays in frame. A cumulative-profit axis cropped to its own first value
 * turns a flat stretch into a rocket, which is exactly the exaggeration this
 * panel exists to take out of a screenshot.
 */
function plotCurve(values: number[]): CurvePlot {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (CHART_W - CHART_PAD * 2) / (values.length - 1) : 0;
  const x = (index: number) => CHART_PAD + index * step;
  const y = (value: number) => CHART_PAD + (CHART_H - CHART_PAD * 2) * (1 - (value - min) / span);
  return {
    x,
    y,
    polyline: values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" "),
  };
}

/**
 * Where the running peak gave the most back. Geometry only: it places the mark,
 * and every number printed beside the mark comes from RecordAnalysis, so the
 * chart and the figures can never state two different drawdowns.
 */
function deepestGiveBack(values: number[]): { peakIndex: number; troughIndex: number } | null {
  let peak = values[0];
  let peakIndex = 0;
  let worst = 0;
  let found: { peakIndex: number; troughIndex: number } | null = null;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > peak) {
      peak = values[index];
      peakIndex = index;
      continue;
    }
    const drop = peak - values[index];
    if (drop > worst) {
      worst = drop;
      found = { peakIndex, troughIndex: index };
    }
  }
  return found;
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string | null; tone?: string }) {
  return (
    <div className="bg-panel px-3.5 py-3">
      <dt className="stat-label">{label}</dt>
      <dd className={`stat-value tabular mt-1 ${tone ?? ""}`}>{value}</dd>
      {detail && <dd className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">{detail}</dd>}
    </div>
  );
}

/**
 * The claim, in the poster's own words, with a link to the post. Quoted so the
 * reader tests the same sentence the panel did.
 */
function ClaimQuote({ claim }: { claim: PolymarketClaimView }) {
  return (
    <div className="panel-inset mt-3 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="stat-label">the claim under review</span>
        {claim.handle && <span className="mono text-[11px] text-ink-faint">@{claim.handle.replace(/^@+/, "")}</span>}
        {claim.url && (
          <a
            href={claim.url}
            target="_blank"
            rel="noopener noreferrer"
            className="link-ext mono ml-auto text-[11px] text-ink-faint"
          >
            the post
          </a>
        )}
      </div>
      <blockquote className="mt-1 text-[12px] leading-relaxed text-ink-dim">"{claim.quote}"</blockquote>
    </div>
  );
}

/**
 * The caveats, in the reading path, at full size, in the semantic tint the rest
 * of the report uses for a partial answer. A caveat a reader has to go looking
 * for is a caveat the report did not make.
 */
function Caveats({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div className="finding tint-caution mt-4 px-4 py-3" role="note">
      <p className="text-[12.5px] font-medium text-ink">What this record does not support</p>
      <ul className="mt-1.5 space-y-1">
        {notes.map((note) => (
          <li key={note} className="text-[11.5px] leading-relaxed text-ink-dim">
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PolymarketTraderReport({
  record,
  analysis,
  claim,
  comparison,
}: {
  record?: TraderRecordView | null;
  analysis?: RecordAnalysisView | null;
  claim?: PolymarketClaimView | null;
  comparison?: ClaimComparisonView | null;
}) {
  const wallet = record?.wallet?.trim() ?? "";
  // No wallet and no claim is no subject. An empty shell would imply a finding.
  if (!wallet && !claim) return null;

  const titleId = "polymarket-trader-report-title";
  // Both lanes can carry caveats and both can carry the same one. The reader
  // sees each once.
  const notes = [...new Set([...(analysis?.notes ?? []), ...(comparison?.notes ?? [])])];
  const statement = comparison?.statement?.trim() ?? "";

  // No published wallet is the finding, and it is the whole panel: there is no
  // record to show, and a claim nobody can check is not a claim anybody has
  // disproved.
  if (!wallet) {
    return (
      <section className="panel scroll-mt-28 px-4 py-4 sm:px-5" aria-labelledby={titleId}>
        <p className="eyebrow">Polymarket record</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h2 id={titleId} className="display-sm text-[18px] leading-snug text-ink">
            {statement || "This claim is not checkable as written: no wallet was published with it."}
          </h2>
          <span className={`chip ${STANDING_CHIP.not_checkable.tint} chip-wrap`}>
            {STANDING_CHIP.not_checkable.label}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
          Polymarket answers for an address, not for a handle, and there is no reliable way to resolve one to the
          other. Guessing a wallet would invent the record. Nothing here says the claim is wrong; it says the post
          does not carry what would settle it.
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
          A wallet address or a polymarket.com/profile link, published by the poster, is all it would take.
        </p>
        {claim && <ClaimQuote claim={claim} />}
        <Caveats notes={notes} />
      </section>
    );
  }

  const failures = record?.failures ?? [];
  const series = (record?.pnlSeries ?? []).filter((point) => finite(point.cumulativeUsd));
  const values = series.map((point) => point.cumulativeUsd);
  const hasCurve = values.length >= 2;
  const positions = record?.openPositions ?? [];
  // A floor either way: the adapter says the book was cut short, or the list
  // came back at the page size and speaks for itself. A dropped row makes the
  // list short without making it full, which is why the flag is read first.
  const positionsCapped = record?.openPositionsCapped === true || positions.length >= POSITIONS_PAGE_LIMIT;
  // The activity feed can be cut short the same way, and then the span between
  // the first and last trade is a minimum: the record can start earlier, so
  // every rate divided by that span is a maximum.
  const spanIsFloor = record?.activitySpanIsFloor === true;

  // Every figure is read once into a local. Each one is independently absent on
  // a real scan, and a local keeps "unmeasured" a single decision per figure
  // instead of an optional chain repeated at every use.
  const profitUsd = record?.profitUsd ?? null;
  const volumeUsd = record?.volumeUsd ?? null;
  const portfolioValueUsd = record?.portfolioValueUsd ?? null;
  const unrealizedPnlUsd = record?.unrealizedPnlUsd ?? null;
  const marketsTraded = record?.marketsTraded ?? null;
  const rank = record?.rank ?? null;
  const windowDays = analysis?.windowDays ?? null;
  const returnOnVolumePct = analysis?.returnOnVolumePct ?? null;
  const maxDrawdownUsd = analysis?.maxDrawdownUsd ?? null;
  const maxDrawdownPct = analysis?.maxDrawdownPct ?? null;
  const greenDayPct = analysis?.greenDayPct ?? null;
  const bestDayUsd = analysis?.bestDayUsd ?? null;
  const worstDayUsd = analysis?.worstDayUsd ?? null;
  const recentSharePct = analysis?.recentSharePct ?? null;
  const monthlyRateUsd = analysis?.monthlyRateUsd ?? null;
  // An empty list is a zero only if the endpoint answered. The adapter reports
  // a null unrealized sum when positions were unavailable, so an empty list
  // next to a null sum is an unread book and says so.
  const positionsRead = positions.length > 0 || finite(unrealizedPnlUsd);
  const claimedMonthlyUsd = comparison?.claimedMonthlyUsd ?? claim?.monthlyUsd ?? null;
  const standing = comparison
    ? VERDICT_STANDING[comparison.verdict]
    : claim
      ? standingOf(claimedMonthlyUsd, monthlyRateUsd, spanIsFloor)
      : "untested";
  const chip = comparison || claim ? STANDING_CHIP[standing] : null;
  const citesRate = standing === "supported" || standing === "under" || standing === "ahead";

  const windowPhrase = `${spanIsFloor ? "at least " : ""}${
    finite(windowDays) ? `${windowDays} days on record` : "the window on record"
  }`;
  const rateAgainstClaim = `${usd(monthlyRateUsd)} a month across ${windowPhrase}, against a claimed ${usd(claimedMonthlyUsd)}`;
  const derivedHeadline =
    standing === "supported"
      ? `The claim holds on this wallet: ${rateAgainstClaim}.`
      : standing === "under"
        ? `This wallet runs under the claim: ${rateAgainstClaim}.`
        : standing === "ahead"
          ? `This wallet runs ahead of the claim: ${rateAgainstClaim}.`
          : finite(profitUsd)
            ? `This wallet cleared ${usd(profitUsd)} on ${
                finite(volumeUsd) ? `${usd(volumeUsd)} of volume` : "volume this scan could not read"
              } across ${windowPhrase}${
                finite(returnOnVolumePct) ? `, a ${pct2(returnOnVolumePct)} return on volume` : ""
              }.`
            : "Polymarket did not report this wallet's profit, so there is no record here to hold a claim to.";
  const headline = statement || derivedHeadline;

  const firstDay = fullDay(record?.firstTradeAt);
  const lastDay = fullDay(record?.lastTradeAt);
  const windowSentence = firstDay && lastDay
    ? `Window: ${firstDay} to ${lastDay}${finite(windowDays) ? `, ${spanIsFloor ? "at least " : ""}${windowDays} days` : ""}.`
    : finite(windowDays)
      ? `Window: ${spanIsFloor ? "at least " : ""}${windowDays} days of activity.`
      : "";
  // The one hedge this card is allowed, and it is the same trap every time: a
  // rate taken over a window this short is that window's own average and says
  // nothing about the next one. On a page-limited feed it is also a maximum,
  // because the span it was divided by is a minimum.
  //
  // The page-limit case is checked FIRST rather than inside the rate branch.
  // A floored window can pull the standing to not_checkable, and that is exactly
  // when the reader most needs to be told why: nested under citesRate the hedge
  // would fall through to "the claim states no rate", which is the wrong reason.
  const hedge = spanIsFloor
    ? "The monthly figure is that window's own average, and the activity feed was read to its page limit, so the window is a floor and the average a ceiling."
    : citesRate
      ? "The monthly figure is that window's own average, not a rate going forward."
      : claim
        ? "The claim states no rate this record can be measured against, so what stands is the record itself."
        : windowSentence
          ? "Everything below is that window and nothing outside it."
          : "";
  const subhead = [windowSentence, hedge].filter(Boolean).join(" ");

  const giveBack = hasCurve ? deepestGiveBack(values) : null;
  const peakDay = giveBack ? shortDay(series[giveBack.peakIndex]?.at) : null;
  const troughDay = giveBack ? shortDay(series[giveBack.troughIndex]?.at) : null;
  // Both ends or neither: half a span reads as a date the give-back happened on.
  const giveBackDays = peakDay && troughDay ? `${peakDay} to ${troughDay}` : null;
  const plot = hasCurve ? plotCurve(values) : null;
  const lastValue = values.length ? values[values.length - 1] : null;
  const curveTone = finite(lastValue) && lastValue < 0 ? "var(--color-avoid)" : "var(--color-pass)";
  const gradientId = `pm-curve-${wallet.slice(2, 10) || "series"}`;
  const zeroY = plot ? plot.y(0) : 0;

  return (
    <section className="panel scroll-mt-28 px-4 py-4 sm:px-5" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="eyebrow">Polymarket record</p>
        <a
          href={`https://polymarket.com/profile/${encodeURIComponent(wallet)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={wallet}
          className="link-ext mono text-[11px] text-ink-faint"
        >
          {record?.displayName ? `${record.displayName} · ` : ""}
          {shortWallet(wallet)}
        </a>
      </div>

      {/*
        Proven versus attributed, in the same split deployerRoleLabel makes: the
        chain proves what an address did, and no endpoint on it proves who holds
        the address. A wallet published in a post is still only the wallet the
        poster chose to publish.
      */}
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        {claim?.walletPublished
          ? "The post published this wallet. What the wallet did is proven below; that the poster controls it is not, and other wallets they may trade are not in view."
          : "What this wallet did is proven below. Who controls it is not established here, and other wallets it may trade alongside are not in view."}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h2 id={titleId} className="display-sm min-w-0 text-[18px] leading-snug text-ink">
          {headline}
        </h2>
        {chip && <span className={`chip ${chip.tint} chip-wrap`}>{chip.label}</span>}
      </div>
      {subhead.trim() && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{subhead}</p>}

      {claim && <ClaimQuote claim={claim} />}

      {/*
        Profit never travels alone. On a wallet that turned $403K of volume to
        clear $9.96K, the profit figure is the flattering half of a two-part
        fact, and the return on volume is the part that decides whether the edge
        is real.
      */}
      <div className="mt-4 border-t border-line/60 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12.5px] font-medium text-ink-dim">Realized: what the wallet closed</h3>
          <span className="mono text-[10.5px] text-ink-faint">all time</span>
        </div>
        <dl className="mt-2 grid gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="realized profit"
            value={usd(profitUsd)}
            detail="closed positions, all time"
            tone={finite(profitUsd) && profitUsd < 0 ? "text-avoid" : undefined}
          />
          <Stat label="volume traded" value={usd(volumeUsd)} detail="what it took to earn that" />
          <Stat label="return on volume" value={pct2(returnOnVolumePct)} detail="profit as a share of volume" />
          <Stat
            label="window on record"
            value={finite(windowDays) ? `${spanIsFloor ? "at least " : ""}${windowDays} days` : UNMEASURED}
            detail={[
              firstDay && lastDay ? `${firstDay} to ${lastDay}` : "first to last activity",
              spanIsFloor ? "read to the feed's page limit" : "",
            ]
              .filter(Boolean)
              .join(", ")}
          />
          {/*
            Breadth of the closed record, so it sits with the realized figures.
            It spent a draft under "Unrealized: what is still open", where the
            closing line calls everything in the group an open bet: an all-time
            count of markets traded is not one, and the group it is filed under
            is a claim about it.

            The detail carries the leaderboard RANK and never that endpoint's
            `amount`, which comes back as the wallet's volume whatever metric was
            ranked. Printing it as a profit would state 403657 for a wallet that
            made 9964.30.
          */}
          <Stat
            label="markets traded"
            value={count(marketsTraded)}
            detail={[
              "distinct markets, all time",
              finite(rank) ? `profit leaderboard rank #${rank.toLocaleString("en-US")}` : "",
            ]
              .filter(Boolean)
              .join(", ")}
          />
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Profit alone flatters a high-churn wallet, so it is published next to the volume it took to earn.
        </p>
      </div>

      {/*
        The second question, kept as a second question. Open cash PnL is not a
        result and is never added to the realized figure above; summing them
        would publish a number no endpoint reported.
      */}
      <div className="mt-4 border-t border-line/60 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12.5px] font-medium text-ink-dim">Unrealized: what is still open</h3>
          <span className="mono text-[10.5px] text-ink-faint">right now</span>
        </div>
        <dl className="mt-2 grid gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="unrealized on open bets"
            value={usdSigned(unrealizedPnlUsd)}
            detail="cash PnL on positions still running"
            tone={finite(unrealizedPnlUsd) && unrealizedPnlUsd < 0 ? "text-avoid" : undefined}
          />
          <Stat label="portfolio value now" value={usd(portfolioValueUsd)} detail="what the open book is worth" />
          <Stat
            label="open positions"
            value={
              positionsCapped
                ? `at least ${count(positions.length)}`
                : positionsRead
                  ? count(positions.length)
                  : UNMEASURED
            }
            detail={positionsCapped ? "the position list was read to its page limit" : "positions still running"}
          />
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          These are open bets, not results. They are reported apart from the realized figures and never added to them.
          {positionsCapped
            ? " The list was cut short, so the unrealized figure covers only the positions this scan could read and the rows it missed could move it either way."
            : ""}
        </p>
      </div>

      {/*
        The curve is the part a screenshot leaves out. It carries the drawdown
        mark and the share of the profit that landed in the last 30 days, which
        is what tells a steady record apart from one accelerating month.
      */}
      <figure className="mt-4 border-t border-line/60 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <figcaption className="text-[12.5px] font-medium text-ink-dim">Cumulative realized profit</figcaption>
          <span className="mono text-[10.5px] text-ink-faint">
            {series.length ? `${series.length} daily points` : "no daily series"}
          </span>
        </div>
        {plot ? (
          <>
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="mt-3 w-full"
              preserveAspectRatio="none"
              style={{ height: CHART_H }}
              role="img"
              aria-label={`Cumulative realized profit across ${series.length} daily points, ending at ${usdSigned(lastValue)}${
                giveBack ? ", with the deepest give-back from the running peak marked" : ""
              }`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={curveTone} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={curveTone} stopOpacity="0" />
                </linearGradient>
              </defs>
              {giveBack && (
                <rect
                  x={plot.x(giveBack.peakIndex)}
                  y={CHART_PAD}
                  width={Math.max(1, plot.x(giveBack.troughIndex) - plot.x(giveBack.peakIndex))}
                  height={CHART_H - CHART_PAD * 2}
                  fill="var(--color-avoid)"
                  opacity="0.14"
                />
              )}
              <polygon
                points={`${plot.x(0).toFixed(1)},${zeroY.toFixed(1)} ${plot.polyline} ${plot.x(values.length - 1).toFixed(1)},${zeroY.toFixed(1)}`}
                fill={`url(#${gradientId})`}
              />
              <line
                x1={CHART_PAD}
                x2={CHART_W - CHART_PAD}
                y1={zeroY}
                y2={zeroY}
                stroke="var(--color-line-2)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <polyline
                points={plot.polyline}
                fill="none"
                stroke={curveTone}
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              <span style={{ color: curveTone }}>
                {usdSigned(lastValue)} <span className="text-ink-faint">cumulative, realized only</span>
              </span>
              {finite(maxDrawdownUsd) && (
                <span className="text-avoid">
                  -{usd(maxDrawdownUsd)}
                  {finite(maxDrawdownPct) ? ` (${pct1(maxDrawdownPct)})` : ""}{" "}
                  <span className="text-ink-faint">
                    deepest give-back
                    {giveBackDays ? `, ${giveBackDays}` : ""}
                  </span>
                </span>
              )}
              {finite(recentSharePct) && (
                <span className="text-ink-dim">
                  {pct1(recentSharePct)}{" "}
                  <span className="text-ink-faint">of the profit landed in the last 30 days</span>
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
            The daily profit series did not answer, so there is no curve here. That is a series this scan is missing,
            not a flat one.
          </p>
        )}
        <dl className="mt-3 grid gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="avg per 30 days"
            value={usd(monthlyRateUsd)}
            // A reader scanning tiles may never reach the sentence above, and on
            // a page-limited span this figure is a ceiling rather than an
            // average. The tile has to survive being read on its own.
            detail={
              spanIsFloor
                ? "a ceiling: the window it divides by is a floor"
                : "the window's own average, looking back"
            }
          />
          <Stat label="green days" value={pct1(greenDayPct)} detail="days the curve closed up" />
          <Stat label="best day" value={usdSigned(bestDayUsd)} detail="largest single-day gain in the window" />
          <Stat
            label="worst day"
            value={usdSigned(worstDayUsd)}
            detail="largest single-day loss in the window"
            tone={finite(worstDayUsd) && worstDayUsd < 0 ? "text-avoid" : undefined}
          />
        </dl>
      </figure>

      <Caveats notes={notes} />

      {/*
        ScoreContext's ProviderFailureNotice is the house idiom for this and was
        the first choice, but it classifies a {provider, op, meta} triple by
        regex to decide its wording. TraderRecord.failures is already one plain
        sentence per endpoint, so routing it through that classifier would mean
        inventing the triple it reads. The visual language is copied; the
        fabricated structure is not.
      */}
      {failures.length > 0 && (
        <div className="finding tint-caution mt-3 px-4 py-3" role="note">
          <p className="text-[12.5px] font-medium text-ink">
            {failures.length} source{failures.length === 1 ? "" : "s"} did not answer for this wallet.
          </p>
          <ul className="mt-1.5 space-y-1">
            {failures.map((failure) => (
              <li key={failure} className="text-[11.5px] leading-relaxed text-ink-dim">
                {failure}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
            Whatever those sources would have added is missing from this page, not zero in it. Run the check again
            later to try them.
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Read from Polymarket's public endpoints: the leaderboard for profit and volume, the data API for the open book
        and activity, and the daily profit series for the curve. Every figure is that wallet's, over the window shown.
      </p>
    </section>
  );
}
