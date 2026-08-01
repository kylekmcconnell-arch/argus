import { describe, expect, it } from "vitest";
import { CLAIM_TOLERANCE_PCT, analyzeRecord, compareMonthlyClaim } from "./record";
import type { TraderRecord } from "./types";

// The calibration case is macau.weather, the wallet @0xSurferX published next to
// a "passive $6k / month" claim, read live on 2026-08-01. Every figure asserted
// below came off the public endpoints: profit $9,964.30, volume $403,462.20, a
// 53-day record, 9.6% max drawdown, 70% green days, 81% of the profit in the
// last 30 days. The fixture reproduces that curve day by day so the derivation
// is checked against a real shape rather than a convenient one.
const WALLET = "0x4989bfed5900ba096b08ba1f9b718464527c983e";
const DAY_MS = 24 * 60 * 60 * 1_000;
const SERIES_START = Date.UTC(2026, 5, 9);

const MACAU_DELTAS: number[] = [
  // The first 23 days: 15 up, 8 down, +1,894.38 in all, which is the 19% of the
  // profit that landed before the trailing 30 day window opens.
  ...Array.from({ length: 7 }, () => [200, 200, -150]).flat(),
  200, -55.62,
  // The next 21 days, a steadier and larger clip: 15 up, 6 down, +3,300.
  ...Array.from({ length: 6 }, () => [300, 300, -200]).flat(),
  300, 300, 300,
  // The last 9 days: the best day, the $10,210 peak, the worst day, and the
  // $982 slide off that peak the record never fully recovers.
  1612, 1000, 1000, 1000, 403.62, -847, -135, 400, 342.38,
];

function series(deltas: number[], startMs = SERIES_START): TraderRecord["pnlSeries"] {
  // The endpoint returns a CUMULATIVE series, so the fixture cumulates too: a
  // derivation that quietly treated these as daily figures would pass on a
  // fixture of daily numbers and fail on production data.
  const points = [{ at: new Date(startMs).toISOString(), cumulativeUsd: 0 }];
  let total = 0;
  deltas.forEach((delta, index) => {
    total += delta;
    points.push({ at: new Date(startMs + (index + 1) * DAY_MS).toISOString(), cumulativeUsd: total });
  });
  return points;
}

function record(overrides: Partial<TraderRecord> = {}): TraderRecord {
  return {
    wallet: WALLET,
    displayName: "macau.weather",
    profitUsd: 9964.30,
    volumeUsd: 403462.20,
    portfolioValueUsd: 544.24,
    marketsTraded: 592,
    rank: 14765,
    firstTradeAt: "2026-06-10T00:00:00.000Z",
    lastTradeAt: "2026-08-01T23:59:00.000Z",
    pnlSeries: series(MACAU_DELTAS),
    openPositions: [{ title: "Will the Fed cut in September?", cashPnlUsd: -196.80, currentValueUsd: 544.24 }],
    unrealizedPnlUsd: -196.80,
    failures: [],
    ...overrides,
  };
}

const noteMatching = (notes: string[], fragment: string) => notes.filter((note) => note.includes(fragment));

describe("analyzeRecord on the live macau.weather record", () => {
  it("reproduces every figure the live read produced", () => {
    const analysis = analyzeRecord(record());

    expect(analysis.windowDays).toBe(53);
    // 2.47%: a thin edge churned over $403k of volume, which is the finding.
    expect(analysis.returnOnVolumePct).toBeCloseTo(2.47, 2);
    expect(analysis.maxDrawdownUsd).toBeCloseTo(982, 2);
    expect(analysis.maxDrawdownPct).toBeCloseTo(9.6, 1);
    expect(Math.round(analysis.greenDayPct!)).toBe(70);
    expect(analysis.greenDayPct).toBeCloseTo(69.81, 2);
    expect(analysis.bestDayUsd).toBeCloseTo(1612, 2);
    expect(analysis.worstDayUsd).toBeCloseTo(-847, 2);
    expect(Math.round(analysis.recentSharePct!)).toBe(81);
    // 9964.30 / 53 * 30. The published window and the published rate divide into
    // each other, so a reader can check the arithmetic by hand.
    expect(analysis.monthlyRateUsd).toBeCloseTo(5640.17, 2);
  });

  it("measures the drawdown from the running peak, not from the final value", () => {
    const analysis = analyzeRecord(record());

    // The record ends $239.62 below its $10,210 peak. Reading the drawdown off
    // the last point would report that instead of the $982 the wallet actually
    // sat through.
    expect(analysis.maxDrawdownUsd).toBeCloseTo(982, 2);
    expect(analysis.maxDrawdownUsd).not.toBeCloseTo(239.62, 2);
  });

  it("says the 53 day window cannot carry a run rate", () => {
    const analysis = analyzeRecord(record());

    expect(noteMatching(analysis.notes, "53-day record")).toHaveLength(1);
    expect(analysis.notes.join(" ")).toContain("not a forecast");
  });

  it("calls the curve back-weighted against what a steady 53 days would look like", () => {
    const analysis = analyzeRecord(record());
    const backWeighted = noteMatching(analysis.notes, "back-weighted");

    expect(backWeighted).toHaveLength(1);
    // The note has to carry both shares. 81% means nothing to a reader who does
    // not know a flat curve over the same span already reads 57%.
    expect(backWeighted[0]).toContain("81%");
    expect(backWeighted[0]).toContain("57%");
  });

  it("keeps the unrealized loss out of every realized figure and names it separately", () => {
    const analysis = analyzeRecord(record());
    const separation = noteMatching(analysis.notes, "not netted");

    expect(separation).toHaveLength(1);
    expect(separation[0]).toContain("$196.80");
    // Netting the open loss into the record would give 5,528.44 per month.
    expect(analysis.monthlyRateUsd).toBeCloseTo(5640.17, 2);
    expect(analysis.monthlyRateUsd).not.toBeCloseTo(5528.44, 2);
  });

  it("does not call 592 markets a small sample", () => {
    const analysis = analyzeRecord(record());

    expect(noteMatching(analysis.notes, "small sample")).toHaveLength(0);
  });
});

