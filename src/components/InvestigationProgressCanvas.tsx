import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ChartLineUpIcon, CheckCircleIcon, CrosshairIcon, DatabaseIcon,
  FingerprintSimpleIcon, GitBranchIcon, GlobeSimpleIcon, MagnifyingGlassIcon,
  ShieldCheckIcon, UsersThreeIcon, WalletIcon,
} from "@phosphor-icons/react";
import type { TraceStep } from "../data/evidence";
import { deriveInvestigationProgress, type InvestigationProgressKind, type InvestigationStageState } from "../lib/investigationProgress";
import { ArgusMark, type ArgusEyeMotion } from "./ArgusMark";

type StageIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean }>;
const STAGE_ICONS: Record<string, StageIcon> = {
  subject: FingerprintSimpleIcon, resolve: FingerprintSimpleIcon, evidence: DatabaseIcon,
  market: ChartLineUpIcon, contract: ShieldCheckIcon, corroborate: MagnifyingGlassIcon,
  network: GitBranchIcon, analysis: MagnifyingGlassIcon, finalize: ShieldCheckIcon,
  token: ShieldCheckIcon, identity: FingerprintSimpleIcon, funding: WalletIcon,
  site: GlobeSimpleIcon, people: UsersThreeIcon, complete: ShieldCheckIcon,
};

function StageStateIcon({ state, icon: Icon }: { state: InvestigationStageState; icon: StageIcon }) {
  if (state === "active") return <CrosshairIcon size={18} weight="bold" aria-hidden />;
  if (state === "observed") return <CheckCircleIcon size={18} weight="fill" aria-hidden />;
  return <Icon size={18} weight="regular" aria-hidden />;
}

const BASELINE_SECONDS: Record<InvestigationProgressKind, number> = {
  resolution: 45,
  token: 90,
  person: 240,
  investigation: 360,
};

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatRemaining(seconds: number): string {
  if (seconds < 45) return "less than a minute";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
}

function estimateTimeRemainingSeconds(
  kind: InvestigationProgressKind,
  stages: Array<{ state: InvestigationStageState }>,
  working: boolean,
): number {
  if (!working) return 0;
  const total = Math.max(stages.length, 1);
  const remaining = stages.reduce((sum, stage) => sum + (stage.state === "observed" ? 0 : stage.state === "active" ? 0.55 : 1), 0);
  // These are deliberately broad route envelopes, not fake precision. Live
  // provider latency can move the clock; stage completion steadily narrows it.
  return Math.max(25, BASELINE_SECONDS[kind] * (remaining / total));
}

function completionClock(now: number, remainingSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(now + remainingSeconds * 1_000));
}

function ScanClock({ kind, stages, working, startedAt }: {
  kind: InvestigationProgressKind;
  stages: Array<{ state: InvestigationStageState }>;
  working: boolean;
  startedAt?: number;
}) {
  const mountedAtRef = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [working]);
  const effectiveStartedAt = startedAt && Number.isFinite(startedAt) ? startedAt : mountedAtRef.current;
  const elapsed = Math.max(0, (now - effectiveStartedAt) / 1_000);
  const remainingSeconds = estimateTimeRemainingSeconds(kind, stages, working);
  const timeRemaining = working ? formatRemaining(remainingSeconds) : "Complete";
  const estimatedCompletion = working ? completionClock(now, remainingSeconds) : "Finished";
  return (
    <div className="research-eta" aria-label={`Elapsed ${formatDuration(elapsed)}. Estimated time remaining: ${timeRemaining}. Estimated completion: ${estimatedCompletion}.`}>
      <div><span>Elapsed</span><strong className="tabular-nums">{formatDuration(elapsed)}</strong></div>
      <div><span>Time remaining</span><strong>{timeRemaining}</strong></div>
      <div><span>Estimated completion</span><strong>{estimatedCompletion}</strong></div>
      {working && <small>Live estimate · updates as each research stage finishes. Provider response times can move the clock.</small>}
    </div>
  );
}

