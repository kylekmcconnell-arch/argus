import type { Dossier } from "../data/dossier";
import { isExactDomainBoundCompanyEnrichment } from "./diligenceEvidenceBinding";
import { launchVenueNames } from "../threat/launch";

/** Same registrable site, ignoring scheme, www and path. */
function sameRegistrableHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const host = (value: string | null | undefined): string => {
    if (!value) return "";
    try {
      return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
        .hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  };
  const left = host(a);
  return left !== "" && left === host(b);
}

// Fundraising & backers: one merged, chronological read of every identity-bound
// funding record frozen with the report (DeFiLlama, CryptoRank, Monid/Akta),
// with each round carrying its own source. Aggregator indexes are discovery
// records, never a cap table: totals are floors, absent fields are "not stated
// by the index", and a backer classification is a read of the backer's NAME
// and the venue registry, stated as such.

export interface FundraisingRound {
  /** "YYYY-MM-DD", a bare "YYYY", or null when no index dated the round. */
  date: string | null;
  label: string;
  amountUsd: number | null;
  valuationUsd: number | null;
  tokenPriceUsd?: number | null;
  tokensForSale?: number | null;
  allocationOfSupplyPct?: number | null;
  leadInvestors: string[];
  otherInvestors: string[];
  /**
   * What the round sold, as far as the index states it. Crypto-native indexes
   * record token sales; when a round carries explicit token terms it reads
   * "token_sale", otherwise the instrument is honestly "unstated" (these
   * indexes do not distinguish equity from SAFT-plus-warrant rounds).
   */
  instrument: "token_sale" | "unstated";
  announcementUrl?: string | null;
  sources: Array<{ provider: string; title: string; url: string }>;
}

const roundKey = (date: string | null, amountUsd: number | null): string => {
  const month = date ? date.slice(0, 7) : "undated";
  // Two indexes rarely disagree on a round's order of magnitude; a coarse
  // bucket merges "the $2.5M seed" across sources without merging distinct rounds.
  const bucket = amountUsd && amountUsd > 0 ? Math.round(Math.log10(amountUsd) * 4) : 0;
  return `${month}|${bucket}`;
};

/** Merge every frozen funding record into one chronological round list. */
export function mergeFundraisingRounds(dossier: Pick<Dossier, "protocolFunding" | "cryptoRankFunding" | "companyEnrichment" | "website">): FundraisingRound[] {
  const merged = new Map<string, FundraisingRound>();
  const add = (round: FundraisingRound) => {
    const key = roundKey(round.date, round.amountUsd);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, round);
      return;
    }
    // Same event seen by another index: keep the richer record (the one that
    // states more terms), union sources and backers, and never let a merge
    // invent a field neither index stated.
    const richness = (candidate: FundraisingRound): number =>
      (candidate.tokenPriceUsd ? 1 : 0)
      + (candidate.tokensForSale ? 1 : 0)
      + (candidate.allocationOfSupplyPct ? 1 : 0)
      + (candidate.valuationUsd ? 1 : 0)
      + (candidate.date ? 1 : 0);
    const richer = richness(round) > richness(existing) ? round : existing;
    const other = richer === existing ? round : existing;
    const tokenPriceUsd = richer.tokenPriceUsd ?? other.tokenPriceUsd ?? null;
    const tokensForSale = richer.tokensForSale ?? other.tokensForSale ?? null;
    const allocationOfSupplyPct = richer.allocationOfSupplyPct ?? other.allocationOfSupplyPct ?? null;
    const leadInvestors = [...new Set([...richer.leadInvestors, ...other.leadInvestors])];
    merged.set(key, {
      ...richer,
      date: richer.date ?? other.date,
      amountUsd: richer.amountUsd ?? other.amountUsd,
      valuationUsd: richer.valuationUsd ?? other.valuationUsd,
      tokenPriceUsd,
      tokensForSale,
      allocationOfSupplyPct,
      instrument: tokenPriceUsd || tokensForSale || allocationOfSupplyPct ? "token_sale" : "unstated",
      leadInvestors,
      otherInvestors: [...new Set([...richer.otherInvestors, ...other.otherInvestors])]
        .filter((name) => !leadInvestors.includes(name)),
      announcementUrl: richer.announcementUrl ?? other.announcementUrl,
      sources: [...richer.sources, ...other.sources.filter((source) => !richer.sources.some((existingSource) => existingSource.url === source.url))],
    });
  };

  for (const round of dossier.protocolFunding?.rounds ?? []) {
    add({
      date: round.date,
      label: round.round,
      amountUsd: round.amountUsd,
      valuationUsd: round.valuationUsd,
      leadInvestors: [...round.leadInvestors],
      otherInvestors: [...round.otherInvestors],
      instrument: "unstated",
      sources: [{ provider: "defillama", title: "DeFiLlama funding record", url: dossier.protocolFunding!.sourceUrl }],
    });
  }
  for (const round of dossier.cryptoRankFunding?.rounds ?? []) {
    add({
      date: round.date,
      label: round.stage,
      amountUsd: round.amountUsd,
      valuationUsd: round.valuationUsd,
      tokenPriceUsd: round.tokenPriceUsd ?? null,
      tokensForSale: round.tokensForSale ?? null,
      allocationOfSupplyPct: round.allocationOfSupplyPct ?? null,
      leadInvestors: [...round.leadInvestors],
      otherInvestors: [...round.otherInvestors],
      instrument: round.tokenPriceUsd || round.tokensForSale || round.allocationOfSupplyPct ? "token_sale" : "unstated",
      announcementUrl: round.announcementUrl,
      sources: [{ provider: "cryptorank", title: "CryptoRank funding record", url: dossier.cryptoRankFunding!.sourceUrl }],
    });
  }
  const enrichment = dossier.companyEnrichment;
  if (enrichment?.funding && isExactDomainBoundCompanyEnrichment(enrichment, dossier.website ?? null)) {
    for (const round of enrichment.funding.rounds) {
      add({
        date: round.date ?? null,
        label: round.round ?? "Round",
        amountUsd: round.amountUsd ?? null,
        valuationUsd: null,
        leadInvestors: [...(round.leadInvestors ?? [])],
        otherInvestors: [...(round.otherInvestors ?? [])],
        instrument: "unstated",
        // The enrichment's sourceUrl is frequently the company's own website
        // (that is how the record was bound to the company). Saying "funding
        // record" over a link to the subject's homepage presents first-party
        // evidence as a provider receipt (ARGUS-18).
        sources: [{
          provider: "monid",
          title: sameRegistrableHost(enrichment.sourceUrl, dossier.website ?? null)
            ? "Monid/Akta record · opens the company's own site, not a provider receipt"
            : "Monid/Akta funding record",
          url: enrichment.sourceUrl,
        }],
      });
    }
  }
  // A round that states neither an amount, a valuation, nor token terms is
  // aggregator relationship residue, not a financing event (the false "led by
  // BlackRock" Uniswap row was exactly this shape). The fact layer already
  // refuses to project such rows; this section refuses to render them.
  return [...merged.values()]
    .filter((round) => round.amountUsd || round.valuationUsd || round.tokenPriceUsd || round.tokensForSale)
    .sort((left, right) => (left.date ?? "9999").localeCompare(right.date ?? "9999"));
}

