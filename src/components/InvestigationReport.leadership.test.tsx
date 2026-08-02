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

const address = "0x7777777777777777777777777777777777777777";

function token(): TokenDossier {
  return {
    address,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "ORB",
    name: "Orbit",
    verdict: "PASS",
    score: 70,
    capApplied: null,
    headline: "Leadership currency test",
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

const webTeam = [
  {
    name: "Ada Okafor",
    role: "Co-Founder",
    linkedin: "linkedin.com/in/ada-okafor",
    provider: "teampage",
    evidence_origin: "deterministic",
    artifact_verified: true,
    source_url: "https://orbit.example/team",
  },
  {
    name: "Bram Vos",
    role: "CTO",
    linkedin: "linkedin.com/in/bram-vos",
    provider: "teampage",
    evidence_origin: "deterministic",
    artifact_verified: true,
    source_url: "https://orbit.example/team",
  },
  {
    name: "Cleo Nash",
    role: "CFO",
    provider: "teampage",
    evidence_origin: "deterministic",
    artifact_verified: true,
    source_url: "https://orbit.example/team",
  },
];

const leaderDepartures = [
  {
    name: "Ada Okafor",
    role: "Co-Founder",
    linkedin: "linkedin.com/in/ada-okafor",
    state: "departed" as const,
    summary: "Ada Okafor no longer lists Orbit as a current role: the record ends March 2024 (Co-Founder).",
    ended: "2024-03",
  },
  {
    name: "Bram Vos",
    role: "CTO",
    linkedin: "linkedin.com/in/bram-vos",
    state: "current" as const,
    summary: "Bram Vos still lists CTO at Orbit as a current role, held since January 2021.",
  },
  {
    name: "Cleo Nash",
    role: "CFO",
    state: "absent" as const,
    summary: "Cleo Nash has no Orbit role on their employment record. That record may simply be incomplete, so it is not evidence they were never involved.",
  },
];

function projectAccount(
  overrides: Record<string, unknown> = {},
): NonNullable<Investigation["projectAccount"]> {
  return {
    handle: "@orbit",
    display_name: "Orbit",
    avatar: "",
    bio: "Orbit protocol",
    followers: "0",
    joined: "",
    identity_note: "",
    headline: "Project account",
    live: true,
    notableFollowers: [],
    contradictions: [],
    webTeam,
    leaderDepartures,
    report: {
      composite_verdict: "PASS",
      governing_score: 70,
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
    ...overrides,
  } as unknown as NonNullable<Investigation["projectAccount"]>;
}

function investigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    rootRef: address,
    token: token(),
    projectX: "@orbit",
    siteUrl: "https://orbit.example",
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

const teamText = () => container.querySelector("#investigation-team")?.textContent ?? "";

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

describe("leadership currency on the team card", () => {
  it("renders the paid departure answer instead of dropping it", () => {
    render(investigation());
    const text = teamText();
    expect(text).toContain("Ada Okafor");
    expect(text).toContain("no longer lists this project");
    // The end date the record itself carries, not a paraphrase.
    expect(text).toContain("March 2024");
  });

  it("names the leader who is still listed as a separate confirmed answer", () => {
    render(investigation());
    const text = teamText();
    expect(text).toContain("Bram Vos");
    expect(text).toContain("still lists this project");
  });

  it("stays silent about a leader the employment record could not answer for", () => {
    render(investigation());
    const currency = container.querySelector('[aria-label="Leadership currency"]')?.textContent ?? "";
    expect(currency).toContain("Ada Okafor");
    expect(currency).not.toContain("Cleo Nash");
  });

  it("gives the LinkedIn URL to confirm a departure against", () => {
    render(investigation());
    const link = [...container.querySelectorAll('[aria-label="Leadership currency"] a')]
      .find((node) => (node as HTMLAnchorElement).href.includes("ada-okafor"));
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toBe("https://linkedin.com/in/ada-okafor");
  });

  it("says how old the record is so a lagging copy never reads as fresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    try {
      render(investigation());
      const currency = container.querySelector('[aria-label="Leadership currency"]')?.textContent ?? "";
      // March 2024 to August 2026 is over two years of record age.
      expect(currency).toContain("2 years old");
      expect(currency.toLowerCase()).toContain("can lag");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders nothing when the lookup never ran", () => {
    render(investigation({
      projectAccount: projectAccount({ leaderDepartures: undefined }),
    }));
    expect(container.querySelector('[aria-label="Leadership currency"]')).toBeNull();
  });
});
