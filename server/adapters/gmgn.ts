// GMGN OpenAPI: holder cost basis, trader PnL, and GMGN's own wallet tags.
//
// WHAT THIS IS FOR. Two things here exist nowhere else in ARGUS. The first is
// COST BASIS: GMGN reports what each top holder actually paid, so "the largest
// holder is 8x up on a $7.6M position" replaces "the largest holder has 31%".
// One of those answers whether they are likely to sell. The second is GMGN's
// wallet classification (sniper, bundler, suspicious), which is the transaction
// grounded version of a signal ARGUS currently infers from a holder snapshot.
//
// WHAT IT IS NOT. GMGN's tags are GMGN's ASSESSMENT, not a measurement, and they
// are carried with that attribution exactly like RugCheck's. Their numbers (cost,
// PnL, balances) are measurements and are reported as GMGN's readings. Their AI
// rating is deliberately not read at all: a score this product did not compute
// must never reach a verdict this product signs.
//
// LIMITS, from their own documentation. The default rate limit is 1 request per
// second and they explicitly do not offer high availability, so this lane is
// strictly best effort: a small fixed call budget, serialized, and never allowed
// to fail an audit. Provider fallbacks are off by design, so a failure here is
// reported on screen rather than silently substituted.
//
// READ ROUTES ONLY. Their swap and order routes need a request-signing private
// key. A diligence product has no business holding one, so nothing here can
// trade and no signing key is ever read.

import { randomUUID } from "node:crypto";

import { env } from "../config";

const HOST = "https://openapi.gmgn.ai";

/** Their documented default. One request per second, so calls are serialized. */
const MIN_CALL_SPACING_MS = 1_100;
const CALL_TIMEOUT_MS = 8_000;

/**
 * Chains GMGN answers for. An unsupported chain is not a failure and not an
 * absence of risk: it is a question this provider cannot be asked at all.
 */
const CHAIN: Record<string, string> = {
  solana: "sol",
  ethereum: "eth",
  base: "base",
  bsc: "bsc",
};

export interface GmgnHolder {
  address: string;
  percent: number | null;
  usdValue: number | null;
  /** What this wallet paid, per GMGN's accounting. Null when unreported. */
  costUsd: number | null;
  /** Realized plus unrealized, per GMGN. Null when unreported. */
  profitUsd: number | null;
  /** GMGN's own labels for the wallet. Their assessment, never ours. */
  tags: string[];
  /** GMGN's suspicious flag, carried verbatim and never re-interpreted. */
  suspicious: boolean;
  /** An X handle GMGN associates with the wallet. An attribution, not proof. */
  xHandle: string | null;
  /** Exchange custody label where GMGN names one. */
  exchange: string | null;
}

/**
 * The tags that assert RISK. GMGN's tag vocabulary mixes accusations with plain
 * description: `top_holder`, `TOP1`, `transfer_in`, `bluechip_owner` and
 * `diamond_hands` say where a wallet sits, not that anything is wrong with it.
 * Counting those as flags produced "GMGN flags 10 of the 10 top holders" on
 * BONK, which reads as ten accusations and was ten position labels. Only these
 * carry a risk claim, and anything outside the list is treated as description.
 */
const RISK_TAGS = new Set([
  "sniper", "bundler", "rat_trader", "insider", "phishing", "scam",
  "sybil", "wash_trader", "bot", "mev_bot", "dev_team",
]);

/** GMGN's risk-bearing tags for one wallet, description discarded. */
export function riskTagsOf(holder: GmgnHolder): string[] {
  return holder.tags.filter((tag) => RISK_TAGS.has(tag.trim().toLowerCase()));
}

export interface GmgnTokenIntel {
  /** False when the key is absent, the chain is unsupported, or a call failed. */
  available: boolean;
  holders: GmgnHolder[];
  /** One plain sentence naming why this lane produced nothing. */
  note: string | null;
  /** True when the holder list was cut by our own cap, so it reads as a floor. */
  capped: boolean;
}

const EMPTY = (note: string): GmgnTokenIntel => ({ available: false, holders: [], note, capped: false });

/**
 * GMGN's per-tag wallet counter stops at exactly this number. BONK reports 1000
 * for sniper, bundler, rat, whale and fresh alike, which is the cap showing, not
 * five identical populations. At the cap the count is a FLOOR and must never be
 * published as a total.
 */
export const GMGN_TAG_COUNT_CAP = 1000;

export interface GmgnTagCount {
  count: number;
  /** True when the counter sits at GMGN's cap, making the count a floor. */
  atCap: boolean;
}

