// Calibration guard: the golden set must show zero drift. Runs in `npm test`
// alongside the engine port-fidelity suite.
import { describe, it, expect } from "vitest";
import { SubjectClass } from "../engine";
import { getProfile } from "../engine/profiles";
import { GOLDEN } from "./golden";
import { runCalibration } from "./run";
import {
  buildScoringEvidencePacket,
  deriveProjectStrengthBands,
  inspectAnalystScoringPreflight,
  type AnalystAxis,
} from "../../server/agent";

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

  it("covers the PROJECT methodology across established, early-stage, harmful, and abstention controls", () => {
    const projectCases = GOLDEN.filter((candidate) =>
      candidate.evidence.roles.includes(SubjectClass.PROJECT));
    expect(projectCases.map((candidate) => candidate.name)).toEqual(expect.arrayContaining([
      "project:established-operating-protocol",
      "project:early-stage-clean",
      "project:verified-fraud-hard-stop",
      "project:critical-unrecovered-loss",
      "abstain:missing-project-axis",
    ]));
    expect(projectCases.filter((candidate) => candidate.groundTruth === "clean").length).toBeGreaterThanOrEqual(2);
    expect(projectCases.some((candidate) => candidate.groundTruth === "harmful")).toBe(true);
    expect(projectCases.some((candidate) => candidate.groundTruth === "insufficient-evidence")).toBe(true);
  });

  it("keeps established and early clean project controls inside their live scorer strength bands", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const cases = [
      {
        name: "project:established-operating-protocol",
        tiers: ["exceptional", "exceptional", "exceptional", "solid", "exceptional", "exceptional"],
      },
      {
        name: "project:early-stage-clean",
        tiers: ["solid", "emerging", "emerging", "emerging", "emerging", "emerging"],
      },
    ] as const;

    for (const expected of cases) {
      const golden = GOLDEN.find((candidate) => candidate.name === expected.name)!;
      const evidence = golden.evidence;
      const packet = buildScoringEvidencePacket({
        profile: evidence.profile,
        projectToken: evidence.projectToken,
        team: evidence.webTeam,
        basicFacts: evidence.basicFacts,
        recentActivity: evidence.recentActivity.map((text) => ({ text, provider: "twitterapi" })),
        sourceArtifacts: evidence.sourceArtifacts,
        findings: evidence.findings,
      }, axes);
      expect(inspectAnalystScoringPreflight(axes, packet).state).toBe("ready");
      const bands = deriveProjectStrengthBands(packet, axes);
      expect(axes.map(({ axis }) => bands[axis].tier)).toEqual(expected.tiers);
      for (const scored of evidence.axes) {
        const band = bands[scored.axis];
        expect(scored.score, `${expected.name}:${scored.axis}`).toBeGreaterThanOrEqual(band.minScore);
        expect(scored.score, `${expected.name}:${scored.axis}`).toBeLessThanOrEqual(band.maxScore);
      }
    }
  });

  it("has no critical quality failures", () => {
    expect(quality.falsePasses).toEqual([]);
    expect(quality.falseAvoids).toEqual([]);
    expect(quality.unsafeConclusions).toEqual([]);
    expect(quality.identityMisses).toEqual([]);
  });
});
