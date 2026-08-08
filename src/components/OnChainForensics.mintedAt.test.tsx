// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ operatorNetwork: vi.fn(), gmgnBundle: vi.fn() }));

vi.mock("./MarketIntel", () => ({ MarketIntel: () => null }));
vi.mock("./HolderForensics", () => ({ HolderForensics: () => null }));
vi.mock("./WalletClusters", () => ({ WalletClusters: () => null }));
vi.mock("./EntityConcentration", () => ({ EntityConcentration: () => null }));
vi.mock("./EvmDeployer", () => ({ EvmDeployer: () => null }));
vi.mock("./BytecodeForensics", () => ({ BytecodeForensics: () => null }));
vi.mock("./SanctionsScreen", () => ({ SanctionsScreen: () => null }));
vi.mock("./OperatorNetwork", () => ({ OperatorNetwork: (props: Record<string, unknown>) => { harness.operatorNetwork(props); return null; } }));
vi.mock("./GmgnBundlePanel", () => ({ GmgnBundlePanel: (props: Record<string, unknown>) => { harness.gmgnBundle(props); return null; } }));
vi.mock("./GmgnHolderCosts", () => ({ GmgnHolderCosts: () => null }));
vi.mock("./EarlyBuyerFunding", () => ({ EarlyBuyerFunding: () => null }));
vi.mock("./EvmLaunchBuyers", () => ({ EvmLaunchBuyers: () => null }));
vi.mock("./GovernancePanel", () => ({ GovernancePanel: () => null }));

import { OnChainForensics } from "./OnChainForensics";

const DEPLOYER = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const POOL_CREATED_AT = 1785450548000; // DexScreener reports pool creation in milliseconds

const token = (extra: Record<string, unknown> = {}): TokenDossier => ({
  address: "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump",
  chain: "solana",
  dexId: "raydium",
  symbol: "TEST",
  name: "Test",
  verdict: "CAUTION",
  score: 50,
  capApplied: null,
  headline: "",
  axes: [],
  safety: { available: false, simChecked: false } as TokenDossier["safety"],
  socials: [],
  projectX: null,
  deployer: DEPLOYER,
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
  ...extra,
} as unknown as TokenDossier);

let container: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
  harness.operatorNetwork.mockReset();
  harness.gmgnBundle.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  container.remove();
});

describe("on-chain forensics launch instant", () => {
  // Without an instant to measure against, the operator trace can only date the
  // deployer's age to the scan, so "how old was this wallet when it launched
  // this token" is unanswerable no matter how fresh the wallet is.
  it("forwards the launch instant an explicit caller supplies", async () => {
    await act(async () => {
      reactRoot.render(<OnChainForensics token={token()} onAudit={() => {}} panelCostToken="signed-panel" mintedAt={POOL_CREATED_AT} />);
    });

    expect(harness.operatorNetwork).toHaveBeenCalledWith(expect.objectContaining({ mintedAt: POOL_CREATED_AT }));
  });

  // The dossier already froze the pool's creation instant at scan time, so the
  // panel does not need the caller to re-thread it.
  it("falls back to the instant frozen on the dossier", async () => {
    await act(async () => {
      reactRoot.render(<OnChainForensics token={token({ pairCreatedAt: POOL_CREATED_AT })} onAudit={() => {}} panelCostToken="signed-panel" />);
    });

    expect(harness.operatorNetwork).toHaveBeenCalledWith(expect.objectContaining({ mintedAt: POOL_CREATED_AT }));
  });

  // A report frozen before the instant was recorded has no launch time. Passing
  // "now" in its place would date a months-old launch to today.
  it("passes no instant when neither source has one", async () => {
    await act(async () => {
      reactRoot.render(<OnChainForensics token={token()} onAudit={() => {}} panelCostToken="signed-panel" />);
    });

    expect(harness.operatorNetwork).toHaveBeenCalledWith(expect.objectContaining({ mintedAt: null }));
  });

  it("surfaces failed live launch forensics instead of silently preserving a clean-looking report", async () => {
    await act(async () => {
      reactRoot.render(<OnChainForensics token={token()} onAudit={() => {}} panelCostToken="signed-panel" />);
    });

    const props = harness.gmgnBundle.mock.calls[0]?.[0] as { onStatusChange?: (update: unknown) => void };
    await act(async () => {
      props.onStatusChange?.({ id: "gmgn-launch-pattern", label: "GMGN launch-pattern reading", state: "unavailable" });
    });

    expect(container.textContent).toContain("Current forensic coverage incomplete");
    // "did not finish" misdescribed a check that completed and answered that
    // it cannot cover the token. The banner names the outcome, not a crash.
    expect(container.textContent).toContain("GMGN launch-pattern reading produced no usable reading");
    expect(container.textContent).toContain("must not be read as a clean launch");
  });
});
