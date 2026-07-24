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

    expect(container.textContent).toContain("$VVV market scale and performance");
    expect(container.textContent).toContain("$610.00M");
    expect(container.textContent).toContain("From all-time high");
    expect(container.textContent).toContain("-91.9%");
    expect(container.textContent).toContain("ATH $31");
    expect(container.textContent).toContain("CANONICAL TOKEN");
    expect(container.textContent).toContain("Captured market scale");
    expect(container.textContent).toContain("These bars compare captured values");
    expect(harness.sparkline).toHaveBeenCalledWith(expect.objectContaining({
      address,
      pairAddress: "project-pool",
      history: expect.objectContaining({
        points: [2, 2.8, 2.5],
        capturedAt: project.capturedAt,
      }),
    }));
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
    expect(container.textContent).not.toContain("CANONICAL TOKEN");
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

    expect(container.textContent).toContain("From captured peak");
    expect(container.textContent).toContain("-16.7%");
    expect(container.textContent).toContain("Refresh true ATH");
    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes("Refresh true ATH"));
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
    expect(container.textContent).toContain("LIVE SUPPLEMENT");
  });
});
