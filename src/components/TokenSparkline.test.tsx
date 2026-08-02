// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceHistory } from "../lib/priceHistory";
import { TokenSparkline } from "./TokenSparkline";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = "0x4444444444444444444444444444444444444444";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(history: PriceHistory) {
  act(() => {
    root.render(<TokenSparkline address={ADDRESS} chain="ethereum" history={history} />);
  });
}

/** A flat close series that hides a 40x spike inside a single day. */
function pumpAndDump(): PriceHistory {
  const points = [0.001, 0.001, 0.001, 0.001];
  return {
    points,
    first: 0.001,
    last: 0.001,
    peak: 0.001,
    changePct: 0,
    drawdownPct: 0,
    timeframe: "day",
    range: {
      high: 0.04,
      low: 0.0009,
      drawdownFromHighPct: -97.5,
      measuredPoints: 4,
      highs: [0.0011, 0.04, 0.0012, 0.0011],
      lows: [0.0009, 0.00095, 0.00098, 0.00099],
    },
  };
}

describe("TokenSparkline", () => {
  it("draws the reported high and low band behind the close line", () => {
    render(pumpAndDump());

    const band = host.querySelector("[data-testid='range-band']");
    expect(band).not.toBeNull();
    // The band sets the scale, so the spike is drawn at full height (y near the
    // top pad) rather than clipped away by a close-only range.
    const spikeY = Number(band?.getAttribute("points")?.split(" ")[1]?.split(",")[1]);
    expect(spikeY).toBeCloseTo(3, 1);
    expect(host.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("states the fall from the reported window high, not from a peak measured on closes", () => {
    render(pumpAndDump());

    expect(host.textContent).toContain("-97.5%");
    expect(host.textContent).toContain("from the window high");
    expect(host.textContent).not.toContain("from the highest close");
  });

  it("says a high is this source's reading for that period and not an all-time high", () => {
    render(pumpAndDump());

    expect(host.textContent).toContain("not a proven all-time high");
  });

  it("labels a close-only series as a close peak when no range was reported", () => {
    render({
      points: [2, 3, 1.5],
      first: 2,
      last: 1.5,
      peak: 3,
      changePct: -25,
      drawdownPct: -50,
      timeframe: "day",
    });

    expect(host.querySelector("[data-testid='range-band']")).toBeNull();
    expect(host.textContent).toContain("from the highest close");
    expect(host.textContent).not.toContain("all-time high");
  });

  it("names the window a volume trend is measured over, and flags a quiet market", () => {
    render({
      ...pumpAndDump(),
      volume: {
        recent: { usd: 35_000, candles: 7, measured: 7 },
        prior: { usd: 700_000, candles: 7, measured: 7 },
        changePct: -95,
        isFloor: false,
      },
    });

    expect(host.textContent).toContain("volume -95.0%");
    expect(host.textContent).toContain("vs the prior 7 days");
  });

  it("calls a volume window with an unreported candle a floor", () => {
    render({
      ...pumpAndDump(),
      volume: {
        recent: { usd: 35_000, candles: 7, measured: 6 },
        prior: { usd: 700_000, candles: 7, measured: 7 },
        changePct: -95,
        isFloor: true,
      },
    });

    expect(host.textContent).toContain("a floor: not every candle reported volume");
  });

  it("reports a gapped series as a partial read of its own window", () => {
    render({ ...pumpAndDump(), spanPeriods: 16, windowIsPartial: true });

    expect(host.textContent).toContain("over 4 of 16 days observed");
  });

  it("counts only the candles that reported a range when some did not", () => {
    render({
      ...pumpAndDump(),
      range: { high: 0.04, low: 0.0009, drawdownFromHighPct: -97.5, measuredPoints: 2 },
    });

    expect(host.querySelector("[data-testid='range-band']")).toBeNull();
    expect(host.textContent).toContain("reported range over 2 of 4 days");
  });
});
