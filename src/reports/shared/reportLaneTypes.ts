export type ReportLaneId = "kyle" | "enigma";

export type ReportNavigationMode = "sticky" | "guide";

export interface ReportLaneDefinition {
  id: ReportLaneId;
  label: string;
  owner: "@kylekmcconnell-arch" | "@Enigma-Fund";
  description: string;
  navigation: ReportNavigationMode;
  presentationStyle: 1 | 2;
}

export interface ResolvedReportLane {
  definition: ReportLaneDefinition;
  staging: boolean;
}
