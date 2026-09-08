import { describe, expect, it } from "vitest";
import { REPORT_LANE_DEFINITIONS, REPORT_LANE_ORDER } from "./reportLaneRegistry";
import { reportLaneRenderers } from "./reportLaneRendererRegistry";

describe("report view architecture", () => {
  it("registers only Production and Developer with the same report contract and layout", () => {
    expect(REPORT_LANE_ORDER).toEqual(["production", "developer"]);
    expect(Object.keys(REPORT_LANE_DEFINITIONS)).toEqual([...REPORT_LANE_ORDER]);
    for (const id of REPORT_LANE_ORDER) {
      expect(REPORT_LANE_DEFINITIONS[id]).toMatchObject({ kind: "editorial", presentationStyle: 2, navigation: "sticky", dataContract: "shared-saved-report-v1" });
    }
  });
  it("reuses production connection, social, and GitHub renderers in Developer", () => {
    for (const slot of ["connectionWorkspace", "socialSynthesis", "githubSynthesis"] as const) {
      expect(reportLaneRenderers("developer")[slot]).toBe(reportLaneRenderers("production")[slot]);
    }
  });
});
