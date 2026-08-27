// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTokenSnapshot } from "../data/evidence";
import type { TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ sparkline: vi.fn() }));
vi.mock("./TokenSparkline", () => ({
  TokenSparkline: (props: Record<string, unknown>) => {
    harness.sparkline(props);
    return <div data-testid="market-chart">chart</div>;
  },
}));

import { marketCapPosition, marketSizeBand } from "../lib/marketPosition";
import { MarketPerformancePanel } from "./MarketPerformancePanel";

const address = "0x4444444444444444444444444444444444444444";

function token(overrides: Partial<TokenDossier> = {}): TokenDossier {
  return {
    address,
    chain: "ethereum",
    dexId: "uniswap",
    pairAddress: "0x5555555555555555555555555555555555555555",
    symbol: "VVV",
    name: "Venice Token",
    priceUsd: 2.5,
    mcap: 320_000_000,
    liquidityUsd: 9_000_000,
    vol24: 18_000_000,
    priceChange: { m5: 0.4, h1: -1.2, h6: 3.5, h24: 8.2 },
    priceHistory: {
      points: [2, 3, 2.5],
      first: 2,
      last: 2.5,
      peak: 3,
      changePct: 25,
      drawdownPct: -16.6667,
      timeframe: "day",
      capturedAt: "2026-07-20T12:00:00.000Z",
    },
    verdict: "PASS",
    score: 88,
    capApplied: null,
    headline: "Test",
    axes: [],
    safety: { available: true, simChecked: true } as TokenDossier["safety"],
    socials: [],
    projectX: null,
    deployer: null,
    topHolders: [],
    insiderPct: 0,
    bundleCount: 0,
    bundleRisk: "low",
    cg: {
      listed: true,
      rank: 122,
      mcapUsd: 300_000_000,
      marketCount: 12,
      cexCount: 4,
      cexNames: [],
      homepage: null,
      twitter: null,
      image: null,
      description: null,
      ath: { priceUsd: 24.5, date: "2025-01-15T00:00:00.000Z", drawdownPct: -89.8 },
    },
    graph: { nodes: [], edges: [] },
    findings: [],
    trace: [],
    live: true,
    safetyChecked: true,
    ...overrides,
  };
}

