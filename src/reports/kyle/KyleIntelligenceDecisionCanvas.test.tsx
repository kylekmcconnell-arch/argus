// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KyleIntelligenceDecisionCanvas } from "./KyleIntelligenceDecisionCanvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const props = {
  subjectName: "Fedi",
  subjectSummary: "Fedi is a privacy-first Bitcoin wallet with chat and community spaces.",
  reportSummary: "Named leadership and a live product are established. Which independent security audits are published? Return each event with a direct source.",
  verdictLabel: "Caution",
  score: 55,
  scoreLabel: "Project diligence score",
  scoreContext: "Team, product, backers, traction and transparency.",
  favorable: false,
  supports: [{ label: "Leadership identity is source-backed", detail: "Named operators are independently tied to the project." }],
  concerns: [{ label: "Security history remains unresolved", detail: "Independent review evidence remains limited." }],
  nextSteps: [{ label: "Establish a complete independent security history" }],
  verified: [{ label: "Project identity confirmed" }],
  coveragePercent: 71,
  successful: 7,
  applicable: 7,
  capturedAt: "Aug 26, 2026",
  evidenceHref: "#evidence-ledger" as const,
  methodologyHref: "#scan-methodology" as const,
  checkScopeLabel: "Required report checks",
  composition: [
    { axis: "team", label: "Team & leadership", score: 16, weight: 16, rationale: "Named leadership is source-backed.", supportCount: 3 },
    { axis: "product", label: "Product & execution", score: 12, weight: 16, rationale: "A live product is confirmed.", supportCount: 2, questionCount: 1 },
    { axis: "traction", label: "Traction & usage", score: 8, weight: 16, rationale: "Independent adoption evidence remains thin.", supportCount: 1, questionCount: 2 },
  ],
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete document.documentElement.dataset.kyleReportDepth;
  vi.unstubAllGlobals();
});

describe("Kyle intelligence report opening", () => {
  it("leads with the verdict and separates evidence gaps from adverse evidence", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas {...props} />));

    expect(container.textContent).toContain("VERDICT");
    expect(container.textContent).toContain("Fedi");
    expect(container.textContent).toContain("55");
    expect(container.textContent).toContain("scored counter-signals");
    expect(container.textContent).toContain("unresolved evidence questions");
    expect(container.textContent).toContain("The verdict, constructed from evidence.");
    expect(container.textContent).not.toContain("Which independent security audits");
    expect(container.textContent).not.toContain("Return each event");
  });

  it("starts in Brief and exposes Analysis and Evidence room depth controls", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas {...props} />));

    expect(document.documentElement.dataset.kyleReportDepth).toBe("brief");
    const analysis = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Analysis");
    const evidence = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Evidence room");
    expect(analysis).toBeTruthy();
    expect(evidence).toBeTruthy();

    await act(async () => analysis?.click());
    expect(document.documentElement.dataset.kyleReportDepth).toBe("analysis");

    await act(async () => evidence?.click());
    expect(document.documentElement.dataset.kyleReportDepth).toBe("evidence");
  });
});

