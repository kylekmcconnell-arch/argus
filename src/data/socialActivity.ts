export type SocialActivityState = "complete" | "partial" | "unavailable";

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
  };
  note: string;
  unavailableReason?: "not_configured" | "invalid_identity" | "provider_failed";
}

export interface SocialActivityScoreInput {
  uniqueAccounts7d: number;
  uniqueAccounts24h: number;
  uniqueAccountsPrevious24h: number;
  top10AccountSharePct: number;
  activeDays: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
