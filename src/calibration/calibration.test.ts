// Calibration guard: the golden set must show zero drift. Runs in `npm test`
// alongside the engine port-fidelity suite.
import { describe, it, expect } from "vitest";
import { runCalibration } from "./run";

describe("ARGUS calibration (golden set)", () => {
  const { results } = runCalibration();
  for (const r of results) {
    it(`${r.name} -> ${r.expected.verdict}`, () => {
      expect(r.mismatches).toEqual([]);
    });
  }
});
