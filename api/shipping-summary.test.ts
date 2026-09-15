import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGetJson, cacheSetJson } = vi.hoisted(() => ({ cacheGetJson: vi.fn(), cacheSetJson: vi.fn() }));
vi.mock("./_cache.js", () => ({ cacheGetJson, cacheSetJson }));

import handler from "./shipping-summary";

const repoNode = (over: Record<string, unknown> = {}) => ({
  nameWithOwner: "acme/protocol", isFork: false, isTemplate: false, isArchived: false, description: "an exchange", parent: null,
  createdAt: "2024-01-01T00:00:00Z", pushedAt: new Date(Date.now() - 864e5).toISOString(), stargazerCount: 12, forkCount: 2,
  watchers: { totalCount: 3 }, primaryLanguage: { name: "TypeScript" }, licenseInfo: { spdxId: "MIT" }, releases: { totalCount: 0, nodes: [] },
  openIssues: { totalCount: 1 }, openPrs: { totalCount: 0 }, prSample: { nodes: [] }, issueSample: { nodes: [] }, forks: { nodes: [] },
  readme: { byteSize: 100 }, workflows: null, testDir: null, testsDir: null, auditsDir: null, auditDir: null, pkg: null,
  defaultBranchRef: { target: { history: { totalCount: 0 }, statusCheckRollup: null } },
  ...over,
});

function response() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
  };
  return { res, captured };
}
const request = (query: Record<string, string>) => ({ method: "GET", query, headers: {} });
const gql = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });

describe("shipping summary lane", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("rejects a malformed owner and reports a missing key as unavailable", async () => {
    let { res, captured } = response();
    await handler(request({ org: "../x" }) as never, res as never);
    expect(captured.status).toBe(400);
    vi.stubEnv("GITHUB_TOKEN", "");
    ({ res, captured } = response());
    await handler(request({ org: "acme" }) as never, res as never);
    expect(captured.body).toMatchObject({ available: false, note: "GitHub not configured (no GITHUB_TOKEN)." });
  });

  it("returns a frozen summary, not the roster, and caches it", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : "";
      if (url.endsWith("/graphql") && body.includes("repositoryOwner(")) return gql({ repositoryOwner: { repositories: { totalCount: 1, nodes: [repoNode({ pkg: null })] } } });
      if (url.endsWith("/graphql") && body.includes("messageHeadline")) return gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: [] } } } } });
      if (url.includes("/stats/commit_activity")) return new Response(null, { status: 202 });
      return new Response("unrouted", { status: 599 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request({ org: "acme" }) as never, res as never);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: true, target: "acme" });
    const summary = captured.body?.summary as Record<string, unknown>;
    expect(summary).toMatchObject({ version: 1, target: "acme", windowDays: 90, reposRead: 1 });
    expect(summary).not.toHaveProperty("roster");
    expect(captured.body).not.toHaveProperty("input");
    expect(cacheSetJson).toHaveBeenCalledWith(expect.stringMatching(/^ghsummary:acme:/), expect.objectContaining({ available: true }));
  });

  it("names a missing owner and keeps a failure as not completed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gql({ repositoryOwner: null })));
    let { res, captured } = response();
    await handler(request({ org: "nobody" }) as never, res as never);
    expect(captured.body).toMatchObject({ available: false, note: "No GitHub account or organization exists at that name." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    ({ res, captured } = response());
    await handler(request({ org: "acme" }) as never, res as never);
    expect(captured.body).toMatchObject({ available: false, note: "GitHub shipping summary did not complete." });
  });
});
