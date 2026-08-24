// PRIOR LAUNCHES: what happened to the operator's earlier tokens?
//
// A launchpad token's real risk is rarely in its own contract, which is
// usually renounced and LP-locked. It is in the operator's history: how many
// tokens they have shipped, and what those tokens are worth now. A dev on
// their fourth launch whose first three trade near zero is a different
// proposition from a first-time builder, and that difference is public,
// free and deterministic.
//
// Two independent resolution paths, because serial launchers split wallets:
//   1. same creator wallet   - pump.fun's own creator index (catches reuse)
//   2. operator's own bio    - the OTHER @projects they claim, each matched to
//                              a token by that exact X handle in the token's
//                              own social metadata (never by name similarity)
// Both are keyless; neither infers a link the sources do not state.
import { recordCall } from "../cost";
import { env } from "../config";
import { searchFrom } from "./x";

const PUMPFUN_API = "https://frontend-api-v3.pump.fun";
const DEXSCREENER_API = "https://api.dexscreener.com";
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2";
const REQUEST_TIMEOUT_MS = 12_000;

export interface PriorLaunch {
  symbol: string;
  name?: string;
  mint: string;
  chain: string;
  /** Current fully diluted value, the honest "what is it worth now" number. */
  fdvUsd: number | null;
  liquidityUsd: number | null;
  /** X handle carried in the token's own social metadata, when present. */
  xHandle?: string;
  createdAt?: string;
  /**
   * When the launchpad itself minted this token. Separate from createdAt,
   * which follows whichever source resolved the launch: this one only ever
   * comes from the launchpad's own coin record, so the gap between two
   * launches is measured on one clock.
   */
  mintedAt?: string;
  /**
   * The highest value this token is known to have reached. Only set when the
   * peak survived resolveLaunchPeak; an unverifiable peak stays undefined
   * rather than becoming a number the report would have to defend.
   */
  athUsd?: number;
  /** When that peak printed, and only when the accepted peak carried a date. */
  athAt?: string;
  /**
   * The operator's own post claiming this launch: the receipt a reader can
   * open. Present only for launches the announcement path found.
   */
  permalink?: string;
  url: string;
  /** How this launch was tied to the operator; never an inference. */
  link: "same_creator_wallet" | "operator_bio_project" | "operator_announcement";
  /** The operator's own words, when the link came from a launch announcement. */
  announcement?: { text: string; at?: string; url?: string };
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "argus-diligence" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// ── What a launch was worth at its peak ────────────────────────────────────
//
// "uAPE now $7.1K" is only half the story. The half that matters is what it
// was worth on launch day, and pump.fun publishes exactly that in
// ath_market_cap. It just cannot be trusted on its own.
//
// Sampling the pump.fun top-50 by market cap on 2026-08-01, 9 of the 50 rows
// came back with a corrupt peak: Fartcoin 4.28e11 against a $126M cap,
// jellyjelly 4.13e22, arc 1.99e23, AVA 4.54e20, ZEREBRO 2.20e20, ACT 1.51e21,
// Ban 1.48e21, Bert 7.88e20, pippin 9.02e18. Every one of them is a legacy
// coin, and every one of them would have printed a fabricated "down 99.99%
// from its peak" in a report. So a peak is published only when it clears two
// gates: it is not below what the token is worth today, and it is not larger
// than any launchpad token has ever been.
//
// The primary source is the one ARGUS already trusts elsewhere: a keyless
// GeckoTerminal OHLCV series, which is an observed record of trades rather
// than a stored field. The peak has to be read out of the HIGH column and not
// the close, because a token that runs and dumps inside one day is the exact
// shape this whole feature exists to show and a daily-CLOSE series records
// that day as flat. RACC (Crgxrddc8wLmDzD1nBVxGGbMFhtY4vxddJsQ9t8npump)
// traded to a $1.66M cap on 2026-07-28 and closed the same day back at $2.5K:
// off the closes its peak is 1.05x today's value and the entire run vanishes;
// off the highs it is $1.66M and matches pump.fun to within 0.4%.

/**
 * No launchpad token has ever been worth this much. Above it the field is
 * corrupt, not remarkable.
 */
const MAX_PLAUSIBLE_ATH_USD = 1e10;

/**
 * How far pump.fun's peak may exceed the observed one before the two sources
 * are telling different stories and the trades win.
 *
 * Both fields sample intraday, so once the series peak is a HIGH they should
 * nearly agree, and on live data they do. Measured 2026-08-01 as
 * ath_market_cap over the GeckoTerminal daily-high peak: TROLL 1.00x, RACC
 * 1.00x, ANSEM 1.01x, Doggocoin 1.01x, Spain 1.01x, uAPE 1.02x, LINKR 1.03x,
 * Buttcoin 1.27x. Against daily CLOSES the same coins scatter from 1.07x to
 * 664x, which is why the old 3x band could pass junk and still throw away the
 * real peak of every single-day runner.
 */
const ATH_CORROBORATION_FACTOR = 1.5;

const plausiblePeak = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_ATH_USD
    ? value
    : null;

/**
 * The peak we are willing to publish, from an observed price series and the
 * launchpad's own claim. Returns undefined whenever the two cannot support a
 * number, which is the correct answer far more often than a guess is.
 */
export function resolveLaunchPeak(input: {
  currentUsd: number | null;
  /** Peak value implied by a GeckoTerminal OHLCV series. */
  seriesPeakUsd?: number | null;
  /** pump.fun's ath_market_cap, raw and ungated. */
  launchpadAthUsd?: number | null;
  launchpadAthAt?: string;
}): { athUsd: number; athAt?: string } | undefined {
  // The floor takes the current value RAW. Running it through the ceiling
  // would let a token worth more than the ceiling read as worth nothing, and
  // then any peak at all would clear the floor.
  const current = typeof input.currentUsd === "number" && input.currentUsd > 0 && Number.isFinite(input.currentUsd)
    ? input.currentUsd
    : 0;
  const series = plausiblePeak(input.seriesPeakUsd);
  const claimed = plausiblePeak(input.launchpadAthUsd);
  let athUsd: number | null = null;
  let athAt: string | undefined;
  if (series !== null && claimed !== null) {
    // The launchpad's finer-grained peak is accepted only when the observed
    // series puts the token in that band. Otherwise the trades win.
    if (claimed >= series && claimed <= series * ATH_CORROBORATION_FACTOR) {
      athUsd = claimed;
      athAt = input.launchpadAthAt;
    } else {
      athUsd = series;
    }
  } else if (series !== null) {
    athUsd = series;
  } else if (claimed !== null) {
    athUsd = claimed;
    athAt = input.launchpadAthAt;
  }
  if (athUsd === null) return undefined;
  // A "peak" at or below today's value is not a peak, it is today.
  if (!(athUsd > current)) return undefined;
  return { athUsd, ...(athAt ? { athAt } : {}) };
}

/**
 * dexscreener chainId -> GeckoTerminal network slug. src/lib/priceHistory.ts
 * carries the same mapping for the close series it returns; the peak is read
 * from the raw candles here because that module only ever exposes closes.
 */
const GECKOTERMINAL_NETWORK: Record<string, string> = {
  solana: "solana", ethereum: "eth", eth: "eth", bsc: "bsc", base: "base",
  arbitrum: "arbitrum", polygon: "polygon_pos", polygon_pos: "polygon_pos",
  avalanche: "avax", avax: "avax", optimism: "optimism", fantom: "ftm",
  sui: "sui", ton: "ton", tron: "tron", blast: "blast", sei: "sei-evm",
};

/** The traded record behind one launch, in the series' own price units. */
export interface LaunchSeries {
  /** Highest INTRADAY high in the window, never a close. */
  peak: number;
  /** Most recent close. */
  last: number;
  timeframe: "day" | "hour";
}

/** GeckoTerminal's own candles for a launch: keyless, and observed trades. */
export async function fetchLaunchSeries(mint: string, chain: string): Promise<LaunchSeries | null> {
  const network = GECKOTERMINAL_NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !mint) return null;
  const pools = asRecord(await getJson(
    `${GECKOTERMINAL_API}/networks/${network}/tokens/${encodeURIComponent(mint)}/pools?page=1`,
  ));
  const rows = Array.isArray(pools?.data) ? pools!.data as unknown[] : [];
  const top = asRecord(rows[0]);
  const address = asRecord(top?.attributes)?.address;
  const id = top?.id;
  const pool = typeof address === "string" && address
    ? address
    : typeof id === "string" && id
      ? id.replace(`${network}_`, "")
      : "";
  if (!pool) return null;
  // Daily candles first; a token too young to have three of them still has
  // hourly ones, and a launch-day runner is exactly that token.
  for (const timeframe of ["day", "hour"] as const) {
    const data = asRecord(await getJson(
      `${GECKOTERMINAL_API}/networks/${network}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?aggregate=1&limit=200&currency=usd`,
    ));
    const raw = asRecord(asRecord(data?.data)?.attributes)?.ohlcv_list;
    // Each row is [timestamp, open, HIGH, low, close, volume].
    const candles = (Array.isArray(raw) ? raw : []).filter((row): row is number[] =>
      Array.isArray(row)
      && row.length >= 5
      && row.every((value) => typeof value === "number" && Number.isFinite(value)));
    if (candles.length < 3) continue;
    const chronological = [...candles].sort((left, right) => left[0] - right[0]);
    const closes = chronological.map((row) => row[4]).filter((value) => value > 0);
    const highs = chronological.map((row) => row[2]).filter((value) => value > 0);
    if (closes.length < 3 || !highs.length) continue;
    return { peak: Math.max(...highs), last: closes[closes.length - 1], timeframe };
  }
  return null;
}

