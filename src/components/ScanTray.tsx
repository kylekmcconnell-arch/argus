import { useEffect, useRef, useState } from "react";
import { activeRuns, getRun, subscribeRuns, type BgRun } from "../lib/runner";
import { activeScanRuns, getScanRun, subscribeScanRuns, type ScanRun } from "../lib/scanrunner";
import { AuditConsole } from "./AuditConsole";

// The background-task tray: deep-dive scans launched from a report never
// replace the report. Each runs as a collapsible, sticky item at the bottom of
// the screen with a progress bar; a finished task flips solid green with an
// Open button; expanding a running task fills the window with its live console
// under a sticky "Go back to the <report>" bar, and collapsing swaps them
// back. The runners already own every stream at module scope, so this tray is
// a pure subscriber: closing or collapsing it never touches a scan.

interface TrayTask {
  id: string;
  kind: "person" | "token" | "investigation";
  ref: string;
  label: string;
  status: "running" | "done" | "error";
  steps: BgRun["steps"];
  pct: number;
  hop?: string;
  startedAt: number;
  error?: string;
}

const taskFromPersonRun = (run: BgRun): TrayTask => ({
  id: `person:${run.key}`,
  kind: "person",
  ref: run.handle,
  label: run.handle,
  status: run.status,
  steps: run.steps,
  pct: run.status === "done" ? 100 : run.pct,
  startedAt: run.startedAt,
  error: run.error,
});

const taskFromScanRun = (run: ScanRun): TrayTask => ({
  id: `${run.kind}:${run.ref}`,
  kind: run.kind,
  ref: run.canonicalRef ?? run.ref,
  label: run.label,
  status: run.status,
  steps: run.steps,
  pct: run.status === "done" ? 100 : run.pct,
  hop: run.hop,
  startedAt: run.startedAt,
  error: run.error,
});

export function ScanTray({
  parentLabel,
  excludeRef,
  onOpen,
}: {
  /** What the reader returns to when collapsing an expanded task. */
  parentLabel: string;
  /** The currently open report's own ref; its own rescan never shows as a tray task. */
  excludeRef?: string;
  onOpen: (ref: string, kind: "person" | "token" | "investigation") => void;
}) {
  const [, setTick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Tasks stay visible after they leave the active registries so "done" can
  // flip green with its Open button instead of vanishing.
  const seenRef = useRef(new Map<string, TrayTask>());

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const unsubscribeRuns = subscribeRuns(refresh);
    const unsubscribeScans = subscribeScanRuns(refresh);
    return () => { unsubscribeRuns(); unsubscribeScans(); };
  }, []);

  const computeTasks = () => {
    const seen = seenRef.current;
    for (const run of activeRuns()) seen.set(`person:${run.key}`, taskFromPersonRun(run));
    for (const run of activeScanRuns()) seen.set(`${run.kind}:${run.ref}`, taskFromScanRun(run));
    // Refresh every remembered task from its registry so terminal states land.
    for (const [id, task] of seen) {
      if (task.kind === "person") {
        const run = getRun(task.ref);
        if (run) seen.set(id, taskFromPersonRun(run));
      } else {
        const run = getScanRun(task.kind, task.ref) ?? getScanRun(task.kind, task.ref, true);
        if (run && !run.priv) seen.set(id, taskFromScanRun(run));
      }
    }
    const exclude = (excludeRef ?? "").trim().toLowerCase().replace(/^@/, "");
    return [...seen.values()]
      .filter((task) => !dismissed.has(task.id))
      .filter((task) => !exclude || task.ref.trim().toLowerCase().replace(/^@/, "") !== exclude)
      .sort((left, right) => right.startedAt - left.startedAt);
  };
  // Recomputed every render: the registries emit on each step, setTick
  // re-renders, and the snapshot is a few map reads.
  const tasks = computeTasks();

  if (!tasks.length) return null;
  const running = tasks.filter((task) => task.status === "running");
  const expanded = expandedId ? tasks.find((task) => task.id === expandedId) : null;

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[70] overflow-y-auto bg-paper" data-testid="scan-tray-expanded">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line/70 bg-paper/95 px-4 py-2 backdrop-blur">
          <button
            type="button"
            className="btn-chip text-[12px] font-medium"
            onClick={() => setExpandedId(null)}
          >
            ← Go back to the {parentLabel} report
          </button>
          <span className="min-w-0 truncate text-[12.5px] text-ink-dim">
            {expanded.label} · {expanded.status === "running" ? (expanded.hop ?? expanded.steps.at(-1)?.label ?? "working") : expanded.status}
          </span>
        </div>
        <div className="mx-auto max-w-4xl px-4 py-4">
          <AuditConsole
            handle={expanded.label}
            subtitle={expanded.kind === "person" ? "Live audit" : expanded.kind === "token" ? "Token scan" : "Deep investigation"}
            steps={expanded.steps}
            working={expanded.status === "running"}
            mode="live"
            kind={expanded.kind === "person" ? "person" : expanded.kind}
            hop={expanded.hop}
            startedAt={expanded.startedAt}
          />
          {expanded.status === "done" && (
            <button type="button" className="btn-secondary mt-4 min-h-10 px-4 text-[13px]" onClick={() => onOpen(expanded.ref, expanded.kind)}>
              Open the finished report
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3" data-testid="scan-tray">
      <div className="mx-auto max-w-3xl rounded-xl border border-line/70 bg-paper/95 shadow-lg backdrop-blur">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-2 text-left"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="text-[12.5px] font-medium text-ink">
            Background scans ({tasks.length})
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">
            {running.length
              ? `${running[0].label} · ${running[0].hop ?? running[0].steps.at(-1)?.label ?? "working"}`
              : "All finished"}
          </span>
          <span className="text-[12px] text-ink-faint">{collapsed ? "▲" : "▼"}</span>
        </button>
        {!collapsed && (
          <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto border-t border-line/60">
            {tasks.map((task) => (
              <li key={task.id} className="px-4 py-2.5" data-testid="scan-tray-item">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{task.label}</span>
                  <span className="chip text-[10px] uppercase">{task.kind}</span>
                  {task.status === "running" && (
                    <button type="button" className="btn-chip text-[11px]" onClick={() => setExpandedId(task.id)}>Watch</button>
                  )}
                  {task.status === "done" && (
                    <button type="button" className="btn-chip tint-pass text-[11px] font-medium" onClick={() => onOpen(task.ref, task.kind)}>Open report</button>
                  )}
                  {task.status !== "running" && (
                    <button
                      type="button"
                      className="text-[11px] text-ink-faint underline-offset-2 hover:underline"
                      onClick={() => setDismissed((current) => new Set(current).add(task.id))}
                    >
                      dismiss
                    </button>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-line/50" role="progressbar" aria-valuenow={task.status === "done" ? 100 : task.pct} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={`h-full transition-all ${task.status === "done" ? "bg-pass" : task.status === "error" ? "bg-avoid" : "bg-signal-lift"}`}
                    style={{ width: `${task.status === "done" ? 100 : Math.max(6, task.pct)}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-ink-dim">
                  {task.status === "running" && (task.hop ?? task.steps.at(-1)?.label ?? "Preparing evidence acquisition")}
                  {task.status === "done" && "Finished. The report is ready to open."}
                  {task.status === "error" && (task.error ?? "The scan did not finish.")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
