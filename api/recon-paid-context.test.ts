import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  requireArgusAuth,
  resolvePanelCostVersion,
} = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  grokUsd: vi.fn(() => 0.125),
  resolvePanelCostVersion,
}));

import reconTeamHandler from "./recon-team";
import xFindHandler from "./x-find";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const VERSION_ID = "00000000-0000-4000-8000-000000000222";

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

describe("Recon paid supplemental context", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    requireArgusAuth.mockReset().mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      userId: "00000000-0000-4000-8000-000000000010",
    });
    resolvePanelCostVersion.mockReset().mockReturnValue(undefined);
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("TWITTERAPI_KEY", "");
    vi.stubEnv("GITHUB_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders a site-extracted X handle without a provider call or capability", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    await xFindHandler({
      headers: {},
      query: { name: "Argus", domain: "argus.test", handle: "argus" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ found: true, handle: "@argus", confidence: "high" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it("rejects an expired X-discovery capability before cache or provider work", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    await xFindHandler({
      headers: { "x-argus-panel-context": "required", "x-argus-panel-token": "expired" },
      query: { name: "Argus", domain: "argus.test" },
    } as never, res as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "invalid_panel_context" });
    expect(cacheGetJson).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects deep-team discovery when the report capability is omitted", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    await reconTeamHandler({
      headers: {},
      query: { name: "Argus", domain: "argus.test" },
    } as never, res as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "panel_context_required" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it("binds paid deep-team search to the exact persisted site version", async () => {
    resolvePanelCostVersion.mockReturnValue(VERSION_ID);
    vi.stubEnv("XAI_API_KEY", "xai-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        people: [
          {
            name: "Ada Candidate",
            handle: "@ada_candidate",
            linkedin: "https://evil.example/linkedin.com/in/ada-candidate",
            role: "Founder",
            evidence: "A search result associated this name with the project.",
          },
        ],
      }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const { res, captured } = response();

    await reconTeamHandler({
      headers: { "x-argus-panel-context": "required", "x-argus-panel-token": "signed-site-token" },
      query: { name: "Argus", domain: "argus.test" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(resolvePanelCostVersion).toHaveBeenCalledWith(ORGANIZATION_ID, "signed-site-token");
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, {
      provider: "grok",
      op: "panel:recon-team",
      calls: 1,
      usd: 0.125,
      initiatedBy: "00000000-0000-4000-8000-000000000010",
      status: "succeeded",
    });
    expect(captured.body).toMatchObject({
      attempted: true,
      completed: true,
      partial: false,
      providerFailed: false,
      providers: [{ provider: "grok", status: "succeeded" }],
      people: [{
        name: "Ada Candidate",
        handle: "@ada_candidate",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
        evidenceKind: "model_candidate",
      }],
    });
    expect((captured.body as { people: Array<{ linkedin?: string }> }).people[0].linkedin).toBeUndefined();
  });

  it("returns incomplete coverage instead of a negative when the configured provider fails", async () => {
    resolvePanelCostVersion.mockReturnValue(VERSION_ID);
    vi.stubEnv("XAI_API_KEY", "xai-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream failed", { status: 503 })));
    const { res, captured } = response();

    await reconTeamHandler({
      headers: { "x-argus-panel-context": "required", "x-argus-panel-token": "signed-site-token" },
      query: { name: "Argus", domain: "argus.test" },
    } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      attempted: true,
      completed: false,
      partial: false,
      providerFailed: true,
      people: [],
      providers: [{ provider: "grok", status: "failed" }],
    });
  });
});
