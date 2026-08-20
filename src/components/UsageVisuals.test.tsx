// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageVisuals } from "./UsageVisuals";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  slug: "uniswap",
  name: "Uniswap",
  symbol: "UNI",
  tvlUsd: 3_180_000_000,
  chains: ["Ethereum", "Base", "Arbitrum"],
  chainBreakdown: [
    { chain: "Ethereum", tvlUsd: 2_200_000_000 },
    { chain: "Base", tvlUsd: 500_000_000 },
    { chain: "Arbitrum", tvlUsd: 300_000_000 },
    { chain: "Polygon", tvlUsd: 100_000_000 },
    { chain: "Optimism", tvlUsd: 50_000_000 },
    { chain: "BSC", tvlUsd: 30_000_000 },
  ],
  geckoId: "uniswap",
  change30dPct: 2.1,
  trend: [
    { date: "2026-05-01", tvlUsd: 2_900_000_000 },
    { date: "2026-06-01", tvlUsd: 3_050_000_000 },
    { date: "2026-07-22", tvlUsd: 3_180_000_000 },
  ],
  sourceUrl: "https://defillama.com/protocol/uniswap",
  capturedAt: "2026-07-22T21:24:00.000Z",
  ...overrides,
});

describe("UsageVisuals", () => {
  it("draws the TVL trend line and the per-chain bar from the frozen snapshot", () => {
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(<UsageVisuals tvl={snapshot() as any} />);
    });
    expect(container.textContent).toContain("Capital footprint");
    expect(container.textContent).toContain("$3.18B");
    expect(container.textContent).toContain("+2.1% vs 30 days ago");
    expect(container.querySelector("polyline")).not.toBeNull();
    const chainBar = container.querySelector('[aria-label^="Value locked by chain"]');
    expect(chainBar?.getAttribute("aria-label")).toContain("Ethereum $2.20B");
    expect(container.textContent).toContain("2 more chains");
    expect(container.textContent).toContain("69%");
  });

  it("renders the chain bar alone when the snapshot predates the frozen trend", () => {
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(<UsageVisuals tvl={snapshot({ trend: undefined }) as any} />);
    });
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector('[aria-label^="Value locked by chain"]')).not.toBeNull();
  });

  it("renders nothing without chartable data", () => {
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(<UsageVisuals tvl={snapshot({ trend: undefined, chainBreakdown: [{ chain: "Ethereum", tvlUsd: 1 }] }) as any} />);
    });
    expect(container.textContent).toBe("");
  });

  it("does not render stale TVL charts or a synthetic zero when the metric is checked-empty", () => {
    act(() => {
      root.render(
        <UsageVisuals
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tvl={snapshot({ tvlUsd: null, tvlState: "checked_empty" }) as any}
        />,
      );
    });
    expect(container.textContent).toBe("");
    expect(container.textContent).not.toContain("$0");
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector('[aria-label^="Value locked by chain"]')).toBeNull();
  });

  it("uses the fee receipt when a checked-empty protocol row has no TVL visual", () => {
    act(() => {
      root.render(
        <UsageVisuals
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tvl={snapshot({ tvlUsd: null, tvlState: "checked_empty" }) as any}
          fees={{
            slug: "uniswap",
            total24hUsd: 3_000_000,
            total30dUsd: 85_800_000,
            sourceUrl: "https://api.llama.fi/summary/fees/uniswap",
            capturedAt: "2026-07-23T00:00:00.000Z",
          }}
        />,
      );
    });
    expect(container.textContent).toContain("$85.8M");
    expect(container.querySelector('a[href="https://api.llama.fi/summary/fees/uniswap"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://defillama.com/protocol/uniswap"]')).toBeNull();
  });

  it("shows the fee stat and the holder-concentration bar when frozen", () => {
    act(() => {
      root.render(
        <UsageVisuals
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tvl={snapshot() as any}
          fees={{
            slug: "uniswap",
            total24hUsd: 3_000_000,
            total30dUsd: 85_800_000,
            change30dOver30dPct: 3.4,
            sourceUrl: "https://defillama.com/protocol/uniswap",
            capturedAt: "2026-07-22T21:24:00.000Z",
          }}
          holders={{
            topHolderPct: 11,
            top10Pct: 38,
            assessedWalletCount: 10,
            top10PctIsFloor: false,
            holderCount: 140_972,
            lpLockedOrBurnedPct: 62,
            sourceUrl: "https://gopluslabs.io/",
            capturedAt: "2026-07-22T21:24:00.000Z",
          }}
        />,
      );
    });
    expect(container.textContent).toContain("$85.8M");
    expect(container.textContent).toContain("+3.4% vs prior 30 days");
    expect(container.textContent).toContain("38%");
    expect(container.textContent).toContain("of supply sits with the top 10");
    const holderBar = container.querySelector('[aria-label^="Supply split"]');
    expect(holderBar?.getAttribute("aria-label")).toContain("largest holder 11%");
    expect(holderBar?.getAttribute("aria-label")).toContain("next 9 holders 27%");
    expect(holderBar?.getAttribute("aria-label")).toContain("everyone else 62%");
    expect(container.textContent).toContain("140,972 holders");
    expect(container.textContent).toContain("LP 62% locked or burned");
  });

  it("hides the holder bar on inconsistent percentages", () => {
    act(() => {
      root.render(
        <UsageVisuals
          holders={{
            topHolderPct: 44,
            top10Pct: 38,
            assessedWalletCount: 10,
            top10PctIsFloor: false,
            holderCount: 100,
            lpLockedOrBurnedPct: null,
            sourceUrl: "https://gopluslabs.io/",
            capturedAt: "2026-07-22T21:24:00.000Z",
          }}
        />,
      );
    });
    expect(container.querySelector('[aria-label^="Supply split"]')).toBeNull();
  });

  it("labels a short holder register as a floor across the assessed wallet count", () => {
    act(() => {
      root.render(
        <UsageVisuals
          holders={{
            topHolderPct: 20,
            top10Pct: 38,
            assessedWalletCount: 4,
            top10PctIsFloor: true,
            holderCount: 1_000,
            lpLockedOrBurnedPct: null,
            holdersAssessed: true,
            distributionSource: "goplus",
            distributionNote: "The combined share is a floor across four assessed wallets.",
            sourceUrl: "https://gopluslabs.io/",
            capturedAt: "2026-07-22T21:24:00.000Z",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("38%");
    expect(container.textContent).toContain("at least 38%of supply across 4 assessed wallets");
    expect(container.textContent).not.toContain("of supply sits with the top 10");
    expect(container.querySelector('[aria-label^="Supply split"]')?.getAttribute("aria-label"))
      .toContain("outside assessed rows");
  });

  // The collector can suppress concentration (unordered register, a register
  // that sums past supply, or every row a pool). Rendering nothing leaves the
  // reader to conclude concentration was fine; it was never measured.
  it("says a suppressed distribution was not measured, and why", () => {
    act(() => {
      root.render(
        <UsageVisuals
          holders={{
            topHolderPct: null,
            top10Pct: null,
            holderCount: 140_972,
            lpLockedOrBurnedPct: 62,
            holdersAssessed: false,
            distributionSource: null,
            distributionNote: "The GoPlus holder rows sum past 100% of supply, so the register is self-inconsistent and holder concentration is not reported.",
            contractFlags: [],
            creatorPct: null,
            sourceUrl: "https://gopluslabs.io/",
            capturedAt: "2026-07-22T21:24:00.000Z",
          }}
        />,
      );
    });
    expect(container.querySelector('[aria-label^="Supply split"]')).toBeNull();
    expect(container.textContent).toContain("not measured");
    expect(container.textContent).toContain("sum past 100% of supply");
    // Never a zero and never an empty bar standing in for the missing figure.
    expect(container.textContent).not.toContain("of supply sits with the top 10");
  });

  it("carries the explorer attribution when the figures are not GoPlus's own", () => {
    act(() => {
      root.render(
        <UsageVisuals
          holders={{
            topHolderPct: 4.17,
            top10Pct: 22,
            assessedWalletCount: 10,
            top10PctIsFloor: false,
            holderCount: 900,
            lpLockedOrBurnedPct: null,
            holdersAssessed: true,
            distributionSource: "explorer",
            distributionNote: "Holder concentration is the chain explorer's ordered register, since GoPlus does not order its holder rows on this chain.",
            contractFlags: [],
            creatorPct: null,
            sourceUrl: "https://gopluslabs.io/",
            capturedAt: "2026-07-22T21:24:00.000Z",
          }}
        />,
      );
    });
    expect(container.textContent).toContain("chain explorer's ordered register");
  });
});
