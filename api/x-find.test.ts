import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, cacheGetJson, cacheSetJson, grokUsd, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  grokUsd: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ attachPanelCost, cacheGetJson, cacheSetJson, grokUsd, resolvePanelCostVersion }));
vi.mock("./_auth.js", () => ({ requireArgusAuth }));

import handler from "./x-find";

function response() {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// No-seed path: Grok surfaces the handle, so the bio-website cross-check is the
// only signal separating the official account from an impersonator.
function stubProviders(bioUrl: string | null) {
  const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.x.ai")) {
      return Promise.resolve(json({ output_text: '{"handle":"@uniswap_claims"}' }));
    }
    if (url.includes("api.twitterapi.io")) {
      return Promise.resolve(json({ data: {
        name: "Uniswap Rewards",
        description: "Claim your rewards",
        followers: 1200,
        entities: bioUrl ? { url: { urls: [{ expanded_url: bioUrl }] } } : undefined,
      } }));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function run() {
  const { res, captured } = response();
  await handler({
    method: "GET",
    query: { name: "Uniswap", domain: "uniswap.org" },
    headers: { "x-argus-panel-token": "panel-x" },
  } as never, res as never);
  return captured;
}

describe("x-find official-account site cross-check", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset().mockResolvedValue(undefined);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    grokUsd.mockReset().mockReturnValue(0.001);
    resolvePanelCostVersion.mockReset().mockReturnValue("00000000-0000-4000-8000-000000000401");
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: "org-test", userId: "user-test" });
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses high confidence when the bio URL merely embeds the project domain", async () => {
    for (const bioUrl of [
      "https://uniswap.org.claim-airdrop.xyz", // subdomain spoof
      "https://xuniswap.org", // superstring host
      "https://evil.io/uniswap.org/airdrop", // path embed
      "https://evil.io/?ref=uniswap.org", // query embed
    ]) {
      stubProviders(bioUrl);
      const captured = await run();
      expect(captured.status).toBe(200);
      expect(captured.body).toMatchObject({ found: true, siteMatches: false });
      expect(captured.body.confidence).not.toBe("high");
      expect(captured.body.matchReason).not.toContain("links to");
    }
  });

  it("confirms high confidence for the exact domain and its real subdomains", async () => {
    for (const bioUrl of [
      "https://uniswap.org",
      "https://www.uniswap.org/",
      "https://app.uniswap.org/swap",
    ]) {
      stubProviders(bioUrl);
      const captured = await run();
      expect(captured.status).toBe(200);
      expect(captured.body).toMatchObject({ found: true, siteMatches: true, confidence: "high" });
      expect(captured.body.matchReason).toBe("the account's own website links to uniswap.org");
    }
  });

  it("treats a missing or unparseable bio URL as no site match", async () => {
    for (const bioUrl of [null, "not a url"]) {
      stubProviders(bioUrl);
      const captured = await run();
      expect(captured.status).toBe(200);
      expect(captured.body).toMatchObject({ found: true, siteMatches: false });
      expect(captured.body.confidence).not.toBe("high");
    }
  });
});
