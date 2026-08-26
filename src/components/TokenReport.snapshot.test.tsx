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
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: (props: Record<string, unknown>) => { harness.livePanel("money-flow", props); return null; } }));
vi.mock("./RingAlert", () => ({ RingAlert: (props: Record<string, unknown>) => { harness.livePanel("ring-alert", props); return null; } }));
vi.mock("./AddInfo", () => ({ AddInfo: (props: Record<string, unknown>) => { harness.livePanel("add-info", props); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: (props: Record<string, unknown>) => { harness.livePanel("link-entity", props); return null; } }));
vi.mock("./SecondOpinion", () => ({
  SecondOpinion: (props: Record<string, unknown>) => {
    harness.secondOpinion(props);
    return <div id={String(props.id)} data-panel="second-opinion">second-opinion</div>;
  },
}));
vi.mock("./ServiceAlert", () => ({
  ServiceAlert: () => {
    harness.serviceAlert();
    return <div data-panel="service-alert">service-alert</div>;
  },
}));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => <div /> }));
vi.mock("./ArgusEyeAssistant", () => ({
  ArgusEyeAssistant: (props: Record<string, unknown>) => {
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
  checks: [
    { checkId: "contract-safety", label: "Contract safety", status: "confirmed", decisionCritical: true },
    { checkId: "buy-sell-simulation", label: "Buy/sell simulation", status: "confirmed", decisionCritical: true },
    { checkId: "holder-distribution", label: "Holder distribution", status: "confirmed", decisionCritical: true },
    { checkId: "wallet-clustering", label: "Wallet clustering", status: "confirmed", decisionCritical: true },
    { checkId: "market-intelligence", label: "Market intelligence", status: "checked-empty", decisionCritical: true },
    { checkId: "ofac-sanctions-address", label: "OFAC sanctions screen", status: "checked-empty", decisionCritical: true },
    { checkId: "trust-graph-connections", label: "Trust-graph reconciliation", status: "checked-empty", decisionCritical: true },
  ],
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
  vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "true");
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
  vi.unstubAllEnvs();
});

describe("token report supplemental evidence boundary", () => {
  it("keeps a complete six-check token report complete when project graph and creator follow-ups are open", () => {
    render(dossier({
      versionContext: {
        ...versionContext,
        checks: [
          ...versionContext.checks.filter((check) => check.checkId !== "trust-graph-connections"),
          { checkId: "trust-graph-connections", label: "Trust-graph reconciliation", status: "unknown", decisionCritical: true },
          { checkId: "deployer-trail-evm", label: "Creator wallet details", status: "unknown", decisionCritical: true },
        ],
      },
    }));

    const decisionCanvas = container.querySelector('[data-canonical-decision-brief="true"]');
    expect(decisionCanvas?.textContent).toContain("6/6 token safety checks complete");
    expect(decisionCanvas?.textContent).not.toContain("provisional");
    expect(decisionCanvas?.textContent).toContain("Optional follow-up research");
    expect(decisionCanvas?.textContent).toContain("Optional follow-up: creator wallet details");
    expect(decisionCanvas?.textContent).not.toContain("Required checks still open");
  });

  it.each([
    ["QUTRON", "Qutron"],
    ["PROLOGUE", "Prologue"],
    ["FOLD", "Fold"],
    ["STONKBROKER", "StonkBroker"],
  ])("renders the %s regression fixture through one canonical report experience", (symbol, name) => {
    render(dossier({ symbol, name, versionContext }));

    expect(container.querySelectorAll('[data-canonical-decision-brief="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-report-experience-shell="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-canonical-report-header="true"]')).toHaveLength(1);
    expect(container.textContent).toContain(`$${symbol}`);
    expect(container.textContent).toContain("What this report means");
    expect(container.querySelector('a[href^="https://dexscreener.com/search?q="]')?.textContent).toBe("Dexscreener");
    const decisionCanvas = container.querySelector('[data-canonical-decision-brief="true"]');
    expect(decisionCanvas?.textContent).toContain("88");
    expect(decisionCanvas?.textContent).toContain("/ 100");
    expect(decisionCanvas?.textContent).toContain("6/6 token safety checks complete");
    expect(decisionCanvas?.textContent).toContain("Token safety score");
    expect(container.querySelector('[aria-label="Safety check status"]')).toBeNull();
  });

  it("binds report chat and every decision-canvas navigation link to the immutable snapshot", () => {
    render(dossier({ versionContext }));

    expect(harness.askReport).toHaveBeenLastCalledWith(expect.objectContaining({
      subject: "$ARG",
      reportVersionId: versionContext.reportVersionId,
    }));

    const nav = container.querySelector<HTMLElement>('nav[aria-label="Report guide"]');
    expect(nav).not.toBeNull();
    const hrefs = [...(nav?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [])]
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "#report-summary",
      "#report-risks",
      "#token-story",
      "#token-relationships",
      "#token-evidence",
      "#token-methodology",
      "#token-challenge",
    ]);
    expect(container.textContent).toContain("What was not verified");
    expect(container.textContent).toContain("No CoinGecko record was captured");
    for (const href of hrefs) {
      expect(container.querySelector(`[id="${href?.slice(1)}"]`), `${href} should resolve inside the report`).not.toBeNull();
    }

    expect(container.textContent).toContain("What supports this result");
    expect(container.textContent).toContain("Finished checks");
    expect(container.textContent).toContain("What is still open");
    expect(container.querySelector('[role="progressbar"][aria-label="Checks finished"]')).not.toBeNull();
  });

  it("reopens the frozen decision boundary without recomputing it from current scoring rules", () => {
    render(dossier({
      verdict: "FAIL",
      score: 20,
      capApplied: "owner_can_modify_balance",
      versionContext,
      decisionBoundary: {
        schemaVersion: 1,
        kind: "cap",
        controllingFact: "An active controller can directly change holder balances.",
        boundary: "This saved report is capped at 20/100.",
        willNotChange: "Market activity and community attention cannot override this contract control.",
        unlockCondition: "Verify from the contract and chain that this authority is permanently disabled.",
        evidenceArea: "contract",
      },
    }));

    const decisionLock = container.querySelector('[data-testid="decision-boundary"]');
    expect(decisionLock?.textContent).toContain("This saved report is capped at 20/100");
    expect(decisionLock?.textContent).toContain("Market activity and community attention cannot override");
    expect(decisionLock?.textContent).toContain("permanently disabled");
    expect(decisionLock?.querySelector('a[href="#token-methodology"]')?.textContent).toContain("Open governing evidence");
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

    const verdictDrivers = container.querySelector('ul[aria-label="Main concerns"]')?.textContent ?? "";
    const counterweight = container.querySelector('ul[aria-label="What looks credible"]')?.textContent ?? "";
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

    const counterweight = container.querySelector('ul[aria-label="What looks credible"]')?.textContent ?? "";
    expect(counterweight).toContain("Contract controls");
    expect(counterweight).not.toContain("Market intelligence");
    expect(counterweight).not.toContain("CoinGecko returned no matching asset");

    const recordedOutcomes = container.querySelector('section[aria-label="Finished checks"]')?.textContent ?? "";
    expect(recordedOutcomes).toContain("Market data");
  });

  it("keeps every current-data panel paused on an immutable snapshot until explicit opt-in", () => {
    render(dossier({ versionContext }));

    expect(container.querySelector('[aria-label="Case PA-00000000000040008000"]')?.textContent).toContain(
      "/ PA-00000000000040008000",
    );
    expect(container.textContent).toContain("SAVED REPORT v2");
    expect(container.textContent).toContain("This report uses data saved on");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).toHaveBeenCalledWith(expect.objectContaining({ panelCostToken: undefined }));
    expect(harness.serviceAlert).not.toHaveBeenCalled();

    const copy = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Copy report");
    act(() => copy?.click());
    const copiedReport = String(harness.clipboard.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedReport).toContain(`?version=${versionContext.reportVersionId}`);
    expect(copiedReport).toContain("ARGUS saved report v2");
    expect(copiedReport).not.toContain("?t=");
    expect(copiedReport).not.toContain("audited live");

    const load = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Check current data"));
    expect(load).toBeDefined();
    act(() => load?.click());

    expect(container.textContent).toContain("Current data is shown separately and does not change the saved score");
    expect(harness.livePanel).toHaveBeenCalled();
    expect(harness.secondOpinion).toHaveBeenLastCalledWith(expect.objectContaining({ panelCostToken: undefined }));
    expect(harness.livePanel.mock.calls.some(([name]) => name === "on-chain" || name === "counterparties")).toBe(false);
    expect(harness.livePanel.mock.calls.find(([name]) => name === "project-research")?.[1]).not.toHaveProperty("panelCostToken");
    expect(harness.livePanel.mock.calls.some(([name]) => name === "add-info" || name === "link-entity")).toBe(false);
    expect(harness.serviceAlert).not.toHaveBeenCalled();
  });

  it("waits for fresh persistence, then gives panels only the signed cost capability", () => {
    const pending = dossier({ persistence: { state: "pending" } });
    render(pending);

    expect(container.textContent).toContain("Saving this report before running extra checks");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).toHaveBeenCalledWith(expect.objectContaining({ panelCostToken: undefined }));

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
    expect(container.textContent).toContain("do not change the saved score or the shared report");
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

    expect(container.textContent).toContain("This report is visible now, but it was not saved.");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).toHaveBeenCalledWith(expect.objectContaining({ panelCostToken: undefined }));
  });

  it("keeps private supplemental panels paused and copies no mutable subject link", () => {
    render(dossier({ persistence: { state: "private" } }));

    expect(container.textContent).toContain("Extra live checks are off");
    expect(container.textContent).toContain("nothing is added to shared cases");
    expect(container.textContent).toContain("watchlists, or activity");
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.secondOpinion).toHaveBeenCalledWith(expect.objectContaining({ panelCostToken: undefined }));
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Share")).toBe(false);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Watch"))).toBe(false);

    const copy = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Copy report");
    act(() => copy?.click());
    const copiedReport = String(harness.clipboard.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedReport).toContain("private ARGUS scan");
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

    expect(container.querySelectorAll('[data-canonical-decision-brief="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("Main concerns");
    expect(container.textContent).toContain("FAIL");
    expect(container.textContent).toContain("Do not rely on the score or result yet");

    const copy = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Copy report");
    act(() => copy?.click());
    const copiedReport = String(harness.clipboard.mock.calls.at(-1)?.[0] ?? "");
    expect(copiedReport).toContain("RISK WARNING: FAIL");
    expect(copiedReport).toContain("CHECKS INCOMPLETE");
  });
});
