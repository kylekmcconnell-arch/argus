// Live token-data sources. Both are free, keyless, and CORS-open, so the entire
// token audit runs client-side in the browser, even on the static hosted site.
//   - DexScreener: market, liquidity, volume, txns, age, socials.
//   - GoPlus: contract safety (honeypot, mint authority, ownership, tax, holders).

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  txns?: { h24?: { buys: number; sells: number } };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  baseToken?: { address: string; name: string; symbol: string };
  quoteToken?: { symbol: string };
  labels?: string[];
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}

export type DexPairsResult =
  | { ok: true; pairs: DexPair[] }
  | { ok: false; pairs: [] };

// DexScreener chainId -> GoPlus numeric chain id (EVM only)
export const GOPLUS_CHAIN: Record<string, string> = {
  ethereum: "1",
  bsc: "56",
  base: "8453",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
  zksync: "324",
  linea: "59144",
  scroll: "534352",
  // Robinhood Chain (Arbitrum stack, mainnet Jul 2026). GoPlus has covered it
  // since launch; ARGUS simply never asked, which left every token on this
  // chain with no safety data, no creator, and therefore no sanctions screen.
  robinhood: "4663",
};

/**
 * Chains where GoPlus returns a holder sample that is NOT ordered by balance.
 * Observed on Robinhood Chain: its ten rows all sat near 0.36% while the real
 * top holder held 4.17%, which would publish a 12x understatement of
 * concentration as if it were measured. Safety flags and creator_address from
 * these chains stay trustworthy; only the holder ordering is unusable.
 */
export const GOPLUS_UNSORTED_HOLDER_CHAINS: ReadonlySet<string> = new Set(["robinhood"]);

/** Keyless Blockscout instances, used where they are the only correct holder source. */
const BLOCKSCOUT_API: Record<string, string> = {
  robinhood: "https://robinhoodchain.blockscout.com",
};

/** Exact public endpoint that produces the ordered holder register. */
export function blockscoutHolderSourceUrl(chain: string, address: string): string | null {
  const base = BLOCKSCOUT_API[chain.trim().toLowerCase()];
  return base ? `${base}/api/v2/tokens/${encodeURIComponent(address)}/holders` : null;
}

export interface ExplorerHolder { address: string; percent: number; isContract?: boolean }

export interface ExplorerContractSource {
  name: string | null;
  isVerified: boolean;
  sourceCode: string;
}

/**
 * Verified contract source from a public Blockscout instance (keyless).
 * Read only to inspect what the deployer wrote about their own contract; the
 * source is never executed, compiled, or trusted as a claim about behaviour.
 */
