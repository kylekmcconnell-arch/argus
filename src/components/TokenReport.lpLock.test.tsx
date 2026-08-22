// @vitest-environment jsdom
//
// The LP lock row used to be gated on GoPlus availability. On Solana GoPlus
// returns no LP holder rows at all and RugCheck answers instead, so a report can
// now hold a measured lock while GoPlus is down: the old gate printed n/a over
// an answer already sitting on the dossier.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSafety, TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./TokenSparkline", () => ({ TokenSparkline: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: () => null }));
vi.mock("./RiskPaths", () => ({ RiskPaths: () => null }));
vi.mock("./Holdings", () => ({ Holdings: () => null }));
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: () => null }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./SecondOpinion", () => ({ SecondOpinion: () => <div /> }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => <div /> }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => <div /> }));
vi.mock("./ArgusEyeAssistant", () => ({ ArgusEyeAssistant: () => <div /> }));
vi.mock("./Unknowns", () => ({ Unknowns: () => <div /> }));
vi.mock("./MethodologyChecklist", () => ({ MethodologyChecklist: ({ id }: { id?: string }) => <div id={id} /> }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => <span /> }));

import { TokenReport } from "./TokenReport";

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

function dossier(safetyOverrides: Partial<NormalizedSafety>, overrides: Partial<TokenDossier> = {}): TokenDossier {
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
    safety: { ...safety, ...safetyOverrides },
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
  const row = [...container.querySelectorAll("div")].find(
    (node) => node.children.length === 2 && node.firstElementChild?.textContent === label);
  return row?.textContent ?? "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the liquidity lock row", () => {
  it("shows a lock RugCheck measured even when GoPlus answered nothing", () => {
    render(dossier({ lpAssessed: true, lpLocked: true, lpLockedPct: 92.5 }, { safetyChecked: false }));

    expect(rowText("Liquidity locked / burned")).toContain("locked 93%");
    expect(rowText("Liquidity locked / burned")).not.toContain("unchecked");
  });

  it("still says unchecked when nobody measured the lock", () => {
    render(dossier({ lpAssessed: false }, { safetyChecked: false }));

    // Unmeasured is not unlocked. The row must not fall through to "not locked".
    expect(rowText("Liquidity locked / burned")).toContain("unchecked");
    expect(rowText("Liquidity locked / burned")).not.toContain("not locked");
  });

  it("leaves a frozen dossier that predates the flag following GoPlus", () => {
    render(dossier({ lpAssessed: undefined, lpLockedPct: 80 }, { safetyChecked: true }));

    expect(rowText("Liquidity locked / burned")).toContain("locked 80%");
  });
});
