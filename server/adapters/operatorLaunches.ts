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
  link: "same_creator_wallet" | "operator_bio_project";
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

export interface OperatorLaunchHistory {
  creatorWallet?: string;
  launches: PriorLaunch[];
  /** This launch plus every prior one we could tie to the operator. */
  totalLaunches: number;
}

/**
 * Full prior-launch picture for a launchpad token: same-wallet history plus
 * the operator's own claimed projects. Deduped by mint; never throws.
 */
export async function collectOperatorLaunches(
  mint: string,
  operatorBioHandles: readonly string[] = [],
): Promise<OperatorLaunchHistory> {
  const coin = await pumpfunCoin(mint);
  const subjectHandle = coin?.xHandle;
  const sameCreator = coin ? await launchesBySameCreator(mint, coin.creator) : [];
  const bioHandles = [...new Set(
    operatorBioHandles
      .map((entry) => normalizeXHandle(entry))
      .filter((entry): entry is string => Boolean(entry) && entry !== subjectHandle),
  )].slice(0, 5);
  const fromBio = (await Promise.all(bioHandles.map((entry) => launchForOperatorHandle(entry))))
    .filter((entry): entry is PriorLaunch => Boolean(entry));
  const byMint = new Map<string, PriorLaunch>();
  for (const launch of [...sameCreator, ...fromBio]) {
    if (launch.mint === mint || byMint.has(launch.mint)) continue;
    byMint.set(launch.mint, launch);
  }
  const launches = [...byMint.values()];
  return {
    ...(coin?.creator ? { creatorWallet: coin.creator } : {}),
    launches,
    totalLaunches: launches.length + 1,
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
  if (!history.launches.length) return null;
  const parts = history.launches
    .slice(0, 6)
    .map((launch) => `${launch.symbol || launch.mint.slice(0, 6)} now ${usd(launch.fdvUsd)}`);
  return `This is launch ${history.totalLaunches} tied to the same operator. Earlier launches: ${parts.join("; ")}.`;
}
