import { describe, expect, it } from "vitest";
import { resolveReportLane } from "./resolveReportLane";

describe("report lane resolution", () => {
  it("defaults every non-owner and public view to Production", () => {
    expect(resolveReportLane({ search: "?reportView=enigma", canSelect: false })).toMatchObject({
      definition: { id: "production", owner: "joint", navigation: "sticky" },
      selectable: false,
      source: "default",
    });
  });

  it("lets an owner select any internal report view through a link", () => {
    expect(resolveReportLane({ search: "?reportView=kyle", canSelect: true })).toMatchObject({
      definition: { id: "kyle", owner: "@kylekmcconnell-arch" },
      selectable: true,
      source: "query",
    });
    expect(resolveReportLane({ search: "?reportView=enigma", canSelect: true })).toMatchObject({
      definition: { id: "enigma", owner: "@Enigma-Fund" },
      selectable: true,
      source: "query",
    });
    expect(resolveReportLane({ search: "?reportView=raw", canSelect: true })).toMatchObject({
      definition: { id: "raw", owner: "joint", kind: "evidence" },
      selectable: true,
      source: "query",
    });
  });

  it("restores an owner's last view when the link has no explicit selection", () => {
    expect(resolveReportLane({ search: "?s=fedi", storedLane: "enigma", canSelect: true })).toMatchObject({
      definition: { id: "enigma" },
      source: "stored",
    });
  });

  it("fails closed to Production for unknown selections", () => {
    expect(resolveReportLane({ search: "?reportView=someone-else", storedLane: "unknown", canSelect: true })).toMatchObject({
      definition: { id: "production" },
      source: "default",
    });
  });

  it("keeps all presentations on the same saved-report data contract", () => {
    for (const reportView of ["production", "kyle", "enigma", "raw"] as const) {
      const definition = resolveReportLane({ search: `?reportView=${reportView}`, canSelect: true }).definition;
      expect(definition.dataContract).toBe("shared-saved-report-v1");
      expect(definition.presentationStyle).toBe(2);
      expect(definition.navigation).toBe("sticky");
    }
  });

  it("keeps Raw Evidence distinct from the three editorial interpretations", () => {
    for (const reportView of ["production", "kyle", "enigma"] as const) {
      expect(resolveReportLane({ search: `?reportView=${reportView}`, canSelect: true }).definition.kind).toBe("editorial");
    }
    expect(resolveReportLane({ search: "?reportView=raw", canSelect: true }).definition.kind).toBe("evidence");
  });
});
