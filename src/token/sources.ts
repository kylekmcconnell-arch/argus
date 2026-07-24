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
};

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

// CoinGecko's description.en is the project's own blurb — the "what it actually
// does" a report should lead with. Strip HTML + markdown links to plain text and
// keep the first couple of sentences.
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
  // First 1–2 sentences, capped, without cutting mid-word.
  const sentences = s.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length) s = sentences.slice(0, 2).join(" ").trim();
  if (s.length > 300) s = s.slice(0, 297).replace(/\s+\S*$/, "") + "…";
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
