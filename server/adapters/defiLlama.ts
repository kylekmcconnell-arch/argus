// DeFiLlama adapters: free, keyless enrichment from api.llama.fi.
//   - collectProtocolTvl:     total value locked + per-chain breakdown (the
//     on-chain usage metric CoinGecko market signals lack).
//   - collectProtocolFunding: public funding rounds + lead investors, curated by
//     DeFiLlama from press. Fills the backing/partners axis a diligence report
//     otherwise reports as "no verified funding rounds".
// Both read the same free /protocol/{slug} document (the dedicated /raises
// endpoint is paid; the embedded `raises` array is not). Additive, standalone
// collectors — the caller decides which evidence/check they feed.
import { recordCall, type ProviderUsageStatus } from "../cost";
import { captureTimestamp } from "../captureTime";
import { auditMemo } from "../auditRunContext";

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

/**
 * CoinGecko commonly names an asset "{Brand} Protocol" while DeFiLlama uses
 * the shorter brand slug (Drift Protocol -> drift). Strip only that generic
 * suffix. This produces a discovery slug only. The returned protocol document
 * still needs an exact hard-anchor receipt before any evidence is admitted.
 */
export function defiLlamaLookupName(name: string): string {
  const normalized = name.trim();
  return normalized.replace(/\s+protocol$/i, "").trim() || normalized;
}

type ProtocolDocument = {
  name?: unknown;
  symbol?: unknown;
  gecko_id?: unknown;
  address?: unknown;
  chain?: unknown;
  chains?: unknown;
  url?: unknown;
  twitter?: unknown;
  currentChainTvls?: unknown;
  tvl?: unknown;
  raises?: unknown;
  governanceID?: unknown;
  hacks?: unknown;
  audits?: unknown;
  audit_links?: unknown;
  otherProtocols?: unknown;
};

// ---------------------------------------------------------------------------
// One document, one read
// ---------------------------------------------------------------------------

/*
 * collectProtocolTvl, collectProtocolFunding and collectProtocolAuditLinks all
 * read the SAME free /protocol/{slug} document, so one recorded Uniswap scan
 * pulled 1.86 MB three times: 5.6 MB of redundant transfer into a serverless
 * function for a document that had not changed between the reads. Reads are
 * coalesced on the full URL. A caller that arrives while a read is outstanding
 * awaits that read; a caller that arrives just after it lands reuses the parsed
 * document.
 *
 * Only a SUCCESS is ever retained. Memoising a failure would freeze one provider
 * blip into "no funding rounds on record" for every later caller in the run,
 * turning a transport gap into a clean-looking absence, which is the one thing
 * this adapter's outcome types exist to prevent. A completed 400/404 no-match is
 * not retained either: it is cheap to re-ask and worth nothing to keep.
 *
 * Retention is deliberately short. It spans one scan's enrichment burst and
 * nothing longer, so a document cannot carry from one subject's audit into
 * another's, and resetDefiLlamaScanMemo() gives a caller with a real scan
 * boundary a hard one.
 */
const SCAN_MEMO_MS = 30_000;

type JsonRead =
  | { ok: true; data: unknown; fromMemo: boolean; capturedAt: string }
  | { ok: false; kind: "transport" | "http" | "unreadable"; status: number | null };

interface MemoSlot {
  /** the one outstanding read; cleared the moment it settles */
  inFlight?: Promise<JsonRead>;
  /** a settled SUCCESS only, with the moment it landed */
  settled?: { at: number; data: unknown; capturedAt: string };
}

const currentScanMemo = () => auditMemo<MemoSlot>("defillama:documents");

/** Forget every memoised document. Callers with a real scan boundary call this at its start. */
export function resetDefiLlamaScanMemo(): void {
  currentScanMemo().clear();
}

/** A document served from the memo cost no provider attempt, and the ledger says so. */
const readStatus = (fromMemo: boolean, live: ProviderUsageStatus): ProviderUsageStatus =>
  (fromMemo ? "cached" : live);

/** One GET of a free JSON endpoint. Never throws; classifies its own failure mode. */
async function readJson(url: string, fetcher: typeof fetch): Promise<JsonRead> {
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    return { ok: false, kind: "transport", status: null };
  }
  if (!response.ok) return { ok: false, kind: "http", status: response.status };
  try {
    const data = (await response.json()) ?? {};
    return { ok: true, data, fromMemo: false, capturedAt: captureTimestamp() };
  } catch {
    return { ok: false, kind: "unreadable", status: response.status };
  }
}