/**
 * GMGN's launch-pattern reading of a token, from /v1/token/info.
 *
 * Field meanings follow GMGN's own documentation: the volume percentages are
 * ratios of TRADING VOLUME attributed to wallets carrying that tag, and the
 * wallet counts are how many tagged wallets hold the token. All of it is GMGN's
 * classification of the chain, reported here with that attribution and never
 * adopted as an ARGUS finding. Their AI rating is deliberately not read.
 */
export interface GmgnBundleReading {
  /** False when the key is absent, the chain is unsupported, or a call failed. */
  available: boolean;
  /** One plain sentence naming why this lane produced nothing. */
  note: string | null;
  holderCount: number | null;
  /** Share of trading volume GMGN attributes to bundler bots. 0-100. */
  bundlerVolumePct: number | null;
  /** Share of volume GMGN attributes to rat/insider traders. 0-100. */
  insiderVolumePct: number | null;
  /** Share of volume GMGN attributes to entrapment traders. 0-100. */
  entrapmentVolumePct: number | null;
  /** Share of volume GMGN attributes to bot degen wallets. 0-100. */
  botVolumePct: number | null;
  botWalletCount: number | null;
  /** Share of HOLDERS GMGN counts as fresh wallets. 0-100. */
  freshWalletHolderPct: number | null;
  /** GMGN's top70_sniper_hold_rate, undocumented by them; a hold share. 0-100. */
  sniperHoldPct: number | null;
  top10HolderPct: number | null;
  creatorHoldPct: number | null;
  devTeamHoldPct: number | null;
  /** How many other tokens GMGN counts from this creator. */
  creatorCreatedCount: number | null;
  /** Tokens GMGN finds carrying this same logo image. Cuts both ways: high on a
   * widely copied original AND on a copy. It never says which this one is. */
  imageDupCount: number | null;
  tagged: {
    sniper: GmgnTagCount | null;
    bundler: GmgnTagCount | null;
    insider: GmgnTagCount | null;
    fresh: GmgnTagCount | null;
  };
  creatorAddress: string | null;
  /** From creator_token_status: true=holding, false=closed, null=unreported. */
  creatorStillHolds: boolean | null;
  /** Past X handle changes GMGN records for the token's account. */
  twitterRenames: number | null;
  /**
   * GMGN's cto_flag, carried as raw provider data and NEVER published.
   *
   * Their docs call it "community takeover, original dev abandoned". Measured
   * 2026-08-05 on ten tokens it was 1 on nine of them: JUP, WIF, BONK, POPCAT,
   * TRUMP and three pump.fun launches minutes old whose creators had a single
   * token each, with 0 only on USDC. Whatever it encodes, it is not developer
   * abandonment, and rendering it accused every one of those projects of it.
   * Do not publish this without new evidence that it discriminates.
   */
  communityTakeover: boolean | null;
  /** GMGN's dexscr_boost_fee. Their docs call it 0/1; live tokens carry larger
   * numbers, so it is kept as a number where >0 means paid DEXScreener boost. */
  dexscreenerBoost: number | null;
}

const EMPTY_BUNDLE = (note: string): GmgnBundleReading => ({
  available: false,
  note,
  holderCount: null,
  bundlerVolumePct: null,
  insiderVolumePct: null,
  entrapmentVolumePct: null,
  botVolumePct: null,
  botWalletCount: null,
  freshWalletHolderPct: null,
  sniperHoldPct: null,
  top10HolderPct: null,
  creatorHoldPct: null,
  devTeamHoldPct: null,
  creatorCreatedCount: null,
  imageDupCount: null,
  tagged: { sniper: null, bundler: null, insider: null, fresh: null },
  creatorAddress: null,
  creatorStillHolds: null,
  twitterRenames: null,
  communityTakeover: null,
  dexscreenerBoost: null,
});

let lastCallAt = 0;

/** Serialize against their one-per-second limit. Shared across a whole process. */
let queue: Promise<unknown> = Promise.resolve();
function paced<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_CALL_SPACING_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
    return work();
  });
  // The chain must not break on a rejection, or every later call inherits it.
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function tagsOf(row: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const key of ["tags", "maker_token_tags", "wallet_tag_v2"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) out.add(value.trim());
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === "string" && entry.trim()) out.add(entry.trim());
    }
  }
  return [...out];
}

type GmgnCall =
  | { ok: true; data: unknown }
  | { ok: false; note: string };

