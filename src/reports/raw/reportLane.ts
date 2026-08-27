import type { ReportLaneDefinition } from "../shared/reportLaneTypes";
import "./report-lane.css";

/**
 * A verification lens over the shared saved report. This is deliberately not
 * an editorial lane: it adds no synthesis and owns no facts or scores.
 */
export const rawEvidenceReportLane = {
  id: "raw",
  label: "Raw Evidence",
  shortLabel: "Raw",
  owner: "joint",
  kind: "evidence",
  description: "The frozen evidence, scores, receipts, and methods behind every report presentation.",
  navigation: "sticky",
  presentationStyle: 2,
  dataContract: "shared-saved-report-v1",
} satisfies ReportLaneDefinition;