/**
 * A price series says how far the token is off its high; today's value turns
 * that ratio back into dollars. Using the ratio rather than the raw price
 * keeps the answer correct whatever the token's supply is.
 */
export function seriesPeakUsd(series: LaunchSeries | null, currentUsd: number | null): number | null {
  if (!series || !currentUsd || !(currentUsd > 0)) return null;
  if (!(series.peak > 0) || !(series.last > 0)) return null;
  return currentUsd * (series.peak / series.last);
}

/** Normalized X handle from any x.com/twitter.com URL or bare @handle. */
export function normalizeXHandle(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(/(?:x\.com|twitter\.com)\/(?!i\/|search|home)([A-Za-z0-9_]{1,30})/i);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? handle.toLowerCase() : null;
}

/**
 * pump.fun's own peak claim for a coin row, read verbatim and NOT gated here.
 * Both the coin endpoint and the creator index carry these fields; gating
 * happens once, in resolveLaunchPeak, so there is a single place where a
 * number becomes publishable.
 */
export function launchpadPeakClaim(coin: Record<string, unknown>): { athUsd?: number; athAt?: string } {
  const ath = num(coin.ath_market_cap);
  const at = num(coin.ath_market_cap_timestamp);
  return {
    ...(ath !== null ? { athUsd: ath } : {}),
    ...(at ? { athAt: new Date(at).toISOString() } : {}),
  };
}

