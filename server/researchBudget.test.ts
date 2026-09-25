import { expect, it } from "vitest";
import { researchBudget } from "./researchBudget";
it("honors explicit uncapped research without silently changing capped runs", () => {
  expect(researchBudget(0, true, false)).toBe(Infinity);
  expect(researchBudget(50000, false, false)).toBe(50000);
  expect(() => researchBudget(0, false, false)).toThrow();
  expect(() => researchBudget(50000, true, false)).toThrow();
});
it("refuses malformed limits even for previews", () => {
  for (const value of [NaN, Infinity, -1, 0.5]) expect(() => researchBudget(value, false, true)).toThrow();
});
