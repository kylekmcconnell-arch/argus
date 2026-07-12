import { useEffect, useRef } from "react";
import { ArgusMark } from "./ArgusMark";
import type { TraceStep } from "../data/evidence";

const TONE: Record<TraceStep["tone"], { dot: string; text: string }> = {
  neutral: { dot: "bg-ink-faint", text: "text-ink-dim" },
  good: { dot: "bg-pass", text: "text-ink" },
  warn: { dot: "bg-caution", text: "text-ink" },
  bad: { dot: "bg-avoid", text: "text-ink" },
};

// Presentational live-audit console. Renders a growing list of trace steps with
// a progress bar. Driven either by a timer (simulated) or by SSE (live).
export function AuditConsole({
  handle,
  subtitle,
  steps,
  pct,
  working,
  mode,
}: {
  handle: string;
  subtitle: string;
  steps: TraceStep[];
  pct: number;
  working: boolean;
  mode: "live" | "curated";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [steps.length]);

  return (
    <div className="relative flex min-h-full items-center justify-center px-6 py-16">
      <div className="grid-bg absolute inset-0 -z-10" />
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <ArgusMark size={34} live />
          <div>
            <div className="mono text-[13.5px] text-ink">
              Auditing <span className="text-signal">{handle}</span>
            </div>
            <div className="text-[12.5px] text-ink-faint">{subtitle}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`chip ${mode === "live" ? "tint-signal" : ""}`}>
              {mode === "live" ? "● LIVE" : "CURATED"}
            </span>
            <span className="mono text-[12.5px] text-ink-faint tabular">{pct}%</span>
          </div>
        </div>

        <div className="mb-5 h-[3px] overflow-hidden rounded-full bg-line">
          <div className="h-full bg-signal" style={{ width: `${pct}%`, transition: "width 0.4s ease" }} />
        </div>

        <div
          ref={scrollRef}
          className="thin-scroll panel relative h-[340px] overflow-y-auto p-4 backdrop-blur"
        >
          <div className="space-y-2.5">
            {steps.map((s, i) => {
              const tone = TONE[s.tone];
              return (
                <div key={i} className="flex gap-3">
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
                working…
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 text-center text-[11px] text-ink-faint">
          API-only acquisition · evidence-disciplined · reproducible
        </div>
      </div>
    </div>
  );
}
