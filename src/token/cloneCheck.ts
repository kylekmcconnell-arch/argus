// Ticker collisions: other mints trading under the same symbol as the audited one.
//
// The $LINKR case. The project's mint appeared at 22:29:09 UTC on 2026-07-30.
// Six minutes later four more mints carrying the ticker LINKR appeared in a
// single burst, none of them with a liquidity pool, several pointing at the
// project's own announcement post. Two rules keep this check honest.
//
// ATTRIBUTION. The burst ran AFTER the audited mint and cited the operator's own
// tweet, so a shared link is evidence that somebody impersonated the operator,
// not that the operator minted them. This module reports mints, timestamps and
// money and never a person, a wallet, or a shared URL, because binding an
// impersonator's wallet to the victim's identity is the mistake here that cannot
// be walked back.
//
// ORDERING. Every timestamp available for free is an UPPER bound on when a mint
// came into existence: a pool creation proves the token already existed by then,
// an indexer sighting proves the same, and neither proves nothing happened
// earlier. So the two directions are not symmetric.
//   - "Something with this ticker predates you" needs the AUDITED mint's own
//     bound to be creation grade. Dexscreener drops a pump.fun bonding pair once
//     a token graduates, so the real $LINKR's earliest visible pool is 22:52:20,
//     23 minutes after its mint and 17 minutes AFTER the impersonators' pools.
//     Ordering on pool times alone tells the project's own buyers they are
//     looking at a clone and points them at a zero liquidity impersonator as the
//     original. That is the direction that must never fire wrongly.
//   - "Nothing with this ticker predates you" is weaker than it sounds and is
//     never published as a clean result: dexscreener search caps at 30 pairs and
//     a clone with no pool at all is not listed, so this path UNDER-counts. The
//     count it reports is a floor.

import type { DexPair } from "./sources";

/** Dexscreener search returns the pair page URL, which the shared DexPair type omits. */
type SearchPair = DexPair & { url?: string };

export interface SameTickerMint {
  mint: string;
  chain: string;
  /** Earliest dexscreener pool creation for this mint. Null when no pool is listed. */
  pairCreatedAt: number | null;
  /** Best upper bound on when this mint began to exist, ms since epoch. */
  firstSeenAt: number | null;
  /**
   * "creation": a source that watches mints as they land saw this one at or
   * before its first pool. "listing": only a pool creation, which can trail the
   * mint by hours. "unknown": no public record found.
   */
  firstSeenBasis: "creation" | "listing" | "unknown";
  /** Liquidity across every listed pool for this mint. */
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  url: string | null;
}

/**
 * "earliest" and "only" describe the RECORDS this sweep found, not the ticker.
 * Both are floors, so neither may be rendered as a badge saying the audited mint
 * is the original. "later" is the only load bearing claim and is the one the
 * ordering rules guard.
 */
export type CloneOrdering = "earliest" | "later" | "only" | "unresolved";

export interface CloneCheckResult {
  audited: CloneOrdering;
  /** Other mints using the same ticker. Same ticker and nothing more: not proven copies of anything. */
  clones: SameTickerMint[];
  /** Set only where the ordering settles it. Absent means unsettled, never "the audited mint". */
  earliestMint?: string;
  note: string;
  /** False when the sweep could not run. An absent check is not a clean result. */
  checked: boolean;
}

export interface CloneCheckInput {
  mint: string;
  symbol: string;
  chain: string;
  /** The audited mint's pool creation, where the caller already holds one. */
  pairCreatedAt?: number | null;
  /** The audited mint's liquidity, where the caller already holds it. Falls back to the search. */
  liquidityUsd?: number | null;
}

export interface CloneCheckOptions {
  fetchImpl?: typeof fetch;
  /**
   * Creation grade timestamp for a mint in ms, or null when unavailable.
   * Injectable so a chain this module cannot resolve today can be covered by the
   * caller without loosening the ordering rules below.
   */
  resolveCreatedAt?: (mint: string, chain: string, fetchImpl: typeof fetch) => Promise<number | null>;
  /** Cap on creation grade lookups per check, the audited mint included. */
  lookupLimit?: number;
}

/**
 * Ordering slack. Indexers and block timestamps disagree by seconds and a burst
 * of bot mints lands one second apart, so a sub-minute gap orders nothing.
 */
export const ORDERING_MARGIN_MS = 60_000;

/** How close after the audited mint a same ticker mint counts as part of a burst. */
const BURST_WINDOW_MS = 15 * 60_000;

const DEFAULT_LOOKUP_LIMIT = 8;
const LOOKUP_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 8_000;
const LOOKUP_TIMEOUT_MS = 9_000;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

