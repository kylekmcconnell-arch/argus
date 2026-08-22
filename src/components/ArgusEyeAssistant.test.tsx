// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Investigation } from "../lib/investigation";
import { ArgusEyeAssistant } from "./ArgusEyeAssistant";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reportVersionId = "00000000-0000-4000-8000-000000000777";

function investigation(): Investigation {
  return {
    rootRef: "0x7777777777777777777777777777777777777777",
    projectX: "@ClutchMarkets",
    siteUrl: "https://stonkbrokers.io/",
    recon: null,
    founders: [],
    founderNote: "Founder evidence was recovered.",
    deployerTrail: null,
    webTeam: [],
    token: {
      address: "0x7777777777777777777777777777777777777777",
      chain: "ethereum",
      dexId: "uniswap",
      symbol: "STONKBROKER",
      name: "StonkBrokers",
      verdict: "CAUTION",
      score: 58,
      capApplied: null,
      headline: "Team diligence remains open.",
      axes: [],
      safety: { available: false, simChecked: false },
      socials: [],
      projectX: "@ClutchMarkets",
      deployer: "0x1111111111111111111111111111111111111111",
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
    },
    projectAccount: {
      handle: "@ClutchMarkets",
      display_name: "Clutch Markets",
      avatar: "",
      bio: "Onchain markets",
      followers: "17K",
      joined: "",
      identity_note: "",
      profile_captured_at: "2026-08-07T12:00:00.000Z",
      headline: "Project account",
      live: true,
      notableFollowers: [],
      contradictions: [],
      webTeam: [],
      leaderDepartures: [],
      basicFacts: [],
      basicFactLeads: [{
        subject: "Clutch",
        predicate: "funding",
        value: "$50 million Series D",
        questionId: "project.funding",
        excerpt: "Canadian used-car retailer Clutch raised a Series D.",
        sourceUrl: "https://torys.com/clutch-series-d",
        sourceTitle: "Clutch Series D financing",
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "claude-web-search",
      }],
      report: {
        composite_verdict: "INCOMPLETE",
        governing_score: null,
        identity_confidence: "Confirmed",
        roles: [],
      },
      evidence: {
        ventures: [],
        testimonials: [],
        advised: [],
        associates: [{
          associate_key: "@OxSimpleFarmer",
          relation: "team:Founder",
          notes: "The project account named @OxSimpleFarmer as founder.",
          evidence_url: "https://x.com/ClutchMarkets/status/1",
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "official-x",
        }],
        wallets: [],
        promotions: [],
      },
      graph: { nodes: [], edges: [] },
    } as unknown as NonNullable<Investigation["projectAccount"]>,
  } as unknown as Investigation;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function clickByLabel(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("ARGUS Eye floating assistant", () => {
  it("opens over the existing report instead of replacing it", () => {
    act(() => root.render(
      <main><h1>Existing report and connections graph</h1><ArgusEyeAssistant inv={investigation()} reportVersionId={reportVersionId} /></main>,
    ));

    expect(container.textContent).toContain("Existing report and connections graph");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    clickByLabel("Ask ARGUS Eye about this report");
    expect(container.textContent).toContain("Existing report and connections graph");
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.textContent).toContain("Clutch Markets identifies @OxSimpleFarmer as Founder");
    expect(container.textContent).toContain("Project attributed");
    expect(container.textContent).toContain("Independent corroboration of the person behind the handle");
    expect(container.textContent).not.toContain("Open lead");
    expect(container.querySelector('a[href="https://x.com/ClutchMarkets/status/1"]')?.textContent).toContain("Open project attribution");
    expect(container.textContent).toContain("Conflict rejected");
  });

  it("opens from the report deep link", () => {
    window.history.replaceState(null, "", "/#argus-eye");
    act(() => root.render(<ArgusEyeAssistant inv={investigation()} reportVersionId={reportVersionId} />));
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("asks the immutable report and renders source citations", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
      answer: "A stronger identity-bound source could overturn the founder attribution.",
      citations: ["https://clutch.markets/about"],
      reasoningSteps: ["The project publishes the role -> the report can state the attribution."],
      uncertainties: ["Civil identity remains unresolved."],
      whatWouldChange: ["A contradictory first-party correction."],
      investigationRoute: {
        intent: "investment_due_diligence",
        reasoningMode: "challenge_thesis",
        inheritedIntent: false,
        answerMode: "investigate_evidence_gap",
        explanation: "The question asks for a capital-allocation view.",
        delegates: ["official-domain", "public-web"],
        blockedBy: ["identity.founder"],
        unresolvedQuestions: [{
          id: "identity.founder",
          prompt: "Which exact person is behind the founder handle?",
          state: "unresolved",
          materiality: "critical",
        }],
        evidenceFocus: [{
          id: "signal:founder-role",
          headline: "The project publishes a founder role",
          polarity: "support",
          evidenceState: "verified",
        }],
        changeConditions: ["A contradictory first-party correction is published."],
        claimChains: [{
          signalId: "signal:founder-role",
          lineageState: "complete",
          inferenceBoundary: "The role does not establish legal control.",
          measurements: [{ id: "measurement:role" }],
          sources: [{ id: "source:project" }],
          counterSignalIds: [],
        }],
      },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(<ArgusEyeAssistant inv={investigation()} reportVersionId={reportVersionId} />));
    clickByLabel("Ask ARGUS Eye about this report");

    const prompt = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("investment thesis"));
    expect(prompt).toBeTruthy();
    await act(async () => prompt!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(fetchMock).toHaveBeenCalledWith("/api/ask", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining(reportVersionId),
    }));
    expect(container.textContent).toContain("stronger identity-bound source");
    expect(container.textContent).toContain("Reasoning chain");
    expect(container.textContent).toContain("Civil identity remains unresolved");
    expect(container.textContent).toContain("What would change this conclusion?");
    expect(container.textContent).toContain("How ARGUS routed this question");
    expect(container.textContent).toContain("challenge thesis");
    expect(container.textContent).toContain("official-domain · public-web");
    expect(container.textContent).toContain("Evidence selected for this question");
    expect(container.textContent).toContain("The project publishes a founder role");
    expect(container.textContent).toContain("complete lineage · 1 measurements · 1 sources");
    expect(container.textContent).toContain("Reasoning boundary");
    expect(container.textContent).toContain("The role does not establish legal control.");
    expect(container.textContent).toContain("Decisive evidence boundary");
    expect(container.textContent).toContain("Which exact person is behind the founder handle?");
    expect(container.textContent).toContain("Source 1");

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask ARGUS Eye"]');
    expect(textarea).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "What does that mean for control?");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send question"]');
    await act(async () => send!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.history).toEqual([expect.objectContaining({
      answer: expect.stringContaining("stronger identity-bound source"),
    })]);
  });

  it("shows the exact authorization bounds and keeps the proposal inactive", async () => {
    const authorizationId = "00000000-0000-4000-8000-000000000205";
    const proposalId = "00000000-0000-4000-8000-000000000305";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        answer: "The frozen report leaves the track record unresolved.",
        investigationRoute: {
          intent: "investment_due_diligence",
          reasoningMode: "plan_investigation",
          inheritedIntent: false,
          answerMode: "investigate_evidence_gap",
          explanation: "The open track-record question needs new evidence.",
          delegates: ["portfolio-web"],
          blockedBy: [],
          unresolvedQuestions: [{ id: "gap.track-record", prompt: "What is the verified track record?", state: "unresolved", materiality: "critical" }],
          evidenceFocus: [],
          changeConditions: [],
          claimChains: [],
          authorizationPreview: {
            gapId: "gap.track-record",
            gapPrompt: "What is the verified track record?",
            taskIds: ["portfolio"],
            timeBudgetSeconds: 300,
            estimatedCostCeilingUsd: 3.5,
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorizationId,
        proposedReportVersionId: proposalId,
        status: "proposed",
        active: false,
        observedCostUsd: 1.2,
        costOutcome: "within_estimate",
        reviewPath: `/?version=${proposalId}`,
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorizationId,
        status: "rolled_back",
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(<ArgusEyeAssistant subject="@alice" reportVersionId={reportVersionId} />));
    clickByLabel("Ask ARGUS Eye about this report");
    const prompt = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("investment thesis"));
    await act(async () => prompt!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("Bounded evidence-gap investigation");
    expect(container.textContent).toContain("5 minute limit");
    expect(container.textContent).toContain("$3.50 estimated ceiling");
    const authorize = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Authorize investigation"));
    await act(async () => authorize!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const executeBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(executeBody).toEqual({
      sourceReportVersionId: reportVersionId,
      gapId: "gap.track-record",
      taskIds: ["portfolio"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 3.5,
    });
    expect(container.textContent).toContain("inactive until an analyst promotes it");
    expect(container.textContent).toContain("Observed estimated cost $1.20 · within ceiling");
    expect(container.querySelector(`a[href="/?version=${proposalId}"]`)).toBeTruthy();

    const rollback = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Roll back"));
    await act(async () => rollback!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("remains inactive");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ authorizationId, action: "rollback" });
  });
});
