// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSafety, TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ livePanel: vi.fn() }));

vi.mock("./TokenSparkline", () => ({ TokenSparkline: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: (props: Record<string, unknown>) => { harness.livePanel("on-chain", props); return null; } }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: (props: Record<string, unknown>) => { harness.livePanel("counterparties", props); return null; } }));
vi.mock("./RiskPaths", () => ({ RiskPaths: (props: Record<string, unknown>) => { harness.livePanel("risk-paths", props); return null; } }));
vi.mock("./Holdings", () => ({ Holdings: (props: Record<string, unknown>) => { harness.livePanel("holdings", props); return null; } }));
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: (props: Record<string, unknown>) => { harness.livePanel("money-flow", props); return null; } }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./SecondOpinion", () => ({ SecondOpinion: () => <div /> }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => <div /> }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => <div /> }));
vi.mock("./AskReport", () => ({ AskReport: () => <div /> }));
vi.mock("./Unknowns", () => ({ Unknowns: () => <div /> }));
vi.mock("./MethodologyChecklist", () => ({ MethodologyChecklist: ({ id }: { id?: string }) => <div id={id} /> }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => <span /> }));

import { TokenReport } from "./TokenReport";

const RESOLVED_DEPLOYER = "9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw";

const safety: NormalizedSafety = {
  available: true,
  simChecked: false,
  honeypot: false,
  honeypotOnchain: false,
  serialScammerCreator: false,
  mintable: false,
  freezable: false,
  nonTransferable: false,
  ownerRenounced: true,
  takeBack: false,
  hiddenOwner: false,
  selfdestruct: false,
  pausable: false,
  openSource: true,
  cannotSellAll: false,
  metadataMutable: false,
  buyTax: 0,
  sellTax: 0,
  holderCount: 579,
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

function dossier(overrides: Partial<TokenDossier> = {}): TokenDossier {
  return {
    address: "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump",
    chain: "solana",
    dexId: "pumpswap",
    symbol: "LINKR",
    name: "linkrbot",
    verdict: "CAUTION",
    score: 55,
    capApplied: null,
    headline: "Test snapshot",
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
    safetyChecked: true,
    persistence: {
      state: "persisted",
      reportVersionId: "00000000-0000-4000-8000-000000000201",
      panelCostToken: "signed-panel-capability",
    },
    ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;

function render(report: TokenDossier): void {
  act(() => {
    root.render(<TokenReport dossier={report} onReset={() => {}} onAudit={() => {}} onRescan={() => {}} />);
  });
}

function rowText(label: string): string {
  const row = [...container.querySelectorAll("div")].find((node) => node.children.length === 2 && node.firstElementChild?.textContent === label);
  return row?.textContent ?? "";
}

beforeEach(() => {
  vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "true");
  harness.livePanel.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe("solana deployer surfacing", () => {
  it("shows the deployer row and every deployer panel once a Solana deployer resolves", () => {
    render(dossier({
      deployer: RESOLVED_DEPLOYER,
      deployerAttribution: { address: RESOLVED_DEPLOYER, source: "helius", method: "mint feePayer", kind: "deployer" },
    }));

    expect(rowText("Deployer")).toContain("9AhKq");
    expect(container.textContent).toContain("named by helius (mint feePayer)");
    for (const panel of ["money-flow", "counterparties", "risk-paths", "holdings"]) {
      expect(harness.livePanel.mock.calls.find(([name]) => name === panel)?.[1]).toEqual(
        expect.objectContaining({ address: RESOLVED_DEPLOYER }),
      );
    }
  });

  it("calls an attributed address a creator or authority, never the deployer", () => {
    render(dossier({
      deployer: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
      deployerAttribution: { address: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX", source: "rugcheck", method: "creator field", kind: "attributed" },
    }));

    expect(rowText("Creator or authority")).toContain("BpH4h");
    expect(container.textContent).toContain("named by rugcheck (creator field)");
    expect(container.textContent).toContain("may be a mint or update authority");
    expect(rowText("Deployer")).toBe("");
  });

  it("reports measured Solana creator holdings instead of hiding the row", () => {
    render(dossier({
      deployer: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
      deployerAttribution: { address: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX", source: "rugcheck", method: "creator field", kind: "attributed" },
      safety: { ...safety, creatorPercent: 0.6678, creatorPercentAssessed: true },
    }));

    expect(rowText("Creator holdings")).toContain("0.7%");
  });

  it("marks unmeasured creator holdings unchecked rather than clean", () => {
    render(dossier({ safety: { ...safety, creatorPercent: 0, creatorPercentAssessed: false } }));

    const row = rowText("Creator holdings");
    expect(row).toContain("unchecked");
    expect(row).not.toContain("0.0%");
  });
});

// Four rows on this card were asserting checks nobody ran. Each test below is
// one of them: the number the engine refused to publish must not reappear here.
describe("the safety card cannot publish a check that did not run", () => {
  it("marks an unmeasured LP lock unchecked instead of calling it not locked", () => {
    render(dossier({ safety: { ...safety, lpAssessed: false, lpLockedPct: 0, lpBurnedPct: 0 } }));

    const row = rowText("Liquidity locked / burned");
    expect(row).toContain("unchecked");
    expect(row).not.toContain("not locked");
  });

  it("still reports a measured lock", () => {
    render(dossier({ safety: { ...safety, lpAssessed: true, lpLockedPct: 96, lpBurnedPct: 0 } }));

    expect(rowText("Liquidity locked / burned")).toContain("locked 96%");
  });

  it("marks a suppressed holder distribution unchecked instead of a green zero", () => {
    render(dossier({ holdersAssessed: false, insiderPct: 0, bundleCount: 0 }));

    const row = rowText("Bundle / snipe concentration");
    expect(row).toContain("unchecked");
    expect(row).not.toContain("0 wallets");
  });

  it("reports the Solana transfer fee and never a fabricated 0% tax", () => {
    render(dossier({ safety: { ...safety, transferFee: false } }));
    expect(rowText("Transfer fee")).toContain("none");
    expect(rowText("Taxes")).toBe("");

    render(dossier({ safety: { ...safety, transferFee: true } }));
    const configured = rowText("Transfer fee");
    expect(configured).toContain("configured");
    expect(configured).toContain("✗");
  });
});
