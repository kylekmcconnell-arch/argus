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
    <section id="what-changed" className="report-section scroll-mt-28 border-y border-line py-8" aria-labelledby="what-changed-title">
      <p className="eyebrow text-signal-lift">What changed</p>
      <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <div>
          <h2 id="what-changed-title" className="display-sm text-[30px] leading-tight text-ink sm:text-[36px]">
            {snapshot.predecessorName ? `${snapshot.predecessorName} became ${snapshot.subject}.` : `${snapshot.subject} has a history before this contract.`}
          </h2>
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
        <ol className="grid gap-3 sm:grid-cols-2">
          {ordered.map((event, index) => (
            <li key={`${event.kind}-${event.date}-${index}`} className="rounded-xl border border-line bg-panel px-4 py-4">
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