export async function blockscoutContractSource(
  chain: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExplorerContractSource | null> {
  const base = BLOCKSCOUT_API[chain];
  if (!base) return null;
  try {
    const response = await fetchImpl(`${base}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) return null;
    const body = await response.json() as { name?: unknown; is_verified?: unknown; source_code?: unknown };
    const sourceCode = typeof body?.source_code === "string" ? body.source_code : "";
    if (!sourceCode) return null;
    return {
      name: typeof body?.name === "string" ? body.name : null,
      isVerified: body?.is_verified === true,
      sourceCode: sourceCode.slice(0, 400_000),
    };
  } catch {
    return null;
  }
}

/**
 * Top token holders from a public Blockscout instance (keyless, CORS-open).
 * Blockscout returns holders correctly ordered by balance, so this is the
 * authoritative distribution on chains GoPlus cannot order.
 */
export async function blockscoutHolders(
  chain: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExplorerHolder[] | null> {
  const chainKey = chain.trim().toLowerCase();
  const base = BLOCKSCOUT_API[chainKey];
  if (!base) return null;
  const holderSourceUrl = blockscoutHolderSourceUrl(chainKey, address);
  if (!holderSourceUrl) return null;
  try {
    const [tokenRes, holderRes] = await Promise.all([
      fetchImpl(`${base}/api/v2/tokens/${address}`, { signal: AbortSignal.timeout(9000) }),
      fetchImpl(holderSourceUrl, { signal: AbortSignal.timeout(9000) }),
    ]);
    if (!tokenRes.ok || !holderRes.ok) return null;
    const meta = await tokenRes.json() as { total_supply?: string };
    const supply = Number(meta?.total_supply ?? 0);
    if (!Number.isFinite(supply) || supply <= 0) return null;
    const body = await holderRes.json() as { items?: Array<{ value?: string; address?: { hash?: string; is_contract?: boolean } }> };
    const items = Array.isArray(body?.items) ? body.items : [];
    const rows: ExplorerHolder[] = [];
    for (const item of items) {
      const value = Number(item?.value ?? 0);
      const hash = item?.address?.hash;
      if (!hash || !Number.isFinite(value) || value <= 0) continue;
      rows.push({ address: hash, percent: (value / supply) * 100, isContract: item.address?.is_contract === true });
      if (rows.length >= 10) break;
    }
    return rows;
  } catch {
    return null;
  }
}

// Trending + freshly-listed tokens, for the live Radar. Merges DexScreener's
// boosted (trending) and latest-profile feeds, deduped.
export interface RadarRef { chainId: string; tokenAddress: string }
export async function radarTokens(): Promise<RadarRef[]> {
  const urls = [
    "https://api.dexscreener.com/token-boosts/top/v1",
    "https://api.dexscreener.com/token-profiles/latest/v1",
  ];
  const seen = new Set<string>();
  const out: RadarRef[] = [];
  const lists = await Promise.all(
    urls.map((u) => fetch(u).then((r) => (r.ok ? r.json() : [])).catch(() => [])),
  );
  for (const list of lists as { chainId?: string; tokenAddress?: string }[][]) {
    for (const it of list ?? []) {
      if (!it.chainId || !it.tokenAddress) continue;
      const key = it.chainId + ":" + it.tokenAddress.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chainId: it.chainId, tokenAddress: it.tokenAddress });
    }
  }
  return out;
}

export async function dexByTokenResult(address: string): Promise<DexPairsResult> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, pairs: [] };
    const d = (await res.json()) as { pairs?: DexPair[] };
    return { ok: true, pairs: d.pairs ?? [] };
  } catch {
    return { ok: false, pairs: [] };
  }
}

export async function dexByToken(address: string): Promise<DexPair[]> {
  const result = await dexByTokenResult(address);
  return result.pairs;
}

// Keyless, CORS-open free-text search across DexScreener — lets a site recon
// look for a project's token on-chain by name/ticker when the page hides the
// contract address.
export async function searchTokensResult(query: string): Promise<DexPairsResult> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, pairs: [] };
    const d = (await res.json()) as { pairs?: DexPair[] };
    return { ok: true, pairs: d.pairs ?? [] };
  } catch {
    return { ok: false, pairs: [] };
  }
}

export async function searchTokens(query: string): Promise<DexPair[]> {
  const result = await searchTokensResult(query);
  return result.pairs;
}

// Investigation Logic Map, Phase 1 Step 2: corroborate token data against an
// independent market-data source. CoinGecko public is keyless + CORS-open.
const CG_PLATFORM: Record<string, string> = {
  ethereum: "ethereum", eth: "ethereum", base: "base", solana: "solana",
  bsc: "binance-smart-chain", polygon: "polygon-pos", arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum", avalanche: "avalanche", fantom: "fantom",
};
const CG_DEX = /uniswap|pancake|raydium|sushi|curve|balancer|orca|meteora|aerodrome|camelot|quickswap|trader.?joe|\bdex\b/i;
export interface CgInfo {
  listed: boolean;
  rank: number | null;
  mcapUsd: number | null;
  marketCount: number;
  cexCount: number;
  cexNames: string[];
  homepage: string | null;
  twitter: string | null;
  image: string | null;
  description: string | null;
  /** CoinGecko lifetime high, frozen with the token scan when available. */
  ath?: {
    priceUsd: number | null;
    date: string | null;
    drawdownPct: number | null;
  } | null;
}

interface CoinGeckoTicker {
  market?: { name?: string; identifier?: string };
}

interface CoinGeckoResponse {
  tickers?: CoinGeckoTicker[];
  links?: { homepage?: unknown[]; twitter_screen_name?: unknown };
  image?: { large?: string; small?: string; thumb?: string };
  market_cap_rank?: number;
  market_data?: {
    market_cap?: { usd?: number };
    ath?: { usd?: number };
    ath_date?: { usd?: string };
    ath_change_percentage?: { usd?: number };
  };
  description?: { en?: unknown };
}

// CoinGecko's description.en is the project's own blurb. Keep enough clean text
// for the report's Read more control instead of permanently truncating it in
// the data layer.
function cleanBlurb(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let s = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1") // [text](url) -> text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`>#]+/g, " ")
    .replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length > 1_600) s = `${s.slice(0, 1_597).replace(/\s+\S*$/, "").trim()}…`;
  return s;
}
// Tier-1 CEXes carry the most weight (real listings = real diligence + KYC trail).
const CG_TIER1 = /binance|coinbase|kraken|okx|bybit|kucoin|gate|crypto\.?com|bitget|upbit|huobi|htx|mexc/i;
export async function coingeckoToken(chain: string, address: string): Promise<CgInfo | null> {
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404) return { listed: false, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0, cexNames: [], homepage: null, twitter: null, image: null, description: null };
    if (!res.ok) return null;
    const d = (await res.json()) as CoinGeckoResponse;
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set<string>(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean) as string[]);
    // Tier-1 exchanges first, then the rest, for an honest "listed on" line.
    const cexNames = [...cex].sort((a, b) => (CG_TIER1.test(b) ? 1 : 0) - (CG_TIER1.test(a) ? 1 : 0)).slice(0, 12);
    // OFFICIAL project links — CoinGecko carries these even for blue-chips whose
    // DexScreener pair info is bare (e.g. $UNI). Feeds the investigation's site
    // recon + project-account audit instead of dead-ending on "no website / no X".
    const homepageValue = (d.links?.homepage ?? []).find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    const homepage = typeof homepageValue === "string" ? homepageValue : null;
    const tw = typeof d.links?.twitter_screen_name === "string" ? d.links.twitter_screen_name.replace(/^@/, "").trim() : "";
    const twitter = /^[A-Za-z0-9_]{2,30}$/.test(tw) ? tw : null;
    const image = d.image?.large ?? d.image?.small ?? d.image?.thumb ?? null;
    const athPrice = d.market_data?.ath?.usd;
    const athDate = d.market_data?.ath_date?.usd;
    const athDrawdown = d.market_data?.ath_change_percentage?.usd;
    const ath = athPrice != null || athDate != null || athDrawdown != null
      ? {
          priceUsd: typeof athPrice === "number" && Number.isFinite(athPrice) ? athPrice : null,
          date: typeof athDate === "string" && athDate.trim() ? athDate : null,
          drawdownPct: typeof athDrawdown === "number" && Number.isFinite(athDrawdown) ? athDrawdown : null,
        }
      : null;
    return {
      listed: true,
      rank: d.market_cap_rank ?? null,
      mcapUsd: d.market_data?.market_cap?.usd ?? null,
      marketCount: markets.size,
      cexCount: cex.size,
      cexNames,
      homepage,
      twitter,
      image,
      description: cleanBlurb(d.description?.en),
      ath,
    };
  } catch {
    return null;
  }
}

