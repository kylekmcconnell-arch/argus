import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Atom,
  BookOpen,
  CheckCircle,
  Circle,
  Eye,
  MagnifyingGlass,
  Pulse,
  ShieldCheck,
  Stack,
} from "@phosphor-icons/react";
import type { TraceStep } from "../data/evidence";
import type { InvestigationProgressKind } from "../lib/investigationProgress";
import { publicPhaseLabel } from "../lib/plainLanguage";
import { InvestigationProgressCanvas } from "./InvestigationProgressCanvas";

const TONE: Record<TraceStep["tone"], { dot: string; label: string; className: string }> = {
  neutral: { dot: "bg-derived", label: "observed", className: "" },
  good: { dot: "bg-pass", label: "confirmed", className: "is-confirmed" },
  warn: { dot: "bg-caution", label: "review", className: "is-review" },
  bad: { dot: "bg-avoid", label: "attention", className: "is-attention" },
};
const STICKY_BOTTOM_PX = 40;
const gapFromBottom = (node: HTMLElement) => node.scrollHeight - node.scrollTop - node.clientHeight;
function scrollToLatest(node: HTMLElement): void {
  const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
}

function formatElapsed(totalMilliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMilliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sourceIcon(step: TraceStep): ReactNode {
  const value = `${step.source ?? ""} ${step.phase} ${step.label}`.toLowerCase();
  if (/burn|supply|token/.test(value)) return <Atom size={22} weight="duotone" aria-hidden="true" />;
  if (/code|contract|function/.test(value)) return <Stack size={22} weight="duotone" aria-hidden="true" />;
  if (/knowledge|fact|reuse/.test(value)) return <BookOpen size={22} weight="duotone" aria-hidden="true" />;
  if (/verdict|score|safe|risk/.test(value)) return <ShieldCheck size={22} weight="duotone" aria-hidden="true" />;
  return <MagnifyingGlass size={22} weight="duotone" aria-hidden="true" />;
}

export function AuditConsole({ handle, subtitle, steps, working, mode, kind = "person", hop, startedAt }: {
  handle: string; subtitle: string; steps: TraceStep[]; working: boolean; mode: "live" | "curated";
  kind?: InvestigationProgressKind; hop?: string; startedAt?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastGapRef = useRef(0);
  const [missedLines, setMissedLines] = useState(false);
  const mountedAtRef = useRef(Date.now());
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [working]);

  useEffect(() => {
    const node = scrollRef.current;
    if (steps.length === 0) {
      pinnedRef.current = true;
      lastGapRef.current = 0;
      // A zero-length trace marks a new scan generation; clear the prior
      // reader affordance at the same boundary as the refs it represents.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMissedLines(false);
      return;
    }
    if (!node || typeof node.scrollTo !== "function") return;
    lastGapRef.current = gapFromBottom(node);
    if (!pinnedRef.current) {
      setMissedLines(true);
      return;
    }
    scrollToLatest(node);
  }, [steps.length]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const gap = gapFromBottom(node);
    const closingGap = gap < lastGapRef.current;
    lastGapRef.current = gap;
    if (closingGap && gap > STICKY_BOTTOM_PX) return;
    pinnedRef.current = gap <= STICKY_BOTTOM_PX;
    if (pinnedRef.current) setMissedLines(false);
  };
  const jumpToLatest = () => {
    const node = scrollRef.current;
    if (!node || typeof node.scrollTo !== "function") return;
    pinnedRef.current = true;
    lastGapRef.current = gapFromBottom(node);
    setMissedLines(false);
    scrollToLatest(node);
  };

  const latest = steps.at(-1) ?? null;
  const effectiveStartedAt = startedAt && Number.isFinite(startedAt) ? startedAt : mountedAtRef.current;
  const elapsed = formatElapsed(clock - effectiveStartedAt);
  const liveAnnouncement = latest ? `${publicPhaseLabel(latest.phase)}: ${latest.label}. ${latest.detail}`
    : kind === "resolution" ? "Finding the right project or person."
      : working ? "Waiting for the first result." : "No results came back.";

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
      <div className="research-workspace" role="status" aria-live="off" aria-busy={working}>
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="research-workspace-inner">
          <InvestigationProgressCanvas kind={kind} subject={handle} subtitle={subtitle} steps={steps} working={working} hop={hop} startedAt={startedAt} />

          <section className="research-ledger" aria-labelledby="research-ledger-title">
            <div className="research-ledger-header">
              <div className="research-ledger-heading">
                <div><div className="eyebrow">Evidence ledger</div><h2 id="research-ledger-title" className="display-sm mt-1 text-[20px] text-ink">What ARGUS is finding</h2></div>
                {mode === "live" && <div className="research-ledger-live"><Circle size={8} weight="fill" aria-hidden="true" />LIVE <time>{elapsed}</time><small>elapsed</small></div>}
              </div>
              <span className={`research-ledger-check ${mode === "live" ? "is-live" : ""}`}>
                {kind === "resolution" ? "Finding the right match" : mode === "live" ? "Live check" : "Saved check"}
                {mode === "live" && <Pulse size={20} weight="bold" aria-hidden="true" />}
              </span>
            </div>
            <div className="research-ledger-columns" aria-hidden="true"><span>Run</span><span>Source</span><span>Execution trace</span><span>Finding</span><span>Status</span></div>

            <div className="relative">
              <div ref={scrollRef} onScroll={handleScroll} className={`thin-scroll research-ledger-scroll ${kind === "resolution" ? "is-resolution" : ""}`} aria-label="Live check updates">
                {steps.map((step, index) => {
                  const tone = TONE[step.tone];
                  return (
                    <article key={index} data-tone={step.tone} className={`research-ledger-row ${index === steps.length - 1 ? "rise-in is-current" : ""}`}>
                      <div className="research-ledger-order"><span className={`research-ledger-dot ${tone.dot}`} />{String(index + 1).padStart(2, "0")}</div>
                      <div className="research-ledger-source"><span>{sourceIcon(step)}</span><span>{step.source || publicPhaseLabel(step.phase)}</span></div>
                      <div className="research-ledger-trace"><Pulse size={116} weight="regular" aria-hidden="true" /></div>
                      <div className="min-w-0"><h3>{step.label}</h3><p>{step.detail}</p></div>
                      <div><span className={`research-ledger-status ${tone.className}`}>{tone.label}{tone.label === "confirmed" ? <CheckCircle size={17} weight="bold" aria-hidden="true" /> : <Eye size={17} weight="bold" aria-hidden="true" />}</span></div>
                    </article>
                  );
                })}
                {working && (
                  <div className="research-ledger-working">
                    <span className="relative flex h-3 w-12 overflow-hidden rounded-full bg-line" aria-hidden="true"><span className="scan-line sweep absolute inset-y-0 w-1/2" /></span>
                    {kind === "resolution" ? "Confirming the official name and links before searching sources…"
                      : steps.length ? "Waiting for the next observed result…" : "Waiting for the first result…"}
                  </div>
                )}
              </div>
              {missedLines && <button type="button" onClick={jumpToLatest} className="btn-chip tint-signal absolute bottom-3 left-1/2 -translate-x-1/2 bg-panel/95 backdrop-blur">jump to latest ↓</button>}
            </div>
            <div className="research-ledger-footer">
              {kind === "resolution" ? "Checking the official name and links · source search has not started"
                : "Each row is an observed result. Sources remain attached to the final report."}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
