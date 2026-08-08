import { describe, expect, it } from "vitest";
import type { IntelligenceSpineSnapshot } from "../intelligence/types";
import { deriveIntelligenceBrief } from "./intelligenceBrief";

function snapshot(): IntelligenceSpineSnapshot {
  return {
    schemaVersion: 1,
    rulesetVersion: "argus-entity-point-in-time-v1",
    mode: "point_in_time",
    scoringImpact: "none",
    subject: {
      key: "company:example",
      label: "Example",
      entityKind: "operating_company",
      forms: [{ form: "operating_company", evidenceState: "verified", sourceRefs: ["source:company"] }],
      archetypes: { state: "insufficient", primary: null, matches: [] },
    },
    captureWindow: { earliest: "2026-08-01T00:00:00.000Z", latest: "2026-08-07T00:00:00.000Z" },
    sources: [{
      id: "source:company",
      inputPath: "basicFacts.0.sources.0",
      provider: "official-company-site",
      title: "Company source",
      sourceClass: "official_subject",
      evidenceState: "verified",
    }],
    measurements: [],
    coverage: [],
    signals: [{
      id: "support-track-record",
      ruleId: "track-record",
      ruleVersion: 1,
      kind: "observation",
      domain: "track_record",
      severity: "medium",
      polarity: "support",
      headline: "Three outcomes were verified",
      finding: "Three portfolio outcomes passed the relationship binding rules.",
      whyItMatters: "The evidence covers more than one isolated investment.",
      changeCondition: "Counterparty evidence rejects a relationship.",
      evidenceState: "verified",
      measurementRefs: [],
      sourceRefs: ["source:company"],
      lenses: ["investment"],
    }, {
      id: "pressure-control",
      ruleId: "control-gap",
      ruleVersion: 1,
      kind: "screening_heuristic",
      domain: "control",
      severity: "high",
      polarity: "risk",
      headline: "Control remains concentrated",
      finding: "One operator retains unilateral authority in the saved evidence.",
      whyItMatters: "A single operator can change the system without another approval.",
      changeCondition: "A current multisig receipt replaces the observed authority.",
      evidenceState: "reported_context",
      measurementRefs: [],
      sourceRefs: ["source:company"],
      lenses: ["investment", "counterparty"],
    }, {
      id: "context-leadership",
      ruleId: "leadership-change",
      ruleVersion: 1,
      kind: "observation",
      domain: "team",
      severity: "context",
      polarity: "neutral",
      headline: "A leadership transition is recorded",
      finding: "A licensed record dates one leader's departure.",
      whyItMatters: "The current roster should be reconciled against the official company site.",
      changeCondition: "A current counterparty roster confirms the replacement.",
      evidenceState: "reported_context",
      measurementRefs: [],
      sourceRefs: ["source:company"],
      lenses: ["investment"],
    }],
    questions: [{
      id: "question:ownership",
      domain: "control",
      prompt: "Who legally owns the company?",
      materiality: "critical",
      state: "unavailable",
      basis: "The registry read failed, so ownership was not established.",
      answerRefs: [],
      sourceRefs: [],
    }, {
      id: "question:not-collected",
      domain: "career",
      prompt: "What unrelated credential could be collected later?",
      materiality: "context",
      state: "not_collected",
      basis: "No collection was attempted.",
      answerRefs: [],
      sourceRefs: [],
    }, {
      id: "question:resolved",
      domain: "identity",
      prompt: "What is the official company?",
      materiality: "critical",
      state: "resolved",
      basis: "The official domain established the company identity.",
      answerRefs: ["fact:identity"],
      sourceRefs: ["source:company"],
    }],
    lenses: [{
      id: "investment",
      label: "Investment",
      question: "What matters for capital allocation?",
      domainPriority: ["control", "track_record"],
      signalIds: ["pressure-control", "support-track-record"],
      unresolvedQuestionIds: ["question:ownership"],
      changeConditions: [],
    }],
  };
}

describe("deriveIntelligenceBrief", () => {
  it("ties saved support, pressure, and open questions into the selected decision lens", () => {
    const brief = deriveIntelligenceBrief(snapshot());

    expect(brief.supports[0]).toMatchObject({
      title: "Three outcomes were verified.",
      provenance: expect.stringContaining("Verified saved evidence"),
    });
    expect(brief.pressures[0]).toMatchObject({
      title: "Source-reported context: control remains concentrated.",
      provenance: expect.stringContaining("Source-reported context"),
    });
    expect(brief.questions).toEqual([expect.objectContaining({
      title: "Who legally owns the company?",
      detail: "The registry read failed, so ownership was not established.",
      provenance: expect.stringContaining("unavailable"),
    })]);
    expect(brief.context[0]).toMatchObject({
      title: "Source-reported context: a leadership transition is recorded.",
      provenance: expect.stringContaining("score-neutral derivation"),
    });
    expect(JSON.stringify(brief.questions)).not.toContain("unrelated credential");
  });

  it("does not convert a failed read into a negative ownership claim", () => {
    const brief = deriveIntelligenceBrief(snapshot());
    const text = JSON.stringify(brief);

    expect(text).toContain("ownership was not established");
    expect(text).not.toContain("no owner");
    expect(text).not.toContain("unowned");
  });

  it.each([
    "person",
    "individual_investor",
    "investment_firm",
    "operating_company",
  ] as const)("uses the same evidence-state contract for %s reports", (entityKind) => {
    const value = snapshot();
    value.subject.entityKind = entityKind;

    const brief = deriveIntelligenceBrief(value);

    expect(brief.supports[0]?.provenance).toContain("Verified saved evidence");
    expect(brief.pressures[0]?.provenance).toContain("Source-reported context");
    expect(brief.context[0]?.provenance).toContain("Source-reported context");
    expect(brief.questions[0]?.provenance).toContain("score-neutral");
  });
});
