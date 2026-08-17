// X adapter — the signature data path, split into two layers per our provider
// review:
//   - twitterapi.io (TWITTERAPI_KEY): profile + the follow graph. The official
//     X API gates follower/following behind ~$42k/mo Enterprise, so the cheap
//     follow-check lives here and is isolated as the one gray-area dependency.
//   - Grok / xAI (XAI_API_KEY): real-time X *content* via Live Search, for the
//     acknowledgment half of testimonial corroboration (did @endorser ever
//     mention/reply/thank @subject) and recent-activity sentiment.

import type { Adapter, CollectContext } from "./types";
import { env, DISCOVERY_MODEL, providerFallbacksEnabled } from "../config";
import { addGrokUsage, addClaudeUsage, recordCall, recordTwitterapi, grokSpendUsd } from "../cost";
import { cacheGet, cacheSet } from "../cache";
import { TestimonialVerdict, classifyTestimonial } from "../../src/engine";
import type { NotableFollower } from "../../src/data/evidence";
import { canonicalPublicProfileWebsite } from "../../src/lib/fundScaleEvidence";
import { NOTABLE_ACCOUNTS } from "./notableAccounts";
import { groundedSearch, groundedSearchProvisioned } from "./groundedSearch";
import { captureTimestamp } from "../captureTime";

const TWITTERAPI = "https://api.twitterapi.io";
type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const twitterProviderFailure = (payload: JsonRecord): string | null => {
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (["error", "failed", "failure"].includes(status)) return `provider_status_${status}`;
  if (payload.success === false) return "provider_success_false";
  if (payload.data === null) return "provider_data_null";
  return null;
};

// Grok search via the current Responses API + tools (the legacy search_parameters
// Live Search API was retired -> 410 Gone). Returns the model's text, or null.
/** Ceiling on live-search spend for a single audit, in the cost ledger's own
 * accounting. This is a RUNAWAY GUARD ONLY, deliberately set well above a
 * normal audit: measured discovery alone books ~$3-4 of ledger-Grok (many
 * live-search calls, each billed per source), and a full audit does more. The
 * previous $3.00 value was chosen against the old under-counting ledger and
 * silently truncated normal collection mid-run once the ledger was corrected;
 * $8 clears a normal audit (measured $3-4 of
 * discovery-Grok, plus the rest of the pipeline) while still tripping a
 * pathological multi-times-normal loop. NOTE: the ledger's per-source
 * estimate is uncalibrated against the real xAI invoice, so these are
 * ledger-dollars, not billed dollars; the guard is sized in the same units it
 * measures. */
const GROK_AUDIT_SPEND_CEILING_USD = Number(env("ARGUS_GROK_AUDIT_CEILING_USD") || "8.00");

export async function grokSearch(system: string, user: string, opts?: {
  maxToolCalls?: number;
  cacheKey?: string;
  /** Force a fresh provider call for release canaries and failover checks. */
  bypassCache?: boolean;
  /** Shared physical-call budget used by bounded multi-question repair. */
  claimProviderCall?: () => boolean;
}): Promise<string | null> {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  // 24h read-through cache: a subject's team/affiliations don't change
  // hour-to-hour, and live search is the dominant spend. Keyed by the CALLER's
  // stable subject key (never the raw prompt — prompts embed volatile posts).
  if (opts?.cacheKey && !opts.bypassCache) {
    const hit = await cacheGet(opts.cacheKey);
    if (hit) return hit;
  }
  // COST: xAI bills live search PER SOURCE on top of tokens, and an unbounded
  // agentic loop can pull dozens of sources per call. max_tool_calls caps the
  // search loop (the dominant spend); if the API rejects the param we retry
  // once without it. Every physical attempt is recorded, including the rejected
  // compatibility call and transport/parse failures.
  const call = async (withCap: boolean): Promise<{ status: number | null; text: string | null; budgetExhausted?: boolean }> => {
    if (opts?.claimProviderCall && !opts.claimProviderCall()) {
      return { status: null, text: null, budgetExhausted: true };
    }
    // Hard per-audit ceiling. Live search bills per source on top of tokens, so
    // one pathological subject (a huge account, or a discovery loop that keeps
    // finding new leads) can outspend a normal audit many times over. Past the
    // ceiling the audit continues on everything already collected rather than
    // silently running up the bill.
    if (grokSpendUsd() >= GROK_AUDIT_SPEND_CEILING_USD) {
      addGrokUsage(undefined, 0, "live-search", "partial", "audit_spend_ceiling");
      return { status: null, text: null, budgetExhausted: true };
    }
    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
          input: [{ role: "system", content: system }, { role: "user", content: user }],
          tools: [{ type: "web_search" }, { type: "x_search" }],
          ...(withCap ? { max_tool_calls: opts?.maxToolCalls ?? 3 } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      addGrokUsage(undefined, 0, "live-search", "failed", "transport_error");
      return { status: null, text: null };
    }
    if (!res.ok) {
      addGrokUsage(undefined, 0, "live-search", "failed", `http_${res.status}`);
      return { status: res.status, text: null };
    }

    let d: JsonRecord;
    try { d = asRecord(await res.json()); }
    catch {
      addGrokUsage(undefined, 0, "live-search", "failed", "response_json_error");
      return { status: res.status, text: null };
    }
    const output = Array.isArray(d.output) ? d.output.map(asRecord) : [];
    const toolCalls = output.length
      ? output.filter((item) => /search|tool/.test(String(item.type ?? ""))).length
      : undefined;
    const usageRecord = asRecord(d.usage);
    const usage = {
      input_tokens: optionalNumber(usageRecord.input_tokens),
      output_tokens: optionalNumber(usageRecord.output_tokens),
      num_sources_used: optionalNumber(usageRecord.num_sources_used),
    };
    const nestedText = output
      .flatMap((item) => Array.isArray(item.content) ? item.content.map(asRecord) : [])
      .map((content) => typeof content.text === "string" ? content.text : "")
      .join(" ");
    const text = typeof d.output_text === "string" ? d.output_text : nestedText;
    console.log("[grok-usage]", JSON.stringify({ in: usage.input_tokens, out: usage.output_tokens, toolCalls }));
    addGrokUsage(
      usage,
      toolCalls,
      "live-search",
      text ? "succeeded" : "partial",
      text ? undefined : "empty_output",
    );
    return { status: res.status, text: text || null };
  };

  let result = await call(true);
  if (result.status === 400 && !result.budgetExhausted) result = await call(false); // param unsupported -> compat retry
  if (result.text && opts?.cacheKey && !opts.bypassCache) void cacheSet(opts.cacheKey, result.text);
  return result.text;
}

const ANTHROPIC = "https://api.anthropic.com/v1/messages";

// General-web search via Claude's hosted web_search tool. Same contract as
// grokSearch (system + user -> the model's synthesized text, usually JSON), but
// Claude web_search bills a flat $0.01/request instead of Grok's per-source live
// search (~$0.125+/call, ~12x more). Only for call sites with NO X-corpus
// dependency: LinkedIn, Crunchbase, GitHub, press, filings, product docs.
// Returns null ONLY on an API/transport failure, so a dispatcher can fall back
// to Grok; a search that legitimately finds nothing still returns its empty
// JSON (non-null) and must not trigger a fallback (no double-billing).
export async function claudeWebSearch(system: string, user: string, opts?: {
  maxSearchUses?: number;
  cacheKey?: string;
  bypassCache?: boolean;
}): Promise<string | null> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  if (opts?.cacheKey && !opts.bypassCache) {
    const hit = await cacheGet(opts.cacheKey);
    if (hit) return hit;
  }
  let res: Response;
  try {
    res = await fetch(ANTHROPIC, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: DISCOVERY_MODEL,
        max_tokens: 3_000,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: opts?.maxSearchUses ?? 4 }],
      }),
      // Claude web_search runs several searches server-side then synthesizes;
      // 45s was too tight (calls timed out and silently fell back to Grok,
      // erasing the cost win). Give it room; lanes run in parallel and the
      // collection budget is ~390s.
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout_120000ms" : "transport_error";
    addClaudeUsage(undefined, "web-search", "failed", reason);
    return null;
  }
  if (!res.ok) {
    addClaudeUsage(undefined, "web-search", "failed", `http_${res.status}`);
    return null;
  }
  let d: JsonRecord;
  try { d = asRecord(await res.json()); }
  catch {
    addClaudeUsage(undefined, "web-search", "failed", "response_json_error");
    return null;
  }
  const usageRecord = asRecord(d.usage);
  const usage = {
    input_tokens: optionalNumber(usageRecord.input_tokens),
    output_tokens: optionalNumber(usageRecord.output_tokens),
    server_tool_use: {
      web_search_requests: optionalNumber(asRecord(usageRecord.server_tool_use).web_search_requests),
    },
  };
  const text = (Array.isArray(d.content) ? d.content.map(asRecord) : [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  addClaudeUsage(usage, "web-search", text ? "succeeded" : "partial", text ? undefined : "empty_output", DISCOVERY_MODEL);
  if (text && opts?.cacheKey && !opts.bypassCache) void cacheSet(opts.cacheKey, text);
  return text || null;
}

// Dispatcher for GENERAL-WEB discovery (no X-corpus dependency). Tries Claude
// web_search first (12x cheaper), falling back to Grok live search only when
// Claude is unavailable or errors (-> null). A Claude search that runs and finds
// nothing returns its empty JSON (non-null), so the common empty case does NOT
// re-pay Grok; the fallback exists only to preserve recall when Claude could not
// answer at all. ARGUS_GENERAL_WEB_PROVIDER=grok forces the legacy path for
// a controlled A/B or emergency rollback.
export async function generalWebSearch(system: string, user: string, opts?: {
  maxToolCalls?: number;
  cacheKey?: string;
  bypassCache?: boolean;
  claimProviderCall?: () => boolean;
}): Promise<string | null> {
  if ((env("ARGUS_GENERAL_WEB_PROVIDER") || "").toLowerCase() !== "grok") {
    // Ultimate path: decoupled Serper search + page fetch + cheap-model extract
    // (near-free vs a frontier web_search reading every page in-context).
    // Default policy: the first PROVISIONED provider owns the lane when it
    // answers, including a valid empty result. A total provider failure may use
    // an already-provisioned recovery path; ARGUS_PROVIDER_FALLBACKS=on also
    // permits optional cascading after non-failure empty results.
    if (groundedSearchProvisioned()) {
      let groundedUnavailable = false;
      const viaGrounded = await groundedSearch(system, user, {
        cacheKey: opts?.cacheKey,
        bypassCache: opts?.bypassCache,
        onProviderUnavailable: () => { groundedUnavailable = true; },
      });
      // A valid empty answer stays on its lane. A provider that rejected every
      // request did not answer, so an already-provisioned fallback may recover
      // the report even when optional duplicate-provider cascading is off.
      if (viaGrounded || (!groundedUnavailable && !providerFallbacksEnabled())) return viaGrounded;
    }
    if (env("ANTHROPIC_API_KEY")) {
      const viaClaude = await claudeWebSearch(system, user, {
        maxSearchUses: opts?.maxToolCalls,
        cacheKey: opts?.cacheKey ? `cw1:${opts.cacheKey}` : undefined,
        bypassCache: opts?.bypassCache,
      });
      if (viaClaude || !providerFallbacksEnabled()) return viaClaude;
    }
  }
  return env("XAI_API_KEY") ? grokSearch(system, user, opts) : null;
}

// twitterapi.io throttles hard (429) under bursty use, and occasionally 502/503.
// Retry transient statuses with exponential backoff; return the last response so
// the caller can still inspect a terminal error.
async function twFetch(url: string, key: string, tries = 2): Promise<Response | null> {
  // Ledger: op = the endpoint path (e.g. "user/info"), one line per endpoint.
  // Count each physical retry, not just the logical caller invocation.
  const op = url.match(/\/twitter\/([a-z_/]+)/i)?.[1] ?? "other";
  for (let i = 0; i < tries; i++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      recordTwitterapi(op, "failed", "transport_error");
      if (i + 1 >= tries) return null;
      await new Promise((resolve) => setTimeout(resolve, 700 * (i + 1)));
      continue;
    }
    if (!res.ok) {
      recordTwitterapi(op, "failed", `http_${res.status}`);
    } else {
      try {
        const payload = asRecord(await res.clone().json());
        const providerFailure = twitterProviderFailure(payload);
        recordTwitterapi(op, providerFailure ? "failed" : "succeeded", providerFailure ?? undefined);
      } catch {
        recordTwitterapi(op, "failed", "response_json_error");
      }
    }
    if (res.status !== 429 && res.status !== 502 && res.status !== 503) return res;
    if (i + 1 >= tries) return res;
    // Short backoff: a full 5s wait per 429 (free-tier QPS) balloons the whole
    // audit past its budget when many calls are made, so we keep this fast and
    // accept that a busy free-tier audit drops some calls. The real fix is a paid
    // tier (no QPS cap); see notableFollowers for the single-call accommodation.
    await new Promise((r) => setTimeout(r, res.status === 429 ? 1200 : 700 * (i + 1)));
  }
  return null;
}

// ── twitterapi.io: profile ───────────────────────────────────────────────
export interface XProfile {
  handle: string;
  accountStatus?: "active" | "suspended" | "unavailable";
  statusSourceUrl?: string;
  statusCapturedAt?: string;
  name?: string;
  bio?: string;
  followers?: number;
  createdAt?: string;
  website?: string;
  image?: string; // real X profile photo URL (more reliable than an unavatar guess)
}

/**
 * X's public, logged-out profile HTML contains a server-rendered terminal
 * account state. Probe it only after the licensed profile provider fails, so
 * a suspended account is not flattened into a generic provider outage.
 */