/** Zero width and byte order marks, which render as nothing and hide a ticker swap. */
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF]|\p{Cc}/gu;

/**
 * Tickers as a human reads them. NFKC folds fullwidth letters onto ASCII and the
 * invisible characters come out, so a leading-space " USDC" collides with USDC
 * the way it does on screen. Dexscreener really does return that one alongside
 * the real USDC.
 */
export function normalizeTicker(symbol: string | null | undefined): string {
  if (!symbol || typeof symbol !== "string") return "";
  return symbol
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function mintKey(chain: string, address: string): string {
  return `${chain}:${EVM_ADDRESS.test(address) ? address.toLowerCase() : address}`;
}

/**
 * Keyless first sighting from rugcheck, which watches Solana mints as they land.
 * detectedAt is when THEIR index first recorded the mint and not a chain fact:
 * BONK, minted in Dec 2022, reads 2024-06-13 and USDC reads 2026-04-15, both the
 * day rugcheck backfilled them. That is why the caller only ever folds this in
 * with Math.min against a pool time, and demotes it below creation grade when
 * the pool came first.
 */
export async function rugcheckFirstSeen(
  mint: string,
  chain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (chain !== "solana") return null;
  try {
    const response = await fetchImpl(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const body = await response.json() as { detectedAt?: unknown };
    const at = typeof body?.detectedAt === "string" ? Date.parse(body.detectedAt) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Null distinguishes "the sweep did not run" from "the sweep ran and found nothing". */
async function searchSameTicker(symbol: string, fetchImpl: typeof fetch): Promise<SearchPair[] | null> {
  try {
    const response = await fetchImpl(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const body = await response.json() as { pairs?: SearchPair[] };
    return Array.isArray(body?.pairs) ? body.pairs : [];
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One row per mint, folded from every pool that mint trades in. */
function foldByMint(pairs: SearchPair[], ticker: string): Map<string, SameTickerMint> {
  const byMint = new Map<string, SameTickerMint>();
  const deepestPool = new Map<string, number>();
  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    const chain = pair.chainId;
    if (!address || !chain) continue;
    if (normalizeTicker(pair.baseToken?.symbol) !== ticker) continue;
    const key = mintKey(chain, address);
    const created = num(pair.pairCreatedAt);
    const liquidity = num(pair.liquidity?.usd);
    const row = byMint.get(key);
    if (!row) {
      byMint.set(key, {
        mint: address,
        chain,
        pairCreatedAt: created,
        firstSeenAt: created,
        firstSeenBasis: created === null ? "unknown" : "listing",
        liquidityUsd: liquidity,
        marketCapUsd: num(pair.marketCap) ?? num(pair.fdv),
        url: pair.url ?? null,
      });
      deepestPool.set(key, liquidity ?? -1);
      continue;
    }
    if (created !== null && (row.pairCreatedAt === null || created < row.pairCreatedAt)) {
      row.pairCreatedAt = created;
      row.firstSeenAt = created;
      row.firstSeenBasis = "listing";
    }
    // Liquidity sums because a mint's float is spread across its pools, while
    // market cap is a per-token figure and so is read off the deepest pool.
    if (liquidity !== null) row.liquidityUsd = (row.liquidityUsd ?? 0) + liquidity;
    if (liquidity !== null && liquidity > (deepestPool.get(key) ?? -1)) {
      deepestPool.set(key, liquidity);
      row.marketCapUsd = num(pair.marketCap) ?? num(pair.fdv) ?? row.marketCapUsd;
      if (pair.url) row.url = pair.url;
    }
  }
  return byMint;
}

/**
 * Which mints are worth a creation grade lookup, inside the cap. Two groups
 * matter: mints listed before the audited one, because they are what a "you are
 * not the first" line would rest on, and the deepest mints, because a project
 * worth impersonating is the one holding liquidity.
 */
function lookupTargets(audited: SameTickerMint, peers: SameTickerMint[], limit: number): SameTickerMint[] {
  const auditedAt = audited.firstSeenAt;
  const earlier = peers
    .filter((peer) => peer.firstSeenAt !== null && (auditedAt === null || peer.firstSeenAt < auditedAt))
    .sort((a, b) => (a.firstSeenAt ?? 0) - (b.firstSeenAt ?? 0));
  const deepest = [...peers].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  const picked: SameTickerMint[] = [audited];
  const seen = new Set([mintKey(audited.chain, audited.mint)]);
  for (const candidate of [...earlier, ...deepest]) {
    if (picked.length >= limit) break;
    const key = mintKey(candidate.chain, candidate.mint);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
  }
  return picked;
}

async function applyCreationTimes(
  targets: SameTickerMint[],
  resolve: (mint: string, chain: string, fetchImpl: typeof fetch) => Promise<number | null>,
  fetchImpl: typeof fetch,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const row = targets[cursor++];
      const createdAt = await resolve(row.mint, row.chain, fetchImpl).catch(() => null);
      if (createdAt === null) continue;
      // A sighting at or near the first pool means the indexer was watching the
      // chain live: rugcheck logged the $LINKR impersonators 2 seconds after
      // their bonding pools opened. A sighting long after the pool is a backfill
      // of a token that had been trading for months and says nothing about when
      // it was minted.
      if (row.pairCreatedAt === null || createdAt <= row.pairCreatedAt + ORDERING_MARGIN_MS) {
        row.firstSeenBasis = "creation";
      }
      row.firstSeenAt = row.firstSeenAt === null ? createdAt : Math.min(row.firstSeenAt, createdAt);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, targets.length) }, worker));
}

const usd = (value: number): string => `$${Math.round(value).toLocaleString("en-US")}`;

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/**
 * A gap is stated rounded DOWN and a window rounded UP, so "6 minutes earlier"
 * and "within 7 minutes" both stay true when the underlying timestamps are
 * coarser than they look.
 */
function describeSpan(ms: number, round: (value: number) => number): string {
  const span = Math.max(0, ms);
  if (span < 90 * 60_000) {
    const minutes = Math.max(1, round(span / 60_000));
    return `${minutes} ${plural(minutes, "minute", "minutes")}`;
  }
  if (span < 48 * 3_600_000) {
    const hours = Math.max(1, round(span / 3_600_000));
    return `${hours} ${plural(hours, "hour", "hours")}`;
  }
  const days = Math.max(1, round(span / 86_400_000));
  return `${days} ${plural(days, "day", "days")}`;
}

const COUNT_IS_A_FLOOR = "A clone with no liquidity pool is often not listed at all, so that count is a floor.";
const SWEEP_IS_A_FLOOR = "A clone with no liquidity pool is often not listed at all, so this sweep can miss one.";
const CHECK_ADDRESS = "Check the contract address before you buy.";

function earliestNote(ticker: string, auditedAt: number, clones: SameTickerMint[]): string {
  const burst = clones.filter((clone) => (
    clone.firstSeenAt !== null && clone.firstSeenAt <= auditedAt + BURST_WINDOW_MS
  ));
  const rest = clones.length - burst.length;
  const tail = rest > 0
    ? ` ${rest} more ${plural(rest, "has", "have")} used the ticker since. ${COUNT_IS_A_FLOOR}`
    : ` ${COUNT_IS_A_FLOOR}`;
  if (!burst.length) {
    return `${clones.length} other ${plural(clones.length, "mint uses", "mints use")} the ticker $${ticker}, every one of them first seen after this mint. ${CHECK_ADDRESS}${tail}`;
  }
  const window = describeSpan(
    Math.max(...burst.map((clone) => (clone.firstSeenAt ?? auditedAt) - auditedAt)),
    Math.ceil,
  );
  const deepest = Math.max(...burst.map((clone) => clone.liquidityUsd ?? 0));
  const money = deepest > 0
    ? `, the largest holding ${usd(deepest)} of liquidity`
    : ", none of them with any liquidity";
  return `${burst.length} other ${plural(burst.length, "token", "tokens")} using the ticker $${ticker} appeared within ${window} of this one${money}. ${CHECK_ADDRESS}${tail}`;
}

function laterNote(ticker: string, gapMs: number, audited: SameTickerMint, earliest: SameTickerMint): string {
  const theirs = earliest.liquidityUsd ?? 0;
  const ours = audited.liquidityUsd ?? 0;
  let money = "";
  if (theirs > 0) {
    money = ours > 0
      ? `, holding ${usd(theirs)} of liquidity against this mint's ${usd(ours)}`
      : `, holding ${usd(theirs)} of liquidity where this mint has none`;
  }
  return `This is not the first mint using the ticker $${ticker}. Another appeared ${describeSpan(gapMs, Math.floor)} earlier at ${earliest.mint}${money}. ${CHECK_ADDRESS} Which mint the project itself issued is not something these timestamps settle.`;
}

/**
 * Other mints using the audited token's ticker, ordered on public creation
 * records. Reports what the ordering states and nothing about who did it.
 */
export async function checkForClones(
  input: CloneCheckInput,
  options: CloneCheckOptions = {},
): Promise<CloneCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveCreatedAt = options.resolveCreatedAt ?? rugcheckFirstSeen;
  const limit = options.lookupLimit ?? DEFAULT_LOOKUP_LIMIT;
  const ticker = normalizeTicker(input.symbol);
  const chain = input.chain;
  const callerPairCreatedAt = num(input.pairCreatedAt);
  const callerLiquidity = num(input.liquidityUsd);

  if (!ticker || !input.mint || !chain) {
    return {
      audited: "unresolved",
      clones: [],
      checked: false,
      note: "There is no ticker to sweep for, so no same ticker mint has been ruled in or out.",
    };
  }

  const pairs = await searchSameTicker(ticker, fetchImpl);
  if (pairs === null) {
    return {
      audited: "unresolved",
      clones: [],
      checked: false,
      note: `The ticker sweep for $${ticker} did not complete, so no same ticker mint has been ruled in or out.`,
    };
  }

  const byMint = foldByMint(pairs, ticker);
  const auditedKey = mintKey(chain, input.mint);
  const audited: SameTickerMint = byMint.get(auditedKey) ?? {
    mint: input.mint,
    chain,
    pairCreatedAt: callerPairCreatedAt,
    firstSeenAt: callerPairCreatedAt,
    firstSeenBasis: callerPairCreatedAt === null ? "unknown" : "listing",
    liquidityUsd: callerLiquidity,
    marketCapUsd: null,
    url: null,
  };
  if (callerPairCreatedAt !== null && (audited.pairCreatedAt === null || callerPairCreatedAt < audited.pairCreatedAt)) {
    audited.pairCreatedAt = callerPairCreatedAt;
    audited.firstSeenAt = audited.firstSeenAt === null
      ? callerPairCreatedAt
      : Math.min(audited.firstSeenAt, callerPairCreatedAt);
    audited.firstSeenBasis = "listing";
  }
  if (callerLiquidity !== null) audited.liquidityUsd = callerLiquidity;
  byMint.set(auditedKey, audited);

  const clones = [...byMint.values()].filter((row) => mintKey(row.chain, row.mint) !== auditedKey);
  if (!clones.length) {
    return {
      audited: "only",
      clones: [],
      checked: true,
      note: `No other mint using the ticker $${ticker} is listed on dexscreener. ${SWEEP_IS_A_FLOOR}`,
    };
  }

  await applyCreationTimes(lookupTargets(audited, clones, limit), resolveCreatedAt, fetchImpl);
  clones.sort((a, b) => (a.firstSeenAt ?? Infinity) - (b.firstSeenAt ?? Infinity));

  const auditedAt = audited.firstSeenAt;
  const dated = clones.filter((clone): clone is SameTickerMint & { firstSeenAt: number } => clone.firstSeenAt !== null);
  const cohort = `${clones.length} other ${plural(clones.length, "mint uses", "mints use")} the ticker $${ticker}`;
  if (auditedAt === null || !dated.length) {
    return {
      audited: "unresolved",
      clones,
      checked: true,
      note: `${cohort}. There is no public creation record to order them against this mint, so which came first is unsettled. ${CHECK_ADDRESS}`,
    };
  }

  const earliest = dated[0];

  if (earliest.firstSeenAt + ORDERING_MARGIN_MS <= auditedAt) {
    const gap = auditedAt - earliest.firstSeenAt;
    // An earlier record only unseats the audited mint when the audited mint's own
    // record is creation grade. A first listing can trail a mint by hours, which
    // is exactly how the real $LINKR reads as later than its impersonators.
    if (audited.firstSeenBasis !== "creation") {
      return {
        audited: "unresolved",
        clones,
        checked: true,
        note: `${cohort}, and one at ${earliest.mint} has a public record ${describeSpan(gap, Math.floor)} older than this mint's first listing. A first listing can trail a mint by hours, so that does not establish which was minted first. ${CHECK_ADDRESS}`,
      };
    }
    return {
      audited: "later",
      clones,
      checked: true,
      earliestMint: earliest.mint,
      note: laterNote(ticker, gap, audited, earliest),
    };
  }

  if (auditedAt + ORDERING_MARGIN_MS <= earliest.firstSeenAt) {
    return {
      audited: "earliest",
      clones,
      checked: true,
      earliestMint: audited.mint,
      note: earliestNote(ticker, auditedAt, clones),
    };
  }

  return {
    audited: "unresolved",
    clones,
    checked: true,
    note: `${cohort}, first seen within ${describeSpan(Math.abs(auditedAt - earliest.firstSeenAt), Math.ceil)} of this one, too close together to order. ${CHECK_ADDRESS}`,
  };
}
