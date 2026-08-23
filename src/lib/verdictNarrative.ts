// The editorial verdict: the judgment line under the subject name and the
// "Why {score}" paragraph beside the ring. Same honesty contract as the
// dimension chapters: the judgment line is selected from a fixed table by
// the recorded verdict, and the why-paragraph is assembled only from
// recorded axis scores, weights, and the engine's own rationale sentences.
// Nothing here is generated per report.
import type { TokenDossier } from "../token/audit";
import { plainLanguageSummary } from "./plainLanguage";

/** One piece of the why-paragraph; figures render provenance-dotted. */
export interface WhySegment {
  text: string;
  figure?: boolean;
}

const JUDGMENT_LINES: Record<string, string> = {
  PASS: "Most checks passed. Review the remaining risks.",
  CAUTION: "Important risks remain despite some positive checks.",
  FAIL: "The risks outweigh the positive checks.",
  AVOID: "A critical issue makes this too risky.",
  PROVISIONAL: "This is an early result, not a final verdict.",
  INCOMPLETE: "Too many checks are missing for a reliable verdict.",
  BLOCKED: "ARGUS could not verify enough to reach a verdict.",
  UNVERIFIABLE_IDENTITY: "ARGUS could not verify who or what this report is about.",
};

export function judgmentLine(verdict: string): string {
  return JUDGMENT_LINES[verdict] ?? "This result needs review.";
}

const ensureSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const lowerFirst = (value: string): string =>
  value ? value.charAt(0).toLowerCase() + value.slice(1) : value;

const SCORE_AREA_NAMES: Record<string, string> = {
  "Liquidity & lock": "liquidity setup",
  "Contract safety": "contract safety",
  "Taxes & tradeability": "trading costs and sellability",
  "Holder distribution": "holder concentration",
  "Trading authenticity": "trading activity",
  "Maturity & presence": "project history",
};

const plainScoreArea = (label: string): string =>
  SCORE_AREA_NAMES[label] ?? lowerFirst(label.replace(/\s*&\s*/g, " and "));

/** Reader copy for the compact rationales emitted by the token scorer. */
export function plainScoreRationale(value: string): string {
  const raw = plainLanguageSummary(value).replace(/\s+/g, " ").trim();
  const pooled = raw.match(/^\$([\d,.]+) pooled(?:,\s*(.+?))?\.?$/i);
  if (pooled) {
    const reassuring = /^LP (?:burned|locked)$/i.test(pooled[2] ?? "");
    const qualifier = pooled[2]
      ?.replace(/^LP mostly in one wallet$/i, "most liquidity-provider tokens are held in one wallet")
      .replace(/^LP in one unlocked wallet$/i, "liquidity-provider tokens are held in one unlocked wallet")
      .replace(/^LP not locked$/i, "liquidity-provider tokens are not confirmed locked")
      .replace(/^LP lock not measured$/i, "liquidity protection is unverified")
      .replace(/^LP burned$/i, "the liquidity-provider tokens were burned")
      .replace(/^LP locked$/i, "the liquidity-provider tokens are locked");
    return qualifier
      ? `The liquidity pool holds $${pooled[1]}, ${reassuring ? "and" : "but"} ${lowerFirst(qualifier)}.`
      : `The liquidity pool holds $${pooled[1]}.`;
  }

  const contract = raw.match(/^(verified|unverified) source,\s*(ownership renounced|owner active)(.*)$/i);
  if (contract) {
    const source = contract[1].toLowerCase() === "verified"
      ? "The source code is verified"
      : "The source code is not verified";
    const ownership = contract[2].toLowerCase() === "ownership renounced"
      ? "ownership has been renounced"
      : "the owner still has control";
    const remainder = contract[3].replace(/^,\s*/, "").replace(/[.]+$/, "").trim();
    return `${source}, and ${ownership}${remainder ? `. The contract is also ${remainder}` : ""}.`;
  }

  return ensureSentence(raw);
}

/**
 * Assemble the why-paragraph from the recorded axes: name the strongest area
 * and the main concern in everyday language while preserving the exact score
 * and the engine's recorded rationale.
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
    { text: `${plainScoreArea(strongest.label).replace(/^./, (letter) => letter.toUpperCase())} scored ` },
    { text: `${strongest.score} of ${strongest.weight} points`, figure: true },
    { text: `. ${plainScoreRationale(strongest.rationale)} The main concern is ${plainScoreArea(weakest.label)}, which scored ` },
    { text: `${weakest.score} of ${weakest.weight} points`, figure: true },
    { text: `. ${plainScoreRationale(weakest.rationale)}` },
  ];
  if (token.capApplied) {
    segments.push({ text: ` A safety cap limits the total to ${token.score}.` });
  }
  return segments;
}
