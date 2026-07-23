import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "./health";

function response() {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return this; },
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

describe("provider readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports configuration without making provider calls", () => {
    vi.stubEnv("XAI_API_KEY", "xai-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("TWITTERAPI_KEY", "");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("ARGUS_EXTRACT_MODEL", "google/gemini-2.5-flash-lite");
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      mode: "configuration",
      down: 3, // twitterapi + openrouter + cryptorank unconfigured
      services: [
        { id: "xai", ok: true },
        { id: "anthropic", ok: true },
        { id: "twitterapi", ok: false, detail: "not configured in this deployment" },
        { id: "serper", ok: true },
        { id: "openrouter", ok: false, detail: "not configured in this deployment" },
        { id: "cryptorank", ok: false, detail: "not configured in this deployment" },
      ],
      // Serper + a model are set but no OpenRouter key -> grounded search runs on
      // the native Anthropic extractor, not OpenRouter.
      extraction: {
        groundedSearchActive: true,
        extractModel: "google/gemini-2.5-flash-lite",
        extractProvider: "anthropic",
      },
      knowledgeBase: { reuse: false },
    });
    expect(captured.headers["cache-control"]).toContain("s-maxage=60");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("reports OpenRouter routing and knowledge-base reuse when configured", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("ARGUS_EXTRACT_MODEL", "google/gemini-2.5-flash-lite");
    vi.stubEnv("CRYPTORANK_API_KEY", "cr-key");
    vi.stubEnv("ARGUS_ENTITY_REUSE", "on");
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    expect(captured.body).toMatchObject({
      services: [
        { id: "xai" }, { id: "anthropic" }, { id: "twitterapi" },
        { id: "serper", ok: true },
        { id: "openrouter", ok: true },
        { id: "cryptorank", ok: true },
      ],
      extraction: { extractProvider: "openrouter", groundedSearchActive: true },
      knowledgeBase: { reuse: true },
      models: {
        analyst: "claude-sonnet-4-6 (default)",
        discovery: "claude-sonnet-4-6 (default) (follows analyst)",
        discoveryRoute: "claude-web-search (default)",
      },
    });
  });

  it("reports model-tier env flips so a cost change verifies without a paid audit", () => {
    vi.stubEnv("ARGUS_ANALYST_MODEL", "claude-sonnet-5");
    vi.stubEnv("ARGUS_DISCOVERY_MODEL", "claude-haiku-4-5");
    vi.stubEnv("ARGUS_BASIC_FACTS_PRIMARY", "grounded");
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    expect(captured.body).toMatchObject({
      models: { analyst: "claude-sonnet-5", discovery: "claude-haiku-4-5", discoveryRoute: "grounded" },
    });
  });

  it("rejects mutating methods", () => {
    const { res, captured } = response();

    handler({ method: "POST" } as never, res as never);

    expect(captured.status).toBe(405);
    expect(captured.headers.allow).toBe("GET, HEAD");
    expect(captured.body).toEqual({ error: "method_not_allowed" });
  });
});
