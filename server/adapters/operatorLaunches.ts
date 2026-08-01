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
  url: string;
  /** How this launch was tied to the operator; never an inference. */
  link: "same_creator_wallet" | "operator_bio_project" | "operator_announcement";
  /** The operator's own words, when the link came from a launch announcement. */
  announcement?: { text: string; at?: string };
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

/** Normalized X handle from any x.com/twitter.com URL or bare @handle. */
export function normalizeXHandle(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(/(?:x\.com|twitter\.com)\/(?!i\/|search|home)([A-Za-z0-9_]{1,30})/i);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? handle.toLowerCase() : null;
}

/** The pump.fun record for a mint: creator wallet plus declared socials. */
export async function pumpfunCoin(mint: string): Promise<{ creator: string; symbol: string; name?: string; xHandle?: string; createdAt?: string } | null> {
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
      ...(created ? { createdAt: new Date(created).toISOString() } : {}),
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
  const stem = base.replace(HANDLE_SUFFIXES, "");
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
  mints: string[];
  tickers: string[];
  /** @handles the post claims authorship of ("Why I built @theodevxyz"). */
  handles: string[];
  /** Bare project names ("uAPE is now live"). */
  names: string[];
}

/** Posts where the operator claims a launch, with the assets they name. */
export async function operatorLaunchAnnouncements(handle: string): Promise<LaunchAnnouncement[]> {
  const key = env("TWITTERAPI_KEY");
  const clean = handle.replace(/^@/, "");
  if (!key || !clean) return [];
  let posts: unknown[] = [];
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
    out.push({ text: text.replace(/\s+/g, " ").slice(0, 200), ...(at ? { at } : {}), mints, tickers, handles, names });
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

export interface OperatorLaunchHistory {
  creatorWallet?: string;
  launches: PriorLaunch[];
  /** This launch plus every prior one we could tie to the operator. */
  totalLaunches: number;
  /**
   * Projects the operator publicly claims to have launched but whose token no
   * longer resolves to a live pool. A dead launch leaves no market data, and
   * silence about it would flatter the operator's record: the claim and its
   * date are the evidence.
   */
  claimedProjects: Array<{ label: string; at?: string; quote: string }>;
}

/**
 * Full prior-launch picture for a launchpad token: same-wallet history plus
 * the operator's own claimed projects. Deduped by mint; never throws.
 */
export async function collectOperatorLaunches(
  mint: string,
  operatorBioHandles: readonly string[] = [],
  operatorHandle?: string,
): Promise<OperatorLaunchHistory> {
  const coin = await pumpfunCoin(mint);
  const subjectHandle = coin?.xHandle;
  const sameCreator = coin ? await launchesBySameCreator(mint, coin.creator) : [];
  // The operator's own launch posts: the only path that reaches a launch made
  // from a different wallet and never mentioned in the bio.
  const announced: PriorLaunch[] = [];
  const subjectSymbol = coin?.symbol ?? "";
  let announcements: LaunchAnnouncement[] = [];
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
      announced.push({
        ...resolved,
        link: "operator_announcement",
        ...(source ? { announcement: { text: source.text, ...(source.at ? { at: source.at } : {}) } } : {}),
      });
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
      const source = announcements.find((entry) => entry.tickers.includes(ticker));
      announced.push({
        ...resolved,
        link: "operator_announcement",
        ...(source ? { announcement: { text: source.text, ...(source.at ? { at: source.at } : {}) } } : {}),
      });
    }
    for (const claimed of announcedHandles) {
      const resolved = await launchForOperatorHandle(claimed);
      if (!resolved) continue;
      const source = announcements.find((entry) => entry.handles.includes(claimed));
      announced.push({
        ...resolved,
        link: "operator_announcement",
        ...(source ? { announcement: { text: source.text, ...(source.at ? { at: source.at } : {}) } } : {}),
      });
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
      const key = label.toUpperCase().replace(/^[@$]/, "");
      if (seenClaims.has(key) || resolvedLabels.has(key) || resolvedLabels.has(label.toLowerCase())) continue;
      if (subjectSymbol && key === subjectSymbol.toUpperCase()) continue;
      seenClaims.add(key);
      claimedProjects.push({
        label,
        ...(announcement.at ? { at: announcement.at } : {}),
        quote: announcement.text,
      });
    }
  }
  return {
    ...(coin?.creator ? { creatorWallet: coin.creator } : {}),
    launches,
    totalLaunches: launches.length + 1,
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

/**
 * One plain sentence per prior launch plus the count. Every number is the
 * CURRENT state of a token that already had its run, which is the only
 * honest way to describe a track record of launches.
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
    const parts = history.launches
      .slice(0, 6)
      .map((launch) => `${launch.symbol || launch.mint.slice(0, 6)} now ${usd(launch.fdvUsd)}`);
    sentences.push(`This is launch ${history.totalLaunches} tied to the same operator. Earlier launches: ${parts.join("; ")}.`);
  }
  if (claimed.length) {
    const parts = claimed.slice(0, 6).map((project) => `${project.label}${month(project.at)}`);
    sentences.push(
      `The operator's own account also claims ${claimed.length} earlier project${claimed.length === 1 ? "" : "s"} with no live market today: ${parts.join(", ")}.`,
    );
  }
  return sentences.join(" ");
}