export async function publicXAccountState(
  handle: string,
  fetcher: typeof fetch = fetch,
): Promise<Pick<XProfile, "handle" | "accountStatus" | "statusSourceUrl" | "statusCapturedAt"> | null> {
  const u = handle.replace(/^@/, "");
  const statusSourceUrl = `https://x.com/${encodeURIComponent(u)}`;
  let response: Response;
  try {
    response = await fetcher(statusSourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/3.0; account-state check)" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    recordCall("x-public", "account-state", 0, `${u} · transport_error`, "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("x-public", "account-state", 0, `${u} · http_${response.status}`, "failed");
    return null;
  }
  let html: string;
  try {
    html = await response.text();
  } catch {
    recordCall("x-public", "account-state", 0, `${u} · unreadable`, "failed");
    return null;
  }
  const suspended = /\bAccount suspended\b/i.test(html)
    || /unavailable_reason\s*[:=]\s*["']Suspended["']/i.test(html)
    || /unavailable_reason\\?["']?\s*:\s*\\?["']Suspended\\?["']/i.test(html);
  const unavailable = suspended
    || /\bThis account (?:doesn['’]t|does not) exist\b/i.test(html)
    || /unavailable_reason\s*[:=]\s*["'](?:NotFound|Unavailable|Deactivated)["']/i.test(html);
  if (!unavailable) {
    recordCall("x-public", "account-state", 0, `${u} · no_terminal_state`, "succeeded");
    return null;
  }
  const accountStatus = suspended ? "suspended" : "unavailable";
  recordCall("x-public", "account-state", 0, `${u} · ${accountStatus}`, "succeeded");
  return {
    handle: `@${u}`,
    accountStatus,
    statusSourceUrl,
    statusCapturedAt: captureTimestamp(),
  };
}

// The project's own website is the biggest un-mined lead on a project account —
// the team page lives there, not in the tweets. twitterapi returns the bio link
// under a few shapes; take the first real http(s) one.
function pickWebsite(p: any): string | undefined {
  const cands = [
    p?.profile_bio?.entities?.url?.urls?.[0]?.expanded_url,
    p?.entities?.url?.urls?.[0]?.expanded_url,
    p?.url, p?.profile_url, p?.website, p?.link,
  ].filter((x) => typeof x === "string" && /^https?:\/\//i.test(x));
  return cands[0];
}

export async function getProfile(handle: string): Promise<XProfile | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const u = handle.replace(/^@/, "");
  const url = `${TWITTERAPI}/twitter/user/info?userName=${encodeURIComponent(u)}`;
  // twitterapi.io returns HTTP 200 even on failure ({status:"error", data:null}),
  // and a COLD lookup of a less-trafficked account sometimes returns "not found"
  // once, then resolves once they fetch it. Retry the error envelope once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await twFetch(url, key);
      if (!res || !res.ok) return await publicXAccountState(`@${u}`);
      const d = (await res.json()) as any;
      if (d?.status === "error" || d?.data === null) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        return await publicXAccountState(`@${u}`);
      }
      const p = d.data ?? d;
      if (!p || (p.name == null && p.followers == null && p.followers_count == null && p.description == null)) {
        return await publicXAccountState(`@${u}`);
      }
      // twitterapi returns the avatar under a few shapes; take the first, and ask
      // for the full-size image (Twitter serves a 48px "_normal" by default).
      const rawImg = p.profilePicture ?? p.profile_image_url_https ?? p.profile_image_url ?? p.profile_image;
      const image = typeof rawImg === "string" ? rawImg.replace(/_normal\.(jpg|jpeg|png|gif|webp)$/i, "_400x400.$1") : undefined;
      return {
        handle: "@" + u,
        accountStatus: "active",
        statusSourceUrl: `https://x.com/${encodeURIComponent(u)}`,
        statusCapturedAt: captureTimestamp(),
        name: p.name,
        bio: p.description,
        followers: p.followers ?? p.followers_count,
        createdAt: p.createdAt ?? p.created_at,
        website: pickWebsite(p),
        image,
      };
    } catch {
      return null;
    }
  }
  return null;
}

// Handle-change history via memory.lol (keyless OSINT index that maps an X
// account id to every screen name it has used, with date ranges). A rebrand is a
// classic move to escape a burned reputation, and X keeps the same id across
// handle changes, so the old names are recoverable. Coverage is partial: an empty
// result means "not in the index", never a guarantee of no change.
export async function handleHistory(handle: string): Promise<{ priorHandles: string[]; idStr?: string } | null> {
  const u = handle.replace(/^@/, "");
  let response: Response;
  try {
    response = await fetch(`https://api.memory.lol/v1/tw/${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(8000) });
  } catch {
    recordCall("memory.lol", "tw-history", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("memory.lol", "tw-history", 0, `http_${response.status}`, "failed");
    return null;
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    recordCall("memory.lol", "tw-history", 0, "response_json_error", "failed");
    return null;
  }
  const envelope = asRecord(parsed);
  if (!Array.isArray(envelope.accounts)) {
    recordCall("memory.lol", "tw-history", 0, "invalid_result_shape", "partial");
    return null;
  }
  if (!envelope.accounts.length) {
    recordCall("memory.lol", "tw-history", 0, "no_match", "succeeded");
    return { priorHandles: [] };
  }
  const acct = asRecord(envelope.accounts[0]);
  if (!acct.screen_names || typeof acct.screen_names !== "object" || Array.isArray(acct.screen_names)) {
    recordCall("memory.lol", "tw-history", 0, "screen_names_missing", "partial");
    return { priorHandles: [], ...(typeof acct.id_str === "string" ? { idStr: acct.id_str } : {}) };
  }
  const names = Object.keys(acct.screen_names);
  const prior = names.filter((n) => n.toLowerCase() !== u.toLowerCase());
  recordCall("memory.lol", "tw-history", 0, prior.length ? "history_found" : "no_prior_handles", "succeeded");
  return { priorHandles: prior, ...(typeof acct.id_str === "string" ? { idStr: acct.id_str } : {}) };
}

// One live audit reads the SAME cursorless last_tweets page from three passes
// (corpus page 1, last-post-at, post-cadence), and each refetch is billed AND
// contends for the free tier's QPS cap. Memoize the raw page-1 payload per
// handle for roughly the span of an audit; cursor pages and failure envelopes
// stay uncached so pagination and later retries behave exactly as before.
const LAST_TWEETS_MEMO_TTL_MS = 10 * 60_000;
const LAST_TWEETS_MEMO_MAX = 64; // bound warm-instance growth across audits
const lastTweetsMemo = new Map<string, { at: number; payload: unknown }>();
export function clearLastTweetsMemo(): void { lastTweetsMemo.clear(); } // test isolation seam
async function lastTweetsFirstPage(handle: string, key: string): Promise<any | null> {
  const u = handle.replace(/^@/, "");
  const memoKey = u.toLowerCase();
  const hit = lastTweetsMemo.get(memoKey);
  if (hit && Date.now() - hit.at < LAST_TWEETS_MEMO_TTL_MS) return hit.payload;
  const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
  if (!res || !res.ok) return null;
  let d: unknown;
  try { d = await res.json(); } catch { return null; }
  if (!twitterProviderFailure(asRecord(d))) {
    if (lastTweetsMemo.size >= LAST_TWEETS_MEMO_MAX) {
      const oldest = lastTweetsMemo.keys().next().value;
      if (oldest !== undefined) lastTweetsMemo.delete(oldest);
    }
    lastTweetsMemo.set(memoKey, { at: Date.now(), payload: d });
  }
  return d;
}

// twitterapi.io: recent posts, fuel for claim extraction + activity signal.
export async function getRecentPosts(handle: string, limit = 20): Promise<string[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  try {
    const d = await lastTweetsFirstPage(handle, key);
    if (!d) return [];
    // twitterapi.io nests the array under data.tweets; tolerate the flatter shapes too.
    const tweets: any[] = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    return tweets
      .map((t) => t.text ?? t.full_text ?? "")
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// Same source as getRecentPosts, but keeps the timestamp so cadence can be
// analyzed (getRecentPosts is text-only for claim mining). Pulls a deeper window
// since cadence needs history, not just the latest handful.
import type { PostMeta } from "../../src/lib/cadence";
export async function getRecentPostsMeta(handle: string, limit = 40): Promise<PostMeta[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  try {
    const d = await lastTweetsFirstPage(handle, key);
    if (!d) return [];
    const tweets: any[] = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    return tweets
      .map((t) => ({ text: t.text ?? t.full_text ?? "", createdAt: Date.parse(t.createdAt ?? t.created_at ?? "") }))
      .filter((t) => t.text && Number.isFinite(t.createdAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ── Claim-targeted corpus ────────────────────────────────────────────────
// Self-claims cluster in ANNOUNCEMENT posts ("launching X", "we raised", "joined
// as advisor") that are often months old — an active account's newest 20 items
// are mostly replies and "gm". Sampling by recency alone misses the evidence AND
// is trivially gamed (post 20 memes, bury the shill history). So we assemble a
// corpus built to surface claims: recent ORIGINALS (no replies/RTs) + keyword
// search over the account's WHOLE history, ranked by claim-density + reach, each
// stamped with its date + views so the extractor can date ventures and weight
// what the subject actually pushed. Keywords are RETRIEVAL only — Claude still
// reads everything and decides what's a claim (keyword lists miss non-English /
// novel slang; their job is only to get the right posts onto its desk).
const num = (...v: any[]): number | undefined => { for (const x of v) if (typeof x === "number") return x; return undefined; };
interface CorpusPost { text: string; at: number | null; views: number; likes: number; isReply: boolean; isRt: boolean; }

const KW_IDENTITY = [
  "founder", "co-founder", "cofounder", "CEO", "CTO", "advisor",
  '"I built"', '"we built"', '"joined as"', "founded",
  // Project accounts often disclose public operators as a roster rather than
  // repeating formal titles. These retrieval terms feed the strict project-
  // owned role grammar below; they do not establish team membership by alone.
  '"our team"', '"team member"', '"members of"', '"core team"',
];
const KW_LAUNCH = ["launching", "presale", "mint", "airdrop", "raised", "seed", "IDO", '"CA:"', "tokenomics", "whitelist"];
const KW_ENDORSE = ["backed", "investors", "partnership", "gem", "100x", '"proud to"'];
// A KOL's actual product is the CALL: without these, the corpus (tuned to founder
// claims) never surfaces their shill posts, so tokens they promoted (e.g. $DUBBZ)
// never reach the promotions extractor and vanish from the KOL report.
const KW_SHILL = ["aped", "sending", '"the play"', "entry", "accumulated", "conviction", "printing", "pumping", "calling", "chart", '"my bag"', "loaded"];
// A prolific caller's real output is a stream of cashtag + chart-link posts ("$X
// here's the chart", a dexscreener/pump link) that carry no founder vocabulary, so
// the founder/shill layers miss them and their report shows ~5 of 100s of calls.
// Chart-link domains are near-certain calls AND hand the resolver the token page.
const KW_CALLS = ["dexscreener.com", "pump.fun", "birdeye.so", "dextools.io", "geckoterminal.com", "photon-sol", '"CA"'];
const CLAIM_RE = /\b(founder|co-?founder|ceo|cto|advisor|founded|building|built|launch|presale|mint|airdrop|raised|seed|series [a-d]|ido|tokenomics|backed|investors?|partnership|gem|100x|joined|aped?|shill|calling|conviction|printing|pumping|sending it)\b/i;

function parseTweet(t: any): CorpusPost {
  const text = (t.text ?? t.full_text ?? "").trim();
  const at = Date.parse(t.createdAt ?? t.created_at ?? "");
  const isRt = /^RT @/.test(text) || !!t.retweeted_tweet || !!t.retweeted_status || t.isRetweet === true;
  const isReply = !!(t.isReply ?? t.inReplyToId ?? t.in_reply_to_status_id ?? t.in_reply_to_user_id) || /^@\w/.test(text);
  return {
    text, at: Number.isFinite(at) ? at : null,
    views: num(t.viewCount, t.view_count, t.views) ?? 0,
    likes: num(t.likeCount, t.favorite_count, t.favoriteCount, t.likes) ?? 0,
    isReply, isRt,
  };
}

async function lastTweetsPage(handle: string, key: string, cursor?: string): Promise<{ tweets: any[]; next?: string }> {
  let d: any;
  if (cursor) {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}&cursor=${encodeURIComponent(cursor)}`, key);
    if (!res || !res.ok) return { tweets: [] };
    d = (await res.json()) as any;
  } else {
    // Page 1 flows through the shared memo: coldIntake fetches it here, and the
    // later last-post-at / cadence passes reuse the same raw payload.
    d = await lastTweetsFirstPage(handle, key);
    if (!d) return { tweets: [] };
  }
  const tweets: any[] = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
  return { tweets, next: d.has_next_page ? d.next_cursor : undefined };
}

export async function searchFrom(handle: string, terms: string[], key: string): Promise<any[]> {
  const q = `from:${handle} (${terms.join(" OR ")})`;
  const res = await twFetch(`${TWITTERAPI}/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Top`, key);
  if (!res || !res.ok) return [];
  const d = (await res.json()) as any;
  return d.tweets ?? d.data?.tweets ?? [];
}

const stamp = (p: CorpusPost): string => {
  const when = p.at ? new Date(p.at).toLocaleString("en-US", { month: "short", year: "numeric" }) : "";
  const v = p.views >= 1000 ? `${Math.round(p.views / 1000)}k views` : p.views ? `${p.views} views` : "";
  const meta = [when, v].filter(Boolean).join(" · ");
  return (meta ? `[${meta}] ` : "") + p.text;
};

export interface Corpus {
  posts: string[];
  newest: string[];
  /** Exact project-team search result text already purchased during intake. */
  teamSignalPosts: string[];
  count: { originals: number; searched: number; ranked: number };
}

export async function collectCorpus(handle: string): Promise<Corpus> {
  const key = env("TWITTERAPI_KEY");
  const u = handle.replace(/^@/, "");
  if (!key) return { posts: [], newest: [], teamSignalPosts: [], count: { originals: 0, searched: 0, ranked: 0 } };

  // Layer 1: 2 pages of recent originals (drop replies/RTs).
  // Layer 2: 3 keyword searches over the whole history, in parallel.
  const p1 = await lastTweetsPage(u, key).catch(() => ({ tweets: [] as any[], next: undefined }));
  const [p2, sId, sLa, sEn, sSh, sCa] = await Promise.all([
    p1.next ? lastTweetsPage(u, key, p1.next).catch(() => ({ tweets: [] as any[] })) : Promise.resolve({ tweets: [] as any[] }),
    searchFrom(u, KW_IDENTITY, key).catch(() => []),
    searchFrom(u, KW_LAUNCH, key).catch(() => []),
    searchFrom(u, KW_ENDORSE, key).catch(() => []),
    searchFrom(u, KW_SHILL, key).catch(() => []),
    searchFrom(u, KW_CALLS, key).catch(() => []),
  ]);

  const originalsRaw = [...p1.tweets, ...p2.tweets].map(parseTweet).filter((p) => p.text && !p.isReply && !p.isRt);
  const searchedRaw = [...sId, ...sLa, ...sEn, ...sSh, ...sCa].map(parseTweet).filter((p) => p.text && !p.isRt);

  // Dedup by normalized text.
  const seen = new Set<string>();
  const dedup = (arr: CorpusPost[]) => arr.filter((p) => { const k = p.text.slice(0, 80).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const originals = dedup(originalsRaw);
  const searched = dedup(searchedRaw);
  const all = [...originals, ...searched];

  // Score: claim keywords (dominant) + reach + slight recency.
  const now = Date.now();
  const CASHTAG = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/g;
  const CHARTLINK = /dexscreener\.com|pump\.fun|birdeye\.so|dextools\.io|geckoterminal\.com|photon-sol|\bCA[:\s]/i;
  const score = (p: CorpusPost) => {
    const kw = (p.text.match(new RegExp(CLAIM_RE.source, "gi")) ?? []).length;
    const cashtags = (p.text.match(CASHTAG) ?? []).length; // a call post = a cashtag, usually with a chart link
    const call = (cashtags > 0 ? 2 : 0) + (CHARTLINK.test(p.text) ? 2 : 0);
    const reach = Math.log10(p.views + p.likes + 1);
    const recency = p.at ? Math.max(0, 1 - (now - p.at) / (365 * 864e5)) : 0; // 0..1 over a year
    return kw * 3 + call + reach + recency * 0.8;
  };
  const ranked = [...all].sort((a, b) => score(b) - score(a)).slice(0, 70);
  // Keep ~12 newest originals in the mix (current tone / dormancy / active shilling).
  const newest = [...originals].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 12);
  const rankedKeys = new Set(ranked.map((p) => p.text.slice(0, 80).toLowerCase()));
  for (const p of newest) if (!rankedKeys.has(p.text.slice(0, 80).toLowerCase())) ranked.push(p);

  return {
    posts: ranked.map(stamp),
    newest: newest.map((p) => p.text),
    teamSignalPosts: [...new Set(sId
      .map((tweet) => String((tweet as { text?: unknown; full_text?: unknown })?.text ?? (tweet as { full_text?: unknown })?.full_text ?? "").trim())
      .filter(Boolean))].slice(0, 30),
    count: { originals: originals.length, searched: searched.length, ranked: ranked.length },
  };
}

// twitterapi.io: the timestamp of the most recent tweet. Dormancy is a live-ness
// signal — a project that stops posting for weeks is often winding down, gone
// quiet after a raise, or abandoned. Returns null if unknown.
export async function getLastPostAt(handle: string): Promise<string | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  try {
    const d = await lastTweetsFirstPage(handle, key);
    if (!d) return null;
    const tweets: any[] = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    const times = tweets
      .map((t) => Date.parse(t.createdAt ?? t.created_at ?? ""))
      .filter((n) => Number.isFinite(n));
    if (!times.length) return null;
    return new Date(Math.max(...times)).toISOString();
  } catch {
    return null;
  }
}

// twitterapi.io: does `endorser` follow `subject`? Uses the one-call relationship
// check — accurate at ANY account size. (The old implementation scanned only the
// endorser's FIRST 200 followings, so anyone following >200 accounts produced a
// false "does not follow subject", quietly poisoning corroboration verdicts.)
export async function followsSubject(endorser: string, subject: string): Promise<boolean | null> {
  const rel = await checkFollow(endorser, subject); // source=endorser follows target=subject
  return rel ? rel.following : null; // null (unknown) when the API can't answer
}

// ── Follower QUALITY: do respected accounts follow the subject? ──────────
// Follower count is trivially botted; follower IDENTITY is not. Being followed
// by known callers, founders, funds and infra is a real credibility signal a
// scam can't fake, and its absence on a high-count account is itself telling.
// twitterapi's check_follow_relationship answers "does A follow B" in one call,
// so we check a curated high-signal set against the subject — accurate at any
// account size (scanning a big account's followers would miss early followers).

// Curated, deliberately small, high-signal set. Labels/sizes are for context and
// may drift; the point is WHO. Grow this list as the trust graph matures.

/**
 * One scan's answers to "does A follow B", so the same metered question is not
 * bought twice.
 *
 * Two lanes ask it about the same pair: the notable-follower pass and the
 * endorser pass. Whether that cost one call or two was decided by timing, since
 * a second asker only rode along if the first was still in flight. That showed
 * up as 15 handles checked twice the moment responses returned quickly, which
 * is real money at twitterapi's per-call price and made the same audit
 * non-reproducible.
 *
 * Only a settled ANSWER is kept. A null is a failed or unconfigured read and is
 * cheap to re-ask, and keeping it would freeze one blip into "does not follow"
 * for the rest of the scan, which is the coercion the code below refuses to
 * make from a missing field.
 */
type FollowAnswer = { following: boolean | null; followedBy: boolean | null };
interface FollowMemoSlot {
  /** the one outstanding read; cleared the moment it settles */
  inFlight?: Promise<FollowAnswer | null>;
  /** a settled ANSWER only, with the moment it landed */
  settled?: { at: number; answer: FollowAnswer };
}

/**
 * Retention spans one scan's burst and nothing longer. A warm container can
 * start the next subject moments later, and a follow relationship remembered
 * without a bound would be answered from a cache for the life of the process.
 */
const FOLLOW_MEMO_MS = 30_000;
const followMemo = new Map<string, FollowMemoSlot>();

/** Forget this scan's follow answers. Callers with a real scan boundary call this at its start. */
export function resetFollowScanMemo(): void {
  followMemo.clear();
}

// Does `source` follow `target`? One call via check_follow_relationship.
export async function checkFollow(source: string, target: string): Promise<{ following: boolean | null; followedBy: boolean | null } | null> {
  const now = Date.now();
  for (const [key, slot] of followMemo) {
    if (!slot.inFlight && (!slot.settled || now - slot.settled.at >= FOLLOW_MEMO_MS)) followMemo.delete(key);
  }

  const pairKey = `${source.replace(/^@/, "").toLowerCase()}\u0000${target.replace(/^@/, "").toLowerCase()}`;
  const existing = followMemo.get(pairKey);
  if (existing?.settled) return existing.settled.answer;
  if (existing?.inFlight) return existing.inFlight;

  const pending = checkFollowUncached(source, target);
  const slot: FollowMemoSlot = { inFlight: pending };
  followMemo.set(pairKey, slot);
  // Only an ANSWER is kept. A null is a failed or unconfigured read, cheap to
  // re-ask, and remembering it would freeze one blip into "does not follow".
  void pending.then(
    (answer) => {
      slot.inFlight = undefined;
      if (answer === null) followMemo.delete(pairKey);
      else slot.settled = { at: Date.now(), answer };
    },
    () => { followMemo.delete(pairKey); },
  );
  return pending;
}

async function checkFollowUncached(source: string, target: string): Promise<{ following: boolean | null; followedBy: boolean | null } | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const s = source.replace(/^@/, "");
  const t = target.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/check_follow_relationship?source_user_name=${encodeURIComponent(s)}&target_user_name=${encodeURIComponent(t)}`, key);
    if (!res || !res.ok) return null;
    const d = asRecord(await res.json());
    if (twitterProviderFailure(d)) return null;
    const nested = asRecord(d.data);
    // The documented response nests the relationship under `data`; the
    // provider's own examples have also shown the booleans at the top level.
    // Inspect both without ever coercing a missing field to false.
    const records = Object.keys(nested).length ? [nested, d] : [d];
    // CRITICAL: a MISSING field must be `null` (unknown), NEVER coerced to false.
    // twitterapi's field name has varied (following / is_following / follows), and
    // `!!undefined === false` was silently asserting "does not follow subject" for
    // accounts that genuinely follow — poisoning every corroboration verdict.
    const pick = (...keys: string[]): boolean | null => {
      for (const record of records) {
        for (const k of keys) if (typeof record[k] === "boolean") return record[k];
      }
      return null;
    };
    const following = pick("following", "is_following", "isFollowing", "follows", "source_following_target");
    const followedBy = pick("followed_by", "is_followed_by", "isFollowedBy", "followed", "target_following_source");
    if (following === null && followedBy === null) {
      console.log("[check-follow] unrecognized success shape:", JSON.stringify(d).slice(0, 200)); // surface real schema drift, not provider-declared failures
      return null;
    }
    return { following, followedBy };
  } catch {
    return null;
  }
}

// Notable followers, done RIGHT. Enumerating a follower list to spot the notable
// accounts is the wrong algorithm on a big account: twitterapi pages newest-first
// with no influence sort / no verified-followers endpoint, so a bounded scan only
// sees recent followers and MISSES the notable ones — a partial, useless answer.
//
// So we HYBRID over the reference set of ~250 accounts that actually matter (top
// funds / founders / KOLs / infra), picking the cheaper COMPLETE path:
//   - small/medium subject: enumerating its followers costs followerCount/200 calls
//     and matches the ENTIRE reference set for free (in-memory) — so read them all.
//   - large subject: reverse-check the reference set — one check_follow_relationship
//     call per account ("does @paradigm follow this subject?"), run in parallel.
// A completed path is exact for the reference set it covers. Provider failures,
// pagination interruptions, and the reverse-check cap remain explicitly partial.
export interface NotableScan {
  list: NotableFollower[];
  /** Directly observed candidate relationships, or the full reference set after complete enumeration. */
  checked: number;
  coverage: "complete" | "partial" | "unavailable";
  /**
   * Audience shape over the follower profiles this scan actually read. Present
   * ONLY on the enumerate path, which downloads real profile rows. The
   * reverse-check path never sees a follower profile, so it reports nothing
   * rather than an empty (and falsely measured) sample.
   */
  audience?: AudienceSample;
}

// Audience shape, read off rows we already paid for.
//
// The enumerate path downloads a FULL profile object for every follower (on one
// real project, 1,173 of them across 6 provider calls) and used to keep the
// handle and throw the rest away. A farmed or purchased audience has a
// distinctive shape, and that shape is already sitting in those rows: one
// narrow creation cohort, accounts that have never posted, a default avatar
// over an empty bio, a follow ratio pinned to one side. So tally it in the same
// pass that matches the reference set, and hand it back with the list.
//
// Three rules govern every number below, and they are the reason for the shape
// of this structure:
//   1. Every figure is a COUNT over a denominator carried beside it. These rows
//      are the newest slice of a follower list, never a random draw, so nothing
//      here is ever projected onto the account's real follower total.
//   2. A field the provider omitted is UNMEASURED. An absent created_at must
//      never be counted as "not recently created", so each group carries its
//      own `measured` count and an omission simply never enters it.
//   3. A shape is not a verdict. Anyone can be followed by bots without having
//      bought a single one, so this reports the distribution and labels no
//      account.
export interface AudienceSample {
  /** Follower profile rows this scan actually read. */
  profilesExamined: number;
  /** True only when pagination completed. Otherwise these rows are a floor. */
  sampleIsComplete: boolean;
  /** Creation cohorts among the rows that carried a creation date. */
  creation: { measured: number; largestMonth?: { month: string; accounts: number } };
  /** Rows carrying a post count, and how many of those sit at zero. */
  posts: { measured: number; zeroPosts: number };
  /** Rows carrying an avatar URL, and how many still show X's default image. */
  avatar: { measured: number; defaultAvatar: number };
  /** Rows carrying a bio field, and how many carried an empty one. */
  bio: { measured: number; empty: number };
  /** Rows carrying BOTH of those fields, and how many were default on both. */
  starterProfile: { measured: number; accounts: number };
  /** Rows carrying both follow counts, bucketed by which side dominates. */
  followRatio: { measured: number; followingHeavy: number; balanced: number; followerHeavy: number };
}

/** Running counters for one enumerate pass. Rows are never retained: a 30k
 *  follower scan must not hold 30k profile objects to answer four questions. */
export interface AudienceTally {
  profilesExamined: number;
  creationMeasured: number;
  creationMonths: Map<string, number>;
  postsMeasured: number;
  zeroPosts: number;
  avatarMeasured: number;
  defaultAvatar: number;
  bioMeasured: number;
  emptyBio: number;
  starterMeasured: number;
  starterAccounts: number;
  ratioMeasured: number;
  followingHeavy: number;
  balanced: number;
  followerHeavy: number;
}

export function newAudienceTally(): AudienceTally {
  return {
    profilesExamined: 0,
    creationMeasured: 0,
    creationMonths: new Map(),
    postsMeasured: 0,
    zeroPosts: 0,
    avatarMeasured: 0,
    defaultAvatar: 0,
    bioMeasured: 0,
    emptyBio: 0,
    starterMeasured: 0,
    starterAccounts: 0,
    ratioMeasured: 0,
    followingHeavy: 0,
    balanced: 0,
    followerHeavy: 0,
  };
}

/** X serves this path for every account that never set a profile photo. */
const DEFAULT_AVATAR_URL = /default_profile(?:_images)?[/_]/i;

/** One side of an account's follow graph counts as dominant at this multiple.
 *  Named so the bucket and the sentence describing it can never drift apart. */
export const AUDIENCE_RATIO_DOMINANCE = 10;

/** Below this many measured rows a single account moves a share by more than
 *  two points, so a percentage would be noise wearing a finding's clothes.
 *  Applied per dimension, because the provider can answer one field for the
 *  whole page and omit another entirely. */
export const AUDIENCE_SAMPLE_MIN = 50;

/** A count the provider returned, under any of its field spellings. A missing,
 *  boolean, or negative value is unknown, never zero. */
const audienceNumber = (row: JsonRecord, ...keys: string[]): number | null => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  }
  return null;
};

/** The row's creation month in UTC, or null when the provider omitted it or
 *  sent something unparseable. */
const audienceMonth = (row: JsonRecord): string | null => {
  const raw = row.createdAt ?? row.created_at;
  if (typeof raw !== "string") return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function tallyAudienceRow(tally: AudienceTally, row: unknown): void {
  // A null entry in the page array is not a profile and must not dilute a
  // denominator. A row carrying only a handle IS a profile we read, and simply
  // measures nothing.
  if (!row || typeof row !== "object" || Array.isArray(row)) return;
  const record = row as JsonRecord;
  tally.profilesExamined += 1;

  const month = audienceMonth(record);
  if (month) {
    tally.creationMeasured += 1;
    tally.creationMonths.set(month, (tally.creationMonths.get(month) ?? 0) + 1);
  }

  const posts = audienceNumber(record, "statusesCount", "statuses_count", "tweetCount", "tweet_count");
  if (posts !== null) {
    tally.postsMeasured += 1;
    if (posts === 0) tally.zeroPosts += 1;
  }

  const avatarUrl = typeof record.profilePicture === "string"
    ? record.profilePicture
    : typeof record.profile_image_url_https === "string"
      ? record.profile_image_url_https
      : typeof record.profile_image_url === "string"
        ? record.profile_image_url
        : null;
  const defaultAvatar = avatarUrl === null ? null : DEFAULT_AVATAR_URL.test(avatarUrl);
  if (defaultAvatar !== null) {
    tally.avatarMeasured += 1;
    if (defaultAvatar) tally.defaultAvatar += 1;
  }

  const bio = typeof record.description === "string" ? record.description : null;
  const emptyBio = bio === null ? null : bio.trim() === "";
  if (emptyBio !== null) {
    tally.bioMeasured += 1;
    if (emptyBio) tally.emptyBio += 1;
  }

  // The pair counts only where BOTH fields came back: half an answer is not an
  // empty profile.
  if (defaultAvatar !== null && emptyBio !== null) {
    tally.starterMeasured += 1;
    if (defaultAvatar && emptyBio) tally.starterAccounts += 1;
  }

  const followers = audienceNumber(record, "followers", "followersCount", "followers_count");
  // `following` is a COUNT on a user row but a BOOLEAN on relationship payloads;
  // audienceNumber ignores the boolean and falls through to the next spelling.
  const following = audienceNumber(record, "following", "followingCount", "following_count", "friends_count");
  if (followers !== null && following !== null) {
    tally.ratioMeasured += 1;
    if (followers === 0 && following === 0) tally.balanced += 1; // an account at zero on both sides leans neither way
    else if (followers >= following * AUDIENCE_RATIO_DOMINANCE) tally.followerHeavy += 1;
    else if (following >= followers * AUDIENCE_RATIO_DOMINANCE) tally.followingHeavy += 1;
    else tally.balanced += 1;
  }
}

export function sealAudienceSample(tally: AudienceTally, sampleIsComplete: boolean): AudienceSample | undefined {
  // No row read means nothing to say. An all-zero sample here would read as a
  // measured zero, which is exactly the assertion we are not entitled to make.
  if (tally.profilesExamined <= 0) return undefined;
  let largestMonth: { month: string; accounts: number } | undefined;
  for (const [month, accounts] of tally.creationMonths) {
    // A tie keeps the first month encountered: arbitrary but stable, and it is
    // the size of the cohort that carries the signal, not which month won.
    if (!largestMonth || accounts > largestMonth.accounts) largestMonth = { month, accounts };
  }
  return {
    profilesExamined: tally.profilesExamined,
    sampleIsComplete,
    creation: { measured: tally.creationMeasured, ...(largestMonth ? { largestMonth } : {}) },
    posts: { measured: tally.postsMeasured, zeroPosts: tally.zeroPosts },
    avatar: { measured: tally.avatarMeasured, defaultAvatar: tally.defaultAvatar },
    bio: { measured: tally.bioMeasured, empty: tally.emptyBio },
    starterProfile: { measured: tally.starterMeasured, accounts: tally.starterAccounts },
    followRatio: {
      measured: tally.ratioMeasured,
      followingHeavy: tally.followingHeavy,
      balanced: tally.balanced,
      followerHeavy: tally.followerHeavy,
    },
  };
}

const audienceShare = (part: number, whole: number): string =>
  `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;

/** One sentence over the sample, wording the denominators out loud. The shape
 *  speaks; this never names the account a bot farm or a buyer. */
export function describeAudienceSample(sample?: AudienceSample): string {
  if (!sample) return "No follower profiles were read on this path, so audience shape is not measured.";
  const profiles = `${sample.profilesExamined} follower profile${sample.profilesExamined === 1 ? "" : "s"}`;
  // A percentage of a handful is an invented number. Under the floor we say the
  // sample is thin and stop, rather than dressing 3 accounts up as 30%.
  if (sample.profilesExamined < AUDIENCE_SAMPLE_MIN) {
    return `Read ${profiles}, too thin to describe an audience shape, so no share is reported.`;
  }
  const parts: string[] = [];
  const thin: string[] = [];
  if (sample.posts.measured >= AUDIENCE_SAMPLE_MIN) {
    parts.push(`${audienceShare(sample.posts.zeroPosts, sample.posts.measured)} had never posted`);
  } else thin.push("post counts");
  if (sample.starterProfile.measured >= AUDIENCE_SAMPLE_MIN) {
    parts.push(`${audienceShare(sample.starterProfile.accounts, sample.starterProfile.measured)} carried a default avatar over an empty bio`);
  } else thin.push("avatar and bio");
  if (sample.creation.measured >= AUDIENCE_SAMPLE_MIN && sample.creation.largestMonth) {
    parts.push(`the largest single creation cohort was ${sample.creation.largestMonth.month}, ${audienceShare(sample.creation.largestMonth.accounts, sample.creation.measured)} of the rows carrying a creation date`);
  } else thin.push("creation dates");
  if (sample.followRatio.measured >= AUDIENCE_SAMPLE_MIN) {
    const ratio = sample.followRatio;
    parts.push(`across ${ratio.measured} rows carrying both follow counts, ${ratio.followingHeavy} follow at least ${AUDIENCE_RATIO_DOMINANCE}x more accounts than follow them, ${ratio.balanced} sit in between, and ${ratio.followerHeavy} are followed by at least ${AUDIENCE_RATIO_DOMINANCE}x more than they follow`);
  } else thin.push("follow counts");
  // An interrupted pass is not a random draw: the provider pages newest first,
  // so the rows in hand skew to the most recently gained followers, which are
  // also the newest ACCOUNTS. Saying "floor" alone would hide that skew.
  const basis = sample.sampleIsComplete
    ? `all ${profiles}`
    : `${profiles}, a floor: pagination stopped before the follower list ran out, and the rows read are the most recently gained followers rather than a random draw`;
  const shape = parts.length
    ? `${parts.join("; ")}.`
    : "no dimension came back for enough of the sample to describe.";
  const gap = thin.length
    ? ` The provider returned ${thin.join(", ")} for too little of the sample, so ${thin.length === 1 ? "that dimension stays" : "those dimensions stay"} unmeasured.`
    : "";
  return `Audience shape across ${basis}: ${shape} This describes the profiles read, not the account's full follower count, and a shape like this is never proof that a follower was bought.${gap}`;
}

// AUTO-GROW: every person ARGUS has audited and PASSed is a verified-legit account
// — a real founder / fund / KOL whose follow is a credibility signal. Fold them
// into the reference set so it compounds past the hand-curated core (toward 1000+)
// accurately and stays current, without hand-typing. These rows are tenant-owned:
// never read them without an explicit organization boundary, and do not put the
// combined result in the shared provider cache.
export async function dynamicNotable(organizationId?: string): Promise<{ handle: string; label: string }[]> {
  const org = organizationId?.trim();
  if (!org) return [];
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return [];
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/reports?select=ref,score&organization_id=eq.${encodeURIComponent(org)}&kind=eq.person&verdict=eq.PASS&order=score.desc&limit=600`, {
      headers: { apikey: key, ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const rows = (await r.json()) as { ref: string; score: number }[];
    const accts = rows
      .filter((x) => x && typeof x.ref === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(x.ref))
      .map((x) => ({ handle: x.ref.replace(/^@/, ""), label: "ARGUS-verified" }));
    return accts;
  } catch { return []; }
}

export async function notableFollowers(subject: string, opts?: { followerCount?: number; budgetMs?: number; organizationId?: string }): Promise<NotableScan> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return { list: [], checked: 0, coverage: "unavailable" };
  const subj = subject.replace(/^@/, "").toLowerCase();
  // Dedup the combined reference set: the hand-curated core FIRST (so its richer
  // labels win), then the auto-grown ARGUS-verified accounts.
  const seen = new Set<string>();
  const candidates = [...NOTABLE_ACCOUNTS, ...(await dynamicNotable(opts?.organizationId))].filter((n) => {
    const lk = n.handle.toLowerCase();
    if (lk === subj || seen.has(lk)) return false;
    seen.add(lk); return true;
  });
  const total = candidates.length;

  // Wall-clock guard shared by BOTH paths below: free-tier 429 backoff can drag
  // every page or chunk out, and an unbounded pass (up to 152 sequential page
  // fetches on the enumerate path) can sink the whole serverless budget, killing
  // the ENTIRE audit at maxDuration with no result saved. The deadline makes
  // this pass always return (partial, honestly counted) instead.
  const deadline = Date.now() + (opts?.budgetMs ?? 45_000);

  // Enumerate only when it FULLY covers the subject's followers AND is cheaper than
  // reverse-checking (capped at 150 pages / ~30k followers for audit-time safety).
  const fc = opts?.followerCount ?? Infinity;
  const enumPages = Math.ceil(fc / 200);
  if (Number.isFinite(fc) && enumPages <= Math.min(total, 150)) {
    const set = new Map(candidates.map((n) => [n.handle.toLowerCase(), n]));
    const hits: NotableFollower[] = [];
    const got = new Set<string>();
    const audience = newAudienceTally();
    const u = subject.replace(/^@/, "");
    let cursor = "";
    let observedFollowers = 0;
    let observedPage = false;
    let coverageComplete = false;
    for (let page = 0; page < enumPages + 2; page++) {
      if (Date.now() > deadline) break; // out of budget: keep the observed hits, coverage stays partial
      const url = `${TWITTERAPI}/twitter/user/followers?userName=${encodeURIComponent(u)}&pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await twFetch(url, key);
      if (!res || !res.ok) break;
      let d: JsonRecord;
      try {
        d = asRecord(await res.json());
      } catch {
        break;
      }
      if (twitterProviderFailure(d)) break;
      const nested = asRecord(d.data);
      const followerValue = Array.isArray(d.followers)
        ? d.followers
        : Array.isArray(nested.followers)
          ? nested.followers
          : null;
      // A 200 without an explicit follower array is schema drift, not proof that
      // none of the reference accounts follows the subject.
      if (!followerValue) break;
      const followers = followerValue;
      observedPage = true;
      observedFollowers += followers.length;
      for (const follower of followers) {
        const f = asRecord(follower);
        // The whole row was paid for whether or not it matches the reference
        // set, so read its shape before dropping everything but the handle.
        tallyAudienceRow(audience, follower);
        const h = String(f.userName ?? f.screen_name ?? "").toLowerCase();
        const m = set.get(h);
        if (m && !got.has(h)) { got.add(h); hits.push({ handle: m.handle, label: m.label, size: "" }); }
      }
      const hasNextPage = typeof d.has_next_page === "boolean"
        ? d.has_next_page
        : typeof nested.has_next_page === "boolean"
          ? nested.has_next_page
          : undefined;
      const nextCursorValue = d.next_cursor ?? nested.next_cursor;
      const nextCursor = typeof nextCursorValue === "string" ? nextCursorValue : "";
      if (hasNextPage === false || (hasNextPage === undefined && observedFollowers >= fc)) {
        coverageComplete = true;
        break;
      }
      if (!hasNextPage || !nextCursor) break;
      cursor = nextCursor;
    }
    // Enumeration can assert a negative only after every page completed. On a
    // partial run, the positive matches are still observed facts, but every
    // unobserved candidate remains unknown.
    return {
      list: hits,
      checked: coverageComplete ? total : hits.length,
      coverage: coverageComplete ? "complete" : observedPage ? "partial" : "unavailable",
      // The sample is complete only when pagination finished; an interrupted
      // pass reports the rows it read as a floor, never as the audience.
      audience: sealAudienceSample(audience, coverageComplete),
    };
  }

  // Large / unknown-size subject: reverse-check the reference set (one call each).
  // Cap the calls to bound per-audit cost — the hand-curated core comes first, so
  // the cap keeps the highest-signal accounts. (The enumerate path above has no
  // such cap: matching the FULL set in-memory is free, so small subjects get 100%.)
  const REVERSE_CAP = 500;
  const toCheck = candidates.slice(0, REVERSE_CAP);
  const hits: NotableFollower[] = [];
  const CHUNK = 15;
  let checked = 0;
  for (let i = 0; i < toCheck.length; i += CHUNK) {
    if (Date.now() > deadline) break; // out of time — return what we have, core-first
    const slice = toCheck.slice(i, i + CHUNK);
    const res = await Promise.all(
      slice.map(async (n) => {
        const rel = await checkFollow(n.handle, subject); // does the notable account follow the subject?
        return { notable: n, rel };
      }),
    );
    let observedInChunk = 0;
    for (const { notable, rel } of res) {
      if (!rel || rel.following === null) continue;
      observedInChunk += 1;
      checked += 1;
      if (rel.following) hits.push({ handle: notable.handle, label: notable.label, size: "" });
    }
    // A whole unavailable chunk is an endpoint-level failure signal. Stop the
    // audit-wide fan-out instead of spending the remaining budget repeating it.
    if (observedInChunk === 0) break;
  }
  return {
    list: hits,
    checked,
    coverage: toCheck.length === total && checked === toCheck.length && toCheck.length > 0
      ? "complete"
      : checked > 0
        ? "partial"
        : "unavailable",
  };
}

