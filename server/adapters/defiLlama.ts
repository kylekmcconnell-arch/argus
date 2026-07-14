// DeFiLlama adapters: free, keyless enrichment from api.llama.fi.
//   - collectProtocolTvl:     total value locked + per-chain breakdown (the
//     on-chain usage metric CoinGecko market signals lack).
//   - collectProtocolFunding: public funding rounds + lead investors, curated by
//     DeFiLlama from press. Fills the backing/partners axis a diligence report
//     otherwise reports as "no verified funding rounds".
// Both read the same free /protocol/{slug} document (the dedicated /raises
// endpoint is paid; the embedded `raises` array is not). Additive, standalone
// collectors — the caller decides which evidence/check they feed.
import { recordCall } from "../cost";

const API_BASE = "https://api.llama.fi";

/** Best-effort DeFiLlama slug from a project name. Callers may pass an explicit slug. */
export function defiLlamaSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

type ProtocolDocument = {
  name?: unknown;
  symbol?: unknown;
  gecko_id?: unknown;
  currentChainTvls?: unknown;
  tvl?: unknown;
  raises?: unknown;
};

type FetchResult =
  | { ok: true; data: ProtocolDocument }
  | { ok: false; notFound: boolean; note: string };

/**
 * Fetch the free /protocol/{slug} document. Never throws. A 400 is a completed
 * "no such protocol" lookup (notFound), distinct from a transport/HTTP outage,
 * so callers can record it as a clean result rather than a provider failure.
 */
async function fetchProtocol(slug: string, fetcher: typeof fetch): Promise<FetchResult> {
  const url = `${API_BASE}/protocol/${encodeURIComponent(slug)}`;
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    return { ok: false, notFound: false, note: "DeFiLlama was unavailable." };
  }
  if (!response.ok) {
    const notFound = response.status === 400;
    return {
      ok: false,
      notFound,
      note: notFound ? `No DeFiLlama protocol matched "${slug}".` : "DeFiLlama request failed.",
    };
  }
  try {
    const data = ((await response.json()) ?? {}) as ProtocolDocument;
    return { ok: true, data };
  } catch {
    return { ok: false, notFound: false, note: "DeFiLlama response was unreadable." };
  }
}

const strArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];

// ---------------------------------------------------------------------------
// TVL
// ---------------------------------------------------------------------------

export interface ProtocolTvl {
  slug: string;
  name: string;
  symbol: string | null;
  tvlUsd: number;
  chains: string[];
  chainBreakdown: { chain: string; tvlUsd: number }[];
  geckoId: string | null;
  /** human-facing DeFiLlama page */
  sourceUrl: string;
}

export type TvlOutcome =
  | { available: true; value: ProtocolTvl }
  | { available: false; note: string };

// currentChainTvls mixes real chains with pseudo-segments (borrowed/staking/
// pool2/vesting/…). Exclude those so chainBreakdown is raw chain TVL only.
const NON_CHAIN_SEGMENT = /(?:^|[-])(?:borrowed|staking|pool2|vesting|treasury|offers|options)(?:$|[-])/i;

