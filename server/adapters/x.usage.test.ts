import { afterEach, describe, expect, it, vi } from "vitest";
import { getCost, withCostLedger } from "../cost";
import {
  checkFollow,
  clearLastTweetsMemo,
  collectCorpus,
  getLastPostAt,
  getProfile,
  getRecentPosts,
  getRecentPostsMeta,
  grokSearch,
  handleHistory,
  notableFollowers,
  publicXAccountState,
  searchAdverseSignals,
} from "./x";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("X provider attempt accounting", () => {
  afterEach(() => {
    clearLastTweetsMemo();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("preserves X's public suspended state instead of flattening it to a missing profile", async () => {
    const state = await publicXAccountState("@driftprotocol", vi.fn().mockResolvedValue(new Response(`
      <main>
        <h2>Account suspended</h2>
        <script>window.__DATA__={"unavailable_reason":"Suspended"}</script>
      </main>
    `, { status: 200 })) as unknown as typeof fetch);

    expect(state).toEqual(expect.objectContaining({
      handle: "@driftprotocol",
      accountStatus: "suspended",
      statusSourceUrl: "https://x.com/driftprotocol",
    }));
    expect(state?.statusCapturedAt).toEqual(expect.any(String));
  });

  it("falls through from a provider 404 to the exact public X terminal state", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ status: "error", message: "user not found" }, 404))
      .mockResolvedValueOnce(new Response("<h2>Account suspended</h2>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await getProfile("@driftprotocol");

    expect(profile).toEqual(expect.objectContaining({
      handle: "@driftprotocol",
      accountStatus: "suspended",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://x.com/driftprotocol");
  });

  it("counts the rejected Grok compatibility call and successful retry", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "unsupported max_tool_calls" }, 400))
      .mockResolvedValueOnce(json({
        output_text: "grounded result",
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await grokSearch("system", "user", { maxToolCalls: 2 });
      return { result, cost: getCost() };
    });

    expect(captured.result).toBe("grounded result");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.grokCalls).toBe(2);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "grok",
      op: "live-search",
      calls: 2,
      succeeded: 1,
      partial: 0,
      failed: 1,
      status: "partial",
      meta: expect.stringContaining("http_400"),
    }));
  });

  it("bypasses both cache reads and writes for live Grok canaries", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "https://cache.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.x.ai/v1/responses");
      return json({
        output_text: "fresh result",
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await grokSearch("system", "user", {
        cacheKey: "live-canary",
        bypassCache: true,
      });
      return { result, cost: getCost() };
    });

    expect(captured.result).toBe("fresh result");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.grokCalls).toBe(1);
    expect(captured.cost.calls.some((call) => call.provider === "cache")).toBe(false);
  });

  it("does not exceed a shared physical-call budget during compatibility fallback", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn().mockResolvedValue(json({ error: "unsupported max_tool_calls" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    let remainingCalls = 1;

    const result = await grokSearch("system", "user", {
      maxToolCalls: 2,
      claimProviderCall: () => remainingCalls-- > 0,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a Grok response parse failure instead of dropping the attempt", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    const captured = await withCostLedger(async () => {
      const result = await grokSearch("system", "user");
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "grok",
      calls: 1,
      failed: 1,
      status: "failed",
      meta: expect.stringContaining("response_json_error"),
    }));
  });

  it("binds every adverse search result to the exact related entity", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      output_text: JSON.stringify({
        signals: [{
          category: "scam_accusation",
          claim: "A complaint names this account.",
          source: "rsbot",
          source_url: "https://example.com/complaint",
        }],
      }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await searchAdverseSignals("@Zhygis", "person", {
      relationship_to_subject: "associate",
      relationship_label: "recorded collaborator of @gakonst",
    });

    expect(result).toEqual([expect.objectContaining({
      category: "scam_accusation",
      target_entity_key: "@zhygis",
      target_entity_type: "person",
      relationship_to_subject: "associate",
      relationship_label: "recorded collaborator of @gakonst",
    })]);
  });

  it("counts every Twitter HTTP retry and derives a partial operation status", async () => {
    vi.useFakeTimers();
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "temporary" }, 503))
      .mockResolvedValueOnce(json({ data: { tweets: [{ text: "hello" }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = withCostLedger(async () => {
      const posts = await getRecentPosts("@argus");
      return { posts, cost: getCost() };
    });
    await vi.runAllTimersAsync();
    const captured = await pending;

    expect(captured.posts).toEqual(["hello"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeoutSpy.mock.calls).toEqual([[10_000], [10_000]]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal === signal)).toBe(true);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "twitterapi",
      op: "user/last_tweets",
      calls: 2,
      succeeded: 1,
      partial: 0,
      failed: 1,
      status: "partial",
      usd: 0.0004,
      meta: expect.stringContaining("http_503"),
    }));
  });

  it("records an unreadable Twitter response as failed", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    const captured = await withCostLedger(async () => {
      const posts = await getRecentPosts("@argus");
      return { posts, cost: getCost() };
    });

    expect(captured.posts).toEqual([]);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "twitterapi",
      calls: 1,
      failed: 1,
      status: "failed",
      meta: expect.stringContaining("response_json_error"),
    }));
  });

  it("normalizes documented nested and legacy flat follow responses without coercing missing fields", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({
        status: "success",
        data: { following: false, followed_by: true },
      }))
      .mockResolvedValueOnce(json({
        following: true,
        isFollowedBy: false,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkFollow("@source", "@target")).resolves.toEqual({
      following: false,
      followedBy: true,
    });
    await expect(checkFollow("source", "target")).resolves.toEqual({
      following: true,
      followedBy: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats the production status=failed follow envelope as unavailable, not schema drift or success", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      status: "failed",
      message: "check follow relationship failed",
    })));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => ({
      result: await checkFollow("@source", "@target"),
      cost: getCost(),
    }));

    expect(captured.result).toBeNull();
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("unrecognized"),
      expect.anything(),
    );
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "twitterapi",
      op: "user/check_follow_relationship",
      calls: 1,
      succeeded: 0,
      failed: 1,
      status: "failed",
      meta: "provider_status_failed",
    }));
  });

  it("counts only observed notable relationships when a reverse-check chunk is partially unavailable", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000) // establish the deadline
      .mockReturnValueOnce(1_000) // allow one chunk
      .mockReturnValue(1_200); // stop before the next chunk
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ status: "success", data: { following: false } }))
      .mockResolvedValueOnce(json({ status: "success", data: { following: true } }))
      .mockResolvedValue(json({ status: "failed", message: "check follow relationship failed" }));
    vi.stubGlobal("fetch", fetchMock);

    const scan = await notableFollowers("@subject", {
      followerCount: Number.POSITIVE_INFINITY,
      budgetMs: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(scan.checked).toBe(2);
    expect(scan.coverage).toBe("partial");
    expect(scan.list).toHaveLength(1);
  });

  it("stops reverse-check fan-out after an entirely unavailable provider chunk", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const fetchMock = vi.fn().mockResolvedValue(json({
      status: "failed",
      message: "check follow relationship failed",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const scan = await notableFollowers("@subject", {
      followerCount: Number.POSITIVE_INFINITY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(scan).toEqual({ list: [], checked: 0, coverage: "unavailable" });
  });

  it("withholds negative enumeration coverage when a follower page returns a failure envelope", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      status: "failed",
      message: "followers lookup failed",
    })));

    const captured = await withCostLedger(async () => ({
      scan: await notableFollowers("@subject", { followerCount: 1 }),
      cost: getCost(),
    }));

    expect(captured.scan).toEqual({ list: [], checked: 0, coverage: "unavailable" });
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "twitterapi",
      op: "user/followers",
      calls: 1,
      succeeded: 0,
      failed: 1,
      status: "failed",
      meta: "provider_status_failed",
    }));
  });

  it("preserves an observed enumeration hit while marking interrupted pagination partial", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({
        followers: [{ userName: "a16zcrypto" }, null],
        has_next_page: true,
        next_cursor: "next-page",
      }))
      .mockResolvedValueOnce(json({
        status: "failed",
        message: "followers lookup failed",
      })));

    const scan = await notableFollowers("@subject", { followerCount: 201 });

    expect(scan).toEqual({
      list: [{ handle: "a16zcrypto", label: "VC · a16z crypto", size: "" }],
      checked: 1,
      coverage: "partial",
    });
  });

  it("stops follower-page enumeration at the shared wall-clock budget and stays partial", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000) // establish the deadline
      .mockReturnValueOnce(1_000) // allow page 1
      .mockReturnValue(1_200); // budget exhausted before page 2
    // Every page succeeds and offers a next cursor: the throttled-but-healthy
    // regime that previously ran up to 152 sequential fetches with no deadline.
    const fetchMock = vi.fn().mockResolvedValue(json({
      followers: [{ userName: "a16zcrypto" }],
      has_next_page: true,
      next_cursor: "next-page",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const scan = await notableFollowers("@subject", { followerCount: 2_000, budgetMs: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scan.coverage).toBe("partial");
    expect(scan.checked).toBe(1);
    expect(scan.list).toEqual([{ handle: "a16zcrypto", label: "VC · a16z crypto", size: "" }]);
  });

  it("serves corpus, last-post-at, and cadence reads from one fetched last_tweets page", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/user/last_tweets")) {
        return json({ data: { tweets: [
          { text: "@friend thanks", createdAt: "2026-07-16T00:00:00.000Z", isReply: true },
          { text: "we are launching", createdAt: "2026-07-10T00:00:00.000Z" },
        ] } });
      }
      return json({ tweets: [] }); // the corpus keyword-search layers
    });
    vi.stubGlobal("fetch", fetchMock);

    const corpus = await collectCorpus("@argus");
    const lastPostAt = await getLastPostAt("@argus");
    const meta = await getRecentPostsMeta("@argus");

    const lastTweetsCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/user/last_tweets"));
    expect(lastTweetsCalls).toHaveLength(1);
    expect(corpus.count.originals).toBe(1);
    // The RAW payload is shared: the reply the corpus drops still counts for dormancy.
    expect(lastPostAt).toBe("2026-07-16T00:00:00.000Z");
    expect(meta).toHaveLength(2);
  });

  it("does not memoize a last_tweets failure envelope, so the next pass refetches", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ status: "error", data: null }))
      .mockResolvedValueOnce(json({ data: { tweets: [{ text: "hello", createdAt: "2026-07-10T00:00:00.000Z" }] } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRecentPosts("@argus")).resolves.toEqual([]);
    await expect(getRecentPosts("@argus")).resolves.toEqual(["hello"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records an unreadable memory.lol response once as failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await handleHistory("@argus"),
      cost: getCost(),
    }));

    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "memory.lol",
      op: "tw-history",
      calls: 1,
      succeeded: 0,
      partial: 0,
      failed: 1,
      status: "failed",
      meta: "response_json_error",
    }));
  });

  it("records a memory.lol account missing history as partial", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ accounts: [{ id_str: "123" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await handleHistory("@argus"),
      cost: getCost(),
    }));

    expect(captured.result).toEqual({ priorHandles: [], idStr: "123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "memory.lol",
      op: "tw-history",
      calls: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      status: "partial",
      meta: "screen_names_missing",
    }));
  });
});
