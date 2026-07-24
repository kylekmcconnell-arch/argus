// @vitest-environment jsdom

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  landingInput: "",
  landingPrivate: false,
  shellInput: "",
  shellPrivate: false,
  recentRef: "",
  reconProps: [] as Array<Record<string, unknown>>,
  reconMounts: 0,
  tokenReports: [] as Array<Record<string, unknown>>,
  personReports: [] as Array<Record<string, unknown>>,
  projectViews: [] as Array<Record<string, unknown>>,
  caseBriefTargets: [] as Array<Record<string, unknown>>,
  caseBriefDirty: false,
  fetchReport: vi.fn(),
  fetchReportVersion: vi.fn(),
  fetchReportState: vi.fn(),
  fetchReconWebTeam: vi.fn(),
  getRun: vi.fn(),
  getScanRun: vi.fn(),
  probeBackend: vi.fn(),
  resolveStoredCases: vi.fn(),
  resolveTokenSubject: vi.fn(),
  startInvestigationScan: vi.fn(),
  startPersonAudit: vi.fn(),
  startTokenScan: vi.fn(),
  syncReport: vi.fn(),
  logAudit: vi.fn(),
  reconcileAuditOutcome: vi.fn(),
  personContribution: vi.fn(),
  recordContribution: vi.fn(),
  personOnComplete: null as ((dossier: Record<string, unknown>, priv?: boolean) => void) | null,
  scanOnComplete: null as ((run: Record<string, unknown>) => void) | null,
}));

vi.mock("./components/AppShell", () => ({
  AppShell: ({ children, onAudit, onNav, onOpenRecent }: { children: ReactNode; onAudit: (input: string, priv?: boolean) => void | Promise<void>; onNav: (target: "idle") => void; onOpenRecent?: (ref: string, kind?: "token") => void | Promise<void> }) => (
    <main>
      <button data-testid="nav-home" onClick={() => onNav("idle")}>Home</button>
      <button data-testid="shell-run" onClick={() => { void onAudit(harness.shellInput, harness.shellPrivate); }}>Run quick audit</button>
      <button data-testid="reopen-recent" onClick={() => { void onOpenRecent?.(harness.recentRef, "token"); }}>Reopen recent</button>
      {children}
    </main>
  ),
}));

vi.mock("./components/Landing", () => ({
  Landing: ({ onAudit }: { onAudit: (input: string, priv?: boolean) => void | Promise<void> }) => (
    <button
      data-testid="landing-run"
      onClick={() => { void onAudit(harness.landingInput, harness.landingPrivate); }}
    >
      Run investigation
    </button>
  ),
}));

vi.mock("./components/LiveRun", () => ({
  LiveRun: ({ onDone }: { onDone: (dossier: Record<string, unknown>) => void }) => (
    <button data-testid="finish-person-run" onClick={() => onDone({ handle: "@private_source", report: { audit_id: "private-person" } })}>Finish person run</button>
  ),
}));

vi.mock("./components/Report", () => ({
  Report: (props: { dossier: Record<string, unknown>; onAudit?: (q: string) => void; onOpenProject?: (name: string) => void; onOpenBrief?: () => void }) => {
    harness.personReports.push(props);
    return (
      <div data-testid="stored-person-report">
        Stored person report
        {props.onAudit && <button data-testid="person-pivot" onClick={() => props.onAudit?.("@person_pivot")}>Audit person pivot</button>}
        {props.onOpenProject && <button data-testid="project-pivot" onClick={() => props.onOpenProject?.("Private Project")}>Open project pivot</button>}
        {props.onOpenBrief && <button data-testid="person-case-brief" onClick={props.onOpenBrief}>Case brief</button>}
      </div>
    );
  },
}));

vi.mock("./components/InvestigationReport", () => ({
  InvestigationReport: (props: { onAudit: (q: string) => void; onOpenToken: () => void; onOpenProjectAccount: () => void; onOpenBrief?: () => void }) => (
    <div data-testid="stored-investigation-report">
      Stored investigation report
      <button data-testid="open-derived-token" onClick={props.onOpenToken}>Open token</button>
      <button data-testid="open-derived-account" onClick={props.onOpenProjectAccount}>Open account</button>
      <button data-testid="investigation-pivot" onClick={() => props.onAudit("@investigation_pivot")}>Audit founder pivot</button>
      {props.onOpenBrief && <button data-testid="investigation-case-brief" onClick={props.onOpenBrief}>Case brief</button>}
    </div>
  ),
}));

vi.mock("./components/TokenReport", () => ({
  TokenReport: (props: { dossier: Record<string, unknown>; onAudit?: (q: string) => void; onOpenBrief?: () => void }) => {
    harness.tokenReports.push(props.dossier);
    return (
      <div data-testid="stored-token-report">
        Stored token report
        {props.onAudit && <button data-testid="token-pivot" onClick={() => props.onAudit?.("@token_pivot")}>Audit token pivot</button>}
        {props.onOpenBrief && <button data-testid="token-case-brief" onClick={props.onOpenBrief}>Case brief</button>}
      </div>
    );
  },
}));

vi.mock("./components/ProjectView", () => ({
  ProjectView: (props: { record?: boolean; onAudit: (q: string) => void }) => {
    harness.projectViews.push(props);
    return <button data-testid="project-person-pivot" onClick={() => props.onAudit("@project_pivot")}>Audit project person</button>;
  },
}));

vi.mock("./components/TokenRun", () => ({
  TokenRun: ({ onDone }: { onDone: (result: Record<string, unknown>, priv: boolean, scanId: string) => void }) => (
    <button data-testid="finish-token-run" onClick={() => onDone({ address: "0x4444444444444444444444444444444444444444", symbol: "PRIVATE" }, true, "private-token-scan")}>Finish token run</button>
  ),
}));

