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

    expect(container.textContent).toContain("Risk score");
    expect(container.textContent).toContain("PASS 84");
    expect(container.textContent).toContain("NOT READY");
    expect(container.textContent).toContain("Score only · not financial advice");
    expect(container.textContent).toContain("Before you use this report");
    expect(container.textContent).toContain("Market size");
    expect(container.textContent).toContain("1 required safety check is not finished");
    expect(container.querySelector<HTMLProgressElement>('progress[aria-label="Checks finished: 53%"]')?.value).toBe(53);
    expect(container.textContent).toContain("What supports this result");
    expect(container.textContent).not.toContain("INCOMPLETE");
    expect(container.textContent).not.toContain("Investigation incomplete");
  });

  it("drops legacy Monid team rows that cannot be tied to the official project domain", () => {
    render(investigation({
      siteUrl: "https://venice.ai",
      projectAccount: {
        handle: "@askvenice",
        display_name: "Venice",
        avatar: "",
        bio: "Private generative AI",
        followers: "0",
        joined: "",
        identity_note: "",
        headline: "Project account",
        live: true,
        notableFollowers: [],
        contradictions: [],
        checkRuns: [{ checkId: "identity-resolution", label: "Identity", status: "confirmed" }],
        webTeam: [
          {
            name: "Nik Rae Falco",
            role: "Founder and Owner",
            source: "Monid/Akta leadership record",
            provider: "monid",
            evidence_origin: "deterministic",
            artifact_verified: true,
          },
          {
            name: "Real Builder",
            role: "Engineer",
            source: "official team page",
            sourceUrl: "https://venice.ai/about",
            provider: "team-page",
            evidence_origin: "deterministic",
            artifact_verified: true,
          },
        ],
        report: {
          composite_verdict: "PASS",
          governing_score: 80,
          identity_confidence: "Confirmed",
          roles: [],
        },
        evidence: {
          ventures: [],
          testimonials: [],
          advised: [],
          associates: [],
          wallets: [],
          promotions: [],
        },
        graph: { nodes: [], edges: [] },
      } as unknown as NonNullable<Investigation["projectAccount"]>,
    }));

    expect(container.textContent).toContain("Real Builder");
    expect(container.textContent).not.toContain("Nik Rae Falco");
  });

  it("merges handle-only team rows with the same people's full names", () => {
    render(investigation({
      siteUrl: "https://venice.ai",
      projectAccount: {
        handle: "@askvenice",
        display_name: "Venice",
        avatar: "",
        bio: "Private generative AI",
        followers: "0",
        joined: "",
        identity_note: "",
        headline: "Project account",
        live: true,
        notableFollowers: [],
        contradictions: [],
        checkRuns: [{ checkId: "identity-resolution", label: "Identity", status: "confirmed" }],
        webTeam: [
          {
            name: "Erik Voorhees",
            handle: "@erikvoorhees",
            role: "Founder & CEO",
            source: "official team page",
            sourceUrl: "https://venice.ai/about",
            provider: "team-page",
            evidence_origin: "deterministic",
            artifact_verified: true,
          },
          {
            name: "Teana Baker-Taylor",
            role: "Co-Founder & Chief Operating Officer",
            source: "official team page",
            sourceUrl: "https://venice.ai/about",
            provider: "team-page",
            evidence_origin: "deterministic",
            artifact_verified: true,
          },
        ],
        report: {
          composite_verdict: "PASS",
          governing_score: 80,
          identity_confidence: "Confirmed",
          roles: [],
        },
        evidence: {
          ventures: [],
          testimonials: [],
          advised: [],
          associates: [
            { associate_key: "@erikvoorhees", relation: "team: Founder & CEO" },
            { associate_key: "@teanataylor", relation: "team: Co-founder and COO" },
          ],
          wallets: [],
          promotions: [],
        },
        graph: { nodes: [], edges: [] },
      } as unknown as NonNullable<Investigation["projectAccount"]>,
    }));

    expect(container.textContent).toContain("Built by Erik Voorhees, Teana Baker-Taylor");
    expect(container.textContent).toContain("Team & founders (2)");
    expect(container.textContent).not.toContain("Team & founders (4)");
    expect(container.textContent).not.toContain("project scan + project scan");
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
      "#investigation-visuals",
      "#investigation-evidence",
      "#investigation-team",
      "#investigation-relationships",
      "#investigation-methodology",
    ]);
    for (const href of hrefs) {
      expect(container.querySelector(`[id="${href?.slice(1)}"]`), `${href} should resolve inside the report`).not.toBeNull();
    }

    expect(container.textContent).toContain("What supports this result");
    expect(container.textContent).toContain("Finished checks");
    expect(container.textContent).toContain("Check next");
    expect(container.querySelector('[role="progressbar"][aria-label="Checks finished"]')).not.toBeNull();
  });

  it("renders frozen visual intelligence on a snapshot without enabling live panels", () => {
    render(investigation({
      token: {
        ...token(),
        priceChange: { m5: 0.3, h1: -1.2, h6: 2.4, h24: 5.8 },
        priceHistory: {
          points: [1, 1.2, 1.1, 1.4],
          first: 1,
          last: 1.4,
          peak: 1.4,
          changePct: 40,
          drawdownPct: 0,
          timeframe: "day",
          capturedAt: "2026-07-23T22:50:55.000Z",
        },
        axes: [{ key: "T1", label: "Liquidity & lock", score: 20, weight: 24, rationale: "Deep liquidity." }],
      },
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 4,
        completenessState: "complete",
        attestationState: "analyst_submitted",
        methodologyVersion: null,
        createdAt: "2026-07-23T22:50:55.000Z",
        checks: [],
      },
    }));

    expect(container.textContent).toContain("Market and ownership charts");
    expect(container.textContent).toContain("Market and ownership structure");
    expect(container.textContent).toContain("SAVED JUL 23, 2026");
    expect(container.textContent).toContain("From captured peak");
    expect(harness.livePanel.mock.calls.filter(([name]) => name === "sparkline")).toHaveLength(1);
    expect(harness.livePanel.mock.calls.some(([name]) => name === "project-research")).toBe(false);
    expect(harness.livePanel.mock.calls.some(([name]) => name === "on-chain")).toBe(false);
  });

  it("offers a clearly labeled live price refresh for older snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    render(investigation({
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 2,
        completenessState: "complete",
        attestationState: "analyst_submitted",
        methodologyVersion: null,
        createdAt: "2026-07-10T12:00:00.000Z",
        checks: [],
      },
    }));

    expect(harness.livePanel.mock.calls.some(([name]) => name === "sparkline")).toBe(false);
    const refresh = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Check current data"));
    expect(refresh).toBeDefined();
    await act(async () => refresh?.click());

    expect(harness.livePanel.mock.calls.some(([name]) => name === "sparkline")).toBe(true);
    expect(harness.livePanel.mock.calls.some(([name]) => name === "project-research")).toBe(true);
    expect(harness.livePanel.mock.calls.some(([name]) => name === "on-chain")).toBe(false);
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
      .find((button) => button.textContent?.trim() === "Copy summary");
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
    expect(lines[0]).toContain("ARGUS · $ARG investigation · risk score PASS 88/100 · safety checks READY TO REVIEW");
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
