import type { PanelRequestFailure } from "../lib/panelCostHeaders";

export function PanelRequestNotice({ failure, label = "Supplemental intelligence", className = "" }: {
  failure: PanelRequestFailure;
  label?: string;
  className?: string;
}) {
  const rescan = failure === "rescan_required";
  return (
    <div
      role="alert"
      className={`${className} rounded-xl border px-4 py-3 ${rescan ? "border-caution/40 bg-caution/5" : "border-line bg-panel"}`}
    >
      <div className={`text-[10.5px] uppercase tracking-wider ${rescan ? "text-caution" : "text-ink-faint"}`}>
        {rescan ? "Rescan required" : `${label} unavailable`}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
        {rescan
          ? `The saved report context for ${label.toLowerCase()} expired. Run a fresh scan before treating this check as complete.`
          : `${label} could not be checked. No clean or negative finding was inferred.`}
      </p>
    </div>
  );
}