export interface PumpfunCoin {
  creator: string;
  symbol: string;
  name?: string;
  xHandle?: string;
  /** created_timestamp: when the launchpad minted the coin. */
  createdAt?: string;
  /** usd_market_cap: what the coin is worth right now. */
  fdvUsd: number | null;
  /** ath_market_cap, ungated. Never publish this without resolveLaunchPeak. */
  athUsd?: number;
  athAt?: string;
}

/** The pump.fun record for a mint: creator wallet, declared socials, peak. */
export async function pumpfunCoin(mint: string): Promise<PumpfunCoin | null> {
  const data = asRecord(await getJson(`${PUMPFUN_API}/coins/${encodeURIComponent(mint)}`));
  recordCall("pumpfun", "coin", 0, mint.slice(0, 8), data ? "succeeded" : "failed");
  if (!data || typeof data.creator !== "string" || !data.creator) return null;
  const handle = typeof data.twitter === "string" ? normalizeXHandle(data.twitter) : null;
  const created = num(data.created_timestamp);
  return {
    creator: data.creator,
    symbol: typeof data.symbol === "string" ? data.symbol : "",
    ...(typeof data.name === "string" ? { name: data.name } : {}),
    ...(handle ? { xHandle: handle } : {}),
    ...(created ? { createdAt: new Date(created).toISOString() } : {}),
    fdvUsd: num(data.usd_market_cap),
    ...launchpadPeakClaim(data),
  };
}

/**
 * Other tokens launched by the SAME creator wallet, excluding this one.
 * A dev who reuses their wallet is the common case; one who does not simply
 * returns nothing here, and the bio path below still applies.
 */
export async function launchesBySameCreator(mint: string, creator: string): Promise<PriorLaunch[]> {
  const data = await getJson(`${PUMPFUN_API}/coins?creator=${encodeURIComponent(creator)}&offset=0&limit=50`);
  recordCall("pumpfun", "creator-coins", 0, creator.slice(0, 8), Array.isArray(data) ? "succeeded" : "failed");
  if (!Array.isArray(data)) return [];
  const out: PriorLaunch[] = [];
  for (const row of data) {
    const coin = asRecord(row);
    const coinMint = coin && typeof coin.mint === "string" ? coin.mint : "";
    if (!coin || !coinMint || coinMint === mint) continue;
    const created = num(coin.created_timestamp);
    const handle = typeof coin.twitter === "string" ? normalizeXHandle(coin.twitter) : null;
    out.push({
      symbol: typeof coin.symbol === "string" ? coin.symbol : "",
      ...(typeof coin.name === "string" ? { name: coin.name } : {}),
      mint: coinMint,
      chain: "solana",
      fdvUsd: num(coin.usd_market_cap),
      liquidityUsd: null,
      ...(handle ? { xHandle: handle } : {}),
      ...(created ? { createdAt: new Date(created).toISOString(), mintedAt: new Date(created).toISOString() } : {}),
      url: `https://pump.fun/coin/${coinMint}`,
      link: "same_creator_wallet",
    });
  }
  return out.slice(0, 12);
}

/**
 * Resolve an @handle the operator claims in their bio to a traded token, by
 * matching that exact handle inside the TOKEN's own social metadata. A name
 * or symbol resemblance is never enough: the token must name the handle.
 */
// A project's X handle rarely equals its ticker ("@uapenfts" trades as uAPE,
// "@linkrbot" as LINKR), and the token search matches names and symbols, not
// socials. Search the handle AND its stem, then accept a hit only when the
// token's own metadata names the exact handle.
const HANDLE_SUFFIXES = /(?:nfts?|bot|sol|coin|token|official|hq|labs?|app|fi|dao|xyz|io|ai|eth|network|protocol|finance|cash|erc|meme)$/i;

export function handleSearchTerms(handle: string): string[] {
  const terms = new Set<string>();
  const base = handle.replace(/^@/, "");
  if (base) terms.add(base);
  // "pmpr_bot" stems to "pmpr", not "pmpr_": a trailing separator is left over
  // from the suffix and matches nothing.
  const stem = base.replace(HANDLE_SUFFIXES, "").replace(/[_\-.]+$/, "");
  if (stem.length >= 3 && stem !== base) terms.add(stem);
  const undigited = base.replace(/[0-9_]+$/g, "");
  if (undigited.length >= 3 && undigited !== base) terms.add(undigited);
  return [...terms].slice(0, 3);
}

