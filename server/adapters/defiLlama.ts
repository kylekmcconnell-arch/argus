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
  governanceID?: unknown;
  hacks?: unknown;
  audits?: unknown;
  audit_links?: unknown;
  otherProtocols?: unknown;
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

export interface ProtocolHackRecord {
  /** ISO date (YYYY-MM-DD) or null when the record has no date */
  date: string | null;
  amountUsd: number | null;
  /** whether the record states the funds were returned */
  returnedFunds: boolean;
  classification: string | null;
}

export interface ProtocolTvl {
  slug: string;
  name: string;
  symbol: string | null;
  tvlUsd: number;
  chains: string[];
  chainBreakdown: { chain: string; tvlUsd: number }[];
  geckoId: string | null;
  /**
   * First date in DeFiLlama's TVL series. Phrase user-facing claims as "TVL
   * history since YYYY": the series start can be backfilled when an old
   * protocol is listed late, so it bounds, not proves, protocol age.
   */
  firstRecordedAt: string | null;
  /**
   * TVL now vs ~30 days ago, signed percent, from the same dated series.
   * Capital-commitment trend that complements the fee trend: rising fees with
   * bleeding TVL is a divergence a raw total hides. Null when the series is too
   * short or undated.
   */
  change30dPct: number | null;
  /**
   * Downsampled TVL trend for the report's chart: weekly points over the last
   * ~180 days plus the latest reading. Small enough to freeze immutably.
   */
  trend: { date: string; tvlUsd: number }[];
  /** Governance identifiers as listed by DeFiLlama (curated listing metadata, e.g. "snapshot:aave.eth", "eip155:1:0x..."). */
  governanceIds: string[];
  /**
   * Security incidents in the same DeFiLlama document. Frozen alongside the
   * positives from this payload: consuming a document for score-lifting
   * evidence while dropping its hack records would be selective evidence use.
   */
  hacks: ProtocolHackRecord[];
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

  const firstPoint = series.length ? (series[0] as { date?: unknown }) : undefined;
  const firstRecordedAt = typeof firstPoint?.date === "number"
    ? new Date(firstPoint.date * 1000).toISOString().slice(0, 10)
    : null;

  // 30-day trend from the same dated series. Requires a comparison point at
  // least ~20 days back (short/backfilled series yield null, never a guess);
  // the nearest point to exactly 30 days is used so daily gaps don't skew it.
  const latestDate = typeof (latest as { date?: unknown })?.date === "number" ? (latest as { date: number }).date : null;
  let change30dPct: number | null = null;
  if (latestDate !== null) {
    const target = latestDate - 30 * 86_400;
    let prior: { date: number; totalLiquidityUSD: number } | null = null;
    for (const point of series as { date?: unknown; totalLiquidityUSD?: unknown }[]) {
      if (typeof point.date !== "number" || typeof point.totalLiquidityUSD !== "number" || point.totalLiquidityUSD <= 0) continue;
      if (point.date > latestDate - 20 * 86_400) break; // too recent to be a 30d baseline
      if (!prior || Math.abs(point.date - target) < Math.abs(prior.date - target)) {
        prior = { date: point.date, totalLiquidityUSD: point.totalLiquidityUSD };
      }
    }
    if (prior) {
      const raw = ((tvlUsd - prior.totalLiquidityUSD) / prior.totalLiquidityUSD) * 100;
      change30dPct = Number.isFinite(raw) && Math.abs(raw) <= 10_000 ? Math.round(raw * 10) / 10 : null;
    }
  }
  // Weekly trend points over the last ~180 days, always ending on the latest
  // reading, so the report can draw a real capital-commitment line instead of
  // quoting one number. Downsampled to keep the immutable payload lean.
  const trend: { date: string; tvlUsd: number }[] = [];
  if (latestDate !== null) {
    const horizon = latestDate - 180 * 86_400;
    let nextAt = -Infinity;
    for (const point of series as { date?: unknown; totalLiquidityUSD?: unknown }[]) {
      if (typeof point.date !== "number" || typeof point.totalLiquidityUSD !== "number" || point.totalLiquidityUSD <= 0) continue;
      if (point.date < horizon || (point.date < nextAt && point.date !== latestDate)) continue;
      trend.push({ date: new Date(point.date * 1000).toISOString().slice(0, 10), tvlUsd: Math.round(point.totalLiquidityUSD) });
      nextAt = point.date + 7 * 86_400;
    }
    const latestIso = new Date(latestDate * 1000).toISOString().slice(0, 10);
    if (trend.length && trend[trend.length - 1].date !== latestIso) {
      trend.push({ date: latestIso, tvlUsd: Math.round(tvlUsd) });
    }
  }

