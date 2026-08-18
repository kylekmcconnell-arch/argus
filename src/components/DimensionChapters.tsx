import type { DimensionChapter } from "../lib/dimensionChapters";

/* The chapters the composition strip points into: one per weighted
   dimension, in the standard scan-output voice. A serif judgment headline
   with the score math beside it, the engine's rationale as the lead, and a
   hairline fact ledger of what drove the score. Anchors are
   #dimension-<axis> so the strip's "Read the evidence" lands here. */

const TONE_COLOR: Record<DimensionChapter["tone"], string> = {
  pass: "var(--color-pass)",
  caution: "var(--color-caution)",
  fail: "var(--color-fail)",
};

export function DimensionChapters({ chapters, checksHref }: {
  chapters: DimensionChapter[];
  /** Where "All checks" points (the methodology checklist anchor). */
  checksHref: `#${string}`;
}) {
  if (!chapters.length) return null;
  return (
    <div>
      {chapters.map((chapter) => (
        <section
          key={chapter.axis}
          id={`dimension-${chapter.axis}`}
          className="report-section story-chapter mt-7 scroll-mt-28"
          aria-label={chapter.eyebrow}
        >
          <header className="report-section-heading">
            <div>
              <p className="eyebrow">{chapter.eyebrow}</p>
              <h2 className="story-chapter-title mt-1 text-ink">{chapter.headline}</h2>
            </div>
            <div className="mono shrink-0 self-end whitespace-nowrap pb-1 text-[11px] text-ink-faint">
              <span className="text-[22px] font-medium tabular" style={{ color: TONE_COLOR[chapter.tone] }}>
                {chapter.score}
              </span>
              {" "}/ {chapter.weight} pts
            </div>
          </header>
          {chapter.lead && (
            <p className="mt-3 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-dim">{chapter.lead}</p>
          )}
          {chapter.facts.length > 0 && (
            <dl className="mt-3 max-w-xl">
              {chapter.facts.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-6 border-b border-line/60 py-2 first:border-t first:border-t-line">
                  <dt className="text-[13px] text-ink-dim">{fact.label}</dt>
                  <dd
                    className="mono text-[12px] font-medium tabular"
                    style={fact.tone ? { color: TONE_COLOR[fact.tone] } : undefined}
                  >
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <a
            href={checksHref}
            className="mono mt-3 inline-block text-[10.5px] font-medium uppercase tracking-wider text-signal-lift underline-offset-2 hover:underline"
          >
            All checks ↓
          </a>
        </section>
      ))}
    </div>
  );
}
