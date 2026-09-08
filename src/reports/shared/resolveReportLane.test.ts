import { describe, expect, it } from "vitest";
import { resolveReportLane } from "./resolveReportLane";

describe("report view resolution", () => {
  it.each(["production", "developer", "kyle", "enigma", "raw"])("keeps non-owner %s links on Production", (view) => {
    expect(resolveReportLane({ search: `?reportView=${view}`, storedLane: "developer", canSelect: false })).toMatchObject({
      definition: { id: "production", owner: "joint" }, selectable: false, source: "default",
    });
  });
  it.each([["kyle", "production"], ["enigma", "production"], ["raw", "developer"], ["developer", "developer"]])("migrates %s links and saved settings to %s", (old, current) => {
    expect(resolveReportLane({ search: `?reportView=${old}`, canSelect: true }).definition.id).toBe(current);
    expect(resolveReportLane({ storedLane: old, canSelect: true }).definition.id).toBe(current);
  });
  it("gives explicit links precedence over saved preferences", () => {
    expect(resolveReportLane({ search: "?reportView=production", storedLane: "developer", canSelect: true }).definition.id).toBe("production");
  });
  it("fails closed for unknown selections", () => {
    expect(resolveReportLane({ search: "?reportView=unknown", storedLane: "unknown", canSelect: true }).definition.id).toBe("production");
  });
});
