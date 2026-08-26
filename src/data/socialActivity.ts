export type SocialActivityState = "complete" | "partial" | "unavailable";
export type SocialActivityIncompleteReason = "post_limit" | "provider_error" | "pagination_incomplete" | "time_budget";

export interface SocialActivityWindow {
  start: string;
  end: string;
  /** Exact X counts-endpoint result when that endpoint completed. */
  postCount: number | null;
  /** Distinct author IDs observed in the search window. */
  uniqueAccounts: number | null;
  /** Number of post records inspected to derive author breadth. */
  inspectedPosts: number;
  /** False means uniqueAccounts is a floor over the inspected post set. */
  authorCoverageComplete: boolean;
}

export interface SocialActivityBucket {
  start: string;
  end: string;
  postCount: number;
}

/** One collected post that mentioned this bound subject. Fields are provider-supplied only. */
export interface SocialActivityMentionCandidate {
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

/** Largest mentioner card persisted with the snapshot. Never scored. */
export interface SocialActivityMention {
  postId: string;
  handle: string;
  displayName?: string;
  text: string;
  tweetUrl: string;
  createdAt: string;
  /** Present only when the provider returned a follower count. Never invented. */
  followers?: number;
  /** Official X CDN URL when the provider returned one. Not identity proof. */
  avatarUrl?: string;
}

export const SOCIAL_MENTION_CARD_MAX = 8;

export interface SocialActivityMentionSelection {
  posts: SocialActivityMentionCandidate[];
  subjectHandle: string;
  limit?: number;
}

export interface SocialActivitySnapshot {
  schemaVersion: 1;
  provider: "x-api-v2" | "twitterapi-io";
  state: SocialActivityState;
  capturedAt: string;
  sourceUrl: string;
  queryBasis: {
    handle: string;
    ticker?: string;
    projectName?: string;
    query: string;
    excludesReposts: true;
  };
  windows: {
    last24Hours: SocialActivityWindow;
    previous24Hours: SocialActivityWindow;
    last7Days: SocialActivityWindow;
  };
  hourlyPostCounts: SocialActivityBucket[];
  top10AccountSharePct: number | null;
  activeDays: number | null;
  /** Activity and breadth only. This never enters the safety score. */
  activityScore: number | null;
  scoreVersion: "social-activity-v1";
  collection: {
    countsRequestCompleted: boolean;
    searchRequests: number;
    postReads: number;
    maxPosts: number;
    estimatedUsd: number;
    /** Why author coverage is incomplete. Absent on complete and legacy snapshots. */
    incompleteReason?: SocialActivityIncompleteReason;
  };
  note: string;
  unavailableReason?: "not_configured" | "invalid_identity" | "provider_failed";
  /**
   * Largest public accounts that mentioned THIS bound query. Ranked by
   * provider-returned followers. Absent on legacy snapshots.
   */
  mentioners?: SocialActivityMention[];
}

export interface SocialActivityScoreInput {
  uniqueAccounts7d: number;
  uniqueAccounts24h: number;
  uniqueAccountsPrevious24h: number;
  top10AccountSharePct: number;
  activeDays: number;
}

export interface ObservedSocialActivityLevel {
  label: "Quiet" | "Emerging" | "Active" | "High";
  detail: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * A plain-language reading of the conversation ARGUS actually observed.
 * Unlike the numeric activity score, this does not require a complete author
 * register or an account-concentration calculation. It is intentionally a
 * broad volume tier, never a quality, sentiment, safety, or influence score.
 */
export function observedSocialActivityLevel(
  snapshot: Pick<SocialActivitySnapshot, "windows">,
): ObservedSocialActivityLevel | null {
  const accounts = snapshot.windows.last7Days.uniqueAccounts;
  const posts = snapshot.windows.last7Days.postCount;
  if (accounts === null && posts === null) return null;
  const breadth = Math.max(0, accounts ?? 0);
  const volume = Math.max(0, posts ?? 0);
  const label: ObservedSocialActivityLevel["label"] = breadth >= 500 || volume >= 2_000
    ? "High"
    : breadth >= 100 || volume >= 300
      ? "Active"
      : breadth >= 20 || volume >= 60
        ? "Emerging"
        : "Quiet";
  return {
    label,
    detail: "Observed conversation volume; not project quality or safety.",
  };
}

export function normalizedSocialHandle(value?: string | null): string | null {
  const handle = value?.trim().replace(/^@/, "") ?? "";
  return HANDLE.test(handle) ? handle.toLowerCase() : null;
}

function tweetPermalink(handle: string, postId: string, rawUrl?: string): string | null {
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:")
        && (host === "x.com" || host === "www.x.com" || host === "twitter.com" || host === "www.twitter.com")
        && /\/status\/\d+/i.test(parsed.pathname)
        && !parsed.username
        && !parsed.password
      ) return parsed.href;
    } catch {
      // Fall through to a constructed permalink when the provider URL is unusable.
    }
  }
  return /^\d+$/.test(postId) || /^[A-Za-z0-9]+$/.test(postId)
    ? `https://x.com/${handle}/status/${postId}`
    : null;
}

