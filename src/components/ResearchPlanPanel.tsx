import { ArrowRight, Binoculars, CheckCircle, GitBranch, WarningCircle } from "@phosphor-icons/react";
import type { ResearchPlan, ResearchTask } from "../lib/researchDirector";

const stateTone: Record<ResearchTask["state"], string> = {
  planned: "tint-signal",
  completed: "tint-pass",
  partial: "tint-caution",
  unavailable: "tint-avoid",
  skipped: "",
};

const intentLabel: Record<ResearchPlan["intent"], string> = {
  investment_due_diligence: "Investment diligence",
  counterparty_risk: "Counterparty risk",
  alpha_discovery: "Alpha discovery",
  identity_and_control: "Identity and control",
};

export function ResearchPlanPanel({ plan, className = "" }: { plan: ResearchPlan; className?: string }) {
  const queuedActions = plan.nextActions ?? [];
  const completed = plan.tasks.filter((task) => task.state === "completed").length;
  const open = plan.tasks.filter((task) => task.state === "partial" || task.state === "unavailable" || task.state === "planned").length;
  const important = plan.tasks
    .filter((task) => task.priority === "critical" || task.state === "partial" || task.state === "unavailable")
    .slice(0, 6);

  return (
    <section id="research-plan" aria-label="Investigation delegation plan" className={`panel overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal-soft text-signal-lift">
          <GitBranch size={17} weight="duotone" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Investigation director</p>
          <h3 className="mt-0.5 text-[15px] font-semibold text-ink">What ARGUS delegated and why</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
            {intentLabel[plan.intent]} plan for {plan.subject}. Each workstream is assigned to allowlisted specialists; only frozen check outcomes can mark it complete.
          </p>
        </div>
        <div className="flex gap-1.5">
          <span className="chip tint-pass">{completed} completed</span>
          <span className={`chip ${open ? "tint-caution" : ""}`}>{open} open</span>
        </div>
      </div>

      {queuedActions.length > 0 && (
        <div className="border-b border-line bg-signal-soft/35 px-4 py-3">
          <p className="eyebrow">Next best investigation move</p>
          <div className="mt-1.5 flex items-start gap-2">
            <ArrowRight size={15} weight="bold" className="mt-0.5 shrink-0 text-signal-lift" aria-hidden="true" />
            <div>
              <p className="text-[12px] font-medium leading-snug text-ink">{queuedActions[0].action}</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-dim">{queuedActions[0].whyNow}</p>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-line/70">
        {important.map((task) => (
          <details key={task.id} className="group px-4 py-3" open={task.state === "partial" || task.state === "unavailable"}>
            <summary className="flex cursor-pointer list-none items-start gap-2.5">
              {task.state === "completed"
                ? <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-pass" aria-hidden="true" />
                : task.state === "unavailable"
                  ? <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0 text-avoid" aria-hidden="true" />
                  : <Binoculars size={16} weight="duotone" className="mt-0.5 shrink-0 text-signal-lift" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium leading-snug text-ink">{task.question}</span>
                <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">{task.rank ? `#${task.rank} · ` : ""}{task.costClass ? `${task.costClass} cost · ` : ""}delegated to {task.delegates.join(" · ")}</span>
              </span>
              <span className={`chip shrink-0 ${stateTone[task.state]}`}>{task.state}</span>
            </summary>
            <div className="ml-6 mt-2 border-l border-line pl-3 text-[10.5px] leading-relaxed text-ink-dim">
              <p>{task.why}</p>
              {task.dispatchReason && <p className="mt-1 text-ink-faint">Why now: {task.dispatchReason}</p>}
              {task.stopWhen && <p className="mt-1 text-ink-faint">Stop when: {task.stopWhen}</p>}
              {(task.blockedBy?.length ?? 0) > 0 && <p className="mt-1 font-medium text-avoid">Blocked by {task.blockedBy.length} unresolved identity gate{task.blockedBy.length === 1 ? "" : "s"}.</p>}
              {task.triggeredBy.length > 0 && <p className="mt-1 text-ink-faint">Triggered by {task.triggeredBy.length} open evidence question{task.triggeredBy.length === 1 ? "" : "s"}.</p>}
              {task.outcome && <p className="mt-1 font-medium text-ink">Outcome: {task.outcome}</p>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
