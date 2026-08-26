import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { resolveReportLane } from "./resolveReportLane";
import type { ResolvedReportLane } from "./reportLaneTypes";

const defaultLane = resolveReportLane({ hostname: "", search: "" });
const ReportLaneContext = createContext<ResolvedReportLane>(defaultLane);

export function ReportLaneProvider({ children }: { children: ReactNode }) {
  const lane = useMemo(() => resolveReportLane({
    hostname: window.location.hostname,
    search: window.location.search,
    envLane: import.meta.env.VITE_REPORT_LANE,
    development: import.meta.env.DEV,
  }), []);

  useEffect(() => {
    const previousLane = document.documentElement.dataset.reportLane;
    const previousTitle = document.title;
    document.documentElement.dataset.reportLane = lane.definition.id;
    if (lane.staging) document.title = `${lane.definition.label} | ${previousTitle}`;
    return () => {
      if (previousLane) document.documentElement.dataset.reportLane = previousLane;
      else delete document.documentElement.dataset.reportLane;
      document.title = previousTitle;
    };
  }, [lane]);

  return (
    <ReportLaneContext.Provider value={lane}>
      <div
        className="contents"
        data-report-lane={lane.definition.id}
        data-report-lane-owner={lane.definition.owner}
      >
        {children}
      </div>
    </ReportLaneContext.Provider>
  );
}

export function useReportLane(): ResolvedReportLane {
  return useContext(ReportLaneContext);
}
