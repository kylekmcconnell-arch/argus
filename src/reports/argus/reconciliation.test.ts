import { expect, it } from "vitest";
import { reconciliationIssues } from "./model";
it("blocks reassurance for conflicting token results without mutating saved scores", () => {
  const input = { subjectName: "Example", tokenScore: { score: 79, verdict: "PASS" }, riskLens: { risk: 100, verdict: "DANGER" } };
  const original = JSON.stringify(input);
  const issue = reconciliationIssues(input).find(row => row.id === "token-lens-conflict");
  expect(issue?.handling).toContain("Presentation rule 2026-09-22.1");
  expect(issue?.handling).toContain("not overall clearance");
  expect(JSON.stringify(input)).toBe(original);
  expect(reconciliationIssues({ ...input, riskLens: { risk: 10, verdict: "LOW" } })).toEqual([]);
});
