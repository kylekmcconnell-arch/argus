import { ScoreRing } from "./ScoreRing";
import { ProvenancedValue } from "./ProvenancedValue";
import { verdictMeta } from "../lib/verdict";
import { composeWhy, judgmentLine } from "../lib/verdictNarrative";
import type { TokenDossier } from "../token/audit";

/* The Auric File's opening, earned: the open editorial hero, rendered ONLY
   when the readiness gate has passed (the caller enforces it). Grid exactly
   as the approved mock: judgment serif headline + why-paragraph left, the
   ring block right, provenance legend strip below on its own hairline.
   Collapses to one column under 820px like the mock. */

const LEGEND: { color: string; label: string }[] = [
  { color: "var(--color-sourced)", label: "a document or the chain says so" },
  { color: "var(--color-derived)", label: "ARGUS worked it out" },
  { color: "var(--color-unverifiable)", label: "nobody has evidenced this" },
];

export function VerdictHero({ token, savedLabel }: {
  token: Pick<TokenDossier, "score" | "verdict" | "capApplied" | "axes">;
  savedLabel?: string | null;
}) {
  if (token.score == null) return null;
  const meta = verdictMeta(token.verdict);
  const why = composeWhy(token);
  return (
    <>
      <div className="af-hero" aria-label="The verdict">
        <div className="min-w-0">
          <h2 className="af-hero-title">{judgmentLine(token.verdict)}</h2>
          {why && (
            <p className="af-why">
              <b>Why {token.score}: </b>
              {why.map((segment, index) => segment.figure ? (
                <ProvenancedValue key={index} tier="derived">{segment.text}</ProvenancedValue>
              ) : (
                <span key={index}>{segment.text}</span>
              ))}
              {" "}The full basis sits in the chapters below.
            </p>
          )}
        </div>
        <div className="af-score-block">
          <div className="af-ring inline-block">
            <ScoreRing score={token.score} verdict={token.verdict} size={168} bands />
          </div>
          <p className="mono mt-3 text-[11px] font-medium uppercase tracking-[0.15em]" style={{ color: meta.color }}>
            {meta.label}
          </p>
          {savedLabel && (
            <p className="mono mt-2 text-[10px] tracking-[0.08em] text-ink-faint">{savedLabel}</p>
          )}
        </div>
      </div>
      <div className="af-legend" aria-label="How to read the dotted figures">
        {LEGEND.map((entry) => (
          <span key={entry.label}>
            <i aria-hidden="true" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
    </>
  );
}
