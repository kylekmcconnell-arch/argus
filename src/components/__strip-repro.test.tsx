// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../lib/investigation";
import type { TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./ProjectLinks", () => ({ ProjectLinks: () => null }));
vi.mock("./ArkhamName", () => ({ ArkhamName: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./AskReport", () => ({ AskReport: () => null }));
vi.mock("./ArkhamGraphBridge", () => ({ ArkhamGraphBridge: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: () => null }));
vi.mock("./RiskPaths", () => ({ RiskPaths: () => null }));
vi.mock("./Holdings", () => ({ Holdings: () => null }));
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: () => null }));
vi.mock("./TokenSparkline", () => ({ TokenSparkline: () => null }));
vi.mock("./NamesakeCheck", () => ({ NamesakeCheck: () => null }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => null }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("../lib/useArkhamLabels", () => ({ useArkhamLabels: () => ({}) }));
vi.mock("../graph/store", () => ({ getContributions: () => [], investigationContribution: () => null }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./SnapshotEvidenceControl", () => ({ LiveSupplementalNotice: () => null, SnapshotEvidenceControl: () => null }));
import { InvestigationReport } from "./InvestigationReport";

const token = (): TokenDossier => ({
  address: "0x4444444444444444444444444444444444444444", chain: "ethereum", dexId: "uniswap",
  symbol: "ARG", name: "Argus", verdict: "PASS", score: 79, capApplied: null,
  headline: "repro", socials: [], projectX: null, deployer: null, topHolders: [],
  insiderPct: 0, bundleCount: 0, bundleRisk: "low", cg: null,
  graph: { nodes: [], edges: [] }, findings: [], trace: [], live: true, safetyChecked: false,
  safety: { available: false, simChecked: false } as TokenDossier["safety"],
  axes: [
    { key: "T1", label: "Liquidity & lock", score: 18, weight: 24, rationale: "Deep liquidity." },
    { key: "T2", label: "Contract safety", score: 16, weight: 26, rationale: "Owner powers present." },
  ],
});

let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("strip repro", () => {
  it("expands a live-investigation composition row and shows the evidence link", () => {
    const inv: Investigation = {
      rootRef: "0x4444444444444444444444444444444444444444", token: token(), projectX: null,
      siteUrl: null, recon: null, projectAccount: null, founders: [], founderNote: "n", deployerTrail: null, webTeam: [],
    };
    act(() => { root.render(<InvestigationReport inv={inv} onAudit={() => {}} onReset={() => {}} onOpenToken={() => {}} onOpenProjectAccount={() => {}} />); });

    const strip = container.querySelector('section[aria-label="How the score is built"]');
    expect(strip, "strip should render").not.toBeNull();
    const rowBtn = [...(strip?.querySelectorAll<HTMLButtonElement>("button[aria-expanded]") ?? [])][0];
    expect(rowBtn, "row button should exist").toBeDefined();
    expect(rowBtn.getAttribute("aria-expanded")).toBe("false");
    act(() => rowBtn.click());
    expect(rowBtn.getAttribute("aria-expanded"), "row should expand on click").toBe("true");
    expect(strip?.textContent).toContain("Deep liquidity.");
    expect(strip?.querySelector('a[href="#dimension-T1"]'), "evidence link should exist").not.toBeNull();
  });
});
