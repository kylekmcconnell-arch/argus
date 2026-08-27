import { reportLaneDefinition } from "./reportLaneRegistry";
import type { ReportLaneId, ResolvedReportLane } from "./reportLaneTypes";

export const REPORT_VIEW_QUERY_KEY = "reportView";
export const REPORT_VIEW_STORAGE_KEY = "argus-owner-report-view-v1";

export function normalizedReportLane(value: string | null | undefined): ReportLaneId | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "production" || normalized === "kyle" || normalized === "enigma"
    ? normalized
    : null;
}

export function queryReportLane(search: string | null | undefined): ReportLaneId | null {
  try {
    return normalizedReportLane(new URLSearchParams(search ?? "").get(REPORT_VIEW_QUERY_KEY));
  } catch {
    return null;
  }
}

export function resolveReportLane(input: {
  search?: string;
  storedLane?: string | null;
  canSelect?: boolean;
}): ResolvedReportLane {
  const selectable = input.canSelect === true;
  const requested = selectable ? queryReportLane(input.search) : null;
  const stored = selectable ? normalizedReportLane(input.storedLane) : null;
  const id = requested ?? stored ?? "production";

  return {
    definition: reportLaneDefinition(id),
    selectable,
    source: requested ? "query" : stored ? "stored" : "default",
  };
}
