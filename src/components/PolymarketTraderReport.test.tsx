// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PolymarketTraderReport,
  type ClaimComparisonView,
  type PolymarketClaimView,
  type RecordAnalysisView,
  type TraderRecordView,
} from "./PolymarketTraderReport";

/**
 * The fixtures are the live 2026-08-01 probe of
 * 0x4989bfed5900ba096b08ba1f9b718464527c983e ("macau.weather"), the wallet
 * @0xSurferX published next to a "passive $6k / month" claim. Every figure
 * below came back from a keyless endpoint:
 *
 *   lb-api /profit?window=all    -> amount 9964.30, pseudonym "macau.weather"
 *   lb-api /volume?window=all    -> amount 403462.20
 *   lb-api /rank?rankType=pnl    -> rank 14765 (its `amount` is VOLUME whatever
 *                                   the rankType, so the rank is all we keep)
 *   data-api /value              -> 544.24
 *   data-api /traded             -> 592
 *   data-api /positions          -> 16 open, cashPnl summing to -196.80
 *   data-api /activity           -> first 2026-06-10, last 2026-08-01
 *   user-pnl  interval=all       -> 54 daily cumulative points, last 9970.38
 *
 * The only synthesized part is the interior of the daily series: the live 54
 * points are interpolated between the waypoints that carry the shape the panel
 * draws, so the peak, the 982 give-back and the close are the recorded ones.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const WALLET = "0x4989bfed5900ba096b08ba1f9b718464527c983e";
const DAY_MS = 86_400_000;
/** The first daily bucket the live user-pnl series returned. */
const SERIES_START = Date.UTC(2026, 5, 9);
/** [day index, cumulative realized USD] from the recorded series. */
const WAYPOINTS: Array<[number, number]> = [
  [0, 0],
  [23, 1880.4],
  [42, 10210.2],
  [46, 9228.2],
  [53, 9970.38],
];

function cumulativeAt(day: number): number {
  for (let index = 1; index < WAYPOINTS.length; index += 1) {
    const [priorDay, priorValue] = WAYPOINTS[index - 1];
    const [nextDay, nextValue] = WAYPOINTS[index];
    if (day <= nextDay) {
      const progress = (day - priorDay) / (nextDay - priorDay);
      return Number((priorValue + (nextValue - priorValue) * progress).toFixed(2));
    }
  }
  return WAYPOINTS[WAYPOINTS.length - 1][1];
}

const PNL_SERIES = Array.from({ length: 54 }, (_, day) => ({
  at: new Date(SERIES_START + day * DAY_MS).toISOString(),
  cumulativeUsd: cumulativeAt(day),
}));

/** Two of the sixteen open positions, in the shape data-api /positions returns. */
const OPEN_POSITIONS = [
  { title: "Will Trump attend the G20 summit?", cashPnlUsd: -84.12, currentValueUsd: 212.6 },
  { title: "Fed decision in September?", cashPnlUsd: -112.68, currentValueUsd: 331.64 },
];

const record = (overrides: Partial<TraderRecordView> = {}): TraderRecordView => ({
  wallet: WALLET,
  displayName: "macau.weather",
  profitUsd: 9964.3,
  volumeUsd: 403462.2,
  portfolioValueUsd: 544.24,
  marketsTraded: 592,
  rank: 14765,
  firstTradeAt: "2026-06-10T14:02:11.000Z",
  lastTradeAt: "2026-08-01T09:41:03.000Z",
  pnlSeries: PNL_SERIES,
  openPositions: OPEN_POSITIONS,
  unrealizedPnlUsd: -196.8,
  failures: [],
  ...overrides,
});

/**
 * The derivation lane's own output for that record: 9964.30 over 53 days is
 * 5640.17 per 30 days, and 9964.30 on 403462.20 of volume is 2.47%.
 */
const analysis = (overrides: Partial<RecordAnalysisView> = {}): RecordAnalysisView => ({
  windowDays: 53,
  returnOnVolumePct: 2.47,
  maxDrawdownUsd: 982,
  maxDrawdownPct: 9.6,
  greenDayPct: 69.8,
  bestDayUsd: 1612,
  worstDayUsd: -847,
  recentSharePct: 81.1,
  monthlyRateUsd: 5640.17,
  notes: [],
  ...overrides,
});

