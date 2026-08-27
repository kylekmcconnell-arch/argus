import type { ReportLaneDefinition } from "../shared/reportLaneTypes";
import "./report-lane.css";

/**
 * Public ARGUS report presentation.
 *
 * Promotion into this directory is explicit and jointly reviewed. It never
 * changes the saved evidence, score, or scan behind a report.
 */
export const productionReportLane = {
  id: "production",
  label: "Production Report",
  shortLabel: "Production",
  owner: "joint",
  kind: "editorial",
  description: "The public ARGUS report experience.",
  navigation: "sticky",
  presentationStyle: 2,
  dataContract: "shared-saved-report-v1",
} satisfies ReportLaneDefinition;