// ── Grok Live Search: did the endorsers publicly acknowledge the subject? ──
// BATCHED: one search call covers every claimed endorser. The old one-call-per-
// endorser version was the single biggest Grok spend in an audit (up to 6
// uncapped live-search calls); one batched call does the same verification.
export interface AckResult {
  ack: "none" | "mention" | "thanks" | "endorsement";
  sentiment: "positive" | "neutral" | "negative" | "none";
  source_url?: string;
}
const ACK_POSITIVE = /\b(?:great|amazing|excited|proud|congrats|congratulations|grateful|honored|honoured|bullish|legend|brilliant|incredible|impressive|welcome)\b/i;
const ACK_NEGATIVE = /\b(?:scam|rug|fraud|avoid|warning|beware|ponzi|stole|stolen|fake|do not trust|stay away)\b/i;
const ACK_THANKS = /\b(?:thank|thanks|grateful|appreciate)\b/i;
function ackSentiment(text: string): AckResult["sentiment"] {
  if (ACK_NEGATIVE.test(text)) return "negative";
  if (ACK_POSITIVE.test(text)) return "positive";
  return "neutral";
}
function ackType(text: string): AckResult["ack"] {
  if (ACK_THANKS.test(text)) return "thanks";
  if (ACK_POSITIVE.test(text)) return "endorsement";
  return "mention";
}

