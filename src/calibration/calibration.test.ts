// Calibration guard: the golden set must show zero drift. Runs in `npm test`
// alongside the engine port-fidelity suite.
import { describe, it, expect } from "vitest";
import { runCalibration } from "./run";

describe("ARGUS calibration (golden set)", () => {
  const { results, quality } = runCalibration();
  for (const r of results) {
    it(`${r.name} -> ${r.expected.verdict}`, () => {
      expect(r.mismatches).toEqual([]);
    });
  }

  it("covers clean, harmful, insufficient-evidence, and identity-fraud controls", () => {
    expect(quality.byGroundTruth.clean).toBeGreaterThanOrEqual(5);
    expect(quality.byGroundTruth.harmful).toBeGreaterThanOrEqual(5);
    expect(quality.byGroundTruth["insufficient-evidence"]).toBeGreaterThanOrEqual(2);
    expect(quality.byGroundTruth["identity-fraud"]).toBeGreaterThanOrEqual(1);
  });

  it("has no critical quality failures", () => {
    expect(quality.falsePasses).toEqual([]);
    expect(quality.falseAvoids).toEqual([]);
    expect(quality.unsafeConclusions).toEqual([]);
    expect(quality.identityMisses).toEqual([]);
  });
});