  const hacks: ProtocolHackRecord[] = (Array.isArray(data.hacks) ? data.hacks : [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      date: typeof entry.date === "number" ? new Date(entry.date * 1000).toISOString().slice(0, 10) : null,
      amountUsd: typeof entry.amount === "number" && entry.amount > 0 ? Math.round(entry.amount) : null,
      returnedFunds: entry.returnedFunds === true,
      classification: typeof entry.classification === "string" ? entry.classification : null,
    }));

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
      firstRecordedAt,
      change30dPct,
      trend,
      governanceIds: strArray(data.governanceID),
      hacks,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Audit links (candidate URLs for the security-audit collector)
// ---------------------------------------------------------------------------

export interface ProtocolAuditLinks {
  slug: string;
  /** DeFiLlama's listed audit count, when present. Project-submitted listing metadata: a corroborating lead, never verification. */
  auditCount: number | null;
  /** Listed audit/security page URLs. Candidates for the first-party fetch, not evidence by themselves. */
  auditLinks: string[];
}

export type AuditLinksOutcome =
  | { available: true; value: ProtocolAuditLinks }
  | { available: false; note: string };

const parseAuditFields = (data: ProtocolDocument): { count: number | null; links: string[] } => ({
  count: typeof data.audits === "string" && /^\d+$/.test(data.audits.trim())
    ? Number(data.audits.trim())
    : typeof data.audits === "number" && data.audits >= 0 ? data.audits : null,
  links: strArray(data.audit_links).filter((link) => /^https?:\/\//i.test(link)),
});

/**
 * Resolve DeFiLlama-listed audit links for a protocol. Parent documents often
 * carry audits:null while version children (aave-v3) hold the links, so when
 * the parent is empty the first few otherProtocols children are checked (one
 * free GET each, capped). Never throws.
 */
export async function collectProtocolAuditLinks(
  projectName: string,
  options: { fetcher?: typeof fetch; slug?: string; maxChildren?: number } = {},
): Promise<AuditLinksOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName);
  if (!slug) return { available: false, note: "No resolvable DeFiLlama protocol slug." };
  const parent = await fetchProtocol(slug, fetcher);
  if (!parent.ok) {
    recordCall("defillama", "audit-links", 0, `${slug} · ${parent.notFound ? "not_found" : "error"}`, parent.notFound ? "succeeded" : "failed");
    return { available: false, note: parent.note };
  }
  const fromParent = parseAuditFields(parent.data);
  if (fromParent.links.length) {
    recordCall("defillama", "audit-links", 0, `${slug} · ${fromParent.links.length}_links`, "succeeded");
    return { available: true, value: { slug, auditCount: fromParent.count, auditLinks: fromParent.links } };
  }
  const children = strArray(parent.data.otherProtocols)
    .map((name) => defiLlamaSlug(name))
    .filter((child) => child && child !== slug)
    .slice(0, options.maxChildren ?? 3);
  for (const child of children) {
    const doc = await fetchProtocol(child, fetcher);
    if (!doc.ok) continue;
    const fields = parseAuditFields(doc.data);
    if (fields.links.length) {
      recordCall("defillama", "audit-links", 0, `${slug}->${child} · ${fields.links.length}_links`, "succeeded");
      return { available: true, value: { slug: child, auditCount: fields.count, auditLinks: fields.links } };
    }
  }
  recordCall("defillama", "audit-links", 0, `${slug} · none`, "succeeded");
  return { available: false, note: "No audit links listed on DeFiLlama for this protocol." };
}

