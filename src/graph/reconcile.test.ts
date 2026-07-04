import { describe, it, expect } from "vitest";
import { reconcileVerdict, tieStrength } from "./network";
import type { GraphContribution } from "./network";
import type { PanoptesNode, PanoptesEdge } from "../engine";

// Two audits that share an on-chain entity. The subject ($GOOD) links to a wallet
// that a KNOWN-AVOID token ($RUG) also links to → reconciliation must override.
const N = (type: string, key: string, extra: object = {}): PanoptesNode => ({ type, key, ...extra } as PanoptesNode);
const E = (src: string, dst: string, type: string): PanoptesEdge => ({ src, dst, type });

function graph(sharedKey: string): GraphContribution[] {
  return [
    { handle: "$GOOD", verdict: "PASS", nodes: [N("Company", "$GOOD", { subject: true }), N("Identity", sharedKey)], edges: [E("$GOOD", sharedKey, "DEPLOYED_BY")] },
    { handle: "$RUG", verdict: "AVOID", nodes: [N("Company", "$RUG", { subject: true }), N("Identity", sharedKey)], edges: [E("$RUG", sharedKey, "DEPLOYED_BY")] },
  ];
}

describe("tieStrength", () => {
  it("rates on-chain infra + identity as hard, holders as weak, people as medium", () => {
    expect(tieStrength("wallet:1234abcd")).toBe("hard");
    expect(tieStrength("funder:1234abcd")).toBe("hard");
    expect(tieStrength("code:deadbeef")).toBe("hard");
    expect(tieStrength("email:dev@x.com")).toBe("hard");
    expect(tieStrength("holder:1234abcd")).toBe("weak");
    expect(tieStrength("@somefounder")).toBe("medium");
  });
});

describe("reconcileVerdict", () => {
  it("overrides to AVOID when sharing a deployer wallet with a failed subject", () => {
    const r = reconcileVerdict("$GOOD", graph("wallet:1234abcd"));
    expect(r?.severity).toBe("avoid");
    expect(r?.line).toContain("$RUG");
  });

  it("overrides to AVOID on a shared bytecode fingerprint", () => {
    const r = reconcileVerdict("$GOOD", graph("code:deadbeef01"));
    expect(r?.severity).toBe("avoid");
  });

  it("downgrades to CAUTION for a shared associate (not a hard infra tie)", () => {
    // An ASSOCIATE edge (not TEAM) does NOT collapse the two projects into one
    // entity via the alias resolver, so the shared person survives as a medium tie.
    const g: GraphContribution[] = [
      { handle: "$GOOD", verdict: "PASS", nodes: [N("Company", "$GOOD", { subject: true }), N("Person", "@promoter")], edges: [E("$GOOD", "@promoter", "ASSOCIATE")] },
      { handle: "$RUG", verdict: "AVOID", nodes: [N("Company", "$RUG", { subject: true }), N("Person", "@promoter")], edges: [E("$RUG", "@promoter", "ASSOCIATE")] },
    ];
    expect(reconcileVerdict("$GOOD", g)?.severity).toBe("caution");
  });

  it("does NOT override when there is no connection to a bad subject", () => {
    const g: GraphContribution[] = [
      { handle: "$GOOD", verdict: "PASS", nodes: [N("Company", "$GOOD", { subject: true }), N("Identity", "wallet:1234abcd")], edges: [E("$GOOD", "wallet:1234abcd", "DEPLOYED_BY")] },
      { handle: "$ALSOGOOD", verdict: "PASS", nodes: [N("Company", "$ALSOGOOD", { subject: true }), N("Identity", "wallet:1234abcd")], edges: [E("$ALSOGOOD", "wallet:1234abcd", "DEPLOYED_BY")] },
    ];
    expect(reconcileVerdict("$GOOD", g)).toBeNull();
  });
});
