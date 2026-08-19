// The editorial verdict: the judgment line under the subject name and the
// "Why {score}" paragraph beside the ring. Same honesty contract as the
// dimension chapters: the judgment line is selected from a fixed table by
// the recorded verdict, and the why-paragraph is assembled only from
// recorded axis scores, weights, and the engine's own rationale sentences.
// Nothing here is generated per report.
import type { TokenDossier } from "../token/audit";

/** One piece of the why-paragraph; figures render provenance-dotted. */
export interface WhySegment {
  text: string;
  figure?: boolean;
}

const JUDGMENT_LINES: Record<string, string> = {
  PASS: "The record holds up.",
  CAUTION: "Sound, with reservations.",
  FAIL: "The weaknesses outweigh the record.",
  AVOID: "A disqualifying record.",
  PROVISIONAL: "An early read, still forming.",
  INCOMPLETE: "Too many gaps to call.",
  BLOCKED: "The record cannot be established.",
  UNVERIFIABLE_IDENTITY: "The record cannot be established.",
};

export function judgmentLine(verdict: string): string {
  return JUDGMENT_LINES[verdict] ?? "The state of the record.";
}

const ensureSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * Assemble the why-paragraph from the recorded axes: the strongest dimension
 * carries the file, the weakest drags it, each in the engine's own words.
 * Returns null when there is no score or fewer than two scored axes; callers
 * then simply render no paragraph.
 */
export function composeWhy(token: Pick<TokenDossier, "score" | "capApplied" | "axes">): WhySegment[] | null {
  const axes = (token.axes ?? []).filter((axis) => axis.weight > 0);
  if (token.score == null || axes.length < 2) return null;
  const byRatio = [...axes].sort((a, b) => (b.score / b.weight) - (a.score / a.weight));
  const strongest = byRatio[0];
  const weakest = byRatio[byRatio.length - 1];

  const segments: WhySegment[] = [
    { text: `${strongest.label} carries the file at ` },
    { text: `${strongest.score} of ${strongest.weight} points`, figure: true },
    { text: `. ${ensureSentence(strongest.rationale)} The drag is ${weakest.label} at ` },
    { text: `${weakest.score} of ${weakest.weight}`, figure: true },
    { text: `. ${ensureSentence(weakest.rationale)}` },
  ];
  if (token.capApplied) {
    segments.push({ text: ` A safety cap limits the total to ${token.score}.` });
  }
  return segments;
}
