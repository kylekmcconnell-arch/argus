import { env } from "./config";
import { recordCall } from "./cost";
import { cacheGet, cacheSet } from "./cache";
import { trustedOfficialXAvatarUrl } from "../src/lib/avatars";
import {
  socialActivityScore,
  selectSocialMentioners,
  type SocialActivityBucket,
  type SocialActivityMention,
  type SocialActivitySnapshot,
  type SocialActivityIncompleteReason,
  type SocialActivityWindow,
} from "../src/data/socialActivity";

const X_API = "https://api.x.com/2";
const TWITTERAPI_IO = "https://api.twitterapi.io/twitter/tweet/advanced_search";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const POST_READ_USD = 0.005;
const COUNTS_REQUEST_USD = 0.005;
const TWITTERAPI_IO_POST_USD = 0.00015;
const TWITTERAPI_IO_PAGE_SIZE = 20;
const SOCIAL_ACTIVITY_MIN_POSTS = 10;
const SOCIAL_ACTIVITY_MAX_POSTS = 5_000;
// twitterapi.io returns up to 20 tweets per request. The previous cap of 100
// stopped a busy 7-day search around ~2,000 posts with pagination_incomplete.
// Size the budget from the post ceiling so that cap is actually reachable:
// half the billed rows may be client-filtered reposts. The provider supports a
// cursor-paginated date range directly, so do not spend 28 baseline requests
// probing six-hour slices before pagination even begins.
const TWITTERAPI_IO_MAX_REQUESTS =
  Math.ceil(SOCIAL_ACTIVITY_MAX_POSTS / (TWITTERAPI_IO_PAGE_SIZE / 2));

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

export interface SocialActivityIdentity {
  handle: string;
  ticker?: string | null;
  projectName?: string | null;
}

export interface SocialActivityCollectorOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  bearer?: string | null;
  twitterApiKey?: string | null;
  maxPosts?: number;
  /** Stop pagination at this instant. Score stays withheld when the search is incomplete. */
  deadlineAt?: number;
}

interface SearchPost {
  id: string;
  authorId: string;
  createdAt: string;
  handle?: string;
  displayName?: string;
  text?: string;
  followers?: number;
  avatarUrl?: string;
  tweetUrl?: string;
}

interface CountsResult {
  ok: boolean;
  buckets: SocialActivityBucket[];
}

interface SearchResult {
  ok: boolean;
  posts: SearchPost[];
  complete: boolean;
  oldestAt: number | null;
  requests: number;
  postReads: number;
  incompleteReason?: SocialActivityIncompleteReason;
}

function normalizedHandle(value: string): string | null {
  const handle = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function safeTicker(value?: string | null): string | null {
  const ticker = value?.trim().replace(/^\$/, "") ?? "";
  return /^[A-Za-z][A-Za-z0-9]{1,9}$/.test(ticker) ? ticker.toUpperCase() : null;
}

function safeProjectName(value?: string | null): string | null {
  const name = value?.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim() ?? "";
  return name.length >= 3 && name.length <= 48 && /[A-Za-z]/.test(name) ? name : null;
}

const SHORT_GENERIC_PROJECT_NAME = /^[A-Za-z]{1,4}$/;

function pastDeadline(deadlineAt?: number): boolean {
  return typeof deadlineAt === "number" && Number.isFinite(deadlineAt) && Date.now() >= deadlineAt;
}

/**
 * A mention query must be about THIS bound subject. A same-word collision is
 * not a mention. Do not OR a project name that is a single token equal to the
 * ticker, or a short generic / dictionary-ish word (≤4 letters). `"EARN"`
 * must never become a query term.
 */
function projectNameSearchTerm(
  projectName: string,
  handle: string,
  ticker: string | null,
): string | null {
  if (projectName.toLowerCase() === handle.toLowerCase()) return null;
  const tokens = projectName.split(" ").filter(Boolean);
  if (tokens.length === 1) {
    const token = tokens[0];
    if (ticker && token.toUpperCase() === ticker) return null;
    if (SHORT_GENERIC_PROJECT_NAME.test(token)) return null;
  }
  return projectName;
}

export function buildSocialActivityQuery(identity: SocialActivityIdentity): {
  handle: string;
  ticker?: string;
  projectName?: string;
  query: string;
} | null {
  const handle = normalizedHandle(identity.handle);
  if (!handle) return null;
  const ticker = safeTicker(identity.ticker);
  const projectName = safeProjectName(identity.projectName);
  const terms = [`@${handle}`];
  if (ticker) terms.push(`$${ticker}`);
  const nameTerm = projectName ? projectNameSearchTerm(projectName, handle, ticker) : null;
  if (nameTerm) terms.push(`"${nameTerm}"`);
  return {
    handle: `@${handle}`,
    ...(ticker ? { ticker: `$${ticker}` } : {}),
    ...(projectName ? { projectName } : {}),
    query: `(${terms.join(" OR ")}) -is:retweet`,
  };
}

function sourceUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

function emptyWindow(start: Date, end: Date): SocialActivityWindow {
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    postCount: null,
    uniqueAccounts: null,
    inspectedPosts: 0,
    authorCoverageComplete: false,
  };
}