// twitterapi.io (near-free, ~$0.0002/call) replaces Grok live search here: for
// each claimed endorser, search THEIR posts for a mention of the subject. A hit
// is a LEAD (its post URL) that an independent collector re-verifies; ack and
// sentiment are light heuristic labels only, never a corroboration verdict.
export async function acknowledgments(endorsers: string[], subject: string): Promise<Map<string, AckResult>> {
  const out = new Map<string, AckResult>();
  const key = env("TWITTERAPI_KEY");
  const list = [...new Set(endorsers.map((e) => e.replace(/^@/, "")).filter(Boolean))];
  if (!key || !list.length) return out;
  const s = subject.replace(/^@/, "");
  const sKey = s.toLowerCase();
  await Promise.all(list.map(async (endorser) => {
    const mapKey = endorser.toLowerCase();
    try {
      const tweets = await searchFrom(endorser, [`@${s}`], key);
      const hit = tweets.find((t) => String((t as any)?.text ?? (t as any)?.full_text ?? "").toLowerCase().includes(`@${sKey}`));
      const id = hit ? String((hit as any)?.id ?? (hit as any)?.id_str ?? "") : "";
      const rawUrl = hit && typeof (hit as any)?.url === "string" ? (hit as any).url as string : "";
      const url = /\/status\/\d+/.test(rawUrl) ? rawUrl : id ? `https://x.com/${endorser}/status/${id}` : undefined;
      if (!hit || !url) { out.set(mapKey, { ack: "none", sentiment: "none" }); return; }
      const text = String((hit as any)?.text ?? (hit as any)?.full_text ?? "");
      out.set(mapKey, { ack: ackType(text), sentiment: ackSentiment(text), source_url: url });
    } catch {
      out.set(mapKey, { ack: "none", sentiment: "none" });
    }
  }));
  return out;
}

