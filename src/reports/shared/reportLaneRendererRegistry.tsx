import { kyleReportRenderers } from "../kyle/renderers";
import { rawEvidenceReportRenderers } from "../raw/renderers";
import type { ReportLaneId } from "./reportLaneTypes";
import type { ReportLaneRenderers } from "./reportLaneRendererTypes";

const EMPTY_RENDERERS: ReportLaneRenderers = Object.freeze({});

const REPORT_LANE_RENDERERS: Readonly<Record<ReportLaneId, ReportLaneRenderers>> = Object.freeze({
  production: EMPTY_RENDERERS,
  kyle: kyleReportRenderers,
  enigma: EMPTY_RENDERERS,
  raw: rawEvidenceReportRenderers,
});

export function reportLaneRenderers(id: ReportLaneId): ReportLaneRenderers {
  return REPORT_LANE_RENDERERS[id];
}
