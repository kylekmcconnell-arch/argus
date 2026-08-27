import type { ComponentType } from "react";
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

function estimatedTimeRemaining(
  kind: InvestigationProgressKind,
  stages: Array<{ state: InvestigationStageState }>,
  working: boolean,
): string {
  if (!working) return "Complete";
  const total = Math.max(stages.length, 1);
  const remaining = stages.filter((stage) => stage.state !== "observed").length;
  // Grounded in the documented route envelopes: token scans are about one
  // minute, person scans about two, and full investigations about six. Stage
  // progress narrows the estimate without pretending we know provider latency.
  const baselineMinutes = kind === "investigation" ? 6 : kind === "person" ? 2 : 1;
  const minutes = Math.max(1, Math.ceil(baselineMinutes * (remaining / total)));
  return minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
}

export function InvestigationProgressCanvas({ kind, subject = "the subject", subtitle, steps, working, hop }: {
  kind: InvestigationProgressKind; subject?: string; subtitle?: string; steps: TraceStep[]; working: boolean; hop?: string;
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
  const timeRemaining = estimatedTimeRemaining(kind, progress.stages, working);

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
          <div className="research-eta" aria-label={`Estimated time remaining: ${timeRemaining}`}>
            <span>Estimated time remaining</span>
            <strong>{timeRemaining}</strong>
            {working && <small>Updates as each research stage finishes.</small>}
          </div>
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
