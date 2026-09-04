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
  it("describes unresolved public evidence without implying a research failure", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      {...props}
      favorable
      concerns={[]}
    />));

    expect(container.textContent).toContain(
      "Team and leadership is the strongest verified part of the case. The available public record still lacks independent security and governance evidence.",
    );
    expect(container.textContent).not.toContain("Independent evidence remains incomplete.");
  });

  it("uses verified support depth before score saturation when naming the strongest evidence", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      {...props}
      favorable
      concerns={[]}
      composition={[
        { axis: "team", label: "Team & leadership", score: 9, weight: 16, rationale: "The roster is deeply sourced.", supportCount: 8 },
        { axis: "product", label: "Product & execution", score: 20, weight: 24, rationale: "The product is live.", supportCount: 4 },
      ]}
    />));

    expect(container.textContent).toContain("Team and leadership is the strongest verified part of the case.");
    expect(container.textContent).not.toContain("Product and execution is the strongest verified part of the case.");
  });

  it("names the actual unresolved evidence area instead of hard-coding security and governance", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      {...props}
      favorable
      concerns={[]}
      nextSteps={[{ label: "Verify current customer adoption and recurring usage" }]}
      composition={[
        { axis: "team", label: "Team & leadership", score: 15, weight: 16, rationale: "Named leadership is source-backed.", supportCount: 4 },
        { axis: "traction", label: "Traction & usage", score: 8, weight: 16, rationale: "Adoption remains partly measured.", supportCount: 1, questionCount: 1 },
      ]}
    />));

    expect(container.textContent).toContain("The available public record still lacks independent usage and market evidence.");
    expect(container.textContent).not.toContain("still lacks independent security and governance evidence");
  });

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
    expect(container.textContent).not.toContain("Review this for");
    expect(container.querySelector('[aria-label="Review angle"]')).toBeNull();
    expect(container.textContent).toContain("What matters before you decide.");
    expect(container.textContent).toContain("The strongest case for it, the reason to hesitate, and the evidence that could change the verdict.");
    expect(container.textContent).not.toContain("research-engine language");
    expect(container.textContent).toContain("The bottom line.");
    expect(container.textContent).toContain("The clearest reading of what is established");
    expect(container.textContent).not.toContain("What the evidence means.");
    expect(container.textContent).not.toContain("FALSIFIABLE");
    expect(container.textContent).not.toContain("private model reasoning");
    const take = container.querySelector(".kyle-argus-take")?.textContent ?? "";
    expect(take.match(/Leadership identity is source-backed/g)).toHaveLength(1);
    expect(container.querySelector('a[href="#composition"]')?.textContent).toContain("Continue through the full report");
    expect([...container.querySelectorAll('a[href="#evidence-ledger"]')]
      .some((link) => link.textContent?.includes("Enter evidence room"))).toBe(true);
  });

  it("replaces the full watching chapter with a compact, impact-based Verify next strip", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      {...props}
      nextSteps={[
        { label: "Establish a complete independent security history", impactAxis: "product" },
        { label: "Verify current product adoption" },
        { label: "Confirm a third lower-impact item" },
      ]}
    />));

    const strip = container.querySelector(".kyle-verify-next");
    expect(strip?.textContent).toContain("VERIFY NEXT");
    expect(strip?.textContent).toContain("The evidence most likely to change the decision.");
    expect(strip?.textContent).toContain("Decision impact:");
    expect(strip?.textContent).toContain("tied to Product & execution");
    expect(strip?.textContent).not.toContain("Team & leadership");
    expect(strip?.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).not.toContain("What ARGUS is watching.");
    expect(strip?.textContent).not.toContain("Confirm a third lower-impact item");
  });

  it("removes Verify next entirely when no material question remains", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas {...props} nextSteps={[]} />));

    expect(container.querySelector(".kyle-verify-next")).toBeNull();
    expect(container.textContent).not.toContain("VERIFY NEXT");
  });

  it("does not expose empty internal limitation language or analyst shorthand", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      {...props}
      concerns={[]}
      reportSummary="Emerging service with null backing."
    />));

    expect(container.textContent).toContain("No material concern was identified in the evidence reviewed.");
    expect(container.textContent).toContain("no verified financial backing");
    expect(container.textContent).not.toContain("No governing limitation was recorded");
    expect(container.textContent).not.toContain("null backing");
  });

  it("keeps project diligence and linked-token safety as two separate scores", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas
      presentationStyle={2}
      {...props}
      secondaryScore={{
        label: "Token safety score",
        score: 82,
        verdictLabel: "Pass",
        context: "Contract, tradeability, liquidity, holders, market data and sanctions.",
        composition: [
          { axis: "T1", label: "Liquidity & lock", score: 20, weight: 24, rationale: "Liquidity was measured." },
          { axis: "T2", label: "Contract controls", score: 18, weight: 22, rationale: "Contract controls were checked." },
        ],
      }}
    />));

    expect(container.querySelector(".kyle-investigation-meta")?.textContent).toContain("Project diligence score");
    const scoreRings = container.querySelectorAll(".kyle-score-ring-card [data-score-ring-entrance]");
    expect(scoreRings).toHaveLength(2);
    expect(container.querySelector('[data-score-kind="primary"]')?.textContent).toContain("55");
    const tokenScore = container.querySelector('[data-score-kind="secondary"]');
    expect(tokenScore?.textContent).toContain("Token safety score");
    expect(tokenScore?.textContent).toContain("82");
    expect(tokenScore?.querySelector('[data-composition-piece="T1"]')).not.toBeNull();
    expect(tokenScore?.querySelector('[data-composition-piece="T2"]')).not.toBeNull();
  });

  it("explains score segments on hover and keyboard focus", async () => {
    await act(async () => root.render(<KyleIntelligenceDecisionCanvas {...props} />));

    const teamHit = container.querySelector<SVGCircleElement>('[data-score-ring-piece-hit="team"]');
    expect(teamHit).not.toBeNull();
    expect(teamHit?.getAttribute("role")).toBe("button");
    expect(teamHit?.getAttribute("aria-label")).toContain("16 of 16 available points");
    expect(teamHit?.getAttribute("aria-label")).toContain("3 supporting sources");

    act(() => teamHit?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const explanation = container.querySelector('[data-score-ring-explanation="team"]');
    expect(explanation).not.toBeNull();
    expect(explanation?.textContent).toContain("Team & leadership");
    expect(explanation?.textContent).toContain("16 of 16 points");
    expect(explanation?.textContent).toContain("Named leadership is source-backed.");
    expect(container.querySelector('[data-score-ring-piece-active="team"]')).not.toBeNull();

    act(() => teamHit?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(container.querySelector("[data-score-ring-explanation]")).toBeNull();

    act(() => teamHit?.focus());
    expect(container.querySelector('[data-score-ring-explanation="team"]')).not.toBeNull();
    expect(teamHit?.getAttribute("aria-pressed")).toBe("true");
  });
});
