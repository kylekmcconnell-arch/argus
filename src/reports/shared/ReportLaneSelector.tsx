import { REPORT_LANE_DEFINITIONS, REPORT_LANE_ORDER } from "./reportLaneRegistry";
import { useReportLane } from "./ReportLaneContext";

export function ReportLaneSelector() {
  const lane = useReportLane();
  if (!lane.selectable) return null;

  return (
    <div className="report-view-bar border-b border-line bg-sidebar px-3 py-2 sm:px-5" data-owner-control="report-view">
      <div className="mx-auto flex max-w-[1680px] items-center gap-3 overflow-x-auto">
        <div className="min-w-0">
          <p className="mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">Owner preview</p>
          <p className="hidden truncate text-[11px] text-ink-dim sm:block">One saved report · three interpretations · raw evidence</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-control-line bg-panel p-1" role="group" aria-label="Report view">
          {REPORT_LANE_ORDER.map((id) => {
            const definition = REPORT_LANE_DEFINITIONS[id];
            const active = lane.definition.id === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                title={definition.description}
                onClick={() => lane.selectLane(id)}
                className={`min-h-7 rounded-full px-2.5 text-[11px] font-medium transition sm:px-3 ${active
                  ? "bg-signal text-white shadow-sm"
                  : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}
              >
                {definition.shortLabel}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