/**
 * Rank collected mention posts for the people-card board. Only posts already
 * matched to this subject query are eligible. The subject's own account is
 * excluded. Follower counts are never invented; posts without one still render
 * and sort last.
 */
export function selectSocialMentioners(
  posts: SocialActivityMentionCandidate[],
  subjectHandle: string,
  limit = SOCIAL_MENTION_CARD_MAX,
): SocialActivityMention[] {
  const subject = normalizedSocialHandle(subjectHandle);
  const byHandle = new Map<string, SocialActivityMention>();
  for (const post of posts) {
    const handle = normalizedSocialHandle(post.handle);
    if (!handle || handle === subject) continue;
    const text = post.text?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) continue;
    const tweetUrl = tweetPermalink(handle, post.id, post.tweetUrl);
    if (!tweetUrl) continue;
    const createdAt = post.createdAt;
    const candidate: SocialActivityMention = {
      postId: post.id,
      handle: `@${handle}`,
      ...(post.displayName?.trim() ? { displayName: post.displayName.trim() } : {}),
      text,
      tweetUrl,
      createdAt,
      ...(typeof post.followers === "number" && Number.isFinite(post.followers) && post.followers >= 0
        ? { followers: Math.round(post.followers) }
        : {}),
      ...(post.avatarUrl ? { avatarUrl: post.avatarUrl } : {}),
    };
    const prior = byHandle.get(handle);
    if (!prior) {
      byHandle.set(handle, candidate);
      continue;
    }
    const priorFollowers = prior.followers;
    const nextFollowers = candidate.followers;
    const richerFollowers = (nextFollowers ?? -1) > (priorFollowers ?? -1);
    const sameFollowers = nextFollowers === priorFollowers
      || (nextFollowers === undefined && priorFollowers === undefined);
    const newer = Date.parse(candidate.createdAt) > Date.parse(prior.createdAt);
    if (richerFollowers || (sameFollowers && newer)) byHandle.set(handle, candidate);
  }
  return [...byHandle.values()]
    .sort((left, right) => {
      const leftFollowers = left.followers;
      const rightFollowers = right.followers;
      if (leftFollowers !== undefined && rightFollowers !== undefined && leftFollowers !== rightFollowers) {
        return rightFollowers - leftFollowers;
      }
      if (leftFollowers !== undefined && rightFollowers === undefined) return -1;
      if (leftFollowers === undefined && rightFollowers !== undefined) return 1;
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })
    .slice(0, Math.max(0, Math.min(SOCIAL_MENTION_CARD_MAX, Math.round(limit))));
}

/**
 * A deterministic activity index, deliberately separate from every ARGUS
 * safety and investment score. Breadth carries most of the index; momentum,
 * distribution and persistence can move it but cannot substitute for people.
 */
export function socialActivityScore(input: SocialActivityScoreInput): number {
  const breadth = clamp(Math.log10(input.uniqueAccounts7d + 1) / Math.log10(1001), 0, 1) * 50;
  const prior = Math.max(1, input.uniqueAccountsPrevious24h);
  const momentumPct = ((input.uniqueAccounts24h - input.uniqueAccountsPrevious24h) / prior) * 100;
  const momentum = clamp((momentumPct + 50) / 150, 0, 1) * 15;
  const distribution = (1 - clamp(input.top10AccountSharePct, 0, 100) / 100) * 25;
  const persistence = clamp(input.activeDays, 0, 7) / 7 * 10;
  return Math.round(clamp(breadth + momentum + distribution + persistence, 0, 100));
}
