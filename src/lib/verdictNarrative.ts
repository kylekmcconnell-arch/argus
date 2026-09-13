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
  "Taxes & tradeability": "buy and sell tax",
  "Holder distribution": "holder concentration",
  "Trading authenticity": "trading activity",
  "Maturity & presence": "project history",
};

const plainScoreArea = (label: string): string =>
  SCORE_AREA_NAMES[label] ?? lowerFirst(label.replace(/\s*&\s*/g, " and "));

const withCommas = (value: string): string => {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("en-US") : value;
};

const countPhrase = (value: string, singular: string, plural: string): string => {
  const n = Number(String(value).replace(/,/g, ""));
  const noun = n === 1 ? singular : plural;
  return `${withCommas(value)} ${noun}`;
};

/** Reader copy for the compact rationales emitted by the token scorer. */
export function plainScoreRationale(value: string): string {
  const raw = plainLanguageSummary(value).replace(/\s+/g, " ").trim();
  const pooled = raw.match(/^\$([\d,.]+) pooled(?: \(([^)]+)\))?(?:,\s*(.+?))?\.?$/i);
  if (pooled) {
    const location = pooled[2] ? ` (${pooled[2].replace(/^the /i, "")})` : "";
    const reassuring = /^LP (?:burned|locked)$/i.test(pooled[3] ?? "");
    const qualifier = pooled[3]
      ?.replace(/^LP mostly in one wallet$/i, "most liquidity-provider tokens are held in one wallet")
      .replace(/^LP in one unlocked wallet$/i, "liquidity-provider tokens are held in one unlocked wallet")
      .replace(/^LP not locked$/i, "liquidity-provider tokens are not confirmed locked")
      .replace(/^LP lock not measured$/i, "liquidity protection is unverified")
      .replace(/^liquidity protection unverified$/i, "liquidity protection is unverified")
      .replace(/^LP burned$/i, "the liquidity-provider tokens were burned")
      .replace(/^LP locked$/i, "the liquidity-provider tokens are locked");
    const selected = `The selected pool holds $${pooled[1]}${location}`;
    const scope = " That is this pool only, not all of the token's liquidity.";
    return qualifier
      ? `${selected}, ${reassuring ? "and" : "but"} ${lowerFirst(qualifier)}.${scope}`
      : `${selected}.${scope}`;
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

  const solana = raw.match(/^(authorities revoked|mint\/freeze authority active)(?:,\s*(.+?))?\.?$/i);
  if (solana) {
    const authority = solana[1].toLowerCase() === "authorities revoked"
      ? "Mint and freeze authorities have been revoked"
      : "Someone can still mint or freeze this token";
    const remainder = solana[2]?.replace(/metadata mutable/i, "the token metadata can still be changed").trim();
    return remainder ? `${authority}, and ${remainder}.` : `${authority}.`;
  }

  const holders = raw.match(/^([\d,]+) holders(?:,\s*top holder ([\d.]+)%)?(.*)$/i);
  if (holders) {
    const count = withCommas(holders[1]);
    const top = holders[2];
    const extra = holders[3].replace(/^,\s*/, "").replace(/\.+$/, "").trim();
    const spread = top
      ? `About ${count} addresses hold this token, and the largest holds about ${top}% of supply`
      : `About ${count} addresses hold this token`;
    const concentrated = extra.match(/^~([\d.]+)% across (\d+) non-market wallets holding at least 1% each$/i);
    const extraSentence = concentrated
      ? `About ${concentrated[1]}% of supply sits in ${concentrated[2]} addresses that are not known market venues, each holding at least 1%.`
      : extra ? ensureSentence(extra) : "";
    return extraSentence ? `${spread}. ${extraSentence}` : `${spread}.`;
  }

  const wash = raw.match(/^vol\/liquidity ([\d.]+)x but price flat \(([-.\d]+)%\):\s*wash-trade signature\.?$/i);
  if (wash) {
    return `This selected pool traded ${wash[1]} times its own size while the price barely moved (${wash[2]}%). That pattern is a wash-trade signature, not proof of genuine demand.`;
  }

  const tape = raw.match(/^24h vol\/liquidity ([\d.]+)x,\s*([\d,]+) buys \/ ([\d,]+) sells\.?$/i);
  if (tape) {
    return `In the last day, this selected pool traded about ${tape[1]} times its own size, with ${countPhrase(tape[2], "buy", "buys")} and ${countPhrase(tape[3], "sell", "sells")}. That is this pool only, not global volume.`;
  }

  const tapeIncomplete = raw.match(/^24h vol\/liquidity ([\d.]+)x\. Swap counts from this pool were incomplete\.?$/i);
  if (tapeIncomplete) {
    return `In the last day, this selected pool traded about ${tapeIncomplete[1]} times its own size. Swap counts from this feed were incomplete, so they are not part of the score. That is this pool only, not global volume.`;
  }

  const tax = raw.match(/^(?:token tax )?buy ([\d.]+)% \/ sell ([\d.]+)%(?:\s*\((simulated)\))?\.?$/i);
  if (tax) {
    const simulated = tax[3] ? " A simulated buy and sell produced these rates." : "";
    return `The token currently adds about ${tax[1]}% tax on buys and ${tax[2]}% on sells.${simulated} This is not total trading cost: gas, pool fees, and price impact are separate.`;
  }

  const maturity = raw.match(/^(age unknown|<1 day old|[\d,]+ days old)(?:, ((?:no socials)|(?:[\d,]+ socials?)))?(?:, (([\d,]+) (?:CEX listings|centralized exchange listings)|not on CoinGecko))?\.?$/i);
  if (maturity) {
    const agePart = maturity[1].toLowerCase();
    const age = agePart === "age unknown"
      ? "This pool's trading age was not recorded"
      : agePart === "<1 day old"
        ? "This pool has been trading for less than a day"
        : `This pool has been trading for ${withCommas(agePart.replace(/ days old$/i, ""))} days`;
    const socialRaw = maturity[2];
    let social = "";
    if (socialRaw) {
      if (/^no socials$/i.test(socialRaw)) social = "No website or social links were on the market record.";
      else {
        const count = socialRaw.replace(/ socials?$/i, "");
        social = `${countPhrase(count, "public link", "public links")} ${Number(count.replace(/,/g, "")) === 1 ? "was" : "were"} on the market record.`;
      }
    }
    const cexRaw = maturity[3];
    let cex = "";
    if (cexRaw) {
      if (/not on CoinGecko/i.test(cexRaw)) cex = "It is not listed on CoinGecko.";
      else {
        const count = maturity[4];
        cex = `It is listed on ${withCommas(count)} centralized ${Number(String(count).replace(/,/g, "")) === 1 ? "exchange" : "exchanges"}.`;
      }
    }
    return [ensureSentence(age), social, cex].filter(Boolean).join(" ");
  }

  return ensureSentence(raw);
}

/** Connect the saved facts to the points shown on the score row. */
export function explainCompositionScore(
  rationale: string,
  score: number,
  weight: number,
  applicability?: "not_applicable" | "deferred" | "unassessed",
): string {
  const why = plainScoreRationale(rationale);
  if (applicability || !(weight > 0)) return why;
  if (score >= weight) return `${why} This area earned its full ${weight} points.`;
  const missing = Math.round(weight - score);
  return `${why} That is why it scored ${Math.round(score)} of ${weight} points (${missing} ${missing === 1 ? "point" : "points"} not earned).`;
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
