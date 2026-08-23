import { describe, expect, it } from "vitest";
import { buildEntityScorecards } from "./entityScorecards";
import type { IntelligenceSpineSnapshot } from "./types";

function snapshot(entityKind: NonNullable<IntelligenceSpineSnapshot["subject"]["entityKind"]>): IntelligenceSpineSnapshot {
  return {
    schemaVersion: 1,
    rulesetVersion: "argus-entity-point-in-time-v1",
    mode: "point_in_time",
    scoringImpact: "none",
    subject: {
      key: "@subject",
      label: "Subject",
      entityKind,
      forms: [],
      archetypes: { state: "insufficient", primary: null, matches: [] },
    },
    captureWindow: { earliest: "2026-08-22T00:00:00.000Z", latest: "2026-08-22T00:00:00.000Z" },
    sources: [{
      id: "source:role",
      inputPath: "basicFacts.0.sources.0",
      provider: "official-site",
      title: "Role record",
      sourceClass: "official_subject",
      evidenceState: "verified",
      sourceUrl: "https://subject.example/team",
      capturedAt: "2026-08-22T00:00:00.000Z",
    }],
    measurements: [{
      id: "entity_fact:current_role",
      domain: "career",
      label: "Current role",
      valueType: "text",
      value: "Founder",
      unit: "text",
      entityKey: "@subject",
      window: { kind: "instant", asOf: "2026-08-22T00:00:00.000Z" },
      evidenceState: "verified",
      sourceRefs: ["source:role"],
    }],
    questions: [{
      id: "entity.current_role",
      domain: "career",
      prompt: "What is the current role?",
      materiality: "critical",
      state: "resolved",
      basis: "One strict direct-subject fact answers this atomic question.",
      answerRefs: ["entity_fact:current_role"],
      sourceRefs: ["source:role"],
    }],
    coverage: [],
    signals: [],
    lenses: [],
  };
}

describe("role-specific entity scorecards", () => {
  it("builds a founder/operator scorecard without creating another score", () => {
    const result = buildEntityScorecards(snapshot("person"), ["FOUNDER"]);
    expect(result.scorecards).toHaveLength(1);
    expect(result.scorecards[0]).toMatchObject({
      role: "founder_operator",
      governingScoreImpact: "none",
    });
    expect(result.scorecards[0].axes.find((axis) => axis.id === "identity")).toMatchObject({
      state: "established",
      measurementRefs: ["entity_fact:current_role"],
    });
    expect(result.ledger[0]).toMatchObject({
      kind: "career",
      entityKey: "@subject",
      role: "founder_operator",
      state: "verified",
      sourceRefs: ["source:role"],
      measurementRefs: ["entity_fact:current_role"],
      asOf: "2026-08-22T00:00:00.000Z",
    });
  });

  it.each([
    ["individual_investor", [], "individual_investor"],
    ["investment_firm", [], "investment_firm"],
    ["operating_company", [], "operating_company"],
    ["operating_company", ["AGENCY"], "agency"],
  ] as const)("maps %s with roles %j to %s", (kind, roles, expected) => {
    expect(buildEntityScorecards(snapshot(kind), roles).scorecards[0].role).toBe(expected);
  });
});
