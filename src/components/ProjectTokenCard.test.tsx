// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTokenSnapshot } from "../data/evidence";

const harness = vi.hoisted(() => ({ sparkline: vi.fn() }));
vi.mock("./TokenSparkline", () => ({
  TokenSparkline: (props: Record<string, unknown>) => {
    harness.sparkline(props);
    return <div data-testid="token-chart">chart</div>;
  },
}));

import { ProjectTokenCard } from "./ProjectTokenCard";

const token: ProjectTokenSnapshot = {
  verified: true,
  verification: "official_x",
  name: "Jupiter",
  symbol: "JUP",
  coingeckoId: "jupiter-exchange-solana",
  rank: 89,
  address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  chain: "solana",
  homepage: "https://jup.ag/",
  officialX: "@JupiterExchange",
  sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
  capturedAt: "2026-07-12T22:37:00.000Z",
  priceUsd: 0.2,
  marketCapUsd: 620_000_000,
  fdvUsd: 1_400_000_000,
  volume24hUsd: 42_000_000,
  liquidityUsd: 18_000_000,
  pairAddress: "credible-jup-usdc-pool",
  history: {
    points: [0.18, 0.21, 0.2],
    first: 0.18,
    last: 0.2,
    peak: 0.21,
    changePct: 11.1,
    drawdownPct: -4.8,
    timeframe: "day",
    poolAddress: "credible-jup-usdc-pool",
  },
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  harness.sparkline.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ProjectTokenCard", () => {
  it("renders frozen fundamentals and chart even when the report verdict is incomplete", () => {
    const onAudit = vi.fn();
    act(() => root.render(<ProjectTokenCard token={token} showCurrentIntelligence={false} onAudit={onAudit} />));

    expect(container.textContent).toContain("Token and market");
    expect(container.textContent).toContain("$JUP");
    expect(container.textContent).toContain("CoinGecko #89");
    expect(container.textContent).toContain("$620.00M");
    expect(container.textContent).toContain("From captured peak");
    expect(container.textContent).toContain("Official site");
    expect(harness.sparkline).toHaveBeenCalledWith(expect.objectContaining({
      address: token.address,
      chain: "solana",
      pairAddress: "credible-jup-usdc-pool",
      history: expect.objectContaining({
        ...token.history,
        capturedAt: token.capturedAt,
      }),
    }));

    const action = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Open full on-chain investigation"));
    act(() => action?.click());
    expect(onAudit).toHaveBeenCalledWith(token.address);
  });

  it("does not fetch a live chart for a frozen snapshot without frozen history", () => {
    const withoutHistory = { ...token, history: undefined };
    act(() => root.render(<ProjectTokenCard token={withoutHistory} showCurrentIntelligence={false} />));

    expect(container.textContent).toContain("Check current market data");
    expect(harness.sparkline).not.toHaveBeenCalled();
  });

  it("labels a DEX-native canonical token with its actual market source", () => {
    const dexNative: ProjectTokenSnapshot = {
      ...token,
      coingeckoId: undefined,
      rank: null,
      chain: "robinhood",
      sourceUrl: "https://dexscreener.com/robinhood/pons-pool",
      providers: ["dexscreener", "geckoterminal"],
    };
    act(() => root.render(<ProjectTokenCard token={dexNative} showCurrentIntelligence={false} />));

    expect(container.textContent).toContain("DexScreener");
    expect(container.textContent).not.toContain("CoinGecko #");
    expect(container.querySelector('a[href="https://dexscreener.com/robinhood/pons-pool"]')?.textContent)
      .toContain("DexScreener");
  });
});
