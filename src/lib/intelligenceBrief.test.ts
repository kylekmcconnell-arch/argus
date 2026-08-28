import { describe, expect, it } from "vitest";
import type { IntelligenceSpineSnapshot } from "../intelligence/types";
import { deriveIntelligenceBrief, isOfficialIdentityQuestion, isOfficialTokenQuestion, isProductDescriptionQuestion } from "./intelligenceBrief";

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
  it("identifies a stale official-token question for concise presentation reconciliation", () => {
    expect(isOfficialTokenQuestion({
      id: "intelligence-question:project.official_token",
      title: "What is the project's official crypto token?",
    })).toBe(true);
    expect(isOfficialTokenQuestion({
      id: "intelligence-question:security-audit",
      title: "Which independent security audits are published?",
    })).toBe(false);
  });

  it("identifies the exact stale official-identity question", () => {
    expect(isOfficialIdentityQuestion({
      id: "intelligence-question:project.official_identity",
      title: "What exact project or company does this account represent?",
    })).toBe(true);
    expect(isOfficialIdentityQuestion({
      id: "intelligence-question:security-audit",
      title: "Which independent security audits are published?",
    })).toBe(false);
  });

  it("identifies a stale product-description question", () => {
    expect(isProductDescriptionQuestion({
      id: "intelligence-question:project.product_surface",
      title: "What live products or services does the project provide?",
    })).toBe(true);
    expect(isProductDescriptionQuestion({
      id: "intelligence-question:security-audit",
      title: "Which independent security audits are published?",
    })).toBe(false);
  });

  it("ties saved support, pressure, and open questions into the selected decision lens", () => {
    const brief = deriveIntelligenceBrief(snapshot());

    expect(brief.supports[0]).toMatchObject({
      title: "Three outcomes were verified.",
      provenance: expect.stringContaining("Verified evidence"),
    });
    expect(brief.pressures[0]).toMatchObject({
      title: "Control remains concentrated.",
      provenance: expect.stringContaining("Reported by a source"),
    });
    expect(brief.questions).toEqual([expect.objectContaining({
      title: "Who legally owns the company?",
      detail: "The registry read failed, so ownership was not established.",
      provenance: expect.stringContaining("unavailable"),
    })]);
    expect(brief.context[0]).toMatchObject({
      title: "A leadership transition is recorded.",
      provenance: expect.stringContaining("Reported by a source"),
    });
    expect(JSON.stringify(brief.questions)).not.toContain("unrelated credential");
  });

  it("rewrites ledger jargon in open-question details", () => {
    const value = snapshot();
    value.questions = [{
      id: "question:facets",
      domain: "product",
      prompt: "What does the product do?",
      materiality: "important",
      state: "partial",
      basis: "Strict direct-subject evidence answers part of this multi-facet question, but the frozen ledger does not record facet-level completeness.",
      answerRefs: [],
      sourceRefs: [],
    }];
    value.lenses[0]!.unresolvedQuestionIds = ["question:facets"];

    const brief = deriveIntelligenceBrief(value);
    const text = JSON.stringify(brief.questions);

    expect(brief.questions[0]?.detail).toMatch(/evidence tied directly to this project|saved evidence/i);
    expect(text).not.toMatch(/strict direct-subject|frozen ledger/i);
  });

  it("does not convert a failed read into a negative ownership claim", () => {
    const brief = deriveIntelligenceBrief(snapshot());
    const text = JSON.stringify(brief);

    expect(text).toContain("ownership was not established");
    expect(text).not.toContain("no owner");
    expect(text).not.toContain("unowned");
  });

  it("keeps a high-severity risk at the head of pressures under every lens", () => {
    // Consumers truncate this list, so a lens that sorts a high-severity risk
    // below the cut removes a direct concern from the surface the reader
    // reads. The lens may reorder emphasis; it may never bury this.
    const value = snapshot();
    // A lens that prioritizes an unrelated domain and never names the risk.
    value.lenses = [...value.lenses, {
      id: "alpha_research",
      label: "Alpha research",
      question: "What is the non-obvious edge?",
      domainPriority: ["track_record", "team"],
      signalIds: ["support-track-record", "context-leadership"],
      unresolvedQuestionIds: [],
      changeConditions: [],
    }];
    // Enough lens-favoured pressures to fill a truncated list on their own.
    for (let index = 0; index < 6; index += 1) {
      value.signals.push({
        ...value.signals[1],
        id: `pressure-track-${index}`,
        domain: "track_record",
        severity: "medium",
        lenses: ["alpha_research"],
      });
    }

    for (const lensId of ["investment", "alpha_research"] as const) {
      const brief = deriveIntelligenceBrief(value, lensId);
      expect(brief.pressures[0]?.id).toBe("intelligence-signal:pressure-control");
    }
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

    expect(brief.supports[0]?.provenance).toContain("Verified evidence");
    expect(brief.pressures[0]?.provenance).toContain("Reported by a source");
    expect(brief.context[0]?.provenance).toContain("Reported by a source");
    expect(brief.questions[0]?.provenance).toContain("Check unavailable");
  });
});
