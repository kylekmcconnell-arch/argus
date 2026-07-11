import { afterEach, describe, expect, it, vi } from "vitest";
import { getCost, withCostLedger } from "../cost";
import { getRecentPosts, grokSearch, handleHistory, searchAdverseSignals } from "./x";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("X provider attempt accounting", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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
