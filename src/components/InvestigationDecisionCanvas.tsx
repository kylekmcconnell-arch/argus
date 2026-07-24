import { ArrowRight, ClockCounterClockwise, Database } from "@phosphor-icons/react";
import {
  ReportCanvasNarrativeSection,
  type ReportCanvasTone,
  type ReportCanvasNarrativeItem,
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

function DecisionLedgerList({
  title,
  items,
  href,
  emptyCopy,
  limit = 5,
}: {
  title: string;
  items: DecisionCanvasItem[];
  href: `#${string}`;
  emptyCopy: string;
  limit?: number;
}) {
  const visible = items.slice(0, limit);
  const remaining = Math.max(0, items.length - visible.length);

  return (
    <section className="border-t border-line/60 py-4 first:border-t-0 first:pt-0" aria-label={title}>
      <div className="flex items-center gap-2">
        <h3 className="eyebrow text-ink-dim">{title}</h3>
        <span className="mono ml-auto text-[11px] text-ink-faint">{items.length}</span>
      </div>
      {visible.length ? (
        <ul className="mt-2 divide-y divide-line/50">
          {visible.map((item, index) => (
            <li key={`${title}-${index}`}>
              <a href={href} className="group flex items-start gap-2 py-2.5 text-[12.5px] leading-snug text-ink-dim hover:text-ink">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{item.label}</span>
                  {item.detail && <span className="mt-0.5 block text-[11.5px] text-ink-faint">{item.detail}</span>}
                </span>
                <ArrowRight aria-hidden="true" size={13} weight="bold" className="mt-0.5 shrink-0 text-ink-faint transition group-hover:text-signal-lift" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">{emptyCopy}</p>
      )}
      {remaining > 0 && (
        <a href={href} className="mono mt-2 inline-flex text-[10.5px] uppercase tracking-[0.08em] text-signal-lift hover:underline">
          Review {remaining} more
        </a>
      )}
    </section>
  );
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
    <section id="report-summary" className="report-section mt-6 scroll-mt-28">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">01 · Decision ledger</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-ink">How the result is supported</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
            The verdict, its counterweight, and the remaining verification work are kept in one evidence ledger.
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="mono text-[22px] font-semibold tabular-nums text-ink">{coveragePercent}%</p>
          <p className="mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{successful}/{applicable} outcomes</p>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="px-5">
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
                ? "Adverse findings and open evidence gaps remain visible even when the model signal is favorable."
                : "Verified positive evidence stays visible so an adverse verdict is not presented without its counterweight."}
              tone={favorable ? "caution" : "pass"}
              items={narrativeItems("counterweight", countervailingItems, evidenceHref)}
              emptyCopy={favorable
                ? "No adverse finding or unresolved confidence limit is recorded in this snapshot."
                : "No evidence-backed positive counterweight is recorded in this snapshot."}
            />
          </div>

          <aside className="border-t border-line/60 bg-panel-2/20 px-4 py-5 lg:border-l lg:border-t-0" aria-label="Investigation evidence summary">
            <section aria-label="Evidence coverage and freshness">
              <div className="flex items-center gap-2">
                <Database size={17} weight="duotone" aria-hidden="true" className="text-signal-lift" />
                <h3 className="eyebrow text-ink-dim">Evidence coverage</h3>
                <span className="mono ml-auto text-[13.5px] font-semibold text-ink">{coveragePercent}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Evidence coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coveragePercent}>
                <div className="h-full rounded-full bg-signal" style={{ width: `${Math.max(0, Math.min(100, coveragePercent))}%` }} />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                {successful} recorded outcomes, {openQuestions.length} open {openQuestions.length === 1 ? "path" : "paths"}.
              </p>
            </section>

            <div className="mt-4 border-t border-line/60 pt-4">
              <DecisionLedgerList
                title="Open questions · verify next"
                items={nextSteps}
                href={methodologyHref}
                emptyCopy="All applicable checks have recorded outcomes."
                limit={4}
              />
              <DecisionLedgerList
                title="Recorded outcomes"
                items={verified}
                href={evidenceHref}
                emptyCopy="No completed outcome is recorded yet."
                limit={4}
              />
            </div>

            {capturedAt && (
              <div className="flex items-start gap-2 border-t border-line/60 pt-4 text-[11px] leading-snug text-ink-faint">
                <ClockCounterClockwise size={15} weight="duotone" aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>Evidence snapshot captured {capturedAt}.</span>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
