import type { LaunchedProductLead, ProjectTokenSnapshot, VentureTokenSnapshot } from "../../src/data/evidence";
import { canonicalOfficialWebsite, type OfficialWebsiteScope } from "../../src/lib/fundScaleEvidence";
import { readCandle, summarizeCandles, type Candle } from "../../src/lib/priceHistory";
import { declaredTokenFromBio, type TokenCandidate } from "../../src/lib/projectTokenLeg";
import { env } from "../config";
import { captureTimestamp } from "../captureTime";
import { recordCall } from "../cost";
import { fetchPublicTextWithRecovery, type PublicTextWithRecoveryResult } from "../publicWeb";
import type { Adapter, AdapterRunResult, CollectContext } from "./types";

const COINGECKO_PUBLIC = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO = "https://pro-api.coingecko.com/api/v3";
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
const DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
const MAX_CANDIDATES = 3;
const MAX_HISTORY_POINTS = 90;
const PRICE_TOLERANCE = 0.25;
const MIN_POOL_LIQUIDITY_USD = 25_000;

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const PLATFORM_CHAIN: Record<string, string> = {
  solana: "solana",
  ethereum: "ethereum",
  base: "base",
  "arbitrum-one": "arbitrum",
  "binance-smart-chain": "bsc",
  "polygon-pos": "polygon",
  "optimistic-ethereum": "optimism",
  avalanche: "avalanche",
  robinhood: "robinhood",
};

/** Reverse of PLATFORM_CHAIN: investigation chain id → CoinGecko platform id. */
const CHAIN_PLATFORM: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_CHAIN).map(([platform, chain]) => [chain, platform]),
);

const GECKOTERMINAL_NETWORK: Record<string, string> = {
  solana: "solana",
  ethereum: "eth",
  base: "base",
  arbitrum: "arbitrum",
  bsc: "bsc",
  polygon: "polygon_pos",
  optimism: "optimism",
  avalanche: "avax",
  robinhood: "robinhood",
};

const geckoTerminalOhlcvUrl = (
  chain: string,
  poolAddress: string,
  timeframe: "day" | "hour",
): string | null => {
  const network = GECKOTERMINAL_NETWORK[chain];
  return network
    ? `${GECKOTERMINAL}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?aggregate=1&limit=${MAX_HISTORY_POINTS}&currency=usd`
    : null;
};

type JsonRecord = Record<string, unknown>;

interface CoinSearchRow {
  id: string;
  name: string;
  symbol: string;
  rank: number | null;
}

interface ContractIdentity {
  address: string;
  chain: string;
}

interface DexPair {
  pairAddress: string;
  chain: string;
  quoteSymbol: string;
  priceUsd: number;
  liquidityUsd: number;
  sourceUrl: string;
}

interface DexProjectCandidate {
  name: string;
  symbol: string;
  address: string;
  chain: string;
  pairAddress: string;
  sourceUrl: string;
  verification: ProjectTokenSnapshot["verification"];
  homepage?: string;
  officialX?: string;
  priceUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
  relevance: number;
}

interface DexFallbackResult {
  state: "matched" | "empty" | "failed";
  attempts: number;
  detail: string;
  snapshot?: ProjectTokenSnapshot;
  /** Name-matched DEX tokens that failed the identity gate, for the assessed-null disclosure. */
  nameMatches?: string[];
  nameMatchCount?: number;
}

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const cleanText = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const projectName = (value: string): string =>
  value.split(/\s*(?:\||:|\u2013|\u2014|\u00b7)\s*/)[0]?.trim() || value.trim();

// Registry searches are literal enough that a display name carrying a generic
// corporate suffix misses the token named without it: DexScreener's search for
// "Greenwood Finance" does not return the $GWOOD token named "Greenwood" at
// all, so the binding silently never happened and every downstream org-side
// credit (news, docs, GitHub, trust graph) stayed open on the investigation.
// Widen the SEARCH net only - every candidate still has to bridge the exact
// audited X account and official domain, so recall can grow without any new
// false-bind risk.
// Intentionally omits "markets": DexScreener's search for "Clutch Markets"
// already hits a different Robinhood token ($clutch / ClutchMarkets), and
// stripping the suffix would bind the wrong contract. Recall widens only
// through unique-id surfaces (investigation CA, official X, owned domain).
const GENERIC_NAME_SUFFIX = /^(?:finance|protocol|labs?|network|official|app|exchange|capital|fund|foundation|dao|token|coin|money|cash|club|world|games?|inu)$/i;
export function tokenSearchQueries(raw: string): string[] {
  const primary = projectName(raw);
  const queries: string[] = [];
  const push = (candidate: string) => {
    const trimmed = candidate.trim();
    if (trimmed.length >= 2 && !queries.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      queries.push(trimmed);
    }
  };
  push(primary);
  const words = primary.split(/\s+/);
  while (words.length > 1 && GENERIC_NAME_SUFFIX.test(words[words.length - 1])) {
    words.pop();
    push(words.join(" "));
  }
  return queries;
}

const MAX_LAUNCHED_PRODUCT_QUERIES = 4;

