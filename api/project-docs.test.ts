import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  grokUsd,
  requireArgusAuth,
  resolvePanelCostVersion,
} = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  grokUsd: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  grokUsd,
  resolvePanelCostVersion,
}));

import handler from "./project-docs";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const REPORT_VERSION_ID = "00000000-0000-4000-8000-000000000301";

function response() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
  };
  return { res, captured };
}

function request(panelToken?: string) {
  return {
    method: "GET",
    headers: panelToken ? { "x-argus-panel-token": panelToken } : {},
    query: { name: "Argus", symbol: "ARG", domain: "argus.example" },
  };
}

function homepage(): Response {
  return new Response('<nav><a href="/about">About us</a><a href="/docs">Developer docs</a></nav>', {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("project document paid-search capability", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset().mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      userId: "00000000-0000-4000-8000-000000000010",
      displayName: "Analyst",
    });
    resolvePanelCostVersion.mockReset().mockReturnValue(undefined);
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    grokUsd.mockReset().mockReturnValue(0.1254);
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does only the deterministic crawl when no report capability is present", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://argus.example/") return Promise.resolve(homepage());
      throw new Error(`unexpected provider call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request() as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({ category: "about", url: "https://argus.example/about" }),
        expect.objectContaining({ category: "api", url: "https://argus.example/docs" }),
      ]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolvePanelCostVersion).toHaveBeenCalledWith(ORGANIZATION_ID, undefined);
    expect(attachPanelCost).not.toHaveBeenCalled();
    expect(cacheSetJson).toHaveBeenCalledWith(expect.stringContaining(":crawl"), expect.any(Object));
  });

  it("uses Grok only with a valid report capability and attributes its exact version", async () => {
    resolvePanelCostVersion.mockReturnValue(REPORT_VERSION_ID);
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://argus.example/") return Promise.resolve(homepage());
      if (url === "https://api.x.ai/v1/responses") {
        return Promise.resolve(new Response(JSON.stringify({
          output_text: JSON.stringify({
            whitepaper: { url: "https://docs.argus.example/whitepaper", kind: "whitepaper" },
            resources: [],
            audits: [],
          }),
          output: [{ type: "web_search_call" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      throw new Error(`unexpected provider call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("signed-panel-token") as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      whitepaper: { url: "https://docs.argus.example/whitepaper" },
    });
    expect(resolvePanelCostVersion).toHaveBeenCalledWith(ORGANIZATION_ID, "signed-panel-token");
    expect(fetchMock).toHaveBeenCalledWith("https://api.x.ai/v1/responses", expect.any(Object));
    expect(grokUsd).toHaveBeenCalledWith({ input_tokens: 100, output_tokens: 50 }, 1);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, REPORT_VERSION_ID, {
      provider: "grok",
      op: "panel:project-docs",
      calls: 1,
      usd: 0.1254,
    });
    expect(cacheSetJson).toHaveBeenCalledWith(expect.stringContaining(":grok"), expect.any(Object));
  });

  it("serves cached enrichment without initiating paid work", async () => {
    cacheGetJson.mockResolvedValueOnce({
      available: true,
      whitepaper: { url: "https://argus.example/whitepaper", kind: "whitepaper" },
      resources: [],
      audits: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request() as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ _cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it("rejects an invalid capability before cache or provider work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("expired-panel-token") as never, res as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "invalid_panel_context" });
    expect(cacheGetJson).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });
});