export async function launchForOperatorHandle(handle: string): Promise<PriorLaunch | null> {
  const wanted = normalizeXHandle(handle);
  if (!wanted) return null;
  const pairs: unknown[] = [];
  for (const term of handleSearchTerms(wanted)) {
    const data = asRecord(await getJson(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(term)}`));
    recordCall("dexscreener", "search", 0, term, data ? "succeeded" : "failed");
    const found = Array.isArray(data?.pairs) ? data!.pairs as unknown[] : [];
    pairs.push(...found);
    // Stop as soon as some pair actually claims this handle; later terms are
    // broader and only add noise.
    if (found.some((row) => {
      const info = asRecord(asRecord(row)?.info);
      const socials = Array.isArray(info?.socials) ? info!.socials as unknown[] : [];
      return socials.some((entry) => {
        const social = asRecord(entry);
        return social && typeof social.url === "string" && normalizeXHandle(social.url) === wanted;
      });
    })) break;
  }
  let best: PriorLaunch | null = null;
  for (const row of pairs) {
    const pair = asRecord(row);
    if (!pair) continue;
    const info = asRecord(pair.info);
    const socials = Array.isArray(info?.socials) ? info!.socials as unknown[] : [];
    const claimsHandle = socials.some((entry) => {
      const social = asRecord(entry);
      return social && typeof social.url === "string" && normalizeXHandle(social.url) === wanted;
    });
    if (!claimsHandle) continue;
    const base = asRecord(pair.baseToken);
    const mint = base && typeof base.address === "string" ? base.address : "";
    if (!mint) continue;
    const liquidity = num(asRecord(pair.liquidity)?.usd);
    const candidate: PriorLaunch = {
      symbol: base && typeof base.symbol === "string" ? base.symbol : "",
      ...(base && typeof base.name === "string" ? { name: base.name } : {}),
      mint,
      chain: typeof pair.chainId === "string" ? pair.chainId : "solana",
      fdvUsd: num(pair.fdv),
      liquidityUsd: liquidity,
      xHandle: wanted,
      url: typeof pair.url === "string" ? pair.url : `https://dexscreener.com/${pair.chainId}/${mint}`,
      link: "operator_bio_project",
    };
    // Deepest pool wins: the same token lists once per pair.
    if (!best || (candidate.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0)) best = candidate;
  }
  return best;
}


// ── The operator's own launch announcements ────────────────────────────────
//
// A serial launcher who splits deployer wallets still announces each launch
// from one X account ("uAPE is now live", "I am live on Pump with my project
// $trippin"). Those posts are first-party claims of authorship, and they
// reach launches no wallet index and no bio ever will.
//
// The discipline that keeps this from over-claiming: an address only counts
// when the SAME post claims the launch. The operator asking their own bot
// "what can you tell me about this coin: <CA>" mentions a contract without
// claiming it, and must never become a launch.
const LAUNCH_CLAIM = /\b(?:is\s+(?:now\s+)?live|now\s+live|going\s+live|just\s+(?:launched|shipped|deployed)|i\s+(?:just\s+)?launched|we\s+(?:just\s+)?launched|i\s+(?:just\s+)?built|we\s+(?:just\s+)?built|my\s+(?:project|token|coin)|introducing|launching)\b/i;
const SOLANA_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const TICKER_CLAIM = /\$([A-Za-z][A-Za-z0-9]{1,9})\b/g;
const HANDLE_CLAIM = /@([A-Za-z0-9_]{2,30})\b/g;
// "uAPE is now live", "Splitr is now live": the project named as a bare word.
// Only a single word directly before the claim counts, and only when it is not
// ordinary sentence filler, so "everything is now live" names no project.
const BARE_NAME_CLAIM = /(?:^|[.!?\n]\s*)([A-Za-z][A-Za-z0-9]{2,20})\s+is\s+(?:now\s+)?live\b/g;
const NOT_A_PROJECT = new Set([
  "it", "this", "that", "everything", "all", "support", "feature", "features",
  "trading", "the", "she", "they", "site", "app", "bot", "beta", "everyone",
  "which", "and", "but", "now", "today", "tomorrow", "chat", "api", "docs",
]);
const LAUNCH_SEARCH_TERMS = ['"is now live"', '"now live"', '"just launched"', '"my project"', "launching", "introducing"];

export interface LaunchAnnouncement {
  text: string;
  at?: string;
  /**
   * Permalink to the post itself. ARGUS reports a dead prior launch as the
   * operator's own dated claim, so the claim has to be openable: without this
   * the reader has a quote and no way to check it.
   */
  url?: string;
  mints: string[];
  tickers: string[];
  /** @handles the post claims authorship of ("Why I built @theodevxyz"). */
  handles: string[];
  /** Bare project names ("uAPE is now live"). */
  names: string[];
}

/** The canonical x.com permalink for a tweet record, when it carries one. */
function postPermalink(post: Record<string, unknown> | null): string | null {
  for (const key of ["url", "twitterUrl"]) {
    const value = post?.[key];
    if (typeof value === "string" && /^https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/\d+/.test(value)) return value;
  }
  const id = post?.id;
  const author = asRecord(post?.author)?.userName;
  return typeof id === "string" && id && typeof author === "string" && author
    ? `https://x.com/${author}/status/${id}`
    : null;
}

