import { afterEach, describe, expect, it, vi } from "vitest";
import { getCost, withCostLedger } from "../cost";
import {
  checkFollow,
  clearLastTweetsMemo,
  collectCorpus,
  findTeam,
  generalWebSearch,
  getLastPostAt,
  getProfile,
  getRecentPosts,
  getRecentPostsMeta,
  grokSearch,
  handleHistory,
  notableFollowers,
  publicXAccountState,
  searchAdverseSignals,
  resetFollowScanMemo,
} from "./x";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("X provider attempt accounting", () => {
  afterEach(() => {
    clearLastTweetsMemo();
    // Module-level scan memo: without this, one case's follow answer is served
    // to the next, and a test asserting an unavailable provider gets an answer.
    resetFollowScanMemo();
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

  it("classifies a non-terminal X page as temporarily unavailable, not a missing account", async () => {
    const state = await publicXAccountState("@driftprotocol", vi.fn().mockResolvedValue(new Response(
      "<html><body>Something went wrong. Try reloading.</body></html>",
      { status: 200 },
    )) as unknown as typeof fetch);

    expect(state).toEqual(expect.objectContaining({
      handle: "@driftprotocol",
      accountStatus: "temporarily_unavailable",
      statusSourceUrl: "https://x.com/driftprotocol",
    }));
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

  it("keeps every twitterapi website and entity URL, not just the first", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        name: "CLUTCH",
        followers: 12_000,
        description: "token at stonkbrokers.cash",
        entities: {
          url: { urls: [{ expanded_url: "https://clutch.markets/" }] },
          description: { urls: [{ expanded_url: "https://stonkbrokers.cash/" }] },
        },
      },
    })));

    const profile = await getProfile("@CLUTCHMARKETS");

    expect(profile).toEqual(expect.objectContaining({
      handle: "@CLUTCHMARKETS",
      accountStatus: "active",
      website: "https://clutch.markets/",
      officialWebsites: ["https://clutch.markets/", "https://stonkbrokers.cash/"],
    }));
  });

  it("counts the rejected Grok compatibility call and successful retry", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "unsupported max_tool_calls" }, 400))
      .mockResolvedValueOnce(json({
        output_text: "grounded result",
        output: [{ type: "web_search_call" }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          num_server_side_tools_used: 1,
          cost_in_usd_ticks: 62_000_000,
        },
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
      usd: 0.0062,
      meta: expect.stringContaining("http_400"),
    }));
    expect(captured.cost.calls.find((line) => line.provider === "grok")?.meta)
      .toContain("exact xAI cost");
  });

  it("falls through to Grok when every grounded search request is rejected", async () => {
    vi.stubEnv("SERPER_API_KEY", "rejected-key");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "off");
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("serper")) return json({ message: "Unauthorized" }, 403);
      if (url.includes("api.anthropic.com")) throw new Error("Claude must not run with fallbacks off");
      if (url.includes("api.x.ai/v1/chat/completions")) {
        return json({ choices: [{ message: { content: '["one exact query"]' } }] });
      }
      expect(url).toBe("https://api.x.ai/v1/responses");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        tools: [{ type: "web_search" }],
      });
      return json({
        output_text: "GROK FALLBACK",
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await generalWebSearch("system", "user");

    expect(result).toBe("GROK FALLBACK");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses Claude web_search only when fallbacks are on and Grok is unset", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
    delete process.env.XAI_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/messages");
      return json({
        content: [{ type: "text", text: "CLAUDE FALLBACK" }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await generalWebSearch("system", "user");

    expect(result).toBe("CLAUDE FALLBACK");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    expect(result.completed).toBe(true);
    expect(result.signals).toEqual([expect.objectContaining({
      category: "scam_accusation",
      target_entity_key: "@zhygis",
      target_entity_type: "person",
      relationship_to_subject: "associate",
      relationship_label: "recorded collaborator of @gakonst",
    })]);
  });

  it("reports an unreadable adverse answer as a screen that did not run", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    // The provider answered, but not with the JSON the prompt asked for. We
    // cannot tell whether it found nothing, so the screen did not complete.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      output_text: "I could not complete that search right now.",
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await searchAdverseSignals("@Zhygis", "person", { relationship_to_subject: "self" });

    expect(result).toEqual({ completed: false, signals: [] });
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

    // Distinct pairs: the point here is that BOTH envelope shapes parse, and a
    // repeat of the same pair is now answered from the scan memo rather than
    // bought twice, which is asserted in x.followMemo.test.ts.
    await expect(checkFollow("@source", "@target")).resolves.toEqual({
      following: false,
      followedBy: true,
    });
    await expect(checkFollow("@legacy", "@target")).resolves.toEqual({
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
      // One real row was read and a null entry was not. The row answered no
      // audience question, so every dimension stays at zero measured.
      audience: {
        profilesExamined: 1,
        sampleIsComplete: false,
        creation: { measured: 0 },
        posts: { measured: 0, zeroPosts: 0 },
        avatar: { measured: 0, defaultAvatar: 0 },
        bio: { measured: 0, empty: 0 },
        starterProfile: { measured: 0, accounts: 0 },
        followRatio: { measured: 0, followingHeavy: 0, balanced: 0, followerHeavy: 0 },
      },
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
          { id: "123456", text: "we are launching", createdAt: "2026-07-10T00:00:00.000Z" },
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
    expect(corpus.posts[0]).toContain("[Source: https://x.com/argus/status/123456]");
    // The RAW payload is shared: the reply the corpus drops still counts for dormancy.
    expect(lastPostAt).toBe("2026-07-16T00:00:00.000Z");
    expect(meta).toHaveLength(2);
  });

  it("reuses the intake team search instead of buying the same identity query twice", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/user/last_tweets")) return json({ data: { tweets: [] } });
      if (decodeURIComponent(url).includes("from:uniswap (founder OR co-founder")) {
        return json({ tweets: [{ text: "Our founder @haydenzadams launched Uniswap." }] });
      }
      return json({ tweets: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const corpus = await collectCorpus("@uniswap");
    await findTeam("@uniswap", "Uniswap", corpus.posts, corpus.teamSignalPosts);

    const identityCalls = fetchMock.mock.calls.filter(([input]) =>
      decodeURIComponent(String(input)).includes("from:uniswap (founder OR co-founder"));
    expect(identityCalls).toHaveLength(1);
    expect(corpus.teamSignalPosts).toEqual(["Our founder @haydenzadams launched Uniswap."]);
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