async function fetchJsonOnce(url: string, fetcher: typeof fetch): Promise<JsonRead> {
  const scanMemo = currentScanMemo();
  const now = Date.now();
  for (const [key, slot] of scanMemo) {
    if (!slot.inFlight && (!slot.settled || now - slot.settled.at >= SCAN_MEMO_MS)) scanMemo.delete(key);
  }

  const existing = scanMemo.get(url);
  if (existing?.settled) {
    return {
      ok: true,
      data: existing.settled.data,
      fromMemo: true,
      capturedAt: existing.settled.capturedAt,
    };
  }
  if (existing?.inFlight) {
    const shared = await existing.inFlight;
    // A joiner made no request of its own, whatever the shared read returned.
    return shared.ok
      ? { ok: true, data: shared.data, fromMemo: true, capturedAt: shared.capturedAt }
      : shared;
  }

  // The stored promise is the already-guarded one: readJson does not reject, but
  // a joiner must never be handed a rejection it cannot classify.
  const inFlight = readJson(url, fetcher).catch((): JsonRead => ({ ok: false, kind: "transport", status: null }));
  scanMemo.set(url, { inFlight });
  const read = await inFlight;
  if (read.ok) {
    scanMemo.set(url, { settled: { at: Date.now(), data: read.data, capturedAt: read.capturedAt } });
  }
  else scanMemo.delete(url);
  return read;
}

type FetchResult =
  | { ok: true; data: ProtocolDocument; fromMemo: boolean; capturedAt: string }
  | { ok: false; notFound: boolean; note: string };

/**
 * Fetch the free /protocol/{slug} document. Never throws. A 400/404 is a completed
 * "no such protocol" lookup (notFound), distinct from a transport/HTTP outage,
 * so callers can record it as a clean result rather than a provider failure.
 */
async function fetchProtocol(slug: string, fetcher: typeof fetch): Promise<FetchResult> {
  const read = await fetchJsonOnce(`${API_BASE}/protocol/${encodeURIComponent(slug)}`, fetcher);
  if (read.ok) {
    return {
      ok: true,
      data: (read.data ?? {}) as ProtocolDocument,
      fromMemo: read.fromMemo,
      capturedAt: read.capturedAt,
    };
  }
  if (read.kind === "transport") return { ok: false, notFound: false, note: "DeFiLlama was unavailable." };
  if (read.kind === "unreadable") return { ok: false, notFound: false, note: "DeFiLlama response was unreadable." };
  const notFound = read.status === 400 || read.status === 404;
  return {
    ok: false,
    notFound,
    note: notFound ? `No DeFiLlama protocol matched "${slug}".` : "DeFiLlama request failed.",
  };
}

const strArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PROTOCOL_CHAIN_ALIASES: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  arbitrum: "arbitrum",
  arbitrumone: "arbitrum",
  base: "base",
  binancesmartchain: "bsc",
  bsc: "bsc",
  polygon: "polygon",
  polygonpos: "polygon",
  optimism: "optimism",
  optimisticethereum: "optimism",
  avalanche: "avalanche",
  avax: "avalanche",
  solana: "solana",
  robinhood: "robinhood",
  robinhoodchain: "robinhood",
};

export interface ProtocolContractIdentity {
  chain: string;
  address: string;
}

export interface ProtocolIdentity {
  slug: string;
  name: string;
  symbol: string | null;
  geckoId: string | null;
  contracts: ProtocolContractIdentity[];
  officialX: string | null;
  website: string | null;
  sourceUrl: string;
  capturedAt: string;
}

export type ProtocolIdentityOutcome =
  | { state: "resolved"; value: ProtocolIdentity }
  | { state: "no_record"; slug: string; note: string }
  | { state: "unavailable"; slug: string; note: string };

export function normalizeProtocolChain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return PROTOCOL_CHAIN_ALIASES[key] ?? null;
}

function validProtocolAddress(chain: string, address: string): boolean {
  return chain === "solana" ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
}

