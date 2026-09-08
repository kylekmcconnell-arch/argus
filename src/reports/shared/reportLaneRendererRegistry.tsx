import { kyleReportRenderers } from "../kyle/renderers";
import { productionReportRenderers } from "../production/renderers";
import { rawEvidenceReportRenderers } from "../raw/renderers";
import type { ReportLaneId } from "./reportLaneTypes";
import type { ReportLaneRenderers } from "./reportLaneRendererTypes";

const REPORT_LANE_RENDERERS: Readonly<Record<ReportLaneId, ReportLaneRenderers>> = Object.freeze({
  production: productionReportRenderers,
  kyle: kyleReportRenderers,
  // All editorial lanes currently share the promoted presentation.
  enigma: productionReportRenderers,
  raw: rawEvidenceReportRenderers,
});

export function reportLaneRenderers(id: ReportLaneId): ReportLaneRenderers {
  return REPORT_LANE_RENDERERS[id];
}
