export type ReportLaneId = "production" | "developer";

/** Retired definitions remain source history, never selectable views. */
type LegacyReportLaneId = "kyle" | "enigma" | "raw";

export type ReportNavigationMode = "sticky" | "guide";

export interface ReportLaneDefinition<Id extends string = ReportLaneId | LegacyReportLaneId> {
  id: Id;
  label: string;
  shortLabel: string;
  owner: "joint" | "@kylekmcconnell-arch" | "@Enigma-Fund";
  kind: "editorial" | "evidence";
  description: string;
  navigation: ReportNavigationMode;
  presentationStyle: 1 | 2;
  dataContract: "shared-saved-report-v1";
}

export type ReportLaneSelectionSource = "default" | "query" | "stored";

export interface ResolvedReportLane {
  definition: ReportLaneDefinition<ReportLaneId>;
  selectable: boolean;
  source: ReportLaneSelectionSource;
}
