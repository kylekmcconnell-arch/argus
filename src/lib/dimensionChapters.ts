// The reading spine of a scan: each weighted dimension becomes a chapter
// with a judgment headline, the engine's own rationale as the lead, and a
// compact ledger of the recorded facts that drove the score. Everything here
// is derived from the frozen dossier; the headline is chosen by the recorded
// score band, never invented, and the specific numbers live in the lead and
// the ledger where they can be checked.
import type { TokenDossier } from "../token/audit";
import { publicStrengthLabel } from "./intelligencePresentation";

export type ChapterTone = "pass" | "caution" | "fail";

export interface ChapterFact {
  label: string;
  value: string;
  tone?: ChapterTone;
}

export interface DimensionChapter {
  axis: string;
  /** "Liquidity & lock · 24% of the score" */
  eyebrow: string;
  /** The judgment sentence, chosen by band. */
  headline: string;
  score: number;
  weight: number;
  tone: ChapterTone;
  /** The engine's recorded rationale: the report-specific facts in prose. */
  lead: string;
  facts: ChapterFact[];
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

/** "Six" for 6; digits beyond twelve. For the composition headline. */
export const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

/** "Six dimensions. One number." with the singular handled. */
export const compositionHeadline = (n: number): string =>
  `${countWord(n)} ${n === 1 ? "dimension" : "dimensions"}. One number.`;

/* The canonical reading order and plain names (Enigma, from the Auric File:
   "anyone can understand it"). The account's dimensions lead with the team;
   the token's follow the mock's arc. Engine keys stay untouched; only what
   the reader sees is renamed and ordered. */
const PLAIN_AXES: Record<string, { label: string; order: number }> = {
  P1_team_and_identity: { label: "The team", order: 10 },
  P2_product_substance: { label: "The product", order: 20 },
  P5_traction_and_liveness: { label: "Traction", order: 30 },
  P4_backing_and_partners: { label: "Backing & partners", order: 40 },
  P3_token_conduct: { label: "Token conduct", order: 50 },
  P6_transparency_integrity: { label: "Transparency", order: 60 },
  T5: { label: "Onchain health", order: 110 },
  T4: { label: "The holders", order: 120 },
  T3: { label: "The token", order: 130 },
  T2: { label: "Code & security", order: 140 },
  T1: { label: "The liquidity", order: 150 },
  T6: { label: "Maturity & presence", order: 160 },
};

export const plainAxisLabel = (key: string, fallback: string): string =>
  PLAIN_AXES[key]?.label ?? fallback;

export const plainAxisOrder = (key: string): number => PLAIN_AXES[key]?.order ?? 900;

/** Sort anything keyed by axis into the canonical reading order. */
export const orderByPlainAxis = <T extends { axis: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => plainAxisOrder(a.axis) - plainAxisOrder(b.axis));

const money = (n?: number | null): string | null => {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
};

function band(score: number, weight: number): ChapterTone {
  const ratio = weight > 0 ? score / weight : 0;
  return ratio >= 0.7 ? "pass" : ratio >= 0.4 ? "caution" : "fail";
}

// The 18 judgment sentences: one per dimension per band. Copy rules apply:
// no em dashes, plain speech, the sentence states the band's meaning and the
// lead underneath carries the report's own numbers.
const HEADLINES: Record<string, Record<ChapterTone, string>> = {
  T1: {
    pass: "The liquidity is locked where it belongs.",
    caution: "The lock covers only part of the pool.",
    fail: "The liquidity can walk.",
  },
  T2: {
    pass: "No traps found in the contract.",
    caution: "The contract keeps privileges worth watching.",
    fail: "The contract holds powers it should not.",
  },
  T3: {
    pass: "Trades clear cleanly, both directions.",
    caution: "The house takes a cut on the way through.",
    fail: "Selling costs more than it should.",
  },
  T4: {
    pass: "The supply is spread across real hands.",
    caution: "A few pockets hold more than is comfortable.",
    fail: "The supply sits concentrated in few hands.",
  },
  T5: {
    pass: "The trading reads real.",
    caution: "Parts of the tape look manufactured.",
    fail: "The volume does not survive inspection.",
  },
  T6: {
    pass: "Established, listed, and visible.",
    caution: "Young, with a footprint still forming.",
    fail: "Too new to have a record.",
  },
};

function factsFor(axisKey: string, d: TokenDossier): ChapterFact[] {
  const s = d.safety;
  const facts: ChapterFact[] = [];
  const push = (label: string, value: string | null | undefined, tone?: ChapterTone) => {
    if (value != null && value !== "") facts.push(tone ? { label, value, tone } : { label, value });
  };
  switch (axisKey) {
    case "T1": {
      push("Liquidity", money(d.liquidityUsd));
      if (s.lpBurnedPct > 0) push("LP burned", `${s.lpBurnedPct.toFixed(0)}%`, "pass");
      push(
        "LP lock",
        s.lpLocked ? `locked${s.lpLockedPct ? ` (${s.lpLockedPct.toFixed(0)}%)` : ""}` : "not confirmed",
        s.lpLocked ? "pass" : "caution",
      );
      if (s.lpTopUnlockedEoaPct > 0) {
        push("Largest unlocked LP holder", `${s.lpTopUnlockedEoaPct.toFixed(0)}%`, s.lpTopUnlockedEoaPct >= 20 ? "fail" : "caution");
      }
      break;
    }
    case "T2": {
      push(
        "Sell simulation",
        s.simChecked ? (s.honeypot || s.cannotSellAll ? "sell blocked" : "clean") : "not simulated",
        s.simChecked ? (s.honeypot || s.cannotSellAll ? "fail" : "pass") : "caution",
      );
      push("Supply mintable", s.mintable ? "yes" : "no", s.mintable ? "fail" : "pass");
      if (d.chain === "solana") push("Freeze authority", s.freezable ? "active" : "revoked", s.freezable ? "fail" : "pass");
      push("Ownership", s.ownerRenounced ? "renounced" : "held", s.ownerRenounced ? "pass" : "caution");
      push("Source code", s.openSource ? "published" : "unpublished", s.openSource ? "pass" : "caution");
      break;
    }
    case "T3": {
      push("Buy tax", `${s.buyTax}%`, s.buyTax > 5 ? "caution" : "pass");
      push("Sell tax", `${s.sellTax}%`, s.sellTax >= 15 ? "fail" : s.sellTax > 5 ? "caution" : "pass");
      break;
    }
    case "T4": {
      if (s.holderCount > 0) push("Holders", s.holderCount.toLocaleString());
      if (s.topHolderPct != null) {
        push("Top holder", `${s.topHolderPct.toFixed(0)}%`, s.topHolderPct > 25 ? "fail" : s.topHolderPct > 10 ? "caution" : "pass");
      }
      if (d.insiderPct > 0) push("Insider net", `${d.insiderPct}%`, d.insiderPct >= 25 ? "fail" : d.insiderPct >= 10 ? "caution" : "pass");
      push("Bundle risk", d.bundleRisk, d.bundleRisk === "high" ? "fail" : d.bundleRisk === "low" ? "pass" : "caution");
      break;
    }
    case "T5": {
      if (d.bundleCount > 0) push("Bundled buys at launch", String(d.bundleCount), d.bundleRisk === "high" ? "fail" : "caution");
      break;
    }
    case "T6": {
      if (d.ageDays != null) {
        push("Token age", d.ageDays < 1 ? "under a day" : `${Math.round(d.ageDays)} days`, d.ageDays < 7 ? "caution" : undefined);
      }
      push("Market cap", money(d.mcap));
      if (d.cg?.cexCount) push("Centralized exchanges", String(d.cg.cexCount), "pass");
      if (d.cg?.rank) push("Registry rank", `#${d.cg.rank}`);
      break;
    }
  }
  return facts;
}

/** The composition strip is the table of contents; these are the chapters. */
export function tokenDimensionChapters(d: TokenDossier): DimensionChapter[] {
  return orderByPlainAxis((d.axes ?? []).map((axis) => {
    const tone = band(axis.score, axis.weight);
    return {
      axis: axis.key,
      eyebrow: `${plainAxisLabel(axis.key, axis.label)} · ${axis.weight}% of the score`,
      headline: HEADLINES[axis.key]?.[tone]
        ?? (tone === "pass" ? `${axis.label}: no concerns recorded.` : tone === "caution" ? `${axis.label}: mixed.` : `${axis.label}: weak.`),
      score: axis.score,
      weight: axis.weight,
      tone,
      lead: axis.rationale,
      facts: factsFor(axis.key, d),
    };
  }));
}


const PERSON_HEADLINES: Record<string, Record<ChapterTone, string>> = {
  P1_team_and_identity: {
    pass: "The people behind this are on the record.",
    caution: "The team is only partly identified.",
    fail: "Who is behind this is still unresolved.",
  },
  P2_product_substance: {
    pass: "A real product is on the record.",
    caution: "The product is only partly evidenced.",
    fail: "What is built is still unresolved.",
  },
  P3_token_conduct: {
    pass: "Token conduct is recorded as clean.",
    caution: "Token conduct has open questions.",
    fail: "Token conduct is weak or unrecorded.",
  },
  P4_backing_and_partners: {
    pass: "Backing and partners are on the record.",
    caution: "Backing is only partly evidenced.",
    fail: "Backing and partners remain unresolved.",
  },
  P5_traction_and_liveness: {
    pass: "Signs of life are on the record.",
    caution: "Traction is only partly evidenced.",
    fail: "Signs of life remain unresolved.",
  },
  P6_transparency_integrity: {
    pass: "Disclosures are on the record.",
    caution: "Transparency is only partly evidenced.",
    fail: "Transparency remains unresolved.",
  },
};

const PERSON_LABELS: Record<string, string> = {
  P1_team_and_identity: "Team & identity",
  P2_product_substance: "Product substance",
  P3_token_conduct: "Token conduct",
  P4_backing_and_partners: "Backing & partners",
  P5_traction_and_liveness: "Traction & liveness",
  P6_transparency_integrity: "Transparency & integrity",
};

function personTone(tier: string): ChapterTone {
  if (tier === "exceptional" || tier === "solid") return "pass";
  if (tier === "emerging") return "caution";
  return "fail";
}

export interface PersonStrengthBandInput {
  tier?: string;
  minScore?: number;
  maxScore?: number;
  reasons?: string[];
}

/** Person/project chapters from recorded strength bands. Headline is chosen
 *  by the recorded tier; the lead is the engine's own reasons. */
export function personDimensionChapters(
  bands: Record<string, PersonStrengthBandInput> | undefined,
): DimensionChapter[] {
  if (!bands) return [];
  return Object.entries(bands)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([axis, band]) => {
      const tier = (band.tier ?? "").trim() || "unknown";
      const tone = personTone(tier);
      const label = PERSON_LABELS[axis] ?? axis.replace(/^P\d_/, "").replace(/_/g, " ");
      const min = band.minScore;
      const max = band.maxScore;
      const facts: ChapterFact[] = [];
      if (min != null && max != null && Number.isFinite(min) && Number.isFinite(max)) {
        facts.push({ label: "Recorded range", value: `${min}–${max}` });
      }
      if (tier && tier !== "unknown") {
        facts.push({ label: "Evidence strength", value: publicStrengthLabel(tier), tone });
      }
      return {
        axis,
        eyebrow: label,
        headline: PERSON_HEADLINES[axis]?.[tone]
          ?? (tone === "pass" ? `${label}: on the record.` : tone === "caution" ? `${label}: mixed.` : `${label}: unresolved.`),
        score: max ?? min ?? 0,
        weight: max ?? 0,
        tone,
        lead: (band.reasons ?? []).filter(Boolean).join(" "),
        facts,
      };
    });
}