/** Fetch a protocol's current TVL and per-chain breakdown. Never throws. */
export async function collectProtocolTvl(
  projectName: string,
  options: { fetcher?: typeof fetch; slug?: string } = {},
): Promise<TvlOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName);
  if (!slug) return { available: false, note: "No resolvable DeFiLlama protocol slug." };

  const result = await fetchProtocol(slug, fetcher);
  if (!result.ok) {
    recordCall("defillama", "tvl", 0, `${slug} · ${result.notFound ? "not_found" : "error"}`, result.notFound ? "succeeded" : "failed");
    return { available: false, note: result.note };
  }
  const data = result.data;

  const series = Array.isArray(data.tvl) ? (data.tvl as { totalLiquidityUSD?: unknown }[]) : [];
  const latest = series.length ? series[series.length - 1] : undefined;
  const tvlUsd = typeof latest?.totalLiquidityUSD === "number" ? latest.totalLiquidityUSD : null;
  if (tvlUsd === null || !(tvlUsd > 0)) {
    recordCall("defillama", "tvl", 0, `${slug} · no_tvl`, "partial");
    return { available: false, note: "DeFiLlama returned no positive TVL for this protocol." };
  }

  const rawChainTvls =
    data.currentChainTvls && typeof data.currentChainTvls === "object"
      ? (data.currentChainTvls as Record<string, unknown>)
      : {};
  const chainBreakdown = Object.entries(rawChainTvls)
    .filter(([chain, value]) => typeof value === "number" && value > 0 && !NON_CHAIN_SEGMENT.test(chain))
    .map(([chain, value]) => ({ chain, tvlUsd: value as number }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd);

  recordCall("defillama", "tvl", 0, `${slug} · tvl_${Math.round(tvlUsd)}`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      name: typeof data.name === "string" ? data.name : projectName,
      symbol: typeof data.symbol === "string" ? data.symbol : null,
      tvlUsd,
      chains: chainBreakdown.map((entry) => entry.chain),
      chainBreakdown,
      geckoId: typeof data.gecko_id === "string" ? data.gecko_id : null,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Funding rounds / backing
// ---------------------------------------------------------------------------

export interface FundingRound {
  /** ISO date (YYYY-MM-DD) or null when DeFiLlama has no date */
  date: string | null;
  round: string;
  /** absolute USD (DeFiLlama reports amounts in millions) */
  amountUsd: number | null;
  leadInvestors: string[];
  otherInvestors: string[];
  valuationUsd: number | null;
}

export interface ProtocolFunding {
  slug: string;
  name: string;
  rounds: FundingRound[];
  /** sum of known round amounts */
  totalRaisedUsd: number;
  /** distinct lead investors across all rounds */
  leadInvestors: string[];
  sourceUrl: string;
}

export type FundingOutcome =
  | { available: true; value: ProtocolFunding }
  | { available: false; reason: "no_data" | "unavailable"; note: string };

type RaiseItem = {
  date?: unknown;
  round?: unknown;
  amount?: unknown;
  leadInvestors?: unknown;
  otherInvestors?: unknown;
  valuation?: unknown;
};

const millionsToUsd = (value: unknown): number | null =>
  typeof value === "number" && value > 0 ? Math.round(value * 1_000_000) : null;

/**
 * Collect a protocol's public funding rounds + lead investors from DeFiLlama's
 * curated raises data. Never throws. Distinguishes "provider unavailable" from
 * "no rounds on record" so a partial outage never reads as "unfunded".
 */
export async function collectProtocolFunding(
  projectName: string,
  options: { fetcher?: typeof fetch; slug?: string } = {},
): Promise<FundingOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName);
  if (!slug) return { available: false, reason: "no_data", note: "No resolvable DeFiLlama protocol slug." };

  const result = await fetchProtocol(slug, fetcher);
  if (!result.ok) {
    recordCall("defillama", "funding", 0, `${slug} · ${result.notFound ? "not_found" : "error"}`, result.notFound ? "succeeded" : "failed");
    return {
      available: false,
      reason: result.notFound ? "no_data" : "unavailable",
      note: result.note,
    };
  }

  const raw = Array.isArray(result.data.raises) ? (result.data.raises as RaiseItem[]) : [];
  const rounds: FundingRound[] = raw
    .map((entry) => {
      const dateSec = typeof entry.date === "number" ? entry.date : null;
      const round = typeof entry.round === "string" && entry.round.trim() ? entry.round.trim() : "Undisclosed round";
      return {
        date: dateSec ? new Date(dateSec * 1000).toISOString().slice(0, 10) : null,
        round,
        amountUsd: millionsToUsd(entry.amount),
        leadInvestors: strArray(entry.leadInvestors),
        otherInvestors: strArray(entry.otherInvestors),
        valuationUsd: millionsToUsd(entry.valuation),
      };
    })
    .sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));

  if (!rounds.length) {
    recordCall("defillama", "funding", 0, `${slug} · no_raises`, "succeeded");
    return { available: false, reason: "no_data", note: `No public funding rounds recorded for "${slug}" on DeFiLlama.` };
  }

  const leadInvestors = [...new Set(rounds.flatMap((round) => round.leadInvestors))];
  const totalRaisedUsd = rounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0);
  recordCall("defillama", "funding", 0, `${slug} · ${rounds.length}_rounds`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      name: typeof result.data.name === "string" ? result.data.name : projectName,
      rounds,
      totalRaisedUsd,
      leadInvestors,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
    },
  };
}

export interface FundingSummary {
  status: "confirmed" | "checked-empty" | "unavailable";
  note: string;
}

/** Map a funding outcome to a ScanCheck status + note for the wiring layer. */
export function describeFunding(outcome: FundingOutcome): FundingSummary {
  if (!outcome.available) {
    return { status: outcome.reason === "unavailable" ? "unavailable" : "checked-empty", note: outcome.note };
  }
  const { rounds, totalRaisedUsd, leadInvestors } = outcome.value;
  const leads = leadInvestors.slice(0, 4).join(", ");
  const total = totalRaisedUsd > 0 ? ` totaling ${formatUsd(totalRaisedUsd)}` : "";
  return {
    status: "confirmed",
    note: `${rounds.length} public funding round${rounds.length === 1 ? "" : "s"}${total}${leads ? `; lead investors incl. ${leads}` : ""}`,
  };
}

// ---------------------------------------------------------------------------

/** Compact USD, e.g. 13699712109 → "$13.7B". For evidence/traction strings. */
export function formatUsd(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

/** @deprecated alias for {@link formatUsd}; kept for existing callers. */
export const formatTvlUsd = formatUsd;
