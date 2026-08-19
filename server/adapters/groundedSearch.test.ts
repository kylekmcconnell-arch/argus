import { afterEach, describe, expect, it, vi } from "vitest";
import { addOpenRouterUsage, getCost, withCostLedger } from "../cost";

// publicWeb is mocked so the only fetches this test sees are Serper + the
// extractor endpoint (no real page fetches to reason about).
vi.mock("../publicWeb", () => ({ fetchPublicText: vi.fn(async () => null) }));

import { groundedSearch, inspectSerperQuery } from "./groundedSearch";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("addOpenRouterUsage cost booking", () => {
  it("books the actual charged cost from usage.cost under the openrouter provider", () => {
    const cost = withCostLedger(() => {
      addOpenRouterUsage(
        { prompt_tokens: 1000, completion_tokens: 200, cost: 0.0123 },
        "grounded-extract",
        "succeeded",
        "google/gemini-2.5-flash-lite",
      );
      return getCost();
    });
    const line = cost.calls.find((l) => l.provider === "openrouter");
    expect(line?.usd).toBeCloseTo(0.0123, 6);
    expect(line?.op).toBe("grounded-extract");
  });

  it("books 0 when OpenRouter omits usage.cost (never guesses a rate)", () => {
    const cost = withCostLedger(() => {
      addOpenRouterUsage({ prompt_tokens: 1000, completion_tokens: 200 }, "grounded-extract");
      return getCost();
    });
    expect(cost.calls.find((l) => l.provider === "openrouter")?.usd).toBe(0);
  });
});

