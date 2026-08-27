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

  it("keeps the complete report in the reading flow instead of replacing it with depth modes", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas {...props} />));

    expect(container.querySelector('[aria-label="Report depth"]')).toBeNull();
    expect(container.querySelector('a[href="#composition"]')?.textContent).toContain("Continue through the full report");
    expect([...container.querySelectorAll('a[href="#evidence-ledger"]')]
      .some((link) => link.textContent?.includes("Enter evidence room"))).toBe(true);
  });

  it("keeps project diligence and linked-token safety as two separate scores", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      {...props}
      secondaryScore={{
        label: "Token safety score",
        score: 82,
        verdictLabel: "Pass",
        context: "Contract, tradeability, liquidity, holders, market data and sanctions.",
      }}
    />));

    expect(container.querySelector(".kyle-investigation-meta")?.textContent).toContain("Project diligence score");
    expect(container.querySelector(".kyle-verdict-score")?.textContent).toContain("55");
    const tokenScore = container.querySelector(".kyle-secondary-score");
    expect(tokenScore?.textContent).toContain("Token safety score");
    expect(tokenScore?.textContent).toContain("82/100");
  });
});