vi.mock("./components/InvestigationRun", () => ({
  InvestigationRun: ({ onDone }: { onDone: (result: Record<string, unknown>, priv: boolean, scanId: string) => void }) => (
    <button data-testid="finish-investigation-run" onClick={() => onDone({ token: { address: "0x5555555555555555555555555555555555555555", symbol: "PRIVATE" }, projectAccount: { handle: "@private_project", report: { audit_id: "private-project-account" } } }, true, "private-investigation-scan")}>Finish investigation run</button>
  ),
}));

vi.mock("./components/ReconPage", () => ({
  ReconPage: (props: Record<string, unknown>) => {
    useEffect(() => {
      harness.reconMounts += 1;
    }, []);
    harness.reconProps.push(props);
    return (
      <div data-testid="recon-page">
        {props.initialRecon ? "stored recon" : "fresh recon"}
        {typeof props.onOpenBrief === "function" && (
          <button data-testid="site-case-brief" onClick={() => (props.onOpenBrief as (ref: string) => void)("example.com")}>Case brief</button>
        )}
        {typeof props.onOpenRecent === "function" && (
          <button data-testid="reopen-site" onClick={() => { void (props.onOpenRecent as (ref: string, kind: string) => Promise<void>)("example.com", "site"); }}>Reopen site</button>
        )}
        {typeof props.onInvestigate === "function" && (
          <button data-testid="recon-investigate" onClick={() => { void (props.onInvestigate as (ref: string, priv?: boolean) => Promise<void>)("0x7878787878787878787878787878787878787878", false); }}>Investigate matched token</button>
        )}
      </div>
    );
  },
}));

vi.mock("./components/CaseBriefPanel", () => ({
  CaseBriefPanel: ({ target, onDirtyChange }: { target: Record<string, unknown>; onDirtyChange?: (dirty: boolean) => void }) => {
    harness.caseBriefTargets.push(target);
    onDirtyChange?.(harness.caseBriefDirty);
    return <div data-testid="case-brief-panel">Case brief panel</div>;
  },
}));

vi.mock("./lib/auditlog", () => ({
  hydrateSharedLog: vi.fn(),
  logAudit: harness.logAudit,
  reconcileAuditOutcome: harness.reconcileAuditOutcome,
}));

vi.mock("./graph/store", () => ({
  hydrateCommunityGraph: vi.fn(),
  investigationContribution: vi.fn(),
  personContribution: harness.personContribution,
  recordContribution: harness.recordContribution,
  tokenContribution: vi.fn(),
}));

vi.mock("./lib/live", () => ({
  probeBackend: harness.probeBackend,
}));

vi.mock("./lib/runner", () => ({
  getRun: harness.getRun,
  setOnComplete: vi.fn((callback: (dossier: Record<string, unknown>, priv?: boolean) => void) => {
    harness.personOnComplete = callback;
  }),
  startPersonAudit: harness.startPersonAudit,
}));

vi.mock("./lib/scanrunner", () => ({
  getScanRun: harness.getScanRun,
  setScanOnComplete: vi.fn((callback: (run: Record<string, unknown>) => void) => {
    harness.scanOnComplete = callback;
  }),
  startInvestigationScan: harness.startInvestigationScan,
  startTokenScan: harness.startTokenScan,
}));

vi.mock("./lib/reports", () => ({
  fetchReport: harness.fetchReport,
  fetchReportVersion: harness.fetchReportVersion,
  fetchReportState: harness.fetchReportState,
  resolveStoredCases: harness.resolveStoredCases,
  storedInvestigation: (report: { payload: Record<string, unknown>; versionContext?: unknown }) => report.versionContext
    ? { ...report.payload, versionContext: report.versionContext }
    : report.payload,
  storedPersonDossier: (report: { payload: Record<string, unknown>; versionContext?: unknown }) => report.versionContext
    ? { ...report.payload, versionContext: report.versionContext }
    : report.payload,
  storedSiteRecon: (report: { payload?: { recon?: unknown } }) => report.payload?.recon ?? null,
  storedTokenDossier: (report: { payload: Record<string, unknown>; versionContext?: unknown }) => report.versionContext
    ? { ...report.payload, versionContext: report.versionContext }
    : report.payload,
  syncReport: harness.syncReport,
}));

vi.mock("./lib/reconSupplements", () => ({
  fetchReconWebTeam: harness.fetchReconWebTeam,
}));

vi.mock("./token/resolveSubject", () => ({
  resolveTokenSubject: harness.resolveTokenSubject,
}));

vi.mock("./auth-context", () => ({
  useArgusAuth: () => ({ role: "owner" }),
}));

import App from "./App";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function renderApp(path = "/"): Promise<HTMLDivElement> {
  window.history.replaceState({}, "", path);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
  });
  await settle();
  return container;
}

async function submitLanding(): Promise<void> {
  const button = container?.querySelector<HTMLButtonElement>("[data-testid='landing-run']");
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
}

async function submitShell(): Promise<void> {
  const button = container?.querySelector<HTMLButtonElement>("[data-testid='shell-run']");
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
}

function expectNoRunnerStarted(): void {
  expect(harness.startPersonAudit).not.toHaveBeenCalled();
  expect(harness.startTokenScan).not.toHaveBeenCalled();
  expect(harness.startInvestigationScan).not.toHaveBeenCalled();
}

function tokenResult(address: string, headline: string) {
  return {
    address,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "ORDER",
    name: "Ordering Test",
    verdict: "PASS",
    score: 90,
    capApplied: null,
    headline,
    axes: [],
    safety: { available: false, simChecked: false },
    socials: [],
    projectX: null,
    deployer: null,
    topHolders: [],
    insiderPct: 0,
    bundleCount: 0,
    bundleRisk: "low",
    graph: { nodes: [], edges: [] },
    findings: [],
    trace: [],
    live: true,
    safetyChecked: false,
  };
}

