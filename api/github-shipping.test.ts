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

import handler from "./github-shipping";

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

function request(query: Record<string, string> = { org: "acme" }) {
  return { method: "GET", query, headers: { "x-argus-panel-token": "signed-panel-token" } };
}

function gql(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const repoNode = (over: Record<string, unknown> = {}) => ({
  nameWithOwner: "acme/protocol",
  isFork: false,
  isTemplate: false,
  isArchived: false,
  description: "an exchange",
  parent: null,
  createdAt: "2024-01-01T00:00:00Z",
  pushedAt: new Date(Date.now() - 864e5).toISOString(),
  stargazerCount: 12,
  forkCount: 2,
  watchers: { totalCount: 3 },
  primaryLanguage: { name: "TypeScript" },
  licenseInfo: { spdxId: "MIT" },
  releases: { totalCount: 0, nodes: [] },
  issues: { totalCount: 1 },
  pullRequests: { totalCount: 0 },
  readme: { byteSize: 100 },
  workflows: { entries: [{ name: "ci.yml" }] },
  testDir: null,
  testsDir: { entries: [{ name: "a.test.ts" }] },
  defaultBranchRef: { target: { history: { totalCount: 3 } } },
  ...over,
});

const commitNode = (i: number) => ({
  oid: `sha${i}`,
  committedDate: new Date(Date.now() - (i + 1) * 864e5 * 3).toISOString(),
  additions: 30,
  deletions: 5,
  changedFilesIfAvailable: 2,
  messageHeadline: `feat: step ${i}`,
  messageBody: "",
  author: { name: "Alice", email: "alice@acme.dev", user: { login: "alice", createdAt: "2019-01-01T00:00:00Z" } },
});

describe("GitHub shipping provider completeness", () => {
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

  it("refuses without a panel context", async () => {
    resolvePanelCostVersion.mockReturnValue(undefined);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.status).toBe(409);
  });

  it("rejects a malformed target before touching GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request({ org: "../etc" }) as never, res as never);
    expect(captured.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not turn a failed GraphQL read into an empty account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 403 })));
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false, note: "GitHub shipping assessment did not complete." });
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ op: "panel:github-shipping", status: "failed" }));
  });

  it("names a missing owner as an answer, not a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gql({ repositoryOwner: null })));
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: false, note: "No GitHub account or organization exists at that name." });
  });

  it("preserves a measured empty owner as no repositories", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gql({ repositoryOwner: { repositories: { nodes: [] } } })));
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: true, reposScanned: [], note: "No public repositories found for this account." });
    expect((captured.body?.assessment as { grade: string }).grade).toBe("unknown");
  });

  it("normalises repositories and history into an assessment and caches it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(gql({ repositoryOwner: { repositories: { nodes: [repoNode(), repoNode({ nameWithOwner: "acme/fork", isFork: true, parent: { nameWithOwner: "Uniswap/v4-core" }, defaultBranchRef: { target: { history: { totalCount: 0 } } } })] } } }))
      .mockResolvedValueOnce(gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: [0, 1, 2].map(commitNode) } } } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: true, reposScanned: ["acme/protocol", "acme/fork"], historyRepos: ["acme/protocol"] });
    const input = captured.body?.input as { repos: { hasCi: boolean; hasTests: boolean; watchers: number }[]; commits: { authorKey: string; repo: string }[] };
    expect(input.repos[0]).toMatchObject({ hasCi: true, hasTests: true, watchers: 3 });
    expect(input.commits).toHaveLength(3);
    expect(input.commits[0]).toMatchObject({ authorKey: "alice@acme.dev", repo: "acme/protocol" });
    const assessment = captured.body?.assessment as { grade: string; origin: { verdict: string; forks: { parent: string }[] } };
    expect(assessment.grade).toBe("thin");
    expect(assessment.origin).toMatchObject({ verdict: "partly-derivative", forks: [{ parent: "Uniswap/v4-core" }] });
    expect(cacheSetJson).toHaveBeenCalledWith(expect.stringMatching(/^ghship:acme:none:/), expect.objectContaining({ available: true }));
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ calls: 2, status: "succeeded" }));
  });

  it("walks the star history for the flagship repository and flattens it to days", async () => {
    const week = 1789257600; // 2026-09-13T00:00:00Z, a Sunday: GitHub weeks start on Sunday
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(gql({ repositoryOwner: { repositories: { nodes: [repoNode({ stargazerCount: 250 })] } } }))
      .mockResolvedValueOnce(gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: [0, 1].map(commitNode) } } } } }))
      .mockResolvedValueOnce(json([{ week, total: 9, days: [3, 2, 4, 0, 0, 0, 0] }, { week: week - 7 * 86400, total: 14, days: [2, 2, 2, 2, 2, 2, 2] }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(String(fetchMock.mock.calls[2][0])).toBe("https://api.github.com/repos/acme/protocol/stargazers/history?per_page=30&page=1");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ headers: expect.objectContaining({ "x-github-api-version": "2026-03-10" }) });
    const input = captured.body?.input as { starHistoryRepo: string; starHistory: { date: string; stars: number }[] };
    expect(input.starHistoryRepo).toBe("acme/protocol");
    expect(input.starHistory).toHaveLength(14);
    expect(input.starHistory[0]).toEqual({ date: "2026-09-13", stars: 3 });
    expect(input.starHistory[7]).toEqual({ date: "2026-09-06", stars: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // a short page ends the walk
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ calls: 3, status: "succeeded" }));
  });

  it("skips the star history below the star floor and survives its failure above it", async () => {
    const few = vi.fn()
      .mockResolvedValueOnce(gql({ repositoryOwner: { repositories: { nodes: [repoNode({ stargazerCount: 12 })] } } }))
      .mockResolvedValueOnce(gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: [0].map(commitNode) } } } } }));
    vi.stubGlobal("fetch", few);
    let { res, captured } = response();
    await handler(request() as never, res as never);
    expect(few).toHaveBeenCalledTimes(2);
    expect((captured.body?.input as { starHistory?: unknown }).starHistory).toBeUndefined();

    const failing = vi.fn()
      .mockResolvedValueOnce(gql({ repositoryOwner: { repositories: { nodes: [repoNode({ stargazerCount: 500 })] } } }))
      .mockResolvedValueOnce(gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: [0].map(commitNode) } } } } }))
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    ({ res, captured } = response());
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: true });
    expect((captured.body?.input as { starHistory?: unknown }).starHistory).toBeUndefined();
    expect(attachPanelCost).toHaveBeenLastCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ calls: 3, status: "partial" }));
  });

  it("adds the sector baseline when a known sector is requested and survives its failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(gql({ repositoryOwner: { repositories: { nodes: [repoNode()] } } }))
      .mockResolvedValueOnce(gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: [0, 1].map(commitNode) } } } } }))
      .mockResolvedValueOnce(new Response("boom", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request({ org: "acme", sector: "dex" }) as never, res as never);
    expect(captured.body).toMatchObject({ available: true });
    expect((captured.body?.assessment as { peers?: unknown }).peers).toBeUndefined();
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ calls: 3, status: "partial" }));
  });

  it("serves a cached assessment without calling GitHub", async () => {
    cacheGetJson.mockResolvedValue({ target: "acme", available: true, assessment: { grade: "thin" } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: true, _cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
