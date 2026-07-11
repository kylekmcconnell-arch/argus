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
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID });
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
      output_text: "{\"people\":[]}",
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
    });
  });
});
