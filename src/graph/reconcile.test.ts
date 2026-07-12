import { describe, it, expect } from "vitest";
import { buildNetwork, reconcileVerdict, tieStrength } from "./network";
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

  it("does not treat two investors in the same company as an adverse operator link", () => {
    const g: GraphContribution[] = [
      { handle: "@fund_a", verdict: "PASS", nodes: [N("Person", "@fund_a", { subject: true }), N("Company", "popularco.com")], edges: [E("@fund_a", "popularco.com", "INVESTED_IN")] },
      { handle: "@fund_b", verdict: "AVOID", nodes: [N("Person", "@fund_b", { subject: true }), N("Company", "popularco.com")], edges: [E("@fund_b", "popularco.com", "INVESTED_IN")] },
    ];
    expect(reconcileVerdict("@fund_a", g)).toBeNull();
    const network = buildNetwork([], g);
    expect(network.bridges).toContainEqual(expect.objectContaining({ id: "popularco.com" }));
    expect(network.cabals).toEqual([]);
    expect(network.nodes.find((node) => node.id === "popularco.com")?.rugLinks).toBe(0);
  });

  it("still treats a shared operating company as a contextual caution", () => {
    const g: GraphContribution[] = [
      { handle: "@operator_a", verdict: "PASS", nodes: [N("Person", "@operator_a", { subject: true }), N("Company", "sharedco.com")], edges: [E("@operator_a", "sharedco.com", "WORKED_ON")] },
      { handle: "@operator_b", verdict: "AVOID", nodes: [N("Person", "@operator_b", { subject: true }), N("Company", "sharedco.com")], edges: [E("@operator_b", "sharedco.com", "FOUNDED")] },
    ];
    expect(reconcileVerdict("@operator_a", g)?.severity).toBe("caution");
  });

  it("overrides to AVOID on Arkham exposure to a flagged bad actor (risk: node)", () => {
    // No connection to any failed SUBJECT — the override fires off the risk label alone.
    const g: GraphContribution[] = [
      { handle: "$GOOD", verdict: "PASS", nodes: [N("Company", "$GOOD", { subject: true }), N("Identity", "risk:lazarus-group", { subtype: "risk-avoid", label: "Lazarus Group · hacker source" })], edges: [E("$GOOD", "risk:lazarus-group", "TRANSACTS_WITH")] },
    ];
    const r = reconcileVerdict("$GOOD", g);
    expect(r?.severity).toBe("avoid");
    expect(r?.riskEntities?.[0].label).toContain("Lazarus");
  });

  it("downgrades to CAUTION for a lower-tier risk flag", () => {
    const g: GraphContribution[] = [
      { handle: "$GOOD", verdict: "PASS", nodes: [N("Company", "$GOOD", { subject: true }), N("Identity", "risk:some-mixer", { subtype: "risk-caution", label: "Some Mixer · privacy" })], edges: [E("$GOOD", "risk:some-mixer", "TRANSACTS_WITH")] },
    ];
    expect(reconcileVerdict("$GOOD", g)?.severity).toBe("caution");
  });
});
