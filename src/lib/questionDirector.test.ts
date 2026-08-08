import { describe, expect, it } from "vitest";
import type { IntelligenceSpineSnapshot } from "../intelligence/types";
import type { ResearchPlan } from "./researchDirector";
import { directInvestigationQuestion } from "./questionDirector";

const plan = {
  schemaVersion: 1,
  intent: "investment_due_diligence",
  subject: "Clutch Markets",
  roles: ["PROJECT"],
  createdAt: "2026-08-07T12:00:00.000Z",
  tasks: [
    {
      id: "research-identity",
      capability: "identity_resolution",
      question: "Who is behind it?",
      why: "Names collide.",
      priority: "critical",
      delegates: ["official-domain", "public-web"],
      checkIds: ["identity-resolution"],
      triggeredBy: [],
      rank: 1,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Identity is open.",
      stopWhen: "Identity is bound.",
      blockedBy: [],
      state: "partial",
    },
    {
      id: "research-control",
      capability: "people_and_control",
      question: "Who controls it?",
      why: "Role is not control.",
      priority: "critical",
      delegates: ["official-domain", "direct-chain-rpc"],
      checkIds: ["project-team-identity"],
      triggeredBy: [],
      rank: 2,
      decisionImpact: 5,
      costClass: "medium",
      dispatchReason: "Control is open.",
      stopWhen: "Control is sourced.",
      blockedBy: ["identity.founder"],
      state: "planned",
    },
  ],
  nextActions: [],
} satisfies ResearchPlan;

const snapshot = {
  schemaVersion: 1,
  subject: { key: "project:clutch", label: "Clutch Markets", forms: [], archetypes: [], sourceRefs: [] },
  captureWindow: {},
  sources: [],
  measurements: [],
  questions: [{
    id: "identity.founder",
    domain: "identity",
    prompt: "Which exact person is behind the founder handle?",
    materiality: "critical",
    state: "unresolved",
    basis: "The project names a handle but no independent person binding is saved.",
    answerRefs: [],
    sourceRefs: [],
  }],
  signals: [],
  coverage: [],
  lenses: [],
  integrity: { state: "valid", issues: [] },
} as unknown as IntelligenceSpineSnapshot;