export async function dexByPairResult(chain: string, pair: string): Promise<{
  ok: boolean;
  pair: DexPair | null;
}> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, pair: null };
    const d = (await res.json()) as { pairs?: DexPair[]; pair?: DexPair };
    return { ok: true, pair: d.pair ?? d.pairs?.[0] ?? null };
  } catch {
    return { ok: false, pair: null };
  }
}

export async function dexByPair(chain: string, pair: string): Promise<DexPair | null> {
  const result = await dexByPairResult(chain, pair);
  return result.pair;
}

export function pickPair(pairs: DexPair[], wantAddress?: string): DexPair | null {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const exact = byLiq.find((p) => p.baseToken?.address === wantAddress);
    if (exact) return exact;
    const match = /^0x[0-9a-f]{40}$/i.test(wantAddress)
      ? byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase())
      : undefined;
    if (match) return match;
  }
  return byLiq[0];
}

export interface GoPlusSecurity {
  is_honeypot?: string;
  honeypot_with_same_creator?: string; // "1" = the deployer has shipped honeypots before
  is_mintable?: string;
  owner_address?: string;
  can_take_back_ownership?: string;
  hidden_owner?: string;
  selfdestruct?: string;
  is_proxy?: string;
  buy_tax?: string;
  sell_tax?: string;
  cannot_sell_all?: string;
  is_open_source?: string;
  transfer_pausable?: string;
  trading_cooldown?: string;
  slippage_modifiable?: string;
  personal_slippage_modifiable?: string;
  is_blacklisted?: string;
  is_whitelisted?: string;
  is_anti_whale?: string;
  anti_whale_modifiable?: string;
  external_call?: string;
  owner_change_balance?: string;
  holder_count?: string;
  lp_holder_count?: string;
  lp_total_supply?: string;
  holders?: { address: string; percent: string; is_locked?: number; is_contract?: number; tag?: string }[];
  lp_holders?: { address: string; percent: string; is_locked?: number; is_contract?: number; tag?: string }[];
  creator_address?: string;
  creator_percent?: string;
}

