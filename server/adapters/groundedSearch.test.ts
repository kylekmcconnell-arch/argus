import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addOpenRouterUsage, getCost, withCostLedger } from "../cost";

// publicWeb is mocked so the only fetches this test sees are Serper + the
// extractor endpoint (no real page fetches to reason about).
vi.mock("../publicWeb", () => ({ fetchPublicText: vi.fn(async () => null) }));

import { groundedSearch } from "./groundedSearch";

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

  it("routes extraction through OpenRouter (ZDR + usage.include, Bearer auth) with no Anthropic key", async () => {
    process.env.SERPER_API_KEY = "serp";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.ARGUS_EXTRACT_MODEL = "google/gemini-2.5-flash-lite";
    delete process.env.ANTHROPIC_API_KEY;

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

  it("stays on the native Anthropic path when the extract model is a bare Anthropic id", async () => {
    process.env.SERPER_API_KEY = "serp";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.ARGUS_EXTRACT_MODEL = "claude-haiku-4-5"; // no slug -> not OpenRouter
    process.env.ANTHROPIC_API_KEY = "sk-ant";

    const urls: string[] = [];
    let anthropicHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("serper")) return ok({ organic: [{ title: "T", link: "https://ex.com/a", snippet: "snip" }] });
      anthropicHits += 1;
      const text = anthropicHits === 1 ? '["query one"]' : "ANSWER";
      return ok({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } });
    }));

    const result = await withCostLedger(() => groundedSearch("system", "user"));
    expect(result).toBe("ANSWER");
    expect(urls.some((u) => u.includes("api.anthropic.com"))).toBe(true);
    expect(urls.some((u) => u.includes("openrouter.ai"))).toBe(false);
  });
});