export type BackerType = "launchpad" | "angel" | "family_office" | "private_equity" | "venture_fund" | "platform" | "backer";

export const BACKER_TYPE_LABEL: Record<BackerType, string> = {
  launchpad: "Launchpad",
  angel: "Angel",
  family_office: "Family office",
  private_equity: "Private equity",
  venture_fund: "Venture fund",
  platform: "Platform",
  backer: "Backer",
};

/**
 * Classify a backer by its NAME and the launch-venue registry. This is a
 * reading aid over an aggregator attribution, not a verified fact about the
 * entity; the panel says so.
 */
export function classifyBacker(name: string): BackerType {
  const clean = name.trim().toLowerCase();
  if (!clean) return "backer";
  if (launchVenueNames().some((venue) => venue.toLowerCase() === clean)) return "launchpad";
  if (/\bfamily office\b/.test(clean)) return "family_office";
  if (/\bprivate equity\b/.test(clean)) return "private_equity";
  if (/\bangel\b/.test(clean)) return "angel";
  if (/\b(?:capital|ventures?|partners|fund|holdings|labs|crypto|digital|management)\b/.test(clean)) return "venture_fund";
  if (/\b(?:exchange|launchpad|platform|foundation)\b/.test(clean)) return "platform";
  return "backer";
}

export interface FundraisingTrajectory {
  roundCount: number;
  firstDate: string | null;
  lastDate: string | null;
  totalDisclosedUsd: number;
  /** Direction across consecutive rounds that both state a valuation. */
  valuationDirection: "rising" | "falling" | "mixed" | "insufficient";
}

/** The subject's own fundraising pattern: cadence, count, valuation direction. */
export function fundraisingTrajectory(rounds: FundraisingRound[]): FundraisingTrajectory {
  const dated = rounds.filter((round) => round.date);
  const valued = rounds.filter((round) => round.valuationUsd && round.valuationUsd > 0);
  let rising = 0;
  let falling = 0;
  for (let i = 1; i < valued.length; i += 1) {
    if (valued[i].valuationUsd! > valued[i - 1].valuationUsd!) rising += 1;
    else if (valued[i].valuationUsd! < valued[i - 1].valuationUsd!) falling += 1;
  }
  return {
    roundCount: rounds.length,
    firstDate: dated[0]?.date ?? null,
    lastDate: dated.length ? dated[dated.length - 1].date : null,
    totalDisclosedUsd: rounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0),
    valuationDirection: valued.length < 2 ? "insufficient" : falling === 0 ? "rising" : rising === 0 ? "falling" : "mixed",
  };
}
