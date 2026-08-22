// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedSafety, TokenDossier } from "../token/audit";
import { TokenStory } from "./TokenStory";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const safety: NormalizedSafety = {
  available: false,
  simChecked: false,
  honeypot: false,
  honeypotOnchain: false,
  serialScammerCreator: false,
  mintable: false,
  freezable: false,
  nonTransferable: false,
  ownerRenounced: false,
  takeBack: false,
  hiddenOwner: false,
  selfdestruct: false,
  pausable: false,
  openSource: false,
  cannotSellAll: false,
  metadataMutable: false,
  buyTax: 0,
  sellTax: 0,
  holderCount: 0,
  topHolderPct: null,
  lpLocked: false,
  lpBurnedPct: 0,
  lpLockedPct: 0,
  lpTopUnlockedEoaPct: 0,
  balanceMutable: false,
  transferHook: false,
  transferFee: false,
  proxy: false,
  slippageModifiable: false,
  blacklist: false,
  tradingCooldown: false,
  externalCall: false,
  ownerChangeBalance: false,
  creatorPercent: 0,
};

const thin: TokenDossier = {
  address: "0x0000000000000000000000000000000000000001",
  chain: "ethereum",
  dexId: "uniswap",
  symbol: "GAP",
  name: "Gap Token",
  verdict: "CAUTION",
  score: 40,
  capApplied: null,
  headline: "Thin coverage",
  axes: [],
  safety,
  socials: [],
  projectX: null,
  deployer: null,
  topHolders: [],
  insiderPct: 0,
  bundleCount: 0,
  bundleRisk: "low",
  cg: null,
  graph: { nodes: [], edges: [] },
  findings: [],
  trace: [],
  live: true,
  safetyChecked: false,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TokenStory", () => {
  it("puts collector gaps in the decision-layer story with provenance tags", () => {
    act(() => {
      root.render(<TokenStory dossier={thin} />);
    });
    expect(container.querySelector("#token-story")).not.toBeNull();
    expect(container.querySelector("#token-evidence")).not.toBeNull();
    expect(container.textContent).toContain("checks could not be completed");
    expect(container.textContent).toContain("ARGUS could not identify the wallet that created the token");
    expect(container.textContent).toContain("Unestablished");
    expect(container.textContent).toContain("Launch age was not recorded.");
  });
});
