import type { ProjectTokenSnapshot, VentureTokenSnapshot } from "../../src/data/evidence";
import { canonicalOfficialWebsite } from "../../src/lib/fundScaleEvidence";
import { env } from "../config";
import { recordCall } from "../cost";
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

const PLATFORM_CHAIN: Record<string, string> = {
  solana: "solana",
  ethereum: "ethereum",
  base: "base",
  "arbitrum-one": "arbitrum",
  "binance-smart-chain": "bsc",
  "polygon-pos": "polygon",
  "optimistic-ethereum": "optimism",
  avalanche: "avalanche",
};

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
    return {
      state: "empty",
      attempts: 1,
      detail: "DexScreener returned no identity-bound project-token candidate",
    };
  }
  const historyResult = await tokenHistory(candidate.chain, candidate.pairAddress);
  const history = historyResult.history;
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
      capturedAt: new Date().toISOString(),
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
): Promise<number[][] | null> {
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
  const valid = rows.filter((row): row is number[] =>
    Array.isArray(row)
      && row.length >= 6
      && row.slice(0, 6).every((value) => typeof value === "number" && Number.isFinite(value)),
  ).slice(0, MAX_HISTORY_POINTS);
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
  let rows = await ohlcv(chain, poolAddress, timeframe);
  if (!rows?.length) {
    timeframe = "hour";
    attempts += 1;
    rows = await ohlcv(chain, poolAddress, timeframe);
  }
  if (!rows?.length) return { attempts };
  const chronological = [...rows].sort((left, right) => left[0] - right[0]);
  const points = chronological.map((row) => row[4]).filter((value) => Number.isFinite(value) && value > 0);
  if (!points.length) return { attempts };
  const first = points[0];
  const last = points[points.length - 1];
  const peak = Math.max(...points);
  return {
    attempts,
    history: {
      points,
      first,
      last,
      peak,
      changePct: first > 0 ? ((last - first) / first) * 100 : 0,
      drawdownPct: peak > 0 ? ((last - peak) / peak) * 100 : 0,
      timeframe,
      poolAddress,
      ...(geckoTerminalOhlcvUrl(chain, poolAddress, timeframe) ? {
        sourceUrl: geckoTerminalOhlcvUrl(chain, poolAddress, timeframe)!,
      } : {}),
    },
  };
}

export async function collectProjectTokenIdentity(ctx: CollectContext): Promise<AdapterRunResult> {
  const query = projectName(ctx.evidence.profile.display_name || ctx.handle.replace(/^@/, ""));
  if (query.length < 2) return { state: "skipped", detail: "project display name unavailable", attempts: 0 };

  const search = await coinSearch(query);
  const candidates = search ? rankedCandidates(query, search) : [];
  const detailAttempts = candidates.length;
  const inspected = await Promise.all(candidates.map(async (candidate) => {
    const details = await coinDetails(candidate.id);
    if (!details) return { details: null, selected: null };
    const identity = verifyIdentity(ctx, details);
    const contract = canonicalContract(details);
    return {
      details,
      selected: identity && contract ? { details, identity, contract } : null,
    };
  }));
  const selected = inspected.find((candidate) => candidate.selected !== null)?.selected ?? null;
  if (!selected?.identity) {
    // CoinGecko is not a complete token universe. New and chain-native assets
    // often trade on a DEX before they are listed there, so a CoinGecko miss
    // must fall through to an identity-bound DEX search before ARGUS records a
    // substantive null. Exact X/domain matching remains mandatory.
    const dexFallback = await collectDexProjectToken(ctx, query);
    const attempts = 1 + detailAttempts + dexFallback.attempts;
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
          note: `$${snapshot.symbol} has an identity-bound DEX pool with $${Math.round(snapshot.liquidityUsd ?? 0).toLocaleString()} liquidity${snapshot.history ? ` and ${snapshot.history.points.length} frozen ${snapshot.history.timeframe} price points` : ""}`,
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

    const coinDetailsUnavailable = inspected.some((candidate) => candidate.details === null);
    if (!search || coinDetailsUnavailable || dexFallback.state === "failed") {
      const gaps = [
        !search ? "CoinGecko search failed" : null,
        coinDetailsUnavailable ? "one or more CoinGecko candidate records failed" : null,
        dexFallback.state === "failed" ? dexFallback.detail : null,
      ].filter((part): part is string => Boolean(part));
      return {
        state: "partial",
        detail: `${gaps.join("; ")}; no canonical-token null was recorded`,
        attempts,
      };
    }

    // Both independent registry paths completed and neither produced an
    // account/domain-bound contract. This is an assessed null on token
    // identity, not a claim that no similarly named token exists.
    ctx.recordCheck?.({
      id: "project-token-identity",
      status: "finding",
      note: `assessed token identity: CoinGecko and DexScreener searches completed; ${candidates.length} CoinGecko candidate${candidates.length === 1 ? " was" : "s were"} inspected and neither registry produced a contract bound to the official X account or website domain. A null result on this axis, not adverse conduct evidence.`,
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

  const pairs = await dexPairs(contract.address);
  const pair = pairs ? selectPriceCorroboratedPair(pairs, contract, currentPrice) : null;
  const historyResult = pair
    ? await tokenHistory(contract.chain, pair.pairAddress)
    : { attempts: 0 };
  const history = historyResult.history;
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
    sourceUrl: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`,
    capturedAt: new Date().toISOString(),
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
      note: `$${snapshot.symbol} has a price-corroborated DEX pool with $${Math.round(pair.liquidityUsd).toLocaleString()} liquidity${history ? ` and ${history.points.length} frozen ${history.timeframe} price points` : ""}`,
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
      sourceUrl: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`,
      capturedAt: new Date().toISOString(),
      providers: ["coingecko"],
      ...(currentPrice !== undefined ? { priceUsd: currentPrice } : {}),
      ...(marketCap !== undefined ? { marketCapUsd: marketCap } : {}),
    };
  }
  return null;
}