// ---------------------------------------------------------------------------
// Protocol fees (real usage: what users actually paid)
// ---------------------------------------------------------------------------

export interface ProtocolFees {
  slug: string;
  /** fees paid by users over the trailing 24 hours, USD */
  total24hUsd: number | null;
  /** fees paid by users over the trailing 30 days, USD */
  total30dUsd: number | null;
  /**
   * Trailing-30d fees vs the PRIOR 30d, as a signed percent (DeFiLlama's
   * change_30dover30d). The trend answers the diligence question a raw total
   * cannot: is real usage growing or bleeding? Null when the endpoint omits it.
   */
  change30dOver30dPct: number | null;
  sourceUrl: string;
}

export type FeesOutcome =
  | { available: true; value: ProtocolFees }
  | { available: false; note: string };

/**
 * Fetch protocol fee totals from the free /summary/fees/{slug} endpoint.
 * Fees are on-chain-derived and self-limiting to fake (generating fee volume
 * costs the same amount in fees), which is what makes them an honest traction
 * signal. Never throws.
 */
export async function collectProtocolFees(
  projectName: string,
  options: { fetcher?: typeof fetch; slug?: string } = {},
): Promise<FeesOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName);
  if (!slug) return { available: false, note: "No resolvable DeFiLlama protocol slug." };
  const url = `${API_BASE}/summary/fees/${encodeURIComponent(slug)}`;
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    recordCall("defillama", "fees", 0, `${slug} · error`, "failed");
    return { available: false, note: "DeFiLlama fees endpoint was unavailable." };
  }
  if (!response.ok) {
    recordCall("defillama", "fees", 0, `${slug} · http_${response.status}`, response.status === 400 ? "succeeded" : "failed");
    return { available: false, note: `No DeFiLlama fee record for "${slug}".` };
  }
  let payload: { total24h?: unknown; total30d?: unknown; change_30dover30d?: unknown };
  try {
    payload = ((await response.json()) ?? {}) as { total24h?: unknown; total30d?: unknown; change_30dover30d?: unknown };
  } catch {
    return { available: false, note: "DeFiLlama fees response was unreadable." };
  }
  const total24hUsd = typeof payload.total24h === "number" && payload.total24h >= 0 ? Math.round(payload.total24h) : null;
  const total30dUsd = typeof payload.total30d === "number" && payload.total30d >= 0 ? Math.round(payload.total30d) : null;
  // Period-over-period trend; only a finite, sane percent survives (a listing
  // gap can produce absurd multiples, which would mislead rather than inform).
  const change30dOver30dPct = typeof payload.change_30dover30d === "number"
    && Number.isFinite(payload.change_30dover30d)
    && Math.abs(payload.change_30dover30d) <= 10_000
    ? Math.round(payload.change_30dover30d * 10) / 10
    : null;
  if (total24hUsd === null && total30dUsd === null) {
    recordCall("defillama", "fees", 0, `${slug} · no_totals`, "succeeded");
    return { available: false, note: "DeFiLlama reported no fee totals for this protocol." };
  }
  recordCall("defillama", "fees", 0, `${slug} · fees30d_${total30dUsd ?? 0}`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      total24hUsd,
      total30dUsd,
      change30dOver30dPct,
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
  const abs = Math.abs(usd);
  const unit = abs >= 1_000_000_000_000 ? [1_000_000_000_000, "T"] as const
    : abs >= 1_000_000_000 ? [1_000_000_000, "B"] as const
      : abs >= 1_000_000 ? [1_000_000, "M"] as const
        : abs >= 1_000 ? [1_000, "K"] as const
          : null;
  if (!unit) return `$${Math.round(usd)}`;
  const scaled = usd / unit[0];
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `$${scaled.toFixed(digits)}${unit[1]}`;
}

/** @deprecated alias for {@link formatUsd}; kept for existing callers. */
export const formatTvlUsd = formatUsd;
