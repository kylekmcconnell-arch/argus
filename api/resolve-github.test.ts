import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, cacheGetJson, cacheSetJson, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion }));

import handler from "./resolve-github";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000222";

function response() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
  };
  return { res, captured };
}

function request(query: Record<string, string>) {
  return {
    method: "GET",
    query,
    headers: { "x-argus-panel-token": "signed-panel-token" },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolve-github binding", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    resolvePanelCostVersion.mockReset().mockReturnValue(VERSION_ID);
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not resolve an account on a one-directional twitter_username or a substring name", async () => {
    // Regression for INT-14: github.com/vitalikbuterin2 claiming @VitalikButerin
    // (plus "Li" matching "Alice Li") resolved at medium confidence and fed
    // commit emails into the graph as hard ties.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return Promise.resolve(json({ items: [{ login: "vitalikbuterin2" }] }));
      if (url.endsWith("/users/vitalikbuterin2")) {
        return Promise.resolve(json({ login: "vitalikbuterin2", name: "Alice Li", twitter_username: "VitalikButerin", bio: "@VitalikButerin fan", html_url: "https://github.com/vitalikbuterin2" }));
      }
      if (url.endsWith("/users/VitalikButerin")) return Promise.resolve(new Response("not found", { status: 404 }));
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }));
    const { res, captured } = response();

    await handler(request({ handle: "VitalikButerin", name: "Li", bio: "ethereum" }) as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false, lead: { login: "vitalikbuterin2" } });
    expect(captured.body?.login).toBeUndefined();
    expect((captured.body?.lead as { why: string[] }).why).not.toContain("name matches");
  });

  it("resolves only from the subject's own back-link and reports high confidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return Promise.resolve(json({ items: [] }));
      if (url.endsWith("/users/alice-li")) {
        return Promise.resolve(json({ login: "alice-li", name: "Alice Li", twitter_username: "alice", html_url: "https://github.com/alice-li" }));
      }
      if (url.endsWith("/users/alice")) return Promise.resolve(new Response("not found", { status: 404 }));
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }));
    const { res, captured } = response();

    await handler(request({ handle: "alice", name: "Alice Li", bio: "code at github.com/alice-li" }) as never, res as never);

    expect(captured.body).toMatchObject({ available: true, login: "alice-li", confidence: "high" });
    expect(captured.body?.why).toContain("linked from the X bio");
    expect(captured.body?.why).toContain("name matches");
  });
});