// ── Grok identity discovery: every venture/affiliation the subject is publicly
//    tied to, not just the ones they founded. Many people's real history lives
//    OFF their X and OFF their LinkedIn (early-employee/contributor roles, press,
//    accelerator pages, GitHub). A founder-only grammar misses all of it, so we
//    ask for the full affiliation set: founded, led, worked at, contributed to,
//    or otherwise publicly tied. Strictly grounded: only ties with a real, cited
//    source, never guesses. We also capture the venture's own X handle + domain
//    so the orchestrator can corroborate the tie (follow-graph, archived team page).
export interface DiscoveredAffiliation {
  name: string;
  role: string;          // founder | cofounder | exec | employee | engineer | contributor | advisor | affiliate
  year?: string;
  evidence?: string;     // one short source phrase
  x_handle?: string;     // the VENTURE's X account, if found (e.g. @deksxyz)
  domain?: string;       // the venture's website host, if found (e.g. deks.xyz)
}

// Covers BOTH discovery angles in one search call (was two): what the person
// says/shows they did, AND who has ever publicly NAMED them as theirs (team
// announcements on the PROJECT's timeline — often old posts the subject never
// retweeted). One call halves the live-search spend of the intake phase.
export async function discoverAffiliations(handle: string, name?: string, oldHandles: string[] = []): Promise<DiscoveredAffiliation[]> {
  const h = handle.replace(/^@/, "");
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")}. Search posts mentioning those old handles too.` : "";
  const system =
    "You are a forensic due-diligence researcher with live web and X search. Find EVERY company, crypto project, fund, DAO, or venture that THIS SPECIFIC person (the holder of the given X account) is publicly tied to in ANY working capacity: founded, co-founded, led, was an early employee of, worked at, contributed to, was a core team member of, or advised. " +
    "Work BOTH angles: (1) what the person's own footprint shows, including accelerator/portfolio pages, press, team pages, GitHub orgs, podcasts, and Crunchbase beyond their bio and LinkedIn; (2) reverse mentions from project/company accounts that ever NAMED, TAGGED, or ANNOUNCED this person as a founder/team member (co-founder announcements and 'meet the team' posts are often YEARS old, on the project's timeline, so search historical posts). There MUST be public evidence tying THAT EXACT person to the venture. " +
    "For each, also report the venture's own X handle and website domain if you can find them. " +
    "Reply with ONLY compact JSON: {\"affiliations\":[{\"name\":\"\",\"role\":\"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate\",\"year\":\"\",\"evidence\":\"one short source phrase\",\"x_handle\":\"@...\",\"domain\":\"example.com\"}]}. " +
    "Include ONLY affiliations you found real, attributable evidence for. If you cannot confidently tie a venture to THIS person, omit it. If you find nothing, return {\"affiliations\":[]}. NEVER invent, guess, or include a venture just because the name is common. Never use em dashes.";
  const text = await generalWebSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Find every company or project they have founded, led, worked at, contributed to, or advised, however small the role. Use their own footprint AND project accounts announcing them. Prioritize the ventures they are best known for; a few well-sourced ventures are worth more than an exhaustive list. Search the web and X including historical posts.`, { maxToolCalls: 4, cacheKey: `affil:${h}:${oldHandles.join(",")}` });
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const out: DiscoveredAffiliation[] = Array.isArray(parsed.affiliations)
      ? parsed.affiliations
      : Array.isArray(parsed.ventures) // tolerate the old key
        ? parsed.ventures
        : [];
    return out
      .filter((v) => v && typeof v.name === "string" && v.name.trim())
      .map((v) => ({
        name: v.name.trim(),
        role: v.role || "affiliate",
        year: v.year,
        evidence: v.evidence,
        x_handle: v.x_handle && /^@?[A-Za-z0-9_]{2,30}$/.test(v.x_handle) ? "@" + v.x_handle.replace(/^@/, "") : undefined,
        domain: v.domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.domain) ? v.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
      }))
      .slice(0, 10);
  } catch {
    return [];
  }
}


// ── Team extraction from X content ──
// The people behind a project are usually NAMED in the project account's own
// posts (team intros, "meet the team", role announcements like "welcome @x as
// our CTO") and in posts that tag them, long before any of it reaches a website.
// This mines that content for team members the site/bio never listed.
export interface TeamMember { name: string; handle?: string; role: string; evidence?: string; kind: "team" | "advisor"; linkedin?: string; source?: string; sourceUrl?: string; projects?: { name: string; role?: string }[] }

export async function findTeam(
  handle: string,
  name: string | undefined,
  posts: string[] = [],
  purchasedTeamSignalPosts?: string[],
): Promise<TeamMember[]> {
  const h = handle.replace(/^@/, "");
  const key = env("TWITTERAPI_KEY");
  // Gather the project's own team-signal posts from twitterapi (near-free,
  // ~$0.0002/call) rather than Grok x_search; Claude then extracts the roster
  // from them and web-searches each person's other ventures.
  let corpus = [...new Set([
    ...posts.slice(0, 15),
    ...(purchasedTeamSignalPosts ?? []),
  ])].slice(0, 30);
  if (key && purchasedTeamSignalPosts === undefined) {
    try {
      const teamPosts = await searchFrom(h, KW_IDENTITY, key);
      const extra = teamPosts.map((t) => String((t as any)?.text ?? (t as any)?.full_text ?? "")).filter(Boolean);
      corpus = [...new Set([...corpus, ...extra])].slice(0, 30);
    } catch { /* twitterapi unavailable -> extract from the provided posts only */ }
  }
  const postContext = corpus.length
    ? `\n\nThe project account's own posts (mine these for team intros / role + advisor announcements):\n${corpus.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";
  const system =
    "You are a forensic researcher with live web search, given a crypto/tech project's own X posts below. Identify the PEOPLE publicly tied to the project: founders, cofounders, core team, engineers, AND advisors/backers. " +
    "Search the exact X handle together with founder, co-founder, builder, creator, and built by. Inspect the official site's homepage and footer plus attributable podcasts, interviews, and ecosystem press; crypto builders are often disclosed there instead of on a formal team page. " +
    "Read the provided posts (team intros, 'welcome @x as our CTO', 'our founder @y', 'advised by @z', 'backed by @w') to see who is named, then web-search to confirm each person and their role here. " +
    "Be PRECISE about each person's role AT THIS project: only call someone an advisor if they are actually named as one; if they are a founder/cofounder, say so. Do NOT downgrade a founder to advisor. " +
    "For EACH person also list their OTHER notable projects or companies (name + their role there, e.g. founder/cofounder/advisor/engineer) that web search reveals. This exposes serial founders and cross-project ties. " +
    "Include ONLY people with real public evidence tying them to THIS project. EXCLUDE the project account itself, generic shillers, hype repliers, and unrelated mentions. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"founder|cofounder|ceo|cto|engineer|advisor|backer\",\"kind\":\"team|advisor\",\"evidence\":\"\",\"projects\":[{\"name\":\"\",\"role\":\"\"}]}]}. If none, return {\"people\":[]}. NEVER invent. Never use em dashes.";
  const text = await generalWebSearch(system, `Project X account: @${h}${name && name !== h ? ` (${name})` : ""}. Who are the founders, builders, team members, and advisors of this exact project? Search the exact handle and inspect official-site \"built by\" attribution, founder interviews, podcasts, and ecosystem press. Give each person's precise role here AND their other projects.${postContext}`, { cacheKey: `team-x-v2:${h}` });
  return parseTeamJSON(text, h, "X content");
}

