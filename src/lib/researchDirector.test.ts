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

  it("does not leave role routing or analyst synthesis open after both were frozen", () => {
    const evidence = emptyEvidence("@project");
    evidence.roles = [SubjectClass.PROJECT];
    const plan = buildResearchPlan(evidence);
    const final = finalizeResearchPlan(plan, [], [], {
      roleResolved: true,
      analystConclusionRecorded: true,
    });

    expect(final.tasks.find((task) => task.capability === "role_resolution")).toMatchObject({
      state: "completed",
      outcome: "subject type and report methodology were resolved",
    });
    expect(final.tasks.find((task) => task.capability === "analyst_synthesis")).toMatchObject({
      state: "completed",
      outcome: "a frozen analyst conclusion was recorded",
    });
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

  it("lets a fund brand with a credible official site run portfolio and fund-scale discovery despite an open identity question", () => {
    // Owner decision on #327: the collectors bind every artifact on the
    // official domain, so the person-shaped identity gate is redundant here.
    const evidence = emptyEvidence("@formventures");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.profile.display_name = "Form Ventures";
    evidence.profile.bio = "We back founders building the next generation of finance.";
    evidence.profile.website = "https://formventures.example/";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
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
    expect(researchPlanAllows(plan, "portfolio_and_outcomes")).toBe(true);
    expect(researchPlanAllows(plan, "fund_scale")).toBe(true);
    expect(plan.tasks.find((task) => task.capability === "portfolio_and_outcomes")?.blockedBy).toEqual([]);
  });

  it("keeps blocking an organization whose profile has no credible official site", () => {
    const evidence = emptyEvidence("@formventures");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.profile.display_name = "Form Ventures";
    evidence.profile.bio = "We back founders.";
    evidence.profile.website = "https://linktr.ee/formventures";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
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
    expect(researchPlanAllows(plan, "portfolio_and_outcomes")).toBe(false);
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
