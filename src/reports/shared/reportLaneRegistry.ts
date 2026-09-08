import { productionReportLane } from "../production/reportLane";
import type { ReportLaneDefinition, ReportLaneId } from "./reportLaneTypes";

export const REPORT_LANE_ORDER = ["production", "developer"] as const satisfies readonly ReportLaneId[];

export const REPORT_LANE_DEFINITIONS: Readonly<Record<ReportLaneId, ReportLaneDefinition<ReportLaneId>>> = Object.freeze({
  production: productionReportLane,
  developer: {
    ...productionReportLane,
    id: "developer",
    label: "Developer Report",
    shortLabel: "Developer",
    description: "The same production report with expandable saved evidence and verification tools.",
  },
});

export function reportLaneDefinition(id: ReportLaneId): ReportLaneDefinition<ReportLaneId> {
  return REPORT_LANE_DEFINITIONS[id];
}