function personResult(persistence: Record<string, unknown>) {
  return {
    handle: "@persisted_person",
    display_name: "Persisted Person",
    avatar: "P",
    avatar_url: "",
    headline: "Evidence-backed person report",
    evidence: { associates: [] },
    graph: {
      nodes: [{ type: "Person", key: "@persisted_person", subject: true }],
      edges: [],
    },
    report: {
      audit_id: "person-audit-1",
      composite_verdict: "PASS",
      governing_score: 88,
      governing_role: "FOUNDER",
      roles: ["FOUNDER"],
      cap_applied: null,
    },
    persistence,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.landingInput = "";
  harness.landingPrivate = false;
  harness.shellInput = "";
  harness.shellPrivate = false;
  harness.recentRef = "";
  harness.reconProps.length = 0;
  harness.reconMounts = 0;
  harness.tokenReports.length = 0;
  harness.personReports.length = 0;
  harness.projectViews.length = 0;
  harness.caseBriefTargets.length = 0;
  harness.caseBriefDirty = false;
  harness.fetchReport.mockResolvedValue(null);
  harness.fetchReportVersion.mockResolvedValue(null);
  harness.fetchReportState.mockResolvedValue({ status: "missing", report: null });
  harness.fetchReconWebTeam.mockResolvedValue([]);
  harness.getRun.mockReturnValue(null);
  harness.getScanRun.mockReturnValue(null);
  harness.probeBackend.mockResolvedValue({ configured: true });
  harness.resolveStoredCases.mockResolvedValue({ status: "ok", subjects: [] });
  harness.resolveTokenSubject.mockResolvedValue({ state: "not_found" });
  harness.startTokenScan.mockImplementation((_input, priv: boolean) => ({ priv }));
  harness.startInvestigationScan.mockImplementation((_input, priv: boolean) => ({ priv }));
  harness.startPersonAudit.mockImplementation((_input, priv: boolean) => ({ priv }));
  harness.syncReport.mockResolvedValue({ state: "failed" });
  harness.personContribution.mockReturnValue({
    handle: "@persisted_person",
    nodes: [{ type: "Person", key: "@persisted_person", subject: true }],
    edges: [],
  });
  harness.personOnComplete = null;
  harness.scanOnComplete = null;
  window.history.replaceState({}, "", "/");
});

afterEach(async () => {
  if (root) {
    await act(async () => { root?.unmount(); });
  }
  container?.remove();
  root = null;
  container = null;
});

