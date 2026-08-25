// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResearchPlan } from "../lib/researchDirector";
import { ResearchPlanPanel } from "./ResearchPlanPanel";

const plan: ResearchPlan = {
  schemaVersion: 1,
  intent: "investment_due_diligence",
  subject: "Fixture Capital",
  roles: ["PROJECT"],
  createdAt: "2026-08-07T12:00:00.000Z",
  nextActions: [{
    rank: 1,
    taskId: "team",
    capability: "people_and_control",
    action: "Verify who operates and controls the project.",
    whyNow: "It governs the control conclusion.",
    delegates: ["official-site"],
  }],
  tasks: [
    {
      id: "product",
      capability: "project_fundamentals",
      question: "Is there a live product?",
      why: "Product evidence matters.",
      priority: "critical",
      delegates: ["official-site"],
      checkIds: ["project-product-substance"],
      triggeredBy: [],
      rank: 1,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Selected internally.",
      stopWhen: "The product is verified.",
      blockedBy: [],
      state: "completed",
      outcome: "1 evidence question answered",
    },
    {
      id: "team",
      capability: "people_and_control",
      question: "Who operates and controls the project?",
      why: "Control evidence matters.",
      priority: "critical",
      delegates: ["official-site", "public-web"],
      checkIds: ["project-team-identity"],
      triggeredBy: ["project.team"],
      rank: 2,
      decisionImpact: 5,
      costClass: "medium",
      dispatchReason: "A critical gap raised this workstream.",
      stopWhen: "Control is verified.",
      blockedBy: [],
      state: "unavailable",
      outcome: "1 evidence question unresolved",
    },
    {
      id: "synthesis",
      capability: "analyst_synthesis",
      question: "What conclusion follows?",
      why: "Collection needs a conclusion.",
      priority: "critical",
      delegates: ["ai-analyst"],
      checkIds: [],
      triggeredBy: [],
      rank: 3,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Selected internally.",
      stopWhen: "A conclusion is frozen.",
      blockedBy: [],
      state: "partial",
      outcome: "delegated search completed; no frozen answer was recorded",
    },
  ],
};

describe("ResearchPlanPanel", () => {
  it("leads with a concise reader-facing coverage summary", () => {
    const html = renderToStaticMarkup(<ResearchPlanPanel plan={plan} />);

    expect(html).toContain("What the scan established, and what is still missing");
    expect(html).toContain("The scan finished, but some answers still need more evidence");
    expect(html).not.toContain("No research questions still need evidence");
    expect(html).not.toMatch(/\d+ still needs? more evidence/);
    expect(html).toContain("The scan finished");
    expect(html).toContain("More evidence needed");
    expect(html).toContain("Who operates and controls the project?");
    expect(html).toContain("ARGUS could not verify this from the evidence saved with the report.");
    expect(html).toContain("Best next step");
  });

  it("keeps internal routing and raw states inside closed technical details", () => {
    const html = renderToStaticMarkup(<ResearchPlanPanel plan={plan} />);
    const technicalStart = html.indexOf("Technical coverage details");

    expect(html).toContain("<details class=\"group border-t");
    expect(html).not.toContain("<details open=\"\"");
    expect(technicalStart).toBeGreaterThan(-1);
    expect(html.indexOf("official-site · public-web")).toBeGreaterThan(technicalStart);
    expect(html.indexOf("delegated search completed; no frozen answer was recorded")).toBeGreaterThan(technicalStart);
  });
});