/** Posts where the operator claims a launch, with the assets they name. */
export async function operatorLaunchAnnouncements(handle: string): Promise<LaunchAnnouncement[]> {
  const key = env("TWITTERAPI_KEY");
  const clean = handle.replace(/^@/, "");
  if (!key || !clean) return [];
  let posts: unknown[];
  try {
    posts = await searchFrom(clean, LAUNCH_SEARCH_TERMS, key);
  } catch {
    return [];
  }
  const out: LaunchAnnouncement[] = [];
  for (const row of posts.slice(0, 60)) {
    const post = asRecord(row);
    const text = post && typeof post.text === "string" ? post.text : "";
    if (!text || !LAUNCH_CLAIM.test(text)) continue;
    const mints = [...new Set(text.match(SOLANA_ADDRESS) ?? [])];
    const tickers = [...new Set([...text.matchAll(TICKER_CLAIM)].map((match) => match[1].toUpperCase()))];
    // "Why I built @theodevxyz": a project named by handle inside a claim of
    // authorship. Self-mentions are dropped by the caller.
    const handles = [...new Set([...text.matchAll(HANDLE_CLAIM)].map((match) => match[1].toLowerCase()))];
    const names = [...new Set([...text.matchAll(BARE_NAME_CLAIM)]
      .map((match) => match[1])
      .filter((name) => !NOT_A_PROJECT.has(name.toLowerCase())))];
    if (!mints.length && !tickers.length && !handles.length && !names.length) continue;
    const at = post && typeof post.createdAt === "string" ? post.createdAt : undefined;
    // twitterapi returns both `url` (x.com) and `twitterUrl` (twitter.com) on
    // every tweet; either is a permalink, and x.com is the canonical one.
    const permalink = postPermalink(post);
    out.push({
      text: text.replace(/\s+/g, " ").slice(0, 200),
      ...(at ? { at } : {}),
      ...(permalink ? { url: permalink } : {}),
      mints,
      tickers,
      handles,
      names,
    });
  }
  return out.slice(0, 25);
}

/** Current market state for a mint the operator claimed, via dexscreener. */
export async function launchForMint(mint: string): Promise<Omit<PriorLaunch, "link"> | null> {
  const data = asRecord(await getJson(`${DEXSCREENER_API}/latest/dex/tokens/${encodeURIComponent(mint)}`));
  recordCall("dexscreener", "token", 0, mint.slice(0, 8), data ? "succeeded" : "failed");
  const pairs = Array.isArray(data?.pairs) ? data!.pairs as unknown[] : [];
  let best: Omit<PriorLaunch, "link"> | null = null;
  for (const row of pairs) {
    const pair = asRecord(row);
    const base = asRecord(pair?.baseToken);
    if (!pair || !base || typeof base.address !== "string") continue;
    const info = asRecord(pair.info);
    const socials = Array.isArray(info?.socials) ? info!.socials as unknown[] : [];
    const xHandle = socials.map((entry) => {
      const social = asRecord(entry);
      return social && typeof social.url === "string" ? normalizeXHandle(social.url) : null;
    }).find((entry): entry is string => Boolean(entry));
    const liquidity = num(asRecord(pair.liquidity)?.usd);
    const candidate: Omit<PriorLaunch, "link"> = {
      symbol: typeof base.symbol === "string" ? base.symbol : "",
      ...(typeof base.name === "string" ? { name: base.name } : {}),
      mint: base.address,
      chain: typeof pair.chainId === "string" ? pair.chainId : "solana",
      fdvUsd: num(pair.fdv),
      liquidityUsd: liquidity,
      ...(xHandle ? { xHandle } : {}),
      url: typeof pair.url === "string" ? pair.url : `https://dexscreener.com/solana/${base.address}`,
    };
    if (!best || (candidate.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0)) best = candidate;
  }
  return best;
}


/**
 * A ticker the operator claimed, resolved only when a token of that exact
 * symbol was POOLED within 30 days of the claim. Tickers are recycled
 * constantly: $trippin was claimed in February and the tradeable TRIPPIN
 * pool was created five months later by someone else, so symbol alone can
 * never stand in for authorship.
 */
export async function launchForClaimedTicker(ticker: string, announcedAt?: string): Promise<Omit<PriorLaunch, "link"> | null> {
  const claimedAt = announcedAt ? Date.parse(announcedAt) : NaN;
  if (!Number.isFinite(claimedAt)) return null;
  const data = asRecord(await getJson(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(ticker)}`));
  recordCall("dexscreener", "search", 0, ticker, data ? "succeeded" : "failed");
  const pairs = Array.isArray(data?.pairs) ? data!.pairs as unknown[] : [];
  const WINDOW_MS = 30 * 24 * 3600 * 1000;
  let best: Omit<PriorLaunch, "link"> | null = null;
  for (const row of pairs) {
    const pair = asRecord(row);
    const base = asRecord(pair?.baseToken);
    if (!pair || !base || typeof base.address !== "string") continue;
    if (String(base.symbol ?? "").toUpperCase() !== ticker.toUpperCase()) continue;
    const created = num(pair.pairCreatedAt);
    if (created === null || Math.abs(created - claimedAt) > WINDOW_MS) continue;
    const liquidity = num(asRecord(pair.liquidity)?.usd);
    const candidate: Omit<PriorLaunch, "link"> = {
      symbol: String(base.symbol ?? ""),
      ...(typeof base.name === "string" ? { name: base.name } : {}),
      mint: base.address,
      chain: typeof pair.chainId === "string" ? pair.chainId : "solana",
      fdvUsd: num(pair.fdv),
      liquidityUsd: liquidity,
      url: typeof pair.url === "string" ? pair.url : `https://dexscreener.com/solana/${base.address}`,
    };
    if (!best || (candidate.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0)) best = candidate;
  }
  return best;
}

/**
 * How many prior launches get the peak treatment. Both hops are keyless and
 * free, but they are still network round trips against a rate-limited public
 * API, and a track record is made by its most recent entries.
 */
const PEAK_ENRICH_LIMIT = 6;

/**
 * Fill in mintedAt and a defensible peak for each launch, from the launchpad
 * record and an observed price series. Never throws and never downgrades a
 * launch: a launch whose peak cannot be established comes back unchanged.
 */