/**
 * One authenticated, paced GET against a GMGN read route. Read routes
 * authenticate on X-APIKEY plus a timestamp and a per-request client_id, both
 * as QUERY parameters. Their public demo key tolerates their absence; a real
 * key answers 401 without them. Failure notes name the reading that was lost so
 * a caller can say which question went unasked instead of implying the answer
 * was clean.
 */
async function gmgnGet(
  path: string,
  params: Record<string, string>,
  reading: string,
  fetchImpl: typeof fetch,
  key: string,
): Promise<GmgnCall> {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(Math.floor(Date.now() / 1000)),
    client_id: randomUUID(),
  });
  const url = `${HOST}${path}?${query.toString()}`;

  let body: unknown;
  try {
    const response = await paced(() => fetchImpl(url, {
      headers: { "X-APIKEY": key, accept: "application/json" },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    }));
    if (!response.ok) {
      return {
        ok: false,
        note: response.status === 429
          ? `GMGN rate limited this scan, so its ${reading} was not collected.`
          : `GMGN returned HTTP ${response.status}, so its ${reading} was not collected.`,
      };
    }
    body = await response.json();
  } catch {
    return { ok: false, note: `GMGN did not respond, so its ${reading} was not collected.` };
  }

  const envelope = body as { code?: unknown; data?: unknown } | null;
  // Their envelope carries its own status. A non-zero code is a refusal, and a
  // refusal is not an empty reading.
  if (!envelope || (envelope.code !== undefined && num(envelope.code) !== 0)) {
    return { ok: false, note: `GMGN declined the request, so its ${reading} was not collected.` };
  }
  return { ok: true, data: envelope.data };
}

/**
 * The subject's top holders as GMGN sees them, with what they paid.
 *
 * Never throws and never blocks an audit. `available: false` carries the reason
 * so a caller can say which question went unasked instead of implying the
 * answer was clean.
 */
