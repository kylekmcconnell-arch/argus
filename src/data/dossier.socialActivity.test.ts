import { describe, expect, it } from "vitest";
import { assembleDossier } from "./dossier";
import { emptyEvidence } from "./evidence";
import type { SocialActivitySnapshot } from "./socialActivity";

describe("social activity dossier persistence", () => {
  it("freezes the captured snapshot without letting later evidence mutation rewrite it", () => {
    const evidence = emptyEvidence("@clutch");
    const snapshot: SocialActivitySnapshot = {
      schemaVersion: 1,
      provider: "x-api-v2",
      state: "partial",
      capturedAt: "2026-08-22T21:40:00.000Z",
      sourceUrl: "https://x.com/search?q=clutch",
      queryBasis: { handle: "@clutch", query: "@clutch -is:retweet", excludesReposts: true },
      windows: {
        last24Hours: { start: "2026-08-21T21:39:30.000Z", end: "2026-08-22T21:39:30.000Z", postCount: 100, uniqueAccounts: 40, inspectedPosts: 80, authorCoverageComplete: false },
        previous24Hours: { start: "2026-08-20T21:39:30.000Z", end: "2026-08-21T21:39:30.000Z", postCount: 80, uniqueAccounts: 30, inspectedPosts: 60, authorCoverageComplete: false },
        last7Days: { start: "2026-08-15T21:39:30.000Z", end: "2026-08-22T21:39:30.000Z", postCount: 500, uniqueAccounts: 120, inspectedPosts: 200, authorCoverageComplete: false },
      },
      hourlyPostCounts: [{ start: "2026-08-22T20:00:00.000Z", end: "2026-08-22T21:00:00.000Z", postCount: 20 }],
      top10AccountSharePct: null,
      activeDays: 7,
      activityScore: null,
      scoreVersion: "social-activity-v1",
      collection: { countsRequestCompleted: true, searchRequests: 2, postReads: 200, maxPosts: 200, estimatedUsd: 1.005 },
      note: "Unique-account counts are minimums.",
    };
    evidence.socialActivity = snapshot;

    const dossier = assembleDossier(evidence, true);
    snapshot.windows.last24Hours.uniqueAccounts = 999;
    snapshot.hourlyPostCounts[0].postCount = 999;

    expect(dossier.socialActivity?.windows.last24Hours.uniqueAccounts).toBe(40);
    expect(dossier.socialActivity?.hourlyPostCounts[0].postCount).toBe(20);
  });
});