function unavailableSnapshot(
  identity: ReturnType<typeof buildSocialActivityQuery>,
  now: Date,
  reason: SocialActivitySnapshot["unavailableReason"],
  note: string,
  provider: SocialActivitySnapshot["provider"] = "x-api-v2",
): SocialActivitySnapshot {
  const end = new Date(now.getTime() - 30_000);
  const last24Start = new Date(end.getTime() - DAY_MS);
  const previous24Start = new Date(end.getTime() - 2 * DAY_MS);
  const last7Start = new Date(end.getTime() - 7 * DAY_MS);
  const fallback = identity ?? { handle: "@unknown", query: "" };
  return {
    schemaVersion: 1,
    provider,
    state: "unavailable",
    capturedAt: now.toISOString(),
    sourceUrl: sourceUrl(fallback.query),
    queryBasis: {
      handle: fallback.handle,
      ...(fallback.ticker ? { ticker: fallback.ticker } : {}),
      ...(fallback.projectName ? { projectName: fallback.projectName } : {}),
      query: fallback.query,
      excludesReposts: true,
    },
    windows: {
      last24Hours: emptyWindow(last24Start, end),
      previous24Hours: emptyWindow(previous24Start, last24Start),
      last7Days: emptyWindow(last7Start, end),
    },
    hourlyPostCounts: [],
    top10AccountSharePct: null,
    activeDays: null,
    activityScore: null,
    scoreVersion: "social-activity-v1",
    collection: { countsRequestCompleted: false, searchRequests: 0, postReads: 0, maxPosts: 0, estimatedUsd: 0 },
    note,
    unavailableReason: reason,
  };
}

async function fetchJson(fetchImpl: typeof fetch, url: URL, bearer: string, op: "counts" | "search"): Promise<JsonRecord | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      recordCall("x-api", op, 0, `http_${response.status}`, "failed");
      return null;
    }
    const payload = asRecord(await response.json());
    if (op === "counts") recordCall("x-api", op, COUNTS_REQUEST_USD, "recent public post counts", "succeeded");
    return payload;
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout_15000ms" : "transport_or_json_error";
    recordCall("x-api", op, 0, reason, "failed");
    return null;
  }
}

