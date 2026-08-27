import { enigmaReportLane } from "../enigma/reportLane";
import { kyleReportLane } from "../kyle/reportLane";
import { productionReportLane } from "../production/reportLane";
import { rawEvidenceReportLane } from "../raw/reportLane";
import type { ReportLaneDefinition, ReportLaneId } from "./reportLaneTypes";

export const REPORT_LANE_ORDER = ["production", "kyle", "enigma", "raw"] as const satisfies readonly ReportLaneId[];

export const REPORT_LANE_DEFINITIONS: Readonly<Record<ReportLaneId, ReportLaneDefinition>> = Object.freeze({
  production: productionReportLane,
  kyle: kyleReportLane,
  enigma: enigmaReportLane,
  raw: rawEvidenceReportLane,
});

export function reportLaneDefinition(id: ReportLaneId): ReportLaneDefinition {
  return REPORT_LANE_DEFINITIONS[id];
}
