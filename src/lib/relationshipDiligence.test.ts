import { expect, it } from "vitest";
import { buildTeamDiligence, classifyRelationship } from "./relationshipDiligence";
import type { BasicFact, WebTeamMember } from "../data/evidence";
const member = (role: string): WebTeamMember => ({ name: "Ada Example", role, source: "team-page", sourceUrl: "https://example.com/team", artifact_verified: true, evidence_origin: "deterministic" });
it("keeps function separate from fractional external capacity and founder ownership", () => {
  const role = classifyRelationship("Co-founder and fractional CTO; shareholder");
  expect(role.relationships).toEqual(expect.arrayContaining(["founder", "executive", "contractor", "owner"]));
  expect(role.functions).toContain("Engineering"); expect(role.capacity).toBe("fractional");
  expect(role.boundary).toBe("mixed_or_unspecified");
});
it("does not turn an operating director into a board director or a partner into an investor", () => {
  expect(classifyRelationship("Marketing director").relationships).not.toContain("board_director");
  expect(classifyRelationship("Infrastructure partner, AWS Activate credits").relationships).not.toContain("investor");
  expect(classifyRelationship("Design partner").relationships).toEqual(["pilot_customer"]);
});
it("does not confirm present responsibility from a former executive or a discovery lead", () => {
  const team = buildTeamDiligence([member("Former CTO"), { ...member("CTO"), evidence_origin: "model_lead" }], []);
  expect(team.capabilities.find(c => c.function === "Engineering")?.roleRefs).toEqual([]);
});
it("keeps same-name people separate and does not equate a source-backed title with delivery", () => {
  const team = buildTeamDiligence([member("CTO"), member("Advisor")], []);
  expect(new Set(team.relationships.map(r => r.partyKey)).size).toBe(2);
  expect(team.capabilities.find(c => c.function === "Engineering")?.workRefs).toEqual([]);
  expect(team.capabilities.find(c => c.function === "Engineering")?.assessment).toContain("not established by the title");
});
it("flags investment/credit scope for reconciliation without inventing fraud or denying a separate investment", () => {
  const fact = { factId: "investment-1", predicate: "investor", value: "Example Cloud", status: "verified", artifact_verified: true, evidence_origin: "deterministic", sources: [{ url: "https://example.com", excerpt: "Example Cloud provided startup credits.", relation: "supports", artifactVerified: true }] } as BasicFact;
  const team = buildTeamDiligence([], [fact]);
  expect(team.relationships[0].concern?.detail).toContain("separate capital investment");
  expect(team.relationships[0].concern?.detail).toContain("not a finding of deception");
  expect(team.questions[0]).toContain("financial backing");
});
it.each(["Not an investor", "Possible advisor", "Unconfirmed cofounder"])("leaves uncertain or negated role unresolved: %s", role => {
  expect(classifyRelationship(role).relationships).toEqual(["unknown"]);
});
it("distinguishes staff, service firms, market participants and assurance", () => {
  expect(classifyRelationship("HR employee").functions).toContain("People / HR");
  expect(classifyRelationship("Marketing agency").relationships).toContain("agency");
  expect(classifyRelationship("Market maker and liquidity provider").relationships).toEqual(["market_maker", "liquidity_provider"]);
  expect(classifyRelationship("Smart-contract auditor").relationships).toContain("auditor");
  expect(classifyRelationship("Token designer").functions).toContain("Token / mechanism design");
});
it("does not count an engineering advisor as the person responsible for delivery", () => {
  expect(buildTeamDiligence([member("Engineering advisor")], []).capabilities.find(c => c.function === "Engineering")?.roleRefs).toEqual([]);
});
it("checks roster backing claims as well as structured investor facts", () => {
  const team = buildTeamDiligence([{ ...member("Backer"), evidence: "AWS Activate startup credits" }], []);
  expect(team.relationships[0].concern?.kind).toBe("claim_evidence_gap");
});
