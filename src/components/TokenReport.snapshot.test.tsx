// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportVersionContext } from "../lib/reportVersion";
import type { NormalizedSafety, TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  clipboard: vi.fn(),
  livePanel: vi.fn(),
  askReport: vi.fn(),
  secondOpinion: vi.fn(),
  serviceAlert: vi.fn(),
}));

vi.mock("./TokenSparkline", () => ({ TokenSparkline: (props: Record<string, unknown>) => { harness.livePanel("sparkline", props); return null; } }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: (props: Record<string, unknown>) => { harness.livePanel("on-chain", props); return null; } }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: (props: Record<string, unknown>) => { harness.livePanel("project-research", props); return null; } }));
vi.mock("./Counterparties", () => ({ Counterparties: (props: Record<string, unknown>) => { harness.livePanel("counterparties", props); return null; } }));
vi.mock("./RiskPaths", () => ({ RiskPaths: (props: Record<string, unknown>) => { harness.livePanel("risk-paths", props); return null; } }));
vi.mock("./Holdings", () => ({ Holdings: (props: Record<string, unknown>) => { harness.livePanel("holdings", props); return null; } }));
vi.mock("./RingAlert", () => ({ RingAlert: (props: Record<string, unknown>) => { harness.livePanel("ring-alert", props); return null; } }));
vi.mock("./AddInfo", () => ({ AddInfo: (props: Record<string, unknown>) => { harness.livePanel("add-info", props); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: (props: Record<string, unknown>) => { harness.livePanel("link-entity", props); return null; } }));
vi.mock("./SecondOpinion", () => ({
  SecondOpinion: (props: Record<string, unknown>) => {
    harness.secondOpinion(props);
    return <div data-panel="second-opinion">second-opinion</div>;
  },
}));
vi.mock("./ServiceAlert", () => ({
  ServiceAlert: () => {
    harness.serviceAlert();
    return <div data-panel="service-alert">service-alert</div>;
  },
}));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => <div /> }));
vi.mock("./AskReport", () => ({
  AskReport: (props: Record<string, unknown>) => {
    harness.askReport(props);
    return <div data-panel="ask-report" />;
  },
}));
vi.mock("./Unknowns", () => ({ Unknowns: () => <div /> }));
vi.mock("./MethodologyChecklist", () => ({
  MethodologyChecklist: ({ id }: { id?: string }) => <div id={id} data-panel="methodology" />,
}));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => <span /> }));

import { TokenReport } from "./TokenReport";

