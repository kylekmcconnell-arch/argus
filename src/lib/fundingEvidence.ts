export interface FundingEvidenceSource {
  url?: string;
  title?: string;
  excerpt?: string;
  provider?: string;
  sourceClass?: string;
}

export interface FundingEvidenceFact {
  predicate: string;
  value?: unknown;
  status: string;
  providerProjection?: boolean;
  sources?: FundingEvidenceSource[];
}

export interface FundingEvidenceRound {
  date: string | null;
  round: string;
  amountUsd: number | null;
  leadInvestors: string[];
  otherInvestors: string[];
  valuationUsd: number | null;
}

export interface FundingEvidenceSummary {
  rounds: FundingEvidenceRound[];
  totalKnownUsd: number;
  independentRoundCount: number;
  independentSourceCount: number;
}

const STRONG_SOURCE_CLASSES = new Set([
  "independent_press",
  "official_subject",
  "official_counterparty",
  "regulatory_or_onchain",
]);

const compact = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const normalizedRound = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function moneyAmounts(text: string): number[] {
  const amounts: number[] = [];
  const pattern = /(?:US\s*)?\$\s*([\d,.]+)\s*(trillion|billion|million|thousand|[TBMK])\b/gi;
  for (const match of text.matchAll(pattern)) {
    const numeric = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const unit = match[2].toLowerCase();
    const multiplier = unit === "trillion" || unit === "t"
      ? 1e12
      : unit === "billion" || unit === "b"
        ? 1e9
        : unit === "million" || unit === "m"
          ? 1e6
          : 1e3;
    const start = Math.max(0, (match.index ?? 0) - 70);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 70);
    const context = text.slice(start, end);
    const immediateBefore = text.slice(Math.max(0, (match.index ?? 0) - 35), match.index ?? 0);
    const immediateAfter = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 35);
    if (
      /\b(?:valued|valuation|post-money|pre-money)(?:\s+at)?\s*$/i.test(immediateBefore)
      || /^\s*(?:post-money|pre-money)?\s*valuation\b/i.test(immediateAfter)
      || (/\bvaluation\b/i.test(context)
        && !/\b(?:rais(?:e[ds]?|ing)|fund(?:ed|ing)?|secur(?:e[ds]?|ing)|round|financing|investment)\b/i.test(context))
    ) {
      continue;
    }
    amounts.push(Math.round(numeric * multiplier));
  }
  return amounts;
}

function roundLabel(text: string): string {
  const match = text.match(/\b(pre[- ]seed|seed|series\s+[a-z]|strategic(?:\s+(?:round|investment))?|private token sale|public token sale|initial coin offering|ico|angel)\b/i);
  if (!match) return "Disclosed financing";
  return match[1]
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bIco\b/, "ICO");
}

function leadInvestor(text: string): string | null {
  const titleMatch = text.match(/\bin\s+([^.;:]{2,80}?)[- ]led\s+(?:round|raise|financing)\b/i);
  const proseMatch = text.match(/\b(?:co-)?led\s+by\s+([^.;]{2,100}?)(?=,\s+(?:with|alongside|including)\b|$)/i);
  const raw = compact(titleMatch?.[1] ?? proseMatch?.[1]);
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(?:the\s+)?(?:crypto[- ]focused\s+)?(?:venture capital\s+|investment\s+|asset management\s+)?(?:firm|company)\s+/i, "")
    .replace(/\s+(?:and|alongside)\s+.*$/i, "")
    .replace(/[,–-]+$/g, "")
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 80 ? cleaned : null;
}

function sourceEventDate(sources: readonly FundingEvidenceSource[]): string | null {
  for (const source of sources) {
    const pathDate = compact(source.url).match(/\/((?:19|20)\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/|$)/);
    if (pathDate) {
      return `${pathDate[1]}-${pathDate[2].padStart(2, "0")}-${pathDate[3].padStart(2, "0")}`;
    }
  }
  return null;
}

function strongSources(fact: FundingEvidenceFact): FundingEvidenceSource[] {
  if (
    fact.predicate !== "funding"
    || fact.providerProjection === true
    || (fact.status !== "verified" && fact.status !== "corroborated")
  ) return [];
  return (fact.sources ?? []).filter((source) =>
    source.provider !== "defillama"
    && source.provider !== "monid"
    && STRONG_SOURCE_CLASSES.has(source.sourceClass ?? "")
    && Boolean(source.url));
}

function roundFromFact(fact: FundingEvidenceFact): FundingEvidenceRound | null {
  const sources = strongSources(fact);
  if (!sources.length) return null;
  const corpus = [compact(fact.value), ...sources.flatMap((source) => [compact(source.title), compact(source.excerpt)])]
    .filter(Boolean)
    .join(". ");
  const amounts = moneyAmounts(corpus);
  if (!amounts.length) return null;
  const lead = leadInvestor(corpus);
  return {
    date: sourceEventDate(sources),
    round: roundLabel(corpus),
    amountUsd: Math.max(...amounts),
    leadInvestors: lead ? [lead] : [],
    otherInvestors: [],
    valuationUsd: null,
  };
}

/**
 * Build a conservative financing view from the frozen snapshot. Independent
 * source-backed rounds govern same-name aggregator rows, while distinct
 * indexed rounds remain visible. The total is always a documented lower
 * bound, never an assertion that every financing event was found.
 */
export function summarizeFundingEvidence(
  facts: readonly FundingEvidenceFact[],
  indexedRounds: readonly FundingEvidenceRound[] = [],
): FundingEvidenceSummary {
  const independentRows = facts
    .map((fact) => ({ fact, round: roundFromFact(fact), sources: strongSources(fact) }))
    .filter((entry): entry is { fact: FundingEvidenceFact; round: FundingEvidenceRound; sources: FundingEvidenceSource[] } =>
      entry.round !== null);
  const independentByRound = new Map<string, FundingEvidenceRound>();
  for (const entry of independentRows) {
    const key = normalizedRound(entry.round.round);
    const prior = independentByRound.get(key);
    if (!prior || (entry.round.amountUsd ?? 0) > (prior.amountUsd ?? 0)) {
      independentByRound.set(key, entry.round);
    }
  }

  const merged = [...independentByRound.values()];
  for (const indexed of indexedRounds) {
    const genericRound = !indexed.round.trim() || /^undisclosed round$/i.test(indexed.round.trim());
    if (genericRound && !indexed.amountUsd && !indexed.valuationUsd) continue;
    const roundKey = normalizedRound(indexed.round);
    const amountDuplicate = merged.some((candidate) =>
      candidate.amountUsd !== null
      && indexed.amountUsd !== null
      && candidate.amountUsd === indexed.amountUsd);
    if (independentByRound.has(roundKey) || amountDuplicate) continue;
    merged.push({
      ...indexed,
      leadInvestors: [...indexed.leadInvestors],
      otherInvestors: [...indexed.otherInvestors],
    });
  }
  merged.sort((left, right) => String(left.date ?? "").localeCompare(String(right.date ?? "")));

  const independentUrls = new Set(independentRows.flatMap((entry) =>
    entry.sources.map((source) => source.url).filter((url): url is string => Boolean(url))));
  return {
    rounds: merged,
    totalKnownUsd: merged.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0),
    independentRoundCount: independentByRound.size,
    independentSourceCount: independentUrls.size,
  };
}
