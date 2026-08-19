import type { DimensionChapter } from "../lib/dimensionChapters";

/* The chapters the composition strip points into, in the Auric File's exact
   section anatomy: an OPEN hairline-ruled section (never a box), the mono
   eyebrow, the big clamp-responsive serif judgment headline, the score math
   at the baseline right, the lead prose, the hairline fact ledger, and the
   back-to-composition pill. Anchors are #dimension-<axis> so the strip's
   "Read the evidence" lands here. */

const TONE_COLOR: Record<DimensionChapter["tone"], string> = {
  pass: "var(--color-pass)",
  caution: "var(--color-caution)",
  fail: "var(--color-fail)",
};

export function DimensionChapters({ chapters, checksHref, compositionHref = "#composition" }: {
  chapters: DimensionChapter[];
  /** Where "All checks" points (the methodology checklist anchor). */
  checksHref: `#${string}`;
  /** Where "Back to composition" returns (the strip's anchor). */
  compositionHref?: `#${string}`;
}) {
  if (!chapters.length) return null;
  return (
    <div>
      {chapters.map((chapter) => (
        <section
          key={chapter.axis}
          id={`dimension-${chapter.axis}`}
          className="af-sec scroll-mt-28"
          aria-label={chapter.eyebrow}
        >
          <div className="af-sec-head">
            <div className="min-w-0">
              <p className="af-sec-label">{chapter.eyebrow}</p>
              <h2 className="af-h2 mt-2.5">{chapter.headline}</h2>
            </div>
            <div className="af-sec-score">
              <span className="af-n" style={{ color: TONE_COLOR[chapter.tone] }}>{chapter.score}</span>
              <span>/ {chapter.weight} pts</span>
            </div>
          </div>
          {chapter.lead && <p className="af-prose">{chapter.lead}</p>}
          {chapter.facts.length > 0 && (
            <dl className="af-kv">
              {chapter.facts.map((fact) => (
                <div key={fact.label} className="af-kv-row">
                  <dt className="af-kv-k">{fact.label}</dt>
                  <dd
                    className="af-kv-v"
                    style={{ color: fact.tone ? TONE_COLOR[fact.tone] : "var(--color-ink)" }}
                  >
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a className="af-back" href={compositionHref}>↑ Back to composition</a>
            <a
              href={checksHref}
              className="mono mt-[30px] text-[10.5px] font-medium uppercase tracking-wider text-signal-lift underline-offset-2 hover:underline"
            >
              All checks ↓
            </a>
          </div>
        </section>
      ))}
    </div>
  );
}
