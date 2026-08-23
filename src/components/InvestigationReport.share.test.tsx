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
  MethodologyChecklist: ({ id, summaryLabel }: { id?: string; summaryLabel?: string }) => (
    <div id={id} data-panel="methodology">{summaryLabel}</div>
  ),
}));
vi.mock("./ArkhamName", () => ({ ArkhamName: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => { harness.livePanel("add-info"); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => { harness.livePanel("link-entity"); return null; } }));
vi.mock("./ArgusEyeAssistant", () => ({
  ArgusEyeAssistant: (props: Record<string, unknown>) => {
    harness.askReport(props);
    return <div data-panel="ask-report" />;
  },
}));
vi.mock("./ArkhamGraphBridge", () => ({ ArkhamGraphBridge: () => null }));
vi.mock("./Counterparties", () => ({ Counterparties: (props: Record<string, unknown>) => { harness.livePanel("counterparties", props); return null; } }));
vi.mock("./RiskPaths", () => ({ RiskPaths: (props: Record<string, unknown>) => { harness.livePanel("risk-paths", props); return null; } }));
vi.mock("./Holdings", () => ({ Holdings: (props: Record<string, unknown>) => { harness.livePanel("holdings", props); return null; } }));
vi.mock("./MoneyFlowStory", () => ({ MoneyFlowStory: (props: Record<string, unknown>) => { harness.livePanel("money-flow", props); return null; } }));
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

function render(inv: Investigation, onReAudit?: () => void, onOpenBrief?: () => void, shareView?: boolean) {
  act(() => {
    root.render(
      <InvestigationReport
        inv={inv}
        onAudit={() => {}}
        onReset={() => {}}
        onOpenToken={() => {}}
        onOpenProjectAccount={() => {}}
        onReAudit={onReAudit}
        onOpenBrief={onOpenBrief}
        shareView={shareView}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "true");
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
  vi.unstubAllEnvs();
});

describe("investigation exact sharing", () => {
  it("uses fluid report frames instead of a centered fixed-width shell", () => {
    render(investigation());

    const frames = [...container.querySelectorAll<HTMLElement>(".report-frame")];
    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => !frame.className.includes("max-w-"))).toBe(true);
  });

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
    }), () => undefined, () => undefined);

    expect(container.textContent).toContain("Preliminary risk score");
    expect(container.textContent).toContain("EARLY SCORE 84");
    expect(container.textContent).not.toContain("PASS 84");
    expect(container.textContent).toContain("NOT READY");
    expect(container.textContent).toContain("Score only · not financial advice");
    expect(container.textContent).toContain("Before you use this report");
    expect(container.textContent).toContain("Market size");
    expect(container.textContent).toContain("1 required safety check is not finished");
    expect(container.querySelector<HTMLProgressElement>('progress[aria-label="Checks finished: 63%"]')?.value).toBe(63);
    expect(container.textContent).toContain("What supports this result");
    expect(container.textContent).not.toContain("INCOMPLETE");
    expect(container.textContent).not.toContain("Investigation incomplete");

    const statusCard = container.querySelector<HTMLElement>('[aria-label="Report status"]');
    const scoreCard = container.querySelector<HTMLElement>('[aria-label="Preliminary risk score"]');
    const marketCard = container.querySelector<HTMLElement>('[aria-label="Market size"]');
    expect(statusCard?.className).toContain("order-1");
    expect(scoreCard?.className).toContain("order-2");
    expect(marketCard?.className).toContain("order-3");
    expect(scoreCard?.querySelector(".verdict-pill-lg")).toBeNull();

    const toolbar = container.querySelector<HTMLElement>(".report-toolbar");
    const caseBrief = [...(toolbar?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent?.includes("Case brief"));
    expect(caseBrief?.className).toContain("btn-primary");
    expect(caseBrief?.className).not.toContain("hidden");
    const mobileActions = toolbar?.querySelector("details");
    expect(mobileActions?.textContent).toContain("Challenge report");
    expect(mobileActions?.textContent).toContain("Rescan current evidence");

    // The "Checks finished" counter expands into the list of exactly the rows
    // it counts as unfinished, each with its status and required marking.
    const statusCardDropdown = statusCard?.querySelector<HTMLDetailsElement>("details");
    expect(statusCardDropdown?.textContent).toContain("Checks finished");
    const unfinishedList = statusCardDropdown?.querySelector('[aria-label="Checks not finished"]');
    expect(unfinishedList?.textContent).toContain("Trust-graph reconciliation");
    expect(unfinishedList?.textContent).toContain("news-press");
    expect(unfinishedList?.textContent).toContain("did not finish");
    expect(unfinishedList?.textContent).toContain("required");
    // Post-scan enrichment rows are not part of the counter and must not
    // appear in the list that explains it.
    expect(unfinishedList?.textContent).not.toContain("deployer-trail-evm");
  });

  it("separates a company's equity round from its token market value", () => {
    render(investigation({
      token: {
        ...token(),
        symbol: "VVV",
        name: "Venice Token",
        mcap: 582_760_000,
        fdv: 990_280_000,
      },
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
        basicFacts: [{
          factId: "venice-series-a",
          predicate: "funding",
          value: "$65 million Series A",
          qualifier: "July 1, 2026",
          status: "verified",
          critical: true,
          sources: [{
            url: "https://venice.ai/blog/venice-raises-65-million-series-a",
            title: "Venice Raises $65 Million Series A at a $1 Billion Valuation",
            excerpt: "Venice raised a $65 million Series A led by Dragonfly at a $1 billion valuation.",
            relation: "supports",
            provider: "public-web",
            sourceClass: "official_subject",
          }],
        }],
        webTeam: [],
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

    const capital = container.querySelector('[aria-label="Company funding and token market"]');
    expect(capital?.textContent).toContain("Company funding and the $VVV token");
    expect(capital?.textContent).toContain("$65.00M");
    // The round schedule carries the name and date per row; the summed total
    // above it is labelled as a floor, not a lifetime raise.
    expect(capital?.textContent).toContain("Series A");
    expect(capital?.textContent).toContain("Jul 1, 2026");
    expect(capital?.textContent).toContain("Sum of 1 priced round");
    expect(capital?.textContent).toContain("Company valuation $1.00B");
    expect(capital?.textContent).toContain("Led by Dragonfly");
    expect(capital?.textContent).toContain("$582.76M");
    expect(capital?.textContent).toContain("Value if all tokens circulated $990.28M");
    expect(capital?.textContent).toContain("Company ownership · not token ownership");
    expect(capital?.textContent).toContain("Token market value · not company valuation");
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

  it("promotes domain-bound LinkedIn leadership while keeping a different unconfirmed role as a lead", () => {
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
        basicFacts: [{
          factId: "existing-teana-executive",
          predicate: "executive",
          value: "Teana Baker-Taylor",
          qualifier: "COO",
          status: "verified",
          critical: false,
          providerProjection: true,
          sources: [{
            url: "https://venice.ai/blog/welcome-to-venice",
            title: "Welcome to Venice",
            relation: "supports",
          }],
        }],
        // `excerpt` is a required field on a real BasicFactLead: it is the
        // passage the scout matched, and every lead the pipeline produces
        // carries one. These fixtures are cast through `unknown`, so they used
        // to omit it, which left the lead-relevance rule nothing to judge.
        basicFactLeads: [
          {
            predicate: "official_identity",
            value: "Venice",
            sourceUrl: "https://www.linkedin.com/company/venice-ai/",
            sourceTitle: "Venice.ai | LinkedIn",
            excerpt: "Venice.ai is a private AI application on LinkedIn.",
          },
          {
            predicate: "founder",
            value: "Erik Voorhees",
            sourceUrl: "https://www.linkedin.com/in/erikvoorhees/",
            sourceTitle: "Erik Voorhees - Venice",
            excerpt: "Founder and CEO at Venice, a crypto and private AI project.",
          },
          {
            predicate: "founder",
            value: "Jesse Proudman",
            sourceUrl: "https://www.linkedin.com/in/jesseproudman/",
            sourceTitle: "Jesse Proudman - Venice",
            excerpt: "President and CTO at Venice, a crypto and private AI project.",
          },
          {
            predicate: "product",
            value: "Private AI",
            sourceUrl: "https://example.com/venice-product",
            sourceTitle: "Venice ships Private AI",
            excerpt: "Venice launched Private AI, an inference product paid for with its token.",
          },
        ],
        webTeam: [
          {
            name: "Erik Voorhees",
            role: "Founder and CEO",
            linkedin: "https://www.linkedin.com/in/erikvoorhees/",
            source: "Monid/Akta leadership record",
            sourceUrl: "https://venice.ai",
            provider: "monid",
            evidence_origin: "deterministic",
            artifact_verified: true,
          },
          {
            name: "Jesse Proudman",
            role: "President and CTO",
            linkedin: "https://www.linkedin.com/in/jesseproudman/",
            source: "Monid/Akta leadership record",
            sourceUrl: "https://venice.ai",
            provider: "monid",
            evidence_origin: "deterministic",
            artifact_verified: true,
          },
          {
            name: "Teana Baker-Taylor",
            role: "Co-Founder and Chief Operating Officer",
            linkedin: "https://www.linkedin.com/in/teana-baker-taylor/",
            source: "Monid/Akta leadership record",
            sourceUrl: "https://venice.ai",
            provider: "monid",
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

    const facts = container.querySelector("#investigation-basic-facts");
    const reportedAnswers = facts?.querySelector('[aria-label="Context-only basic facts"]');
    const leads = facts?.querySelector('[aria-label="Unverified basic fact leads"]');
    expect(reportedAnswers?.textContent).toContain("Venice");
    expect(reportedAnswers?.textContent).toContain("Erik Voorhees");
    expect(reportedAnswers?.textContent).toContain("Jesse Proudman");
    expect(reportedAnswers?.textContent).toContain("Not independently verified");
    const leadershipCards = [...(reportedAnswers?.querySelectorAll("li") ?? [])]
      .filter((card) => [...card.querySelectorAll("p")]
        .some((paragraph) => paragraph.textContent === "Who operates it today?"));
    expect(leadershipCards).toHaveLength(1);
    const leadershipAnswer = leadershipCards[0]?.querySelector(".font-semibold > p");
    expect(leadershipAnswer?.textContent).toContain("Teana Baker-Taylor");
    expect(leads?.textContent).toContain("Private AI");
    expect(leads?.textContent).not.toContain("Erik Voorhees");
    expect(leads?.textContent).toContain("Jesse Proudman");
    expect(leads?.textContent).toContain("Who founded it?");
    expect(leads?.textContent).not.toContain("Venice.ai");
    expect([...facts!.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')].map((link) => link.href)).toEqual(expect.arrayContaining([
      "https://www.linkedin.com/in/erikvoorhees/",
      "https://www.linkedin.com/in/jesseproudman/",
      "https://www.linkedin.com/in/teana-baker-taylor/",
    ]));
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
          {
            name: "@twistartups",
            handle: "@twistartups",
            role: "CEO",
            source: "official project post",
            sourceUrl: "https://x.com/askvenice/status/1",
            provider: "twitterapi",
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
    expect(container.textContent).toContain("Team evidence");
    expect(container.textContent).toContain("Founders (2)");
    // The handle-only "@twistartups · CEO" row (a media account bound to a
    // project-owned role by the post scan) must not render as team at all.
    expect(container.textContent).not.toContain("Other named team");
    expect(container.textContent).not.toContain("@twistartups");
    expect(container.textContent).not.toContain("Who is behind it");
    expect(container.textContent).not.toContain("The people behind it");
    expect(container.textContent).not.toContain("Full roster with roles");
    expect(container.textContent).not.toContain("project scan + project scan");
    expect(container.textContent).toContain("Token checks");
    expect(container.textContent).toContain("Project account checks");
    const teamSectionText = container.querySelector("#investigation-team")?.textContent ?? "";
    expect(teamSectionText.match(/@erikvoorhees/g)).toHaveLength(1);
  });

  it("keeps every visible story chapter in one clear sequence", () => {
    harness.graph = {
      nodes: [
        { type: "Token", key: "$ARG", subject: true },
        { type: "Person", key: "@ada" },
      ],
      edges: [{ src: "$ARG", dst: "@ada", type: "BUILT_BY" }],
    };

    render(investigation({
      founders: [{ name: "Ada Founder", handle: "@ada", source: "site" }],
    }));

    const chapterLabels = [...container.querySelectorAll<HTMLElement>(".story-chapter .report-section-heading > div > .eyebrow")]
      .map((label) => label.textContent);
    expect(chapterLabels).toEqual([
      "01 · Decision brief",
      "02 · Why",
      "03 · Market",
      "04 · People",
      "05 · Connections",
      "06 · Challenge",
      "07 · Method",
    ]);
    expect(container.textContent).toContain("What ARGUS checked");
    expect(container.textContent).not.toContain("What to verify next");
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
      inv: expect.objectContaining({ token: expect.objectContaining({ symbol: "ARG" }) }),
      reportVersionId,
    }));

    const nav = container.querySelector<HTMLElement>('nav[aria-label="Report story"]');
    expect(nav).not.toBeNull();
    const hrefs = [...(nav?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [])]
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "#report-summary",
      "#report-risks",
      "#investigation-visuals",
      "#investigation-people",
      "#investigation-methodology",
      "#investigation-challenge",
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

    expect(container.textContent).toContain("What the market tells us");
    expect(container.textContent).toContain("Market and ownership structure");
    expect(container.textContent).toContain("SAVED JUL 23, 2026");
    // Not "peak": the label names which reading this is, and neither the
    // close-based nor the range-based figure is a lifetime record.
    expect(container.textContent).toContain("From the highest close in the window");
    expect(harness.livePanel.mock.calls.filter(([name]) => name === "sparkline")).toHaveLength(1);
    expect(harness.livePanel.mock.calls.some(([name]) => name === "project-research")).toBe(false);
    expect(harness.livePanel.mock.calls.some(([name]) => name === "on-chain")).toBe(false);
  });

  it("keeps Challenge and Rescan visible in the sticky report toolbar even when checks are open", () => {
    const onReAudit = vi.fn();
    render(investigation({
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000144",
        reportVersionId,
        version: 5,
        completenessState: "partial",
        attestationState: "analyst_submitted",
        methodologyVersion: null,
        createdAt: "2026-07-24T12:00:00.000Z",
        checks: [{ checkId: "trust-graph-connections", label: "Trust graph", status: "unknown" }],
      },
    }), onReAudit);

    const toolbar = container.querySelector("header.report-toolbar");
    expect(toolbar?.querySelector('a[href="#investigation-challenge"]')?.textContent).toContain("Challenge");
    const rescan = [...(toolbar?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Rescan"));
    expect(rescan).toBeDefined();
    act(() => rescan?.click());
    expect(onReAudit).toHaveBeenCalledOnce();
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
      json: async () => ({ url: "/?share=opaque" }),
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

    // The embedded threat scan fires its own cache-check fetch on mount, so find
    // the share call rather than assuming it is first.
    const request = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/share")!;
    expect(request[0]).toBe("/api/share");
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      kind: "investigation",
      ref: address,
      reportVersionId,
    });
    expect(harness.clipboard).toHaveBeenCalledWith("http://localhost:3000/?share=opaque");
  });

  it("share view removes every workspace action but keeps the report readable", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      investigation({
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
      }),
      () => {},
      undefined,
      true,
    );

    const buttonLabels = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .map((button) => button.textContent?.trim() ?? "");
    expect(buttonLabels.some((label) => label === "Share")).toBe(false);
    expect(buttonLabels.some((label) => label.includes("Rescan"))).toBe(false);
    expect(buttonLabels.some((label) => label.includes("Watch"))).toBe(false);
    expect(container.querySelector('a[href="#investigation-challenge"]')).toBeNull();
    expect(container.textContent).not.toContain("Ask about this report");
    expect(harness.askReport).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("What could change the result");
    // The reading surfaces stay: the report body and the PDF export.
    expect(buttonLabels.some((label) => label === "Export PDF")).toBe(true);
    // The embedded threat scan is absent, so no live fetch fires from it.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("threat"))).toBe(true);
  });

  it("the document actions row mints the same read-only link and offers the PDF", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/?share=opaque" }),
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

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.some((button) => button.textContent?.trim() === "Export PDF ↓")).toBe(true);
    const rowShare = buttons.find((button) => button.textContent?.trim() === "Share ↗");
    expect(rowShare).toBeDefined();
    await act(async () => { rowShare?.click(); await Promise.resolve(); });

    const request = fetchMock.mock.calls.find((call) => String(call[0]) === "/api/share");
    expect(request).toBeDefined();
    expect(harness.clipboard).toHaveBeenCalledWith("http://localhost:3000/?share=opaque");
  });

  it("copy tldr mints a share link and pastes it under the verdict lines", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/?share=opaque" }),
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

    // The embedded threat scan fires its own cache-check fetch on mount, so find
    // the share call rather than assuming it is first.
    const request = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/share")!;
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
    expect(lines[lines.length - 1]).toBe("http://localhost:3000/?share=opaque");
  });

  it("separates project-attributed roles from independent team support and unrelated people leads", () => {
    render(investigation({
      token: { ...token(), mcap: 20_000_000 },
      recon: {
        retrieval: {
          url: "https://argus.test",
          status: "rendered",
          content: "Ada Claim, founder",
          title: "Argus",
          stages: [],
          coverageNote: "Page read.",
        },
        title: "Argus",
        team: { state: "named", names: ["Ada Claim"], note: "The site names Ada Claim." },
        socials: [],
        funding: [],
        tokenSignals: [],
        findings: [],
        identityLine: "Named on the project site: Ada Claim.",
      },
      founders: [{ name: "Ada Claim", handle: null, source: "site" }],
      projectAccount: {
        handle: "@argus",
        display_name: "Argus",
        avatar: "",
        bio: "Argus project",
        followers: "0",
        joined: "",
        identity_note: "",
        headline: "Project account",
        live: true,
        notableFollowers: [],
        contradictions: [],
        webTeam: [],
        report: { composite_verdict: "PASS", governing_score: 80, identity_confidence: "Confirmed", roles: [] },
        evidence: { ventures: [], testimonials: [], advised: [], associates: [], wallets: [], promotions: [] },
        graph: { nodes: [], edges: [] },
      } as unknown as NonNullable<Investigation["projectAccount"]>,
      webTeam: [
        {
          name: "Mira Model",
          handle: "@miramodel",
          role: "Founder",
          provider: "grok",
          evidence_origin: "model_lead",
          artifact_verified: false,
          evidenceKind: "model_candidate",
        },
        {
          name: "Tess Tagged",
          handle: "@tesstagged",
          role: "follows + tags",
          provider: "twitterapi",
          evidence_origin: "deterministic",
          artifact_verified: true,
          evidenceKind: "project_association",
        },
        {
          name: "Gina Contributor",
          handle: "@ginacodes",
          role: "github contributor",
          provider: "github",
          evidence_origin: "deterministic",
          artifact_verified: true,
          evidenceKind: "code_contribution",
        },
      ],
      webTeamDiscovery: {
        available: true,
        attempted: true,
        completed: true,
        partial: false,
        providerFailed: false,
        people: [],
      },
    }));

    const team = container.querySelector("#investigation-team");
    expect(team?.textContent).toContain("No independently corroborated team member was found");
    expect(team?.textContent).toContain("project-published role attribution is shown below");
    expect(team?.textContent).not.toContain("Named on the project site: Ada Claim.");
    expect(team?.textContent).toContain("Project-attributed team");
    expect(team?.textContent).toContain("Ada Claim");
    expect(team?.textContent).toContain("Possible people to verify");
    expect(team?.textContent).toContain("Mira Model");
    expect(team?.textContent).toContain("X association only");
    expect(team?.textContent).toContain("GitHub contribution");
    expect(team?.textContent).toContain("not counted as team or verdict support");
    expect(container.querySelector("#report-summary")?.textContent).not.toMatch(/Mira Model|Tess Tagged|Gina Contributor/);
    expect(container.textContent).toContain("Argus identifies Ada Claim as Founder");
    expect(container.textContent).toContain("Project-attributed founder behind");
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
