import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPriceHistory, summarizeCandles, readCandle, type Candle } from "./priceHistory";

afterEach(() => {
  vi.unstubAllGlobals();
});

const DAY = 86_400;

/** A daily candle, oldest-first callers supply the day index themselves. */
const candle = (day: number, close: number, extras: Partial<Candle> = {}): Candle =>
  ({ ts: day * DAY, close, ...extras });

describe("fetchPriceHistory", () => {
  it("dates the series so it can be frozen and distinguished from a live refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        attributes: {
          ohlcv_list: [
            [3, 0, 0, 0, 1.4],
            [1, 0, 0, 0, 1],
            [2, 0, 0, 0, 1.2],
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const history = await fetchPriceHistory(
      "0x4444444444444444444444444444444444444444",
      "ethereum",
      "0x5555555555555555555555555555555555555555",
    );

    expect(history).toMatchObject({
      points: [1, 1.2, 1.4],
      first: 1,
      last: 1.4,
      peak: 1.4,
      timeframe: "day",
    });
    expect(Date.parse(history?.capturedAt ?? "")).not.toBeNaN();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("carries the reported high, low and volume of every fetched candle through to the series", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        attributes: {
          // [ts, open, high, low, close, volume]
          ohlcv_list: [
            [3 * DAY, 1.2, 1.5, 1.1, 1.4, 900],
            [1 * DAY, 1, 1.1, 0.9, 1, 3_000],
            [2 * DAY, 1, 1.3, 0.95, 1.2, 2_000],
            [4 * DAY, 1.4, 1.45, 1.3, 1.35, 800],
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const history = await fetchPriceHistory(
      "0x4444444444444444444444444444444444444444",
      "ethereum",
      "0x5555555555555555555555555555555555555555",
    );

    expect(history?.range).toMatchObject({
      high: 1.5,
      low: 0.9,
      measuredPoints: 4,
      highs: [1.1, 1.3, 1.5, 1.45],
      lows: [0.9, 0.95, 1.1, 1.3],
    });
    expect(history?.volume).toMatchObject({
      recent: { usd: 1_700, candles: 2, measured: 2 },
      prior: { usd: 5_000, candles: 2, measured: 2 },
      isFloor: false,
    });
  });
});

describe("readCandle", () => {
  it("keeps a candle whose volume column is missing rather than dropping its close", () => {
    expect(readCandle([DAY, 1, 1.2, 0.9, 1.1])).toEqual({ ts: DAY, close: 1.1, high: 1.2, low: 0.9 });
    expect(readCandle([DAY, 1, 1.2, 0.9, 1.1, null])).toEqual({ ts: DAY, close: 1.1, high: 1.2, low: 0.9 });
  });

  it("records a reported zero volume as measured, and an absent one as unmeasured", () => {
    expect(readCandle([DAY, 1, 1.2, 0.9, 1.1, 0])?.volumeUsd).toBe(0);
    expect(readCandle([DAY, 1, 1.2, 0.9, 1.1, "none"])?.volumeUsd).toBeUndefined();
  });

  it("refuses a row with no usable timestamp or close", () => {
    expect(readCandle([DAY, 1, 1.2, 0.9])).toBeNull();
    expect(readCandle([DAY, 1, 1.2, 0.9, null, 10])).toBeNull();
    expect(readCandle("not a candle")).toBeNull();
  });
});

describe("summarizeCandles", () => {
  it("measures the drawdown from the reported intraday high, not from the highest close", () => {
    // A one day pump and dump: the close series never moves, so a close-only
    // peak reports no drawdown at all while the day itself ran 40x and gave it
    // all back.
    const series = summarizeCandles([
      candle(1, 0.001, { high: 0.0011, low: 0.0009, volumeUsd: 5_000 }),
      candle(2, 0.001, { high: 0.04, low: 0.00095, volumeUsd: 900_000 }),
      candle(3, 0.001, { high: 0.0012, low: 0.00098, volumeUsd: 4_000 }),
    ], "day");

    expect(series?.peak).toBe(0.001);
    expect(series?.drawdownPct).toBeCloseTo(0, 6);
    expect(series?.range?.high).toBe(0.04);
    expect(series?.range?.drawdownFromHighPct).toBeCloseTo(-97.5, 3);
  });

  it("withholds the per-candle band when any candle left its range unmeasured", () => {
    const series = summarizeCandles([
      candle(1, 1, { high: 1.2, low: 0.9 }),
      candle(2, 1.1, { low: 1 }),
      candle(3, 1.2, { high: 1.4, low: 1.05 }),
    ], "day");

    expect(series?.range).toMatchObject({ high: 1.4, low: 0.9, measuredPoints: 2 });
    expect(series?.range?.highs).toBeUndefined();
    expect(series?.range?.lows).toBeUndefined();
  });

  it("treats a high that does not bracket its own close as unmeasured, never as a record", () => {
    const series = summarizeCandles([
      candle(1, 1, { high: 1.2, low: 0.9 }),
      candle(2, 5, { high: 0.5, low: 0.4 }),
    ], "day");

    expect(series?.range).toMatchObject({ high: 1.2, low: 0.9, measuredPoints: 1 });
  });

  it("says the market went quiet against the window before it, and names that window", () => {
    const series = summarizeCandles([
      ...Array.from({ length: 7 }, (_, index) => candle(index + 1, 1, { volumeUsd: 100_000 })),
      ...Array.from({ length: 7 }, (_, index) => candle(index + 8, 1, { volumeUsd: 6_000 })),
    ], "day");

    expect(series?.volume).toMatchObject({
      recent: { usd: 42_000, candles: 7, measured: 7 },
      prior: { usd: 700_000, candles: 7, measured: 7 },
      isFloor: false,
    });
    expect(series?.volume?.changePct).toBeCloseTo(-94, 3);
  });

  it("marks the volume windows a floor when a candle in one reported no volume", () => {
    const series = summarizeCandles([
      ...Array.from({ length: 7 }, (_, index) => candle(index + 1, 1, { volumeUsd: 100_000 })),
      ...Array.from({ length: 6 }, (_, index) => candle(index + 8, 1, { volumeUsd: 10_000 })),
      candle(14, 1),
    ], "day");

    expect(series?.volume).toMatchObject({
      recent: { usd: 60_000, candles: 7, measured: 6 },
      prior: { usd: 700_000, candles: 7, measured: 7 },
      isFloor: true,
    });
  });

  it("stays silent on volume when a window carried no volume column at all", () => {
    const series = summarizeCandles(
      Array.from({ length: 10 }, (_, index) => candle(index + 1, 1)),
      "day",
    );

    expect(series?.volume).toBeUndefined();
  });

  it("reports the window as partial when candles are missing from its span", () => {
    const series = summarizeCandles([
      candle(1, 1, { high: 1.1, low: 0.9 }),
      candle(2, 1.1, { high: 1.2, low: 1 }),
      candle(9, 1.2, { high: 1.3, low: 1.1 }),
      candle(10, 1.3, { high: 1.4, low: 1.2 }),
    ], "day");

    expect(series).toMatchObject({ spanPeriods: 10, windowIsPartial: true });
    expect(series?.points).toHaveLength(4);
  });

  it("reports a gapless window as whole", () => {
    const series = summarizeCandles(
      Array.from({ length: 5 }, (_, index) => candle(index + 1, 1 + index / 10)),
      "day",
    );

    expect(series).toMatchObject({ spanPeriods: 5, windowIsPartial: false });
  });

  it("says nothing about the span when the timestamps do not sit on the requested cadence", () => {
    const series = summarizeCandles([
      { ts: 100, close: 1 },
      { ts: 200, close: 1.1 },
      { ts: 300, close: 1.2 },
    ], "day");

    expect(series?.spanPeriods).toBeUndefined();
    expect(series?.windowIsPartial).toBeUndefined();
  });
});
