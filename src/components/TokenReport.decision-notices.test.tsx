// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportVersionContext } from "../lib/reportVersion";
import type { NormalizedSafety, TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Regression for the #521 migration: the live notices and the community-graph
// RingAlert were carried into the Decision chapter inside its collapsed
// "full case" disclosure, so a verdict-changing warning did not mount until a
// click, the saving / not-saved notices rendered twice, and every token report
// grew a disclosure that opened onto an empty panel.

vi.mock("./TokenSparkline", () => ({ TokenSparkline: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: () => null }));
vi.mock("./RiskPaths", () => ({ RiskPaths: () => null }));
vi.mock("./Holdings", () => ({ Holdings: () => null }));
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./SecondOpinion", () => ({ SecondOpinion: () => null }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => null }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => <div /> }));
vi.mock("./ArgusEyeAssistant", () => ({ ArgusEyeAssistant: () => null }));
vi.mock("./Unknowns", () => ({ Unknowns: () => <div /> }));
vi.mock("./MethodologyChecklist", () => ({ MethodologyChecklist: ({ id }: { id?: string }) => <div id={id} /> }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => <span /> }));
// The alert itself is covered by RingAlert.test.tsx; here only its placement matters.
vi.mock("./RingAlert", () => ({
  RingAlert: ({ snapshotVersion }: { snapshotVersion?: number }) => (
    <div data-panel="ring-alert" data-snapshot-version={snapshotVersion ?? ""}>ring-alert</div>
  ),
}));

import { TokenReport } from "./TokenReport";

const safety: NormalizedSafety = {
  available: true, simChecked: true, honeypot: false, honeypotOnchain: false, serialScammerCreator: false,
  mintable: false, freezable: false, nonTransferable: false, ownerRenounced: true, takeBack: false,
  hiddenOwner: false, selfdestruct: false, pausable: false, openSource: true, cannotSellAll: false,
  metadataMutable: false, buyTax: 0, sellTax: 0, holderCount: 0, topHolderPct: null, lpLocked: true,
  lpBurnedPct: 100, lpLockedPct: 0, lpTopUnlockedEoaPct: 0, balanceMutable: false, transferHook: false,
  transferFee: false, proxy: false, slippageModifiable: false, blacklist: false, tradingCooldown: false,
  externalCall: false, ownerChangeBalance: false, creatorPercent: 0,
};

const versionContext: ReportVersionContext = {
  caseId: "00000000-0000-4000-8000-000000000101",
  reportVersionId: "00000000-0000-4000-8000-000000000201",
  version: 2,
  completenessState: "complete",
  attestationState: "server_collected",
  methodologyVersion: "test-v1",
  createdAt: "2026-07-10T12:00:00.000Z",
  checks: [],
};

function dossier(overrides: Partial<TokenDossier> = {}): TokenDossier {
  return {
    address: "0x0000000000000000000000000000000000000001",
    chain: "ethereum", dexId: "uniswap", symbol: "ARG", name: "Argus Test",
    verdict: "PASS", score: 88, capApplied: null, headline: "Test snapshot",
    axes: [], safety, socials: [], projectX: null, deployer: null, topHolders: [],
    insiderPct: 0, bundleCount: 0, bundleRisk: "low", cg: null,
    graph: { nodes: [], edges: [] }, findings: [], trace: [], live: true, safetyChecked: true,
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

const count = (text: string): number => container.textContent!.split(text).length - 1;
const NOT_SAVED = "This report is visible now, but it was not saved.";
const SAVING = "Saving this report before running extra checks";
const FULL_CASE = "The full case behind this decision";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("token Decision chapter: live notices and the verdict overlay", () => {
  it("mounts the RingAlert at chapter level on a live report, with no disclosure to open", () => {
    render(dossier({ persistence: { state: "persisted", reportVersionId: versionContext.reportVersionId, panelCostToken: "t" } }));

    const alert = container.querySelector('[data-panel="ring-alert"]');
    expect(alert).not.toBeNull();
    // Beside the score cards, not inside any in-flow disclosure panel.
    expect(alert!.closest(".inline-detail-slot")).toBeNull();
    expect(alert!.getAttribute("data-snapshot-version")).toBe("");
    expect(container.textContent).not.toContain(FULL_CASE);
    expect(container.textContent).not.toContain("Explore saved details");
  });

  it("renders no empty 'full case' disclosure on a saved snapshot", () => {
    render(dossier({ versionContext }));

    expect(container.textContent).not.toContain(FULL_CASE);
    expect(container.textContent).not.toContain("Explore saved details");
    expect(count("Saved report v2")).toBe(1);
    // In snapshot mode the overlay waits for "Check current data": the saved
    // verdict is immutable and nothing live renders until asked for.
    expect(container.querySelector('[data-panel="ring-alert"]')).toBeNull();
  });

  it("states a failed save once, with the recorded cause, and shows no live overlay", () => {
    render(dossier({ persistence: { state: "failed", reason: "The immutable save was refused upstream." } }));

    expect(count(NOT_SAVED)).toBe(1);
    expect(container.textContent).toContain("The immutable save was refused upstream.");
    expect(container.querySelector('[data-panel="ring-alert"]')).toBeNull();
    expect(container.textContent).not.toContain(FULL_CASE);
  });

  it("states a persisted report that lacks a panel capability as not saved, once", () => {
    render(dossier({ persistence: { state: "persisted", reportVersionId: versionContext.reportVersionId } }));

    expect(count(NOT_SAVED)).toBe(1);
    expect(container.querySelector('[data-panel="ring-alert"]')).toBeNull();
  });

  it("states a pending save once", () => {
    render(dossier({ persistence: { state: "pending" } }));

    expect(count(SAVING)).toBe(1);
    expect(container.textContent).not.toContain(FULL_CASE);
  });

  it("keeps the private-report notice to one line and runs no live overlay", () => {
    render(dossier({ persistence: { state: "private" } }));

    expect(count("Extra live checks are off")).toBe(1);
    expect(container.querySelector('[data-panel="ring-alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Extra checks below run live");
    expect(container.textContent).not.toContain(FULL_CASE);
  });
});