describe("analyzeRecord separates unmeasured from zero", () => {
  it("returns null for every curve figure when no daily series answered", () => {
    const analysis = analyzeRecord(record({ pnlSeries: [] }));

    expect(analysis.maxDrawdownUsd).toBeNull();
    expect(analysis.maxDrawdownPct).toBeNull();
    expect(analysis.greenDayPct).toBeNull();
    expect(analysis.bestDayUsd).toBeNull();
    expect(analysis.worstDayUsd).toBeNull();
    expect(analysis.recentSharePct).toBeNull();
    expect(noteMatching(analysis.notes, "unmeasured rather than flat")).toHaveLength(1);
    // Profit and the trade dates still answered, so the rate survives the gap.
    expect(analysis.windowDays).toBe(53);
    expect(analysis.monthlyRateUsd).toBeCloseTo(5640.17, 2);
  });

  it("reports a measured zero drawdown when the series was read and never fell", () => {
    const analysis = analyzeRecord(record({ pnlSeries: series([100, 100, 100, 100]) }));

    expect(analysis.maxDrawdownUsd).toBe(0);
    expect(analysis.greenDayPct).toBe(100);
  });

  it("leaves return on volume unmeasured when volume did not answer", () => {
    const analysis = analyzeRecord(record({ volumeUsd: null }));

    expect(analysis.returnOnVolumePct).toBeNull();
    expect(noteMatching(analysis.notes, "unmeasured, not zero")).toHaveLength(1);
  });

  it("withholds a drawdown percent when the peak was never above water", () => {
    const analysis = analyzeRecord(record({
      profitUsd: -250,
      pnlSeries: series([-100, -300, 150]),
    }));

    expect(analysis.maxDrawdownUsd).toBeCloseTo(400, 2);
    expect(analysis.maxDrawdownPct).toBeNull();
    // A share of a loss inverts its own sign, so it is withheld too.
    expect(analysis.recentSharePct).toBeNull();
    expect(noteMatching(analysis.notes, "never held a peak above water")).toHaveLength(1);
  });

  it("falls back to the daily series for the window when the trade history did not answer", () => {
    const analysis = analyzeRecord(record({
      firstTradeAt: null,
      lastTradeAt: null,
      failures: ["The activity endpoint did not answer, so the first and last trade are unknown."],
    }));

    // The series spans 53 days from its own first point to its last.
    expect(analysis.windowDays).toBe(53);
    expect(noteMatching(analysis.notes, "came from the daily profit series")).toHaveLength(1);
  });
});

describe("analyzeRecord thresholds are relative, not fixed", () => {
  it("does not call a steady curve back-weighted even though most of its profit is recent", () => {
    // A perfectly flat $188 per day over the same 53 days puts 57% of its profit
    // in the trailing 30 days purely because the window is short. A fixed
    // "over 60% is back-weighted" rule would be silent here and loud on records
    // that are actually flat.
    const analysis = analyzeRecord(record({ pnlSeries: series(Array.from({ length: 53 }, () => 188)) }));

    expect(Math.round(analysis.recentSharePct!)).toBe(57);
    expect(noteMatching(analysis.notes, "back-weighted")).toHaveLength(0);
  });

  it("calls a high return on volume over a handful of markets a small sample", () => {
    const analysis = analyzeRecord(record({ profitUsd: 4000, volumeUsd: 20000, marketsTraded: 6 }));

    const smallSample = noteMatching(analysis.notes, "small sample");
    expect(smallSample).toHaveLength(1);
    expect(smallSample[0]).toContain("6 markets");
  });

  it("drops the run rate caveat once the record is long enough to carry one", () => {
    const analysis = analyzeRecord(record({
      firstTradeAt: "2026-01-01T00:00:00.000Z",
      lastTradeAt: "2026-08-01T00:00:00.000Z",
    }));

    expect(analysis.windowDays).toBe(212);
    expect(noteMatching(analysis.notes, "cannot support a monthly figure as a run rate")).toHaveLength(0);
  });
});