const safety: NormalizedSafety = {
  available: true,
  simChecked: true,
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
  holderCount: 0,
  topHolderPct: null,
  lpLocked: true,
  lpBurnedPct: 100,
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

const versionContext: ReportVersionContext = {
  caseId: "00000000-0000-4000-8000-000000000101",
  reportVersionId: "00000000-0000-4000-8000-000000000201",
  version: 2,
  completenessState: "complete",
  attestationState: "server_collected",
  methodologyVersion: "test-v1",
  createdAt: "2026-07-10T12:00:00.000Z",
  checks: [{ label: "Contract safety", status: "confirmed" }],
};

function dossier(overrides: Partial<TokenDossier> = {}): TokenDossier {
  return {
    address: "0x0000000000000000000000000000000000000001",
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "ARG",
    name: "Argus Test",
    verdict: "PASS",
    score: 88,
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
    ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;

function render(report: TokenDossier): void {
  act(() => {
    root.render(
      <TokenReport
        dossier={report}
        onReset={() => {}}
        onAudit={() => {}}
        onRescan={() => {}}
      />,
    );
  });
}

beforeEach(() => {
  harness.clipboard.mockReset().mockResolvedValue(undefined);
  harness.livePanel.mockReset();
  harness.askReport.mockReset();
  harness.secondOpinion.mockReset();
  harness.serviceAlert.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: harness.clipboard },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("token report supplemental evidence boundary", () => {
  it("binds report chat and every decision-canvas navigation link to the immutable snapshot", () => {
    render(dossier({ versionContext }));

    expect(harness.askReport).toHaveBeenLastCalledWith(expect.objectContaining({
      subject: "$ARG",
      reportVersionId: versionContext.reportVersionId,
    }));

    const nav = container.querySelector<HTMLElement>('nav[aria-label="Report sections"]');
    expect(nav).not.toBeNull();
    const hrefs = [...(nav?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [])]
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "#report-summary",
      "#report-risks",
      "#token-evidence",
      "#token-relationships",
      "#token-methodology",
    ]);
    for (const href of hrefs) {
      expect(container.querySelector(`[id="${href?.slice(1)}"]`), `${href} should resolve inside the report`).not.toBeNull();
    }

    expect(container.textContent).toContain("Why ARGUS reaches PASS");
    expect(container.textContent).toContain("Recorded outcomes");
    expect(container.textContent).toContain("Open questions");
    expect(container.querySelector('[role="progressbar"][aria-label="Evidence coverage"]')).not.toBeNull();
  });

  it("uses adverse evidence to explain an adverse verdict and keeps positive evidence as counterweight", () => {
    render(dossier({
      verdict: "FAIL",
      score: 22,
      versionContext,
      findings: [
        { claim: "Liquidity is unlocked and removable.", tone: "bad", source: "goplus" },
        { claim: "Contract source is verified.", tone: "good", source: "explorer" },
      ],
    }));

    const verdictDrivers = container.querySelector('ul[aria-label="Why ARGUS reaches FAIL"]')?.textContent ?? "";
    const counterweight = container.querySelector('ul[aria-label="What evidence pulls the other way"]')?.textContent ?? "";
    expect(verdictDrivers).toContain("Liquidity is unlocked and removable.");
    expect(verdictDrivers).not.toContain("Contract source is verified.");
    expect(counterweight).toContain("Contract source is verified.");
    expect(counterweight).not.toContain("Liquidity is unlocked and removable.");
  });

  it("keeps checked-empty coverage rows out of the positive counterweight on an adverse verdict", () => {
    render(dossier({
      verdict: "FAIL",
      score: 22,
      versionContext: {
        ...versionContext,
        checks: [
          { label: "Contract safety", status: "confirmed", note: "GoPlus simulation completed clean" },
          { label: "Market intelligence", status: "checked-empty", note: "CoinGecko returned no matching asset" },
        ],
      },
      findings: [
        { claim: "Liquidity is unlocked and removable.", tone: "bad", source: "goplus" },
      ],
    }));

    const counterweight = container.querySelector('ul[aria-label="What evidence pulls the other way"]')?.textContent ?? "";
    expect(counterweight).toContain("Contract safety");
    expect(counterweight).not.toContain("Market intelligence");
    expect(counterweight).not.toContain("CoinGecko returned no matching asset");

    const recordedOutcomes = container.querySelector('section[aria-label="Recorded outcomes"]')?.textContent ?? "";
    expect(recordedOutcomes).toContain("Market intelligence");
  });

  it("keeps every current-data panel paused on an immutable snapshot until explicit opt-in", () => {
    render(dossier({ versionContext }));

    expect(container.textContent).toContain("SNAPSHOT v2");
    expect(container.textContent).toContain("Current intelligence panels are paused");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).not.toHaveBeenCalled();
    expect(harness.serviceAlert).not.toHaveBeenCalled();

    const copy = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Copy report");
    act(() => copy?.click());
    const copiedReport = String(harness.clipboard.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedReport).toContain(`?version=${versionContext.reportVersionId}`);
    expect(copiedReport).toContain("ARGUS immutable snapshot v2");
    expect(copiedReport).not.toContain("?t=");
    expect(copiedReport).not.toContain("audited live");

    const load = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Load current intelligence"));
    expect(load).toBeDefined();
    act(() => load?.click());

    expect(container.textContent).toContain("not part of snapshot v2");
    expect(harness.livePanel).toHaveBeenCalled();
    expect(harness.secondOpinion).not.toHaveBeenCalled();
    expect(harness.livePanel.mock.calls.some(([name]) => name === "on-chain" || name === "counterparties")).toBe(false);
    expect(harness.livePanel.mock.calls.find(([name]) => name === "project-research")?.[1]).not.toHaveProperty("panelCostToken");
    expect(harness.livePanel.mock.calls.some(([name]) => name === "add-info" || name === "link-entity")).toBe(false);
    expect(harness.serviceAlert).not.toHaveBeenCalled();
  });

  it("waits for fresh persistence, then gives panels only the signed cost capability", () => {
    const pending = dossier({ persistence: { state: "pending" } });
    render(pending);

    expect(container.textContent).toContain("Saving the immutable scan");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).not.toHaveBeenCalled();

    render(dossier({
      deployer: "0x4444444444444444444444444444444444444444",
      persistence: {
        state: "persisted",
        reportVersionId: versionContext.reportVersionId,
        panelCostToken: "signed-panel-capability",
      },
    }));

    expect(harness.secondOpinion).toHaveBeenCalledWith(expect.objectContaining({
      panelCostToken: "signed-panel-capability",
    }));
    expect(container.textContent).toContain("not included in the immutable Share payload or scored verdict");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Share")).toBe(true);
    const onChainProps = harness.livePanel.mock.calls
      .find(([name]) => name === "on-chain")?.[1] as Record<string, unknown> | undefined;
    expect(onChainProps).toEqual(expect.objectContaining({
      panelCostToken: "signed-panel-capability",
      record: true,
    }));
    for (const panel of ["counterparties", "risk-paths", "holdings"]) {
      expect(harness.livePanel.mock.calls.find(([name]) => name === panel)?.[1]).toEqual(
        expect.objectContaining({ panelCostToken: "signed-panel-capability" }),
      );
    }
    expect(harness.livePanel.mock.calls.find(([name]) => name === "project-research")?.[1]).toEqual(
      expect.objectContaining({ panelCostToken: "signed-panel-capability" }),
    );
  });

  it("fails closed when a persisted report is missing its signed panel capability", () => {
    render(dossier({
      persistence: {
        state: "persisted",
        reportVersionId: versionContext.reportVersionId,
      },
    }));

    expect(container.textContent).toContain("Post-scan intelligence is paused");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).not.toHaveBeenCalled();
  });

  it("keeps private supplemental panels paused and copies no mutable subject link", () => {
    render(dossier({ persistence: { state: "private" } }));

    expect(container.textContent).toContain("supplemental panels are paused");
    expect(container.textContent).toContain("avoid shared cache traces");
    expect(container.textContent).toContain("not saved to a case");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Share")).toBe(false);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Watch"))).toBe(false);

    const copy = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Copy report");
    act(() => copy?.click());
    const copiedReport = String(harness.clipboard.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedReport).toContain("private live ARGUS session");
    expect(copiedReport).not.toContain("?t=");
    expect(copiedReport).not.toContain("?version=");
  });

  it("labels an incomplete adverse token result as a risk signal in UI and copied text", () => {
    render(dossier({
      verdict: "FAIL",
      score: 22,
      versionContext: {
        ...versionContext,
        completenessState: "partial",
        checks: [{ label: "Contract safety", status: "unknown" }],
      },
    }));

    expect(container.textContent).toContain("RISK SIGNAL");
    expect(container.textContent).toContain("FAIL");
    expect(container.textContent).toContain("model score");
    expect(container.textContent).toContain("missing coverage prevents a complete assessment");

    const copy = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Copy report");
    act(() => copy?.click());
    const copiedReport = String(harness.clipboard.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedReport).toContain("RISK SIGNAL: FAIL");
    expect(copiedReport).toContain("INVESTIGATION INCOMPLETE");
  });
});
