import { ScoreRing } from "./ScoreRing";
import { ProvenancedValue } from "./ProvenancedValue";
import { verdictMeta } from "../lib/verdict";
import { composeWhy, judgmentLine } from "../lib/verdictNarrative";
import type { TokenDossier } from "../token/audit";

/* The Auric File's opening, earned: the open editorial hero, rendered ONLY
   when the readiness gate has passed (the caller enforces it). The verdict
   and its explanation are the complete opening hierarchy; source details stay
   attached to the relevant values and in the Evidence and Method sections. */

export function VerdictHero({ token, savedLabel }: {
  token: Pick<TokenDossier, "score" | "verdict" | "capApplied" | "axes">;
  savedLabel?: string | null;
}) {
  if (token.score == null) return null;
  const meta = verdictMeta(token.verdict);
  const why = composeWhy(token);
  return (
    <div className="af-hero" aria-label="The verdict">
      <div className="min-w-0">
        <h2 className="af-hero-title">{judgmentLine(token.verdict)}</h2>
        {why && (
          <p className="af-why">
            <b>Why it scored {token.score}: </b>
            {why.map((segment, index) => segment.figure ? (
              <ProvenancedValue key={index} tier="derived">{segment.text}</ProvenancedValue>
            ) : (
              <span key={index}>{segment.text}</span>
            ))}
            {" "}Open the evidence below for every source and calculation.
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
  );
}
