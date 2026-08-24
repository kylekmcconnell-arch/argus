import { describe, expect, it } from "vitest";
import type { TokenAxis } from "../token/audit";
import { decisionBoundaryHref, deriveTokenDecisionBoundary } from "./decisionBoundary";

const axes: TokenAxis[] = [
  { key: "T1", label: "Liquidity & lock", score: 18, weight: 24, rationale: "Saved." },
  { key: "T2", label: "Contract safety", score: 20, weight: 26, rationale: "Saved." },
  { key: "T3", label: "Taxes & tradeability", score: 10, weight: 12, rationale: "Saved." },
  { key: "T4", label: "Holder distribution", score: 8, weight: 16, rationale: "Saved." },
  { key: "T5", label: "Trading authenticity", score: 8, weight: 12, rationale: "Saved." },
  { key: "T6", label: "Maturity & presence", score: 8, weight: 10, rationale: "Saved." },
];

describe("deriveTokenDecisionBoundary", () => {
  it.each([
    ["honeypot_confirmed", 10],
    ["cannot_sell_all", 15],
    ["owner_can_modify_balance", 20],
    ["balance_mutable_authority", 20],
    ["serial_scammer_creator", 25],
    ["mint_authority_active", 35],
    ["freeze_authority_active", 35],
    ["reclaimable_ownership", 35],
    ["single_wallet_majority_supply", 39],
    ["documented_scanner_concealment", 55],
    ["single_wallet_concentration", 69],
    ["few_wallet_concentration", 69],
    ["ofac_sanctioned_address", 5],
  ])("freezes the public decision lock for %s", (capApplied, ceiling) => {
    const boundary = deriveTokenDecisionBoundary({ score: Math.min(ceiling, 30), capApplied, axes });
    expect(boundary).toMatchObject({ schemaVersion: 1, kind: "cap" });
    expect(boundary?.boundary).toContain(`caps the score at ${ceiling}/100`);
    expect(boundary?.willNotChange).toContain("social activity cannot override");
    expect(boundary?.unlockCondition.length).toBeGreaterThan(30);
  });

  it("fails closed for a legacy or unknown cap instead of inventing a ceiling", () => {
    const boundary = deriveTokenDecisionBoundary({ score: 32, capApplied: "future_cap", axes });
    expect(boundary).toMatchObject({ kind: "unknown_cap", evidenceArea: "method" });
    expect(boundary?.boundary).toContain("will not infer the missing ceiling");
    expect(boundary?.boundary).not.toMatch(/caps the score at/);
  });

  it("states the exact distance and whether one axis can cross an uncapped threshold", () => {
    const caution = deriveTokenDecisionBoundary({ score: 64, capApplied: null, axes });
    expect(caution).toMatchObject({ kind: "threshold" });
    expect(caution?.controllingFact).toBe("6 evidence-backed points separate this score from PASS.");
    expect(caution?.boundary).toContain("Holder distribution has 8 points of unused headroom on paper");
    expect(caution?.unlockCondition).toContain("arithmetic headroom is not a prediction");

    const fail = deriveTokenDecisionBoundary({ score: 31, capApplied: null, axes });
    expect(fail?.controllingFact).toBe("9 evidence-backed points separate this score from CAUTION.");
    expect(fail?.boundary).toContain("no single scored area can cross the boundary by itself");
  });

  it("states the saved PASS buffer without predicting a future score", () => {
    const boundary = deriveTokenDecisionBoundary({ score: 93, capApplied: null, axes });
    expect(boundary).toMatchObject({ kind: "buffer" });
    expect(boundary?.controllingFact).toBe("24 points separate this score from falling below PASS.");
    expect(boundary?.unlockCondition).toContain("Only a new scan");
  });

  it("withholds the feature when the saved score was withheld", () => {
    expect(deriveTokenDecisionBoundary({ score: null, capApplied: "mint_authority_active", axes })).toBeNull();
  });

  it("maps the frozen evidence area to anchors that exist in both report shells", () => {
    const boundary = deriveTokenDecisionBoundary({ score: 35, capApplied: "mint_authority_active", axes })!;
    expect(decisionBoundaryHref(boundary, "token")).toBe("#token-methodology");
    expect(decisionBoundaryHref(boundary, "investigation")).toBe("#investigation-evidence");
  });
});
