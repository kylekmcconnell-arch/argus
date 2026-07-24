// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenDossier } from "../token/audit";
import { TokenSnapshotVisuals } from "./TokenSnapshotVisuals";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const token: TokenDossier = {
  address: "0x4444444444444444444444444444444444444444",
  chain: "ethereum",
  dexId: "uniswap",
  pairAddress: "0x5555555555555555555555555555555555555555",
  symbol: "ARG",
  name: "Argus",
  priceChange: { m5: 0.4, h1: -1.2, h6: 3.5, h24: 8.2 },
  verdict: "PASS",
  score: 88,
  capApplied: null,
  headline: "Captured token visual test",
  axes: [
    { key: "T1", label: "Liquidity & lock", score: 22, weight: 24, rationale: "Deep liquidity." },
    { key: "T2", label: "Contract safety", score: 21, weight: 26, rationale: "Verified contract." },
  ],
  safety: {
    available: true,
    simChecked: true,
    holderCount: 18_420,
    lpBurnedPct: 40,
    lpLockedPct: 45,
    lpTopUnlockedEoaPct: 5,
  } as TokenDossier["safety"],
  socials: [],
  projectX: null,
  deployer: null,
  topHolders: [
    { address: "0x1111111111111111111111111111111111111111", percent: 12, tag: "custody" },
    { address: "0x2222222222222222222222222222222222222222", percent: 8 },
  ],
  insiderPct: 0,
  bundleCount: 0,
  bundleRisk: "low",
  cg: null,
  graph: { nodes: [], edges: [] },
  findings: [],
  trace: [],
  live: true,
  safetyChecked: true,
};

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

describe("TokenSnapshotVisuals", () => {
  it("renders saved market, holder, liquidity, and score charts without a fetch", () => {
    act(() => root.render(<TokenSnapshotVisuals token={token} />));

    expect(container.textContent).toContain("Market and ownership structure");
    expect(container.textContent).toContain("Price momentum at capture");
    expect(container.textContent).toContain("Holder distribution");
    expect(container.textContent).toContain("Liquidity control");
    expect(container.textContent).toContain("Forensic score profile");
    expect(container.querySelector('[role="img"][aria-label^="Supply distribution at capture"]')).not.toBeNull();
    expect(container.querySelector('[role="img"][aria-label^="Liquidity position at capture"]')).not.toBeNull();
  });

  it("suppresses a misleading holder chart when provider rows exceed total supply", () => {
    act(() => root.render(
      <TokenSnapshotVisuals
        token={{
          ...token,
          topHolders: [
            { address: "0x1111111111111111111111111111111111111111", percent: 70 },
            { address: "0x2222222222222222222222222222222222222222", percent: 45 },
          ],
        }}
      />,
    ));

    expect(container.textContent).toContain("suppressed a misleading chart");
    expect(container.querySelector('[role="img"][aria-label^="Supply distribution at capture"]')).toBeNull();
  });
});
