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
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${HOST}/v1/market/token_top_traders?chain=${encodeURIComponent(gmgnChain)}`
    + `&address=${encodeURIComponent(address)}&limit=${limit}`;

  let body: unknown;
  try {
    const response = await paced(() => fetchImpl(url, {
      headers: { "X-APIKEY": key, accept: "application/json" },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    }));
    if (!response.ok) {
      return EMPTY(response.status === 429
        ? "GMGN rate limited this scan, so its holder reading was not collected."
        : `GMGN returned HTTP ${response.status}, so its holder reading was not collected.`);
    }
    body = await response.json();
  } catch {
    return EMPTY("GMGN did not respond, so its holder reading was not collected.");
  }

  const envelope = body as { code?: unknown; data?: { list?: unknown } } | null;
  // Their envelope carries its own status. A non-zero code is a refusal, and a
  // refusal is not an empty holder list.
  if (!envelope || (envelope.code !== undefined && num(envelope.code) !== 0)) {
    return EMPTY("GMGN declined the request, so its holder reading was not collected.");
  }
  const rows = Array.isArray(envelope.data?.list) ? envelope.data.list : null;
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