// The team page lives on the WEBSITE, not in the tweets. This runs the same
// web/LinkedIn/Crunchbase search the Site-recon team finder uses, but from inside
// a handle audit — pointed at the project's own domain (from its X bio link). It
// is what surfaces named people (with LinkedIn) an X-post scan never sees.
export async function findTeamOnSite(domain: string, projectName?: string): Promise<TeamMember[]> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean && !projectName) return [];
  const anchor = clean ? `website ${clean}${projectName ? ` (${projectName})` : ""}` : `project "${projectName}"`;
  const system =
    "You are a forensic OSINT researcher with live web and X search. Find EVERY real person behind the crypto/tech project: founders, cofounders, the WHOLE leadership team (CEO/CTO/COO/CFO/CMO), engineering and product leads, AND advisors/backers. " +
    "DIG hard and be COMPLETE: inspect the official homepage and footer for founder, builder, creator, and 'built by' attribution; Google the exact domain and X handle with 'team'/'leadership'/'about'/'founder'; open the project's LinkedIn company page and read its 'People' tab (list the employees it shows); and check Crunchbase people, the GitHub org's members, podcasts/interviews/press, and X. For an established project expect to name SEVERAL people. Do NOT stop at one or two; keep going until you have the full public roster you can verify. " +
    "Connect each name to their X handle and LinkedIn where possible. " +
    "Include ONLY real people genuinely tied to THIS specific project (match the domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts and generic mentions. " +
    "Be PRECISE about each person's role AT THIS project: only call someone an advisor if the project actually names them as one; if the site/LinkedIn shows them as a founder/cofounder/CEO, use THAT. Do NOT downgrade a founder to advisor. " +
    "For EACH person, also list their OTHER notable projects/companies (name + their role there) that web/LinkedIn/Crunchbase reveal. This exposes serial founders and cross-project ties. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"\",\"kind\":\"team|advisor\",\"evidence\":\"\",\"projects\":[{\"name\":\"\",\"role\":\"\"}]}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const text = await generalWebSearch(system, `Crypto/tech ${anchor}. Find the COMPLETE public team: every founder, builder, executive, core team member, and advisor behind it. Inspect the official homepage/footer for \"built by\", then read founder interviews, podcasts, its LinkedIn company People tab, Crunchbase, GitHub org, and press. Connect each to their X handle and LinkedIn, give each person's PRECISE role here, AND list their other projects. Name as many verifiable people as you can, not just the most famous one.`, { cacheKey: `team-site-v2:${clean || projectName}` });
  return parseTeamJSON(text, undefined, clean ? "web/LinkedIn search" : "web/LinkedIn (by name)");
}

// Batched identity resolution for name-only team members: the project's own team
// page names people without linking anything, but public figures (a fund's
// cofounder, a protocol's CTO) have easily findable X handles + LinkedIn. One
// Grok pass resolves the whole batch.
export async function enrichTeamIdentities(
  project: string,
  people: { name: string; role?: string }[],
): Promise<{ name: string; handle?: string; linkedin?: string }[]> {
  if (!people.length) return [];
  const system =
    "You are an OSINT researcher with live web and X search. For each named team member of the given project, find their X (Twitter) handle and LinkedIn profile. " +
    "Match the RIGHT person: same name + same project/role (check bios, the project's follows, press). If you cannot confidently match one, omit that field rather than guess. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\"}]}. Provide one entry per input name, with fields omitted when unknown. NEVER invent. Never use em dashes.";
  const list = people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join("; ");
  const text = await generalWebSearch(system, `Project: ${project}. Team members to resolve: ${list}. Find each person's X handle and LinkedIn.`, { cacheKey: `enrich:${project}:${people.map((p) => p.name).sort().join("|")}` });
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const arr: any[] = JSON.parse(m[0]).people ?? [];
    return arr
      .filter((p) => p && typeof p.name === "string" && p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        handle: typeof p.handle === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(p.handle.replace(/^@/, "")) ? "@" + p.handle.replace(/^@/, "") : undefined,
        linkedin: typeof p.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined,
      }));
  } catch {
    return [];
  }
}

// Deterministic supplement: scan the account's OWN posts for role words (founder,
// CEO, CTO, "our dev", advisor...) and the name or @handle sitting next to them.
// Catches team the LLM search misses, straight from the project's own language.
const ROLE_SOURCE = "co-?founders?|founders?|ceo|cto|coo|cfo|cmo|chief\\s+\\w+\\s+officer|lead\\s+(?:dev|developer|engineer)|core\\s+(?:dev|team)|head\\s+of\\s+\\w+|advisors?|team\\s+members?|our\\s+(?:founder|ceo|cto|coo|team|dev|lead)";
const regexEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A handle binds to a role only across an appositive connector ("@x, our CEO";
// "our CTO @x"). Any other word between them ("thanks @x for having our CEO
// on the show") means the handle is a bystander: the role is project-owned
// but the handle is not its holder, so the bind is rejected.
const BEFORE_ROLE_CONNECTORS = new Set(["is", "was", "as", "the", "a", "an", "our", "own", "core", "now", "currently", "serves", "joins", "named", "appointed"]);
const AFTER_ROLE_CONNECTORS = new Set(["is", "was", "the", "a", "an", "our", "own", "core", "aka"]);
const connectorAllowed = (gap: string, allowed: Set<string>): boolean =>
  (gap.toLowerCase().match(/[a-z']+/g) ?? []).every((word) => allowed.has(word));

/**
 * OPERATOR ATTRIBUTION: who actually runs this project account?
 *
 * A project/token account's FOLLOWING list is small and deliberate (a fresh
 * launchpad account often follows only its own dev), and builders routinely
 * state the affiliation in their own bio ("Building @linkrbot"). Neither
 * signal is a model guess: the project account vouches by following, and the
 * person claims the project in first-party profile text. Crossing them
 * resolves the operator deterministically for exactly the accounts where a
 * team page, press coverage and a CoinGecko listing all do not exist yet.
 *
 * Bounded by design: at most MAX_FOLLOWING_PAGES pages, and a candidate is
 * only returned when their bio names THIS subject next to a builder verb.
 */
const OPERATOR_VERB = "building|builder|build|dev(?:eloper)?|developing|creator|created|creating|founder|co-?founder|behind|maker|making|shipping|ships|working\\s+on|work\\s+on|author\\s+of|team\\s+behind";
const MAX_FOLLOWING_PAGES = 2;
const FOLLOWING_PAGE_SIZE = 100;

/** Bio text that claims the subject, with the matched phrase for evidence. */
export function operatorClaimInBio(
  bio: string,
  subjectHandle: string,
  subjectName?: string,
): { role: string; phrase: string } | null {
  const text = String(bio ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const handle = subjectHandle.replace(/^@/, "");
  if (!handle) return null;
  // The subject may be named by @handle or by a distinctive display name; a
  // very short name (<=3 chars) is too collision-prone to accept alone.
  const names = [regexEscape(handle)];
  const trimmedName = subjectName?.trim();
  if (trimmedName && trimmedName.length > 3 && trimmedName.toLowerCase() !== handle.toLowerCase()) {
    names.push(regexEscape(trimmedName));
  }
  const subject = `(?:@?(?:${names.join("|")}))`;
  // Verb before the subject ("building @x") or after it ("@x dev").
  const before = new RegExp(`\\b(${OPERATOR_VERB})\\b[^@|,.\\n]{0,24}${subject}\\b`, "i");
  const after = new RegExp(`${subject}\\b[^@|,.\\n]{0,16}\\b(${OPERATOR_VERB})\\b`, "i");
  const match = text.match(before) ?? text.match(after);
  if (!match) return null;
  const verb = (match[1] ?? "").toLowerCase();
  const role = /founder/.test(verb)
    ? verb.replace(/\s+/g, " ")
    : /creator|created|creating|maker|making/.test(verb)
      ? "creator"
      : /dev/.test(verb)
        ? "developer"
        : "operator";
  return { role, phrase: match[0].trim().slice(0, 160) };
}

/** Other @projects the same bio claims, for the serial-launcher venture graph. */
function otherProjectsInBio(bio: string, subjectHandle: string): { name: string }[] {
  const handle = subjectHandle.replace(/^@/, "").toLowerCase();
  const out: { name: string }[] = [];
  const seen = new Set<string>();
  for (const match of String(bio ?? "").matchAll(/@([A-Za-z0-9_]{2,30})/g)) {
    const other = match[1].toLowerCase();
    if (other === handle || seen.has(other)) continue;
    seen.add(other);
    out.push({ name: `@${match[1]}` });
  }
  return out.slice(0, 6);
}

/**
 * Accounts the subject follows whose own bio claims they build the subject.
 * Returns [] (never throws) when twitterapi is unset or the account follows
 * too many accounts to scan within the bounded page budget.
 */
export async function discoverOperatorsFromFollowings(
  subjectHandle: string,
  subjectName?: string,
): Promise<TeamMember[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const handle = subjectHandle.replace(/^@/, "");
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < MAX_FOLLOWING_PAGES; page += 1) {
    const url = `${TWITTERAPI}/twitter/user/followings?userName=${encodeURIComponent(handle)}`
      + `&pageSize=${FOLLOWING_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await twFetch(url, key);
    if (!res || !res.ok) break;
    let payload: Record<string, unknown>;
    try {
      payload = asRecord(await res.json()) ?? {};
    } catch {
      break;
    }
    const rows = (payload.followings ?? payload.users ?? payload.data) as unknown;
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      const person = asRecord(row);
      if (!person) continue;
      const userName = typeof person.userName === "string" ? person.userName : typeof person.screen_name === "string" ? person.screen_name : "";
      const bio = typeof person.description === "string" ? person.description : "";
      if (!userName || seen.has(userName.toLowerCase())) continue;
      seen.add(userName.toLowerCase());
      const claim = operatorClaimInBio(bio, handle, subjectName);
      if (!claim) continue;
      out.push({
        name: typeof person.name === "string" && person.name.trim() ? person.name.trim() : `@${userName}`,
        handle: `@${userName}`,
        role: claim.role,
        kind: "team",
        evidence: `the official account follows @${userName}, whose own X bio states "${claim.phrase}"`,
        source: "operator attribution (followings + bio claim)",
        sourceUrl: `https://x.com/${userName}`,
        projects: otherProjectsInBio(bio, handle),
      });
    }
    const next = typeof payload.next_cursor === "string" ? payload.next_cursor
      : typeof payload.nextCursor === "string" ? payload.nextCursor : "";
    const hasNext = payload.has_next_page === true || payload.hasNextPage === true;
    if (!next || !hasNext || !list.length) break;
    cursor = next;
  }
  return out.slice(0, 6);
}

/**
 * AMPLIFIED-ACCOUNT ATTRIBUTION: the followings scan's sibling for the other
 * first-party edge a project account draws itself. A project account that
 * retweets or quote-posts its founder has vouched for them exactly as loudly
 * as by following them — and founders routinely state the role in their own
 * bio ("Founder @clutchmarkets"). The followings lane misses this whenever the
 * follow edge is absent or beyond its bounded page budget; the timeline page
 * is already fetched (and memoized) for every audit, so the amplified authors
 * are free to read. Crossing them with each author's own bio claim resolves
 * the operator with two first-party signals, same doctrine as the follow lane.
 */
interface AmplifiedAuthor { handle: string; name?: string; bio?: string }

/** Distinct authors this timeline page retweets or quote-posts, with their
 *  embedded profile bio when the provider ships one. Pure, for testability. */
export function amplifiedAuthorsFromTimeline(payload: unknown, subjectHandle: string): AmplifiedAuthor[] {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data);
  const rows = (data?.tweets ?? root.tweets ?? (Array.isArray(root.data) ? root.data : [])) as unknown;
  const subject = subjectHandle.replace(/^@/, "").toLowerCase();
  const out: AmplifiedAuthor[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tweet = asRecord(row);
    for (const key of ["retweeted_tweet", "retweeted_status", "quoted_tweet", "quoted_status"]) {
      const inner = asRecord(tweet[key]);
      // asRecord maps non-records to {}, so pick whichever shape has content.
      const authorRec = asRecord(inner.author);
      const author = Object.keys(authorRec).length ? authorRec : asRecord(inner.user);
      const userName = typeof author.userName === "string" ? author.userName
        : typeof author.screen_name === "string" ? author.screen_name : "";
      if (!userName || userName.toLowerCase() === subject || seen.has(userName.toLowerCase())) continue;
      seen.add(userName.toLowerCase());
      out.push({
        handle: userName,
        name: typeof author.name === "string" && author.name.trim() ? author.name.trim() : undefined,
        bio: typeof author.description === "string" ? author.description : undefined,
      });
    }
  }
  return out.slice(0, 12);
}

/**
 * Accounts the subject's own timeline amplifies (retweets/quote-posts) whose
 * own bio claims they run the subject. Returns [] (never throws) when
 * twitterapi is unset or the timeline is unavailable. Authors whose bio the
 * timeline payload does not embed get one bounded profile fetch each.
 */
const MAX_AMPLIFIED_PROFILE_FETCHES = 8;
export async function discoverOperatorsFromAmplified(
  subjectHandle: string,
  subjectName?: string,
): Promise<TeamMember[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const handle = subjectHandle.replace(/^@/, "");
  const page = await lastTweetsFirstPage(handle, key);
  if (!page) return [];
  const authors = amplifiedAuthorsFromTimeline(page, handle);
  const out: TeamMember[] = [];
  let fetches = 0;
  for (const author of authors) {
    let bio = author.bio;
    let name = author.name;
    if (bio === undefined && fetches < MAX_AMPLIFIED_PROFILE_FETCHES) {
      fetches += 1;
      const profile = await getProfile(author.handle);
      bio = profile?.bio ?? "";
      name = name ?? profile?.name;
    }
    if (!bio) continue;
    const claim = operatorClaimInBio(bio, handle, subjectName);
    if (!claim) continue;
    out.push({
      name: name?.trim() || `@${author.handle}`,
      handle: `@${author.handle}`,
      role: claim.role,
      kind: "team",
      evidence: `the official account retweeted/quoted @${author.handle}, whose own X bio states "${claim.phrase}"`,
      source: "operator attribution (amplified + bio claim)",
      sourceUrl: `https://x.com/${author.handle}`,
      projects: otherProjectsInBio(bio, handle),
    });
  }
  return out.slice(0, 6);
}