export async function enrichLaunchPeaks(launches: PriorLaunch[]): Promise<PriorLaunch[]> {
  const enriched = await Promise.all(launches.slice(0, PEAK_ENRICH_LIMIT).map(async (launch) => {
    const coin = launch.chain === "solana" ? await pumpfunCoin(launch.mint).catch(() => null) : null;
    const series = await fetchLaunchSeries(launch.mint, launch.chain).catch(() => null);
    recordCall(
      "geckoterminal",
      "prior-launch-ohlcv",
      0,
      `keyless · ${launch.symbol || launch.mint.slice(0, 8)}`,
      series ? "succeeded" : "failed",
    );
    // Today's value: dexscreener's fdv when we have it, otherwise the
    // launchpad's. Both are current-value fields, never a peak.
    const currentUsd = launch.fdvUsd ?? coin?.fdvUsd ?? null;
    const peak = resolveLaunchPeak({
      currentUsd,
      seriesPeakUsd: seriesPeakUsd(series, currentUsd),
      launchpadAthUsd: coin?.athUsd ?? null,
      ...(coin?.athAt ? { launchpadAthAt: coin.athAt } : {}),
    });
    return {
      ...launch,
      ...(launch.mintedAt ? {} : coin?.createdAt ? { mintedAt: coin.createdAt } : {}),
      ...(peak ?? {}),
    };
  }));
  return [...enriched, ...launches.slice(PEAK_ENRICH_LIMIT)];
}

export interface OperatorLaunchHistory {
  creatorWallet?: string;
  /** Newest first on the launchpad clock; undated launches trail the dated ones. */
  launches: PriorLaunch[];
  /** When the launchpad minted the token under audit, on the same clock as PriorLaunch.mintedAt. */
  subjectMintedAt?: string;
  /** The audited token's own ticker, so the panel can mark it inside the launch order. */
  subjectSymbol?: string;
  /** This launch plus every other one we could tie to the operator. */
  totalLaunches: number;
  /**
   * Which of the operator's launches the audited one is, 1-based and counted
   * from their first. See subjectLaunchOrdinal: absent whenever the order is
   * not established, and then only the count may be published.
   */
  subjectLaunchNumber?: number;
  /**
   * Projects the operator publicly claims to have launched but whose token no
   * longer resolves to a live pool. A dead launch leaves no market data, and
   * silence about it would flatter the operator's record: the claim and its
   * date are the evidence.
   */
  claimedProjects: Array<{ label: string; at?: string; quote: string; url?: string }>;
}

/**
 * Newest launch first, on the launchpad's own clock.
 *
 * pump.fun's creator index is not ordered and carries no date filter, so a
 * sibling the operator minted AFTER the audited token arrives mixed in with
 * the earlier ones. Sorting is what lets the report place the audited token in
 * the operator's launch order instead of assuming it sits at the end.
 */
function byMintDateDesc(launches: PriorLaunch[]): PriorLaunch[] {
  return [...launches].sort((left, right) => {
    const leftAt = left.mintedAt ? Date.parse(left.mintedAt) : NaN;
    const rightAt = right.mintedAt ? Date.parse(right.mintedAt) : NaN;
    if (!Number.isFinite(leftAt) && !Number.isFinite(rightAt)) return 0;
    // A launch with no launchpad date cannot be placed, so it trails the dated
    // ones rather than taking a position the evidence does not support.
    if (!Number.isFinite(leftAt)) return 1;
    if (!Number.isFinite(rightAt)) return -1;
    return rightAt - leftAt;
  });
}

/**
 * Which launch of the operator's the audited token is, 1-based.
 *
 * An ordinal is an assertion about ORDER, so it is only made when the order is
 * established: the audited token needs a launchpad mint date and so does every
 * launch tied to it. One undated launch could sit on either side of the
 * subject, and "launch 3 of 5" would then be a guess dressed as a count.
 */
export function subjectLaunchOrdinal(launches: PriorLaunch[], subjectMintedAt?: string): number | undefined {
  const subject = subjectMintedAt ? Date.parse(subjectMintedAt) : NaN;
  if (!Number.isFinite(subject)) return undefined;
  let earlier = 0;
  for (const launch of launches) {
    const minted = launch.mintedAt ? Date.parse(launch.mintedAt) : NaN;
    if (!Number.isFinite(minted)) return undefined;
    if (minted < subject) earlier += 1;
  }
  return earlier + 1;
}

/**
 * Full prior-launch picture for a launchpad token: same-wallet history plus
 * the operator's own claimed projects. Deduped by mint; never throws.
 *
 * `subject` is who we are auditing, told to this collector rather than
 * discovered by it. It matters when pump.fun has no record of the mint, which
 * is every verified solana token that did not launch on pump.fun: without it
 * the collector knows no symbol and no handle for the subject, and the
 * operator's own launch post about THIS project ("$DRIFT is now live") comes
 * back as an earlier project of theirs with no live market. The subject is
 * never its own prior launch and never its own dead claim.
 */
