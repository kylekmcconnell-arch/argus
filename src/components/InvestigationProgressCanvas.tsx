import type { ComponentType } from "react";
import {
  ChartLineUpIcon,
  CrosshairIcon,
  DatabaseIcon,
  FingerprintSimpleIcon,
  GitBranchIcon,
  GlobeSimpleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import type { TraceStep } from "../data/evidence";
import {
  deriveInvestigationProgress,
  type InvestigationProgressKind,
  type InvestigationStageState,
} from "../lib/investigationProgress";
import { ArgusMark, type ArgusEyeMotion } from "./ArgusMark";

type StageIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean }>;

const STAGE_ICONS: Record<string, StageIcon> = {
  subject: FingerprintSimpleIcon,
  resolve: FingerprintSimpleIcon,
  evidence: DatabaseIcon,
  market: ChartLineUpIcon,
  contract: ShieldCheckIcon,
  corroborate: MagnifyingGlassIcon,
  network: GitBranchIcon,
  analysis: MagnifyingGlassIcon,
  finalize: ShieldCheckIcon,
  token: ShieldCheckIcon,
  identity: FingerprintSimpleIcon,
  funding: WalletIcon,
  site: GlobeSimpleIcon,
  people: UsersThreeIcon,
  complete: ShieldCheckIcon,
};

function StageStateIcon({ state, icon: Icon }: { state: InvestigationStageState; icon: StageIcon }) {
  if (state === "active") return <CrosshairIcon size={17} weight="bold" aria-hidden />;
  return <Icon size={17} weight={state === "observed" ? "bold" : "regular"} aria-hidden />;
}

export function InvestigationProgressCanvas({
  kind,
  steps,
  working,
  hop,
}: {
  kind: InvestigationProgressKind;
  steps: TraceStep[];
  working: boolean;
  hop?: string;
}) {
  const progress = deriveInvestigationProgress({ kind, steps, working, hop });
  const latestKey = progress.latestEvent
    ? `${steps.length}:${progress.latestEvent.phase}:${progress.latestEvent.label}`
    : `empty:${kind}:${working}`;
  const activeStage = progress.stages.find((stage) => stage.state === "active")?.key;
  const eyeMotion: ArgusEyeMotion = !working
    ? "idle"
    : activeStage === "finalize" || activeStage === "complete"
      ? "settling"
      : activeStage === "analysis"
        ? "focused"
        : "searching";

  return (
    <section className="panel overflow-hidden" aria-label="Investigation progress">
      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
        <div className="relative border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center">
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-accent-tint ring-1 ring-signal/15">
              <ArgusMark
                size={88}
                live={working}
                motion={eyeMotion}
                eventKey={progress.latestEvent ? latestKey : undefined}
              />
            </div>

            <div className="min-w-0">
              <div className="eyebrow text-signal-lift">Current activity</div>
              <div key={latestKey} className="rise-in mt-1">
                <div className="display-sm text-[19px] text-ink">{progress.currentLabel}</div>
                {progress.latestEvent ? (
                  <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-ink-dim">
                    {progress.latestEvent.detail}
                  </p>
                ) : (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
                    {working
                      ? kind === "resolution"
                        ? "ARGUS is confirming the official name and links before searching sources."
                        : "ARGUS is waiting for the first result."
                      : "No results came back from this check."}
                  </p>
                )}
              </div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line/70 pt-4">
            <div>
              <dt className="stat-label">Updates</dt>
              <dd className="stat-value">{progress.eventCount}</dd>
            </div>
            <div>
              <dt className="stat-label">Sources checked</dt>
              <dd className="stat-value">{progress.observedSources.length}</dd>
            </div>
            <div>
              <dt className="stat-label">Things to review</dt>
              <dd className="stat-value">{progress.attentionCount}</dd>
            </div>
          </dl>

          <div className="mt-4 min-h-6">
            {progress.observedSources.length ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Sources checked">
                {progress.observedSources.slice(0, 6).map((source) => (
                  <span key={source.toLowerCase()} className="chip">{source}</span>
                ))}
                {progress.observedSources.length > 6 && (
                  <span className="chip">+{progress.observedSources.length - 6}</span>
                )}
              </div>
            ) : (
              <span className="mono text-[11px] text-ink-faint">No sources checked yet</span>
            )}
          </div>
        </div>

        <div className="bg-panel-2/35 p-5 sm:p-6">
          <div className="eyebrow">What ARGUS is checking</div>
          <ol className="mt-3 space-y-1.5" aria-label="Check progress">
            {progress.stages.map((stage) => {
              const Icon = STAGE_ICONS[stage.key] ?? DatabaseIcon;
              return (
                <li
                  key={stage.key}
                  className={`flex min-h-10 items-center gap-3 rounded-md px-3 py-2 ${
                    stage.state === "active"
                      ? "tint-signal tint-strong"
                      : stage.state === "observed"
                        ? "text-ink-dim"
                        : "text-ink-faint"
                  }`}
                >
                  <span className={stage.state === "active" ? "motion-safe:animate-pulse text-signal" : ""}>
                    <StageStateIcon state={stage.state} icon={Icon} />
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] font-medium">{stage.label}</span>
                  <span className="mono text-[10px] uppercase tracking-[0.08em]">
                    {stage.state === "active" ? "checking" : stage.state === "observed" ? "done" : "waiting"}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