/**
 * REVERSE ROLE-PHRASE SEARCH: instead of asking who the project names, ask who
 * the public record says LEADS the project. People state this in exactly a few
 * phrasings — "founder of @y", "cofounder of @y", "CEO at @y", "@y team" — in
 * X bios, posts, press, and the answers AI search surfaces. A project audit
 * that only mines the subject's own surfaces misses the founder whose bio
 * carries the claim (the Clutch Markets case: @OxSimpleFarmer's bio said
 * "Founder @clutchmarkets" while the project account itself named no one).
 * Results are model leads; confirmClaimantBios below upgrades the ones whose
 * live first-party bio really carries the claim.
 */
export async function findRoleClaimants(
  subjectHandle: string,
  subjectName?: string,
  domain?: string,
): Promise<TeamMember[]> {
  const h = subjectHandle.replace(/^@/, "");
  const nameVariant = subjectName?.trim() && subjectName.trim().toLowerCase() !== h.toLowerCase()
    ? subjectName.trim()
    : "";
  const domainVariant = domain?.trim() ? domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";
  const queries = [
    `"founder of @${h}"`, `"cofounder of @${h}"`, `"co-founder of @${h}"`,
    `"CEO of @${h}"`, `"CEO at @${h}"`, `"@${h} team"`, `"Founder @${h}"`,
    ...(nameVariant ? [`"founder of ${nameVariant}"`, `"${nameVariant} founder"`, `"${nameVariant} team"`] : []),
    ...(domainVariant ? [`"founder of ${domainVariant}"`] : []),
  ];
  const system =
    "You are a forensic OSINT researcher with live web and X search. The subject is a crypto/tech project's X account. Find the PEOPLE the public record credits with leading it: founders, cofounders, CEO/CTO/COO, core team. " +
    "Work the REVERSE direction: run the exact quoted searches given below on X AND on the general web (Google-style), and read what AI-answer search summaries say about who founded the project. " +
    "Pay special attention to X BIOS: accounts whose own bio contains phrases like 'Founder @project' are first-party role claims. Also check the project site's credits (footers often say 'Built by X'), press, and LinkedIn. " +
    "Include ONLY people with a real, quotable public claim tying them to THIS exact project (match the handle/name/domain; never a same-named project). For each person quote the claim VERBATIM in evidence and say where it lives (X bio, post URL, page). " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"founder|cofounder|ceo|cto|team\",\"kind\":\"team\",\"evidence\":\"\"}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const text = await generalWebSearch(
    system,
    `Project X account: @${h}${nameVariant ? ` (${nameVariant})` : ""}${domainVariant ? `, website ${domainVariant}` : ""}. Who does the public record say founded or leads it? Run these exact searches on X and the web, then verify each hit: ${queries.join(", ")}.`,
    { maxToolCalls: 6, cacheKey: `reverse-role:${h}` },
  );
  return parseTeamJSON(text, h, "reverse role-phrase search");
}

/**
 * Live first-party confirmation for reverse-search leads: fetch each named
 * handle's CURRENT bio and keep only claims the bio really carries. The
 * returned map (normalized handle -> claim) lets the orchestrator quote the
 * fetched artifact as evidence instead of a model summary. Bounded: at most
 * `cap` profile fetches, never throws.
 */
export async function confirmClaimantBios(
  candidates: readonly TeamMember[],
  subjectHandle: string,
  subjectName?: string,
  cap = 5,
): Promise<Map<string, { role: string; phrase: string }>> {
  const subject = subjectHandle.replace(/^@/, "");
  const confirmed = new Map<string, { role: string; phrase: string }>();
  const handles = [...new Set(
    candidates
      .map((c) => (c.handle ?? "").replace(/^@/, ""))
      .filter((h) => h && h.toLowerCase() !== subject.toLowerCase()),
  )].slice(0, cap);
  for (const h of handles) {
    try {
      const profile = await getProfile(`@${h}`);
      if (!profile?.bio) continue;
      const claim = operatorClaimInBio(profile.bio, subject, subjectName);
      if (claim) confirmed.set(h.toLowerCase(), claim);
    } catch { /* confirmation is best-effort; the lead stays a lead */ }
  }
  return confirmed;
}

export function scanPostsForRoles(posts: string[], projectName?: string): TeamMember[] {
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  const add = (m: TeamMember) => { const k = (m.handle ?? m.name).toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(m); };
  const project = projectName?.trim() ? regexEscape(projectName.trim()) : "";
  const roleIsProjectOwned = (post: string, index: number, length: number, role: string): boolean => {
    const window = post.slice(Math.max(0, index - 56), Math.min(post.length, index + length + 56));
    const r = regexEscape(role).replace(/\\ /g, "\\s+");
    const owner = project ? `(?:our|${project})` : "our";
    return new RegExp(`\\b${owner}\\s+(?:own\\s+|core\\s+)?${r}\\b|\\b${r}\\s+(?:at|for)\\s+${owner}\\b`, "i").test(window);
  };
  for (const raw of posts.slice(0, 80)) {
    const p = String(raw ?? "");
    // Bind a role only to the adjacent handle. The previous scan found one role
    // anywhere in a long post and assigned it to every @mention, which could
    // turn a guest founder or product account into the audited project's team.
    // A model may keep broader candidates as leads; governing evidence requires
    // this narrow, deterministic grammar or a fetched first-party document.
    const before = new RegExp(`@([A-Za-z0-9_]{2,30})[^@\\n.!?]{0,32}\\b(${ROLE_SOURCE})\\b`, "gi");
    for (const match of p.matchAll(before)) {
      const role = match[2].toLowerCase().replace(/^our\s+/, "");
      const gap = match[0].slice(1 + match[1].length, match[0].length - match[2].length);
      if (!connectorAllowed(gap, BEFORE_ROLE_CONNECTORS)) continue;
      if (!roleIsProjectOwned(p, match.index, match[0].length, role)) continue;
      const kind: "team" | "advisor" = /advisor/i.test(role) ? "advisor" : "team";
      add({ name: `@${match[1]}`, handle: `@${match[1]}`, role, kind, evidence: `the official account placed @${match[1]} next to the role "${role}"`, source: "post role-scan" });
    }
    const after = new RegExp(`\\b(${ROLE_SOURCE})\\b(?!\\s+of\\b)[^@\\n.!?]{0,24}@([A-Za-z0-9_]{2,30})`, "gi");
    for (const match of p.matchAll(after)) {
      const role = match[1].toLowerCase().replace(/^our\s+/, "");
      const gap = match[0].slice(match[1].length, match[0].length - match[2].length - 1);
      if (!connectorAllowed(gap, AFTER_ROLE_CONNECTORS)) continue;
      if (!roleIsProjectOwned(p, match.index, match[0].length, role)) continue;
      const kind: "team" | "advisor" = /advisor/i.test(role) ? "advisor" : "team";
      add({ name: `@${match[2]}`, handle: `@${match[2]}`, role, kind, evidence: `the official account placed the role "${role}" next to @${match[2]}`, source: "post role-scan" });
    }
    // Project accounts often identify several people as "members of the team"
    // in one phrase. Capture the bounded handle list immediately before it.
    const roster = new RegExp(`((?:@[A-Za-z0-9_]{2,30}[\\s,]*(?:and\\s+)?){1,4})(?:and\\s+other\\s+)?members?\\s+of\\s+(?:the\\s+)?[^\\n.!?]{0,32}?team\\b`, "gi");
    for (const match of p.matchAll(roster)) {
      const rosterOwner = project ? new RegExp(`members?\\s+of\\s+(?:the\\s+)?(?:our|${project})\\s+team\\b`, "i") : /members?\s+of\s+(?:the\s+)?our\s+team\b/i;
      if (!rosterOwner.test(match[0])) continue;
      for (const handle of match[1].matchAll(/@([A-Za-z0-9_]{2,30})/g)) {
        add({ name: `@${handle[1]}`, handle: `@${handle[1]}`, role: "team member", kind: "team", evidence: `the official account named @${handle[1]} as a project team member`, source: "post role-scan" });
      }
    }
  }
  return out.slice(0, 12);
}

// Shared parser for the team JSON both Grok team-finders return.
function parseTeamJSON(text: string | null, selfHandle: string | undefined, source: string): TeamMember[] {
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const arr: any[] = Array.isArray(parsed.people) ? parsed.people : Array.isArray(parsed.team) ? parsed.team : [];
    const self = (selfHandle ?? "").replace(/^@/, "").toLowerCase();
    return arr
      .filter((t) => t && typeof t.name === "string" && t.name.trim())
      .map((t) => {
        const role = (t.role || "team").toString();
        const kind: "team" | "advisor" = (t.kind === "advisor" || /advisor|advis|backer|mentor/i.test(role)) ? "advisor" : "team";
        const linkedin = typeof t.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(t.linkedin) ? t.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined;
        const projects = Array.isArray(t.projects)
          ? t.projects
              .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
              .map((p: any) => ({ name: p.name.trim().slice(0, 60), role: typeof p.role === "string" && p.role.trim() ? p.role.trim().slice(0, 40) : undefined }))
              .slice(0, 6)
          : undefined;
        return {
          name: t.name.trim(),
          handle: t.handle && /^@?[A-Za-z0-9_]{2,30}$/.test(t.handle) ? "@" + t.handle.replace(/^@/, "") : undefined,
          role, kind, linkedin, evidence: typeof t.evidence === "string" ? t.evidence : undefined, source,
          projects: projects && projects.length ? projects : undefined,
        };
      })
      .filter((t) => !t.handle || t.handle.replace(/^@/, "").toLowerCase() !== self)
      .slice(0, 16);
  } catch {
    return [];
  }
}

// ── Adverse-signal sweep ──
// The playbook's scam/rug/fud search, generalized. Runs over a HANDLE (a founder
// or a project account) and optionally a TICKER, asking Grok to surface only
// real, sourced community/investigator complaints: rug / slow-rug / liquidity
// pull / wallet drains / scam accusations / general FUD. Pressure-testing RECC
// showed the signal often attaches to the founder's TOOL company, not the token,
// so this is called per-handle AND per-project, never only per-ticker.
export type AdverseCategory = "rug" | "slow_rug" | "liquidity_pull" | "drain" | "scam_accusation" | "fud";
export type AdverseRelationshipToSubject = "self" | "venture" | "associate";
export interface AdverseSearchContext {
  relationship_to_subject: AdverseRelationshipToSubject;
  relationship_label?: string;
}
export interface AdverseSignal {
  category: AdverseCategory;
  claim: string;        // model-discovered lead, never a verified fact
  source: string;       // the single source the model says should be checked
  source_url?: string;
  /** Canonical entity the adverse claim actually names. */
  target_entity_key: string;
  target_entity_type: "person" | "project";
  /** How that target relates to the subject whose report is being assembled. */
  relationship_to_subject: AdverseRelationshipToSubject;
  relationship_label?: string;
}

/**
 * One target's screen result.
 *
 * An empty list has four causes and only one of them is an answer: the provider
 * returned nothing, the answer carried no JSON, the JSON did not parse, or a
 * search that really did run and surface no lead. Returning a bare array made
 * all four look identical, and once the sweep started completing a coverage row
 * that collapse would have published a model-search outage as "nothing adverse
 * found". `completed` keeps the search that never answered separate from the
 * search that answered nothing.
 */
export interface AdverseSweepResult {
  /** True only when the provider answered AND its answer parsed. */
  completed: boolean;
  signals: AdverseSignal[];
}

const ADVERSE_NOT_ANSWERED: AdverseSweepResult = { completed: false, signals: [] };

export async function searchAdverseSignals(
  handle: string,
  kind: "person" | "project",
  context: AdverseSearchContext,
  ticker?: string,
): Promise<AdverseSweepResult> {
  const h = handle.replace(/^@/, "");
  const targetEntityKey = `@${h.toLowerCase()}`;
  const subject = kind === "project"
    ? `the project / company behind X account @${h}${ticker ? ` (token $${ticker.replace(/^\$/, "")})` : ""}`
    : `the person behind X account @${h}`;
  const system =
    "You are a forensic due-diligence researcher with live web and X search. Search for ADVERSE signals about the named subject: accusations of a rug pull, slow rug, liquidity pull/removal, wallet draining, exit scam, or general community complaints/FUD. " +
    "Search X, Trustpilot/review sites, Reddit, and scam-report sites. Run BOTH '<subject> scam', '<subject> rug', and '<subject> fud'-style queries. " +
    "Return candidate leads only. For EACH, provide the one specific page or post that an independent collector should fetch and verify. Do not grade credibility, count independent sources, call anything verified, or infer guilt. Do not repeat the subject's own marketing. If there are no sourced leads, return an empty list. " +
    "Reply with ONLY compact JSON: {\"signals\":[{\"category\":\"rug|slow_rug|liquidity_pull|drain|scam_accusation|fud\",\"claim\":\"\",\"source\":\"\",\"source_url\":\"\"}]}. Never use em dashes.";
  const text = await generalWebSearch(system, `Subject: ${subject}. Surface source URLs that may contain complaints or accusations of rug, slow rug, liquidity pull, wallet drains, exit scam, or FUD. These are leads for later verification, not findings.`, { cacheKey: `adverse:${subject}` });
  // No answer, and an answer we cannot read, are both screens that did not run.
  if (!text) return ADVERSE_NOT_ANSWERED;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return ADVERSE_NOT_ANSWERED;
  try {
    const parsed = JSON.parse(m[0]);
    const cats = new Set<AdverseCategory>(["rug", "slow_rug", "liquidity_pull", "drain", "scam_accusation", "fud"]);
    const out: any[] = Array.isArray(parsed.signals) ? parsed.signals : [];
    const signals = out
      .filter((s) => s && typeof s.claim === "string" && s.claim.trim() && cats.has(s.category))
      .map((s): AdverseSignal => ({
        category: s.category as AdverseCategory,
        claim: s.claim.trim(),
        source: (s.source || "unattributed").toString().trim(),
        source_url: typeof s.source_url === "string" && /^https?:\/\//.test(s.source_url) ? s.source_url : undefined,
        target_entity_key: targetEntityKey,
        target_entity_type: kind,
        relationship_to_subject: context.relationship_to_subject,
        relationship_label: context.relationship_label?.trim() || undefined,
      }))
      .slice(0, 12);
    return { completed: true, signals };
  } catch {
    return ADVERSE_NOT_ANSWERED;
  }
}