const claim = (overrides: Partial<PolymarketClaimView> = {}): PolymarketClaimView => ({
  quote: "passive $6k / month on polymarket, wallet below if you want to check",
  handle: "0xSurferX",
  url: "https://x.com/0xSurferX/status/2057712900000000001",
  monthlyUsd: 6000,
  walletPublished: true,
  ...overrides,
});

/** What the derivation lane hands over when it has already read the claim. */
const comparison = (overrides: Partial<ClaimComparisonView> = {}): ClaimComparisonView => ({
  verdict: "holds",
  claimedMonthlyUsd: 6000,
  observedMonthlyUsd: 5640.17,
  windowDays: 53,
  deviationPct: 6.4,
  statement: "The claim holds: this wallet averaged $5.64K a month over the 53 days on record, against a claimed $6K.",
  notes: [],
  ...overrides,
});

const render = (props: Parameters<typeof PolymarketTraderReport>[0]) => {
  act(() => {
    root.render(<PolymarketTraderReport {...props} />);
  });
};

const copy = (): string => container.textContent ?? "";

/** The value cell of one stat tile, found by its own label. */
function statValue(label: string): string | null {
  const tile = [...container.querySelectorAll("dl > div")].find(
    (candidate) => candidate.querySelector("dt")?.textContent === label,
  );
  return tile?.querySelector("dd")?.textContent ?? null;
}

/** The caption under one stat tile's value. */
function statDetail(label: string): string | null {
  const tile = [...container.querySelectorAll("dl > div")].find(
    (candidate) => candidate.querySelector("dt")?.textContent === label,
  );
  return [...(tile?.querySelectorAll("dd") ?? [])][1]?.textContent ?? null;
}

/**
 * An unchecked claim is unchecked. ARGUS never upgrades "nobody can verify
 * this" into an accusation, on any branch of this panel.
 */
const ACCUSATIONS = /\b(false|lie|lied|lying|liar|fake|faked|fraud|fraudulent|scam|scammer|fabricated|bogus)\b/i;
/** A window this short is reported as a window. It is never multiplied out. */
const ANNUALISED = /annualis|annualiz|annual|per year|a year|\bAPY\b|\bAPR\b/i;
/** A wallet is not a person, so no copy here gives one a pronoun. */
const PERSONIFIED = /\b(he|she|his|her|him|hers)\b/i;

