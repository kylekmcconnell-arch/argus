export type ReportLaneId = "production" | "kyle" | "enigma";

export type ReportNavigationMode = "sticky" | "guide";

export interface ReportLaneDefinition {
  id: ReportLaneId;
  label: string;
  shortLabel: string;
  owner: "joint" | "@kylekmcconnell-arch" | "@Enigma-Fund";
  description: string;
  navigation: ReportNavigationMode;
  presentationStyle: 1 | 2;
  dataContract: "shared-saved-report-v1";
}

export type ReportLaneSelectionSource = "default" | "query" | "stored";

export interface ResolvedReportLane {
  definition: ReportLaneDefinition;
  selectable: boolean;
  source: ReportLaneSelectionSource;
}
