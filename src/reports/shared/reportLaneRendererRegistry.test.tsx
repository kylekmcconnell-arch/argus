// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { reportLaneRenderers } from "./reportLaneRendererRegistry";
import type { InvestigationDecisionCanvasProps } from "./reportLaneRendererTypes";

const props: InvestigationDecisionCanvasProps = {
  subjectName: "Example project", verdictLabel: "Provisional", score: 67,
  scoreIsProvisional: true, favorable: false, verdictTone: "caution",
  supports: [{ label: "Verified product" }], concerns: [{ label: "Missing audit" }],
  nextSteps: [], verified: [], coveragePercent: 50, successful: 2, applicable: 4,
};

describe("Developer report", () => {
  it("renders the identical production summary plus a collapsed evidence inspector", () => {
    const production = renderToStaticMarkup(reportLaneRenderers("production").decisionCanvas!(props));
    const developer = renderToStaticMarkup(reportLaneRenderers("developer").decisionCanvas!(props));
    expect(developer.startsWith(production)).toBe(true);
    const document = new DOMParser().parseFromString(developer, "text/html");
    expect(document.querySelectorAll("#report-summary")).toHaveLength(1);
    expect(document.querySelector("details.report-developer-tools")?.hasAttribute("open")).toBe(false);
    expect(document.querySelector("#developer-evidence-record")?.textContent).toContain("67 / 100");
    expect(production).not.toContain("Developer evidence and verification");
  });
});
