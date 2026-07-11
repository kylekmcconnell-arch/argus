import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  claudeUsd,
  grokUsd,
  requireArgusAuth,
  resolvePanelCostVersion,
} = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  claudeUsd: vi.fn(() => 0.02),
  grokUsd: vi.fn(() => 0.03),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  claudeUsd,
  grokUsd,
  resolvePanelCostVersion,
}));

import challengeVerdictHandler from "./challenge-verdict";
import kolSignalsHandler from "./kol-signals";
import namesakeHandler from "./namesake";
import pfpCheckHandler from "./pfp-check";
import projectDocsHandler from "./project-docs";
import tokenIdentityHandler from "./token-identity";
import vcPortfolioHandler from "./vc-portfolio";
import xFindHandler from "./x-find";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const VERSION_ID = "00000000-0000-4000-8000-000000000222";
const USER_ID = "00000000-0000-4000-8000-000000000010";

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

const panelHeaders = { "x-argus-panel-token": "signed-panel" };

describe("provider usage status attribution", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    claudeUsd.mockClear();
    grokUsd.mockClear();
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    resolvePanelCostVersion.mockReset().mockReturnValue(VERSION_ID);
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("XAI_API_KEY", "xai-key");
    vi.stubEnv("TWITTERAPI_KEY", "twitter-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("records a failed Claude attempt on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const { res, captured } = response();

    await challengeVerdictHandler({
      method: "POST",
      headers: panelHeaders,
      body: { verdict: "PASS", evidence: "grounded evidence" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "claude",
      calls: 1,
      usd: 0,
      status: "failed",
      meta: "http_503",
    }));
  });

  it("records a partial Claude result when the model output contract is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ text: "not JSON" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 })));
    const { res } = response();

    await challengeVerdictHandler({
      method: "POST",
      headers: panelHeaders,
      body: { verdict: "PASS", evidence: "grounded evidence" },
    } as never, res as never);

    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "claude",
      calls: 1,
      usd: 0.02,
      status: "partial",
      meta: "output_contract_error",
    }));
  });

  it("records a failed Grok namesake attempt even when no model body is usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const { res, captured } = response();

    await namesakeHandler({
      method: "GET",
      headers: panelHeaders,
      query: { symbol: "ARGUS", name: "Argus" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "grok",
      op: "panel:namesake",
      calls: 1,
      usd: 0,
      status: "failed",
    }));
  });

  it("records a failed Claude photo attempt after the image was fetched", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(300), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await pfpCheckHandler({
      method: "GET",
      headers: panelHeaders,
      query: { url: "https://image.test/profile.jpg" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "claude",
      op: "panel:pfp-check",
      calls: 1,
      usd: 0,
      status: "failed",
      meta: "vision",
    }));
  });

  it("records a thrown Grok X-discovery request as failed", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { res, captured } = response();

    await xFindHandler({ headers: panelHeaders, query: { name: "Argus", domain: "argus.test" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "grok",
      op: "panel:x-find-search",
      calls: 1,
      status: "failed",
      meta: "transport_error",
    }));
  });

  it("records an unreadable Twitter profile response as failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const { res, captured } = response();

    await xFindHandler({ headers: panelHeaders, query: { name: "Argus", handle: "argus" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "twitterapi",
      op: "panel:x-find-profile",
      calls: 1,
      status: "failed",
      meta: "response_json_error",
    }));
  });

  it("marks a multi-call Twitter panel partial when only some calls succeed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/user/info")) return Promise.resolve(new Response(JSON.stringify({ data: { followers: 100 } }), { status: 200 }));
      if (url.includes("/user/followers")) return Promise.resolve(new Response("rate limited", { status: 429 }));
      if (url.includes("/user/last_tweets")) return Promise.resolve(new Response(JSON.stringify({ data: { tweets: [] } }), { status: 200 }));
      throw new Error(`unexpected request: ${url}`);
    }));
    const { res } = response();

    await kolSignalsHandler({ headers: panelHeaders, query: { handle: "argus" } } as never, res as never);

    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "twitterapi",
      calls: 3,
      status: "partial",
    }));
  });

  it("records failed Grok document and portfolio attempts instead of zero calls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider error", { status: 502 })));
    const docsResponse = response();
    await projectDocsHandler({ headers: panelHeaders, query: { name: "Argus" } } as never, docsResponse.res as never);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "grok",
      op: "panel:project-docs",
      calls: 1,
      status: "failed",
      meta: "http_502",
    }));

    attachPanelCost.mockClear();
    const portfolioResponse = response();
    await vcPortfolioHandler({ headers: panelHeaders, query: { name: "Argus Ventures" } } as never, portfolioResponse.res as never);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "grok",
      op: "panel:vc-portfolio",
      calls: 2,
      status: "failed",
    }));
  });

  it("records an unreadable token-identity response as failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const { res } = response();

    await tokenIdentityHandler({ headers: panelHeaders, query: { symbol: "ARGUS" } } as never, res as never);

    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "grok",
      op: "panel:token-identity",
      calls: 1,
      status: "failed",
      meta: "response_json_error",
    }));
  });
});