describe("PolymarketTraderReport", () => {
  it("renders nothing when there is neither a wallet nor a claim", () => {
    render({ record: null, analysis: null, claim: null });
    expect(copy()).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });

  it("leads with not checkable as written when the post published no wallet", () => {
    render({ record: null, analysis: null, claim: claim({ walletPublished: false }) });

    expect(copy()).toContain("This claim is not checkable as written: no wallet was published with it.");
    expect(copy()).toContain("not checkable as written");
    expect(copy()).toContain("Polymarket answers for an address, not for a handle");
    expect(copy()).toContain("A wallet address or a polymarket.com/profile link");
    // The claim still stands on screen, in the poster's own words.
    expect(container.querySelector("blockquote")?.textContent).toContain("passive $6k / month");
    // Nothing was measured, so nothing is reported: no figures, no curve.
    expect(container.querySelector("svg")).toBeNull();
    expect(statValue("realized profit")).toBeNull();
    expect(copy()).not.toMatch(ACCUSATIONS);
  });

  it("leads with the verdict on the claim and the window it was measured over", () => {
    render({ record: record(), analysis: analysis(), claim: claim() });

    expect(container.querySelector("h2")?.textContent).toBe(
      "The claim holds on this wallet: $5.64K a month across 53 days on record, against a claimed $6.00K.",
    );
    expect(copy()).toContain("claim holds on this wallet");
    expect(copy()).toContain("Window: Jun 10, 2026 to Aug 1, 2026, 53 days.");
    expect(copy()).toContain("The monthly figure is that window's own average, not a rate going forward.");
    expect(copy()).not.toMatch(ANNUALISED);
    // 5640.17 x 12: the number this panel refuses to compute.
    expect(copy()).not.toContain("$67.7K");
  });

  it("says the record runs under the claim without calling the claim false", () => {
    render({ record: record(), analysis: analysis(), claim: claim({ monthlyUsd: 12000 }) });

    expect(container.querySelector("h2")?.textContent).toBe(
      "This wallet runs under the claim: $5.64K a month across 53 days on record, against a claimed $12.0K.",
    );
    expect(copy()).toContain("record runs under the claim");
    expect(copy()).not.toMatch(ACCUSATIONS);
  });

  it("reads a claim the record beats as a mismatch, not as a pass", () => {
    render({ record: record(), analysis: analysis(), claim: claim({ monthlyUsd: 3000 }) });

    expect(container.querySelector("h2")?.textContent).toBe(
      "This wallet runs ahead of the claim: $5.64K a month across 53 days on record, against a claimed $3.00K.",
    );
    expect(copy()).toContain("record runs ahead of the claim");
  });

  it("leads with the verified figures when no claim was supplied", () => {
    render({ record: record(), analysis: analysis() });

    expect(container.querySelector("h2")?.textContent).toBe(
      "This wallet cleared $9.96K on $403K of volume across 53 days on record, a 2.47% return on volume.",
    );
    expect(copy()).toContain("Window: Jun 10, 2026 to Aug 1, 2026, 53 days.");
    expect(copy()).toContain("Everything below is that window and nothing outside it.");
    expect(container.querySelector("blockquote")).toBeNull();
  });

  it("says the claim states no rate when the post named no figure", () => {
    render({ record: record(), analysis: analysis(), claim: claim({ quote: "polymarket has been good to me", monthlyUsd: null }) });

    expect(container.querySelector("h2")?.textContent).toContain("This wallet cleared $9.96K");
    expect(copy()).toContain("no rate under test");
    expect(copy()).toContain("The claim states no rate this record can be measured against");
  });

  it("publishes profit next to the volume it took, and the return on volume", () => {
    render({ record: record(), analysis: analysis() });

    expect(statValue("realized profit")).toBe("$9.96K");
    expect(statValue("volume traded")).toBe("$403K");
    expect(statValue("return on volume")).toBe("2.47%");
    expect(statValue("window on record")).toBe("53 days");
    expect(statDetail("window on record")).toBe("Jun 10, 2026 to Aug 1, 2026");
    expect(copy()).toContain("Profit alone flatters a high-churn wallet, so it is published next to the volume it took to earn.");
  });

  it("keeps realized and unrealized apart and never sums them", () => {
    render({ record: record(), analysis: analysis() });

    expect(copy()).toContain("Realized: what the wallet closed");
    expect(copy()).toContain("Unrealized: what is still open");
    expect(statValue("realized profit")).toBe("$9.96K");
    expect(statValue("unrealized on open bets")).toBe("-$196.8");
    expect(statValue("portfolio value now")).toBe("$544.24");
    expect(copy()).toContain("These are open bets, not results.");
    expect(copy()).toContain("never added to them");
    // 9964.30 + (-196.80): the merged headline number this panel will not print.
    expect(copy()).not.toContain("$9.77K");
  });

  it("publishes the leaderboard rank as a rank and never as an amount", () => {
    render({ record: record(), analysis: analysis() });

    expect(statValue("markets traded")).toBe("592");
    expect(statDetail("markets traded")).toBe("distinct markets, all time, profit leaderboard rank #14,765");
    // The rank endpoint's own `amount` is 403657, which is volume, not profit.
    // It never reaches this panel, so no dollar figure sits beside the rank.
    expect(copy()).not.toContain("$404K");
    expect(copy()).not.toContain("403,657");
  });

  it("files the all-time market count with the realized figures, not the open bets", () => {
    render({ record: record(), analysis: analysis() });

    // The group a tile sits in is a claim about it. "These are open bets, not
    // results" is false of an all-time count of markets closed, so the count
    // belongs on the realized side of the panel.
    const groups = Array.from(container.querySelectorAll("dl"));
    const realized = groups.find((dl) => dl.previousElementSibling?.textContent?.includes("Realized"));
    const unrealized = groups.find((dl) => dl.previousElementSibling?.textContent?.includes("Unrealized"));

    expect(realized?.textContent).toContain("markets traded");
    expect(unrealized?.textContent).not.toContain("markets traded");
  });

  it("reports an absent figure as unmeasured and never as a zero", () => {
    render({
      record: record({
        profitUsd: null,
        volumeUsd: null,
        portfolioValueUsd: null,
        marketsTraded: null,
        rank: null,
        openPositions: [],
        unrealizedPnlUsd: null,
        firstTradeAt: null,
        lastTradeAt: null,
      }),
      analysis: analysis({
        windowDays: null,
        returnOnVolumePct: null,
        maxDrawdownUsd: null,
        maxDrawdownPct: null,
        greenDayPct: null,
        bestDayUsd: null,
        worstDayUsd: null,
        recentSharePct: null,
        monthlyRateUsd: null,
      }),
    });

    expect(container.querySelector("h2")?.textContent).toBe(
      "Polymarket did not report this wallet's profit, so there is no record here to hold a claim to.",
    );
    expect(statValue("realized profit")).toBe("not reported");
    expect(statValue("volume traded")).toBe("not reported");
    expect(statValue("return on volume")).toBe("not reported");
    expect(statValue("window on record")).toBe("not reported");
    expect(statValue("unrealized on open bets")).toBe("not reported");
    expect(statValue("markets traded")).toBe("not reported");
    expect(statValue("avg per 30 days")).toBe("not reported");
    expect(statValue("green days")).toBe("not reported");
    // An empty position list next to an unmeasured sum is an unread book, not
    // an empty one, so it never prints as a count of zero.
    expect(statValue("open positions")).toBe("not reported");
    expect(copy()).not.toContain("$0");
    expect(copy()).not.toContain("0%");
    expect(copy()).not.toContain("N/A");
    // No window, so no window sentence and no rate hedge invented around one.
    expect(copy()).not.toContain("Window:");
  });

  it("reports a position list read to its page limit as a floor", () => {
    const capped = Array.from({ length: 500 }, (_, index) => ({
      title: `market ${index}`,
      cashPnlUsd: -1.2,
      currentValueUsd: 4.5,
    }));
    render({ record: record({ openPositions: capped }), analysis: analysis() });

    expect(statValue("open positions")).toBe("at least 500");
    expect(statDetail("open positions")).toBe("the position list was read to its page limit");
  });

  it("counts the open positions when the endpoint answered under its limit", () => {
    render({ record: record(), analysis: analysis() });

    expect(statValue("open positions")).toBe("2");
    expect(statDetail("open positions")).toBe("positions still running");
  });
});