export async function fetchGmgnTokenIntel(
  chain: string,
  address: string,
  opts: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<GmgnTokenIntel> {
  const key = env("GMGN_API_KEY");
  if (!key) return EMPTY("GMGN was not queried: no API key is configured for this deployment.");
  const gmgnChain = CHAIN[chain];
  if (!gmgnChain) return EMPTY(`GMGN does not cover ${chain}, so its holder reading was not available for this token.`);
  if (!address.trim()) return EMPTY("GMGN was not queried: no token address.");

  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const call = await gmgnGet(
    "/v1/market/token_top_traders",
    { chain: gmgnChain, address, limit: String(limit) },
    "holder reading",
    opts.fetchImpl ?? fetch,
    key,
  );
  if (!call.ok) return EMPTY(call.note);
  const rows = Array.isArray((call.data as { list?: unknown } | null)?.list)
    ? (call.data as { list: unknown[] }).list
    : null;
  if (!rows) return EMPTY("GMGN returned no holder list, so its reading was not collected.");

  const holders: GmgnHolder[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const wallet = typeof row.address === "string" ? row.address : null;
    if (!wallet) continue;
    const realized = num(row.realized_profit) ?? num(row.realized_pnl);
    const unrealized = num(row.unrealized_profit) ?? num(row.unrealized_pnl);
    const profitUsd = realized === null && unrealized === null ? null : (realized ?? 0) + (unrealized ?? 0);
    const percentRaw = num(row.amount_percentage);
    holders.push({
      address: wallet,
      // Their share arrives as a 0-1 ratio. A value outside that range is a bad
      // payload, and publishing it would put a fabricated percentage on screen.
      percent: percentRaw !== null && percentRaw >= 0 && percentRaw <= 1 ? percentRaw * 100 : null,
      usdValue: num(row.usd_value),
      costUsd: num(row.total_cost) ?? num(row.accu_cost) ?? num(row.cost),
      profitUsd,
      tags: tagsOf(row),
      suspicious: row.is_suspicious === true,
      xHandle: typeof row.twitter_username === "string" && row.twitter_username.trim()
        ? row.twitter_username.trim().replace(/^@/, "")
        : null,
      exchange: typeof row.exchange === "string" && row.exchange.trim() ? row.exchange.trim() : null,
    });
  }

  return {
    available: true,
    holders,
    note: null,
    capped: rows.length >= limit,
  };
}

/**
 * What GMGN's reading supports saying out loud.
 *
 * Every sentence names GMGN, because every input here is GMGN's account of the
 * chain rather than ARGUS's own read of it. A wallet GMGN tags is reported as a
 * wallet GMGN tags; the report does not adopt the classification.
 */
export function describeGmgnHolders(intel: GmgnTokenIntel): string[] {
  if (!intel.available) return [];
  const claims: string[] = [];
  const flagged = intel.holders.filter((holder) => holder.suspicious || riskTagsOf(holder).length > 0);
  if (flagged.length) {
    const named = flagged.slice(0, 3).map((holder) => {
      const label = riskTagsOf(holder)[0] ?? "suspicious";
      return `${holder.address.slice(0, 6)}… (${label})`;
    }).join(", ");
    claims.push(
      `GMGN flags ${flagged.length} of the ${intel.holders.length} top holders it reports${intel.capped ? " (a capped list, so a floor)" : ""}: ${named}. `
      + "These are GMGN's classifications of the wallets, not findings ARGUS verified independently.",
    );
  }
  const withCost = intel.holders.filter((holder) => holder.costUsd !== null && holder.costUsd > 0 && holder.profitUsd !== null);
  if (withCost.length) {
    const up = withCost.filter((holder) => (holder.profitUsd ?? 0) > 0).length;
    claims.push(
      `GMGN reports an entry cost for ${withCost.length} top holders, of which ${up} are showing a gain. `
      + "A holder sitting on a large unrealized gain has more reason to sell than one at break-even, which is what this measures and all it measures.",
    );
  }
  return claims;
}

/** A 0-1 wire ratio as a 0-100 percentage. Out of range is a bad payload, not a big number. */
function ratioPct(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed * 100 : null;
}

/** A non-negative integer count, or null. A negative count is a bad payload. */
function count(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 && Number.isInteger(parsed) ? parsed : null;
}

function tagCount(value: unknown): GmgnTagCount | null {
  const parsed = count(value);
  return parsed === null ? null : { count: parsed, atCap: parsed >= GMGN_TAG_COUNT_CAP };
}

/**
 * GMGN's launch-pattern reading: /v1/token/info, one call.
 *
 * Everything here is GMGN's classification and is carried with that
 * attribution. Their AI rating is present in the payload and deliberately
 * never read: a score ARGUS did not compute must never reach a verdict it
 * signs.
 */
export async function fetchGmgnBundleReading(
  chain: string,
  address: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GmgnBundleReading> {
  const key = env("GMGN_API_KEY");
  if (!key) return EMPTY_BUNDLE("GMGN was not queried: no API key is configured for this deployment.");
  const gmgnChain = CHAIN[chain];
  if (!gmgnChain) return EMPTY_BUNDLE(`GMGN does not cover ${chain}, so its launch-pattern reading was not available for this token.`);
  if (!address.trim()) return EMPTY_BUNDLE("GMGN was not queried: no token address.");

  const call = await gmgnGet(
    "/v1/token/info",
    { chain: gmgnChain, address },
    "launch-pattern reading",
    opts.fetchImpl ?? fetch,
    key,
  );
  if (!call.ok) return EMPTY_BUNDLE(call.note);
  if (!call.data || typeof call.data !== "object") {
    return EMPTY_BUNDLE("GMGN returned no token record, so its launch-pattern reading was not collected.");
  }

  const data = call.data as Record<string, unknown>;
  const stat = (data.stat && typeof data.stat === "object" ? data.stat : {}) as Record<string, unknown>;
  const dev = (data.dev && typeof data.dev === "object" ? data.dev : {}) as Record<string, unknown>;
  const tags = (data.wallet_tags_stat && typeof data.wallet_tags_stat === "object" ? data.wallet_tags_stat : {}) as Record<string, unknown>;

  const creatorAddress = typeof dev.creator_address === "string" && dev.creator_address.trim()
    ? dev.creator_address.trim()
    : null;
  // Their status vocabulary: creator_hold / hold means still holding,
  // creator_close / sell means exited. Anything else stays unreported rather
  // than guessed.
  const status = typeof dev.creator_token_status === "string" ? dev.creator_token_status.trim() : "";
  const creatorStillHolds = status === "creator_hold" || status === "hold"
    ? true
    : status === "creator_close" || status === "sell" ? false : null;

  return {
    available: true,
    note: null,
    holderCount: count(data.holder_count) ?? count(stat.holder_count),
    bundlerVolumePct: ratioPct(stat.top_bundler_trader_percentage),
    insiderVolumePct: ratioPct(stat.top_rat_trader_percentage),
    entrapmentVolumePct: ratioPct(stat.top_entrapment_trader_percentage),
    botVolumePct: ratioPct(stat.top_bot_degen_percentage),
    botWalletCount: count(stat.bot_degen_count),
    freshWalletHolderPct: ratioPct(stat.fresh_wallet_rate),
    sniperHoldPct: ratioPct(stat.top70_sniper_hold_rate),
    top10HolderPct: ratioPct(stat.top_10_holder_rate),
    creatorHoldPct: ratioPct(stat.creator_hold_rate),
    devTeamHoldPct: ratioPct(stat.dev_team_hold_rate),
    creatorCreatedCount: count(stat.creator_created_count),
    imageDupCount: count(data.image_dup_count),
    tagged: {
      sniper: tagCount(tags.sniper_wallets),
      bundler: tagCount(tags.bundler_wallets),
      insider: tagCount(tags.rat_trader_wallets),
      fresh: tagCount(tags.fresh_wallets),
    },
    creatorAddress,
    creatorStillHolds,
    twitterRenames: Array.isArray(dev.twitter_name_change_history) ? dev.twitter_name_change_history.length : null,
    communityTakeover: dev.cto_flag === 1 ? true : dev.cto_flag === 0 ? false : null,
    dexscreenerBoost: num(dev.dexscr_boost_fee),
  };
}

/** "at least 1,000" at the cap; the plain count below it. */
function tagPhrase(tag: GmgnTagCount): string {
  return tag.atCap ? `at least ${GMGN_TAG_COUNT_CAP.toLocaleString("en-US")}` : tag.count.toLocaleString("en-US");
}

const pct = (value: number): string => `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;

/**
 * What GMGN's launch-pattern reading supports saying out loud.
 *
 * Every sentence names GMGN and reports a SHAPE (how much volume their tagged
 * wallets account for, how many tagged wallets hold), never the conclusion
 * "this launch was bundled". Their per-tag counter stops at 1,000, so a count
 * at the cap is always published as a floor.
 */
export function describeGmgnBundle(reading: GmgnBundleReading): string[] {
  if (!reading.available) return [];
  const claims: string[] = [];

  const volumeShares: Array<[number, string]> = [];
  if (reading.bundlerVolumePct !== null && reading.bundlerVolumePct > 0) {
    volumeShares.push([reading.bundlerVolumePct, "bundler bots"]);
  }
  if (reading.insiderVolumePct !== null && reading.insiderVolumePct > 0) {
    volumeShares.push([reading.insiderVolumePct, "insider traders"]);
  }
  if (volumeShares.length) {
    const rendered = volumeShares.map(([share, label], index) =>
      `${pct(share)}${index === 0 ? " of this token's trading volume" : ""} to wallets it tags as ${label}`);
    claims.push(
      `GMGN attributes ${rendered.join(" and ")}. `
      + "These are GMGN's classifications of the wallets, not findings ARGUS verified independently.",
    );
  }

  const tagParts: string[] = [];
  let anyAtCap = false;
  for (const [label, tag] of [["snipers", reading.tagged.sniper], ["bundler bots", reading.tagged.bundler], ["insider traders", reading.tagged.insider]] as const) {
    if (!tag || tag.count === 0) continue;
    anyAtCap = anyAtCap || tag.atCap;
    tagParts.push(`${tagPhrase(tag)} as ${label}`);
  }
  if (tagParts.length) {
    claims.push(
      `Among wallets holding this token, GMGN tags ${tagParts.join(", ")}.`
      + (anyAtCap ? " GMGN's per-tag counter stops at 1,000, so a count at that number is a floor, never a total." : ""),
    );
  }

  if (reading.creatorCreatedCount !== null && reading.creatorCreatedCount > 1) {
    claims.push(`GMGN counts ${reading.creatorCreatedCount} tokens created by this token's creator.`);
  }
  if (reading.imageDupCount !== null && reading.imageDupCount > 0) {
    claims.push(
      `GMGN finds ${reading.imageDupCount} other token${reading.imageDupCount === 1 ? "" : "s"} carrying this same logo image. `
      + "That number is high for a widely copied original and for a copy alike; it does not say which this one is.",
    );
  }
  if (reading.dexscreenerBoost !== null && reading.dexscreenerBoost > 0) {
    claims.push("GMGN records paid DEXScreener promotion (boost) for this token.");
  }
  if (reading.twitterRenames !== null && reading.twitterRenames > 0) {
    claims.push(
      `GMGN records ${reading.twitterRenames} past handle change${reading.twitterRenames === 1 ? "" : "s"} on the token's X account. `
      + "A renamed account may have carried a different project's audience before this one.",
    );
  }
  return claims;
}
