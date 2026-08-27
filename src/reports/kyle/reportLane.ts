import type { ReportLaneDefinition } from "../shared/reportLaneTypes";
import "./report-lane.css";

/**
 * Kyle-owned report presentation.
 *
 * Keep Kyle-specific layout, narrative ordering, and visual experiments in
 * this directory. Evidence collection and scoring stay in the shared engine.
 */
export const kyleReportLane = {
  id: "kyle",
  label: "Kyle Report",
  shortLabel: "Kyle",
  owner: "@kylekmcconnell-arch",
  kind: "editorial",
  description: "Narrative decision memo with a sticky contents bar and separate project and token scores.",
  navigation: "sticky",
  presentationStyle: 2,
  dataContract: "shared-saved-report-v1",
} satisfies ReportLaneDefinition;
