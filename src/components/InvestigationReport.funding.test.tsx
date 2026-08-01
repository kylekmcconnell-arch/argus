// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../lib/investigation";
import type { TokenDossier } from "../token/audit";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ arkham: vi.fn(() => ({})) }));

vi.mock("../lib/useArkhamLabels", () => ({ useArkhamLabels: harness.arkham }));
vi.mock("../graph/store", () => ({ getContributions: () => [], investigationContribution: () => null }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./OnChainForensics", () => ({ OnChainForensics: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./ProjectLinks", () => ({ ProjectLinks: () => null }));
vi.mock("./MethodologyChecklist", () => ({ MethodologyChecklist: () => null }));
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
vi.mock("./SnapshotEvidenceControl", () => ({
  LiveSupplementalNotice: () => null,
  SnapshotEvidenceControl: () => null,
}));

import { InvestigationReport } from "./InvestigationReport";

const address = "0x5555555555555555555555555555555555555555";

function token(): TokenDossier {
  return {
    address,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "UNI",
    name: "Uniswap",
    verdict: "PASS",
    score: 88,
    capApplied: null,
    headline: "Funding schedule test",
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

// Three indexed rounds. Only the Series B is newest, so anything the report
// reads off "the newest round" alone silently drops the other two.
const indexedRounds = [
  {
    date: "2020-08-07",
    round: "Series A",
    amountUsd: 11_000_000,
    leadInvestors: [] as string[],
    otherInvestors: ["a16z", "Paradigm", "USV"],
    valuationUsd: null,
  },
  {
    date: "2022-10-11",
    round: "Series B",
    amountUsd: 165_000_000,
    leadInvestors: ["Polychain Capital"],
    otherInvestors: ["Variant Fund"],
    valuationUsd: 1_660_000_000,
  },
  {
    date: "2019-04-01",
    round: "Seed",
    amountUsd: null,
    leadInvestors: ["Seed Lead LLC"],
    otherInvestors: [],
    valuationUsd: null,
  },
];

function projectAccount(): NonNullable<Investigation["projectAccount"]> {
  return {
    handle: "@uniswap",
    display_name: "Uniswap",
    avatar: "",
    bio: "Decentralized trading protocol",
    followers: "0",
    joined: "",
    identity_note: "",
    headline: "Project account",
    live: true,
    notableFollowers: [],
    contradictions: [],
    protocolFunding: {
      slug: "uniswap",
      name: "Uniswap",
      geckoId: "uniswap",
      rounds: indexedRounds,
      totalRaisedUsd: 176_000_000,
      leadInvestors: ["Polychain Capital", "Seed Lead LLC"],
      sourceUrl: "https://defillama.com/protocol/uniswap",
      capturedAt: "2026-07-30T00:00:00.000Z",
    },
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
  } as unknown as NonNullable<Investigation["projectAccount"]>;
}

function investigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    rootRef: address,
    token: token(),
    projectX: null,
    siteUrl: null,
    recon: null,
    projectAccount: projectAccount(),
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

const capitalText = () =>
  container.querySelector('[aria-label="Company funding and token market"]')?.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  harness.arkham.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("capital structure: the full round schedule", () => {
  it("lists every indexed round, not just the newest one", () => {
    render(investigation());
    const text = capitalText();
    expect(text).toContain("Series B");
    expect(text).toContain("Series A");
    expect(text).toContain("Seed");
    expect(text).toContain("Oct 11, 2022");
    expect(text).toContain("Aug 7, 2020");
    expect(text).toContain("Apr 1, 2019");
    expect(text).toContain("$165.00M");
    expect(text).toContain("$11.00M");
  });

  it("renders a round with no disclosed amount as undisclosed, never as zero", () => {
    render(investigation());
    const seedRow = [...container.querySelectorAll("li")]
      .find((row) => row.textContent?.includes("Seed"));
    expect(seedRow?.textContent).toContain("amount undisclosed");
    expect(seedRow?.textContent).not.toContain("$0");
  });

  it("unions named backers across every round instead of reading the newest one alone", () => {
    render(investigation());
    const text = capitalText();
    // Series A is the oldest priced round; its backers were being dropped.
    expect(text).toContain("a16z");
    expect(text).toContain("Paradigm");
    expect(text).toContain("USV");
    // The Seed lead is not the newest round's lead, and it must survive too.
    expect(text).toContain("Seed Lead LLC");
    expect(text).toContain("Polychain Capital");
  });

  it("keeps an other-investor out of the lead attribution", () => {
    render(investigation());
    const leadLine = [...container.querySelectorAll("p")]
      .map((node) => node.textContent ?? "")
      .find((line) => line.startsWith("Led by"));
    expect(leadLine).toBeDefined();
    expect(leadLine).toContain("Polychain Capital");
    expect(leadLine).not.toContain("a16z");
    expect(leadLine).not.toContain("Paradigm");
  });

  it("labels the headline total as a sum of priced rounds, not a verified raise", () => {
    render(investigation());
    const text = capitalText();
    expect(text).toContain("$176.00M");
    expect(text).toContain("2 priced rounds");
    expect(text).toContain("1 round with no disclosed amount");
  });

  it("declares that a round row truncated its lead list, rather than showing three as the set", () => {
    const crowded = projectAccount();
    render(investigation({
      projectAccount: {
        ...crowded,
        protocolFunding: {
          ...crowded.protocolFunding,
          rounds: [{
            date: "2022-10-11",
            round: "Series B",
            amountUsd: 165_000_000,
            leadInvestors: ["Lead One", "Lead Two", "Lead Three", "Lead Four", "Lead Five"],
            otherInvestors: [] as string[],
            valuationUsd: null,
          }],
        },
      } as unknown as NonNullable<Investigation["projectAccount"]>,
    }));

    const row = [...container.querySelectorAll("li")].find((node) => node.textContent?.includes("Series B"));
    expect(row?.textContent).toContain("Lead Three");
    // Five leads shown as three is a capped list published as the whole set.
    expect(row?.textContent).toContain("and 2 more");
  });

  it("surfaces verified investor facts alongside the indexed backers", () => {
    render(investigation({
      projectAccount: {
        ...projectAccount(),
        basicFacts: [{
          factId: "uniswap-investor-blackrock",
          predicate: "investor",
          value: "Some Verified Fund",
          status: "verified",
          critical: false,
          sources: [{
            url: "https://example.com/uniswap-round",
            title: "Round coverage",
            relation: "supports",
            provider: "public-web",
            sourceClass: "independent_press",
          }],
        }],
      } as unknown as NonNullable<Investigation["projectAccount"]>,
    }));
    expect(capitalText()).toContain("Some Verified Fund");
  });
});
