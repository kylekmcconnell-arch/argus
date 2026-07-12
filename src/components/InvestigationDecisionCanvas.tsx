import { ClockCounterClockwise, Database } from "@phosphor-icons/react";
import {
  ReportCanvasNarrativeSection,
  ReportCanvasRailCard,
  type ReportCanvasTone,
  type ReportCanvasNarrativeItem,
  type ReportCanvasRailItem,
} from "./ReportCanvasPrimitives";

export interface DecisionCanvasItem {
  label: string;
  detail?: string | undefined;
}

function narrativeItems(prefix: string, items: DecisionCanvasItem[], href?: `#${string}`): ReportCanvasNarrativeItem[] {
  return items.map((item, index) => ({
    id: `${prefix}-${index}`,
    title: item.label,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(href ? { href } : {}),
  }));
}

function railItems(prefix: string, items: DecisionCanvasItem[], href?: `#${string}`): ReportCanvasRailItem[] {
  return items.map((item, index) => ({
    id: `${prefix}-${index}`,
    label: item.label,
    ...(item.detail ? { meta: item.detail } : {}),
    ...(href ? { href } : {}),
  }));
}

export function InvestigationDecisionCanvas({
  verdictLabel,
  favorable,
  verdictTone,
  supports,
  concerns,
  nextSteps,
  verified,
  openQuestions,
  coveragePercent,
  successful,
  applicable,
  capturedAt,
  evidenceHref = "#token-evidence",
  methodologyHref = "#token-methodology",
}: {
  verdictLabel: string;
  favorable: boolean;
  verdictTone: ReportCanvasTone;
  supports: DecisionCanvasItem[];
  concerns: DecisionCanvasItem[];
  nextSteps: DecisionCanvasItem[];
  verified: DecisionCanvasItem[];
  openQuestions: DecisionCanvasItem[];
  coveragePercent: number;
  successful: number;
  applicable: number;
  capturedAt?: string | undefined;
  evidenceHref?: `#${string}`;
  methodologyHref?: `#${string}`;
}) {
  const verdictItems = favorable ? supports : concerns;
  const countervailingItems = favorable ? concerns : supports;

  return (
    <div id="report-summary" className="mt-5 grid scroll-mt-28 gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="panel px-5">
        <ReportCanvasNarrativeSection
          title={`Why ARGUS reaches ${verdictLabel}`}
          description={favorable
            ? "Only recorded outcomes and evidence-backed positive findings appear in this summary."
            : "Only recorded adverse findings, failed checks, and decision-limiting evidence appear in this summary."}
          tone={verdictTone}
          items={narrativeItems("verdict", verdictItems, evidenceHref)}
          emptyCopy={favorable
            ? "No evidence-backed support is recorded yet. Treat the result as incomplete and inspect the coverage gaps."
            : "No recorded adverse driver explains this result. Inspect the underlying evidence before relying on the verdict."}
        />
        <ReportCanvasNarrativeSection
          id="report-risks"
          title={favorable ? "What limits confidence" : "What evidence pulls the other way"}
          description={favorable
            ? "Adverse findings and incomplete evidence remain visible even when the model signal is favorable."
            : "Verified positive evidence stays visible so an adverse verdict is not presented without its counterweight."}
          tone={favorable ? "caution" : "pass"}
          items={narrativeItems("counterweight", countervailingItems, evidenceHref)}
          emptyCopy={favorable
            ? "No adverse finding or unresolved confidence limit is recorded in this snapshot."
            : "No evidence-backed positive counterweight is recorded in this snapshot."}
        />
        <ReportCanvasNarrativeSection
          title="What the investor should verify next"
          description="Follow-ups come directly from checks without a completed, current outcome."
          tone="signal"
          items={narrativeItems("next", nextSteps, methodologyHref)}
          emptyCopy="All applicable checks have recorded outcomes. Review the underlying evidence before making a decision."
        />
      </div>

      <aside className="space-y-3" aria-label="Investigation evidence summary">
        <ReportCanvasRailCard
          title="Recorded outcomes"
          tone={verdictTone}
          count={`${successful} of ${applicable}`}
          items={railItems("verified", verified, evidenceHref)}
        />
        <ReportCanvasRailCard
          title="Open questions"
          tone="caution"
          count={String(openQuestions.length)}
          items={railItems("question", openQuestions, methodologyHref)}
        />
        <section className="panel p-3.5" aria-label="Evidence coverage and freshness">
          <div className="flex items-center gap-2">
            <Database size={17} weight="duotone" aria-hidden="true" className="text-signal" />
            <h2 className="eyebrow text-ink-dim">Evidence coverage</h2>
            <span className="mono ml-auto text-[13.5px] font-semibold text-ink">{coveragePercent}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Evidence coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coveragePercent}>
            <div className="h-full rounded-full bg-signal" style={{ width: `${Math.max(0, Math.min(100, coveragePercent))}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-faint">{successful} completed outcomes across {applicable} applicable checks.</p>
          {capturedAt && (
            <div className="mt-3 flex items-start gap-2 border-t border-line/60 pt-3 text-[11px] leading-snug text-ink-faint">
              <ClockCounterClockwise size={15} weight="duotone" aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>Evidence snapshot captured {capturedAt}.</span>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