/** CoinGecko / DexScreener queries from first-pass launched products, not the company display name. */
export function launchedProductSearchQueries(
  products: ReadonlyArray<LaunchedProductLead> | undefined,
): string[] {
  if (!products?.length) return [];
  const queries: string[] = [];
  const push = (candidate: string) => {
    const trimmed = candidate.trim().replace(/^\$+/, "");
    if (trimmed.length < 3) return;
    if (queries.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
    queries.push(trimmed);
  };
  for (const product of products.slice(0, 3)) {
    if (product.tokenTicker) push(product.tokenTicker);
    if (product.name) push(product.name);
    if (queries.length >= MAX_LAUNCHED_PRODUCT_QUERIES) break;
  }
  return queries.slice(0, MAX_LAUNCHED_PRODUCT_QUERIES);
}

export function projectRegistrySearchQueries(
  displayName: string,
  products?: ReadonlyArray<LaunchedProductLead>,
): string[] {
  const queries = tokenSearchQueries(displayName);
  for (const extra of launchedProductSearchQueries(products)) {
    if (!queries.some((existing) => existing.toLowerCase() === extra.toLowerCase())) queries.push(extra);
  }
  return queries;
}

const normalizeHandle = (value: string): string => value.trim().replace(/^@/, "").toLowerCase();

const sameAddress = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const coingeckoConfig = () => {
  const key = env("COINGECKO_API_KEY");
  return {
    base: key ? COINGECKO_PRO : COINGECKO_PUBLIC,
    headers: key ? { "x-cg-pro-api-key": key } : {} as Record<string, string>,
    tier: key ? "subscription/keyed" : "keyless",
  };
};

async function coinSearch(query: string): Promise<CoinSearchRow[] | null> {
  const { base, headers, tier } = coingeckoConfig();
  let response: Response;
  try {
    response = await fetch(`${base}/search?query=${encodeURIComponent(query)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    recordCall("coingecko", "project-search", 0, `${tier} · transport_error`, "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("coingecko", "project-search", 0, `${tier} · http_${response.status}`, "failed");
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordCall("coingecko", "project-search", 0, `${tier} · response_json_error`, "failed");
    return null;
  }
  const rows = isRecord(payload) && Array.isArray(payload.coins) ? payload.coins : null;
  if (!rows) {
    recordCall("coingecko", "project-search", 0, `${tier} · result_shape_error`, "partial");
    return null;
  }
  const valid = rows.flatMap((candidate): CoinSearchRow[] => {
    if (!isRecord(candidate)) return [];
    const id = cleanText(candidate.id);
    const name = cleanText(candidate.name);
    const symbol = cleanText(candidate.symbol);
    if (!id || !name) return [];
    return [{
      id,
      name,
      symbol,
      rank: Number.isFinite(candidate.market_cap_rank) ? Number(candidate.market_cap_rank) : null,
    }];
  });
  recordCall(
    "coingecko",
    "project-search",
    0,
    `${tier} · ${valid.length ? `${valid.length} candidates` : "no_candidates"}`,
    valid.length === rows.length ? "succeeded" : "partial",
  );
  return valid;
}

function rankedCandidates(query: string, rows: CoinSearchRow[]): CoinSearchRow[] {
  const cleanQuery = projectName(query);
  const queryKey = normalized(cleanQuery);
  const queryWords = cleanQuery.toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  const score = (row: CoinSearchRow): number => {
    const nameKey = normalized(row.name);
    const symbolKey = normalized(row.symbol);
    let value = 0;
    if (nameKey === queryKey) value += 1_000;
    else if (nameKey && queryKey && (nameKey.includes(queryKey) || queryKey.includes(nameKey))) value += 600;
    value += queryWords.filter((word) => row.name.toLowerCase().includes(word)).length * 80;
    if (symbolKey && symbolKey === queryKey) value += 500;
    if (row.rank != null) value += Math.max(0, 200 - Math.min(row.rank, 200));
    return value;
  };
  return rows
    .map((row) => ({ row, relevance: score(row) }))
    // CoinGecko search can return popular but unrelated assets. Inspect details
    // only for candidates whose name or symbol actually overlaps the profile.
    .filter(({ relevance }) => relevance >= 500)
    .sort((left, right) => right.relevance - left.relevance || (left.row.rank ?? Number.MAX_SAFE_INTEGER) - (right.row.rank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_CANDIDATES)
    .map(({ row }) => row);
}

async function coinDetails(id: string): Promise<JsonRecord | null> {
  const { base, headers, tier } = coingeckoConfig();
  const url = `${base}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    recordCall("coingecko", "project-details", 0, `${tier} · transport_error`, "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("coingecko", "project-details", 0, `${tier} · http_${response.status}`, "failed");
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordCall("coingecko", "project-details", 0, `${tier} · response_json_error`, "failed");
    return null;
  }
  if (!isRecord(payload)) {
    recordCall("coingecko", "project-details", 0, `${tier} · result_shape_error`, "partial");
    return null;
  }
  recordCall("coingecko", "project-details", 0, `${tier} · ${id}`, "succeeded");
  return payload;
}

/**
 * CoinGecko `GET /coins/{platform}/contract/{address}`. An investigation that
 * already holds the CA does not need a name search — and must not apply the
 * ≥500 name-overlap filter, which would drop $STONKBROKER against "CLUTCH".
 */
async function coinByContract(platform: string, address: string): Promise<
  { state: "ok"; details: JsonRecord } | { state: "empty" } | { state: "failed" }
> {
  const { base, headers, tier } = coingeckoConfig();
  const url = `${base}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(address)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    recordCall("coingecko", "project-contract", 0, `${tier} · transport_error`, "failed");
    return { state: "failed" };
  }
  if (response.status === 404) {
    recordCall("coingecko", "project-contract", 0, `${tier} · not_listed`, "succeeded");
    return { state: "empty" };
  }
  if (!response.ok) {
    recordCall("coingecko", "project-contract", 0, `${tier} · http_${response.status}`, "failed");
    return { state: "failed" };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordCall("coingecko", "project-contract", 0, `${tier} · response_json_error`, "failed");
    return { state: "failed" };
  }
  if (!isRecord(payload) || !cleanText(payload.id)) {
    recordCall("coingecko", "project-contract", 0, `${tier} · result_shape_error`, "partial");
    return { state: "failed" };
  }
  recordCall("coingecko", "project-contract", 0, `${tier} · ${cleanText(payload.id)}`, "succeeded");
  return { state: "ok", details: payload };
}

function parseSeededContract(ctx: CollectContext): { address: string; chain: string; platform: string } | null {
  const address = cleanText(ctx.tokenAddress);
  const chain = cleanText(ctx.tokenChain).toLowerCase();
  if (!address || !chain) return null;
  const platform = CHAIN_PLATFORM[chain];
  if (!platform) return null;
  const addressValid = chain === "solana" ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
  return addressValid ? { address, chain, platform } : null;
}

const validContract = (platform: string, value: unknown): string | null => {
  const address = cleanText(value);
  if (!address) return null;
  if (platform === "solana") return SOLANA_ADDRESS.test(address) ? address : null;
  return PLATFORM_CHAIN[platform] && EVM_ADDRESS.test(address) ? address : null;
};

function canonicalContract(details: JsonRecord): ContractIdentity | null {
  const platforms = isRecord(details.platforms) ? details.platforms : {};
  const native = cleanText(details.asset_platform_id);
  const order = [...new Set([
    native,
    "solana",
    "ethereum",
    "base",
    "arbitrum-one",
    "binance-smart-chain",
    "polygon-pos",
    "optimistic-ethereum",
    "avalanche",
    "robinhood",
  ].filter(Boolean))];
  for (const platform of order) {
    const address = validContract(platform, platforms[platform]);
    const chain = PLATFORM_CHAIN[platform];
    if (address && chain) return { address, chain };
  }
  return null;
}

const officialHomepages = (details: JsonRecord): string[] => {
  const links = isRecord(details.links) ? details.links : {};
  const homes = Array.isArray(links.homepage) ? links.homepage : [];
  return homes.filter((value): value is string =>
    typeof value === "string" && canonicalOfficialWebsite(value) !== null,
  );
};

const domainsMatch = (left: string, right: string): boolean =>
  left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);

function verifyIdentity(
  ctx: CollectContext,
  details: JsonRecord,
): { verification: ProjectTokenSnapshot["verification"]; homepage?: string; officialX?: string } | null {
  const links = isRecord(details.links) ? details.links : {};
  const officialHandle = cleanText(links.twitter_screen_name);
  const exactX = officialHandle && normalizeHandle(officialHandle) === normalizeHandle(ctx.handle);
  const homepages = officialHomepages(details);
  if (exactX) {
    return {
      verification: "official_x",
      ...(homepages[0] ? { homepage: homepages[0] } : {}),
      officialX: `@${officialHandle.replace(/^@/, "")}`,
    };
  }

  const profile = ctx.evidence.profile;
  const capturedAt = Date.parse(profile.profile_captured_at ?? "");
  const profileScope = profile.profile_collection_state === "resolved"
    && profile.profile_provider === "twitterapi"
    && Number.isFinite(capturedAt)
    ? canonicalOfficialWebsite(profile.website)
    : null;
  const homepage = profileScope
    ? homepages.find((candidate) => {
        const tokenScope = canonicalOfficialWebsite(candidate);
        return tokenScope !== null && domainsMatch(profileScope.domain, tokenScope.domain);
      })
    : undefined;
  if (!profileScope || !homepage) return null;
  return {
    verification: "official_domain",
    homepage,
    ...(officialHandle ? { officialX: `@${officialHandle.replace(/^@/, "")}` } : {}),
  };
}

const xHandleFromUrl = (value: unknown): string | null => {
  const raw = cleanText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return handle ? normalizeHandle(handle) : null;
  } catch {
    return null;
  }
};

function dexIdentity(
  ctx: CollectContext,
  row: JsonRecord,
): { verification: ProjectTokenSnapshot["verification"]; homepage?: string; officialX?: string } | null {
  const info = isRecord(row.info) ? row.info : {};
  const websites = Array.isArray(info.websites)
    ? info.websites.flatMap((candidate): string[] => {
        if (!isRecord(candidate)) return [];
        const url = cleanText(candidate.url);
        return canonicalOfficialWebsite(url) ? [url] : [];
      })
    : [];
  const handles = Array.isArray(info.socials)
    ? info.socials.flatMap((candidate): string[] => {
        if (!isRecord(candidate)) return [];
        const handle = xHandleFromUrl(candidate.url);
        return handle ? [handle] : [];
      })
    : [];
  const profile = ctx.evidence.profile;
  const capturedAt = Date.parse(profile.profile_captured_at ?? "");
  const profileScope = profile.profile_collection_state === "resolved"
    && profile.profile_provider === "twitterapi"
    && Number.isFinite(capturedAt)
    ? canonicalOfficialWebsite(profile.website)
    : null;
  const homepage = profileScope
    ? websites.find((candidate) => {
        const tokenScope = canonicalOfficialWebsite(candidate);
        return tokenScope !== null && domainsMatch(profileScope.domain, tokenScope.domain);
      })
    : undefined;
  const exactHandle = handles.find((handle) => handle === normalizeHandle(ctx.handle));
  // DexScreener metadata is permissionless enough that one self-supplied link
  // is not a canonical-token identity proof. Require the token row to bridge
  // BOTH provider-frozen identity surfaces: the exact audited X account and
  // the exact official profile domain.
  if (!profileScope || !homepage || !exactHandle) return null;
  return {
    verification: "official_x",
    homepage,
    officialX: `@${exactHandle}`,
  };
}

/**
 * Contract addresses a project publishes on its OWN verified site.
 *
 * Token binding is registry-first: it searches CoinGecko and DexScreener by
 * name and then asks whether that registry record points back at the project.
 * DexScreener socials are self-submitted, so a team that never filled them in
 * can never bind, and the strongest evidence in existence stays invisible:
 * the project stating its contract address on its own domain. @clutchmarkets
 * printed the $STONKBROKER address on stonkbrokers.cash and ARGUS recorded no
 * token at all.
 *
 * Addresses are extracted verbatim; which one is actually a token is settled
 * on-chain afterwards, never by guessing from page position.
 */
export function siteContractCandidates(html: string, limit = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/0x[a-fA-F0-9]{40}/g)) {
    const address = match[0];
    const key = address.toLowerCase();
    // The zero address and obvious burn sinks are never a project's token.
    if (/^0x0{40}$/i.test(address) || /^0x0{38}dead$/i.test(address)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
    if (out.length >= limit) break;
  }
  return out;
}

async function dexSearch(query: string): Promise<JsonRecord[] | null> {
  let response: Response;
  try {
    response = await fetch(`${DEXSCREENER_SEARCH}?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    recordCall("dexscreener", "project-search", 0, "keyless · transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("dexscreener", "project-search", 0, `keyless · http_${response.status}`, "failed");
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordCall("dexscreener", "project-search", 0, "keyless · response_json_error", "failed");
    return null;
  }
  if (!isRecord(payload) || !Array.isArray(payload.pairs)) {
    recordCall("dexscreener", "project-search", 0, "keyless · result_shape_error", "partial");
    return null;
  }
  const pairs = payload.pairs.filter(isRecord);
  recordCall(
    "dexscreener",
    "project-search",
    0,
    `keyless · ${pairs.length ? `${pairs.length} pairs` : "no_pairs"}`,
    pairs.length === payload.pairs.length ? "succeeded" : "partial",
  );
  return pairs;
}

function dexProjectCandidates(
  ctx: CollectContext,
  query: string,
  rows: JsonRecord[],
): DexProjectCandidate[] {
  const cleanQuery = projectName(query);
  const queryKey = normalized(cleanQuery);
  const queryWords = cleanQuery.toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  const candidates = rows.flatMap((row): DexProjectCandidate[] => {
    const base = isRecord(row.baseToken) ? row.baseToken : {};
    const name = cleanText(base.name);
    const symbol = cleanText(base.symbol).toUpperCase();
    const address = cleanText(base.address);
    const chain = cleanText(row.chainId).toLowerCase();
    const pairAddress = cleanText(row.pairAddress);
    const sourceUrl = cleanText(row.url);
    const nameKey = normalized(name);
    const symbolKey = normalized(symbol);
    let relevance = 0;
    if (nameKey === queryKey) relevance += 1_000;
    else if (nameKey && queryKey && (nameKey.includes(queryKey) || queryKey.includes(nameKey))) relevance += 600;
    relevance += queryWords.filter((word) => name.toLowerCase().includes(word)).length * 80;
    if (symbolKey && symbolKey === queryKey) relevance += 500;
    const addressValid = chain === "solana" ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
    if (
      !name
      || !symbol
      || !addressValid
      || !chain
      || !pairAddress
      || !sourceUrl
      || relevance < 500
    ) return [];
    const identity = dexIdentity(ctx, row);
    if (!identity) return [];
    const liquidity = isRecord(row.liquidity) ? finiteNumber(row.liquidity.usd) : undefined;
    const volume = isRecord(row.volume) ? finiteNumber(row.volume.h24) : undefined;
    return [{
      name,
      symbol,
      address,
      chain,
      pairAddress,
      sourceUrl,
      relevance,
      ...identity,
      ...(finiteNumber(row.priceUsd) !== undefined ? { priceUsd: finiteNumber(row.priceUsd) } : {}),
      ...(finiteNumber(row.marketCap) !== undefined ? { marketCapUsd: finiteNumber(row.marketCap) } : {}),
      ...(finiteNumber(row.fdv) !== undefined ? { fdvUsd: finiteNumber(row.fdv) } : {}),
      ...(volume !== undefined ? { volume24hUsd: volume } : {}),
      ...(liquidity !== undefined ? { liquidityUsd: liquidity } : {}),
    }];
  });
  return candidates.sort((left, right) =>
    right.relevance - left.relevance
      || (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0)
      || (right.volume24hUsd ?? 0) - (left.volume24hUsd ?? 0),
  );
}

async function collectDexProjectToken(
  ctx: CollectContext,
  query: string,
): Promise<DexFallbackResult> {
  const rows = await dexSearch(query);
  if (!rows) {
    return { state: "failed", attempts: 1, detail: "DexScreener project search failed" };
  }
  const candidate = dexProjectCandidates(ctx, query, rows)[0];
  if (!candidate) {
    // Disclose what the search DID see: tokens trading under a matching name
    // that no official account or domain links back to. Naming them is what
    // turns "unresolved" into an investigator's finding.
    const q = query.trim().toLowerCase();
    const nameAlikes = [...new Map(rows
      .filter((row) => {
        const name = String((row as { baseToken?: { name?: unknown } }).baseToken?.name ?? "").toLowerCase();
        const symbol = String((row as { baseToken?: { symbol?: unknown } }).baseToken?.symbol ?? "").toLowerCase();
        return Boolean(name && (name.includes(q) || q.includes(name) || symbol === q));
      })
      .map((row) => {
        const base = (row as { baseToken?: { name?: unknown; symbol?: unknown } }).baseToken ?? {};
        const label = `${String(base.name ?? "").trim()} ($${String(base.symbol ?? "").trim().toUpperCase()})`;
        return [label.toLowerCase(), label] as const;
      }))
      .values()];
    return {
      state: "empty",
      attempts: 1,
      detail: "DexScreener returned no identity-bound project-token candidate",
      nameMatchCount: nameAlikes.length,
      nameMatches: nameAlikes.slice(0, 3),
    };
  }
  const historyResult = await tokenHistory(candidate.chain, candidate.pairAddress);
  const history = historyResult.history;
  const capturedAt = captureTimestamp();
  const hasMarketRead = candidate.priceUsd !== undefined
    || candidate.marketCapUsd !== undefined
    || candidate.fdvUsd !== undefined
    || candidate.volume24hUsd !== undefined;
  return {
    state: "matched",
    attempts: 1 + historyResult.attempts,
    detail: `verified $${candidate.symbol} by ${candidate.verification} with an identity-bound DEX pair`,
    snapshot: {
      verified: true,
      verification: candidate.verification,
      name: candidate.name,
      symbol: candidate.symbol,
      rank: null,
      address: candidate.address,
      chain: candidate.chain,
      ...(candidate.homepage ? { homepage: candidate.homepage } : {}),
      ...(candidate.officialX ? { officialX: candidate.officialX } : {}),
      sourceUrl: candidate.sourceUrl,
      capturedAt,
      producerSources: {
        identity: { provider: "dexscreener", sourceUrl: candidate.sourceUrl, capturedAt },
        ...(hasMarketRead
          ? { market: { provider: "dexscreener" as const, sourceUrl: candidate.sourceUrl, capturedAt } }
          : {}),
        ...(candidate.liquidityUsd !== undefined
          ? { liquidity: { provider: "dexscreener" as const, sourceUrl: candidate.sourceUrl, capturedAt } }
          : {}),
        ...(history?.sourceUrl && history.capturedAt
          ? { history: { provider: "geckoterminal" as const, sourceUrl: history.sourceUrl, capturedAt: history.capturedAt } }
          : {}),
      },
      providers: ["dexscreener", ...(history ? ["geckoterminal" as const] : [])],
      ...(candidate.priceUsd !== undefined ? { priceUsd: candidate.priceUsd } : {}),
      ...(candidate.marketCapUsd !== undefined ? { marketCapUsd: candidate.marketCapUsd } : {}),
      ...(candidate.fdvUsd !== undefined ? { fdvUsd: candidate.fdvUsd } : {}),
      ...(candidate.volume24hUsd !== undefined ? { volume24hUsd: candidate.volume24hUsd } : {}),
      ...(candidate.liquidityUsd !== undefined ? { liquidityUsd: candidate.liquidityUsd } : {}),
      pairAddress: candidate.pairAddress,
      ...(history ? { history } : {}),
    },
  };
}

/**
 * Homepages on a CoinGecko record whose official X already equals the audited
 * handle. Unique-id via the handle — not a search lead.
 */
function cgHandleBoundHomepages(ctx: CollectContext, details: JsonRecord): string[] {
  const links = isRecord(details.links) ? details.links : {};
  const officialHandle = cleanText(links.twitter_screen_name);
  if (!officialHandle || normalizeHandle(officialHandle) !== normalizeHandle(ctx.handle)) return [];
  return officialHomepages(details);
}

/**
 * Homepages on a DexScreener row whose official X already equals the audited
 * handle. Unique-id via the handle — not a search lead.
 */
function dexHandleBoundHomepages(ctx: CollectContext, row: JsonRecord): string[] {
  const info = isRecord(row.info) ? row.info : {};
  const handles = Array.isArray(info.socials)
    ? info.socials.flatMap((candidate): string[] => {
        if (!isRecord(candidate)) return [];
        const handle = xHandleFromUrl(candidate.url);
        return handle ? [handle] : [];
      })
    : [];
  if (!handles.some((handle) => handle === normalizeHandle(ctx.handle))) return [];
  const websites = Array.isArray(info.websites)
    ? info.websites.flatMap((candidate): string[] => {
        if (!isRecord(candidate)) return [];
        const url = cleanText(candidate.url);
        return canonicalOfficialWebsite(url) ? [url] : [];
      })
    : [];
  return websites;
}

/**
 * Official websites already unique-ID bound to this subject. Never search
 * leads: only the provider-frozen X profile website, extra twitterapi
 * website/entity URLs on that same profile record, first-party official
 * sites already cited on the evidence (verified official_subject sources),
 * and DexScreener/CoinGecko homepages whose official X already equals the
 * audited handle.
 */
function officialWebsiteScopes(
  ctx: CollectContext,
  extraUrls: readonly string[] = [],
): OfficialWebsiteScope[] {
  const seen = new Set<string>();
  const scopes: OfficialWebsiteScope[] = [];
  const add = (value: unknown) => {
    const scope = canonicalOfficialWebsite(value);
    if (!scope || seen.has(scope.canonicalUrl)) return;
    seen.add(scope.canonicalUrl);
    scopes.push(scope);
  };
  add(ctx.evidence.profile.website);
  for (const url of ctx.evidence.profile.official_websites ?? []) add(url);
  for (const url of extraUrls) add(url);
  for (const fact of ctx.evidence.basicFacts ?? []) {
    if (fact.artifact_verified !== true) continue;
    if (fact.status !== "verified" && fact.status !== "corroborated") continue;
    for (const source of fact.sources) {
      if (
        source.sourceClass !== "official_subject"
        || source.relation !== "supports"
        || source.artifactVerified !== true
      ) continue;
      add(source.url);
    }
  }
  return scopes;
}

async function resolveSiteDeclaredOnPage(
  ctx: CollectContext,
  scope: OfficialWebsiteScope,
  fetchImpl: typeof fetch,
  recoverOfficialText: (url: string) => Promise<PublicTextWithRecoveryResult>,
): Promise<{ snapshot: ProjectTokenSnapshot; sourceUrl: string } | null> {
  let html: string;
  let identityCapturedAt: string;
  try {
    const response = await fetchImpl(scope.canonicalUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const recovered = await recoverOfficialText(scope.canonicalUrl);
        if (recovered.status === "ok") {
          html = recovered.text.slice(0, 400_000);
          identityCapturedAt = captureTimestamp();
          recordCall("site-fetch", "token-declaration", 0, `reader_recovery_after_http_${response.status}`, "succeeded");
        } else {
          recordCall("site-fetch", "token-declaration", 0, `http_${response.status} · ${recovered.reason}`, "failed");
          return null;
        }
      } else {
        recordCall("site-fetch", "token-declaration", 0, `http_${response.status}`, response.status === 404 ? "partial" : "failed");
        return null;
      }
    } else {
      html = (await response.text()).slice(0, 400_000);
      identityCapturedAt = captureTimestamp();
    }
  } catch {
    const recovered = await recoverOfficialText(scope.canonicalUrl);
    if (recovered.status !== "ok") {
      recordCall("site-fetch", "token-declaration", 0, `transport_error · ${recovered.reason}`, "failed");
      return null;
    }
    html = recovered.text.slice(0, 400_000);
    identityCapturedAt = captureTimestamp();
    recordCall("site-fetch", "token-declaration", 0, "reader_recovery_after_transport_error", "succeeded");
  }
  const candidates = siteContractCandidates(html);
  if (!candidates.length) {
    recordCall("site-fetch", "token-declaration", 0, "no_contract_on_page", "succeeded");
    return null;
  }
  const resolved: Array<{ address: string; pairs: JsonRecord[]; capturedAt: string }> = [];
  for (const address of candidates.slice(0, 6)) {
    const pairs = await dexPairs(address);
    if (pairs && pairs.length) resolved.push({ address, pairs, capturedAt: captureTimestamp() });
  }
  if (resolved.length !== 1) {
    recordCall("site-fetch", "token-declaration", 0, resolved.length ? "ambiguous_multiple_tokens" : "no_tradeable_token", "succeeded");
    return null;
  }
  const [only] = resolved;
  // Deepest pool represents the token; a dust pair must not name the chain.
  const best = [...only.pairs].sort((left, right) => {
    const l = isRecord(left.liquidity) ? finiteNumber(left.liquidity.usd) ?? 0 : 0;
    const r = isRecord(right.liquidity) ? finiteNumber(right.liquidity.usd) ?? 0 : 0;
    return r - l;
  })[0];
  const base = isRecord(best.baseToken) ? best.baseToken as JsonRecord : {};
  const name = cleanText(base.name) || cleanText(ctx.evidence.profile.display_name);
  const symbol = cleanText(base.symbol);
  const chain = cleanText(best.chainId);
  const pairAddress = cleanText(best.pairAddress);
  if (!symbol || !chain) return null;
  const info = isRecord(best.info) ? best.info as JsonRecord : {};
  const priceUsd = finiteNumber(best.priceUsd);
  const liquidityUsd = isRecord(best.liquidity) ? finiteNumber(best.liquidity.usd) : undefined;
  // The same DexScreener row already carries the market figures; dropping them
  // left the report saying "Not captured" beside a token it had just bound.
  const marketCapUsd = finiteNumber(best.marketCap);
  const fdvUsd = finiteNumber(best.fdv);
  const volume24hUsd = isRecord(best.volume) ? finiteNumber(best.volume.h24) : undefined;
  const dexSourceUrl = cleanText(best.url) || `${DEXSCREENER}/${encodeURIComponent(only.address)}`;
  const hasMarketRead = priceUsd !== undefined
    || marketCapUsd !== undefined
    || fdvUsd !== undefined
    || volume24hUsd !== undefined;
  // Freeze the price series so the saved report renders its own chart rather
  // than depending on a live refresh, exactly as the other binding paths do.
  const historyResult = pairAddress ? await tokenHistory(chain, pairAddress) : { history: undefined, attempts: 0 };
  return {
    sourceUrl: scope.canonicalUrl,
    snapshot: {
      verified: true,
      verification: "official_domain",
      name,
      symbol,
      rank: null,
      address: only.address,
      chain,
      homepage: scope.canonicalUrl,
      sourceUrl: scope.canonicalUrl,
      capturedAt: identityCapturedAt,
      producerSources: {
        identity: { provider: "official_site", sourceUrl: scope.canonicalUrl, capturedAt: identityCapturedAt },
        ...(hasMarketRead
          ? { market: { provider: "dexscreener" as const, sourceUrl: dexSourceUrl, capturedAt: only.capturedAt } }
          : {}),
        ...(liquidityUsd !== undefined
          ? { liquidity: { provider: "dexscreener" as const, sourceUrl: dexSourceUrl, capturedAt: only.capturedAt } }
          : {}),
        ...(historyResult.history?.sourceUrl && historyResult.history.capturedAt
          ? {
              history: {
                provider: "geckoterminal" as const,
                sourceUrl: historyResult.history.sourceUrl,
                capturedAt: historyResult.history.capturedAt,
              },
            }
          : {}),
      },
      providers: ["dexscreener", ...(historyResult.history ? ["geckoterminal" as const] : [])],
      ...(priceUsd !== undefined ? { priceUsd } : {}),
      ...(liquidityUsd !== undefined ? { liquidityUsd } : {}),
      ...(marketCapUsd !== undefined ? { marketCapUsd } : {}),
      ...(fdvUsd !== undefined ? { fdvUsd } : {}),
      ...(volume24hUsd !== undefined ? { volume24hUsd } : {}),
      ...(historyResult.history ? { history: historyResult.history } : {}),
      ...(cleanText(info.imageUrl) ? { imageUrl: cleanText(info.imageUrl) } : {}),
      ...(pairAddress ? { pairAddress } : {}),
    } as ProjectTokenSnapshot,
  };
}

/**
 * Bind the token a project publishes on its OWN verified domains.
 *
 * Walks every first-party official website already bound to this subject,
 * not just profile.website. A page with 0 or >1 tradeable tokens is skipped.
 * The first page that yields exactly one tradeable token wins unless a later
 * official page declares a different tradeable token (same ambiguity rule
 * as a single page with two tokens).
 */
async function collectSiteDeclaredToken(
  ctx: CollectContext,
  fetchImpl: typeof fetch = fetch,
  extraOfficialUrls: readonly string[] = [],
  recoverOfficialText: (url: string) => Promise<PublicTextWithRecoveryResult> = fetchPublicTextWithRecovery,
): Promise<{ snapshot: ProjectTokenSnapshot; sourceUrl: string } | null> {
  const scopes = officialWebsiteScopes(ctx, extraOfficialUrls);
  if (!scopes.length) return null;

  const declared: Array<{ snapshot: ProjectTokenSnapshot; sourceUrl: string }> = [];
  for (const scope of scopes) {
    const found = await resolveSiteDeclaredOnPage(ctx, scope, fetchImpl, recoverOfficialText);
    if (found) declared.push(found);
  }
  if (!declared.length) return null;
  const addresses = new Set(declared.map((row) => row.snapshot.address.toLowerCase()));
  if (addresses.size !== 1) {
    recordCall("site-fetch", "token-declaration", 0, "ambiguous_multiple_tokens", "succeeded");
    return null;
  }
  // First official page that declared this unique tradeable token wins.
  return declared[0];
}

async function dexPairs(address: string): Promise<JsonRecord[] | null> {
  let response: Response;
  try {
    response = await fetch(`${DEXSCREENER}/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    recordCall("dexscreener", "project-token-pairs", 0, "keyless · transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("dexscreener", "project-token-pairs", 0, `keyless · http_${response.status}`, "failed");
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordCall("dexscreener", "project-token-pairs", 0, "keyless · response_json_error", "failed");
    return null;
  }
  if (!isRecord(payload) || !Array.isArray(payload.pairs)) {
    recordCall("dexscreener", "project-token-pairs", 0, "keyless · result_shape_error", "partial");
    return null;
  }
  const pairs = payload.pairs.filter(isRecord);
  recordCall(
    "dexscreener",
    "project-token-pairs",
    0,
    `keyless · ${pairs.length ? `${pairs.length} pairs` : "no_pairs"}`,
    pairs.length === payload.pairs.length ? "succeeded" : "partial",
  );
  return pairs;
}

const quotePriority = (symbol: string): number => {
  switch (symbol.toUpperCase()) {
    case "USDC":
    case "USDT":
    case "SOL":
    case "WSOL":
    case "ETH":
    case "WETH": return 1;
    default: return 0;
  }
};

function selectPriceCorroboratedPair(
  rows: JsonRecord[],
  token: ContractIdentity,
  coingeckoPrice: number | undefined,
): DexPair | null {
  if (!coingeckoPrice || coingeckoPrice <= 0) return null;
  const candidates = rows.flatMap((row): DexPair[] => {
    const baseToken = isRecord(row.baseToken) ? row.baseToken : {};
    const quoteToken = isRecord(row.quoteToken) ? row.quoteToken : {};
    const baseAddress = cleanText(baseToken.address);
    const chain = cleanText(row.chainId).toLowerCase();
    const priceUsd = finiteNumber(row.priceUsd);
    const pairAddress = cleanText(row.pairAddress);
    if (!baseAddress || !sameAddress(baseAddress, token.address) || chain !== token.chain || !priceUsd || priceUsd <= 0 || !pairAddress) return [];
    const difference = Math.abs(priceUsd - coingeckoPrice) / coingeckoPrice;
    if (difference > PRICE_TOLERANCE) return [];
    const liquidity = isRecord(row.liquidity) ? finiteNumber(row.liquidity.usd) : undefined;
    if (liquidity == null || liquidity < MIN_POOL_LIQUIDITY_USD) return [];
    return [{
      pairAddress,
      chain,
      quoteSymbol: cleanText(quoteToken.symbol),
      priceUsd,
      liquidityUsd: liquidity,
      sourceUrl: cleanText(row.url) || `${DEXSCREENER}/${encodeURIComponent(token.address)}`,
    }];
  });
  return candidates.sort((left, right) =>
    right.liquidityUsd - left.liquidityUsd
      || quotePriority(right.quoteSymbol) - quotePriority(left.quoteSymbol),
  )[0] ?? null;
}

async function ohlcv(
  chain: string,
  poolAddress: string,
  timeframe: "day" | "hour",
): Promise<Candle[] | null> {
  const url = geckoTerminalOhlcvUrl(chain, poolAddress, timeframe);
  if (!url) return null;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, "keyless · transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, `keyless · http_${response.status}`, "failed");
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, "keyless · response_json_error", "failed");
    return null;
  }
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const attributes = data && isRecord(data.attributes) ? data.attributes : null;
  const rows = attributes && Array.isArray(attributes.ohlcv_list) ? attributes.ohlcv_list : null;
  if (!rows) {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, "keyless · result_shape_error", "partial");
    return null;
  }
  // Shared with the client sparkline: a row keeps its close even when the high,
  // low or volume column is missing, so a partly reported candle costs us that
  // column rather than the whole period.
  const valid = rows
    .map(readCandle)
    .filter((candle): candle is Candle => candle !== null)
    .slice(0, MAX_HISTORY_POINTS);
  recordCall(
    "geckoterminal",
    `project-token-ohlcv-${timeframe}`,
    0,
    `keyless · ${valid.length ? `${valid.length} points` : "no_points"}`,
    valid.length === rows.length ? "succeeded" : "partial",
  );
  return valid;
}

async function tokenHistory(
  chain: string,
  poolAddress: string,
): Promise<{ history?: ProjectTokenSnapshot["history"]; attempts: number }> {
  let timeframe: "day" | "hour" = "day";
  let attempts = 1;
  let candles = await ohlcv(chain, poolAddress, timeframe);
  if (!candles?.length) {
    timeframe = "hour";
    attempts += 1;
    candles = await ohlcv(chain, poolAddress, timeframe);
  }
  if (!candles?.length) return { attempts };
  const summary = summarizeCandles(candles, timeframe);
  if (!summary) return { attempts };
  const sourceUrl = geckoTerminalOhlcvUrl(chain, poolAddress, timeframe);
  const capturedAt = captureTimestamp();
  return {
    attempts,
    history: {
      ...summary,
      timeframe,
      poolAddress,
      ...(sourceUrl ? { sourceUrl } : {}),
      capturedAt,
    },
  };
}

/**
 * What the frozen candle window actually covers, for the traction check note.
 * Names the span whenever the series has holes so the count can never read as
 * that many consecutive periods, and reports the volume move only when both
 * sides of the comparison were measured.
 */
function historyCoverageNote(history: ProjectTokenSnapshot["history"]): string {
  if (!history) return "";
  const unit = history.timeframe === "day" ? "day" : "hour";
  const span = history.windowIsPartial && history.spanPeriods
    ? ` across a partly reported ${history.spanPeriods} ${unit} window`
    : "";
  const volume = history.volume
    ? `, with reported volume ${history.volume.changePct >= 0 ? "up" : "down"} ${Math.abs(history.volume.changePct).toFixed(0)}% against the prior ${history.volume.prior.candles} ${unit}s${history.volume.isFloor ? " (a floor: not every candle reported volume)" : ""}`
    : "";
  return ` and ${history.points.length} frozen ${history.timeframe} price points${span}${volume}`;
}

async function collectProfileDeclaredToken(
  ctx: CollectContext,
  candidate: TokenCandidate,
): Promise<DexFallbackResult> {
  const rows = await dexPairs(candidate.address);
  if (!rows) {
    return {
      state: "failed",
      attempts: 1,
      detail: "The official X bio declared a contract, but DexScreener could not be read.",
    };
  }
  const matching = rows.filter((row) => {
    const base = isRecord(row.baseToken) ? row.baseToken : {};
    return sameAddress(cleanText(base.address), candidate.address);
  });
  if (!matching.length) {
    return {
      state: "empty",
      attempts: 1,
      detail: "The official X bio declared a contract, but DexScreener returned no market for that exact address.",
    };
  }
  const best = [...matching].sort((left, right) => {
    const leftLiquidity = isRecord(left.liquidity) ? finiteNumber(left.liquidity.usd) ?? 0 : 0;
    const rightLiquidity = isRecord(right.liquidity) ? finiteNumber(right.liquidity.usd) ?? 0 : 0;
    return rightLiquidity - leftLiquidity;
  })[0];
  const base = isRecord(best.baseToken) ? best.baseToken : {};
  const info = isRecord(best.info) ? best.info : {};
  const name = cleanText(base.name) || cleanText(ctx.evidence.profile.display_name);
  const symbol = cleanText(base.symbol).toUpperCase();
  const chain = cleanText(best.chainId).toLowerCase();
  const pairAddress = cleanText(best.pairAddress);
  if (!name || !symbol || !chain || !pairAddress) {
    return {
      state: "failed",
      attempts: 1,
      detail: "DexScreener returned the declared contract without complete token or pool identity.",
    };
  }
  const capturedAt = captureTimestamp();
  const identityCapturedAt = ctx.evidence.profile.profile_captured_at ?? capturedAt;
  const officialX = `@${normalizeHandle(ctx.handle)}`;
  const identitySourceUrl = `https://x.com/${normalizeHandle(ctx.handle)}`;
  const marketSourceUrl = cleanText(best.url) || `${DEXSCREENER}/${encodeURIComponent(candidate.address)}`;
  const priceUsd = finiteNumber(best.priceUsd);
  const marketCapUsd = finiteNumber(best.marketCap);
  const fdvUsd = finiteNumber(best.fdv);
  const volume24hUsd = isRecord(best.volume) ? finiteNumber(best.volume.h24) : undefined;
  const liquidityUsd = isRecord(best.liquidity) ? finiteNumber(best.liquidity.usd) : undefined;
  const hasMarketRead = priceUsd !== undefined
    || marketCapUsd !== undefined
    || fdvUsd !== undefined
    || volume24hUsd !== undefined;
  const historyResult = await tokenHistory(chain, pairAddress);
  const history = historyResult.history;
  return {
    state: "matched",
    attempts: 1 + historyResult.attempts,
    detail: `verified $${symbol} from the exact contract explicitly declared by ${officialX}`,
    snapshot: {
      verified: true,
      verification: "official_x",
      name,
      symbol,
      rank: null,
      address: candidate.address,
      chain,
      officialX,
      sourceUrl: identitySourceUrl,
      capturedAt: identityCapturedAt,
      producerSources: {
        identity: {
          provider: "twitterapi",
          sourceUrl: identitySourceUrl,
          capturedAt: identityCapturedAt,
        },
        ...(hasMarketRead
          ? { market: { provider: "dexscreener" as const, sourceUrl: marketSourceUrl, capturedAt } }
          : {}),
        ...(liquidityUsd !== undefined
          ? { liquidity: { provider: "dexscreener" as const, sourceUrl: marketSourceUrl, capturedAt } }
          : {}),
        ...(history?.sourceUrl && history.capturedAt
          ? { history: { provider: "geckoterminal" as const, sourceUrl: history.sourceUrl, capturedAt: history.capturedAt } }
          : {}),
      },
      providers: ["twitterapi", "dexscreener", ...(history ? ["geckoterminal" as const] : [])],
      ...(priceUsd !== undefined ? { priceUsd } : {}),
      ...(marketCapUsd !== undefined ? { marketCapUsd } : {}),
      ...(fdvUsd !== undefined ? { fdvUsd } : {}),
      ...(volume24hUsd !== undefined ? { volume24hUsd } : {}),
      ...(liquidityUsd !== undefined ? { liquidityUsd } : {}),
      pairAddress,
      ...(history ? { history } : {}),
      ...(cleanText(info.imageUrl) ? { imageUrl: cleanText(info.imageUrl) } : {}),
    },
  };
}

export async function collectProjectTokenIdentity(
  ctx: CollectContext,
  dependencies: { recoverOfficialText?: (url: string) => Promise<PublicTextWithRecoveryResult> } = {},
): Promise<AdapterRunResult> {
  const query = projectName(ctx.evidence.profile.display_name || ctx.handle.replace(/^@/, ""));
  const registryQueries = projectRegistrySearchQueries(
    ctx.evidence.profile.display_name || ctx.handle.replace(/^@/, ""),
    ctx.evidence.subjectOrientation?.launchedProducts,
  );
  const seeded = parseSeededContract(ctx);
  const profileDeclaredToken = ctx.evidence.profile.profile_collection_state === "resolved"
    && ctx.evidence.profile.profile_provider === "twitterapi"
    && Number.isFinite(Date.parse(ctx.evidence.profile.profile_captured_at ?? ""))
    ? declaredTokenFromBio(ctx.evidence.profile.bio)
    : null;
  if (!registryQueries.length && !seeded && !profileDeclaredToken) {
    return { state: "skipped", detail: "project display name unavailable", attempts: 0 };
  }

  if (profileDeclaredToken) {
    const declared = await collectProfileDeclaredToken(ctx, profileDeclaredToken);
    if (declared.state === "matched" && declared.snapshot) {
      const snapshot = declared.snapshot;
      ctx.evidence.projectToken = snapshot;
      ctx.recordCheck?.({
        id: "project-token-identity",
        status: "confirmed",
        note: `$${snapshot.symbol} is the exact ${snapshot.chain} contract explicitly declared in the provider-frozen official X bio`,
        provider: "twitterapi/dexscreener",
        sourceCount: 2,
      });
      if ((snapshot.liquidityUsd ?? 0) >= MIN_POOL_LIQUIDITY_USD) {
        ctx.recordCheck?.({
          id: "project-traction-liveness",
          status: "confirmed",
          note: `$${snapshot.symbol} has an exact-address DEX pool with $${Math.round(snapshot.liquidityUsd ?? 0).toLocaleString()} liquidity${historyCoverageNote(snapshot.history)}`,
          provider: snapshot.history ? "dexscreener/geckoterminal" : "dexscreener",
          sourceCount: snapshot.history ? 2 : 1,
        });
      }
      ctx.emit({
        phase: "P0 · Routing",
        label: `Official bio contract resolved · $${snapshot.symbol}`,
        detail: `${snapshot.address} was explicitly declared by @${normalizeHandle(ctx.handle)} and resolved to an exact ${snapshot.chain} market. Project methodology is now bound to that contract.`,
        source: "twitterapi / dexscreener",
        tone: "good",
      });
      return { state: "executed", detail: declared.detail, attempts: declared.attempts };
    }
    const providerUnavailable = declared.state === "failed";
    ctx.recordCheck?.({
      id: "project-token-identity",
      status: providerUnavailable ? "unavailable" : "finding",
      note: declared.detail,
      provider: "twitterapi/dexscreener",
      sourceCount: 1,
    });
    ctx.emit({
      phase: "P0 · Routing",
      label: providerUnavailable ? "Official bio contract could not be checked" : "Official bio contract has no resolved market",
      detail: declared.detail,
      source: "twitterapi / dexscreener",
      tone: "warn",
    });
    return {
      state: providerUnavailable ? "partial" : "executed",
      detail: declared.detail,
      attempts: declared.attempts,
    };
  }

  const registryHomepages: string[] = [];
  type SelectedToken = {
    details: JsonRecord;
    identity: NonNullable<ReturnType<typeof verifyIdentity>>;
    contract: ContractIdentity;
  };
  let selected: SelectedToken | null = null;
  let search: CoinSearchRow[] | null = null;
  const candidates: CoinSearchRow[] = [];
  let inspected: Array<{ details: JsonRecord | null; selected: SelectedToken | null }> = [];
  let detailAttempts = 0;
  let contractLookupFailed = false;
  let seedPairAttempts = 0;

  if (seeded) {
    // Contract-first: the investigation already named this CA. Do not apply
    // the name-overlap ≥500 filter — $STONKBROKER does not look like "CLUTCH".
    const looked = await coinByContract(seeded.platform, seeded.address);
    detailAttempts += 1;
    if (looked.state === "failed") contractLookupFailed = true;
    if (looked.state === "ok") {
      registryHomepages.push(...cgHandleBoundHomepages(ctx, looked.details));
      const identity = verifyIdentity(ctx, looked.details);
      const listed = canonicalContract(looked.details);
      const contract = listed && sameAddress(listed.address, seeded.address)
        ? listed
        : identity
          ? { address: seeded.address, chain: seeded.chain }
          : listed;
      if (identity && contract) selected = { details: looked.details, identity, contract };
    }
    if (!selected) {
      const seedPairs = await dexPairs(seeded.address);
      seedPairAttempts += 1;
      if (seedPairs) {
        for (const row of seedPairs) registryHomepages.push(...dexHandleBoundHomepages(ctx, row));
      }
    }
  }

  if (!selected && registryQueries.length) {
    const seenIds = new Set<string>();
    let anySearchCompleted = false;
    for (const registryQuery of registryQueries) {
      const rows = await coinSearch(registryQuery);
      if (rows === null) continue;
      anySearchCompleted = true;
      search = rows;
      for (const row of rankedCandidates(registryQuery, rows)) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        candidates.push(row);
      }
    }
    if (!anySearchCompleted) search = null;
    detailAttempts += candidates.length;
    inspected = await Promise.all(candidates.map(async (candidate) => {
      const details = await coinDetails(candidate.id);
      if (!details) return { details: null, selected: null };
      registryHomepages.push(...cgHandleBoundHomepages(ctx, details));
      const identity = verifyIdentity(ctx, details);
      const contract = canonicalContract(details);
      return {
        details,
        selected: identity && contract ? { details, identity, contract } : null,
      };
    }));
    selected = inspected.find((candidate) => candidate.selected !== null)?.selected ?? null;
  }
  if (!selected?.identity) {
    // CoinGecko is not a complete token universe. New and chain-native assets
    // often trade on a DEX before they are listed there, so a CoinGecko miss
    // must fall through to an identity-bound DEX search before ARGUS records a
    // substantive null. Exact X/domain matching remains mandatory.
    //
    // The DEX search runs each fallback query in turn (the full cleaned name,
    // then the name with its generic corporate suffix dropped) until one yields
    // an identity-bound match: DexScreener's search for "Greenwood Finance"
    // does not return the token named "Greenwood" at all. Only recall widens;
    // the identity gate is unchanged.
    const dexQueries = registryQueries;
    let dexFallback: DexFallbackResult = {
      state: "empty",
      attempts: 0,
      detail: "DexScreener project search skipped: no display-name query",
    };
    let dexAttempts = 0;
    let dexSearchEverFailed = false;
    const dexNameMatches = new Set<string>();
    let dexNameMatchCount = 0;
    for (const fallbackQuery of dexQueries) {
      if (dexFallback.state === "matched") break;
      const retry = await collectDexProjectToken(ctx, fallbackQuery);
      dexAttempts += retry.attempts;
      if (retry.state === "failed") dexSearchEverFailed = true;
      if (retry.state === "empty") {
        for (const match of retry.nameMatches ?? []) dexNameMatches.add(match);
        dexNameMatchCount = Math.max(dexNameMatchCount, retry.nameMatchCount ?? 0);
      }
      if (retry.state === "matched") dexFallback = retry;
    }
    if (dexFallback.state !== "matched" && dexNameMatches.size) {
      dexFallback = {
        ...dexFallback,
        state: "empty",
        nameMatches: [...dexNameMatches].slice(0, 3),
        nameMatchCount: Math.max(dexNameMatchCount, dexNameMatches.size),
      };
    }
    const attempts = (query.length >= 2 ? 1 : 0) + detailAttempts + seedPairAttempts + dexAttempts;
    if (dexFallback.state === "matched" && dexFallback.snapshot) {
      const snapshot = dexFallback.snapshot;
      ctx.evidence.projectToken = snapshot;
      if (!canonicalOfficialWebsite(ctx.evidence.profile.website) && snapshot.homepage) {
        ctx.evidence.profile.website = snapshot.homepage;
      }
      ctx.recordCheck?.({
        id: "project-token-identity",
        status: "confirmed",
        note: `$${snapshot.symbol} matched this project through its ${snapshot.verification === "official_x" ? "official X account" : "official website domain"} and canonical ${snapshot.chain} contract`,
        provider: "dexscreener",
        sourceCount: 1,
      });
      if ((snapshot.liquidityUsd ?? 0) >= MIN_POOL_LIQUIDITY_USD) {
        ctx.recordCheck?.({
          id: "project-traction-liveness",
          status: "confirmed",
          note: `$${snapshot.symbol} has an identity-bound DEX pool with $${Math.round(snapshot.liquidityUsd ?? 0).toLocaleString()} liquidity${historyCoverageNote(snapshot.history)}`,
          provider: snapshot.history ? "dexscreener/geckoterminal" : "dexscreener",
          sourceCount: snapshot.history ? 2 : 1,
        });
      }
      ctx.emit({
        phase: "P0 · Routing",
        label: `Official token resolved · $${snapshot.symbol}`,
        detail: `${snapshot.name} matched by ${snapshot.verification === "official_x" ? "official X account" : "official domain"} on DexScreener; the canonical ${snapshot.chain} contract and market pool were frozen.`,
        source: snapshot.history ? "dexscreener / geckoterminal" : "dexscreener",
        tone: "good",
      });
      return { state: "executed", detail: dexFallback.detail, attempts };
    }

    // Last tier before an assessed null: the project's own domain. A registry
    // that never got the project's socials cannot speak for it, but the
    // project's own site can, and it is the stronger evidence of the two.
    const declared = await collectSiteDeclaredToken(
      ctx,
      fetch,
      registryHomepages,
      dependencies.recoverOfficialText ?? fetchPublicTextWithRecovery,
    );
    if (declared) {
      ctx.evidence.projectToken = declared.snapshot;
      ctx.recordCheck?.({
        id: "project-token-identity",
        status: "confirmed",
        note: `$${declared.snapshot.symbol} is published as this project's contract on its own verified site (${declared.sourceUrl}) and resolves to a tradeable ${declared.snapshot.chain} token`,
        provider: "site-fetch/dexscreener",
        sourceCount: 2,
      });
      ctx.emit({
        phase: "P0 · Routing",
        label: `Official token declared on the project site · $${declared.snapshot.symbol}`,
        detail: `${declared.sourceUrl} publishes ${declared.snapshot.address} as its contract, and that address trades on ${declared.snapshot.chain}. First-party declaration outranks a registry's self-reported links.`,
        source: "site-fetch / dexscreener",
        tone: "good",
      });
      return { state: "executed", detail: `bound $${declared.snapshot.symbol} from the project's own site`, attempts: attempts + 1 };
    }

    const coinDetailsUnavailable = inspected.some((candidate) => candidate.details === null);
    if ((registryQueries.length > 0 && !search) || coinDetailsUnavailable || dexSearchEverFailed || contractLookupFailed) {
      const gaps = [
        contractLookupFailed ? "CoinGecko contract lookup failed" : null,
        registryQueries.length > 0 && !search ? "CoinGecko search failed" : null,
        coinDetailsUnavailable ? "one or more CoinGecko candidate records failed" : null,
        dexSearchEverFailed ? "DexScreener project search failed" : null,
      ].filter((part): part is string => Boolean(part));
      // A provider failure is not an assessed null, but it must still be
      // RECORDED: leaving this decision-critical row unwritten made the report
      // fall back to its placeholder note ("no official token identity was
      // bound"), which reads as an assessed result and points nowhere. The
      // sanctions screen set the precedent: an unreachable source records
      // unavailable instead of silently passing or silently vanishing.
      ctx.recordCheck?.({
        id: "project-token-identity",
        status: "unavailable",
        note: `token-identity registries could not be fully read on this scan (${gaps.join("; ")}); this is a provider gap, not an assessed result, and a rescan can close it`,
        provider: "coingecko/dexscreener",
      });
      return {
        state: "partial",
        detail: `${gaps.join("; ")}; recorded as an unavailable token-identity outcome`,
        attempts,
      };
    }

    // Both independent registry paths completed and neither produced an
    // account/domain-bound contract. This is an assessed null on token
    // identity, not a claim that no similarly named token exists.
    const dexAlikes = dexFallback.state === "empty" ? dexFallback.nameMatches ?? [] : [];
    const dexAlikeCount = dexFallback.state === "empty" ? dexFallback.nameMatchCount ?? 0 : 0;
    const cgSamples = candidates.slice(0, 3).map((row) => `${row.name} ($${row.symbol.toUpperCase()})`);
    const alikeSamples = [...new Set([...cgSamples, ...dexAlikes])].slice(0, 3);
    const alikeCount = Math.max(candidates.length + dexAlikeCount, alikeSamples.length);
    ctx.recordCheck?.({
      id: "project-token-identity",
      status: "finding",
      note: alikeCount > 0
        ? `assessed token identity: CoinGecko and DexScreener searches completed. ${alikeCount} token${alikeCount === 1 ? " trades" : "s trade"} under a matching name (${alikeSamples.join(", ")}${alikeCount > alikeSamples.length ? ", and more" : ""}), and none links back to the official X account or website domain, so no official token was recorded. A null result on this axis, not adverse conduct evidence.`
        : "assessed token identity: CoinGecko and DexScreener searches completed and found no token under a matching name. A null result on this axis, not adverse conduct evidence.",
      provider: "coingecko/dexscreener",
    });
    return {
      state: "executed",
      detail: "CoinGecko and DexScreener returned no identity-bound project token",
      attempts,
    };
  }

  const { details, identity, contract } = selected;
  const market = isRecord(details.market_data) ? details.market_data : {};
  const currentPrice = isRecord(market.current_price) ? finiteNumber(market.current_price.usd) : undefined;
  const marketCap = isRecord(market.market_cap) ? finiteNumber(market.market_cap.usd) : undefined;
  const fdv = isRecord(market.fully_diluted_valuation) ? finiteNumber(market.fully_diluted_valuation.usd) : undefined;
  const volume = isRecord(market.total_volume) ? finiteNumber(market.total_volume.usd) : undefined;
  const circulatingSupply = finiteNumber(market.circulating_supply);
  const totalSupply = finiteNumber(market.total_supply);
  const maxSupply = finiteNumber(market.max_supply);
  const athPrice = isRecord(market.ath) ? finiteNumber(market.ath.usd) : undefined;
  const athDateRaw = isRecord(market.ath_date) ? cleanText(market.ath_date.usd) : "";
  const athDrawdown = isRecord(market.ath_change_percentage)
    ? finiteNumber(market.ath_change_percentage.usd)
    : undefined;
  const ath = athPrice !== undefined || athDateRaw || athDrawdown !== undefined
    ? {
        ...(athPrice !== undefined ? { priceUsd: athPrice } : {}),
        ...(athDateRaw ? { date: athDateRaw } : {}),
        ...(athDrawdown !== undefined ? { drawdownPct: athDrawdown } : {}),
      }
    : undefined;
  const id = cleanText(details.id);
  const name = cleanText(details.name);
  const symbol = cleanText(details.symbol).toUpperCase();
  if (!id || !name || !symbol) {
    return { state: "partial", detail: "verified CoinGecko identity had incomplete token metadata", attempts: 1 + detailAttempts };
  }

  const collectedAt = captureTimestamp();
  const providerUpdatedAt = cleanText(details.last_updated);
  const providerUpdatedMs = Date.parse(providerUpdatedAt);
  const normalizedProviderUpdatedAt = Number.isFinite(providerUpdatedMs)
    ? new Date(providerUpdatedMs).toISOString()
    : undefined;
  const pairs = await dexPairs(contract.address);
  const liquidityCapturedAt = pairs ? captureTimestamp() : null;
  const pair = pairs ? selectPriceCorroboratedPair(pairs, contract, currentPrice) : null;
  const historyResult = pair
    ? await tokenHistory(contract.chain, pair.pairAddress)
    : { attempts: 0 };
  const history = historyResult.history;
  // CoinGecko's update time belongs only to the CoinGecko record. The DEX and
  // candle reads carry their own capture times below.
  const coinSourceUrl = `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`;
  const hasMarketRead = currentPrice !== undefined
    || marketCap !== undefined
    || fdv !== undefined
    || volume !== undefined
    || circulatingSupply !== undefined
    || totalSupply !== undefined
    || maxSupply !== undefined
    || ath !== undefined
    || Number.isFinite(details.market_cap_rank);
  const snapshot: ProjectTokenSnapshot = {
    verified: true,
    verification: identity.verification,
    name,
    symbol,
    coingeckoId: id,
    rank: Number.isFinite(details.market_cap_rank) ? Number(details.market_cap_rank) : null,
    address: contract.address,
    chain: contract.chain,
    ...identity.homepage ? { homepage: identity.homepage } : {},
    ...identity.officialX ? { officialX: identity.officialX } : {},
    sourceUrl: coinSourceUrl,
    capturedAt: collectedAt,
    producerSources: {
      identity: { provider: "coingecko", sourceUrl: coinSourceUrl, capturedAt: collectedAt },
      ...(hasMarketRead
        ? {
            market: {
              provider: "coingecko" as const,
              sourceUrl: coinSourceUrl,
              capturedAt: collectedAt,
              ...(normalizedProviderUpdatedAt ? { providerUpdatedAt: normalizedProviderUpdatedAt } : {}),
            },
          }
        : {}),
      ...(pair && liquidityCapturedAt
        ? { liquidity: { provider: "dexscreener" as const, sourceUrl: pair.sourceUrl, capturedAt: liquidityCapturedAt } }
        : {}),
      ...(history?.sourceUrl && history.capturedAt
        ? { history: { provider: "geckoterminal" as const, sourceUrl: history.sourceUrl, capturedAt: history.capturedAt } }
        : {}),
    },
    providers: ["coingecko", ...(pair ? ["dexscreener" as const] : []), ...(history ? ["geckoterminal" as const] : [])],
    ...currentPrice !== undefined ? { priceUsd: currentPrice } : {},
    ...marketCap !== undefined ? { marketCapUsd: marketCap } : {},
    ...fdv !== undefined ? { fdvUsd: fdv } : {},
    ...volume !== undefined ? { volume24hUsd: volume } : {},
    ...circulatingSupply !== undefined ? { circulatingSupply } : {},
    ...totalSupply !== undefined ? { totalSupply } : {},
    ...maxSupply !== undefined ? { maxSupply } : {},
    ...pair ? { liquidityUsd: pair.liquidityUsd, pairAddress: pair.pairAddress } : {},
    ...ath ? { ath } : {},
    ...history ? { history } : {},
  };
  ctx.evidence.projectToken = snapshot;
  if (!canonicalOfficialWebsite(ctx.evidence.profile.website) && snapshot.homepage) {
    ctx.evidence.profile.website = snapshot.homepage;
  }
  ctx.recordCheck?.({
    id: "project-token-identity",
    status: "confirmed",
    note: `$${snapshot.symbol} matched this project through its ${snapshot.verification === "official_x" ? "official X account" : "official website domain"} and canonical ${snapshot.chain} contract`,
    provider: "coingecko",
    sourceCount: 1,
  });
  if (pair) {
    ctx.recordCheck?.({
      id: "project-traction-liveness",
      status: "confirmed",
      note: `$${snapshot.symbol} has a price-corroborated DEX pool with $${Math.round(pair.liquidityUsd).toLocaleString()} liquidity${historyCoverageNote(history)}`,
      provider: history ? "dexscreener/geckoterminal" : "dexscreener",
      sourceCount: history ? 2 : 1,
    });
  }
  ctx.emit({
    phase: "P0 · Routing",
    label: `Official token resolved · $${snapshot.symbol}`,
    detail: `${snapshot.name} matched by ${snapshot.verification === "official_x" ? "official X account" : "official domain"}${pair ? `; price corroborated on a $${Math.round(pair.liquidityUsd).toLocaleString()} liquidity pool` : "; no DEX pool passed price corroboration"}.`,
    source: "coingecko / dexscreener",
    tone: "good",
  });
  return {
    state: pairs === null ? "partial" : "executed",
    detail: `verified $${snapshot.symbol} by ${snapshot.verification}${pair ? " with a price-corroborated DEX pair" : " without a price-corroborated DEX pair"}`,
    attempts: 1 + detailAttempts + 1 + historyResult.attempts,
  };
}

export const projectTokenAdapter: Adapter = {
  id: "project-token",
  label: "Project token identity",
  available: () => true,
  run: collectProjectTokenIdentity,
};

/**
 * Resolve a verified venture's canonical token for a FOUNDER audit, using the
 * same official-X / official-domain binding as a project audit but scoped to
 * the venture's own bridge keys (its X handle / website), never the person's.
 * Read-only: no ctx mutation, no project checks, no market-history fetches.
 * Returns null when no candidate binds; a name match alone never verifies.
 */
export async function collectVentureTokenIdentity(venture: {
  name: string;
  xHandle?: string;
  domain?: string;
}): Promise<VentureTokenSnapshot | null> {
  const query = projectName(venture.name);
  const ventureHandle = venture.xHandle?.trim() ? normalizeHandle(venture.xHandle) : null;
  const ventureScope = venture.domain?.trim() ? canonicalOfficialWebsite(venture.domain) : null;
  if (query.length < 2 || (!ventureHandle && !ventureScope)) return null;

  const search = await coinSearch(query);
  if (!search) return null;
  const candidates = rankedCandidates(query, search);
  for (const candidate of candidates) {
    const details = await coinDetails(candidate.id);
    if (!details) continue;
    const links = isRecord(details.links) ? details.links : {};
    const officialHandle = cleanText(links.twitter_screen_name);
    const exactX = Boolean(ventureHandle && officialHandle && normalizeHandle(officialHandle) === ventureHandle);
    const homepages = officialHomepages(details);
    const domainHomepage = ventureScope
      ? homepages.find((candidateHome) => {
          const tokenScope = canonicalOfficialWebsite(candidateHome);
          return tokenScope !== null && domainsMatch(ventureScope.domain, tokenScope.domain);
        })
      : undefined;
    if (!exactX && !domainHomepage) continue;
    const contract = canonicalContract(details);
    if (!contract) continue;
    const id = cleanText(details.id);
    const name = cleanText(details.name);
    const symbol = cleanText(details.symbol).toUpperCase();
    if (!id || !name || !symbol) continue;
    const market = isRecord(details.market_data) ? details.market_data : {};
    const currentPrice = isRecord(market.current_price) ? finiteNumber(market.current_price.usd) : undefined;
    const marketCap = isRecord(market.market_cap) ? finiteNumber(market.market_cap.usd) : undefined;
    const capturedAt = captureTimestamp();
    const providerUpdatedAt = cleanText(details.last_updated);
    const providerUpdatedMs = Date.parse(providerUpdatedAt);
    const normalizedProviderUpdatedAt = Number.isFinite(providerUpdatedMs)
      ? new Date(providerUpdatedMs).toISOString()
      : undefined;
    const sourceUrl = `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`;
    return {
      verified: true,
      verification: exactX ? "official_x" : "official_domain",
      ventureName: venture.name,
      name,
      symbol,
      coingeckoId: id,
      rank: Number.isFinite(details.market_cap_rank) ? Number(details.market_cap_rank) : null,
      address: contract.address,
      chain: contract.chain,
      ...(homepages[0] ? { homepage: homepages[0] } : {}),
      ...(officialHandle ? { officialX: `@${officialHandle.replace(/^@/, "")}` } : {}),
      sourceUrl,
      capturedAt,
      producerSources: {
        identity: { provider: "coingecko", sourceUrl, capturedAt },
        ...(currentPrice !== undefined || marketCap !== undefined
          ? {
              market: {
                provider: "coingecko" as const,
                sourceUrl,
                capturedAt,
                ...(normalizedProviderUpdatedAt ? { providerUpdatedAt: normalizedProviderUpdatedAt } : {}),
              },
            }
          : {}),
      },
      providers: ["coingecko"],
      ...(currentPrice !== undefined ? { priceUsd: currentPrice } : {}),
      ...(marketCap !== undefined ? { marketCapUsd: marketCap } : {}),
    };
  }
  return null;
}