describe("groundedSearch OpenRouter routing", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  it("routes extraction through OpenRouter only when fallbacks are on and Grok is unset", async () => {
    process.env.SERPER_API_KEY = "serp";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.ARGUS_EXTRACT_MODEL = "google/gemini-2.5-flash-lite";
    process.env.ARGUS_PROVIDER_FALLBACKS = "on";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;

    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    let openRouterHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      const u = String(url);
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ url: u, body, headers: init.headers });
      if (u.includes("serper")) return ok({ organic: [{ title: "T", link: "https://ex.com/a", snippet: "snip" }] });
      openRouterHits += 1;
      // First OpenRouter call is query generation (needs a JSON array); the
      // second is the extraction answer.
      const content = openRouterHits === 1 ? '["query one","query two"]' : "EXTRACTED ANSWER";
      return ok({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0002 } });
    }));

    const result = await withCostLedger(() => groundedSearch("system instructions", "user request"));

    expect(result).toBe("EXTRACTED ANSWER");
    const orCalls = calls.filter((c) => c.url === "https://openrouter.ai/api/v1/chat/completions");
    expect(orCalls.length).toBeGreaterThanOrEqual(1);
    expect(orCalls[0].headers.authorization).toBe("Bearer or-key");
    expect(orCalls[0].body.provider).toEqual({ data_collection: "deny" });
    expect(orCalls[0].body.usage).toEqual({ include: true });
    // The whole point: a non-Claude extractor never touches the Anthropic API.
    expect(calls.some((c) => c.url.includes("api.anthropic.com"))).toBe(false);
  });

  it("stays on Grok extract by default even when OpenRouter and Anthropic are configured", async () => {
    process.env.SERPER_API_KEY = "serp";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.ARGUS_EXTRACT_MODEL = "claude-haiku-4-5";
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    process.env.XAI_API_KEY = "xai";
    delete process.env.ARGUS_PROVIDER_FALLBACKS;

    const urls: string[] = [];
    let grokHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("serper")) return ok({ organic: [{ title: "T", link: "https://ex.com/a", snippet: "snip" }] });
      grokHits += 1;
      const content = grokHits === 1 ? '["query one"]' : "ANSWER";
      return ok({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }));

    const result = await withCostLedger(() => groundedSearch("system", "user"));
    expect(result).toBe("ANSWER");
    expect(urls.some((u) => u.includes("api.x.ai"))).toBe(true);
    expect(urls.some((u) => u.includes("openrouter.ai"))).toBe(false);
    expect(urls.some((u) => u.includes("api.anthropic.com"))).toBe(false);
  });

  it("uses supplied official-site queries without spending a model call generating queries", async () => {
    process.env.SERPER_API_KEY = "serp";
    process.env.XAI_API_KEY = "xai";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const serperQueries: string[] = [];
    let extractHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      const u = String(url);
      if (u.includes("serper")) {
        serperQueries.push(String((JSON.parse(init.body) as { q?: unknown }).q ?? ""));
        return ok({ organic: [{
          title: "Venice Raises $65 Million Series A",
          link: "https://venice.ai/blog/venice-raises-65-million-series-a",
          snippet: "Venice announced a $65 million Series A led by Dragonfly at a $1 billion valuation.",
        }] });
      }
      extractHits += 1;
      return ok({
        choices: [{ message: { content: "EXTRACTED FUNDING" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }));

    const result = await groundedSearch("system", "user", {
      queries: [
        'site:venice.ai "Venice" funding raised financing',
        'site:venice.ai "Venice" "Series A"',
      ],
    });

    expect(result).toBe("EXTRACTED FUNDING");
    expect(serperQueries).toEqual([
      'site:venice.ai "Venice" funding raised financing',
      'site:venice.ai "Venice" "Series A"',
    ]);
    expect(extractHits).toBe(1);
  });

  it("records Serper HTTP failures as failed provider attempts", async () => {
    process.env.SERPER_API_KEY = "configured-but-rejected";
    process.env.XAI_API_KEY = "xai";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    let extractHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("serper")) {
        return new Response('{"message":"unauthorized"}', { status: 401 });
      }
      extractHits += 1;
      return ok({
        choices: [{ message: { content: extractHits === 1 ? '["query one"]' : "must-not-extract" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }));

    let unavailable = false;
    const captured = await withCostLedger(async () => {
      const result = await groundedSearch("system", "user", {
        onProviderUnavailable: () => { unavailable = true; },
      });
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "serper",
      op: "search",
      failed: 1,
      succeeded: 0,
      status: "failed",
      meta: expect.stringContaining("http_401:unauthorized"),
    }));
    expect(unavailable).toBe(true);
    expect(extractHits).toBe(1);
  });

  it("classifies provider credit rejection without copying the response body into the ledger", async () => {
    process.env.SERPER_API_KEY = "configured-but-rejected";
    process.env.XAI_API_KEY = "xai";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    let extractHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("serper")) {
        return new Response('{"message":"Not enough credits for customer secret-account-42"}', { status: 400 });
      }
      extractHits += 1;
      return ok({
        choices: [{ message: { content: extractHits === 1 ? '["query one"]' : "must-not-extract" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }));

    const cost = await withCostLedger(async () => {
      await groundedSearch("system", "user");
      return getCost();
    });
    const line = cost.calls.find((entry) => entry.provider === "serper");
    expect(line?.meta).toContain("http_400:credits_or_quota");
    expect(line?.meta).not.toContain("secret-account-42");
  });
});


describe("inspectSerperQuery", () => {
  it("skips empty, unmatched quotes, dangling OR, and empty operators", () => {
    expect(inspectSerperQuery("").reason).toBe("empty");
    expect(inspectSerperQuery("   ").reason).toBe("empty");
    expect(inspectSerperQuery('"founder of').reason).toBe("unmatched_quotes");
    expect(inspectSerperQuery("founder OR").reason).toBe("dangling_operator");
    expect(inspectSerperQuery("site:").reason).toBe("empty_site_operator");
    expect(inspectSerperQuery("filetype:").reason).toBe("empty_filetype_operator");
    expect(inspectSerperQuery("site: example.com founder").reason).toBe("empty_site_operator");
  });

  it("skips twitter-style q including the 29-char site:twitter.com/@handle class", () => {
    const handle = "alicehandle";
    const withAtPath = `site:twitter.com/@${handle}`;
    const withAtToken = `site:twitter.com @${handle}`;
    expect(handle.length).toBe(11);
    expect(withAtPath.length).toBe(29);
    expect(withAtToken.length).toBe(29);
    expect(inspectSerperQuery(withAtPath)).toMatchObject({
      reason: "twitter_style",
      queryChars: 29,
      hasTwitterHost: true,
      hasAtHandle: true,
    });
    expect(inspectSerperQuery(withAtToken)).toMatchObject({
      reason: "twitter_style",
      queryChars: 29,
      hasTwitterHost: true,
      hasAtHandle: true,
    });
    expect(inspectSerperQuery("@alice").reason).toBe("twitter_style");
    expect(inspectSerperQuery("from:alice").reason).toBe("twitter_style");
    expect(inspectSerperQuery("from:alice (founder OR CEO)").reason).toBe("twitter_style");
    expect(inspectSerperQuery("site:x.com/@alice").reason).toBe("twitter_style");
  });

  it("allows ordinary Google queries including quoted @handle phrases", () => {
    expect(inspectSerperQuery("OpenAI funding round").reason).toBeNull();
    expect(inspectSerperQuery('site:venice.ai "Venice" funding raised financing').reason).toBeNull();
    expect(inspectSerperQuery('"Founder @alicehandle"').reason).toBeNull();
    expect(inspectSerperQuery('"founder of @alicehandle"').reason).toBeNull();
  });
});

describe("groundedSearch Serper query gating", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  function provision() {
    process.env.SERPER_API_KEY = "serp";
    process.env.XAI_API_KEY = "xai";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  }

  it("never posts malformed twitter-style q to /search and does not look like a missing key", async () => {
    provision();
    const fetchMock = vi.fn(async () => {
      throw new Error("network must not be consulted");
    });
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    let unavailable = false;
    const captured = await withCostLedger(async () => {
      const result = await groundedSearch("system", "user", {
        queries: ["site:twitter.com/@alicehandle", "  ", "from:alice"],
        onProviderUnavailable: () => { unavailable = true; },
      });
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(unavailable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.cost.calls.filter((line) => line.provider === "serper")).toEqual([]);
    const skipLogs = warn.mock.calls.filter((args) => args[0] === "[serper-search] skipped invalid query");
    expect(skipLogs.length).toBeGreaterThan(0);
    for (const [, payload] of skipLogs) {
      expect(JSON.stringify(payload)).not.toMatch(/alicehandle|from:alice|rejected \(serper\)/i);
      expect(payload).toEqual(expect.objectContaining({
        reason: expect.stringMatching(/twitter_style|empty/),
        queryChars: expect.any(Number),
      }));
    }
  });

  it("still posts a normal query to google.serper.dev/search", async () => {
    provision();
    const serperUrls: string[] = [];
    const serperBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      const u = String(url);
      if (u.includes("serper")) {
        serperUrls.push(u);
        serperBodies.push(JSON.parse(init.body));
        return ok({ organic: [{ title: "T", link: "https://ex.com/a", snippet: "snip" }] });
      }
      return ok({
        choices: [{ message: { content: "ANSWER" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }));

    const result = await groundedSearch("system", "user", {
      queries: ['site:venice.ai "Venice" funding raised financing'],
    });
    expect(result).toBe("ANSWER");
    expect(serperUrls).toEqual(["https://google.serper.dev/search"]);
    expect(serperBodies).toEqual([{ q: 'site:venice.ai "Venice" funding raised financing', num: 8 }]);
  });

  it("classifies credits_or_quota without changing that path, and treats it as unavailable", async () => {
    provision();
    process.env.SERPER_API_KEY = "configured-but-empty";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("serper")) {
        return new Response('{"message":"Not enough credits"}', { status: 400 });
      }
      return ok({
        choices: [{ message: { content: "must-not-extract" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }));

    let unavailable = false;
    const cost = await withCostLedger(async () => {
      await groundedSearch("system", "user", {
        queries: ["ordinary google query about a project"],
        onProviderUnavailable: () => { unavailable = true; },
      });
      return getCost();
    });
    const line = cost.calls.find((entry) => entry.provider === "serper");
    expect(line?.meta).toContain("http_400:credits_or_quota");
    expect(unavailable).toBe(true);
  });

  it("classifies API invalid_request without looking like a missing key or config panic", async () => {
    provision();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("serper")) {
        return new Response('{"message":"Invalid query parameter"}', { status: 400 });
      }
      return ok({
        choices: [{ message: { content: "must-not-extract" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }));

    let unavailable = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cost = await withCostLedger(async () => {
      await groundedSearch("system", "user", {
        queries: ["ordinary google query about a project"],
        onProviderUnavailable: () => { unavailable = true; },
      });
      return getCost();
    });
    const line = cost.calls.find((entry) => entry.provider === "serper");
    expect(line?.meta).toContain("http_400:invalid_request");
    expect(line?.meta).not.toMatch(/unauthorized|rejected$/);
    expect(unavailable).toBe(false);
    const rejectedLogs = warn.mock.calls.filter((args) => args[0] === "[serper-search] request rejected");
    expect(rejectedLogs.length).toBe(1);
    expect(rejectedLogs[0][1]).toEqual(expect.objectContaining({
      status: 400,
      reason: "invalid_request",
    }));
    expect(JSON.stringify(rejectedLogs[0][1])).not.toMatch(/ordinary google query|SERPER_API_KEY|xai/i);
  });
});