describe("compareMonthlyClaim against the published wallet", () => {
  it("holds the $6k per month claim and carries the back-weighting caveat with it", () => {
    const comparison = compareMonthlyClaim(6000, record());

    expect(comparison.verdict).toBe("holds");
    expect(comparison.observedMonthlyUsd).toBeCloseTo(5640.17, 2);
    expect(comparison.windowDays).toBe(53);
    expect(comparison.deviationPct).toBeCloseTo(6.38, 2);
    // The verdict is worthless without the caveats that qualify it.
    expect(noteMatching(comparison.notes, "back-weighted")).toHaveLength(1);
    expect(noteMatching(comparison.notes, "53-day record")).toHaveLength(1);
  });

  it("states the window in the same breath as the rate and never annualises", () => {
    const comparison = compareMonthlyClaim(6000, record());

    expect(comparison.statement).toContain("53 days on record");
    expect(comparison.statement).toContain("per month");
    expect(comparison.statement).not.toMatch(/annual|per year|yearly|a year/i);
    // 5640.17 * 12, the number this lane exists to not print. The notes are
    // searched too: the only place the word annualised may appear is in the
    // caveat that says the rate is never annualised.
    const everything = `${comparison.statement} ${comparison.notes.join(" ")}`;
    expect(everything).not.toContain("67,682");
    expect(everything).not.toContain("67682");
    expect(everything).not.toMatch(/per year|yearly/i);
  });

  it("says a wallet proves the wallet and not the person", () => {
    const comparison = compareMonthlyClaim(6000, record());

    expect(noteMatching(comparison.notes, "does not prove the poster controls it")).toHaveLength(1);
    expect(comparison.notes[0]).toContain("does not rule out other wallets");
  });

  it("calls a claim well above the record overstated and one well below it understated", () => {
    expect(compareMonthlyClaim(12000, record()).verdict).toBe("overstated");
    expect(compareMonthlyClaim(3000, record()).verdict).toBe("understated");
    expect(compareMonthlyClaim(12000, record()).statement).toContain("above the record");
    expect(compareMonthlyClaim(3000, record()).statement).toContain("below the record");
  });

  it("holds to the edge of the tolerance and no further", () => {
    const observed = analyzeRecord(record()).monthlyRateUsd!;

    // Exactly on the tolerance is inside it, in both directions, and a claim
    // half a point outside it is not.
    expect(compareMonthlyClaim(observed * (1 + CLAIM_TOLERANCE_PCT / 100), record()).verdict).toBe("holds");
    expect(compareMonthlyClaim(observed * (1 - CLAIM_TOLERANCE_PCT / 100), record()).verdict).toBe("holds");
    expect(compareMonthlyClaim(observed * (1 + (CLAIM_TOLERANCE_PCT + 0.5) / 100), record()).verdict).toBe("overstated");
    expect(compareMonthlyClaim(observed * (1 - (CLAIM_TOLERANCE_PCT + 0.5) / 100), record()).verdict).toBe("understated");
  });
});

describe("compareMonthlyClaim when there is nothing to check against", () => {
  it("returns not_checkable, never false, when no wallet was published", () => {
    const comparison = compareMonthlyClaim(6000, null);

    expect(comparison.verdict).toBe("not_checkable");
    expect(comparison.statement).toContain("not checkable as written");
    expect(comparison.statement).toContain("never disproved");
    expect(comparison.observedMonthlyUsd).toBeNull();
    expect(comparison.notes.join(" ")).toContain("never guessed");
  });

  it("treats a blank wallet the same as an absent one", () => {
    const comparison = compareMonthlyClaim(6000, record({ wallet: "   " }));

    expect(comparison.verdict).toBe("not_checkable");
  });

  it("returns not_checkable when the wallet answered but the inputs did not", () => {
    const comparison = compareMonthlyClaim(6000, record({ profitUsd: null }));

    expect(comparison.verdict).toBe("not_checkable");
    expect(comparison.statement).toContain("not checkable against it");
    expect(comparison.statement).toContain("not evidence either way");
    // The window was measured even though the profit was not, and saying so is
    // more useful than a row of nulls.
    expect(comparison.windowDays).toBe(53);
    // The attribution caveat still applies to whatever the wallet did report.
    expect(noteMatching(comparison.notes, "does not prove the poster controls it")).toHaveLength(1);
  });

  it("returns not_checkable when the record has no dated history to average over", () => {
    const comparison = compareMonthlyClaim(6000, record({
      firstTradeAt: null,
      lastTradeAt: null,
      pnlSeries: [],
    }));

    expect(comparison.verdict).toBe("not_checkable");
    expect(comparison.windowDays).toBeNull();
  });

  it("returns not_checkable when no monthly figure was quoted", () => {
    const comparison = compareMonthlyClaim(null, record());

    expect(comparison.verdict).toBe("not_checkable");
    expect(comparison.claimedMonthlyUsd).toBeNull();
  });
});

