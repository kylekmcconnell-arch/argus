// @vitest-environment jsdom

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  landingInput: "",
  shellInput: "",
  reconProps: [] as Array<Record<string, unknown>>,
  reconMounts: 0,
  caseBriefTargets: [] as Array<Record<string, unknown>>,
  caseBriefDirty: false,
  fetchReport: vi.fn(),
  fetchReportVersion: vi.fn(),
  fetchReportState: vi.fn(),
  getRun: vi.fn(),
  getScanRun: vi.fn(),
  probeBackend: vi.fn(),
  resolveStoredCases: vi.fn(),
  resolveTokenSubject: vi.fn(),
  startInvestigationScan: vi.fn(),
  startPersonAudit: vi.fn(),
  startTokenScan: vi.fn(),
}));

vi.mock("./components/AppShell", () => ({
  AppShell: ({ children, onAudit, onNav }: { children: ReactNode; onAudit: (input: string) => void | Promise<void>; onNav: (target: "idle") => void }) => (
    <main>
      <button data-testid="nav-home" onClick={() => onNav("idle")}>Home</button>
      <button data-testid="shell-run" onClick={() => { void onAudit(harness.shellInput); }}>Run quick audit</button>
      {children}
    </main>
  ),
}));

vi.mock("./components/Landing", () => ({
  Landing: ({ onAudit }: { onAudit: (input: string, priv?: boolean) => void | Promise<void> }) => (
    <button
      data-testid="landing-run"
      onClick={() => { void onAudit(harness.landingInput, false); }}
    >
      Run investigation
    </button>
  ),
}));

vi.mock("./components/LiveRun", () => ({
  LiveRun: () => <div data-testid="live-run">Live run</div>,
}));

vi.mock("./components/Report", () => ({
  Report: (props: { onOpenBrief?: () => void }) => (
    <div data-testid="stored-person-report">
      Stored person report
      {props.onOpenBrief && <button data-testid="person-case-brief" onClick={props.onOpenBrief}>Case brief</button>}
    </div>
  ),
}));

vi.mock("./components/InvestigationReport", () => ({
  InvestigationReport: (props: { onOpenToken: () => void; onOpenProjectAccount: () => void; onOpenBrief?: () => void }) => (
    <div data-testid="stored-investigation-report">
      Stored investigation report
      <button data-testid="open-derived-token" onClick={props.onOpenToken}>Open token</button>
      <button data-testid="open-derived-account" onClick={props.onOpenProjectAccount}>Open account</button>
      {props.onOpenBrief && <button data-testid="investigation-case-brief" onClick={props.onOpenBrief}>Case brief</button>}
    </div>
  ),
}));

vi.mock("./components/TokenReport", () => ({
  TokenReport: (props: { onOpenBrief?: () => void }) => (
    <div data-testid="stored-token-report">
      Stored token report
      {props.onOpenBrief && <button data-testid="token-case-brief" onClick={props.onOpenBrief}>Case brief</button>}
    </div>
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
  logAudit: vi.fn(),
}));

vi.mock("./graph/store", () => ({
  hydrateCommunityGraph: vi.fn(),
  investigationContribution: vi.fn(),
  personContribution: vi.fn(),
  recordContribution: vi.fn(),
  tokenContribution: vi.fn(),
}));

vi.mock("./lib/live", () => ({
  probeBackend: harness.probeBackend,
}));

vi.mock("./lib/runner", () => ({
  getRun: harness.getRun,
  setOnComplete: vi.fn(),
  startPersonAudit: harness.startPersonAudit,
}));

vi.mock("./lib/scanrunner", () => ({
  getScanRun: harness.getScanRun,
  setScanOnComplete: vi.fn(),
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
  syncReport: vi.fn(),
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

function expectNoRunnerStarted(): void {
  expect(harness.startPersonAudit).not.toHaveBeenCalled();
  expect(harness.startTokenScan).not.toHaveBeenCalled();
  expect(harness.startInvestigationScan).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.landingInput = "";
  harness.shellInput = "";
  harness.reconProps.length = 0;
  harness.reconMounts = 0;
  harness.caseBriefTargets.length = 0;
  harness.caseBriefDirty = false;
  harness.fetchReport.mockResolvedValue(null);
  harness.fetchReportVersion.mockResolvedValue(null);
  harness.fetchReportState.mockResolvedValue({ status: "missing", report: null });
  harness.getRun.mockReturnValue(null);
  harness.getScanRun.mockReturnValue(null);
  harness.probeBackend.mockResolvedValue({ configured: true });
  harness.resolveStoredCases.mockResolvedValue({ status: "ok", subjects: [] });
  harness.resolveTokenSubject.mockResolvedValue({ state: "not_found" });
  harness.startTokenScan.mockReturnValue({ priv: false });
  harness.startInvestigationScan.mockReturnValue({ priv: false });
  harness.startPersonAudit.mockReturnValue({ priv: false });
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
  it("does not attach to or launch any runner when the durable case is archived", async () => {
    harness.landingInput = "@archivedfounder";
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
    await submitLanding();

    expect(view.textContent).toContain("This case is archived");
    expect(harness.getRun).not.toHaveBeenCalled();
    expectNoRunnerStarted();
  });

  it("fails closed before runners or cached runs when case status is unavailable", async () => {
    harness.landingInput = "@statusunknown";
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
    await submitLanding();

    expect(view.textContent).toContain("Stored case status is unavailable");
    expect(harness.getRun).not.toHaveBeenCalled();
    expectNoRunnerStarted();
  });

  it.each([
    ["X profile URL", "https://x.com/Alice/status/123", "Alice"],
    ["site URL", "HTTPS://Example.COM/Path/", "example.com"],
  ])("uses the canonical durable-case lookup for a %s", async (_label, input, canonical) => {
    harness.landingInput = input;
    harness.resolveStoredCases.mockResolvedValue({ status: "unavailable", subjects: [] });

    await renderApp();
    await submitLanding();

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
    expectNoRunnerStarted();
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
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: {
        kind: "person",
        ref: "storedfounder",
        payload: { handle: "storedfounder" },
        versionContext: { caseId: "case-person", reportVersionId: "version-person" },
      },
    });

    const view = await renderApp("/?s=storedfounder");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='stored-person-report']")).not.toBeNull());

    expect(window.location.search).toBe("?s=storedfounder");
    expect(view.querySelector("[data-testid='person-case-brief']")).not.toBeNull();
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
    harness.fetchReportState.mockResolvedValue({
      status: "open",
      report: { kind: "site", payload: { recon: storedRecon }, versionContext: { caseId: "case-site", reportVersionId: "version-site" } },
    });

    const view = await renderApp("/?site=HTTPS%3A%2F%2FExample.COM%2F");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='recon-page']")).not.toBeNull());

    expect(harness.resolveStoredCases).toHaveBeenCalledWith("example.com");
    const latestProps = harness.reconProps.at(-1);
    expect(latestProps?.initialRecon).toBe(storedRecon);
    expect(latestProps?.initialUrl).toBeUndefined();
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