export async function collectOperatorLaunches(
  mint: string,
  operatorBioHandles: readonly string[] = [],
  operatorHandle?: string,
  subject: { symbol?: string; handle?: string } = {},
): Promise<OperatorLaunchHistory> {
  const coin = await pumpfunCoin(mint);
  const subjectHandle = coin?.xHandle ?? normalizeXHandle(subject.handle ?? "") ?? undefined;
  const sameCreator = coin ? await launchesBySameCreator(mint, coin.creator) : [];
  // The operator's own launch posts: the only path that reaches a launch made
  // from a different wallet and never mentioned in the bio.
  const announced: PriorLaunch[] = [];
  const subjectSymbol = coin?.symbol || subject.symbol || "";
  let announcements: LaunchAnnouncement[] = [];
  // Every announced launch carries the post that claimed it, so the reader can
  // open the receipt instead of taking the link on trust.
  const withReceipt = (
    resolved: Omit<PriorLaunch, "link">,
    source: LaunchAnnouncement | undefined,
  ): PriorLaunch => ({
    ...resolved,
    link: "operator_announcement",
    ...(source?.url ? { permalink: source.url } : {}),
    ...(source
      ? {
        announcement: {
          text: source.text,
          ...(source.at ? { at: source.at } : {}),
          ...(source.url ? { url: source.url } : {}),
        },
      }
      : {}),
  });
  const selfHandles = new Set([
    operatorHandle ? normalizeXHandle(operatorHandle) : null,
    subjectHandle ?? null,
  ].filter((entry): entry is string => Boolean(entry)));
  if (operatorHandle) {
    announcements = await operatorLaunchAnnouncements(operatorHandle);
    const claimedMints = new Set<string>();
    for (const announcement of announcements) {
      for (const claimed of announcement.mints) {
        if (claimed === mint || claimedMints.has(claimed)) continue;
        claimedMints.add(claimed);
      }
    }
    for (const claimed of [...claimedMints].slice(0, 8)) {
      const resolved = await launchForMint(claimed);
      if (!resolved) continue;
      const source = announcements.find((entry) => entry.mints.includes(claimed));
      announced.push(withReceipt(resolved, source));
    }
    // Handles named inside a launch claim resolve through the same rule the
    // bio path uses: the token's own metadata must name that exact handle.
    const announcedHandles = [...new Set(announcements.flatMap((entry) => entry.handles))]
      .filter((entry) => !selfHandles.has(entry))
      .slice(0, 6);
    const announcedTickers = [...new Set(announcements.flatMap((entry) =>
      entry.tickers.map((ticker) => JSON.stringify([ticker, entry.at ?? ""]))))]
      .map((entry) => JSON.parse(entry) as [string, string])
      .filter(([ticker]) => ticker.toUpperCase() !== subjectSymbol.toUpperCase())
      .slice(0, 5);
    for (const [ticker, at] of announcedTickers) {
      const resolved = await launchForClaimedTicker(ticker, at || undefined);
      if (!resolved || resolved.mint === mint) continue;
      // The receipt has to be the post that MADE the tie. A ticker is resolved
      // against one post's date (the pool has to exist within 30 days of that
      // claim), and an operator mentions their own ticker over and over, so
      // taking the first post that merely says the ticker would quote and link
      // a post that proves nothing about this launch.
      const source = announcements.find((entry) => entry.tickers.includes(ticker) && (entry.at ?? "") === at);
      announced.push(withReceipt(resolved, source));
    }
    for (const claimed of announcedHandles) {
      const resolved = await launchForOperatorHandle(claimed);
      if (!resolved) continue;
      const source = announcements.find((entry) => entry.handles.includes(claimed));
      announced.push(withReceipt(resolved, source));
    }
  }
  const bioHandles = [...new Set(
    operatorBioHandles
      .map((entry) => normalizeXHandle(entry))
      .filter((entry): entry is string => Boolean(entry) && entry !== subjectHandle),
  )].slice(0, 5);
  const fromBio = (await Promise.all(bioHandles.map((entry) => launchForOperatorHandle(entry))))
    .filter((entry): entry is PriorLaunch => Boolean(entry));
  const byMint = new Map<string, PriorLaunch>();
  for (const launch of [...sameCreator, ...fromBio, ...announced]) {
    if (launch.mint === mint || byMint.has(launch.mint)) continue;
    byMint.set(launch.mint, launch);
  }
  const launches = [...byMint.values()];
  // Everything the operator claimed that no live pool backs. Resolved
  // launches are removed so a project is never counted twice.
  const resolvedLabels = new Set(launches.flatMap((launch) => [
    launch.symbol.toUpperCase(),
    ...(launch.xHandle ? [`@${launch.xHandle}`] : []),
  ]));
  const claimedProjects: OperatorLaunchHistory["claimedProjects"] = [];
  const seenClaims = new Set<string>();
  for (const announcement of announcements) {
    const labels = [
      ...announcement.handles.filter((entry) => !selfHandles.has(entry)).map((entry) => `@${entry}`),
      ...announcement.tickers.map((entry) => `$${entry}`),
      // A bare name is evidence of a claim, never a token binding: it is
      // reported with the operator's own sentence and never priced.
      ...announcement.names,
    ];
    for (const label of labels) {
      // "@pmpr_bot" and "$PMPR" are one project claimed two ways. Reduce a
      // handle to its stem before comparing, so the count the panel prints is
      // projects rather than mentions. Stems only ever MERGE claims; a wrong
      // merge undercounts, which is the safe direction for a count ARGUS
      // publishes about a person.
      const bare = label.replace(/^[@$]/, "");
      const key = (label.startsWith("@") ? handleSearchTerms(bare).at(-1) ?? bare : bare).toUpperCase();
      if (seenClaims.has(key) || resolvedLabels.has(key) || resolvedLabels.has(label.toLowerCase())) continue;
      if (subjectSymbol && key === subjectSymbol.toUpperCase()) continue;
      seenClaims.add(key);
      claimedProjects.push({
        label,
        ...(announcement.at ? { at: announcement.at } : {}),
        quote: announcement.text,
        ...(announcement.url ? { url: announcement.url } : {}),
      });
    }
  }
  // Ordered only AFTER enrichment, because that hop is where a launch resolved
  // through dexscreener picks up the launchpad mint date it is sorted on.
  const enriched = byMintDateDesc(await enrichLaunchPeaks(launches));
  const ordinal = subjectLaunchOrdinal(enriched, coin?.createdAt);
  return {
    ...(coin?.creator ? { creatorWallet: coin.creator } : {}),
    launches: enriched,
    ...(coin?.createdAt ? { subjectMintedAt: coin.createdAt } : {}),
    ...(subjectSymbol ? { subjectSymbol } : {}),
    totalLaunches: enriched.length + 1,
    ...(ordinal ? { subjectLaunchNumber: ordinal } : {}),
    claimedProjects: claimedProjects.slice(0, 10),
  };
}