/**
 * The adapter raises two flags when a read was cut short, and until now this
 * lane read neither. The flags are the difference between a measurement and a
 * bound, and the bound always points the flattering way: a shorter window makes
 * profit-per-month larger, and a shorter book makes the open risk look smaller.
 */
describe("a record the adapter flagged as a partial read", () => {
  it("calls a page-limited window a minimum and the rate it implies a ceiling", () => {
    const analysis = analyzeRecord(record({ activitySpanIsFloor: true }));

    // The arithmetic is unchanged: it is the reading of it that moves.
    expect(analysis.windowDays).toBe(53);
    expect(analysis.monthlyRateUsd).toBeCloseTo(5640.17, 2);
    expect(noteMatching(analysis.notes, "is the shortest this record can be")).toHaveLength(1);
    expect(noteMatching(analysis.notes, "is a ceiling, not an average")).toHaveLength(1);
  });

  it("says nothing about a ceiling when the feed was read whole", () => {
    const analysis = analyzeRecord(record());

    expect(noteMatching(analysis.notes, "is a ceiling, not an average")).toHaveLength(0);
  });

  it("calls a cut-short position list a floor, even when its sum came to zero", () => {
    // The case with no caveat is the one that most looks like an empty book: a
    // partial read that happens to net to nothing is not a wallet holding
    // nothing, and the unread rows carry signed money either way.
    const analysis = analyzeRecord(record({
      openPositions: [],
      unrealizedPnlUsd: 0,
      openPositionsCapped: true,
    }));

    expect(noteMatching(analysis.notes, "a floor rather than a count")).toHaveLength(1);
    expect(noteMatching(analysis.notes, "could move that figure in either direction")).toHaveLength(1);
  });

  it("leaves an answered whole book uncaveated", () => {
    const analysis = analyzeRecord(record({ openPositions: [], unrealizedPnlUsd: 0 }));

    expect(noteMatching(analysis.notes, "a floor rather than a count")).toHaveLength(0);
  });
});

/**
 * A ceiling settles a claim in one direction only. If the highest rate the
 * record could support is already under the claim, the real rate is under it
 * too. If the ceiling sits at or above the claim, the truth can be anywhere
 * below and the comparison proves nothing.
 */
describe("comparing a claim against a page-limited window", () => {
  it("refuses the verdict a floored window would have flattered into holding", () => {
    const whole = compareMonthlyClaim(6000, record());
    expect(whole.verdict).toBe("holds");

    const floored = compareMonthlyClaim(6000, record({ activitySpanIsFloor: true }));

    expect(floored.verdict).toBe("not_checkable");
    // The figure survives, named as what it is. Withholding it would hide the
    // only number the read did produce.
    expect(floored.observedMonthlyUsd).toBeCloseTo(5640.17, 2);
    expect(floored.windowDays).toBe(53);
    expect(floored.statement).toContain("are a minimum");
    expect(floored.statement).toContain("is a ceiling rather than an average");
    // Not checkable is never a soft way of saying false.
    expect(floored.statement).not.toMatch(/\b(false|lying|fake|fraud)\b/i);
  });

  it("still calls a claim overstated when even the ceiling falls short of it", () => {
    const floored = compareMonthlyClaim(40_000, record({ activitySpanIsFloor: true }));

    expect(floored.verdict).toBe("overstated");
    expect(floored.statement).toContain("above the record");
  });

  it("refuses an understated verdict on a floored window too", () => {
    // A claim well under the ceiling could still be over the true rate, because
    // the true window can be longer than the one the page showed.
    const floored = compareMonthlyClaim(500, record({ activitySpanIsFloor: true }));

    expect(compareMonthlyClaim(500, record()).verdict).toBe("understated");
    expect(floored.verdict).toBe("not_checkable");
  });
});
