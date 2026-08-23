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
vi.mock("./ArgusEyeAssistant", () => ({ ArgusEyeAssistant: () => null }));
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
    evidence: "Ada is named on the saved official team page.",
    evidence_origin: "deterministic",
    artifact_verified: true,
    sourceUrl: "https://orbit.example/team",
    developerProfiles: [{
      provider: "github" as const,
      url: "https://github.com/ada-okafor",
      sourceUrl: "https://x.com/ada-okafor",
    }],
  },
  {
    name: "Bram Vos",
    role: "CTO",
    linkedin: "linkedin.com/in/bram-vos",
    provider: "teampage",
    evidence_origin: "deterministic",
    artifact_verified: true,
    sourceUrl: "https://orbit.example/team",
  },
  {
    name: "Cleo Nash",
    role: "CFO",
    provider: "teampage",
    evidence_origin: "deterministic",
    artifact_verified: true,
    sourceUrl: "https://orbit.example/team",
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
    profile_captured_at: "2026-08-01T00:00:00.000Z",
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
  it("promotes saved intelligence support, pressure, and attempted open questions into the short answer", () => {
    const account = projectAccount({
      intelligence: {
        schemaVersion: 1,
        rulesetVersion: "argus-point-in-time-v1",
        mode: "point_in_time",
        scoringImpact: "none",
        subject: {
          key: "project:orbit",
          label: "Orbit",
          entityKind: "project",
          forms: [{ form: "protocol", evidenceState: "verified", sourceRefs: ["source:orbit"] }],
          archetypes: { state: "generic", primary: "generic_protocol", matches: [] },
        },
        captureWindow: { earliest: "2026-08-01T00:00:00.000Z", latest: "2026-08-01T00:00:00.000Z" },
        sources: [{
          id: "source:orbit",
          inputPath: "basicFacts.0.sources.0",
          provider: "official-web",
          title: "Orbit operating evidence",
          sourceClass: "official_subject",
          evidenceState: "verified",
        }],
        measurements: [],
        coverage: [],
        signals: [{
          id: "support-product",
          ruleId: "product",
          ruleVersion: 1,
          kind: "observation",
          domain: "product",
          severity: "medium",
          polarity: "support",
          headline: "The product is live and source verified",
          finding: "The saved official product surface was available.",
          whyItMatters: "The project has more than a narrative and token.",
          changeCondition: "The product surface becomes unavailable.",
          evidenceState: "verified",
          measurementRefs: [],
          sourceRefs: ["source:orbit"],
          lenses: ["investment"],
        }, {
          id: "pressure-control",
          ruleId: "control",
          ruleVersion: 1,
          kind: "observation",
          domain: "control",
          severity: "high",
          polarity: "risk",
          headline: "Operational control remains concentrated",
          finding: "The saved control evidence identifies one active authority.",
          whyItMatters: "A single authority can change material system settings.",
          changeCondition: "A current multisig receipt replaces it.",
          evidenceState: "measured",
          measurementRefs: [],
          sourceRefs: ["source:orbit"],
          lenses: ["investment"],
        }, {
          id: "context-leadership",
          ruleId: "leadership-change",
          ruleVersion: 1,
          kind: "observation",
          domain: "team",
          severity: "context",
          polarity: "neutral",
          headline: "A dated leadership transition is recorded",
          finding: "The licensed record dates one named leader's departure.",
          whyItMatters: "The current operating roster should be confirmed directly.",
          changeCondition: "A current official roster confirms the transition.",
          evidenceState: "reported_context",
          measurementRefs: [],
          sourceRefs: ["source:orbit"],
          lenses: ["investment"],
        }],
        questions: [{
          id: "question:treasury",
          domain: "treasury",
          prompt: "Who can move the project treasury?",
          materiality: "critical",
          state: "unavailable",
          basis: "The treasury-control read failed, so authority was not established.",
          answerRefs: [],
          sourceRefs: [],
        }],
        lenses: [{
          id: "investment",
          label: "Investment",
          question: "What matters for investment?",
          domainPriority: ["control", "product", "treasury"],
          signalIds: ["pressure-control", "support-product"],
          unresolvedQuestionIds: ["question:treasury"],
          changeConditions: [],
        }],
      },
    });

    render(investigation({ projectAccount: account }));

    const shortAnswer = container.querySelector("#report-summary")?.textContent ?? "";
    expect(shortAnswer).toContain("The product is live and source verified");
    expect(shortAnswer).toContain("Operational control remains concentrated");
    expect(shortAnswer).toContain("Who can move the project treasury?");
    expect(shortAnswer).toContain("authority was not established");
    expect(shortAnswer).toContain("Important context");
    expect(shortAnswer).toContain("reported by a source context: a dated leadership transition is recorded");
  });

  it("states a project-attributed founder role without claiming the identity or control is verified", () => {
    const attributedProject = projectAccount({
      webTeam: [],
      leaderDepartures: [],
      evidence: {
        ventures: [],
        testimonials: [],
        advised: [],
        associates: [{
          associate_key: "@0xSimpleFarmer",
          relation: "team:Founder",
          notes: "The official project account identifies @0xSimpleFarmer as founder.",
          evidence_url: "https://x.com/ClutchMarkets/status/1",
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "official-x",
        }],
        wallets: [],
        promotions: [],
      },
    });
    attributedProject.display_name = "Clutch Markets";
    attributedProject.handle = "@ClutchMarkets";
    render(investigation({
      projectX: "@ClutchMarkets",
      projectAccount: attributedProject,
      founders: [],
      webTeam: [],
    }));

    expect(container.textContent).toContain("Clutch Markets names @0xSimpleFarmer as Founder");
    expect(container.textContent).toContain("People named by the project (1)");
    expect(container.textContent).toContain("named by the project");
    expect(container.textContent).toContain("an independent source has not yet confirmed identity, ownership, or control");
    expect(container.textContent).not.toContain("Published names to verify");
    expect(container.querySelector('a[href="https://x.com/ClutchMarkets/status/1"]')?.textContent).toContain("See where the project said this");
  });

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

  it("exposes the exact role page and developer-profile source chain", () => {
    render(investigation());
    const team = container.querySelector("#investigation-team");
    expect(team?.querySelector('a[href="https://orbit.example/team"]')?.textContent).toContain("role proof");
    expect(team?.querySelector('a[href="https://github.com/ada-okafor"]')?.textContent).toContain("GitHub");
    expect(team?.querySelector('a[href="https://x.com/ada-okafor"]')?.textContent).toContain("profile link proof");
    expect(team?.textContent).toContain("Ada is named on the saved official team page");
  });

  it("anchors record age to the frozen scan rather than the viewer clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2036-08-01T00:00:00.000Z"));
    try {
      render(investigation());
      const currency = container.querySelector('[aria-label="Leadership currency"]')?.textContent ?? "";
      // The viewer is in 2036, but the saved scan was captured in August 2026.
      expect(currency).toContain("2 years old");
      expect(currency).not.toContain("12 years old");
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
