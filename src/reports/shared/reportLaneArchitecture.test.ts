import { describe, expect, it } from "vitest";
import { REPORT_LANE_DEFINITIONS, REPORT_LANE_ORDER } from "./reportLaneRegistry";

describe("report lane architecture", () => {
  it("registers exactly three editorial interpretations and one evidence view", () => {
    expect(REPORT_LANE_ORDER).toEqual(["production", "kyle", "enigma", "raw"]);
    expect(REPORT_LANE_ORDER.filter((id) => REPORT_LANE_DEFINITIONS[id].kind === "editorial")).toHaveLength(3);
    expect(REPORT_LANE_ORDER.filter((id) => REPORT_LANE_DEFINITIONS[id].kind === "evidence")).toEqual(["raw"]);
  });

  it("keeps all views on one immutable saved-report contract", () => {
    const contracts = new Set(REPORT_LANE_ORDER.map((id) => REPORT_LANE_DEFINITIONS[id].dataContract));
    expect([...contracts]).toEqual(["shared-saved-report-v1"]);
  });

  it("keeps editorial synthesis out of the Raw Evidence renderer", () => {
    expect(REPORT_LANE_DEFINITIONS.raw.kind).toBe("evidence");
    expect(REPORT_LANE_DEFINITIONS.raw.description).toContain("frozen evidence");
  });
});
