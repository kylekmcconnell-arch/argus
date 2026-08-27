import type { ReportLaneDefinition } from "../shared/reportLaneTypes";
import "./report-lane.css";

/**
 * Enigma-owned report presentation.
 *
 * Enigma can change this definition and the adjacent stylesheet without
 * touching Kyle's report. Shared evidence and score semantics are immutable
 * inputs to both report lanes.
 */
export const enigmaReportLane = {
  id: "enigma",
  label: "Enigma Report",
  owner: "@Enigma-Fund",
  description: "Narrative decision memo with a sticky contents bar and separate project and token scores.",
  navigation: "sticky",
  presentationStyle: 2,
} satisfies ReportLaneDefinition;
