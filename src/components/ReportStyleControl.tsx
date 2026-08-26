import { useCallback, useState } from "react";
import { reportStyleFromSearch, searchForReportStyle, type ReportStyle } from "../lib/reportStyle";

export function useReportStyle(): readonly [ReportStyle, (style: ReportStyle) => void] {
  const [style, setStyle] = useState<ReportStyle>(() => {
    if (typeof window === "undefined") return 2;
    return reportStyleFromSearch(window.location.search);
  });
  const choose = useCallback((next: ReportStyle) => {
    setStyle(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.search = searchForReportStyle(url.search, next);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return [style, choose] as const;
}

export function ReportStyleControl({
  style,
  onChange,
  compact = false,
}: {
  style: ReportStyle;
  onChange: (style: ReportStyle) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={compact
        ? "grid grid-cols-2 gap-1 rounded-lg border border-line bg-panel p-1"
        : "ml-1 flex min-h-9 shrink-0 items-center rounded-full border border-line bg-panel p-0.5"}
      aria-label="Report style"
    >
      {([1, 2] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={style === option}
          onClick={() => onChange(option)}
          className={compact
            ? `min-h-10 rounded-md text-[12px] font-semibold transition ${style === option ? "bg-ink text-void" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`
            : `min-h-8 rounded-full px-3 text-[11.5px] font-semibold transition ${style === option ? "bg-ink text-void" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}
        >
          Style {option}
        </button>
      ))}
    </div>
  );
}