describe("the equity curve", () => {
  it("draws the cumulative series and marks the deepest give-back", () => {
    render({ record: record(), analysis: analysis() });

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toContain("54 daily points");
    expect(svg?.getAttribute("aria-label")).toContain("deepest give-back");
    const polyline = svg?.querySelector("polyline")?.getAttribute("points") ?? "";
    expect(polyline.split(" ")).toHaveLength(54);
    // The give-back band: peak on day 42 (Jul 21) through the trough on day 46.
    expect(svg?.querySelector("rect")).not.toBeNull();

    expect(copy()).toContain("54 daily points");
    expect(copy()).toContain("Cumulative realized profit");
    // The curve is realized profit only. The open book never joins it.
    expect(copy()).toContain("+$9.97K cumulative, realized only");
    expect(copy()).toContain("-$982 (9.6%) deepest give-back, Jul 21 to Jul 25");
    expect(copy()).toContain("81.1% of the profit landed in the last 30 days");
  });

  it("keeps the drawdown numbers the derivation lane's, not the chart's", () => {
    // The mark is placed from the series; the figures beside it come from
    // RecordAnalysis, so the two can never state different drawdowns.
    render({ record: record(), analysis: analysis({ maxDrawdownUsd: 982, maxDrawdownPct: null }) });

    expect(copy()).toContain("-$982 ");
    expect(copy()).not.toContain("9.6%");
    expect(container.querySelector("svg rect")).not.toBeNull();
  });

  it("says the series is missing rather than drawing a flat line", () => {
    render({ record: record({ pnlSeries: [] }), analysis: analysis() });

    expect(container.querySelector("svg")).toBeNull();
    expect(copy()).toContain("no daily series");
    expect(copy()).toContain("That is a series this scan is missing, not a flat one.");
  });

  it("publishes the monthly average as a backward-looking one", () => {
    render({ record: record(), analysis: analysis() });

    expect(statValue("avg per 30 days")).toBe("$5.64K");
    expect(statDetail("avg per 30 days")).toBe("the window's own average, looking back");
    expect(statValue("best day")).toBe("+$1.61K");
    expect(statValue("worst day")).toBe("-$847");
    expect(statValue("green days")).toBe("69.8%");
    expect(copy()).not.toMatch(ANNUALISED);
  });
});

/**
 * The derivation lane publishes its own verdict and its own sentence. Two
 * places deriving one verdict is two places that can disagree about it, so when
 * a comparison is supplied the panel prints it rather than recomputing it.
 */
