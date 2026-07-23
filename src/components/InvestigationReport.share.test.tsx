// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../lib/investigation";
import type { TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  clipboard: vi.fn(),
  livePanel: vi.fn(),
  askReport: vi.fn(),
  arkham: vi.fn(() => ({})),
  graph: null as null | { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
}));

vi.mock("../lib/useArkhamLabels", () => ({ useArkhamLabels: harness.arkham }));
vi.mock("../graph/store", () => ({ getContributions: () => [], investigationContribution: () => harness.graph }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));

vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: (props: Record<string, unknown>) => { harness.livePanel("on-chain", props); return null; } }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => { harness.livePanel("project-research"); return null; } }));
vi.mock("./ProjectLinks", () => ({ ProjectLinks: () => null }));
vi.mock("./MethodologyChecklist", () => ({
  MethodologyChecklist: ({ id }: { id?: string }) => <div id={id} data-panel="methodology" />,
}));
vi.mock("./ArkhamName", () => ({ ArkhamName: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => { harness.livePanel("add-info"); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => { harness.livePanel("link-entity"); return null; } }));
vi.mock("./AskReport", () => ({
  AskReport: (props: Record<string, unknown>) => {
    harness.askReport(props);
    return <div data-panel="ask-report" />;
  },
}));
vi.mock("./ArkhamGraphBridge", () => ({ ArkhamGraphBridge: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: (props: Record<string, unknown>) => { harness.livePanel("counterparties", props); return null; } }));
vi.mock("./RiskPaths", () => ({ RiskPaths: (props: Record<string, unknown>) => { harness.livePanel("risk-paths", props); return null; } }));
vi.mock("./Holdings", () => ({ Holdings: (props: Record<string, unknown>) => { harness.livePanel("holdings", props); return null; } }));
vi.mock("./TokenSparkline", () => ({ TokenSparkline: () => { harness.livePanel("sparkline"); return null; } }));
vi.mock("./NamesakeCheck", () => ({ NamesakeCheck: () => { harness.livePanel("namesake"); return null; } }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => null }));
vi.mock("./RingAlert", () => ({ RingAlert: () => { harness.livePanel("ring-alert"); return null; } }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("./SnapshotEvidenceControl", () => ({
  LiveSupplementalNotice: () => null,
  SnapshotEvidenceControl: () => null,
}));

import { InvestigationReport } from "./InvestigationReport";

const address = "0x4444444444444444444444444444444444444444";
const reportVersionId = "00000000-0000-4000-8000-000000000244";

function token(): TokenDossier {
  return {
    address,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "ARG",
    name: "Argus",
    verdict: "PASS",
    score: 88,
    capApplied: null,
    headline: "Investigation share test",
    axes: [],
    safety: { available: false, simChecked: false } as TokenDossier["safety"],
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
    safetyChecked: false,
  };
}

function investigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    rootRef: address,
    token: token(),
    projectX: null,
    siteUrl: null,
    recon: null,
    projectAccount: null,
    founders: [],
    founderNote: "No founder identity was resolved.",
    deployerTrail: null,
    webTeam: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function render(inv: Investigation) {
  act(() => {
    root.render(
      <InvestigationReport
        inv={inv}
        onAudit={() => {}}
        onReset={() => {}}
        onOpenToken={() => {}}
        onOpenProjectAccount={() => {}}
      />,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  harness.clipboard.mockReset().mockResolvedValue(undefined);
  harness.livePanel.mockReset();
  harness.askReport.mockReset();
  harness.arkham.mockClear();
  harness.graph = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: harness.clipboard },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("investigation exact sharing", () => {
  it("separates a positive risk signal from a blocked scan instead of presenting a contradictory INCOMPLETE verdict", () => {
    const recorded = [
      "contract-safety",
      "buy-sell-simulation",
      "holder-distribution",
      "wallet-clustering",
      "operator-funding-trace",
      "market-intelligence",
      "ofac-sanctions-address",
    ].map((checkId) => ({
      checkId,
      label: checkId,
      status: "confirmed" as const,
      decisionCritical: true,
    }));
    const open = [
      "deployer-trail-evm",
      "bytecode-fingerprint-evm",
      "documents-audits",
      "news-press",
      "github-forensics",
      "trust-graph-connections",
    ].map((checkId) => ({
      checkId,
      label: checkId === "trust-graph-connections" ? "Trust-graph reconciliation" : checkId,
      status: "unknown" as const,
      decisionCritical: true,
    }));

    render(investigation({
      token: { ...token(), symbol: "VVV", score: 84 },
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 4,
        completenessState: "partial",
        attestationState: "analyst_submitted",
        methodologyVersion: null,
        createdAt: "2026-07-23T22:50:55.000Z",
        checks: [...recorded, ...open],
      },
    }));

    expect(container.textContent).toContain("Observed token risk");
    expect(container.textContent).toContain("PASS 84");
    expect(container.textContent).toContain("SCAN BLOCKED");
    expect(container.textContent).toContain("1 required safety gate is still open");
    expect(container.textContent).toContain("Why ARGUS reaches PASS");
    expect(container.textContent).not.toContain("Why ARGUS reaches INCOMPLETE");
    expect(container.textContent).not.toContain("Investigation incomplete");
  });

  it("binds report chat and every decision-canvas navigation link to the immutable snapshot", () => {
    harness.graph = {
      nodes: [
        { type: "Token", key: "$ARG", subject: true },
        { type: "Person", key: "@ada" },
      ],
      edges: [{ src: "$ARG", dst: "@ada", type: "BUILT_BY" }],
    };
    render(investigation({
      founders: [{ name: "Ada Founder", handle: "@ada", source: "site" }],
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 3,
        completenessState: "complete",
        attestationState: "server_collected",
        methodologyVersion: "test-v1",
        createdAt: "2026-07-10T12:00:00.000Z",
        checks: [{ label: "Contract safety", status: "confirmed" }],
      },
    }));

    expect(harness.askReport).toHaveBeenLastCalledWith(expect.objectContaining({
      subject: "$ARG",
      reportVersionId,
    }));

    const nav = container.querySelector<HTMLElement>('nav[aria-label="Report sections"]');
    expect(nav).not.toBeNull();
    const hrefs = [...(nav?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [])]
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "#report-summary",
      "#report-risks",
      "#investigation-evidence",
      "#investigation-team",
      "#investigation-relationships",
      "#investigation-methodology",
    ]);
    for (const href of hrefs) {
      expect(container.querySelector(`[id="${href?.slice(1)}"]`), `${href} should resolve inside the report`).not.toBeNull();
    }

    expect(container.textContent).toContain("Why ARGUS reaches PASS");
    expect(container.textContent).toContain("Recorded outcomes");
    expect(container.textContent).toContain("Open questions");
    expect(container.querySelector('[role="progressbar"][aria-label="Evidence coverage"]')).not.toBeNull();
  });

  it("shares the exact immutable investigation version being reviewed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/api/card?share=opaque" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(investigation({
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 3,
        completenessState: "complete",
        attestationState: "server_collected",
        methodologyVersion: "test-v1",
        createdAt: "2026-07-10T12:00:00.000Z",
        checks: [],
      },
    }));

    const share = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Share");
    expect(share).toBeDefined();
    await act(async () => share?.click());

    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/share");
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      kind: "investigation",
      ref: address,
      reportVersionId,
    });
    expect(harness.clipboard).toHaveBeenCalledWith("http://localhost:3000/api/card?share=opaque");
  });

  it("copy tldr mints a share link and pastes it under the verdict lines", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/api/card?share=opaque" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(investigation({
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 3,
        completenessState: "complete",
        attestationState: "server_collected",
        methodologyVersion: "test-v1",
        createdAt: "2026-07-10T12:00:00.000Z",
        checks: [{ label: "Contract safety", status: "confirmed" }],
      },
    }));

    const tldr = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "copy tldr");
    expect(tldr).toBeDefined();
    await act(async () => tldr?.click());

    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/share");
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      kind: "investigation",
      ref: address,
      reportVersionId,
    });
    const pasted = String(harness.clipboard.mock.calls[0]?.[0]);
    const lines = pasted.split("\n");
    expect(lines[0]).toContain("ARGUS · $ARG investigation · observed token risk PASS 88/100 · readiness DECISION READY");
    expect(lines).toContain("Investigation share test");
    expect(lines[lines.length - 1]).toBe("http://localhost:3000/api/card?share=opaque");
  });

  it("does not offer a share from a private investigation", () => {
    render(investigation({ persistence: { state: "private", scanId: "private-scan" } }));

    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Share")).toBe(false);
    expect(harness.livePanel).not.toHaveBeenCalled();
    expect(harness.arkham).toHaveBeenCalledWith([], undefined);
  });

  it("threads the saved report capability through every keyed current-data panel", () => {
    render(investigation({
      token: { ...token(), deployer: address },
      persistence: {
        state: "persisted",
        reportVersionId,
        panelCostToken: "signed-panel-capability",
      },
    }));

    for (const panel of ["on-chain", "counterparties", "risk-paths", "holdings"]) {
      expect(harness.livePanel.mock.calls.find(([name]) => name === panel)?.[1]).toEqual(
        expect.objectContaining({ panelCostToken: "signed-panel-capability" }),
      );
    }
    expect(harness.arkham).toHaveBeenCalledWith(
      [address, undefined],
      "signed-panel-capability",
    );
  });
});
