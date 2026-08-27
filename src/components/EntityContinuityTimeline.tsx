import type { EntityContinuitySnapshot } from "../data/evidence";

function dateLabel(value: string | null): string {
  if (!value) return "Date not pinned";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function EntityContinuityTimeline({ snapshot }: { snapshot: EntityContinuitySnapshot }) {
  if (!snapshot.events.length && !snapshot.tokenLineage.length) return null;
  const ordered = [...snapshot.events].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return (
    <section id="key-developments" className="story-chapter report-section scroll-mt-28" aria-labelledby="key-developments-title">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Key developments</p>
          <h2 id="key-developments-title" className="story-chapter-title mt-2 text-ink">The events that shaped this case.</h2>
          <p className="story-chapter-description mt-2 max-w-3xl text-ink-dim">
            Rebrands, migrations, incidents and other material events stay attached to the evidence they came from.
          </p>
        </div>
        <span className="verdict-pill tint-signal">{ordered.length} sourced {ordered.length === 1 ? "event" : "events"}</span>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <div className="panel p-5">
          <h3 className="text-[22px] font-semibold leading-tight text-ink">
            {snapshot.predecessorName ? `${snapshot.predecessorName} became ${snapshot.subject}.` : `${snapshot.subject} has a history before this contract.`}
          </h3>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-dim">
            {snapshot.migrationRatio
              ? `The token moved${snapshot.oldTicker ? ` from $${snapshot.oldTicker}` : ""} at ${snapshot.migrationRatio}. The report evaluates the whole lineage, not only the replacement contract.`
              : "ARGUS found a predecessor or material project change. The report carries that earlier identity into team, security, incident, legal and market research."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {snapshot.tokenLineage.map((node, index) => (
              <span key={`${node.status}-${node.contract ?? node.name}-${index}`} className="chip chip-wrap">
                {node.ticker ? `$${node.ticker}` : node.name}
                <span aria-hidden="true"> · </span>{node.status}
              </span>
            ))}
          </div>
        </div>
        <ol className="panel divide-y divide-line/70 overflow-hidden">
          {ordered.map((event, index) => (
            <li key={`${event.kind}-${event.date}-${index}`} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="mono text-[11px] uppercase tracking-wide text-signal-lift">{event.kind.replaceAll("_", " ")}</span>
                <time className="mono text-[11px] text-ink-dim">{dateLabel(event.date)}</time>
              </div>
              <h3 className="mt-2 text-[15px] font-semibold text-ink">{event.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-dim">{event.detail}</p>
              {event.sourceUrls[0] && <a className="mt-3 inline-flex text-[12.5px] font-medium text-signal-lift hover:underline" href={event.sourceUrls[0]} target="_blank" rel="noreferrer">Open source ↗</a>}
            </li>
          ))}
        </ol>
      </div>
      {snapshot.coverage.state !== "complete" && (
        <p className="mt-4 rounded-lg border border-caution/30 bg-caution/5 px-4 py-3 text-[13px] leading-relaxed text-ink-dim">
          <strong className="text-caution">Lifecycle coverage remains open.</strong> {snapshot.coverage.reason}
        </p>
      )}
    </section>
  );
}
