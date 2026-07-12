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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { profilePicture: "https://pbs.twimg.com/profile_images/123/profile.jpg" },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(Uint8Array.from({ length: 300 }, (_, index) => index < 3 ? [0xff, 0xd8, 0xff][index] : 0), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await pfpCheckHandler({
      method: "GET",
      headers: panelHeaders,
      query: { handle: "alice" },
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

  it("rejects arbitrary direct image URLs before any provider or cost work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await pfpCheckHandler({
      method: "GET",
      headers: panelHeaders,
      query: { handle: "alice", url: "http://127.0.0.1/admin" },
    } as never, res as never);

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ error: "direct_image_urls_not_supported" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it("does not turn an untrusted avatar URL from X into a clean no-photo result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { profilePicture: "http://127.0.0.1/private-image" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await pfpCheckHandler({
      method: "GET",
      headers: panelHeaders,
      query: { handle: "alice" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: false,
      note: expect.stringContaining("untrusted avatar URL"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const { res: portfolioRes, captured: portfolioCaptured } = response();
    await vcPortfolioHandler({ headers: panelHeaders, query: { name: "Argus Ventures" } } as never, portfolioRes as never);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "grok",
      op: "panel:vc-portfolio",
      calls: 2,
      status: "failed",
    }));
    expect(portfolioCaptured.status).toBe(502);
    expect(portfolioCaptured.body).toMatchObject({
      error: "portfolio_search_failed",
      retryable: true,
    });
  });

  it("returns only source-linked portfolio candidates as unverified leads", async () => {
    const first = {
      output_text: JSON.stringify({
        investments: [
          {
            project: "Source Linked Labs",
            ticker: "$SLL",
            source_url: "https://example.com/source-linked-round",
            source_title: "Seed round announcement",
          },
          { project: "Remembered Without Source", ticker: "$MEM" },
          { project: "Unsafe Local Source", source_url: "http://127.0.0.1/admin" },
          { project: "Signed AWS Source", source_url: "https://example.com/private?X-Amz-Credential=secret" },
          { project: "Signed Google Source", source_url: "https://example.com/private?%58%2DGoog%2DCredential=secret" },
        ],
      }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const second = {
      output_text: JSON.stringify({ investments: [] }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200 })));
    const { res, captured } = response();

    await vcPortfolioHandler({ headers: panelHeaders, query: { name: "Argus Ventures" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      evidence_state: "model_lead",
      candidate_count: 1,
      candidates: [{
        project: "Source Linked Labs",
        source_url: "https://example.com/source-linked-round",
        evidence_state: "model_lead",
      }],
    });
    expect(captured.body).not.toHaveProperty("investments");
    expect(cacheSetJson).toHaveBeenCalledWith(
      expect.stringContaining("vcport:leads-v2:"),
      expect.objectContaining({ evidence_state: "model_lead", candidate_count: 1 }),
    );
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