// honeypot.is — a real buy/sell SIMULATION (EVM). Stronger than a static flag.
export interface HoneypotSim {
  isHoneypot: boolean;
  simSuccess: boolean;
  buyTax: number;
  sellTax: number;
  flags: string[];
}

interface HoneypotResponse {
  honeypotResult?: { isHoneypot?: boolean };
  simulationSuccess?: boolean;
  simulationResult?: { buyTax?: number; sellTax?: number };
  flags?: Array<{ description?: string; flag?: string } | string>;
}
export async function honeypotIs(chainId: string, address: string): Promise<HoneypotSim | null> {
  try {
    const res = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`);
    if (!res.ok) return null;
    const d = (await res.json()) as HoneypotResponse;
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      simSuccess: !!d.simulationSuccess,
      buyTax: d.simulationResult?.buyTax ?? 0,
      sellTax: d.simulationResult?.sellTax ?? 0,
      flags: (d.flags ?? []).map((flag) => typeof flag === "string"
        ? flag
        : flag.description ?? flag.flag ?? String(flag)),
    };
  } catch {
    return null;
  }
}

// GoPlus Solana token security — different shape from EVM (mint/freeze authority,
// transfer hooks, metadata mutability, holders).
export interface SolanaSecurity {
  mintable?: { status?: string };
  freezable?: { status?: string };
  closable?: { status?: string };
  non_transferable?: string;
  transfer_hook?: unknown[];
  transfer_fee?: Record<string, unknown>;
  metadata_mutable?: { status?: string };
  balance_mutable_authority?: { status?: string };
  default_account_state?: string;
  holder_count?: string | number;
  holders?: { account?: string; percent?: string; is_locked?: number; tag?: string }[];
  lp_holders?: { account?: string; percent?: string; is_locked?: number }[];
  creators?: { address?: string }[];
  metadata?: { name?: string; symbol?: string };
  trusted_token?: number;
}
export async function goplusSolana(mint: string): Promise<SolanaSecurity | null> {
  try {
    const res = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { result?: Record<string, SolanaSecurity> };
    const row = d.result?.[mint] ?? (d.result ? Object.values(d.result)[0] : undefined);
    return row ?? null;
  } catch {
    return null;
  }
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** One connected wallet cluster RugCheck traced back to a common funder. */
export interface RugcheckInsiderNetwork {
  /** Wallets RugCheck placed in this cluster, or null when it reported no count. */
  size: number | null;
  /** The cluster's holdings as a percent of supply, or null when unmeasurable. */
  percent: number | null;
}

/**
 * What RugCheck says about a Solana mint, from the one report fetch the scan
 * already makes. GoPlus returns an empty `creators` array for every mint tested
 * (LINKR, BONK, WIF, JUP, USDC) and no LP holder rows at all, so this is the
 * only keyless source that names a creator, reports the creator's own balance,
 * or answers the LP-lock question on this chain.
 *
 * Every field here is RugCheck's own reading rather than something ARGUS
 * reproduced on-chain. `creator` in particular is an attribution, not proof of
 * who signed the mint: on a token that never came off a launchpad it is
 * frequently a mint or update authority, which for a bridged or DAO token is a
 * program rather than a person. Callers must name the source on every claim.
 */
export interface RugcheckReport {
  creator: string | null;
  /** Creator holdings as a percent of supply, or null when either side is missing. */
  creatorPercent: number | null;
  /**
   * Share of the LP RugCheck reports as locked, or null when it did not measure
   * one. A flat zero from this provider is NOT a measured "nothing is locked":
   * it is the same value the field carries when RugCheck holds no market record
   * for the mint at all. See lockedShare below for how the two are told apart.
   */
  lpLockedPct: number | null;
  /**
   * RugCheck's rugged verdict. A false here only withholds the finding: it is
   * RugCheck staying silent, and is never published as "this token is clean".
   */
  rugged: boolean;
  /**
   * RugCheck's own labelled accounts, keyed by address. Only the structured
   * `type` may be trusted downstream; `name` is attacker-influenced display text.
   */
  knownAccounts: Record<string, { name?: string; type?: string }>;
  /** Connected clusters. They OVERLAP, so callers take the largest, never a sum. */
  insiderNetworks: RugcheckInsiderNetwork[];
  /** Wallets RugCheck's transfer graph linked, or null when it reported none. */
  graphInsidersDetected: number | null;
}

/**
 * A holding as a share of supply, gated to a ratio that can actually exist.
 * A holding cannot exceed the supply it is measured against, so an
 * out-of-range ratio is a bad payload: reporting it would publish a fabricated
 * number, and null says "not measured" instead.
 */
export function supplySharePercent(amount: unknown, supply: unknown): number | null {
  const balance = Number(amount);
  const total = Number(supply);
  if (!Number.isFinite(balance) || balance < 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const percent = (balance / total) * 100;
  return percent >= 0 && percent <= 100 ? percent : null;
}

/**
 * Creator holdings as a share of supply. api/holders.ts derives the same ratio
 * for the Solana cluster panel, so it lives in one place: the report and the
 * panel can never disagree about how much of the supply the creator kept.
 */
export function creatorSupplyPercent(creatorBalance: unknown, supply: unknown): number | null {
  return supplySharePercent(creatorBalance, supply);
}

/**
 * RugCheck's locked share of the LP, and whether it counts as measured.
 *
 * A zero in this field is ambiguous in exactly the way ARGUS must never publish
 * over: RugCheck reports 0 both for a pool it examined and found unlocked, and
 * for a mint it holds no market record for at all. Reporting the second as the
 * first is how "USDC's liquidity does not appear locked" got published, one
 * provider over.
 *
 * So a zero is only a measurement when RugCheck also shows it looked: at least
 * one market record on the same report. A positive percentage needs no such
 * corroboration, because the number is itself evidence a lock was read. Anything
 * unevidenced, absent, or out of range comes back null, which downstream reads
 * as "not measured" and scores neither way.
 */
export function lockedShare(lpLockedPct: unknown, markets: unknown): number | null {
  const percent = boundedPercent(lpLockedPct);
  if (percent == null) return null;
  if (percent > 0) return percent;
  const marketsSeen = Array.isArray(markets) ? markets.length : 0;
  return marketsSeen > 0 ? percent : null;
}

/**
 * A percentage a provider already expressed as 0 to 100.
 *
 * The same range gate creatorSupplyPercent applies to a derived ratio: outside
 * that range the payload is bad, and an absent field is unmeasured rather than
 * a measured zero, so both come back null.
 */
function boundedPercent(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return percent >= 0 && percent <= 100 ? percent : null;
}

function finiteCount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

/** RugCheck's labelled accounts, kept only where the record is shaped as expected. */
function parseKnownAccounts(value: unknown): Record<string, { name?: string; type?: string }> {
  const accounts: Record<string, { name?: string; type?: string }> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return accounts;
  for (const [address, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!address.trim() || !entry || typeof entry !== "object") continue;
    const record = entry as { name?: unknown; type?: unknown };
    accounts[address] = {
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(typeof record.type === "string" ? { type: record.type } : {}),
    };
  }
  return accounts;
}

/**
 * The biggest single connected cluster, as a percent of supply.
 *
 * Networks OVERLAP: one wallet can sit in several, so adding them up invents
 * supply that does not exist. api/holders.ts reads the same payload the same
 * way, so the report and the cluster panel can never disagree about how much
 * sits in one hidden hand. Null when no cluster carried a measurable share,
 * which is unmeasured and not zero.
 */
export function largestInsiderClusterPercent(networks: readonly RugcheckInsiderNetwork[]): number | null {
  const measured = networks
    .map((network) => network.percent)
    .filter((percent): percent is number => percent != null);
  return measured.length ? Math.max(...measured) : null;
}

export async function rugcheckReport(mint: string, fetchImpl: typeof fetch = fetch): Promise<RugcheckReport | null> {
  try {
    const res = await fetchImpl(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, {
      signal: AbortSignal.timeout(12_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      creator?: unknown;
      creatorBalance?: unknown;
      token?: { supply?: unknown };
      lpLockedPct?: unknown;
      // Read only to tell a measured zero from an unexamined one. Nothing is
      // published from the market records themselves.
      markets?: unknown;
      rugged?: unknown;
      knownAccounts?: unknown;
      insiderNetworks?: unknown;
      graphInsidersDetected?: unknown;
    };
    const creator = typeof d?.creator === "string" && SOLANA_ADDRESS.test(d.creator.trim()) ? d.creator.trim() : null;
    const supply = d?.token?.supply;
    const networks = Array.isArray(d?.insiderNetworks) ? d.insiderNetworks : [];
    return {
      creator,
      // With no creator there is nobody for a balance to belong to, and a bare
      // zero would read as "the creator sold out" rather than "not measured".
      creatorPercent: creator ? supplySharePercent(d?.creatorBalance, supply) : null,
      lpLockedPct: lockedShare(d?.lpLockedPct, d?.markets),
      rugged: d?.rugged === true,
      knownAccounts: parseKnownAccounts(d?.knownAccounts),
      insiderNetworks: networks.map((network: { size?: unknown; activeAccounts?: unknown; tokenAmount?: unknown }) => ({
        // Null, not zero. A cluster whose wallet count RugCheck did not report
        // is not a cluster of nobody, and "0 linked wallets" is the reading that
        // would talk a reader out of looking.
        size: finiteCount(network?.size ?? network?.activeAccounts),
        percent: supplySharePercent(network?.tokenAmount, supply),
      })),
      graphInsidersDetected: finiteCount(d?.graphInsidersDetected),
    };
  } catch {
    return null;
  }
}

export async function goplus(chainId: string, address: string): Promise<GoPlusSecurity | null> {
  const once = async (): Promise<GoPlusSecurity | null> => {
    try {
      const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      if (!res.ok) return null;
      const d = (await res.json()) as { result?: Record<string, GoPlusSecurity> };
      return d.result?.[address.toLowerCase()] ?? (d.result ? Object.values(d.result)[0] : undefined) ?? null;
    } catch {
      return null;
    }
  };
  let row = await once();
  // GoPlus free tier sometimes omits the holders array on the first call; retry once.
  if (row && !(row.holders && row.holders.length)) {
    await new Promise((r) => setTimeout(r, 700));
    const retry = await once();
    if (retry?.holders?.length) row = retry;
  }
  return row;
}
