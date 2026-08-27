import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  REPORT_VIEW_QUERY_KEY,
  REPORT_VIEW_STORAGE_KEY,
  resolveReportLane,
} from "./resolveReportLane";
import type { ReportLaneId, ResolvedReportLane } from "./reportLaneTypes";

interface ReportLaneContextValue extends ResolvedReportLane {
  selectLane: (id: ReportLaneId) => void;
}

const defaultLane: ReportLaneContextValue = {
  ...resolveReportLane({ search: "" }),
  selectLane: () => undefined,
};
const ReportLaneContext = createContext<ReportLaneContextValue>(defaultLane);

function storedReportLane(): string | null {
  try {
    return window.localStorage.getItem(REPORT_VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function replaceReportView(id: ReportLaneId | null): void {
  const url = new URL(window.location.href);
  if (id && id !== "production") url.searchParams.set(REPORT_VIEW_QUERY_KEY, id);
  else url.searchParams.delete(REPORT_VIEW_QUERY_KEY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function ReportLaneProvider({
  children,
  allowSelection = false,
  manageSelection = false,
}: {
  children: ReactNode;
  allowSelection?: boolean;
  manageSelection?: boolean;
}) {
  const resolveCurrent = useCallback(() => resolveReportLane({
    search: window.location.search,
    storedLane: allowSelection ? storedReportLane() : null,
    canSelect: allowSelection,
  }), [allowSelection]);
  const [lane, setLane] = useState<ResolvedReportLane>(resolveCurrent);

  useEffect(() => {
    if (!manageSelection) return;
    const handlePopState = () => setLane(resolveCurrent());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [manageSelection, resolveCurrent]);

  useEffect(() => {
    if (!manageSelection || allowSelection) return;
    try {
      window.localStorage.removeItem(REPORT_VIEW_STORAGE_KEY);
    } catch {
      // Storage may be disabled. The production fallback still applies.
    }
    replaceReportView(null);
  }, [allowSelection, manageSelection]);

  useEffect(() => {
    if (!manageSelection) return;
    const previousLane = document.documentElement.dataset.reportLane;
    document.documentElement.dataset.reportLane = lane.definition.id;
    return () => {
      if (previousLane) document.documentElement.dataset.reportLane = previousLane;
      else delete document.documentElement.dataset.reportLane;
    };
  }, [lane, manageSelection]);

  const selectLane = useCallback((id: ReportLaneId) => {
    if (!allowSelection) return;
    try {
      window.localStorage.setItem(REPORT_VIEW_STORAGE_KEY, id);
    } catch {
      // A URL selection remains enough when storage is unavailable.
    }
    replaceReportView(id);
    setLane(resolveReportLane({ search: window.location.search, storedLane: id, canSelect: true }));
  }, [allowSelection]);

  const value = useMemo<ReportLaneContextValue>(() => ({ ...lane, selectLane }), [lane, selectLane]);

  return (
    <ReportLaneContext.Provider value={value}>
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

// eslint-disable-next-line react-refresh/only-export-components
export function useReportLane(): ReportLaneContextValue {
  return useContext(ReportLaneContext);
}
