import { SocialActivityPanel } from "../components/SocialActivityPanel";
import type { SocialActivitySnapshot } from "../data/socialActivity";

const capturedAt = "2026-08-22T21:00:00.000Z";

const hourlyPostCounts = [
  42, 38, 31, 26, 19, 17, 24, 36, 51, 65, 72, 83,
  91, 86, 79, 73, 68, 77, 88, 94, 102, 96, 84, 71,
].map((postCount, hour) => {
  const start = new Date(Date.parse(capturedAt) - (23 - hour) * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), postCount };
});

const previewSnapshot: SocialActivitySnapshot = {
  schemaVersion: 1,
  provider: "x-api-v2",
  state: "complete",
  capturedAt,
  sourceUrl: "https://x.com/search?q=%40clutchmarkets",
  queryBasis: {
    handle: "clutchmarkets",
    ticker: "CLUTCH",
    projectName: "CLUTCH",
    query: '(@clutchmarkets OR $CLUTCH OR "CLUTCH") -is:retweet',
    excludesReposts: true,
  },
  windows: {
    last24Hours: {
      start: "2026-08-21T21:00:00.000Z",
      end: capturedAt,
      postCount: 1_284,
      uniqueAccounts: 238,
      inspectedPosts: 1_284,
      authorCoverageComplete: true,
    },
    previous24Hours: {
      start: "2026-08-20T21:00:00.000Z",
      end: "2026-08-21T21:00:00.000Z",
      postCount: 904,
      uniqueAccounts: 168,
      inspectedPosts: 904,
      authorCoverageComplete: true,
    },
    last7Days: {
      start: "2026-08-15T21:00:00.000Z",
      end: capturedAt,
      postCount: 3_912,
      uniqueAccounts: 1_284,
      inspectedPosts: 3_912,
      authorCoverageComplete: true,
    },
  },
  hourlyPostCounts,
  top10AccountSharePct: 18,
  activeDays: 7,
  activityScore: 78,
  scoreVersion: "social-activity-v1",
  collection: {
    countsRequestCompleted: true,
    searchRequests: 8,
    postReads: 3_912,
    maxPosts: 5_000,
    estimatedUsd: 19.61,
  },
  note: "Counts come from X's recent-search API and exclude reposts.",
  mentioners: [
    {
      postId: "1",
      handle: "@whale",
      displayName: "Whale",
      text: "Clutch Markets is getting loud today.",
      tweetUrl: "https://x.com/whale/status/1",
      createdAt: capturedAt,
      followers: 880_000,
      avatarUrl: "https://pbs.twimg.com/profile_images/1/whale.jpg",
    },
    {
      postId: "2",
      handle: "@quiet",
      text: "watching $CLUTCH",
      tweetUrl: "https://x.com/quiet/status/2",
      createdAt: capturedAt,
    },
  ],
};

export function SocialActivityPreview() {
  return (
    <main className="min-h-screen bg-void px-4 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-5">
          <p className="eyebrow text-signal-lift">Report section preview</p>
          <h1 className="display mt-1 text-[32px] text-ink">CLUTCH</h1>
          <p className="mt-2 text-[13.5px] text-ink-dim">Public conversation captured with this saved report.</p>
        </header>
        <SocialActivityPanel snapshot={previewSnapshot} />
      </div>
    </main>
  );
}