function protocolContracts(data: ProtocolDocument): ProtocolContractIdentity[] {
  const rawAddresses = typeof data.address === "string"
    ? [data.address.trim()]
    : strArray(data.address);
  const listedChains = [
    ...(typeof data.chain === "string" ? [data.chain] : []),
    ...strArray(data.chains),
  ]
    .map(normalizeProtocolChain)
    .filter((chain): chain is string => Boolean(chain));
  const uniqueChains = [...new Set(listedChains)];
  const contracts: ProtocolContractIdentity[] = [];

  for (const raw of rawAddresses) {
    if (!raw) continue;
    let address = raw;
    let chain: string | null = null;
    const separator = raw.indexOf(":");
    if (separator > 0) {
      const prefixedChain = normalizeProtocolChain(raw.slice(0, separator));
      if (prefixedChain) {
        chain = prefixedChain;
        address = raw.slice(separator + 1).trim();
      }
    }
    // A bare address is usable only when the provider record names one
    // unambiguous chain. Never project one address across a multichain row.
    if (!chain && uniqueChains.length === 1) chain = uniqueChains[0];
    if (!chain || !validProtocolAddress(chain, address)) continue;
    if (contracts.some((entry) =>
      entry.chain === chain
      && (chain === "solana" ? entry.address === address : entry.address.toLowerCase() === address.toLowerCase())
    )) continue;
    contracts.push({ chain, address });
  }
  return contracts;
}

function protocolOfficialX(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  let handle = raw.replace(/^@/, "");
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://x.com/${handle}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? `@${handle}` : null;
}

/**
 * Read the provider's identity surfaces independently of any metric. A valid
 * 200 response can bind fees even when the same document has no TVL or raises.
 * A 400/404 is a scoped provider no-record, never proof that the project is absent.
 */
export async function collectProtocolIdentity(
  projectName: string,
  options: { fetcher?: typeof fetch; slug?: string } = {},
): Promise<ProtocolIdentityOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName);
  if (!slug) return { state: "no_record", slug: "", note: "No resolvable DeFiLlama protocol slug." };
  const result = await fetchProtocol(slug, fetcher);
  if (!result.ok) {
    recordCall(
      "defillama",
      "protocol-identity",
      0,
      `${slug} · ${result.notFound ? "not_found" : "error"}`,
      result.notFound ? "succeeded" : "failed",
    );
    return result.notFound
      ? { state: "no_record", slug, note: result.note }
      : { state: "unavailable", slug, note: result.note };
  }
  const data = result.data;
  const website = typeof data.url === "string" && data.url.trim() ? data.url.trim() : null;
  const value: ProtocolIdentity = {
    slug,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : projectName,
    symbol: typeof data.symbol === "string" && data.symbol.trim() ? data.symbol.trim() : null,
    geckoId: typeof data.gecko_id === "string" && data.gecko_id.trim() ? data.gecko_id.trim() : null,
    contracts: protocolContracts(data),
    officialX: protocolOfficialX(data.twitter),
    website,
    sourceUrl: `https://defillama.com/protocol/${slug}`,
    capturedAt: result.capturedAt,
  };
  recordCall(
    "defillama",
    "protocol-identity",
    0,
    `${slug} · ${value.contracts.length ? `${value.contracts.length}_contracts` : "metadata"}`,
    readStatus(result.fromMemo, "succeeded"),
  );
  return { state: "resolved", value };
}

// ---------------------------------------------------------------------------
// TVL
// ---------------------------------------------------------------------------

export interface ProtocolHackRecord {
  /** ISO date (YYYY-MM-DD) or null when the record has no date */
  date: string | null;
  amountUsd: number | null;
  /** whether the record explicitly states the funds were returned; null when omitted */
  returnedFunds: boolean | null;
  /** absolute USD returned, when DeFiLlama records a numeric recovery */
  returnedAmountUsd: number | null;
  classification: string | null;
  technique: string | null;
}

export interface ProtocolTvl {
  slug: string;
  name: string;
  symbol: string | null;
  /** Positive TVL measured in this capture; null when this identity-bound row had no usable positive TVL metric. */
  tvlUsd: number | null;
  tvlState: "measured" | "checked_empty";
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
  /** Observation time of the exact DeFiLlama response. */
  capturedAt: string;
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
  const series = Array.isArray(data.tvl) ? (data.tvl as { date?: unknown; totalLiquidityUSD?: unknown }[]) : [];
  const latest = series.length ? series[series.length - 1] : undefined;
  const rawLatestTvl = typeof latest?.totalLiquidityUSD === "number"
    && Number.isFinite(latest.totalLiquidityUSD)
    && latest.totalLiquidityUSD > 0
    ? latest.totalLiquidityUSD
    : null;
  const tvlUsd = rawLatestTvl;
  const tvlState: ProtocolTvl["tvlState"] = tvlUsd === null ? "checked_empty" : "measured";