// ── Manipulation-tooling flag ──
// The strongest, most objective signal from the RECC test: a founder who BUILDS
// or OPERATES the means to rug / wash-trade. Detects ties to token bundlers,
// wallet mixers, volume-fakers, multi-wallet snipe bots, and the like, grounded
// in the operator's OWN public product pages (e.g. Smithii's Solana Bundler +
// Mixoor mixer), not rumor.
export type ToolingKind = "bundler" | "mixer" | "volume_faker" | "snipe_bot" | "multi_wallet" | "other";
export interface ManipulationTool { name: string; kind: ToolingKind; url?: string; evidence: string }
export interface ToolingFlag { role_claim: string; tools: ManipulationTool[] }

export async function detectManipulationTooling(handle: string, name?: string): Promise<ToolingFlag | null> {
  const h = handle.replace(/^@/, "");
  const system =
    "You are a forensic research lead generator with live web and X search. Surface candidate first-party pages that may connect the given person to a token bundler, wallet mixer, volume faker, wash-trading generator, or multi-wallet snipe bot. " +
    "Return leads for an independent collector to verify; do not decide that the person operates the tool and do not call the connection verified. Prefer the product's own page, docs, or post and include the role claimed on that page. Legitimate general token-creation or analytics tools do not count. " +
    "Reply with ONLY compact JSON: {\"role_claim\":\"\",\"tools\":[{\"name\":\"\",\"kind\":\"bundler|mixer|volume_faker|snipe_bot|multi_wallet|other\",\"url\":\"\",\"evidence\":\"\"}]}. If none, return {\"role_claim\":\"\",\"tools\":[]}. NEVER invent. Never use em dashes.";
  const text = await generalWebSearch(system, `Person: ${name || h} (X handle @${h}). Find candidate first-party pages that may link them to manipulation tooling. Return URLs for later independent verification only.`, { cacheKey: `manip:${h}` });
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    const kinds = new Set<ToolingKind>(["bundler", "mixer", "volume_faker", "snipe_bot", "multi_wallet", "other"]);
    const tools: ManipulationTool[] = (Array.isArray(parsed.tools) ? parsed.tools : [])
      .filter((t: any) => t && typeof t.name === "string" && t.name.trim())
      .map((t: any) => ({
        name: t.name.trim(),
        kind: kinds.has(t.kind) ? t.kind : "other",
        url: typeof t.url === "string" && /^https?:\/\//.test(t.url) ? t.url : undefined,
        evidence: (t.evidence || "").toString().trim(),
      }))
      .slice(0, 8);
    // A lead set is useful only when it names at least one concrete tool.
    if (!tools.length) return { role_claim: "", tools: [] };
    return { role_claim: (parsed.role_claim || "claimed operator").toString().trim(), tools };
  } catch {
    return null;
  }
}

export function fmtFollowers(n?: number): string {
  if (n == null) return "N/A";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export const xAdapter: Adapter = {
  id: "x",
  label: "X (Grok + twitterapi.io)",
  available: () => !!env("TWITTERAPI_KEY") || !!env("XAI_API_KEY"),
  async run(ctx: CollectContext) {
    // 1. profile via twitterapi.io — fallback retry only if coldIntake didn't
    //    already resolve the follower count (so a busy/empty bio still gets it).
    const haveProfile = ctx.evidence.profile.followers && ctx.evidence.profile.followers !== "N/A";
    const haveOfficialAvatar = ctx.evidence.profile.avatar_source_state != null;
    const haveTerminalAccountState = ctx.evidence.profile.x_account_status === "suspended"
      || ctx.evidence.profile.x_account_status === "unavailable";
    const prof = (haveProfile && haveOfficialAvatar) || haveTerminalAccountState
      ? null
      : await getProfile(ctx.handle);
    if (prof?.accountStatus === "active") {
      ctx.evidence.profile.profile_collection_state = "resolved";
      ctx.evidence.profile.profile_provider = "twitterapi";
      ctx.evidence.profile.profile_captured_at = prof.statusCapturedAt;
      ctx.evidence.profile.x_account_status = "active";
      ctx.evidence.profile.x_account_status_source_url = prof.statusSourceUrl;
      ctx.evidence.profile.x_account_status_captured_at = prof.statusCapturedAt;
      ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
      ctx.evidence.profile.bio = prof.bio ?? ctx.evidence.profile.bio;
      ctx.evidence.profile.website = canonicalPublicProfileWebsite(prof.website)
        ?? ctx.evidence.profile.website;
      ctx.evidence.profile.followers = fmtFollowers(prof.followers);
      if (prof.image) {
        ctx.evidence.profile.avatar_url = prof.image;
        ctx.evidence.profile.avatar_source_state = "resolved";
      } else {
        ctx.evidence.profile.avatar_source_state = "none";
      }
      if (prof.createdAt) {
        const d = new Date(prof.createdAt);
        if (!isNaN(d.getTime())) {
          ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
        }
      }
      ctx.emit({ phase: "P0 · Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle}, ${fmtFollowers(prof.followers)} followers`, source: "twitterapi.io", tone: "neutral" });
    } else if (prof) {
      ctx.evidence.profile.profile_collection_state = "unavailable";
      ctx.evidence.profile.profile_provider = "twitterapi";
      ctx.evidence.profile.profile_captured_at = undefined;
      ctx.evidence.profile.x_account_status = prof.accountStatus;
      ctx.evidence.profile.x_account_status_source_url = prof.statusSourceUrl;
      ctx.evidence.profile.x_account_status_captured_at = prof.statusCapturedAt;
      ctx.emit({
        phase: "P0 · Intake",
        label: prof.accountStatus === "suspended" ? "Official X account suspended" : "Official X account unavailable",
        detail: prof.accountStatus === "suspended"
          ? `${prof.handle} currently renders X's terminal Account suspended state. Identity discovery continues through the official site and other public records.`
          : `${prof.handle} currently has no live public X profile. Identity discovery continues through the official site and other public records.`,
        source: "x.com",
        tone: "warn",
      });
    }

    // recent posts (skip if already pulled upstream for claim extraction)
    if (!ctx.evidence.recentActivity.length) {
      const posts = await getRecentPosts(ctx.handle);
      if (posts.length) {
        ctx.evidence.recentActivity = posts;
        ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Pulled ${posts.length} recent posts.`, source: "twitterapi.io", tone: "neutral" });
      }
    }

    // posting cadence / dormancy — a project going quiet for weeks is a liveness flag.
    const lastPostAt = await getLastPostAt(ctx.handle);
    if (lastPostAt) {
      const days = Math.floor((Date.now() - Date.parse(lastPostAt)) / 86400000);
      ctx.evidence.profile.last_post_at = lastPostAt;
      ctx.evidence.profile.days_since_post = days;
      const dormant = days >= 21;
      ctx.emit({ phase: "P0 · Intake", label: dormant ? "Dormant account" : "Active", detail: dormant ? `No posts in ${days} days. A project or account gone quiet is a liveness flag.` : `Last posted ${days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago"}.`, source: "twitterapi.io", tone: dormant ? "warn" : "good" });
    }

    // 1b. follower QUALITY: which respected accounts follow the subject. The
    //     answer (who, not how many) is a credibility signal a bot farm can't fake.
    if (!ctx.evidence.notableFollowers.length) {
      ctx.emit({ phase: "P0 · Intake", label: "Notable followers", detail: "Checking which top funds, founders, and KOLs follow the subject…", source: "twitterapi.io", tone: "neutral" });
      // Parse the profile's follower count ("12.4K"/"1.2M") so the hybrid can pick
      // enumerate-vs-reverse-check; unknown → reverse-check (safe default).
      const fcm = (ctx.evidence.profile.followers ?? "").match(/([\d.]+)\s*([KMB]?)/i);
      const followerCount = fcm ? Number(fcm[1]) * (/m/i.test(fcm[2]) ? 1e6 : /b/i.test(fcm[2]) ? 1e9 : /k/i.test(fcm[2]) ? 1e3 : 1) : undefined;
      const scan = await notableFollowers(ctx.handle, { followerCount, organizationId: ctx.organizationId });
      const nf = scan.list;
      ctx.evidence.notableFollowers = nf;
      if (nf.length) {
        const coverageDetail = scan.coverage === "complete"
          ? `Followed by ${nf.length} of ${scan.checked} known accounts checked`
          : `Observed ${nf.length} notable follower${nf.length === 1 ? "" : "s"} before provider coverage became incomplete`;
        ctx.emit({ phase: "P0 · Intake", label: scan.coverage === "complete" ? "Notable followers" : "Notable followers · partial coverage", detail: `${coverageDetail}: ${nf.slice(0, 8).map((n) => `@${n.handle}${n.label ? ` (${n.label})` : ""}`).join(", ")}${nf.length > 8 ? ", …" : ""}.${scan.coverage === "complete" ? "" : " Unobserved relationships remain unknown."}`, source: "twitterapi.io", tone: scan.coverage === "complete" ? "good" : "warn" });
      } else if (scan.coverage === "complete" && scan.checked > 0) {
        ctx.emit({ phase: "P0 · Intake", label: "Notable followers", detail: `None of the ${scan.checked} known funds/founders/KOLs checked follow this subject.`, source: "twitterapi.io", tone: "neutral" });
      } else if (scan.coverage === "partial") {
        ctx.emit({ phase: "P0 · Intake", label: "Notable follower check incomplete", detail: scan.checked > 0 ? `No notable follower was observed in ${scan.checked} returned relationship result${scan.checked === 1 ? "" : "s"}; unobserved accounts remain unknown, so ARGUS withheld the negative conclusion.` : "Some follower data returned, but full reference-set coverage was not established; ARGUS withheld the negative conclusion.", source: "twitterapi.io", tone: "warn" });
      } else {
        ctx.emit({ phase: "P0 · Intake", label: "Notable follower check unavailable", detail: "The relationship provider returned no observable results; ARGUS withheld the notable-follower conclusion.", source: "twitterapi.io", tone: "warn" });
      }
      // The follower rows the enumerate path already downloaded carry an
      // audience shape no user can assemble by hand. Report the distribution
      // and stop: the tone stays neutral because a shape is not a verdict, and
      // the reverse-check path reads no profile at all, so it says nothing.
      if (scan.audience) {
        ctx.emit({ phase: "P0 · Intake", label: "Audience shape", detail: describeAudienceSample(scan.audience), source: "twitterapi.io", tone: "neutral" });
      }
    }

    // 2. corroborate each claimed testimonial / advisory / advisor relationship.
    //    Run concurrently and cap the count: each does a follow-graph check plus a
    //    Grok acknowledgment, and a sequential loop over many claims (advisors add
    //    to it) would blow the audit's time budget.
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised]
      .filter((t) => (t as any).claimed_endorser_handle || (t as any).project_handle)
      .slice(0, 6);
    let observedRelationships = 0;
    let nonFollowingRelationships = 0;
    let contradictedRelationships = 0;
    // ONE batched Grok call verifies every endorser; follow-graph checks
    // (twitterapi, cheap) stay per-claim and run alongside.
    const ackMap = await acknowledgments(claims.map((t) => (t as any).claimed_endorser_handle || (t as any).project_handle), ctx.handle);
    await Promise.all(
      claims.map(async (t) => {
        const endorser = (t as any).claimed_endorser_handle || (t as any).project_handle;
        const follows = await followsSubject(endorser, ctx.handle);
        const ack = ackMap.get(String(endorser).replace(/^@/, "").toLowerCase()) ?? null;
        if (follows !== null) {
          t.follows_subject = follows;
          observedRelationships += 1;
          if (!follows) nonFollowingRelationships += 1;
        }
        if (ack?.source_url) {
          // Grok supplied the URL, so this is still a model lead: it has not
          // been independently fetched and checked for author/text/relationship.
          // Keep it visible for follow-up without letting it self-corroborate or
          // self-contradict the claim that generated the search.
          const lead = `Model-search acknowledgment lead: ${ack.ack}, ${ack.sentiment} (${ack.source_url}); independent artifact verification required`;
          t.notes = [t.notes, lead].filter(Boolean).join(" · ");
        }
        t.corroboration_verdict = classifyTestimonial(t);
        if (t.corroboration_verdict === TestimonialVerdict.CONTRADICTED) {
          contradictedRelationships += 1;
        }
        const tone = t.corroboration_verdict === TestimonialVerdict.CONTRADICTED ? "bad" : t.corroboration_verdict === TestimonialVerdict.CORROBORATED ? "good" : "warn";
        ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${(t as any).claimed_relationship ?? "endorser"}: ${t.corroboration_verdict}${follows === false ? " · does not follow subject" : ""}`, source: "X", tone });
      }),
    );
    if (observedRelationships) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: contradictedRelationships ? "finding" : "confirmed",
        note: `${observedRelationships} claimed relationship${observedRelationships === 1 ? "" : "s"} checked in the X follow graph${nonFollowingRelationships ? ` · ${nonFollowingRelationships} did not follow the subject and remain uncorroborated` : ""}${contradictedRelationships ? ` · ${contradictedRelationships} explicitly contradicted` : ""}`,
        provider: "twitterapi.io",
        sourceCount: observedRelationships,
      });
    }
  },
};
