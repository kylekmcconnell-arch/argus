import { describe, expect, it } from "vitest";
import {
  authorizeGapInvestigation,
  GapInvestigationAuthorizationError,
  isProposedGapInvestigationPayload,
  restrictResearchPlan,
  savedOpenGapQuestions,
} from "./gapInvestigation";
import type { ResearchPlan } from "./researchDirector";

const plan: ResearchPlan = {
  schemaVersion: 1,
  intent: "investment_due_diligence",
  subject: "Alice",
  roles: ["FOUNDER"],
  createdAt: "2026-08-22T10:00:00.000Z",
  tasks: [
    {
      id: "identity",
      capability: "identity_resolution",
      question: "Who is Alice?",
      why: "Identity gate",
      priority: "critical",
      delegates: ["official-domain", "public-web"],
      checkIds: ["identity-resolution"],
      triggeredBy: [],
      rank: 1,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Required",
      stopWhen: "Bound",
      blockedBy: [],
      state: "completed",
    },
    {
      id: "portfolio",
      capability: "portfolio_and_outcomes",
      question: "What outcomes are attributable?",
      why: "Decision gap",
      priority: "high",
      delegates: ["portfolio-web", "entity-store"],
      checkIds: ["founder-track-record"],
      triggeredBy: ["gap.track-record"],
      rank: 2,
      decisionImpact: 5,
      costClass: "high",
      dispatchReason: "Gap",
      stopWhen: "Corroborated",
      blockedBy: [],
      state: "unavailable",
    },
    {
      id: "synthesis",
      capability: "analyst_synthesis",
      question: "What follows?",
      why: "Proposal",
      priority: "critical",
      delegates: ["evidence-preflight", "axis-scorer"],
      checkIds: [],
      triggeredBy: [],
      rank: 3,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Required",
      stopWhen: "Frozen",
      blockedBy: [],
      state: "partial",
    },
  ],
  nextActions: [{
    rank: 1,
    taskId: "portfolio",
    capability: "portfolio_and_outcomes",
    action: "Research outcomes",
    whyNow: "Open gap",
    delegates: ["portfolio-web"],
  }],
};

const payload = {
  researchPlan: plan,
  intelligence: {
    questions: [
      { id: "gap.track-record", prompt: "What is the verified track record?", state: "unresolved", materiality: "critical" },
      { id: "answered", prompt: "Who is Alice?", state: "answered", materiality: "critical" },
    ],
  },
};

describe("gap investigation authorization", () => {
  it("binds the open gap, user-selected work, and saved mandatory gates", () => {
    const scope = authorizeGapInvestigation({
      payload,
      gapId: "gap.track-record",
      requestedTaskIds: ["portfolio"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 3.5,
    });
    expect(scope.requestedTaskIds).toEqual(["portfolio"]);
    expect(scope.taskIds).toEqual(["portfolio", "identity", "synthesis"]);
    expect(scope.capabilities).toEqual([
      "portfolio_and_outcomes",
      "identity_resolution",
      "analyst_synthesis",
    ]);
    expect(scope.delegates).toEqual([
      "portfolio-web",
      "entity-store",
      "official-domain",
      "public-web",
      "evidence-preflight",
      "axis-scorer",
    ]);
    expect(scope.estimatedCostCeilingUsd).toBe(3.5);
  });

  it("rejects closed gaps and tasks not selected by the frozen plan", () => {
    expect(() => authorizeGapInvestigation({
      payload,
      gapId: "answered",
      requestedTaskIds: ["portfolio"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 5,
    })).toThrowError(GapInvestigationAuthorizationError);
    expect(() => authorizeGapInvestigation({
      payload,
      gapId: "gap.track-record",
      requestedTaskIds: ["invented"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 5,
    })).toThrow("not in the frozen plan");
  });

  it("rejects an authorization that does not accept the server estimate", () => {
    expect(() => authorizeGapInvestigation({
      payload,
      gapId: "gap.track-record",
      requestedTaskIds: ["portfolio"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 3.49,
    })).toThrow("$3.50");
  });

  it("reads only open intelligence questions", () => {
    expect(savedOpenGapQuestions(payload).map((question) => question.id)).toEqual(["gap.track-record"]);
  });

  it("keeps a fresh plan inside the authorized capability set", () => {
    const restricted = restrictResearchPlan(plan, ["identity_resolution", "portfolio_and_outcomes"]);
    expect(restricted.tasks.map((task) => task.id)).toEqual(["identity", "portfolio"]);
    expect(restricted.tasks.map((task) => task.rank)).toEqual([1, 2]);
    expect(restricted.nextActions).toHaveLength(1);
  });

  it("recognizes only complete proposal markers", () => {
    expect(isProposedGapInvestigationPayload({
      gapInvestigation: {
        schemaVersion: 1,
        publicationState: "proposed",
        authorizationId: "authorization",
        sourceReportVersionId: "source",
      },
    })).toBe(true);
    expect(isProposedGapInvestigationPayload({ gapInvestigation: { publicationState: "proposed" } })).toBe(false);
  });
});
