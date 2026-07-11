// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  landingInput: "",
  shellInput: "",
  reconProps: [] as Array<Record<string, unknown>>,
  fetchReport: vi.fn(),
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
  AppShell: ({ children, onAudit }: { children: ReactNode; onAudit: (input: string) => void | Promise<void> }) => (
    <main>
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
  Report: () => <div data-testid="stored-person-report">Stored person report</div>,
}));

vi.mock("./components/ReconPage", () => ({
  ReconPage: (props: Record<string, unknown>) => {
    harness.reconProps.push(props);
    return (
      <div data-testid="recon-page">
        {props.initialRecon ? "stored recon" : "fresh recon"}
      </div>
    );
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
  fetchReportState: harness.fetchReportState,
  resolveStoredCases: harness.resolveStoredCases,
  storedInvestigation: (report: { payload: unknown }) => report.payload,
  storedPersonDossier: (report: { payload: unknown }) => report.payload,
  storedSiteRecon: (report: { payload?: { recon?: unknown } }) => report.payload?.recon ?? null,
  storedTokenDossier: (report: { payload: unknown }) => report.payload,
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
  harness.fetchReport.mockResolvedValue(null);
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
      report: { kind: "site", payload: { recon: storedRecon } },
    });

    const view = await renderApp("/?site=HTTPS%3A%2F%2FExample.COM%2F");
    await vi.waitFor(() => expect(view.querySelector("[data-testid='recon-page']")).not.toBeNull());

    expect(harness.resolveStoredCases).toHaveBeenCalledWith("example.com");
    const latestProps = harness.reconProps.at(-1);
    expect(latestProps?.initialRecon).toBe(storedRecon);
    expect(latestProps?.initialUrl).toBeUndefined();
    expectNoRunnerStarted();
  });
});
