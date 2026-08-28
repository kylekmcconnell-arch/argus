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
      down: 9, // unconfigured required lanes only; retired and optional fallbacks are listed but not counted down
      services: [
        { id: "xai", ok: true },
        { id: "anthropic", ok: true },
        { id: "twitterapi", ok: false, detail: "not configured in this deployment" },
        { id: "serper", ok: true },
        { id: "openrouter", ok: false, detail: "not configured in this deployment" },
        { id: "helius", ok: false, detail: "not configured in this deployment" },
        { id: "etherscan", ok: false, detail: "not configured in this deployment" },
        { id: "arkham", ok: false, detail: "not configured in this deployment" },
        { id: "pdl", ok: false, detail: "not configured in this deployment" },
        { id: "github", ok: false, detail: "not configured in this deployment" },
        { id: "coingecko", ok: false, detail: "not configured in this deployment" },
        // Retired adapters: commented out of the ADAPTERS registry, so a key
        // would not bring them back and their absence costs no coverage. They
        // stay listed because this endpoint answers which keys the build reads,
        // and they carry no `action` because there is nothing to configure.
        { id: "crunchbase", ok: false, retired: true, detail: "retired: DeFiLlama and Monid/Akta cover funding and backing" },
        { id: "reddit", ok: false, retired: true, detail: "retired: Reddit API access was not approved" },
        { id: "gmgn", ok: false, detail: "not configured in this deployment" },
        { id: "safebrowsing", ok: false, optional: true, detail: "optional fallback not configured" },
        { id: "chart-signals", ok: false, optional: true, detail: "optional fallback not configured" },
        { id: "x-api-bearer", ok: false, optional: true, detail: "optional fallback not configured" },
      ],
      // Serper + a model are set but no OpenRouter key -> grounded search runs on
      // the native Anthropic extractor, not OpenRouter.
      extraction: {
        groundedSearchActive: true,
        extractModel: "google/gemini-2.5-flash-lite",
        extractProvider: "grok",
      },
      knowledgeBase: { reuse: false },
    });
    expect(captured.headers["cache-control"]).toContain("s-maxage=60");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("reports OpenRouter routing and knowledge-base reuse when fallbacks are on", () => {
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("ARGUS_EXTRACT_MODEL", "google/gemini-2.5-flash-lite");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
    vi.stubEnv("ARGUS_ENTITY_REUSE", "on");
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    expect(captured.body).toMatchObject({
      services: [
        { id: "xai" }, { id: "anthropic" }, { id: "twitterapi" },
        { id: "serper", ok: true },
        { id: "openrouter", ok: true },
        { id: "helius" }, { id: "etherscan" }, { id: "arkham" }, { id: "pdl" },
        { id: "github" }, { id: "coingecko" }, { id: "crunchbase" }, { id: "reddit" }, { id: "gmgn" },
        { id: "safebrowsing" }, { id: "chart-signals" }, { id: "x-api-bearer" },
      ],
      extraction: { extractProvider: "openrouter", groundedSearchActive: true },
      knowledgeBase: { reuse: true },
      models: {
        analyst: "grok-4-fast (default)",
        discovery: "grok-4-fast (default) (follows analyst)",
        discoveryRoute: "grok-web-search (default)",
      },
    });
  });

  it("reports model-tier env flips so a cost change verifies without a paid audit", () => {
    vi.stubEnv("ARGUS_GROK_ANALYST_MODEL", "grok-4");
    vi.stubEnv("ARGUS_DISCOVERY_MODEL", "claude-haiku-4-5");
    vi.stubEnv("ARGUS_BASIC_FACTS_PRIMARY", "grounded");
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    expect(captured.body).toMatchObject({
      models: { analyst: "grok-4", discovery: "claude-haiku-4-5", discoveryRoute: "grounded" },
    });
  });

  it("lists Safe Browsing and official X bearer as optional without counting them down", () => {
    vi.stubEnv("GOOGLE_SAFE_BROWSING_KEY", "gsb-key");
    vi.stubEnv("X_API_BEARER", "");
    const { res, captured } = response();

    handler({ method: "GET" } as never, res as never);

    const body = captured.body as { down: number; services: Array<{ id: string; ok: boolean; optional?: boolean }> };
    expect(body.services.find((service) => service.id === "safebrowsing")).toMatchObject({
      ok: true,
      optional: true,
    });
    expect(body.services.find((service) => service.id === "x-api-bearer")).toMatchObject({
      ok: false,
      optional: true,
    });
    expect(body.services.filter((service) => !service.ok && service.id === "safebrowsing")).toEqual([]);
  });

  it("rejects mutating methods", () => {
    const { res, captured } = response();

    handler({ method: "POST" } as never, res as never);

    expect(captured.status).toBe(405);
    expect(captured.headers.allow).toBe("GET, HEAD");
    expect(captured.body).toEqual({ error: "method_not_allowed" });
  });
});
