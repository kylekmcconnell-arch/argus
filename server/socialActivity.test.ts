import { describe, expect, it, vi } from "vitest";
import { buildSocialActivityQuery, collectSocialActivity } from "./socialActivity";
import { selectSocialAdverseMentions } from "../src/data/socialActivity";

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

  it("adds an exact verified contract to the subject-bound search", () => {
    const contract = "HG3sZ52NRmNpm2BueL1MSBM3krr5M6YJtQohjNyhpump";
    expect(buildSocialActivityQuery({
      handle: "@bandoscash",
      ticker: "BANDOS",
      projectName: "Bandos",
      contractAddress: contract,
    })?.query).toBe(`(@bandoscash OR $BANDOS OR "${contract}") -is:retweet`);
    expect(buildSocialActivityQuery({ handle: "@bandoscash", contractAddress: "not-a-contract" })?.query)
      .toBe("(@bandoscash) -is:retweet");
  });

  it("preserves direct Bandos warnings and separates specific claims from unsupported warnings", () => {
    const warnings = selectSocialAdverseMentions([
      {
        id: "2093131220574179642",
        authorId: "hunter",
        handle: "devs_hunter",
        displayName: "Devs Hunter",
        createdAt: "2026-08-27T20:10:00.000Z",
        followers: 7_219,
        text: "SCAM token, don't buy. 58.3% bundled in 38 fresh wallets from the same funding source and deployer; 26 wallets hold 24.6%.",
        tweetUrl: "https://x.com/devs_hunter/status/2093131220574179642?s=20",
      },
      {
        id: "2093127354214195480",
        authorId: "disciple",
        handle: "0xdisciplee",
        createdAt: "2026-08-27T20:00:00.000Z",
        followers: 584,
        text: "The same dev previously rugged another token and launched $BANDOS.",
      },
      {
        id: "2093130161227223433",
        authorId: "peet",
        handle: "Crypto_peet",
        createdAt: "2026-08-27T20:05:00.000Z",
        followers: 12_529,
        text: "$bandos is a larp",
      },
      {
        id: "safe",
        authorId: "reader",
        handle: "reader",
        createdAt: "2026-08-27T20:04:00.000Z",
        text: "Reading the Bandos product announcement.",
      },
      {
        id: "self",
        authorId: "self",
        handle: "bandoscash",
        createdAt: "2026-08-27T20:03:00.000Z",
        text: "Beware of fake BANDOS contracts.",
      },
    ], "@bandoscash");

    expect(warnings.map((warning) => warning.postId)).toEqual([
      "2093131220574179642",
      "2093127354214195480",
      "2093130161227223433",
    ]);
    expect(warnings[0]).toMatchObject({ category: "wallet_cluster", specificity: "specific", followers: 7_219 });
    expect(warnings[1]).toMatchObject({ category: "operator_history", specificity: "specific" });
    expect(warnings[2]).toMatchObject({ category: "general_warning", specificity: "general" });
  });

  it("does not OR a quoted project name that is the ticker or a short generic word", () => {
    const earn = buildSocialActivityQuery({ handle: "@earnonhood", ticker: "EARN", projectName: "EARN" });
    expect(earn).not.toBeNull();
    expect(earn!.query).toContain("@earnonhood");
    expect(earn!.query).toContain("$EARN");
    expect(earn!.query).not.toContain('"EARN"');
    expect(earn!.query).toBe("(@earnonhood OR $EARN) -is:retweet");

    const clutchTickerName = buildSocialActivityQuery({ handle: "@clutch", ticker: "CLUTCH", projectName: "CLUTCH" });
    expect(clutchTickerName?.query).toBe("(@clutch OR $CLUTCH) -is:retweet");
    expect(clutchTickerName?.query).not.toContain('"CLUTCH"');

    const moon = buildSocialActivityQuery({ handle: "@moonproject", projectName: "MOON" });
    expect(moon?.query).toBe("(@moonproject) -is:retweet");
    expect(moon?.query).not.toContain('"MOON"');

    const distinctive = buildSocialActivityQuery({ handle: "@projectbtc", ticker: "BTC", projectName: "Bitcoin" });
    expect(distinctive?.query).toBe('(@projectbtc OR $BTC OR "Bitcoin") -is:retweet');
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
    expect(snapshot.collection.searchRequests).toBe(2);
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

  it("stops pagination at the scan deadline and withholds the activity score", async () => {
    let pages = 0;
    const fetchImpl = vi.fn(async () => {
      pages += 1;
      return response({
        tweets: [{
          id: `page-${pages}`,
          author: { id: `author-${pages}`, userName: `acct${pages}`, followers: 10 },
          createdAt: "2026-08-22T20:30:00.000Z",
          text: "mentioned @clutch",
        }],
        has_next_page: true,
        next_cursor: `cursor-${pages}`,
      });
    }) as typeof fetch;

    const snapshot = await collectSocialActivity(
      { handle: "@clutch" },
      { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 5_000, deadlineAt: Date.now() - 1 },
    );

    expect(snapshot.state).toBe("partial");
    expect(snapshot.collection.incompleteReason).toBe("time_budget");
    expect(snapshot.activityScore).toBeNull();
    expect(snapshot.note).toContain("required checks");
    expect(snapshot.note).toContain("minimums");
    expect(pages).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps collected mentioners from a tightened query and still withholds the score when time runs out mid-search", async () => {
    const start = 1_700_000_000_000;
    let nowMs = start;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    let pages = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input;
      pages += 1;
      nowMs += 30_000;
      return response({
        tweets: [{
          id: `900${pages}`,
          text: pages === 1 ? "watching @earnonhood" : "another @earnonhood mention",
          createdAt: pages === 1 ? "2026-08-22T21:00:00.000Z" : "2026-08-22T20:00:00.000Z",
          author: {
            id: pages === 1 ? "author-whale" : "author-mid",
            userName: pages === 1 ? "whale" : "midsize",
            followers: pages === 1 ? 880_000 : 12_000,
          },
        }],
        has_next_page: true,
        next_cursor: `cursor-${pages + 1}`,
      });
    });
    const fetchImpl = fetchMock as typeof fetch;

    try {
      const snapshot = await collectSocialActivity(
        { handle: "@earnonhood", ticker: "EARN", projectName: "EARN" },
        { now: NOW, bearer: null, twitterApiKey: "existing-key", fetchImpl, maxPosts: 5_000, deadlineAt: start + 20_000 },
      );

      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("earnonhood"))).toBe(true);
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("%22EARN%22"))).toBe(false);
      expect(snapshot.mentioners?.map((row) => row.handle)).toEqual(["@whale"]);
      expect(snapshot.activityScore).toBeNull();
      expect(snapshot.collection.incompleteReason).toBe("time_budget");
      expect(pages).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