export function InvestigationProgressCanvas({ kind, subject = "the subject", subtitle, steps, working, hop, startedAt }: {
  kind: InvestigationProgressKind; subject?: string; subtitle?: string; steps: TraceStep[]; working: boolean; hop?: string; startedAt?: number;
}) {
  const progress = deriveInvestigationProgress({ kind, steps, working, hop });
  const latestKey = progress.latestEvent
    ? `${steps.length}:${progress.latestEvent.phase}:${progress.latestEvent.label}`
    : `empty:${kind}:${working}`;
  const activeStage = progress.stages.find((stage) => stage.state === "active")?.key;
  const eyeMotion: ArgusEyeMotion = !working ? "idle"
    : activeStage === "finalize" || activeStage === "complete" ? "settling"
      : activeStage === "analysis" ? "focused" : "searching";
  const headline = kind === "resolution" ? `Finding the right match for ${subject}` : `Building the case on ${subject}`;

  return (
    <section className="research-command-deck" aria-label="Investigation progress">
      <div className="research-command-main">
        <div>
          <div className="research-live-label">
            <span className={working ? "research-live-dot motion-safe:animate-pulse" : "research-live-dot is-idle"} />
            {kind === "resolution" ? "SUBJECT RESOLUTION" : working ? "LIVE RESEARCH" : "RESEARCH COMPLETE"}
          </div>
          <h1 className="research-command-title">{headline}</h1>
          {subtitle && <p className="research-command-subtitle">{subtitle}</p>}
          <ScanClock kind={kind} stages={progress.stages} working={working} startedAt={startedAt} />
        </div>

        <div className="research-observation">
          <div className="research-eye-stage" aria-hidden="true">
            <ArgusMark
              size={148}
              live={working}
              motion={eyeMotion}
              eventKey={progress.latestEvent ? latestKey : undefined}
              tone={working ? "brand" : "neutral"}
            />
          </div>
          <div key={latestKey} className="rise-in min-w-0">
            <div className="eyebrow text-signal-lift">Latest observed evidence</div>
            <div className="research-observation-title">{progress.currentLabel}</div>
            <p className="research-observation-detail">
              {progress.latestEvent?.detail ?? (working
                ? kind === "resolution"
                  ? "ARGUS is confirming the official name and links before searching sources."
                  : "ARGUS is waiting for the first result."
                : "No results came back from this check.")}
            </p>
            {progress.latestEvent?.source && <div className="research-observation-source">Source · {progress.latestEvent.source}</div>}
          </div>
        </div>

        <div className="research-command-footer">
          <span>{kind === "resolution" ? "Subject resolution" : "Live source search"}</span>
          <span className="research-background-note">You can leave. This scan continues in the background.</span>
        </div>
      </div>

      <aside className="research-stage-rail">
        <div className="eyebrow">Research sequence</div>
        <ol className="research-stage-list" aria-label="Check progress">
          {progress.stages.map((stage, index) => {
            const Icon = STAGE_ICONS[stage.key] ?? DatabaseIcon;
            return (
              <li key={stage.key} className={`research-stage-item is-${stage.state}`}>
                <span className="research-stage-order">{String(index + 1).padStart(2, "0")}</span>
                <span className="research-stage-icon"><StageStateIcon state={stage.state} icon={Icon} /></span>
                <span className="research-stage-label">{stage.label}</span>
                <span className="research-stage-state">{stage.state === "active" ? "checking" : stage.state === "observed" ? "done" : "waiting"}</span>
              </li>
            );
          })}
        </ol>

        <dl className="research-proof-stats">
          <div><dt>Observed events</dt><dd>{progress.eventCount}</dd></div>
          <div><dt>Sources checked</dt><dd>{progress.observedSources.length}</dd></div>
          <div><dt>Review flags</dt><dd>{progress.attentionCount}</dd></div>
        </dl>
        <div className="research-sources" aria-label="Sources checked">
          {progress.observedSources.length ? progress.observedSources.slice(0, 6).map((source) => (
            <span key={source.toLowerCase()} className="chip">{source}</span>
          )) : <span className="mono text-[10px] text-ink-faint">No sources checked yet</span>}
          {progress.observedSources.length > 6 && <span className="chip">+{progress.observedSources.length - 6}</span>}
        </div>
      </aside>
    </section>
  );
}