describe("a verdict the derivation lane already reached", () => {
  it("prints the supplied sentence instead of deriving a second one", () => {
    render({ record: record(), analysis: analysis(), claim: claim(), comparison: comparison() });

    expect(container.querySelector("h2")?.textContent).toBe(
      "The claim holds: this wallet averaged $5.64K a month over the 53 days on record, against a claimed $6K.",
    );
    expect(copy()).toContain("claim holds on this wallet");
    // The panel's own phrasing of the same verdict never appears beside it.
    expect(copy()).not.toContain("The claim holds on this wallet: $5.64K a month across");
  });

  it("says an overstated claim as the record running under it", () => {
    render({
      record: record(),
      analysis: analysis(),
      claim: claim({ monthlyUsd: 12000 }),
      comparison: comparison({
        verdict: "overstated",
        claimedMonthlyUsd: 12000,
        deviationPct: 112.8,
        statement: "The claim sits above this wallet: $5.64K a month over the 53 days on record, against a claimed $12K.",
      }),
    });

    expect(copy()).toContain("record runs under the claim");
    expect(copy()).toContain("The claim sits above this wallet");
    expect(copy()).not.toMatch(ACCUSATIONS);
  });

  it("keeps the record on the page when the claim itself is not checkable", () => {
    render({
      record: record(),
      analysis: analysis(),
      claim: claim({ quote: "polymarket has been good to me", monthlyUsd: null }),
      comparison: comparison({
        verdict: "not_checkable",
        claimedMonthlyUsd: null,
        observedMonthlyUsd: null,
        deviationPct: null,
        statement: "The post quotes no figure, so there is nothing here to measure this wallet against.",
      }),
    });

    expect(copy()).toContain("not checkable as written");
    expect(copy()).toContain("The post quotes no figure");
    // The claim is untestable; the wallet's own record still stands.
    expect(statValue("realized profit")).toBe("$9.96K");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("merges the two lanes' caveats and shows each one once", () => {
    const shared = "The record is one wallet's. Any other wallet the poster trades is outside this scan.";
    render({
      record: record(),
      analysis: analysis({ notes: [shared, "53 days cannot support a rate going forward."] }),
      claim: claim(),
      comparison: comparison({ notes: [shared, "The claimed figure was read from the post, not from Polymarket."] }),
    });

    const block = [...container.querySelectorAll("[role='note']")].find((node) =>
      node.textContent?.includes("What this record does not support"),
    );
    expect(block?.querySelectorAll("li")).toHaveLength(3);
    expect(block?.textContent).toContain("The claimed figure was read from the post");
  });

  it("carries the caveats onto the not-checkable panel, where there is no record at all", () => {
    render({
      record: null,
      analysis: null,
      claim: claim({ walletPublished: false }),
      comparison: comparison({
        verdict: "not_checkable",
        observedMonthlyUsd: null,
        windowDays: null,
        deviationPct: null,
        statement: "No wallet was published with this claim, so it is not checkable as written.",
        notes: ["An X handle cannot be resolved to a Polymarket wallet, so no record was read."],
      }),
    });

    expect(container.querySelector("h2")?.textContent).toBe(
      "No wallet was published with this claim, so it is not checkable as written.",
    );
    expect(copy()).toContain("An X handle cannot be resolved to a Polymarket wallet");
  });
});

/**
 * A page-limited read is a floor. Neither flag reaches the derivation lane, so
 * the panel is the last place either one can be told to the reader.
 */
describe("a read that was cut short", () => {
  it("floors a flagged position list at the rows in hand, not at the page size", () => {
    // The fixture holds two positions. The flag also fires when a single row
    // would not parse, so "at least 500" here would invent 498 open bets to
    // avoid understating none: the floor is what was actually read.
    render({ record: record({ openPositionsCapped: true }), analysis: analysis() });

    expect(statValue("open positions")).toBe("at least 2");
    expect(statDetail("open positions")).toBe("the position list was read to its page limit");
    expect(copy()).not.toContain("at least 500");
    expect(copy()).toContain("the rows it missed could move it either way");
  });

  it("refuses to call a claim held when the window it divides by is a floor", () => {
    render({ record: record({ activitySpanIsFloor: true }), analysis: analysis(), claim: claim() });

    // 9964.30 over AT LEAST 53 days is AT MOST 5640.17 a month. A ceiling that
    // lands within the tolerance band cannot settle the claim, because the true
    // rate sits somewhere below it. The record still publishes in full.
    expect(container.querySelector("h2")?.textContent).toBe(
      "This wallet cleared $9.96K on $403K of volume across at least 53 days on record, a 2.47% return on volume.",
    );
    expect(copy()).toContain("not checkable as written");
    expect(copy()).not.toContain("The claim holds on this wallet");
    expect(statValue("window on record")).toBe("at least 53 days");
    expect(statDetail("window on record")).toBe("Jun 10, 2026 to Aug 1, 2026, read to the feed's page limit");
    expect(copy()).toContain("so the window is a floor and the average a ceiling");
    // The tile has to hold up alone, for a reader who scans and never reads on.
    expect(statDetail("avg per 30 days")).toBe("a ceiling: the window it divides by is a floor");
    expect(copy()).not.toMatch(ANNUALISED);
  });

  it("still calls a claim overstated when even the ceiling falls short of it", () => {
    // The one verdict a ceiling can carry: the record's highest possible rate is
    // already under the claim, so the real one is further under still.
    render({
      record: record({ activitySpanIsFloor: true }),
      analysis: analysis(),
      claim: claim({ monthlyUsd: 40_000 }),
    });

    expect(copy()).toContain("record runs under the claim");
    expect(copy()).not.toContain("not checkable as written");
  });
});

describe("what the panel refuses to assert", () => {
  it("proves the wallet's record and never the poster's ownership of it", () => {
    render({ record: record(), analysis: analysis(), claim: claim() });

    expect(copy()).toContain(
      "The post published this wallet. What the wallet did is proven below; that the poster controls it is not, and other wallets they may trade are not in view.",
    );
    expect(copy()).not.toMatch(PERSONIFIED);
    expect(copy()).not.toMatch(ACCUSATIONS);
  });

  it("says who controls the wallet is unestablished when no post published it", () => {
    render({ record: record(), analysis: analysis() });

    expect(copy()).toContain("What this wallet did is proven below. Who controls it is not established here");
    expect(copy()).toContain("other wallets it may trade alongside are not in view");
  });

  it("links the wallet to its Polymarket profile and names it as the leaderboard does", () => {
    render({ record: record(), analysis: analysis() });

    const link = container.querySelector(`a[href="https://polymarket.com/profile/${WALLET}"]`);
    expect(link?.textContent).toBe("macau.weather · 0x4989…983e");
    expect(link?.getAttribute("title")).toBe(WALLET);
  });
});

describe("the caveats and the gaps", () => {
  const NOTES = [
    "53 days is one accelerating month plus a quiet one. It cannot support a monthly rate going forward.",
    "81% of the profit landed in the last 30 days, so the average is back-weighted.",
    "The record is one wallet's. Any other wallet the poster trades is outside this scan.",
  ];

  it("renders every caveat in the reading path", () => {
    render({ record: record(), analysis: analysis({ notes: NOTES }), claim: claim() });

    const block = [...container.querySelectorAll("[role='note']")].find((node) =>
      node.textContent?.includes("What this record does not support"),
    );
    expect(block).not.toBeUndefined();
    for (const note of NOTES) expect(block?.textContent).toContain(note);
    expect(block?.querySelectorAll("li")).toHaveLength(3);
    // A caveat a reader has to open is a caveat the report did not make.
    expect(container.querySelector("details")).toBeNull();
  });

  it("names on screen what did not answer, and calls the gap a gap", () => {
    const failures = [
      "The daily profit series did not answer, so the curve and the drawdown are missing.",
      "The open-positions endpoint timed out, so nothing here reports the open book.",
    ];
    render({ record: record({ failures }), analysis: analysis() });

    const block = [...container.querySelectorAll("[role='note']")].find((node) =>
      node.textContent?.includes("did not answer for this wallet"),
    );
    expect(block?.textContent).toContain("2 sources did not answer for this wallet.");
    for (const failure of failures) expect(block?.textContent).toContain(failure);
    expect(block?.textContent).toContain("missing from this page, not zero in it");
  });

  it("counts one failed source as one", () => {
    render({ record: record({ failures: ["lb-api returned no volume for this wallet."] }), analysis: analysis() });

    expect(copy()).toContain("1 source did not answer for this wallet.");
  });

  it("shows no caveat block and no failure block when there is nothing to say", () => {
    render({ record: record(), analysis: analysis() });

    expect(copy()).not.toContain("What this record does not support");
    expect(copy()).not.toContain("did not answer for this wallet");
  });
});