function projectToken(overrides: Partial<ProjectTokenSnapshot> = {}): ProjectTokenSnapshot {
  return {
    verified: true,
    verification: "official_x",
    name: "Venice Token",
    symbol: "VVV",
    coingeckoId: "venice-token",
    rank: 95,
    address,
    chain: "ethereum",
    sourceUrl: "https://www.coingecko.com/en/coins/venice-token",
    capturedAt: "2026-07-21T12:00:00.000Z",
    priceUsd: 2.5,
    marketCapUsd: 610_000_000,
    fdvUsd: 900_000_000,
    volume24hUsd: 42_000_000,
    liquidityUsd: 21_000_000,
    pairAddress: "project-pool",
    ath: { priceUsd: 31, date: "2025-02-01T00:00:00.000Z", drawdownPct: -91.9 },
    history: {
      points: [2, 2.8, 2.5],
      first: 2,
      last: 2.5,
      peak: 2.8,
      changePct: 25,
      drawdownPct: -10.714,
      timeframe: "day",
      poolAddress: "project-pool",
    },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  harness.sparkline.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MarketPerformancePanel", () => {
  it("prefers an exact frozen canonical-token snapshot for scale, ATH, and price history", () => {
    const project = projectToken();
    act(() => root.render(
      <MarketPerformancePanel
        token={token()}
        projectToken={project}
        showCurrentIntelligence={false}
      />,
    ));

    expect(container.textContent).toContain("$VVV market and price");
    expect(container.textContent).toContain("$610.00M");
    expect(container.textContent).toContain("From all-time high");
    expect(container.textContent).toContain("-91.9%");
    expect(container.textContent).toContain("ATH $31");
    expect(container.textContent).toContain("OFFICIAL TOKEN");
    expect(container.textContent).toContain("Market size");
    expect(container.textContent).toContain("Values shown are from the time of this scan");
    expect(container.textContent).toContain("CoinGecko global market-cap rank");
    expect(harness.sparkline).toHaveBeenCalledWith(expect.objectContaining({
      address,
      pairAddress: "project-pool",
      history: expect.objectContaining({
        points: [2, 2.8, 2.5],
        capturedAt: project.capturedAt,
      }),
    }));
  });

  it("uses an approximate market-cap percentile when a DEX-native token has no global rank", () => {
    act(() => root.render(
      <MarketPerformancePanel
        projectToken={projectToken({
          coingeckoId: undefined,
          rank: null,
          chain: "robinhood",
          sourceUrl: "https://dexscreener.com/robinhood/pons-pool",
          providers: ["dexscreener", "geckoterminal"],
        })}
        showCurrentIntelligence={false}
      />,
    ));

    expect(container.textContent).not.toContain("Market rank");
    expect(container.textContent).toContain("Market position");
    expect(container.textContent).toContain("Top ~2%");
    expect(container.textContent).toContain("Approximate market-cap position from the saved market cap");
    expect(container.textContent).not.toContain("Not listed");
  });

  it("keeps market-size fallback thresholds explicit", () => {
    expect(marketSizeBand(99_999)).toBe("Under $100K");
    expect(marketSizeBand(1_370_000)).toBe("$1M–$10M");
    expect(marketSizeBand(1_000_000_000)).toBe("$1B+");
    expect(marketSizeBand(null)).toBeNull();
  });

  it("keeps broad percentile thresholds deterministic", () => {
    expect(marketCapPosition(1_530_000)?.label).toBe("Top ~20%");
    expect(marketCapPosition(610_000_000)?.label).toBe("Top ~2%");
    expect(marketCapPosition(80_000)?.label).toBe("Lower half");
    expect(marketCapPosition(null)).toBeNull();
  });

  it("rejects a mismatched project token instead of lending its market record to the subject", () => {
    act(() => root.render(
      <MarketPerformancePanel
        token={token()}
        projectToken={projectToken({ address: "0x9999999999999999999999999999999999999999", marketCapUsd: 4_000_000_000 })}
        showCurrentIntelligence={false}
      />,
    ));

    expect(container.textContent).toContain("$300.00M");
    expect(container.textContent).not.toContain("$4.00B");
    expect(container.textContent).not.toContain("OFFICIAL TOKEN");
  });

  it("labels the captured-window peak honestly when a legacy snapshot has no lifetime ATH", () => {
    const refresh = vi.fn();
    act(() => root.render(
      <MarketPerformancePanel
        token={token({ cg: { ...token().cg!, ath: null } })}
        showCurrentIntelligence={false}
        onLoadCurrentIntelligence={refresh}
      />,
    ));

    // "Peak" is ambiguous between a close and a reported intraday high, and
    // this figure is neither an all-time nor a market-wide record.
    expect(container.textContent).toContain("From the highest close in the window");
    expect(container.textContent).toContain("-16.7%");
    expect(container.textContent).toContain("Check all-time high");
    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes("Check all-time high"));
    act(() => button?.click());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("loads a clearly labeled current ATH supplement only after refresh is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tickers: [],
      market_cap_rank: 101,
      links: { homepage: [], twitter_screen_name: "" },
      market_data: {
        market_cap: { usd: 630_000_000 },
        ath: { usd: 32 },
        ath_date: { usd: "2025-02-02T00:00:00.000Z" },
        ath_change_percentage: { usd: -92.2 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await act(async () => {
      root.render(
        <MarketPerformancePanel
          token={token({ cg: { ...token().cg!, ath: null } })}
          showCurrentIntelligence
          refreshCurrentMarket
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("From all-time high");
    expect(container.textContent).toContain("-92.2%");
    expect(container.textContent).toContain("CURRENT DATA");
  });

  // The close series is blind to a candle that ran and gave it back, and a
  // count of candles is not a count of consecutive periods.
  it("prefers the reported window high and names it, over a close-based peak", () => {
    const base = token();
    act(() => root.render(
      <MarketPerformancePanel
        token={{
          ...base,
          cg: { ...base.cg!, ath: null },
          priceHistory: {
            points: [2, 2, 2],
            first: 2,
            last: 2,
            peak: 2,
            changePct: 0,
            drawdownPct: 0,
            range: { high: 80, low: 1.9, drawdownFromHighPct: -97.5, measuredPoints: 3 },
            timeframe: "day",
            capturedAt: "2026-07-20T12:00:00.000Z",
          },
        }}
        showCurrentIntelligence={false}
        onLoadCurrentIntelligence={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("-97.5%");
    expect(container.textContent).toContain("From the highest reported day high");
    // The stat itself must never claim to be the lifetime record.
    expect(container.textContent).not.toContain("From all-time high");
  });

  it("states observed periods out of the span when the window has holes", () => {
    const base = token();
    act(() => root.render(
      <MarketPerformancePanel
        token={{
          ...base,
          cg: { ...base.cg!, ath: null },
          priceHistory: {
            ...base.priceHistory!,
            spanPeriods: 30,
            windowIsPartial: true,
          },
        }}
        showCurrentIntelligence={false}
        onLoadCurrentIntelligence={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("3 of 30 days observed");
  });
});
