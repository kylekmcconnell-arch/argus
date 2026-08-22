import { useState } from "react";
import type { DossierFigure, DossierSourceRow } from "../lib/dossierModel";
import { buildTokenStory } from "../lib/tokenStory";
import type { TokenDossier } from "../token/audit";
import { ProvenanceTag } from "./ProvenanceTag";
import { ProvenancedValue } from "./ProvenancedValue";

const TIER_TEXT: Record<string, string> = {
  sourced: "text-sourced",
  derived: "text-derived",
  unestablished: "text-unverifiable",
};

function FigureRow({ figure }: { figure: DossierFigure }) {
  const receipt = figure.receipt;
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 text-[12.5px] text-ink-dim">{figure.label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5">
        <ProvenanceTag state={figure.provenance} className="shrink-0" />
        <ProvenancedValue
          tier={figure.provenance.tier}
          receipt={receipt ? {
            passage: receipt.passage,
            sourceLabel: receipt.sourceLabel,
            url: receipt.url || undefined,
            chain: receipt.chain,
          } : null}
        >
          <span className={`mono text-[12.5px] ${TIER_TEXT[figure.provenance.tier] ?? "text-ink"}`}>
            {figure.value}
          </span>
        </ProvenancedValue>
      </span>
    </li>
  );
}

function SourcesTable({ rows }: { rows: DossierSourceRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <div className="mt-3 divide-y divide-line/60">
      {rows.map((row) => {
        const expanded = open === row.url;
        const ink = row.established ? "text-ink" : "text-unverifiable";
        const dim = row.established ? "text-ink-dim" : "text-unverifiable";
        return (
          <div key={row.url}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : row.url)}
              aria-expanded={expanded}
              className="flex w-full items-baseline justify-between gap-3 py-2 text-left"
            >
              <span className={`mono min-w-0 truncate text-[11px] ${ink}`}>{row.label}</span>
              <span className={`mono shrink-0 text-[11px] ${dim}`}>
                {row.factsCited} {row.factsCited === 1 ? "fact" : "facts"}
              </span>
            </button>
            {expanded && (
              <div className="pb-2.5">
                <ul className="space-y-1">
                  {row.citedLabels.map((label, index) => (
                    <li key={`${label}-${index}`} className={`text-[12.5px] leading-relaxed ${dim}`}>{label}</li>
                  ))}
                </ul>
                <a href={row.url} target="_blank" rel="noreferrer" className="link-ext mono mt-2 inline-block text-[11px]">
                  Open source
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TokenHeadlineStats({ figures }: { figures: DossierFigure[] }) {
  if (!figures.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {figures.map((figure) => (
        <div key={figure.label} className="stat-tile">
          <div className="stat-label">{figure.label}</div>
          <div className="stat-value mt-0.5">
            <ProvenancedValue
              tier={figure.provenance.tier}
              receipt={figure.receipt ? {
                passage: figure.receipt.passage,
                sourceLabel: figure.receipt.sourceLabel,
                url: figure.receipt.url || undefined,
                chain: figure.receipt.chain,
              } : null}
            >
              {figure.value}
            </ProvenancedValue>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TokenStory({ dossier }: { dossier: TokenDossier }) {
  const story = buildTokenStory(dossier);
  const cited = story.sources.reduce((sum, row) => sum + row.factsCited, 0);
  return (
    <section id="token-story" className="story-chapter report-section mt-6 scroll-mt-28" aria-label="Token file">
      <p className="eyebrow text-signal-lift">The file</p>
      <h2 className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
        {story.beats.length} chapters. {story.gaps.length} open {story.gaps.length === 1 ? "gap" : "gaps"}.
      </h2>
      <p className="story-chapter-description mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        Colour says where a figure came from, not whether the news is good.
        Sourced means a collector recorded it. Derived means ARGUS inferred it.
        Unestablished means nobody evidenced it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="How to read provenance">
        <ProvenanceTag state={{ tier: "sourced" }} />
        <ProvenanceTag state={{ tier: "derived" }} />
        <ProvenanceTag state={{ tier: "unestablished" }} />
      </div>

      {story.beats.map((beat) => (
        <article key={beat.id} id={`token-story-${beat.id}`} className="mt-6 max-w-3xl scroll-mt-28">
          <p className="mono text-[11px] uppercase tracking-[0.14em] text-signal-lift">{beat.kicker}</p>
          <h3 className="display mt-2 text-[18px] leading-snug text-ink">{beat.heading}</h3>
          {beat.id === "gaps" ? (
            <ul className="mt-3 space-y-1.5">
              {story.gaps.map((gap) => (
                <li key={gap} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-dim">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-unverifiable" />
                  <span>{gap}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-3 divide-y divide-line/60">
              {beat.figures.map((figure) => (
                <FigureRow key={`${beat.id}-${figure.label}`} figure={figure} />
              ))}
            </ul>
          )}
        </article>
      ))}

      <div id="token-evidence" className="mt-6 max-w-3xl scroll-mt-28">
        <p className="mono text-[11px] uppercase tracking-[0.14em] text-signal-lift">Sources</p>
        <h3 className="display mt-2 text-[18px] leading-snug text-ink">
          {story.sources.length === 0
            ? "No recorded source URL is attached to these figures."
            : story.sources.length === 1
              ? `1 recorded source. ${cited} ${cited === 1 ? "fact" : "facts"} cited.`
              : `${story.sources.length} recorded sources. ${cited} facts cited.`}
        </h3>
        <SourcesTable rows={story.sources} />
      </div>
    </section>
  );
}
