import { describe, expect, it } from "vitest";
import { kyleReportRenderers } from "../kyle/renderers";
import { reportLaneRenderers } from "../shared/reportLaneRendererRegistry";
import { productionReportRenderers } from "./renderers";

describe("production report lane promotion", () => {
  it("serves every Kyle presentation slot as the public report", () => {
    const slots = Object.keys(kyleReportRenderers) as (keyof typeof kyleReportRenderers)[];
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(productionReportRenderers[slot]).toBe(kyleReportRenderers[slot]);
    }
    expect(reportLaneRenderers("production")).toBe(productionReportRenderers);
  });
});
