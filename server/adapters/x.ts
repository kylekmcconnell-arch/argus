// X adapter — the signature data path, split into two layers per our provider
// review:
//   - twitterapi.io (TWITTERAPI_KEY): profile + the follow graph. The official
//     X API gates follower/following behind ~$42k/mo Enterprise, so the cheap
//     follow-check lives here and is isolated as the one gray-area dependency.
//   - Grok / xAI (XAI_API_KEY): real-time X *content* via Live Search, for the
//     acknowledgment half of testimonial corroboration (did @endorser ever
//     mention/reply/thank @subject) and recent-activity sentiment.

import type { Adapter, CollectContext } from "./types";
import { env } from "../config";
import { addGrokUsage, recordCall, recordTwitterapi } from "../cost";
import { cacheGet, cacheSet } from "../cache";
import { TestimonialVerdict, classifyTestimonial } from "../../src/engine";
import type { NotableFollower } from "../../src/data/evidence";
import { canonicalPublicProfileWebsite } from "../../src/lib/fundScaleEvidence";
import { NOTABLE_ACCOUNTS } from "./notableAccounts";

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
export async function grokSearch(system: string, user: string, opts?: { maxToolCalls?: number; cacheKey?: string }): Promise<string | null> {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  // 24h read-through cache: a subject's team/affiliations don't change
  // hour-to-hour, and live search is the dominant spend. Keyed by the CALLER's
  // stable subject key (never the raw prompt — prompts embed volatile posts).
  if (opts?.cacheKey) {
    const hit = await cacheGet(opts.cacheKey);
    if (hit) return hit;
  }
  // COST: xAI bills live search PER SOURCE on top of tokens, and an unbounded
  // agentic loop can pull dozens of sources per call. max_tool_calls caps the
  // search loop (the dominant spend); if the API rejects the param we retry
  // once without it. Every physical attempt is recorded, including the rejected
  // compatibility call and transport/parse failures.
  const call = async (withCap: boolean): Promise<{ status: number | null; text: string | null }> => {
    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
          input: [{ role: "system", content: system }, { role: "user", content: user }],
          tools: [{ type: "web_search" }, { type: "x_search" }],
          ...(withCap ? { max_tool_calls: opts?.maxToolCalls ?? 6 } : {}),
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
  if (result.status === 400) result = await call(false); // param unsupported -> compat retry
  if (result.text && opts?.cacheKey) void cacheSet(opts.cacheKey, result.text);
  return result.text;
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
  name?: string;
  bio?: string;
  followers?: number;
  createdAt?: string;
  website?: string;
  image?: string; // real X profile photo URL (more reliable than an unavatar guess)
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
      if (!res || !res.ok) return null;
      const d = (await res.json()) as any;
      if (d?.status === "error" || d?.data === null) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        return null;
      }
      const p = d.data ?? d;
      if (!p || (p.name == null && p.followers == null && p.followers_count == null && p.description == null)) return null;
      // twitterapi returns the avatar under a few shapes; take the first, and ask
      // for the full-size image (Twitter serves a 48px "_normal" by default).
      const rawImg = p.profilePicture ?? p.profile_image_url_https ?? p.profile_image_url ?? p.profile_image;
      const image = typeof rawImg === "string" ? rawImg.replace(/_normal\.(jpg|jpeg|png|gif|webp)$/i, "_400x400.$1") : undefined;
      return {
        handle: "@" + u,
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

// twitterapi.io: recent posts, fuel for claim extraction + activity signal.
export async function getRecentPosts(handle: string, limit = 20): Promise<string[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return [];
    const d = (await res.json()) as any;
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
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return [];
    const d = (await res.json()) as any;
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

const KW_IDENTITY = ["founder", "co-founder", "cofounder", "CEO", "CTO", "advisor", '"I built"', '"we built"', '"joined as"', "founded"];
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
  const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, key);
  if (!res || !res.ok) return { tweets: [] };
  const d = (await res.json()) as any;
  const tweets: any[] = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
  return { tweets, next: d.has_next_page ? d.next_cursor : undefined };
}

async function searchFrom(handle: string, terms: string[], key: string): Promise<any[]> {
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

export interface Corpus { posts: string[]; newest: string[]; count: { originals: number; searched: number; ranked: number } }

export async function collectCorpus(handle: string): Promise<Corpus> {
  const key = env("TWITTERAPI_KEY");
  const u = handle.replace(/^@/, "");
  if (!key) return { posts: [], newest: [], count: { originals: 0, searched: 0, ranked: 0 } };

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
    count: { originals: originals.length, searched: searched.length, ranked: ranked.length },
  };
}

// twitterapi.io: the timestamp of the most recent tweet. Dormancy is a live-ness
// signal — a project that stops posting for weeks is often winding down, gone
// quiet after a raise, or abandoned. Returns null if unknown.
export async function getLastPostAt(handle: string): Promise<string | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return null;
    const d = (await res.json()) as any;
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

// Does `source` follow `target`? One call via check_follow_relationship.
export async function checkFollow(source: string, target: string): Promise<{ following: boolean | null; followedBy: boolean | null } | null> {
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

  // Enumerate only when it FULLY covers the subject's followers AND is cheaper than
  // reverse-checking (capped at 150 pages / ~30k followers for audit-time safety).
  const fc = opts?.followerCount ?? Infinity;
  const enumPages = Math.ceil(fc / 200);
  if (Number.isFinite(fc) && enumPages <= Math.min(total, 150)) {
    const set = new Map(candidates.map((n) => [n.handle.toLowerCase(), n]));
    const hits: NotableFollower[] = [];
    const got = new Set<string>();
    const u = subject.replace(/^@/, "");
    let cursor = "";
    let observedFollowers = 0;
    let observedPage = false;
    let coverageComplete = false;
    for (let page = 0; page < enumPages + 2; page++) {
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
  // Wall-clock guard: on a large account the free-tier 429 backoff can drag each
  // chunk out, and 34 chunks can eat the whole serverless budget — killing the
  // ENTIRE audit at maxDuration with no result saved. Cap this one pass so it
  // always returns (partial, honestly counted) rather than sinking the audit.
  const deadline = Date.now() + (opts?.budgetMs ?? 45_000);
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
export async function acknowledgments(endorsers: string[], subject: string): Promise<Map<string, AckResult>> {
  const out = new Map<string, AckResult>();
  const key = env("XAI_API_KEY");
  const list = [...new Set(endorsers.map((e) => e.replace(/^@/, "")).filter(Boolean))];
  if (!key || !list.length) return out;
  const s = subject.replace(/^@/, "");
  const system =
    "You generate endorsement-verification leads for a due-diligence collector, with live web and X search. For EACH listed account, surface the strongest candidate public acknowledgment that account may have made of @" + s + " on X, its sentiment, and the exact post URL. " +
    "This is discovery only: do not call a relationship corroborated or contradicted. Without a direct post URL, return ack=none and sentiment=none. ack is one of none|mention|thanks|endorsement; sentiment is positive|neutral|negative|none. " +
    'Reply with ONLY compact JSON: {"results":[{"handle":"@...","ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none","source_url":"https://x.com/.../status/..."}]} — one entry per listed account, never invent posts.';
  const text = await grokSearch(system, `Accounts to check: ${list.map((e) => "@" + e).join(", ")}. For each: has it ever publicly acknowledged @${s} on X? Search each account's posts.`, { maxToolCalls: Math.min(6, list.length + 1), cacheKey: `ack:${s}:${[...list].sort().join(",")}` });
  if (!text) return out;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const arr: any[] = JSON.parse(m[0]).results ?? [];
    for (const r of arr) {
      const h = typeof r?.handle === "string" ? r.handle.replace(/^@/, "").toLowerCase() : "";
      if (!h) continue;
      const sourceUrl = typeof r?.source_url === "string" && /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(r.source_url)
        ? r.source_url
        : undefined;
      out.set(h, {
        ack: sourceUrl && ["mention", "thanks", "endorsement"].includes(r.ack) ? r.ack : "none",
        sentiment: sourceUrl && ["positive", "neutral", "negative"].includes(r.sentiment) ? r.sentiment : "none",
        source_url: sourceUrl,
      });
    }
  } catch { /* malformed -> treat as unknown */ }
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
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")} — search posts mentioning those old handles too.` : "";
  const system =
    "You are a forensic due-diligence researcher with live web and X search. Find EVERY company, crypto project, fund, DAO, or venture that THIS SPECIFIC person (the holder of the given X account) is publicly tied to in ANY working capacity: founded, co-founded, led, was an early employee of, worked at, contributed to, was a core team member of, or advised. " +
    "Work BOTH angles: (1) what the person's own footprint shows — accelerator/portfolio pages, press, team pages, GitHub orgs, podcasts, Crunchbase, beyond their bio and LinkedIn; (2) reverse mentions — project/company accounts that ever NAMED, TAGGED, or ANNOUNCED this person as a founder/team member (co-founder announcements and 'meet the team' posts are often YEARS old, on the project's timeline, search historical posts). There MUST be public evidence tying THAT EXACT person to the venture. " +
    "For each, also report the venture's own X handle and website domain if you can find them. " +
    "Reply with ONLY compact JSON: {\"affiliations\":[{\"name\":\"\",\"role\":\"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate\",\"year\":\"\",\"evidence\":\"one short source phrase\",\"x_handle\":\"@...\",\"domain\":\"example.com\"}]}. " +
    "Include ONLY affiliations you found real, attributable evidence for. If you cannot confidently tie a venture to THIS person, omit it. If you find nothing, return {\"affiliations\":[]}. NEVER invent, guess, or include a venture just because the name is common. Never use em dashes.";
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Every company or project they have founded, led, worked at, contributed to, or advised, however small the role — from their own footprint AND from project accounts announcing them. Be exhaustive: a serial operator often has 5-15 ventures across years; keep searching until you have run down every lead. Search the web and X including historical posts.`, { maxToolCalls: 10, cacheKey: `affil:${h}:${oldHandles.join(",")}` });
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

// Reverse-mention discovery: the complement to discoverAffiliations. That one
// asks "what has THIS person done"; this one asks "who has ever NAMED this
// person as theirs". A co-founder announcement, a "meet the team" thread, a
// launch post tagging the subject — these live on the PROJECT's timeline, not
// the subject's, and often in OLD posts a recency-biased search skips. This is
// the angle that catches a role the subject never tweeted about themselves.
export async function discoverByMentions(handle: string, name?: string, oldHandles: string[] = []): Promise<DiscoveredAffiliation[]> {
  const h = handle.replace(/^@/, "");
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")} — search posts mentioning those old handles too, since their history may live under them.` : "";
  const system =
    "You are a forensic due-diligence researcher with live X (Twitter) search. Find every company, crypto project, fund, or DAO ACCOUNT that has publicly NAMED, TAGGED, ANNOUNCED, or referred to the given person as a founder, co-founder, team member, or employee. " +
    "Search X thoroughly INCLUDING OLDER / HISTORICAL posts, not just recent ones — co-founder announcements and 'meet the team' posts are often years old. There MUST be a real post tying the project to this exact person. " +
    "Reply with ONLY compact JSON: {\"affiliations\":[{\"name\":\"\",\"role\":\"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate\",\"year\":\"\",\"evidence\":\"the post / what it said\",\"x_handle\":\"@projectAccount\",\"domain\":\"example.com\"}]}. " +
    "Include ONLY ties backed by a real post you found. If none, return {\"affiliations\":[]}. NEVER invent. Never use em dashes.";
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Which project or company accounts on X have ever named, tagged, or announced this person as a founder, co-founder, or team member? Search historical posts too, going back years.`);
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const out: DiscoveredAffiliation[] = Array.isArray(parsed.affiliations) ? parsed.affiliations : [];
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
export interface TeamMember { name: string; handle?: string; role: string; evidence?: string; kind: "team" | "advisor"; linkedin?: string; source?: string; projects?: { name: string; role?: string }[] }

export async function findTeam(handle: string, name: string | undefined, posts: string[] = []): Promise<TeamMember[]> {
  const h = handle.replace(/^@/, "");
  const postContext = posts.length
    ? `\n\nThe account's recent posts (mine these for team intros / role + advisor announcements):\n${posts.slice(0, 15).map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";
  const system =
    "You are a forensic researcher with live X search. Identify the PEOPLE publicly tied to the project behind the given X account: founders, cofounders, core team, engineers, AND advisors/backers. " +
    "Look especially at the account's OWN posts (team intros, 'welcome @x as our CTO', 'our founder @y', 'advised by @z', 'backed by @w') and posts that tag these people, plus posts mentioning the project that name its people. " +
    "Be PRECISE about each person's role AT THIS project: only call someone an advisor if they are actually named as one; if they are a founder/cofounder, say so — do NOT downgrade a founder to advisor. " +
    "For EACH person also list their OTHER notable projects or companies (name + their role there, e.g. founder/cofounder/advisor/engineer) that live web/X search reveals — this exposes serial founders and cross-project ties. " +
    "Include ONLY people with real public evidence tying them to THIS project. EXCLUDE the project account itself, generic shillers, hype repliers, and unrelated mentions. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"founder|cofounder|ceo|cto|engineer|advisor|backer\",\"kind\":\"team|advisor\",\"evidence\":\"\",\"projects\":[{\"name\":\"\",\"role\":\"\"}]}]}. If none, return {\"people\":[]}. NEVER invent. Never use em dashes.";
  const text = await grokSearch(system, `X account: @${h}${name && name !== h ? ` (${name})` : ""}. Who are the founders, team members, and advisors of this project? Give each person's precise role here AND their other projects. Search the account's own posts and posts mentioning it.${postContext}`, { cacheKey: `team-x:${h}` });
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
    "DIG hard and be COMPLETE: Google the project + 'team'/'leadership'/'about', open the project's LinkedIn company page and read its 'People' tab (list the employees it shows), check Crunchbase people, the GitHub org's members, podcasts/interviews/press, and X. For an established project expect to name SEVERAL people — do NOT stop at one or two; keep going until you have the full public roster you can verify. " +
    "Connect each name to their X handle and LinkedIn where possible. " +
    "Include ONLY real people genuinely tied to THIS specific project (match the domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts and generic mentions. " +
    "Be PRECISE about each person's role AT THIS project: only call someone an advisor if the project actually names them as one; if the site/LinkedIn shows them as a founder/cofounder/CEO, use THAT — do NOT downgrade a founder to advisor. " +
    "For EACH person, also list their OTHER notable projects/companies (name + their role there) that web/LinkedIn/Crunchbase reveal — this exposes serial founders and cross-project ties. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"\",\"kind\":\"team|advisor\",\"evidence\":\"\",\"projects\":[{\"name\":\"\",\"role\":\"\"}]}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const text = await grokSearch(system, `Crypto/tech ${anchor}. Find the COMPLETE public team: every founder, executive, core team member, and advisor behind it. Read its LinkedIn company People tab, Crunchbase, GitHub org, and press. Connect each to their X handle and LinkedIn, give each person's PRECISE role here, AND list their other projects. Name as many verifiable people as you can, not just the most famous one.`, { cacheKey: `team-site:${clean || projectName}` });
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
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\"}]} — one entry per input name, fields omitted when unknown. NEVER invent. Never use em dashes.";
  const list = people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join("; ");
  const text = await grokSearch(system, `Project: ${project}. Team members to resolve: ${list}. Find each person's X handle and LinkedIn.`, { cacheKey: `enrich:${project}:${people.map((p) => p.name).sort().join("|")}` });
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
const ROLE_RE = /\b(co-?founders?|founders?|ceo|cto|coo|cfo|cmo|chief\s+\w+\s+officer|lead\s+(?:dev|developer|engineer)|core\s+(?:dev|team)|head\s+of\s+\w+|advisors?|our\s+(?:founder|ceo|cto|coo|team|dev|lead))\b/i;
export function scanPostsForRoles(posts: string[]): TeamMember[] {
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  const add = (m: TeamMember) => { const k = (m.handle ?? m.name).toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(m); };
  for (const raw of posts.slice(0, 25)) {
    const p = String(raw ?? "");
    const rm = p.match(ROLE_RE);
    if (!rm) continue;
    const role = rm[0].toLowerCase().replace(/^our\s+/, "");
    const kind: "team" | "advisor" = /advisor/i.test(role) ? "advisor" : "team";
    // @handle sitting in the same post as a role word
    for (const hm of p.matchAll(/@([A-Za-z0-9_]{2,30})/g)) {
      add({ name: "@" + hm[1], handle: "@" + hm[1], role, kind, evidence: `role word "${role}" in the account's own post`, source: "post role-scan" });
    }
    // "Firstname Lastname" adjacent to a role word (best effort, capitalized pair).
    // Exactly two capture groups (name-before-role | name-after-role) so indexing
    // stays predictable.
    const RW = "co-?founders?|founders?|ceo|cto|coo|cfo|cmo|advisors?";
    const nm = p.match(new RegExp(`([A-Z][a-z]+\\s+[A-Z][a-z]+)[^.\\n]{0,18}\\b(?:${RW})\\b|\\b(?:${RW})\\b[^.\\n]{0,12}([A-Z][a-z]+\\s+[A-Z][a-z]+)`, "i"));
    const name = nm ? (nm[1] || nm[2]) : undefined;
    if (name && /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name)) {
      add({ name, role, kind, evidence: `named next to the role word "${role}" in the account's own post`, source: "post role-scan" });
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

export async function searchAdverseSignals(
  handle: string,
  kind: "person" | "project",
  context: AdverseSearchContext,
  ticker?: string,
): Promise<AdverseSignal[]> {
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
  const text = await grokSearch(system, `Subject: ${subject}. Surface source URLs that may contain complaints or accusations of rug, slow rug, liquidity pull, wallet drains, exit scam, or FUD. These are leads for later verification, not findings.`);
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const cats = new Set<AdverseCategory>(["rug", "slow_rug", "liquidity_pull", "drain", "scam_accusation", "fud"]);
    const out: any[] = Array.isArray(parsed.signals) ? parsed.signals : [];
    return out
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
  } catch {
    return [];
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
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}). Find candidate first-party pages that may link them to manipulation tooling. Return URLs for later independent verification only.`);
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
  if (n == null) return "—";
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
    const haveProfile = ctx.evidence.profile.followers && ctx.evidence.profile.followers !== "—";
    const haveOfficialAvatar = ctx.evidence.profile.avatar_source_state != null;
    const prof = haveProfile && haveOfficialAvatar ? null : await getProfile(ctx.handle);
    if (prof) {
      ctx.evidence.profile.profile_collection_state = "resolved";
      ctx.evidence.profile.profile_provider = "twitterapi";
      ctx.evidence.profile.profile_captured_at = new Date().toISOString();
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
      ctx.emit({ phase: "P0 · Intake", label: dormant ? "Dormant account" : "Active", detail: dormant ? `No posts in ${days} days — a project or account gone quiet is a liveness flag.` : `Last posted ${days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago"}.`, source: "twitterapi.io", tone: dormant ? "warn" : "good" });
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
    }

    // 2. corroborate each claimed testimonial / advisory / advisor relationship.
    //    Run concurrently and cap the count: each does a follow-graph check plus a
    //    Grok acknowledgment, and a sequential loop over many claims (advisors add
    //    to it) would blow the audit's time budget.
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised]
      .filter((t) => (t as any).claimed_endorser_handle || (t as any).project_handle)
      .slice(0, 6);
    let observedRelationships = 0;
    let adverseRelationships = 0;
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
          if (!follows) adverseRelationships += 1;
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
        const tone = t.corroboration_verdict === TestimonialVerdict.CONTRADICTED ? "bad" : t.corroboration_verdict === TestimonialVerdict.CORROBORATED ? "good" : "warn";
        ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${(t as any).claimed_relationship ?? "endorser"}: ${t.corroboration_verdict}${follows === false ? " · does not follow subject" : ""}`, source: "X", tone });
      }),
    );
    if (observedRelationships) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: adverseRelationships ? "finding" : "confirmed",
        note: `${observedRelationships} claimed relationship${observedRelationships === 1 ? "" : "s"} checked in the X follow graph${adverseRelationships ? ` · ${adverseRelationships} did not follow the subject` : ""}`,
        provider: "twitterapi.io",
        sourceCount: observedRelationships,
      });
    }
  },
};
