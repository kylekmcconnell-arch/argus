import { describe, expect, it, vi } from "vitest";
import { buildSocialActivityQuery, collectSocialActivity } from "./socialActivity";

const NOW = new Date("2026-08-22T22:00:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("social activity collector", () => {
  it("builds a bounded project query from the official identifiers", () => {
    expect(buildSocialActivityQuery({ handle: "@clutch", ticker: "$clutch", projectName: "Clutch Markets" })).toEqual({
      handle: "@clutch",
      ticker: "$CLUTCH",
      projectName: "Clutch Markets",
      query: '(@clutch OR $CLUTCH OR "Clutch Markets") -is:retweet',
    });
    expect(buildSocialActivityQuery({ handle: "not a handle" })).toBeNull();
  });

  it("freezes exact counts, unique authors, concentration, and an activity-only score", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/counts/recent")) {
        return response({ data: [
          { start: "2026-08-20T20:00:00.000Z", end: "2026-08-20T21:00:00.000Z", tweet_count: 2 },
          { start: "2026-08-21T20:00:00.000Z", end: "2026-08-21T21:00:00.000Z", tweet_count: 3 },
          { start: "2026-08-22T20:00:00.000Z", end: "2026-08-22T21:00:00.000Z", tweet_count: 4 },
        ] });
      }
      return response({
        data: [
          { id: "1", author_id: "a", created_at: "2026-08-22T21:00:00.000Z" },
          { id: "2", author_id: "b", created_at: "2026-08-22T20:00:00.000Z" },
          { id: "3", author_id: "a", created_at: "2026-08-21T20:30:00.000Z" },
          { id: "4", author_id: "c", created_at: "2026-08-20T20:30:00.000Z" },
        ],
        meta: { result_count: 4 },
      });
    }) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@clutch", ticker: "CLUTCH", projectName: "Clutch Markets" },
      { now: NOW, bearer: "test", fetchImpl },
    );

    expect(snapshot.state).toBe("complete");
    expect(snapshot.windows.last24Hours).toMatchObject({ postCount: 4, uniqueAccounts: 2, authorCoverageComplete: true });
    expect(snapshot.windows.previous24Hours).toMatchObject({ postCount: 3, uniqueAccounts: 1, authorCoverageComplete: true });
    expect(snapshot.windows.last7Days).toMatchObject({ postCount: 9, uniqueAccounts: 3, authorCoverageComplete: true });
    expect(snapshot.top10AccountSharePct).toBe(100);
    expect(snapshot.activityScore).not.toBeNull();
    expect(snapshot.queryBasis.excludesReposts).toBe(true);
  });

  it("publishes author counts as floors and withholds the score when the page cap bites", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      author_id: `author-${index}`,
      created_at: `2026-08-22T20:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/counts/recent")
        ? response({ data: [{ start: "2026-08-22T20:00:00.000Z", end: "2026-08-22T21:00:00.000Z", tweet_count: 120 }] })
        : response({ data: rows, meta: { result_count: 10, next_token: "more" } });
    }) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@clutch" },
      { now: NOW, bearer: "test", fetchImpl, maxPosts: 10 },
    );

    expect(snapshot.state).toBe("partial");
    expect(snapshot.windows.last24Hours.uniqueAccounts).toBe(10);
    expect(snapshot.windows.last24Hours.authorCoverageComplete).toBe(false);
    expect(snapshot.activityScore).toBeNull();
    expect(snapshot.note).toContain("minimums");
    expect(snapshot.collection.incompleteReason).toBe("post_limit");
  });

  it("does not turn a missing credential into zero activity", async () => {
    const snapshot = await collectSocialActivity({ handle: "@clutch" }, { now: NOW, bearer: null, twitterApiKey: null });
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.unavailableReason).toBe("not_configured");
    expect(snapshot.windows.last24Hours.postCount).toBeNull();
    expect(snapshot.windows.last24Hours.uniqueAccounts).toBeNull();
    expect(snapshot.activityScore).toBeNull();
  });

  it("uses the configured twitterapi.io search key when the official bearer is absent", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/twitter/tweet/advanced_search");
      expect(url.searchParams.get("query")).toContain("since_time:");
      expect(url.searchParams.get("query")).not.toContain("-is:retweet");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("existing-key");
      return response({ tweets: [], has_next_page: false, next_cursor: "" });
    }) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@clutch", ticker: "CLUTCH", projectName: "Clutch Markets" },
      { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 40 },
    );

    expect(snapshot.provider).toBe("twitterapi-io");
    expect(snapshot.state).toBe("complete");
    expect(snapshot.windows.last24Hours).toMatchObject({ postCount: 0, uniqueAccounts: 0, authorCoverageComplete: true });
    expect(snapshot.activityScore).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(28);
  });

  it("follows twitterapi.io cursors before moving to the next time slice", async () => {
    let firstSlice = true;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get("cursor");
      if (firstSlice && !cursor) {
        firstSlice = false;
        return response({
          tweets: [{
            id: "page-1",
            author: { id: "author-1" },
            createdAt: "2026-08-22T21:00:00.000Z",
            text: "SuperGemma",
          }],
          has_next_page: true,
          next_cursor: "cursor-2",
        });
      }
      if (cursor === "cursor-2") {
        return response({
          tweets: [{
            id: "page-2",
            author: { id: "author-2" },
            createdAt: "2026-08-22T20:00:00.000Z",
            text: "SuperGemma",
          }],
          has_next_page: false,
          next_cursor: "",
        });
      }
      return response({ tweets: [], has_next_page: false, next_cursor: "" });
    });
    const fetchImpl = fetchMock as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@0xsupergemma", ticker: "SUPERGEMMA", projectName: "SuperGemma" },
      { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 40 },
    );

    expect(snapshot.state).toBe("complete");
    expect(snapshot.collection.incompleteReason).toBeUndefined();
    expect(snapshot.collection.searchRequests).toBe(29);
    expect(snapshot.windows.last24Hours).toMatchObject({
      postCount: 2,
      uniqueAccounts: 2,
      authorCoverageComplete: true,
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("cursor=cursor-2"))).toBe(true);
  });

  it("persists twitterapi.io handle, text, followers, and avatar so mentioners can be ranked", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (!url.searchParams.get("cursor") && url.searchParams.get("query")?.includes("until_time:")) {
        return response({
          tweets: [
            {
              id: "9001",
              text: "Largest mention of Clutch Markets",
              url: "https://x.com/whale/status/9001",
              createdAt: "2026-08-22T21:00:00.000Z",
              author: {
                id: "author-whale",
                userName: "whale",
                name: "Whale",
                followers: 880_000,
                profilePicture: "https://pbs.twimg.com/profile_images/1/whale.jpg",
              },
            },
            {
              id: "9002",
              text: "Our own launch thread",
              createdAt: "2026-08-22T21:10:00.000Z",
              author: {
                id: "author-self",
                userName: "clutch",
                followers: 2_000_000,
                profilePicture: "https://pbs.twimg.com/profile_images/1/self.jpg",
              },
            },
            {
              id: "9003",
              text: "RT @whale: Largest mention of Clutch Markets",
              createdAt: "2026-08-22T21:20:00.000Z",
              author: { id: "author-rt", userName: "reposter", followers: 500_000 },
            },
            {
              id: "9004",
              text: "Smaller mention",
              createdAt: "2026-08-22T20:00:00.000Z",
              author: { id: "author-mid", userName: "midsize", followers: 12_000 },
            },
            {
              id: "9005",
              text: "No follower field, still a real mention",
              createdAt: "2026-08-22T19:00:00.000Z",
              author: { id: "author-quiet", userName: "quiet" },
            },
          ],
          has_next_page: false,
          next_cursor: "",
        });
      }
      return response({ tweets: [], has_next_page: false, next_cursor: "" });
    }) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@clutch", ticker: "CLUTCH", projectName: "Clutch Markets" },
      { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 40 },
    );

    expect(snapshot.mentioners?.map((row) => row.handle)).toEqual(["@whale", "@midsize", "@quiet"]);
    expect(snapshot.mentioners?.[0]).toMatchObject({
      postId: "9001",
      text: "Largest mention of Clutch Markets",
      tweetUrl: "https://x.com/whale/status/9001",
      followers: 880_000,
      avatarUrl: "https://pbs.twimg.com/profile_images/1/whale.jpg",
    });
    expect(snapshot.mentioners?.[2].followers).toBeUndefined();
    expect(JSON.stringify(snapshot.mentioners)).not.toContain("influence");
    expect(snapshot.mentioners?.some((row) => row.handle === "@clutch")).toBe(false);
  });

  it("records a provider pagination gap instead of calling it a post limit", async () => {
    const fetchImpl = vi.fn(async () => response({
      tweets: [],
      has_next_page: true,
      next_cursor: "",
    })) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@0xsupergemma" },
      { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 40 },
    );

    expect(snapshot.state).toBe("partial");
    expect(snapshot.collection.postReads).toBe(0);
    expect(snapshot.collection.incompleteReason).toBe("pagination_incomplete");
    expect(snapshot.note).toContain("more result pages");
    expect(snapshot.note).not.toContain("configured limit");
  });

  it("defaults the inspected-post ceiling to 5,000 and keeps a floor of 10", async () => {
    const previous = process.env.ARGUS_SOCIAL_ACTIVITY_MAX_POSTS;
    delete process.env.ARGUS_SOCIAL_ACTIVITY_MAX_POSTS;
    const fetchImpl = vi.fn(async () => response({ tweets: [], has_next_page: false, next_cursor: "" })) as typeof fetch;
    try {
      const snapshot = await collectSocialActivity(
        { handle: "@clutch" },
        { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl },
      );
      expect(snapshot.collection.maxPosts).toBe(5_000);

      const clamped = await collectSocialActivity(
        { handle: "@clutch" },
        { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 99_999 },
      );
      expect(clamped.collection.maxPosts).toBe(5_000);

      const floored = await collectSocialActivity(
        { handle: "@clutch" },
        { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 1 },
      );
      expect(floored.collection.maxPosts).toBe(10);
    } finally {
      if (previous === undefined) delete process.env.ARGUS_SOCIAL_ACTIVITY_MAX_POSTS;
      else process.env.ARGUS_SOCIAL_ACTIVITY_MAX_POSTS = previous;
    }
  });

  it("can collect 5,000 twitterapi.io posts without pagination_incomplete becoming the hidden cap", async () => {
    const pageSize = 20;
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      const start = page * pageSize;
      page += 1;
      return response({
        tweets: Array.from({ length: pageSize }, (_, index) => ({
          id: `busy-${start + index}`,
          author: { id: `author-${(start + index) % 400}` },
          createdAt: "2026-08-22T20:30:00.000Z",
          text: "busy account mention",
        })),
        has_next_page: true,
        next_cursor: `cursor-${page}`,
      });
    }) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@clutch" },
      { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 5_000 },
    );

    expect(snapshot.provider).toBe("twitterapi-io");
    expect(snapshot.collection.maxPosts).toBe(5_000);
    expect(snapshot.windows.last7Days.inspectedPosts).toBe(5_000);
    expect(snapshot.collection.searchRequests).toBeGreaterThan(100);
    expect(snapshot.collection.incompleteReason).toBe("post_limit");
    expect(snapshot.activityScore).toBeNull();
    expect(snapshot.note).toContain("maximum 5,000 posts");
    expect(snapshot.note).toContain("minimums");
  });
});
