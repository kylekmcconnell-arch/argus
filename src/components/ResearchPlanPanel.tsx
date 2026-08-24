import { ArrowRight, CheckCircle, GitBranch, WarningCircle } from "@phosphor-icons/react";
import type { ResearchPlan, ResearchTask } from "../lib/researchDirector";

const stateTone: Record<ResearchTask["state"], string> = {
  planned: "tint-signal",
  completed: "tint-pass",
  partial: "tint-caution",
  unavailable: "tint-avoid",
  skipped: "",
};

const intentLabel: Record<ResearchPlan["intent"], string> = {
  investment_due_diligence: "investment review",
  counterparty_risk: "counterparty review",
  alpha_discovery: "market opportunity review",
  identity_and_control: "identity and control review",
};

const INTERNAL_CAPABILITIES = new Set<ResearchTask["capability"]>([
  "role_resolution",
  "analyst_synthesis",
]);

function needsEvidence(task: ResearchTask): boolean {
  return task.state === "planned" || task.state === "partial" || task.state === "unavailable";
}

function publicTaskNote(task: ResearchTask): string {
  if (task.state === "completed") return "ARGUS recorded enough evidence to answer this part of the review.";
  if (task.state === "partial") return "Some evidence was found, but the answer is not complete.";
  if (task.state === "unavailable") return "ARGUS could not verify this from the evidence saved with the report.";
  if (task.state === "planned") return "This still needs to be investigated.";
  return "This was not required for the resolved subject.";
}

export function ResearchPlanPanel({ plan, className = "" }: { plan: ResearchPlan; className?: string }) {
  const publicTasks = plan.tasks.filter((task) => !INTERNAL_CAPABILITIES.has(task.capability) && task.state !== "skipped");
  const coveredTasks = publicTasks.filter((task) => task.state === "completed");
  const openTasks = publicTasks.filter(needsEvidence).sort((a, b) => a.rank - b.rank);
  const nextAction = (plan.nextActions ?? []).find((action) => openTasks.some((task) => task.id === action.taskId));
  const materialGaps = openTasks.slice(0, 3);

  return (
    <section id="research-plan" aria-label="Research coverage" className={`panel overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal-soft text-signal-lift">
          <GitBranch size={17} weight="duotone" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Research coverage</p>
          <h3 className="mt-0.5 text-[15px] font-semibold text-ink">What the scan established, and what is still missing</h3>
          <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-ink-dim">
            {openTasks.length > 0
              ? `${coveredTasks.length} research area${coveredTasks.length === 1 ? " was" : "s were"} covered; ${openTasks.length} still ${openTasks.length === 1 ? "needs" : "need"} more evidence. The scan finished, but ARGUS could not verify every answer from the sources saved with this ${intentLabel[plan.intent]}.`
              : `All ${coveredTasks.length} applicable research area${coveredTasks.length === 1 ? " was" : "s were"} covered for this ${intentLabel[plan.intent]}.`}
          </p>
        </div>
        <span className={`chip shrink-0 ${openTasks.length > 0 ? "tint-caution" : "tint-pass"}`}>
          {openTasks.length > 0 ? "More evidence needed" : "Research complete"}
        </span>
      </div>

      {materialGaps.length > 0 && (
        <div className="px-4 py-3.5">
          <p className="eyebrow">Most important missing answers</p>
          <div className="mt-2 divide-y divide-line/70 rounded-lg border border-line bg-panel-2/35">
            {materialGaps.map((task) => (
              <div key={task.id} className="flex items-start gap-2.5 px-3 py-2.5">
                <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0 text-caution" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium leading-snug text-ink">{task.question}</p>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-dim">{publicTaskNote(task)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {nextAction && (
        <div className="border-t border-line bg-signal-soft/35 px-4 py-3">
          <p className="eyebrow">Best next step</p>
          <div className="mt-1.5 flex items-start gap-2">
            <ArrowRight size={15} weight="bold" className="mt-0.5 shrink-0 text-signal-lift" aria-hidden="true" />
            <p className="text-[12px] font-medium leading-snug text-ink">{nextAction.action}</p>
          </div>
        </div>
      )}

      <details className="group border-t border-line px-4 py-3">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-ink-dim">
          Technical coverage details
        </summary>
        <div className="mt-3 divide-y divide-line/70 rounded-lg border border-line">
          {plan.tasks.map((task) => (
            <div key={task.id} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                {task.state === "completed"
                  ? <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-pass" aria-hidden="true" />
                  : <WarningCircle size={15} weight="duotone" className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-medium leading-snug text-ink">{task.question}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
                    {task.rank ? `#${task.rank} · ` : ""}{task.costClass} cost · routed to {task.delegates.join(" · ")}
                  </p>
                  {task.outcome && <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">Recorded outcome: {task.outcome}</p>}
                </div>
                <span className={`chip shrink-0 ${stateTone[task.state]}`}>{task.state}</span>
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