async function collectCounts(
  fetchImpl: typeof fetch,
  bearer: string,
  query: string,
  start: Date,
  end: Date,
): Promise<CountsResult> {
  const url = new URL(`${X_API}/tweets/counts/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("granularity", "hour");
  url.searchParams.set("start_time", start.toISOString());
  url.searchParams.set("end_time", end.toISOString());
  const payload = await fetchJson(fetchImpl, url, bearer, "counts");
  if (!payload) return { ok: false, buckets: [] };
  const buckets = (Array.isArray(payload.data) ? payload.data : []).flatMap((row): SocialActivityBucket[] => {
    const record = asRecord(row);
    const count = typeof record.tweet_count === "number" && Number.isFinite(record.tweet_count)
      ? Math.max(0, Math.round(record.tweet_count))
      : null;
    return typeof record.start === "string" && typeof record.end === "string" && count !== null
      ? [{ start: record.start, end: record.end, postCount: count }]
      : [];
  });
  return { ok: true, buckets };
}

async function collectSearch(
  fetchImpl: typeof fetch,
  bearer: string,
  query: string,
  start: Date,
  end: Date,
  maxPosts: number,
  deadlineAt?: number,
): Promise<SearchResult> {
  const posts = new Map<string, SearchPost>();
  let nextToken: string | null = null;
  let complete = false;
  let oldestAt: number | null = null;
  let requests = 0;
  let postReads = 0;
  let incompleteReason: SocialActivityIncompleteReason | undefined;

  do {
    if (pastDeadline(deadlineAt)) {
      complete = false;
      incompleteReason = "time_budget";
      break;
    }
    const remaining = maxPosts - posts.size;
    if (remaining <= 0) break;
    const url = new URL(`${X_API}/tweets/search/recent`);
    url.searchParams.set("query", query);
    url.searchParams.set("start_time", start.toISOString());
    url.searchParams.set("end_time", end.toISOString());
    url.searchParams.set("max_results", String(Math.min(100, Math.max(10, remaining))));
    url.searchParams.set("tweet.fields", "author_id,created_at,text");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name,public_metrics,profile_image_url");
    if (nextToken) url.searchParams.set("next_token", nextToken);
    const payload = await fetchJson(fetchImpl, url, bearer, "search");
    requests += 1;
    if (!payload) return {
      ok: false,
      posts: [...posts.values()],
      complete: false,
      oldestAt,
      requests,
      postReads,
      incompleteReason: "provider_error",
    };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const users = usersById(payload);
    postReads += rows.length;
    recordCall("x-api", "post-read", rows.length * POST_READ_USD, `${rows.length} public posts`, "succeeded");
    for (const row of rows) {
      const post = officialXPost(row, users);
      if (!post) continue;
      const at = Date.parse(post.createdAt);
      if (!Number.isFinite(at)) continue;
      posts.set(post.id, post);
      oldestAt = oldestAt === null ? at : Math.min(oldestAt, at);
    }
    const token = asRecord(payload.meta).next_token;
    nextToken = typeof token === "string" && token ? token : null;
    complete = nextToken === null;
  } while (nextToken && posts.size < maxPosts);

  if (!complete && !incompleteReason) incompleteReason = "post_limit";
  return {
    ok: true,
    posts: [...posts.values()],
    complete,
    oldestAt,
    requests,
    postReads,
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

function countPosts(buckets: SocialActivityBucket[], start: Date, end: Date, countsComplete: boolean): number | null {
  if (!countsComplete && !buckets.length) return null;
  return buckets.reduce((sum, bucket) => {
    const bucketStart = Date.parse(bucket.start);
    return bucketStart >= start.getTime() && bucketStart < end.getTime() ? sum + bucket.postCount : sum;
  }, 0);
}

function windowFrom(
  posts: SearchPost[],
  buckets: SocialActivityBucket[],
  start: Date,
  end: Date,
  search: SearchResult,
  countsComplete: boolean,
): SocialActivityWindow {
  const rows = posts.filter((post) => {
    const at = Date.parse(post.createdAt);
    return at >= start.getTime() && at < end.getTime();
  });
  const authorCoverageComplete = search.ok && (search.complete || (search.oldestAt !== null && search.oldestAt <= start.getTime()));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    postCount: countPosts(buckets, start, end, countsComplete),
    uniqueAccounts: search.ok ? new Set(rows.map((post) => post.authorId)).size : null,
    inspectedPosts: rows.length,
    authorCoverageComplete,
  };
}

function usersById(payload: JsonRecord): Map<string, JsonRecord> {
  const includes = asRecord(payload.includes);
  const users = Array.isArray(includes.users) ? includes.users : [];
  const map = new Map<string, JsonRecord>();
  for (const row of users) {
    const record = asRecord(row);
    if (typeof record.id === "string") map.set(record.id, record);
  }
  return map;
}

function providedFollowerCount(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

function providedHandle(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const handle = value.trim().replace(/^@/, "");
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) return handle;
  }
  return undefined;
}

function providedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function providedTweetUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:")
        && (host === "x.com" || host === "www.x.com" || host === "twitter.com" || host === "www.twitter.com")
        && /\/status\/\d+/i.test(parsed.pathname)
        && !parsed.username
        && !parsed.password
      ) return parsed.href;
    } catch {
      // Ignore unusable provider URLs and keep looking.
    }
  }
  return undefined;
}

function authorFields(author: JsonRecord): Pick<SearchPost, "handle" | "displayName" | "followers" | "avatarUrl"> {
  const handle = providedHandle(author.userName, author.username, author.screen_name);
  const displayName = typeof author.name === "string" && author.name.trim() ? author.name.trim() : undefined;
  const metrics = asRecord(author.public_metrics);
  const followers = providedFollowerCount(
    author.followers,
    author.followersCount,
    author.followers_count,
    metrics.followers_count,
  );
  const avatarUrl = trustedOfficialXAvatarUrl(
    typeof author.profilePicture === "string" ? author.profilePicture
      : typeof author.profile_image_url_https === "string" ? author.profile_image_url_https
        : typeof author.profile_image_url === "string" ? author.profile_image_url
          : typeof author.profile_image === "string" ? author.profile_image
            : null,
  ) ?? undefined;
  return {
    ...(handle ? { handle } : {}),
    ...(displayName ? { displayName } : {}),
    ...(followers !== undefined ? { followers } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function officialXPost(row: unknown, users: Map<string, JsonRecord>): SearchPost | null {
  const record = asRecord(row);
  if (typeof record.id !== "string" || typeof record.author_id !== "string" || typeof record.created_at !== "string") {
    return null;
  }
  const at = Date.parse(record.created_at);
  if (!Number.isFinite(at)) return null;
  const author = users.get(record.author_id) ?? {};
  const text = providedText(record.text);
  const tweetUrl = providedTweetUrl(record.url);
  return {
    id: record.id,
    authorId: record.author_id,
    createdAt: record.created_at,
    ...authorFields(author),
    ...(text ? { text } : {}),
    ...(tweetUrl ? { tweetUrl } : {}),
  };
}

function twitterApiIoPost(row: unknown): SearchPost | null {
  const record = asRecord(row);
  const author = asRecord(record.author);
  const id = typeof record.id === "string" ? record.id : null;
  const handle = providedHandle(author.userName, author.username, author.screen_name);
  const authorId = typeof author.id === "string"
    ? author.id
    : handle
      ? handle.toLowerCase()
      : null;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : null;
  const text = typeof record.text === "string" ? record.text : "";
  const isRepost = record.retweeted_tweet !== undefined && record.retweeted_tweet !== null
    || /^RT\s+@/i.test(text);
  if (!id || !authorId || !createdAt || isRepost || !Number.isFinite(Date.parse(createdAt))) return null;
  const tweetUrl = providedTweetUrl(record.url, record.twitterUrl);
  return {
    id,
    authorId,
    createdAt: new Date(createdAt).toISOString(),
    ...authorFields(author),
    ...(providedText(text) ? { text } : {}),
    ...(tweetUrl ? { tweetUrl } : {}),
  };
}

function hourlyBuckets(posts: SearchPost[], start: Date, end: Date): SocialActivityBucket[] {
  const counts = new Map<number, number>();
  for (const post of posts) {
    const hour = Math.floor(Date.parse(post.createdAt) / HOUR_MS) * HOUR_MS;
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  const buckets: SocialActivityBucket[] = [];
  for (let at = Math.floor(start.getTime() / HOUR_MS) * HOUR_MS; at < end.getTime(); at += HOUR_MS) {
    buckets.push({
      start: new Date(at).toISOString(),
      end: new Date(at + HOUR_MS).toISOString(),
      postCount: counts.get(at) ?? 0,
    });
  }
  return buckets;
}

async function collectTwitterApiIo(
  fetchImpl: typeof fetch,
  key: string,
  query: string,
  start: Date,
  end: Date,
  maxPosts: number,
  deadlineAt?: number,
): Promise<{ search: SearchResult; buckets: SocialActivityBucket[]; estimatedUsd: number }> {
  const posts = new Map<string, SearchPost>();
  let requests = 0;
  let successfulRequests = 0;
  let billedRows = 0;
  let complete = true;
  let incompleteReason: SocialActivityIncompleteReason | undefined;
  let cursor = "";
  const seenCursors = new Set<string>();

  do {
    if (pastDeadline(deadlineAt)) {
      complete = false;
      incompleteReason = "time_budget";
      break;
    }
    if (requests >= TWITTERAPI_IO_MAX_REQUESTS) {
      complete = false;
      incompleteReason = "pagination_incomplete";
      break;
    }
    const url = new URL(TWITTERAPI_IO);
    url.searchParams.set("query", `${query.replace(/\s+-is:retweet$/, "")} since_time:${Math.floor(start.getTime() / 1000)} until_time:${Math.ceil(end.getTime() / 1000)}`);
    url.searchParams.set("queryType", "Latest");
    if (cursor) url.searchParams.set("cursor", cursor);
    requests += 1;
    let payload: JsonRecord | null = null;
    try {
      const response = await fetchImpl(url, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) payload = asRecord(await response.json());
      else recordCall("twitterapi", "social-search", 0, `http_${response.status}`, "failed");
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout_15000ms" : "transport_or_json_error";
      recordCall("twitterapi", "social-search", 0, reason, "failed");
    }
    if (!payload) {
      complete = false;
      incompleteReason = "provider_error";
      break;
    }
    successfulRequests += 1;
    const rows = Array.isArray(payload.tweets) ? payload.tweets : [];
    billedRows += rows.length;
    recordCall("twitterapi", "social-post-read", rows.length * TWITTERAPI_IO_POST_USD, `${rows.length} public posts`, "succeeded");
    for (const row of rows) {
      const post = twitterApiIoPost(row);
      if (post && posts.size < maxPosts) posts.set(post.id, post);
    }

    const hasNext = payload.has_next_page === true;
    const nextCursor = typeof payload.next_cursor === "string" ? payload.next_cursor : "";
    if (posts.size >= maxPosts) {
      if (hasNext) {
        complete = false;
        incompleteReason = "post_limit";
      }
      break;
    }
    if (!hasNext) break;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      complete = false;
      incompleteReason = "pagination_incomplete";
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  const values = [...posts.values()];
  if (posts.size >= maxPosts && !incompleteReason) {
    complete = false;
    incompleteReason = "post_limit";
  }
  const oldestAt = complete && values.length ? Math.min(...values.map((post) => Date.parse(post.createdAt))) : null;
  return {
    search: {
      ok: successfulRequests > 0 || incompleteReason === "time_budget",
      posts: values,
      complete,
      oldestAt,
      requests,
      postReads: billedRows,
      ...(incompleteReason ? { incompleteReason } : {}),
    },
    buckets: hourlyBuckets(values, start, end),
    estimatedUsd: Math.round(billedRows * TWITTERAPI_IO_POST_USD * 10000) / 10000,
  };
}

function top10Share(posts: SearchPost[], complete: boolean): number | null {
  if (!complete || posts.length === 0) return null;
  const byAuthor = new Map<string, number>();
  for (const post of posts) byAuthor.set(post.authorId, (byAuthor.get(post.authorId) ?? 0) + 1);
  const top = [...byAuthor.values()].sort((a, b) => b - a).slice(0, 10).reduce((sum, count) => sum + count, 0);
  return Math.round((top / posts.length) * 1000) / 10;
}

export async function collectSocialActivity(
  rawIdentity: SocialActivityIdentity,
  options: SocialActivityCollectorOptions = {},
): Promise<SocialActivitySnapshot> {
  const now = options.now ?? new Date();
  const identity = buildSocialActivityQuery(rawIdentity);
  if (!identity) return unavailableSnapshot(identity, now, "invalid_identity", "The official X account was not bound, so ARGUS did not run a social activity search.");
  const bearer = options.bearer === undefined ? env("X_API_BEARER") : options.bearer ?? undefined;
  const twitterApiKey = options.twitterApiKey === undefined ? env("TWITTERAPI_KEY") : options.twitterApiKey ?? undefined;
  if (!bearer && !twitterApiKey) return unavailableSnapshot(identity, now, "not_configured", "Social activity was not collected because X search access is not configured.");
  const provider: SocialActivitySnapshot["provider"] = bearer ? "x-api-v2" : "twitterapi-io";

  const configuredMax = Number(env("ARGUS_SOCIAL_ACTIVITY_MAX_POSTS") || String(SOCIAL_ACTIVITY_MAX_POSTS));
  const maxPosts = Math.min(
    SOCIAL_ACTIVITY_MAX_POSTS,
    Math.max(SOCIAL_ACTIVITY_MIN_POSTS, Math.round(options.maxPosts ?? configuredMax)),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheWindow = Math.floor(now.getTime() / (15 * 60 * 1000));
  const cacheKey = `social-activity:v2:${provider}:${identity.query}:${maxPosts}:${cacheWindow}`;
  if (!options.fetchImpl) {
    const cached = await cacheGet(cacheKey, { operation: "social-activity-hit", meta: "15 minute activity snapshot" });
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SocialActivitySnapshot;
        if (parsed.schemaVersion === 1 && (parsed.provider === "x-api-v2" || parsed.provider === "twitterapi-io")) return parsed;
      } catch {
        // A malformed cache row is ignored and never becomes report evidence.
      }
    }
  }
  const end = new Date(now.getTime() - 30_000);
  const last24Start = new Date(end.getTime() - DAY_MS);
  const previous24Start = new Date(end.getTime() - 2 * DAY_MS);
  const last7Start = new Date(end.getTime() - 7 * DAY_MS);

  const twitterApiIo = !bearer && twitterApiKey
    ? await collectTwitterApiIo(fetchImpl, twitterApiKey, identity.query, last7Start, end, maxPosts, options.deadlineAt)
    : null;
  const [counts, search] = twitterApiIo
    ? [{ ok: twitterApiIo.search.complete, buckets: twitterApiIo.buckets } satisfies CountsResult, twitterApiIo.search] as const
    : await Promise.all([
        collectCounts(fetchImpl, bearer!, identity.query, last7Start, end),
        collectSearch(fetchImpl, bearer!, identity.query, last7Start, end, maxPosts, options.deadlineAt),
      ]);
  if (!counts.ok && !search.ok) {
    return unavailableSnapshot(identity, now, "provider_failed", "X did not return usable activity data. No zero or clean result was inferred.", provider);
  }

  const last24Hours = windowFrom(search.posts, counts.buckets, last24Start, end, search, counts.ok);
  const previous24Hours = windowFrom(search.posts, counts.buckets, previous24Start, last24Start, search, counts.ok);
  const last7Days = windowFrom(search.posts, counts.buckets, last7Start, end, search, counts.ok);
  const concentration = top10Share(search.posts, last7Days.authorCoverageComplete);
  const activeDays = counts.ok
    ? new Set(counts.buckets.filter((bucket) => bucket.postCount > 0).map((bucket) => bucket.start.slice(0, 10))).size
    : null;
  const score = last24Hours.uniqueAccounts !== null
    && previous24Hours.uniqueAccounts !== null
    && last7Days.uniqueAccounts !== null
    && last7Days.authorCoverageComplete
    && concentration !== null
    && activeDays !== null
      ? socialActivityScore({
          uniqueAccounts7d: last7Days.uniqueAccounts,
          uniqueAccounts24h: last24Hours.uniqueAccounts,
          uniqueAccountsPrevious24h: previous24Hours.uniqueAccounts,
          top10AccountSharePct: concentration,
          activeDays,
        })
      : null;
  const state = counts.ok && last7Days.authorCoverageComplete ? "complete" : "partial";
  const mentioners: SocialActivityMention[] = selectSocialMentioners(search.posts, identity.handle);
  const snapshot: SocialActivitySnapshot = {
    schemaVersion: 1,
    provider,
    state,
    capturedAt: now.toISOString(),
    sourceUrl: sourceUrl(identity.query),
    queryBasis: {
      handle: identity.handle,
      ...(identity.ticker ? { ticker: identity.ticker } : {}),
      ...(identity.projectName ? { projectName: identity.projectName } : {}),
      query: identity.query,
      excludesReposts: true,
    },
    windows: { last24Hours, previous24Hours, last7Days },
    hourlyPostCounts: counts.buckets,
    top10AccountSharePct: concentration,
    activeDays,
    activityScore: score,
    scoreVersion: "social-activity-v1",
    collection: {
      countsRequestCompleted: counts.ok,
      searchRequests: search.requests,
      postReads: search.postReads,
      maxPosts,
      estimatedUsd: twitterApiIo?.estimatedUsd
        ?? Math.round(((counts.ok ? COUNTS_REQUEST_USD : 0) + search.postReads * POST_READ_USD) * 10000) / 10000,
      ...(search.incompleteReason ? { incompleteReason: search.incompleteReason } : {}),
    },
    note: state === "complete"
      ? `Public X posts matched to the bound project identifiers through ${provider === "x-api-v2" ? "the official X API" : "twitterapi.io"}. Reposts are excluded.`
      : search.incompleteReason === "post_limit"
        ? `ARGUS collected the maximum ${maxPosts.toLocaleString()} posts allowed for this saved scan. Unique-account counts are minimums.`
        : search.incompleteReason === "provider_error"
          ? `X stopped responding before ARGUS finished the search. Unique-account counts are minimums.`
          : search.incompleteReason === "time_budget"
            ? "ARGUS stopped the social-activity search to leave time for required checks. Unique-account counts are minimums."
          : `X returned more result pages than this saved scan collected. Unique-account counts are minimums.`,
    ...(mentioners.length ? { mentioners } : {}),
  };
  if (!options.fetchImpl) void cacheSet(cacheKey, JSON.stringify(snapshot));
  return snapshot;
}