const usd = (value: number | null): string => {
  if (value === null || !(value > 0)) return "an unreported value";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `$${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${Math.round(value)}`;
};

const DAY_MS = 24 * 3600 * 1000;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * The spacing between this operator's launches, in the operator's own dates.
 *
 * Two launches are ONE interval, and one interval is not a rate. Saying "a
 * launch every 78 days" from two points invents a pattern the evidence does
 * not contain, so the two-point case reports the gap and nothing more. Only
 * from three dated launches, which is two intervals, does a typical spacing
 * exist to report at all.
 *
 * Every sentence here is about the DATED launches and says so. A launch
 * resolved through dexscreener rather than the launchpad carries no mint date,
 * so the dated pair is not necessarily the last two, and the dated count is
 * not the operator's launch count. Calling them "the last two launches" or
 * "4 launches" would assert an order and a total the dates cannot support,
 * and would contradict the launch count in the sentence before it.
 */
export function describeLaunchSpacing(history: OperatorLaunchHistory): string | null {
  const stamps = [...history.launches.map((launch) => launch.mintedAt), history.subjectMintedAt]
    .map((at) => (at ? Date.parse(at) : NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (stamps.length < 2) return null;
  const gaps = stamps.slice(1).map((value, index) => Math.round((value - stamps[index]) / DAY_MS));
  if (gaps.length === 1) {
    return `There were ${gaps[0]} days between the two dated launches.`;
  }
  const span = Math.round((stamps[stamps.length - 1] - stamps[0]) / DAY_MS);
  return `There were ${stamps.length} dated launches over ${span} days, a median of ${median(gaps)} days apart.`;
}

/**
 * One plain sentence per prior launch plus the count. Every number is the
 * CURRENT state of a token that already had its run, set against the peak it
 * reached when a peak survived resolveLaunchPeak, which is the only honest
 * way to describe a track record of launches.
 *
 * What the decline is NOT allowed to become: a rug, an abandonment, an exit.
 * ARGUS cannot see intent, and a token trading far under its launch-day high
 * is the ordinary fate of most launchpad tokens. The number is stated and the
 * reader draws the conclusion.
 *
 * The lead sentence says "launch N of M" only when subjectLaunchNumber placed
 * the audited token, and the panel reads the same field, so the two can never
 * print different positions. Without it the count still carries the
 * serial-launch story: M launches tied to one operator is the finding, and
 * which one of them is being audited is a separate claim that needs dates.
 */
export function describeLaunchHistory(history: OperatorLaunchHistory): string | null {
  const claimed = history.claimedProjects ?? [];
  if (!history.launches.length && !claimed.length) return null;
  const month = (at?: string): string => {
    const parsed = at ? new Date(at) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? ` (${parsed.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })})`
      : "";
  };
  const sentences: string[] = [];
  if (history.launches.length) {
    const parts = history.launches.slice(0, 6).map((launch) => {
      const now = `${launch.symbol || launch.mint.slice(0, 6)} now ${usd(launch.fdvUsd)}`;
      return `${now}${describeDecline(launch)}`;
    });
    // Never "earlier launches": a sibling the operator minted after this one is
    // in the same list, and the creator index gives no reason to think the
    // audited token is the newest thing the wallet has shipped.
    const lead = history.subjectLaunchNumber
      ? `This is launch ${history.subjectLaunchNumber} of ${history.totalLaunches} tied to the same operator.`
      : `There are ${history.totalLaunches} launches tied to the same operator, including this one.`;
    sentences.push(`${lead} Their other launches: ${parts.join("; ")}.`);
    const spacing = describeLaunchSpacing(history);
    if (spacing) sentences.push(spacing);
  }
  if (claimed.length) {
    const parts = claimed.slice(0, 6).map((project) => `${project.label}${month(project.at)}`);
    sentences.push(
      `The operator's own account also claims ${claimed.length} earlier project${claimed.length === 1 ? "" : "s"} with no live market today: ${parts.join(", ")}.`,
    );
  }
  return sentences.join(" ");
}

/** Below this a move off the peak is market noise, not a track record. */
const MATERIAL_DECLINE_PCT = 10;

/** ", down 97.5% from its peak", or nothing at all when no peak survived. */
function describeDecline(launch: PriorLaunch): string {
  const peak = launch.athUsd;
  const now = launch.fdvUsd;
  if (!peak || !(peak > 0) || now === null || !(now > 0) || now >= peak) return "";
  const declinePct = ((peak - now) / peak) * 100;
  if (declinePct < MATERIAL_DECLINE_PCT) return "";
  return `, down ${declinePct.toFixed(1)}% from its peak`;
}
