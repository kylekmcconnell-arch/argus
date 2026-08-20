import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../cache", () => ({
  cacheGet: cache.get,
  cacheSet: cache.set,
}));
vi.mock("../publicWeb", () => ({
  fetchPublicText: vi.fn(async () => null),
}));

import { withAuditRunContext } from "../auditRunContext";
import { withCostLedger } from "../cost";
import { groundedSearch } from "./groundedSearch";
import { grokSearch } from "./x";

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  cache.get.mockReset().mockResolvedValue("stale cached answer");
  cache.set.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("full-rescan subject cache policy", () => {
  it("skips a stale Grok hit and writes the successful live replacement", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn(async () => ok({
      output_text: "fresh Grok answer",
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => withAuditRunContext(
      { fresh: true, scanId: "grok-refresh" },
      () => grokSearch("system", "user", { cacheKey: "subject:grok" }),
    ));

    expect(result).toBe("fresh Grok answer");
    expect(cache.get).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith("subject:grok", "fresh Grok answer");
  });

  it("never falls back to stale text or overwrites it when the live refresh fails", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn(async () => ok({ error: "upstream" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => withAuditRunContext(
      { fresh: true, scanId: "grok-failure" },
      () => grokSearch("system", "user", { cacheKey: "subject:grok" }),
    ));

    expect(result).toBeNull();
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("applies the same refresh/write-through rule to grounded search", async () => {
    vi.stubEnv("SERPER_API_KEY", "serper-test-key");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://google.serper.dev/search") {
        return ok({ organic: [{
          title: "Official team",
          link: "https://subject.example/team",
          snippet: "The official team page names the founders.",
        }] });
      }
      if (url === "https://api.x.ai/v1/chat/completions") {
        return ok({
          choices: [{ message: { content: "fresh grounded answer" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => withAuditRunContext(
      { fresh: true, scanId: "grounded-refresh" },
      () => groundedSearch("system", "user", {
        cacheKey: "subject:grounded",
        queries: ["subject official team"],
      }),
    ));

    expect(result).toBe("fresh grounded answer");
    expect(cache.get).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.set).toHaveBeenCalledWith("gs:subject:grounded", "fresh grounded answer");
  });
});
