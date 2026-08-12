// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResearchPlan } from "../lib/researchDirector";
import { ResearchPlanPanel } from "./ResearchPlanPanel";

describe("ResearchPlanPanel", () => {
  it("shows delegation and preserves incomplete work as open", () => {
    const plan: ResearchPlan = {
      schemaVersion: 1,
      intent: "investment_due_diligence",
      subject: "Fixture Capital",
      roles: ["INVESTOR"],
      createdAt: "2026-08-07T12:00:00.000Z",
      nextActions: [{
        rank: 1,
        taskId: "portfolio",
        capability: "portfolio_and_outcomes",
        action: "Verify the highest-value portfolio relationship.",
        whyNow: "It governs the track-record conclusion.",
        delegates: ["portfolio-web"],
      }],
      tasks: [{
        id: "portfolio",
        capability: "portfolio_and_outcomes",
        question: "Which investments are actually attributable?",
        why: "Firm and personal investments must remain separate.",
        priority: "critical",
        delegates: ["portfolio-web", "official-portfolio"],
        checkIds: ["vc-portfolio-track-record"],
        triggeredBy: ["investor.portfolio"],
        rank: 1,
        decisionImpact: 5,
        costClass: "high",
        dispatchReason: "A critical track-record gap raised this workstream.",
        stopWhen: "Every material relationship is corroborated or rejected.",
        blockedBy: [],
        state: "partial",
        outcome: "3 answered; 1 unresolved",
      }],
    };
    const html = renderToStaticMarkup(<ResearchPlanPanel plan={plan} />);
    expect(html).toContain("What ARGUS delegated and why");
    expect(html).toContain("portfolio-web · official-portfolio");
    expect(html).toContain("1 open");
    expect(html).toContain("3 answered; 1 unresolved");
    expect(html).toContain("Next best investigation move");
  });
});
