import { useEffect, useRef } from "react";
import type { TraceStep } from "../data/evidence";
import type { InvestigationProgressKind } from "../lib/investigationProgress";
import { InvestigationProgressCanvas } from "./InvestigationProgressCanvas";

const TONE: Record<TraceStep["tone"], { dot: string; text: string }> = {
  neutral: { dot: "bg-ink-faint", text: "text-ink-dim" },
  good: { dot: "bg-pass", text: "text-ink" },
  warn: { dot: "bg-caution", text: "text-ink" },
  bad: { dot: "bg-avoid", text: "text-ink" },
};

// Presentational live-audit console. Every visible metric is derived from an
// observed trace event; it never treats configured providers as completed work.
export function AuditConsole({
  handle,
  subtitle,
  steps,
  working,
  mode,
  kind = "person",
  hop,
}: {
  handle: string;
  subtitle: string;
  steps: TraceStep[];
  working: boolean;
  mode: "live" | "curated";
  kind?: InvestigationProgressKind;
  hop?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof node.scrollTo !== "function" || steps.length === 0) return;
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [steps.length]);

  const latest = steps.at(-1) ?? null;
  const liveAnnouncement = latest
    ? `${latest.phase}: ${latest.label}. ${latest.detail}`
    : kind === "resolution"
      ? "Resolving the exact subject."
      : working
        ? "Waiting for the first evidence event."
        : "No evidence events were observed.";

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
      <div
        className="relative flex min-h-full items-center justify-center px-4 py-10 sm:px-6 sm:py-14"
        role="status"
        aria-live="off"
        aria-busy={working}
      >
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="w-full max-w-5xl">
          <div className="mb-5 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mono text-[13.5px] text-ink">
                {kind === "resolution" ? "Resolving" : "Auditing"}{" "}
                <span className="text-signal-lift">{handle}</span>
              </div>
              <div className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">{subtitle}</div>
            </div>
            <span className={`chip ${mode === "live" ? "tint-signal" : ""}`}>
              {kind === "resolution" ? "Subject resolution" : mode === "live" ? "Live run" : "Curated run"}
            </span>
          </div>

          <InvestigationProgressCanvas kind={kind} steps={steps} working={working} hop={hop} />

          <div
            ref={scrollRef}
            className={`thin-scroll panel relative mt-4 overflow-y-auto p-4 backdrop-blur sm:p-5 ${
              kind === "resolution" ? "h-[170px] sm:h-[190px]" : "h-[310px] sm:h-[340px]"
            }`}
            aria-label="Live evidence ledger"
          >
            <div className="eyebrow mb-3">Evidence ledger</div>
            <div className="space-y-2.5">
              {steps.map((s, i) => {
                const tone = TONE[s.tone];
                return (
                  <div key={i} className={`flex gap-3 ${i === steps.length - 1 ? "rise-in" : ""}`}>
                    <div className="flex flex-col items-center pt-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                    </div>
                    <div className="pb-1">
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] uppercase tracking-wider text-ink-faint">{s.phase}</span>
                        {s.source && (
                          <span className="chip">{s.source}</span>
                        )}
                      </div>
                      <div className={`text-[13.5px] font-medium ${tone.text}`}>{s.label}</div>
                      <div className="text-[12.5px] leading-snug text-ink-dim">{s.detail}</div>
                    </div>
                  </div>
                );
              })}

              {working && (
                <div className="flex items-center gap-2 pl-[3px] pt-1 text-[12.5px] text-ink-faint">
                  <span className="relative flex h-3 w-12 overflow-hidden rounded-full bg-line">
                    <span className="scan-line sweep absolute inset-y-0 w-1/2" />
                  </span>
                  {kind === "resolution"
                    ? "Resolving canonical identity before evidence acquisition…"
                    : steps.length
                      ? "Waiting for the next evidence event…"
                      : "Waiting for the first evidence event…"}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 text-center text-[11px] text-ink-faint">
            {kind === "resolution"
              ? "Canonical identity resolution · provider acquisition has not started"
              : "API-only acquisition · evidence-disciplined · reproducible"}
          </div>
        </div>
      </div>
    </>
  );
}
