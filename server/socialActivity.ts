import { env } from "./config";
import { recordCall } from "./cost";
import { cacheGet, cacheSet } from "./cache";
import {
  socialActivityScore,
  type SocialActivityBucket,
  type SocialActivitySnapshot,
  type SocialActivityWindow,
} from "../src/data/socialActivity";

const X_API = "https://api.x.com/2";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const POST_READ_USD = 0.005;
const COUNTS_REQUEST_USD = 0.005;

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
  maxPosts?: number;
}

interface SearchPost {
  id: string;
  authorId: string;
  createdAt: string;
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
  if (projectName && projectName.toLowerCase() !== handle.toLowerCase()) terms.push(`"${projectName}"`);
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
): SocialActivitySnapshot {
  const end = new Date(now.getTime() - 30_000);
  const last24Start = new Date(end.getTime() - DAY_MS);
  const previous24Start = new Date(end.getTime() - 2 * DAY_MS);
  const last7Start = new Date(end.getTime() - 7 * DAY_MS);
  const fallback = identity ?? { handle: "@unknown", query: "" };
  return {
    schemaVersion: 1,
    provider: "x-api-v2",
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
): Promise<SearchResult> {
  const posts = new Map<string, SearchPost>();
  let nextToken: string | null = null;
  let complete = false;
  let oldestAt: number | null = null;
  let requests = 0;
  let postReads = 0;

  do {
    const remaining = maxPosts - posts.size;
    if (remaining <= 0) break;
    const url = new URL(`${X_API}/tweets/search/recent`);
    url.searchParams.set("query", query);
    url.searchParams.set("start_time", start.toISOString());
    url.searchParams.set("end_time", end.toISOString());
    url.searchParams.set("max_results", String(Math.min(100, Math.max(10, remaining))));
    url.searchParams.set("tweet.fields", "author_id,created_at");
    if (nextToken) url.searchParams.set("next_token", nextToken);
    const payload = await fetchJson(fetchImpl, url, bearer, "search");
    requests += 1;
    if (!payload) return { ok: false, posts: [...posts.values()], complete: false, oldestAt, requests, postReads };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    postReads += rows.length;
    recordCall("x-api", "post-read", rows.length * POST_READ_USD, `${rows.length} public posts`, "succeeded");
    for (const row of rows) {
      const record = asRecord(row);
      if (typeof record.id !== "string" || typeof record.author_id !== "string" || typeof record.created_at !== "string") continue;
      const at = Date.parse(record.created_at);
      if (!Number.isFinite(at)) continue;
      posts.set(record.id, { id: record.id, authorId: record.author_id, createdAt: record.created_at });
      oldestAt = oldestAt === null ? at : Math.min(oldestAt, at);
    }
    const token = asRecord(payload.meta).next_token;
    nextToken = typeof token === "string" && token ? token : null;
    complete = nextToken === null;
  } while (nextToken && posts.size < maxPosts);

  return { ok: true, posts: [...posts.values()], complete, oldestAt, requests, postReads };
}

function countPosts(buckets: SocialActivityBucket[], start: Date, end: Date): number | null {
  if (!buckets.length) return null;
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
): SocialActivityWindow {
  const rows = posts.filter((post) => {
    const at = Date.parse(post.createdAt);
    return at >= start.getTime() && at < end.getTime();
  });
  const authorCoverageComplete = search.ok && (search.complete || (search.oldestAt !== null && search.oldestAt <= start.getTime()));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    postCount: countPosts(buckets, start, end),
    uniqueAccounts: search.ok ? new Set(rows.map((post) => post.authorId)).size : null,
    inspectedPosts: rows.length,
    authorCoverageComplete,
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
  if (!bearer) return unavailableSnapshot(identity, now, "not_configured", "Social activity was not collected because official X search access is not configured.");

  const configuredMax = Number(env("ARGUS_SOCIAL_ACTIVITY_MAX_POSTS") || "200");
  const maxPosts = Math.min(500, Math.max(10, Math.round(options.maxPosts ?? configuredMax)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheWindow = Math.floor(now.getTime() / (15 * 60 * 1000));
  const cacheKey = `social-activity:v1:${identity.query}:${maxPosts}:${cacheWindow}`;
  if (!options.fetchImpl) {
    const cached = await cacheGet(cacheKey, { operation: "social-activity-hit", meta: "15 minute activity snapshot" });
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SocialActivitySnapshot;
        if (parsed.schemaVersion === 1 && parsed.provider === "x-api-v2") return parsed;
      } catch {
        // A malformed cache row is ignored and never becomes report evidence.
      }
    }
  }
  const end = new Date(now.getTime() - 30_000);
  const last24Start = new Date(end.getTime() - DAY_MS);
  const previous24Start = new Date(end.getTime() - 2 * DAY_MS);
  const last7Start = new Date(end.getTime() - 7 * DAY_MS);

  const [counts, search] = await Promise.all([
    collectCounts(fetchImpl, bearer, identity.query, last7Start, end),
    collectSearch(fetchImpl, bearer, identity.query, last7Start, end, maxPosts),
  ]);
  if (!counts.ok && !search.ok) {
    return unavailableSnapshot(identity, now, "provider_failed", "X did not return usable activity data. No zero or clean result was inferred.");
  }

  const last24Hours = windowFrom(search.posts, counts.buckets, last24Start, end, search);
  const previous24Hours = windowFrom(search.posts, counts.buckets, previous24Start, last24Start, search);
  const last7Days = windowFrom(search.posts, counts.buckets, last7Start, end, search);
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
  const snapshot: SocialActivitySnapshot = {
    schemaVersion: 1,
    provider: "x-api-v2",
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
      estimatedUsd: Math.round(((counts.ok ? COUNTS_REQUEST_USD : 0) + search.postReads * POST_READ_USD) * 10000) / 10000,
    },
    note: state === "complete"
      ? "Public X posts matched to the bound project identifiers. Reposts are excluded."
      : `ARGUS inspected ${search.posts.length.toLocaleString()} posts before the configured limit. Unique-account counts are minimums.`,
  };
  if (!options.fetchImpl) void cacheSet(cacheKey, JSON.stringify(snapshot));
  return snapshot;
}
