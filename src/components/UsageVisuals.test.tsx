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
});