describe("App routing safety", () => {
  it("starts a fresh person audit from Home even when a stored snapshot exists", async () => {
    harness.landingInput = "@existingfounder";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-existing",
        kind: "person",
        ref: "existingfounder",
        query: "@existingfounder",
        status: "open",
      }],
    });

    const view = await renderApp();
    await submitLanding();

    expect(view.querySelector("[data-testid='finish-person-run']")).not.toBeNull();
    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expect(harness.fetchReportState).not.toHaveBeenCalled();
    expect(harness.startPersonAudit).toHaveBeenCalledTimes(1);
    expect(harness.startPersonAudit).toHaveBeenCalledWith("existingfounder", false);
  });

  it("keeps a failed person save session-only and out of shared audit surfaces", async () => {
    await renderApp();
    expect(harness.personOnComplete).not.toBeNull();

    act(() => {
      harness.personOnComplete?.(personResult({ state: "failed" }));
    });

    expect(harness.syncReport).not.toHaveBeenCalled();
    expect(harness.logAudit).not.toHaveBeenCalled();
    expect(harness.personContribution).not.toHaveBeenCalled();
    expect(harness.recordContribution).not.toHaveBeenCalled();
  });

  it("publishes a person audit only when it carries an immutable version binding", async () => {
    await renderApp();
    const reportVersionId = "00000000-0000-4000-8000-000000000301";

    act(() => {
      harness.personOnComplete?.(personResult({ state: "persisted", reportVersionId }));
    });

    expect(harness.syncReport).toHaveBeenCalledTimes(1);
    expect(harness.logAudit).toHaveBeenCalledTimes(1);
    expect(harness.personContribution).toHaveBeenCalledWith(expect.objectContaining({
      persistence: expect.objectContaining({ state: "persisted", reportVersionId }),
    }));
    expect(harness.recordContribution).toHaveBeenCalledTimes(1);
  });

  it("does not attach to or launch any runner when the durable case is archived", async () => {
    harness.shellInput = "@archivedfounder";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-archived",
        kind: "person",
        ref: "archivedfounder",
        query: "@archivedfounder",
        status: "archived",
      }],
    });
    harness.fetchReportState.mockResolvedValue({ status: "archived", report: null });
    harness.getRun.mockReturnValue({ handle: "archivedfounder", status: "running" });

    const view = await renderApp();
    await submitShell();

    expect(view.textContent).toContain("This case is archived");
    expect(harness.getRun).not.toHaveBeenCalled();
    expectNoRunnerStarted();
  });

  it("fails closed before runners or cached runs when case status is unavailable", async () => {
    harness.shellInput = "@statusunknown";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-status-unknown",
        kind: "person",
        ref: "statusunknown",
        query: "@statusunknown",
        status: "open",
      }],
    });
    harness.fetchReportState.mockResolvedValue({ status: "unavailable", report: null });
    harness.getRun.mockReturnValue({ handle: "statusunknown", status: "running" });

    const view = await renderApp();
    await submitShell();

    expect(view.textContent).toContain("Stored case status is unavailable");
    expect(harness.getRun).not.toHaveBeenCalled();
    expectNoRunnerStarted();
  });

  it.each([
    ["X profile URL", "https://x.com/Alice/status/123", "Alice"],
    ["site URL", "HTTPS://Example.COM/Path/", "example.com"],
  ])("uses the canonical durable-case lookup for a %s", async (_label, input, canonical) => {
    harness.shellInput = input;
    harness.resolveStoredCases.mockResolvedValue({ status: "unavailable", subjects: [] });

    await renderApp();
    await submitShell();

    expect(harness.resolveStoredCases).toHaveBeenCalledWith(canonical);
    expectNoRunnerStarted();
  });

  it("requires live contract resolution for a ticker even when one stored label matches", async () => {
    harness.landingInput = "$PEPE";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-pepe",
        kind: "token",
        ref: "0x0000000000000000000000000000000000000001",
        query: "$PEPE",
        status: "open",
      }],
    });
    harness.resolveTokenSubject.mockResolvedValue({ state: "not_found" });

    await renderApp();
    await submitLanding();

    expect(harness.resolveTokenSubject).toHaveBeenCalledWith({
      kind: "token",
      ref: "$PEPE",
      via: "ticker",
    });
    expect(harness.fetchReportState).not.toHaveBeenCalled();
    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expectNoRunnerStarted();
  });

  it("starts a fresh full token investigation from Home instead of opening its stored snapshot", async () => {
    const address = "0x1212121212121212121212121212121212121212";
    const candidate = {
      input: { kind: "token" as const, ref: address, via: "evm" as const },
      canonicalRef: address,
      chain: "ethereum",
      symbol: "FRESH",
      name: "Fresh Token",
      pairAddress: "pair-fresh",
      liquidityUsd: 100,
    };
    harness.landingInput = address;
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-existing-token",
        kind: "investigation",
        ref: address,
        query: address,
        status: "open",
      }],
    });
    harness.resolveTokenSubject.mockResolvedValue({ state: "resolved", candidate });

    await renderApp();
    await submitLanding();

    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expect(harness.fetchReportState).not.toHaveBeenCalled();
    expect(harness.startInvestigationScan).toHaveBeenCalledWith(candidate.input, false, { force: true });
    expect(harness.startTokenScan).not.toHaveBeenCalled();
  });

  it("keeps Recon's automatic token bridge storage-first", async () => {
    const address = "0x7878787878787878787878787878787878787878";
    harness.landingInput = "example.com";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-recon-investigation",
        kind: "investigation",
        ref: address,
        query: address,
        status: "open",
      }],
    });
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "investigation",
        payload: { token: { address } },
        versionContext: { caseId: "case-recon-investigation", reportVersionId: "version-recon-investigation" },
      },
    });

    const view = await renderApp();
    await submitLanding();
    expect(view.querySelector("[data-testid='recon-page']")).not.toBeNull();

    await act(async () => {
      view.querySelector<HTMLButtonElement>("[data-testid='recon-investigate']")?.click();
    });
    await settle();

    expect(harness.resolveStoredCases).toHaveBeenCalledWith(address);
    expect(harness.fetchReportState).toHaveBeenCalledWith(address, "investigation");
    expect(view.querySelector("[data-testid='stored-investigation-report']")).not.toBeNull();
    expectNoRunnerStarted();
  });

  it("exits resolving with a retryable error and preserves fresh intent when token resolution rejects", async () => {
    const address = "0x8989898989898989898989898989898989898989";
    const candidate = {
      input: { kind: "token" as const, ref: address, via: "evm" as const },
      canonicalRef: address,
      chain: "ethereum",
      symbol: "RETRY",
      name: "Retry Token",
      pairAddress: "pair-retry",
      liquidityUsd: 50,
    };
    harness.landingInput = "$RETRY";
    harness.resolveTokenSubject.mockRejectedValueOnce(new Error("resolver exploded"));

    const view = await renderApp();
    await submitLanding();

    expect(view.textContent).toContain("Couldn't start the audit");
    expect(view.textContent).toContain("resolver exploded");
    expectNoRunnerStarted();

    harness.resolveTokenSubject.mockResolvedValueOnce({ state: "resolved", candidate });
    const retry = [...view.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Retry audit"));
    expect(retry).toBeDefined();
    await act(async () => { retry?.click(); });
    await settle();

    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expect(harness.startInvestigationScan).toHaveBeenCalledWith(candidate.input, false, { force: true });
  });

  it("preserves fresh-run intent through an ambiguous ticker choice", async () => {
    const candidate = {
      input: { kind: "token" as const, ref: "0x3434343434343434343434343434343434343434", via: "evm" as const },
      canonicalRef: "0x3434343434343434343434343434343434343434",
      chain: "ethereum",
      symbol: "DUPE",
      name: "Duplicate Ticker",
      pairAddress: "pair-dupe",
      liquidityUsd: 200,
    };
    harness.landingInput = "$DUPE";
    harness.resolveTokenSubject.mockResolvedValue({ state: "ambiguous", candidates: [candidate] });

    const view = await renderApp();
    await submitLanding();

    expect(view.textContent).toContain("This is still a fresh-audit request");
    const choice = view.querySelector<HTMLButtonElement>("button[aria-label^='Start fresh audit of']");
    expect(choice).not.toBeNull();
    await act(async () => { choice?.click(); });
    await settle();

    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expect(harness.fetchReportState).not.toHaveBeenCalled();
    expect(harness.startInvestigationScan).toHaveBeenCalledWith(candidate.input, false, { force: true });
  });

  it("never reinterprets an invalid cashtag as a person audit", async () => {
    harness.landingInput = "$NOT A TICKER";
    harness.resolveTokenSubject.mockResolvedValue({ state: "not_found" });

    const view = await renderApp();
    await submitLanding();

    expect(harness.resolveTokenSubject).toHaveBeenCalledWith({
      kind: "token",
      ref: "$NOT A TICKER",
      via: "address-candidate",
    });
    expect(view.textContent).toContain("Couldn't resolve that token");
    expectNoRunnerStarted();
  });

  it("does not auto-start a missing person audit from a ?live deep link", async () => {
    harness.fetchReportState.mockResolvedValue({ status: "missing", report: null });

    await renderApp("/?live=DeepLinkFounder");

    expect(harness.fetchReportState).toHaveBeenCalledWith("DeepLinkFounder", "person");
    expectNoRunnerStarted();
  });

  it("preserves a normal stored-report deep link while opening its report", async () => {
    const payload = {
      handle: "storedfounder",
      display_name: "Stored Founder",
      headline: "Stored founder has a verified track record.",
      report: {
        composite_verdict: "PASS",
        governing_score: 84,
        identity_confidence: "Confirmed",
        roles: ["Founder"],
      },
      evidence: { associates: [] },
      checkRuns: [{ checkId: "identity-resolution", status: "confirmed" }],
    };
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "person",
        ref: "storedfounder",
        payload,
        versionContext: { caseId: "case-person", reportVersionId: "version-person" },
      },
    });

    const view = await renderApp("/?s=storedfounder");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-person-report']")).not.toBeNull());

    expect(window.location.search).toBe("?s=storedfounder");
    expect(view.querySelector("[data-testid='person-case-brief']")).not.toBeNull();
    expect(harness.reconcileAuditOutcome).toHaveBeenCalledWith("storedfounder", "person", {
      verdict: "PASS",
      score: 84,
      coverage: "ready",
      summary: "Stored founder has a verified track record.",
    });
    expectNoRunnerStarted();
  });

  it("uses the report kind encoded by a native Recent audits fallback link", async () => {
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "person",
        ref: "typedfounder",
        payload: { handle: "typedfounder" },
        versionContext: { caseId: "case-typed-person", reportVersionId: "version-typed-person" },
      },
    });

    const view = await renderApp("/?s=typedfounder&kind=person");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-person-report']")).not.toBeNull());

    expect(harness.fetchReportState).toHaveBeenCalledWith("typedfounder", "person");
    expectNoRunnerStarted();
  });

  it.each([
    {
      kind: "token",
      ref: "0x9191919191919191919191919191919191919191",
      payload: { address: "0x9191919191919191919191919191919191919191", symbol: "DIRECT" },
      testId: "stored-token-report",
    },
    {
      kind: "investigation",
      ref: "0x9292929292929292929292929292929292929292",
      payload: { token: { address: "0x9292929292929292929292929292929292929292", symbol: "DIRECT" } },
      testId: "stored-investigation-report",
    },
    {
      kind: "site",
      ref: "example.com",
      payload: {
        recon: {
          retrieval: { url: "https://example.com", status: "rendered" },
          title: "Example",
          team: { state: "absent", names: [], note: "No team section found." },
          socials: [],
          funding: [],
          tokenSignals: [],
          findings: [],
          identityLine: "No named team was established from the stored site evidence.",
        },
      },
      testId: "recon-page",
    },
  ] as const)("keeps a native Recent audits $kind link on the exact read-only stored-report path", async ({ kind, ref, payload, testId }) => {
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind,
        ref,
        payload,
        versionContext: { caseId: `case-${kind}`, reportVersionId: `version-${kind}` },
      },
    });

    const view = await renderApp(`/?s=${encodeURIComponent(ref)}&kind=${kind}`);
    await vi.waitFor(() => expect(view.querySelector(`[data-testid='${testId}']`)).not.toBeNull());

    expect(harness.fetchReportState).toHaveBeenCalledWith(ref, kind);
    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expect(harness.resolveTokenSubject).not.toHaveBeenCalled();
    expectNoRunnerStarted();
  });

  it("shows durable resolution immediately while a recent report lookup is in flight", async () => {
    const address = "0x1010101010101010101010101010101010101010";
    let resolveLookup!: (value: Record<string, unknown>) => void;
    harness.fetchReportState.mockReturnValue(new Promise<Record<string, unknown>>((resolve) => {
      resolveLookup = resolve;
    }));
    harness.recentRef = address;
    const view = await renderApp();

    act(() => view.querySelector<HTMLButtonElement>("[data-testid='reopen-recent']")?.click());

    await vi.waitFor(() => expect(view.textContent).toContain("Resolving the exact subject"));
    expect(view.textContent).toContain("Durable cases and canonical identity");
    expect(view.textContent).toContain("no provider spend during resolution");
    expectNoRunnerStarted();

    await act(async () => {
      resolveLookup({
        status: "open",
        report: {
          kind: "token",
          ref: address,
          payload: { address, symbol: "RECENT" },
          versionContext: { caseId: "case-recent", reportVersionId: "version-recent" },
        },
      });
      await Promise.resolve();
    });
    await settle();

    expect(view.querySelector("[data-testid='stored-token-report']")).not.toBeNull();
    expectNoRunnerStarted();
  });

  it("never turns a missing Recent audits row into a paid scan", async () => {
    harness.recentRef = "0x2020202020202020202020202020202020202020";
    harness.fetchReportState.mockResolvedValue({ status: "missing", report: null });
    const view = await renderApp();

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='reopen-recent']")?.click());
    await settle();

    expect(view.textContent).toContain("No stored case exists yet");
    expect(view.textContent).toContain("did not automatically start a collector");
    expectNoRunnerStarted();
  });

  it("exits Recent audits resolution safely when the durable lookup rejects", async () => {
    harness.recentRef = "0x3030303030303030303030303030303030303030";
    harness.fetchReportState.mockRejectedValue(new Error("network failed before a response"));
    const view = await renderApp();

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='reopen-recent']")?.click());
    await settle();

    expect(view.textContent).toContain("Stored case status is unavailable");
    expectNoRunnerStarted();
  });

  it("opens one exact immutable evidence version without consulting or launching the active case", async () => {
    const versionId = "00000000-0000-4000-8000-000000000201";
    const address = "0x1111111111111111111111111111111111111111";
    harness.fetchReportVersion.mockResolvedValue({
      kind: "token",
      ref: address,
      payload: { address, symbol: "EXACT" },
      versionContext: { caseId: "case-token", reportVersionId: versionId },
    });

    const view = await renderApp(`/?version=${versionId}`);
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-token-report']")).not.toBeNull());

    expect(harness.fetchReportVersion).toHaveBeenCalledWith(versionId);
    expect(harness.fetchReportState).not.toHaveBeenCalled();
    expectNoRunnerStarted();
    expect(view.textContent).toContain("Immutable evidence review");
    expect(view.querySelector("[data-testid='token-case-brief']")).toBeNull();

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='nav-home']")?.click());
    await settle();

    expect(window.location.search).toBe("");
    expect(view.textContent).not.toContain("Immutable evidence review");
    expect(view.querySelector("[data-testid='landing-run']")).not.toBeNull();

    harness.shellInput = address;
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-token",
        kind: "token",
        ref: address,
        query: "$EXACT",
        status: "open",
      }],
    });
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "token",
        ref: address,
        payload: { address, symbol: "EXACT" },
        versionContext: { caseId: "case-token", reportVersionId: versionId },
      },
    });

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='shell-run']")?.click());
    await vi.waitFor(() => expect(view.querySelector("[data-testid='token-case-brief']")).not.toBeNull());
  });

  it.each([
    ["token", "open-derived-token", "stored-token-report"],
    ["project account", "open-derived-account", "stored-person-report"],
  ])("keeps the exact evidence route while opening the derived %s facet", async (_label, buttonId, reportId) => {
    const versionId = "00000000-0000-4000-8000-000000000211";
    const address = "0x1111111111111111111111111111111111111112";
    harness.fetchReportVersion.mockResolvedValue({
      kind: "investigation",
      ref: address,
      payload: {
        token: { address, symbol: "EXACT" },
        projectAccount: { handle: "@exact_project" },
      },
      versionContext: { caseId: "case-investigation", reportVersionId: versionId },
    });

    const view = await renderApp(`/?version=${versionId}`);
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-investigation-report']")).not.toBeNull());
    await act(async () => view.querySelector<HTMLButtonElement>(`[data-testid='${buttonId}']`)?.click());
    await settle();

    expect(view.querySelector(`[data-testid='${reportId}']`)).not.toBeNull();
    expect(window.location.search).toBe(`?version=${versionId}`);
    expect(view.textContent).toContain("Immutable evidence review");
  });

  it("serializes same-token persistence and never lets the older completion replace the newer scan", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    let resolveFirst!: (value: { state: "persisted"; reportVersionId: string; panelCostToken: string }) => void;
    let resolveSecond!: (value: { state: "persisted"; reportVersionId: string; panelCostToken: string }) => void;
    const firstPersistence = new Promise<{ state: "persisted"; reportVersionId: string; panelCostToken: string }>((resolve) => { resolveFirst = resolve; });
    const secondPersistence = new Promise<{ state: "persisted"; reportVersionId: string; panelCostToken: string }>((resolve) => { resolveSecond = resolve; });
    harness.syncReport.mockReset()
      .mockReturnValueOnce(firstPersistence)
      .mockReturnValueOnce(secondPersistence);
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "token",
        ref: address,
        payload: { address, symbol: "OLD", headline: "older durable report" },
        versionContext: { caseId: "case-token", reportVersionId: "version-old" },
      },
    });
    harness.recentRef = address;
    const view = await renderApp();
    expect(harness.scanOnComplete).not.toBeNull();
    await act(async () => {
      harness.scanOnComplete?.({ id: "scan-1", kind: "token", priv: false, result: tokenResult(address, "first scan") });
      harness.scanOnComplete?.({ id: "scan-2", kind: "token", priv: false, result: tokenResult(address, "second scan") });
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(harness.syncReport).toHaveBeenCalledTimes(1));
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='reopen-recent']")?.click());
    await settle();
    expect(harness.tokenReports.at(-1)).toEqual(expect.objectContaining({
      headline: "second scan",
      persistence: expect.objectContaining({ state: "pending", scanId: "scan-2" }),
    }));

    await act(async () => {
      resolveFirst({ state: "persisted", reportVersionId: "version-1", panelCostToken: "panel-1" });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(harness.syncReport).toHaveBeenCalledTimes(2));
    harness.fetchReportState.mockResolvedValue({ status: "open", report: null });
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='reopen-recent']")?.click());
    await settle();
    expect(harness.tokenReports.at(-1)).toEqual(expect.objectContaining({
      headline: "second scan",
      persistence: expect.objectContaining({ state: "pending", scanId: "scan-2" }),
    }));

    await act(async () => {
      resolveSecond({ state: "persisted", reportVersionId: "version-2", panelCostToken: "panel-2" });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(harness.tokenReports.at(-1)).toEqual(expect.objectContaining({
      headline: "second scan",
      persistence: expect.objectContaining({ state: "persisted", scanId: "scan-2", reportVersionId: "version-2" }),
    })));
  });

  it("prefers a scan that completes while durable report lookup is in flight", async () => {
    const address = "0x3333333333333333333333333333333333333333";
    let resolveLookup!: (value: Record<string, unknown>) => void;
    harness.fetchReportState.mockReturnValue(new Promise<Record<string, unknown>>((resolve) => { resolveLookup = resolve; }));
    harness.recentRef = address;
    const view = await renderApp();

    act(() => view.querySelector<HTMLButtonElement>("[data-testid='reopen-recent']")?.click());
    await vi.waitFor(() => expect(harness.fetchReportState).toHaveBeenCalledWith(address, "token"));
    await act(async () => {
      harness.scanOnComplete?.({ id: "scan-during-lookup", kind: "token", priv: false, result: tokenResult(address, "completed during lookup") });
      await Promise.resolve();
    });
    resolveLookup({
      status: "open",
      report: {
        kind: "token",
        ref: address,
        payload: { address, symbol: "OLD", headline: "older durable report" },
        versionContext: { caseId: "case-token", reportVersionId: "version-old" },
      },
    });
    await settle();

    expect(harness.tokenReports.at(-1)).toEqual(expect.objectContaining({
      headline: "completed during lookup",
      persistence: expect.objectContaining({ state: "failed", scanId: "scan-during-lookup" }),
    }));
  });

  it("runs deep investigation team discovery only after persistence with the exact capability", async () => {
    const address = "0x6666666666666666666666666666666666666666";
    harness.syncReport.mockResolvedValue({
      state: "persisted",
      reportVersionId: "00000000-0000-4000-8000-000000000266",
      panelCostToken: "signed-investigation-capability",
    });
    harness.fetchReconWebTeam.mockResolvedValue([{ name: "Bound Founder", role: "founder" }]);
    await renderApp();

    await act(async () => {
      harness.scanOnComplete?.({
        id: "investigation-supplement-scan",
        kind: "investigation",
        priv: false,
        result: {
          rootRef: address,
          token: tokenResult(address, "investigation core"),
          projectX: null,
          siteUrl: "https://project.example",
          recon: { team: { names: [] }, socials: [] },
          projectAccount: null,
          founders: [],
          founderNote: "Core report",
          deployerTrail: null,
          webTeam: [],
        },
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(harness.fetchReconWebTeam).toHaveBeenCalledWith(
      "https://project.example",
      "Ordering Test",
      expect.objectContaining({ team: { names: [] } }),
      "signed-investigation-capability",
    ));
  });

  it("retries a failed quick lookup as a quick token audit, not a full investigation", async () => {
    harness.shellInput = "$QUICK";
    harness.resolveStoredCases.mockResolvedValueOnce({ status: "unavailable", subjects: [] });
    const view = await renderApp();

    await act(async () => {
      view.querySelector<HTMLButtonElement>("[data-testid='shell-run']")?.click();
    });
    await settle();

    harness.resolveStoredCases.mockResolvedValue({ status: "ok", subjects: [] });
    harness.resolveTokenSubject.mockResolvedValue({
      state: "resolved",
      candidate: {
        input: { kind: "token", ref: "0x1111111111111111111111111111111111111111", via: "evm" },
        canonicalRef: "0x1111111111111111111111111111111111111111",
        chain: "ethereum",
        symbol: "QUICK",
        name: "Quick",
        pairAddress: "pair",
        liquidityUsd: 10,
      },
    });

    const retry = [...view.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Retry safely"));
    expect(retry).toBeDefined();
    await act(async () => { retry?.click(); });
    await settle();

    expect(harness.startTokenScan).toHaveBeenCalledTimes(1);
    expect(harness.startInvestigationScan).not.toHaveBeenCalled();
  });

  it("opens a stored site report with initialRecon and no fresh recon input", async () => {
    const storedRecon = {
      retrieval: { url: "https://example.com", status: "rendered" },
      title: "Example",
    };
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-site",
        kind: "site",
        ref: "example.com",
        query: "example.com",
        status: "open",
      }],
    });
    const siteVersionContext = { caseId: "case-site", reportVersionId: "version-site", version: 3, createdAt: "2026-07-10T12:00:00.000Z" };
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: { kind: "site", payload: { recon: storedRecon }, versionContext: siteVersionContext },
    });

    const view = await renderApp("/?site=HTTPS%3A%2F%2FExample.COM%2F");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='recon-page']")).not.toBeNull());

    expect(harness.resolveStoredCases).toHaveBeenCalledWith("example.com");
    const latestProps = harness.reconProps.at(-1);
    expect(latestProps?.initialRecon).toBe(storedRecon);
    expect(latestProps?.initialUrl).toBeUndefined();
    expect(latestProps?.initialVersionContext).toBe(siteVersionContext);
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='site-case-brief']")?.click());
    await settle();
    expect(harness.caseBriefTargets.at(-1)).toEqual({
      caseId: "case-site",
      expectedReportVersionId: "version-site",
    });
    expectNoRunnerStarted();
  });

  it("remounts a same-host site snapshot when its immutable version changes", async () => {
    const address = "example.com";
    const firstRecon = { retrieval: { url: "https://example.com", status: "rendered" }, title: "Version one" };
    const secondRecon = { retrieval: { url: "https://example.com", status: "rendered" }, title: "Version two" };
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{ caseId: "case-site", kind: "site", ref: address, query: address, status: "open" }],
    });
    harness.fetchReportState.mockResolvedValueOnce({
      status: "open",
      report: {
        kind: "site",
        payload: { recon: firstRecon },
        versionContext: { caseId: "case-site", reportVersionId: "version-site-1" },
      },
    });

    const view = await renderApp("/?site=example.com");
    await vi.waitFor(() => expect(harness.reconMounts).toBe(1));
    harness.fetchReportState.mockResolvedValueOnce({
      status: "open",
      report: {
        kind: "site",
        payload: { recon: secondRecon },
        versionContext: { caseId: "case-site", reportVersionId: "version-site-2" },
      },
    });

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='reopen-site']")?.click());
    await vi.waitFor(() => expect(harness.reconMounts).toBe(2));

    expect(harness.reconProps.at(-1)?.initialRecon).toBe(secondRecon);
    expect(harness.reconProps.at(-1)?.initialVersionContext).toEqual(expect.objectContaining({
      reportVersionId: "version-site-2",
    }));
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='site-case-brief']")?.click());
    await settle();
    expect(harness.caseBriefTargets.at(-1)).toEqual({
      caseId: "case-site",
      expectedReportVersionId: "version-site-2",
    });
  });

  it("keeps the owning investigation brief and suppresses it on the derived token pivot", async () => {
    const address = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-investigation",
        kind: "investigation",
        ref: address,
        query: "$EXACT",
        status: "open",
      }],
    });
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "investigation",
        payload: {
          token: { address },
          projectAccount: { handle: "@nested_project" },
          versionContext: { caseId: "case-investigation", reportVersionId: "version-investigation" },
        },
      },
    });

    const view = await renderApp(`/?inv=${address}`);
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-investigation-report']")).not.toBeNull());

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='investigation-case-brief']")?.click());
    await settle();
    expect(harness.caseBriefTargets.at(-1)).toEqual({
      caseId: "case-investigation",
      expectedReportVersionId: "version-investigation",
    });

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='open-derived-token']")?.click());
    await settle();
    expect(view.querySelector("[data-testid='stored-token-report']")).not.toBeNull();
    expect(view.querySelector("[data-testid='token-case-brief']")).toBeNull();
  });

  it("does not infer a durable person brief for a private nested project-account snapshot", async () => {
    const address = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-investigation",
        kind: "investigation",
        ref: address,
        query: "$EXACT",
        status: "open",
      }],
    });
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "investigation",
        payload: {
          token: { address },
          projectAccount: { handle: "@nested_project" },
          versionContext: { caseId: "case-investigation", reportVersionId: "version-investigation" },
        },
      },
    });

    const view = await renderApp(`/?inv=${address}`);
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-investigation-report']")).not.toBeNull());
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='open-derived-account']")?.click());
    await settle();

    expect(view.querySelector("[data-testid='stored-person-report']")).not.toBeNull();
    expect(view.querySelector("[data-testid='person-case-brief']")).toBeNull();
  });

  it("keeps person and project pivots private and prevents project graph recording", async () => {
    harness.landingInput = "@private_source";
    harness.landingPrivate = true;
    const view = await renderApp();
    await submitLanding();
    await vi.waitFor(() => expect(view.querySelector("[data-testid='finish-person-run']")).not.toBeNull());

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='finish-person-run']")?.click());
    await settle();
    expect(harness.personReports.at(-1)?.dossier).toEqual(expect.objectContaining({
      persistence: { state: "private" },
    }));

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='person-pivot']")?.click());
    await settle();
    expect(harness.startPersonAudit).toHaveBeenLastCalledWith("person_pivot", true);

    // Return to the source report, then follow its project exploration path.
    await act(async () => {
      const source = harness.personReports[0];
      (source?.onOpenProject as ((name: string) => void) | undefined)?.("Private Project");
    });
    await settle();
    expect(harness.projectViews.at(-1)?.record).toBe(false);

    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='project-person-pivot']")?.click());
    await settle();
    expect(harness.startPersonAudit).toHaveBeenLastCalledWith("project_pivot", true);
  });

  it("keeps token and investigation founder pivots private", async () => {
    const tokenAddress = "0x4444444444444444444444444444444444444444";
    harness.shellInput = tokenAddress;
    harness.shellPrivate = true;
    harness.resolveTokenSubject.mockResolvedValue({
      state: "resolved",
      candidate: {
        input: { kind: "token", ref: tokenAddress, via: "evm" },
        canonicalRef: tokenAddress,
        chain: "ethereum",
        symbol: "PRIVATE",
        name: "Private Token",
        pairAddress: "pair",
        liquidityUsd: 10,
      },
    });
    const view = await renderApp();
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='shell-run']")?.click());
    await settle();
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='finish-token-run']")?.click());
    await settle();

    expect(harness.tokenReports.at(-1)?.persistence).toEqual({ state: "private", scanId: "private-token-scan" });
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='token-pivot']")?.click());
    await settle();
    expect(harness.startPersonAudit).toHaveBeenLastCalledWith("token_pivot", true);

    // Start a separate private investigation and verify its founder callback.
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='nav-home']")?.click());
    harness.landingInput = "0x5555555555555555555555555555555555555555";
    harness.landingPrivate = true;
    await submitLanding();
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='finish-investigation-run']")?.click());
    await settle();
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='investigation-pivot']")?.click());
    await settle();
    expect(harness.startPersonAudit).toHaveBeenLastCalledWith("investigation_pivot", true);
  });

  it("canonicalizes a private ticker without reopening its existing public case", async () => {
    const address = "0x7777777777777777777777777777777777777777";
    const candidate = {
      input: { kind: "token" as const, ref: address, via: "evm" as const },
      canonicalRef: address,
      chain: "ethereum",
      symbol: "PRIVATE",
      name: "Private Canonical Token",
      pairAddress: "pair-private",
      liquidityUsd: 100,
    };
    harness.landingInput = "$PRIVATE";
    harness.landingPrivate = true;
    harness.resolveTokenSubject.mockResolvedValue({ state: "resolved", candidate });
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "public-case",
        kind: "investigation",
        ref: address,
        query: "$PRIVATE",
        status: "open",
      }],
    });

    await renderApp();
    await submitLanding();

    expect(harness.resolveTokenSubject).toHaveBeenCalled();
    expect(harness.resolveStoredCases).not.toHaveBeenCalled();
    expect(harness.fetchReportState).not.toHaveBeenCalled();
    expect(harness.startInvestigationScan).toHaveBeenCalledWith(candidate.input, true, { force: true });
  });

  it("does not navigate away when an unsaved case brief close is declined", async () => {
    const storedRecon = {
      retrieval: { url: "https://example.com", status: "rendered" },
      title: "Example",
    };
    harness.resolveStoredCases.mockResolvedValue({
      status: "ok",
      subjects: [{
        caseId: "case-site",
        kind: "site",
        ref: "example.com",
        query: "example.com",
        status: "open",
      }],
    });
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: { kind: "site", payload: { recon: storedRecon }, versionContext: { caseId: "case-site", reportVersionId: "version-site" } },
    });
    const view = await renderApp("/?site=example.com");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='recon-page']")).not.toBeNull());
    harness.caseBriefDirty = true;
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='site-case-brief']")?.click());
    await settle();

    harness.shellInput = "@different_subject";
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => view.querySelector<HTMLButtonElement>("[data-testid='shell-run']")?.click());
    await settle();

    expect(confirm).toHaveBeenCalledWith("Discard your unsaved case brief changes and note draft?");
    expect(view.querySelector("[data-testid='case-brief-panel']")).not.toBeNull();
    expectNoRunnerStarted();
  });
});
