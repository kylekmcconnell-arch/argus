import { describe, expect, it } from "vitest";
import { emptyEvidence } from "../data/evidence";
import { SubjectClass } from "../engine/taxonomy";
import { buildResearchPlan, finalizeResearchPlan, researchPlanAllows } from "./researchDirector";

describe("research director", () => {
  it("routes an investor organization to portfolio and fund specialists without project-token work", () => {
    const evidence = emptyEvidence("@fixturefund");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.basicFactQuestionLedger = [{
      questionId: "investor.portfolio",
      audience: "investor",
      batch: "track_record",
      predicate: "investor",
      question: "Which investments are source-backed?",
      critical: true,
      status: "unanswered",
      answerRefs: [],
      providerRuns: [],
    }];

    const plan = buildResearchPlan(evidence);
    expect(researchPlanAllows(plan, "portfolio_and_outcomes")).toBe(true);
    expect(researchPlanAllows(plan, "fund_scale")).toBe(true);
    expect(researchPlanAllows(plan, "project_fundamentals")).toBe(false);
    expect(plan.tasks.find((task) => task.capability === "portfolio_and_outcomes")).toMatchObject({
      priority: "critical",
      delegates: expect.arrayContaining(["portfolio-web", "official-portfolio"]),
      triggeredBy: ["investor.portfolio"],
    });
  });

  it("turns provider outcomes into an auditable final plan instead of claiming every dispatch completed", () => {
    const evidence = emptyEvidence("@project");
    evidence.roles = [SubjectClass.PROJECT];
    const plan = buildResearchPlan(evidence, "counterparty_risk");
    const final = finalizeResearchPlan(plan, [
      { checkId: "project-team-identity", label: "Team", status: "confirmed" },
      { checkId: "project-leadership-currency", label: "Leadership", status: "unavailable" },
      { checkId: "trust-graph-connections", label: "Graph", status: "checked-empty" },
    ]);
    expect(final.tasks.find((task) => task.capability === "people_and_control")?.state).toBe("partial");
    expect(final.tasks.find((task) => task.capability === "network_connections")?.state).toBe("completed");
  });

  it("blocks namesake-prone relationship searches until identity gates are resolved", () => {
    const evidence = emptyEvidence("@clutchmarkets");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.basicFactQuestionLedger = [{
      questionId: "investor.official-identity",
      audience: "investor",
      batch: "identity",
      predicate: "official_identity",
      question: "Which exact organization does this account represent?",
      critical: true,
      status: "unanswered",
      answerRefs: [],
      providerRuns: [],
    }];

    const plan = buildResearchPlan(evidence);
    const portfolio = plan.tasks.find((task) => task.capability === "portfolio_and_outcomes");
    expect(researchPlanAllows(plan, "portfolio_and_outcomes")).toBe(false);
    expect(portfolio?.blockedBy).toEqual(["investor.official-identity"]);
    expect(plan.nextActions[0]?.capability).toBe("identity_resolution");
    const final = finalizeResearchPlan(plan, []);
    expect(final.tasks.find((task) => task.capability === "portfolio_and_outcomes")).toMatchObject({
      state: "skipped",
      outcome: "blocked by 1 unresolved identity gate",
    });
  });

  it("ranks high-impact lower-cost open work ahead of expensive untriggered enrichment", () => {
    const evidence = emptyEvidence("@fixturefund");
    evidence.roles = [SubjectClass.INVESTOR];
    const plan = buildResearchPlan(evidence, "investment_due_diligence");
    const graph = plan.tasks.find((task) => task.capability === "network_connections");
    const portfolio = plan.tasks.find((task) => task.capability === "portfolio_and_outcomes");
    expect(graph?.rank).toBeLessThan(portfolio?.rank ?? Number.MAX_SAFE_INTEGER);
    expect(plan.nextActions[0]?.rank).toBe(1);
  });

  it("uses legal-entity uncertainty narrowly instead of suppressing an attributable portfolio", () => {
    const evidence = emptyEvidence("@fixturefund");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.basicFactQuestionLedger = [{
      questionId: "investor.legal-entity",
      audience: "investor",
      batch: "structure_risk",
      predicate: "legal_entity",
      question: "Which legal entity manages the fund?",
      critical: true,
      status: "unanswered",
      answerRefs: [],
      providerRuns: [],
    }];
    const plan = buildResearchPlan(evidence);
    expect(researchPlanAllows(plan, "portfolio_and_outcomes")).toBe(true);
    expect(researchPlanAllows(plan, "fund_scale")).toBe(false);
  });
});