describe("question director", () => {
  it("routes a founder question through identity and control specialists with the exact blocker", () => {
    const route = directInvestigationQuestion("Who is the founder and who actually controls Clutch?", plan, snapshot);
    expect(route.intent).toBe("identity_and_control");
    expect(route.capabilities).toEqual(["identity_resolution", "people_and_control"]);
    expect(route.delegates).toEqual(["official-domain", "public-web", "direct-chain-rpc"]);
    expect(route.blockedBy).toEqual(["identity.founder"]);
    expect(route.unresolvedQuestions[0]?.id).toBe("identity.founder");
    expect(route.answerMode).toBe("investigate_evidence_gap");
  });

  it("recognizes an alpha question and treats missing planning context as an evidence gap", () => {
    const route = directInvestigationQuestion("What is the alpha and next liquidity catalyst?", null, null);
    expect(route.intent).toBe("alpha_discovery");
    expect(route.capabilities).toContain("token_and_market");
    expect(route.delegates).toEqual([]);
    expect(route.answerMode).toBe("investigate_evidence_gap");
  });

  it("defaults an ambiguous question to broad synthesis plus counter-evidence", () => {
    const route = directInvestigationQuestion("Tell me what matters here", null, null);
    expect(route.capabilities).toEqual(["official_facts", "counter_evidence", "analyst_synthesis"]);
    expect(route.explanation).toContain("No narrower decision intent");
  });

  it("keeps trust as the primary decision while adding identity work for a founder question", () => {
    const route = directInvestigationQuestion("Can I trust the founder and is he really behind it?", null, snapshot);
    expect(route.intent).toBe("counterparty_risk");
    expect(route.capabilities.slice(0, 3)).toEqual(["identity_resolution", "legal_and_adverse", "people_and_control"]);
    expect(route.explanation).toContain("supporting decision route");
  });

  it("inherits only the prior user intent for a referential follow-up", () => {
    const route = directInvestigationQuestion(
      "What about him?",
      null,
      snapshot,
      ["Is the founder a good investment risk?"],
    );
    expect(route.intent).toBe("investment_due_diligence");
    expect(route.inheritedIntent).toBe(true);
    expect(route.explanation).toContain("prior user question");
    expect(route.explanation).toContain("prior answers remain non-evidence");
  });

  it("selects an adversarial reasoning mode independently of the decision intent", () => {
    const route = directInvestigationQuestion("Challenge the investment thesis and give me the strongest case against it", null, snapshot);
    expect(route.intent).toBe("investment_due_diligence");
    expect(route.reasoningMode).toBe("challenge_thesis");
  });

  it("focuses relevant evidence while preserving a high-severity adverse signal across intents", () => {
    const withSignals = {
      ...snapshot,
      sources: [
        { id: "source:event", inputPath: "event", provider: "official", title: "Event notice", sourceClass: "official_subject", evidenceState: "verified" },
        { id: "source:filing", inputPath: "filing", provider: "registry", title: "Legal filing", sourceClass: "public_registry", evidenceState: "verified" },
      ],
      measurements: [{
        id: "measurement:event-date",
        domain: "chronology",
        label: "Event date",
        unit: "date",
        entityKey: "project:clutch",
        evidenceState: "measured",
        sourceRefs: ["source:event"],
        valueType: "date",
        value: "2026-09-01",
      }],
      signals: [
        {
          id: "signal:market-catalyst",
          ruleId: "market-catalyst",
          ruleVersion: 1,
          kind: "observation",
          domain: "market",
          severity: "medium",
          polarity: "support",
          headline: "A dated market catalyst is recorded",
          finding: "A dated event is saved.",
          whyItMatters: "Timing may affect the setup.",
          changeCondition: "The event is cancelled or already priced in.",
          evidenceState: "measured",
          measurementRefs: ["measurement:event-date"],
          sourceRefs: ["source:event"],
          lenses: ["alpha_research"],
        },
        {
          id: "signal:legal-risk",
          ruleId: "legal-risk",
          ruleVersion: 1,
          kind: "observation",
          domain: "legal",
          severity: "high",
          polarity: "risk",
          headline: "A direct legal finding remains material",
          finding: "The saved report records an attributable filing.",
          whyItMatters: "A severe adverse fact cannot disappear under an alpha lens.",
          changeCondition: "A final filing reverses the recorded action.",
          evidenceState: "verified",
          measurementRefs: [],
          sourceRefs: ["source:filing"],
          lenses: ["counterparty"],
        },
        {
          id: "signal:irrelevant-context",
          ruleId: "irrelevant-context",
          ruleVersion: 1,
          kind: "observation",
          domain: "career",
          severity: "context",
          polarity: "neutral",
          headline: "An old biography is saved",
          finding: "Biography context.",
          whyItMatters: "Background only.",
          changeCondition: "A newer biography is published.",
          evidenceState: "reported_context",
          measurementRefs: [],
          sourceRefs: ["source:bio"],
          lenses: ["general_diligence"],
        },
      ],
    } as IntelligenceSpineSnapshot;
    const route = directInvestigationQuestion("What is the alpha and next market catalyst?", null, withSignals);
    expect(route.evidenceFocus.map((item) => item.id)).toEqual(["signal:legal-risk", "signal:market-catalyst"]);
    expect(route.sourceRefs).toEqual(["source:filing", "source:event"]);
    expect(route.measurementRefs).toEqual(["measurement:event-date"]);
    expect(route.changeConditions).toContain("A final filing reverses the recorded action.");
    expect(route.claimChains.find((chain) => chain.signalId === "signal:legal-risk")).toMatchObject({
      lineageState: "complete",
      sources: [expect.objectContaining({ id: "source:filing", sourceClass: "public_registry" })],
    });
    expect(route.claimChains.find((chain) => chain.signalId === "signal:market-catalyst")).toMatchObject({
      lineageState: "complete",
      measurements: [expect.objectContaining({ id: "measurement:event-date", value: "2026-09-01" })],
    });
  });
});
