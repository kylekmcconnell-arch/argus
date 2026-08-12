import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ attachPanelCost, resolvePanelCostVersion }));

import handler from "./github-forensics";

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

function request() {
  return {
    method: "GET",
    query: { login: "alice" },
    headers: { "x-argus-panel-token": "signed-panel-token" },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub forensics provider completeness", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    resolvePanelCostVersion.mockReset().mockReturnValue(VERSION_ID);
    attachPanelCost.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not turn a failed repository search into no public repos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 403 })));
    const { res, captured } = response();

    await handler(request() as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false, note: "GitHub forensics did not complete." });
    expect(String(captured.body?.note)).not.toContain("No public repos");
  });

  it("preserves a successful empty repository search as measured no repos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([])));
    const { res, captured } = response();

    await handler(request() as never, res as never);

    expect(captured.body).toMatchObject({
      available: true,
      reposScanned: [],
      identities: [],
      note: "No public repos found for this account.",
    });
  });

  it("does not describe privacy or empty commits when a commit search failed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([{ name: "repo", full_name: "alice/repo", fork: false }]))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request() as never, res as never);

    expect(captured.body).toMatchObject({ available: false, note: "GitHub forensics did not complete." });
    expect(String(captured.body?.note)).not.toContain("privacy");
  });

  it("preserves a completed empty commit list as no recovered metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([{ name: "repo", full_name: "alice/repo", fork: false }]))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request() as never, res as never);

    expect(captured.body).toMatchObject({
      available: true,
      reposScanned: ["alice/repo"],
      identities: [],
    });
    expect(String(captured.body?.note)).toContain("No commit-author metadata recovered");
  });
});