  const rawChainTvls =
    tvlUsd !== null && data.currentChainTvls && typeof data.currentChainTvls === "object"
      ? (data.currentChainTvls as Record<string, unknown>)
      : {};
  const chainBreakdown = Object.entries(rawChainTvls)
    .filter(([chain, value]) => typeof value === "number" && value > 0 && !NON_CHAIN_SEGMENT.test(chain))
    .map(([chain, value]) => ({ chain, tvlUsd: value as number }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd);

  const firstPoint = series.length ? series[0] : undefined;
  const firstRecordedAt = typeof firstPoint?.date === "number"
    ? new Date(firstPoint.date * 1000).toISOString().slice(0, 10)
    : null;

  // Trend arithmetic is admitted only when this capture has a positive latest
  // metric. Historical positives cannot stand in for a missing current TVL.
  const latestDate = tvlUsd !== null && typeof latest?.date === "number" ? latest.date : null;
  let change30dPct: number | null = null;
  if (tvlUsd !== null && latestDate !== null) {
    const target = latestDate - 30 * 86_400;
    let prior: { date: number; totalLiquidityUSD: number } | null = null;
    for (const point of series) {
      if (typeof point.date !== "number" || typeof point.totalLiquidityUSD !== "number" || point.totalLiquidityUSD <= 0) continue;
      if (point.date > latestDate - 20 * 86_400) break;
      if (!prior || Math.abs(point.date - target) < Math.abs(prior.date - target)) {
        prior = { date: point.date, totalLiquidityUSD: point.totalLiquidityUSD };
      }
    }
    if (prior) {
      const raw = ((tvlUsd - prior.totalLiquidityUSD) / prior.totalLiquidityUSD) * 100;
      change30dPct = Number.isFinite(raw) && Math.abs(raw) <= 10_000 ? Math.round(raw * 10) / 10 : null;
    }
  }

  const trend: { date: string; tvlUsd: number }[] = [];
  if (tvlUsd !== null && latestDate !== null) {
    const horizon = latestDate - 180 * 86_400;
    let nextAt = -Infinity;
    for (const point of series) {
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

  // Parse incident and governance context independently from the TVL metric.
  // A zero, missing, or unreadable TVL value must never erase adverse rows from
  // the same successfully read, identity-bound provider document.
  const hacks: ProtocolHackRecord[] = (Array.isArray(data.hacks) ? data.hacks : [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const returnedAmountUsd = typeof entry.returnedFunds === "number" && entry.returnedFunds > 0
        ? Math.round(entry.returnedFunds)
        : null;
      const returnedFunds = returnedAmountUsd !== null
        ? true
        : typeof entry.returnedFunds === "boolean"
          ? entry.returnedFunds
          : null;
      return {
        date: typeof entry.date === "number" ? new Date(entry.date * 1000).toISOString().slice(0, 10) : null,
        amountUsd: typeof entry.amount === "number" && entry.amount > 0 ? Math.round(entry.amount) : null,
        returnedFunds,
        returnedAmountUsd,
        classification: typeof entry.classification === "string" ? entry.classification : null,
        technique: typeof entry.technique === "string" ? entry.technique : null,
      };
    });

  recordCall(
    "defillama",
    "tvl",
    0,
    tvlUsd === null
      ? `${slug} · checked_empty_tvl · ${hacks.length}_incidents`
      : `${slug} · tvl_${Math.round(tvlUsd)}`,
    readStatus(result.fromMemo, "succeeded"),
  );
  return {
    available: true,
    value: {
      slug,
      name: typeof data.name === "string" ? data.name : projectName,
      symbol: typeof data.symbol === "string" ? data.symbol : null,
      tvlUsd,
      tvlState,
      chains: chainBreakdown.map((entry) => entry.chain),
      chainBreakdown,
      geckoId: typeof data.gecko_id === "string" ? data.gecko_id : null,
      firstRecordedAt,
      change30dPct,
      trend,
      governanceIds: strArray(data.governanceID),
      hacks,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
      capturedAt: result.capturedAt,
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
    recordCall("defillama", "audit-links", 0, `${slug} · ${fromParent.links.length}_links`, readStatus(parent.fromMemo, "succeeded"));
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
      recordCall("defillama", "audit-links", 0, `${slug}->${child} · ${fields.links.length}_links`, readStatus(doc.fromMemo, "succeeded"));
      return { available: true, value: { slug: child, auditCount: fields.count, auditLinks: fields.links } };
    }
  }
  // The parent read is the one this answer rests on; a child walk that found
  // nothing does not change whether a request was actually made for it.
  recordCall("defillama", "audit-links", 0, `${slug} · none`, readStatus(parent.fromMemo, "succeeded"));
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
  /** Observation time of the exact DeFiLlama fees response. */
  capturedAt: string;
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
  // Same coalescing as the protocol document. This endpoint is read once per
  // scan today, but it is the same free GET on the same host and nothing about
  // the call sites guarantees it stays that way.
  const read = await fetchJsonOnce(`${API_BASE}/summary/fees/${encodeURIComponent(slug)}`, fetcher);
  if (!read.ok) {
    if (read.kind === "transport") {
      recordCall("defillama", "fees", 0, `${slug} · error`, "failed");
      return { available: false, note: "DeFiLlama fees endpoint was unavailable." };
    }
    if (read.kind === "unreadable") {
      return { available: false, note: "DeFiLlama fees response was unreadable." };
    }
    recordCall("defillama", "fees", 0, `${slug} · http_${read.status}`, (read.status === 400 || read.status === 404) ? "succeeded" : "failed");
    return { available: false, note: `No DeFiLlama fee record for "${slug}".` };
  }
  const payload = (read.data ?? {}) as { total24h?: unknown; total30d?: unknown; change_30dover30d?: unknown };
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
    recordCall("defillama", "fees", 0, `${slug} · no_totals`, readStatus(read.fromMemo, "succeeded"));
    return { available: false, note: "DeFiLlama reported no fee totals for this protocol." };
  }
  recordCall("defillama", "fees", 0, `${slug} · fees30d_${total30dUsd ?? 0}`, readStatus(read.fromMemo, "succeeded"));
  return {
    available: true,
    value: {
      slug,
      total24hUsd,
      total30dUsd,
      change30dOver30dPct,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
      capturedAt: read.capturedAt,
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
  /** CoinGecko identity carried by the same protocol document. */
  geckoId: string | null;
  rounds: FundingRound[];
  /** sum of known round amounts */
  totalRaisedUsd: number;
  /** distinct lead investors across all rounds */
  leadInvestors: string[];
  sourceUrl: string;
  /** Observation time shared with the exact protocol response. */
  capturedAt: string;
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

const fundingRoundFromRaise = (entry: RaiseItem): FundingRound | null => {
  const amountUsd = millionsToUsd(entry.amount);
  const valuationUsd = millionsToUsd(entry.valuation);
  const namedRound = typeof entry.round === "string" && entry.round.trim()
    ? entry.round.trim()
    : null;
  // DeFiLlama occasionally carries investor-only relationship rows inside the
  // raises array. Those are not financing events. Counting them produced the
  // false "2 rounds, led by BlackRock" Uniswap summary even though the row had
  // no amount, valuation, or round type.
  if (!amountUsd && !valuationUsd && !namedRound) return null;
  const dateSec = typeof entry.date === "number" ? entry.date : null;
  return {
    date: dateSec ? new Date(dateSec * 1000).toISOString().slice(0, 10) : null,
    round: namedRound ?? "Undisclosed round",
    amountUsd,
    leadInvestors: strArray(entry.leadInvestors),
    otherInvestors: strArray(entry.otherInvestors),
    valuationUsd,
  };
};

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
    .map(fundingRoundFromRaise)
    .filter((entry): entry is FundingRound => entry !== null)
    .sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));

  if (!rounds.length) {
    recordCall("defillama", "funding", 0, `${slug} · no_raises`, readStatus(result.fromMemo, "succeeded"));
    return { available: false, reason: "no_data", note: `No public funding rounds recorded for "${slug}" on DeFiLlama.` };
  }

  const leadInvestors = [...new Set(rounds.flatMap((round) => round.leadInvestors))];
  const totalRaisedUsd = rounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0);
  recordCall("defillama", "funding", 0, `${slug} · ${rounds.length}_rounds`, readStatus(result.fromMemo, "succeeded"));
  return {
    available: true,
    value: {
      slug,
      name: typeof result.data.name === "string" ? result.data.name : projectName,
      geckoId: typeof result.data.gecko_id === "string" ? result.data.gecko_id : null,
      rounds,
      totalRaisedUsd,
      leadInvestors,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
      capturedAt: result.capturedAt,
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
