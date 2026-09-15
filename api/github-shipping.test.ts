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

import handler, { collectShipping } from "./github-shipping";

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const gql = (data: unknown) => json({ data });

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
  openIssues: { totalCount: 1 },
  openPrs: { totalCount: 0 },
  prSample: { nodes: [{ authorAssociation: "MEMBER" }, { authorAssociation: "CONTRIBUTOR" }, { authorAssociation: "NONE" }] },
  issueSample: { nodes: [{ authorAssociation: "OWNER" }, { authorAssociation: "FIRST_TIME_CONTRIBUTOR" }] },
  forks: { nodes: [{ pushedAt: new Date(Date.now() - 5 * 864e5).toISOString() }, { pushedAt: "2024-01-01T00:00:00Z" }] },
  readme: { byteSize: 100 },
  workflows: { entries: [{ name: "ci.yml" }] },
  testDir: null,
  testsDir: { entries: [{ name: "a.test.ts" }] },
  auditsDir: { entries: [{ name: "trail-of-bits.pdf" }] },
  auditDir: null,
  pkg: { text: JSON.stringify({ name: "@acme/sdk", version: "1.0.0" }) },
  defaultBranchRef: { target: { history: { totalCount: 3 }, statusCheckRollup: { state: "SUCCESS" }, lock0: { nodes: [{ committedDate: "2026-09-01T00:00:00Z" }] } } },
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

type Route = (url: string, body: string) => Response | undefined;

/** A fetch that routes by URL and GraphQL query text, so call order is not the contract. */
function routedFetch(routes: Route[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    for (const r of routes) { const out = r(url, body); if (out) return out; }
    return new Response("unrouted " + url, { status: 599 });
  });
}
const isOwnerQuery = (url: string, body: string) => url.endsWith("/graphql") && body.includes("repositoryOwner(");
const isHistoryQuery = (url: string, body: string) => url.endsWith("/graphql") && body.includes("messageHeadline");
const isIdentityQuery = (url: string, body: string) => url.endsWith("/graphql") && body.includes("twitterUsername");
const isPeerQuery = (url: string, body: string) => url.endsWith("/graphql") && body.includes("stargazerCount defaultBranchRef");

const ownerRoute = (nodes: unknown[], totalCount = nodes.length): Route => (u, b) => (isOwnerQuery(u, b) ? gql({ repositoryOwner: { repositories: { totalCount, nodes } } }) : undefined);
const historyRoute = (commits: unknown[]): Route => (u, b) => (isHistoryQuery(u, b) ? gql({ r0: { nameWithOwner: "acme/protocol", defaultBranchRef: { target: { history: { nodes: commits } } } } }) : undefined);
const identityRoute: Route = (u, b) => (isIdentityQuery(u, b) ? gql({ u0: { login: "alice", name: "Alice Ng", twitterUsername: "alice_eth", company: "Acme Labs", websiteUrl: null, createdAt: "2019-01-01T00:00:00Z", followers: { totalCount: 40 }, organizations: { nodes: [{ login: "acme" }] } } }) : undefined);
const weeklyRoute = (rows: unknown, status = 200): Route => (u) => (u.includes("/stats/commit_activity") ? (status === 202 ? new Response(null, { status: 202 }) : json(rows)) : undefined);
const starRoute = (rows: unknown): Route => (u) => (u.includes("/stargazers/history") ? json(rows) : undefined);
// The newest publish lands the day after the newest commit, so it reads as the code going live.
const PUBLISHED = new Date(Date.now() - 2 * 864e5).toISOString();
const npmRoute: Route = (u) => (u.startsWith("https://registry.npmjs.org/") ? json({ name: "@acme/sdk", time: { created: "2025-01-01T00:00:00Z", modified: PUBLISHED, "1.0.0": "2025-01-01T00:00:00Z", "1.1.0": PUBLISHED } }) : u.startsWith("https://api.npmjs.org/") ? json({ downloads: 1234 }) : undefined);

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
    vi.stubGlobal("fetch", routedFetch([ownerRoute([])]));
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: true, reposScanned: [], note: "No public repositories found for this account." });
    expect((captured.body?.assessment as { grade: string }).grade).toBe("unknown");
  });

  it("normalises repositories, history, identities, statistics and packages into an assessment and caches it", async () => {
    const week = 1789257600; // 2026-09-13T00:00:00Z, a Sunday: GitHub weeks start on Sunday
    const fetchMock = routedFetch([
      ownerRoute([repoNode(), repoNode({ nameWithOwner: "acme/fork", isFork: true, parent: { nameWithOwner: "Uniswap/v4-core" }, pkg: null, defaultBranchRef: { target: { history: { totalCount: 0 } } } })], 12),
      historyRoute([0, 1, 2].map(commitNode)),
      identityRoute,
      weeklyRoute([{ week: week - 7 * 86400, total: 4, days: [1, 1, 1, 1, 0, 0, 0] }, { week, total: 2, days: [2, 0, 0, 0, 0, 0, 0] }]),
      npmRoute,
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: true, reposScanned: ["acme/protocol", "acme/fork"], historyRepos: ["acme/protocol"] });
    const input = captured.body?.input as {
      reposTotal: number;
      repos: Record<string, unknown>[];
      commits: { authorKey: string; repo: string }[];
      identities: Record<string, { twitter?: string; company?: string; orgs?: string[] }>;
      packages: { name: string; versions: unknown[]; downloadsLastMonth?: number }[];
      readNotes: string[];
    };
    expect(input.reposTotal).toBe(12);
    expect(input.repos[0]).toMatchObject({
      hasCi: true, hasTests: true, hasAudit: true, watchers: 3, ciState: "success", packageName: "@acme/sdk",
      lockfileUpdatedAt: "2026-09-01T00:00:00Z", pullRequestsSampled: 3, externalPullRequests: 2, issuesSampled: 2, externalIssues: 1, activeForks: 1,
    });
    expect(input.repos[0].weeklyCommits).toEqual([{ weekStart: "2026-09-06", commits: 4 }, { weekStart: "2026-09-13", commits: 2 }]);
    expect(input.commits).toHaveLength(3);
    expect(input.commits[0]).toMatchObject({ authorKey: "alice@acme.dev", repo: "acme/protocol" });
    expect(input.identities.alice).toMatchObject({ twitter: "alice_eth", company: "Acme Labs", orgs: ["acme"] });
    expect(input.packages).toEqual([{ name: "@acme/sdk", registry: "npm", versions: [{ version: "1.0.0", date: "2025-01-01T00:00:00Z" }, { version: "1.1.0", date: PUBLISHED }], downloadsLastMonth: 1234 }]);
    expect(input.readNotes.join(" ")).toMatch(/stargazer lists/);
    const assessment = captured.body?.assessment as { grade: string; origin: { verdict: string; forks: { parent: string }[] }; health: { verdict: string }; adoption: { verdict: string }; live: { verdict: string }; committers: { roster: { twitter?: string }[] } };
    expect(assessment.grade).toBe("thin");
    expect(assessment.origin).toMatchObject({ verdict: "partly-derivative", forks: [{ parent: "Uniswap/v4-core" }] });
    expect(assessment.health.verdict).toBe("sound");
    expect(assessment.adoption.verdict).toBe("used"); // 1,234 downloads last month clears the "used" bar
    expect(assessment.live.verdict).toBe("live");
    expect(assessment.committers.roster[0].twitter).toBe("alice_eth");
    expect(cacheSetJson).toHaveBeenCalledWith(expect.stringMatching(/^ghship:acme:none:/), expect.objectContaining({ available: true }));
    // owner + history + identities + 1 weekly stats + 2 npm = 6, all succeeded
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ calls: 6, status: "succeeded" }));
  });

  it("walks the star history for the flagship repository and flattens it to days", async () => {
    const week = 1789257600;
    const fetchMock = routedFetch([
      ownerRoute([repoNode({ stargazerCount: 250, pkg: null })]),
      historyRoute([0, 1].map(commitNode)),
      identityRoute,
      weeklyRoute(null, 202),
      starRoute([{ week, total: 9, days: [3, 2, 4, 0, 0, 0, 0] }, { week: week - 7 * 86400, total: 14, days: [2, 2, 2, 2, 2, 2, 2] }]),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    const starCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/stargazers/history"));
    expect(starCalls).toHaveLength(1); // a short page ends the walk
    expect(String(starCalls[0][0])).toBe("https://api.github.com/repos/acme/protocol/stargazers/history?per_page=30&page=1");
    expect(starCalls[0][1]).toMatchObject({ headers: expect.objectContaining({ "x-github-api-version": "2026-03-10" }) });
    const input = captured.body?.input as { starHistoryRepo: string; starHistory: { date: string; stars: number }[]; readNotes: string[] };
    expect(input.starHistoryRepo).toBe("acme/protocol");
    expect(input.starHistory).toHaveLength(14);
    expect(input.starHistory[0]).toEqual({ date: "2026-09-13", stars: 3 });
    expect(input.starHistory[7]).toEqual({ date: "2026-09-06", stars: 2 });
    expect(input.readNotes.join(" ")).toMatch(/still being computed/);
  });

  it("skips the star history below the star floor and survives its failure above it", async () => {
    const few = routedFetch([ownerRoute([repoNode({ stargazerCount: 12, pkg: null })]), historyRoute([0].map(commitNode)), identityRoute, weeklyRoute([])]);
    vi.stubGlobal("fetch", few);
    let { res, captured } = response();
    await handler(request() as never, res as never);
    expect(few.mock.calls.some((c) => String(c[0]).includes("/stargazers/history"))).toBe(false);
    expect((captured.body?.input as { starHistory?: unknown }).starHistory).toBeUndefined();

    const failing = routedFetch([ownerRoute([repoNode({ stargazerCount: 500, pkg: null })]), historyRoute([0].map(commitNode)), identityRoute, weeklyRoute([]), (u) => (u.includes("/stargazers/history") ? new Response("nope", { status: 500 }) : undefined)]);
    vi.stubGlobal("fetch", failing);
    ({ res, captured } = response());
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: true });
    const input = captured.body?.input as { starHistory?: unknown; readNotes: string[] };
    expect(input.starHistory).toBeUndefined();
    expect(input.readNotes.join(" ")).toMatch(/star history could not be read/);
    expect(attachPanelCost).toHaveBeenLastCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ status: "partial" }));
  });

  it("adds the sector baseline when a known sector is requested and survives its failure", async () => {
    const fetchMock = routedFetch([
      ownerRoute([repoNode({ pkg: null })]),
      historyRoute([0, 1].map(commitNode)),
      identityRoute,
      weeklyRoute([]),
      (u, b) => (isPeerQuery(u, b) ? new Response("boom", { status: 502 }) : undefined),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request({ org: "acme", sector: "dex" }) as never, res as never);
    expect(captured.body).toMatchObject({ available: true });
    expect((captured.body?.assessment as { peers?: unknown }).peers).toBeUndefined();
    expect((captured.body?.input as { readNotes: string[] }).readNotes.join(" ")).toMatch(/sector baseline could not be read/);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({ status: "partial" }));
  });

  it("loses the identity join, not the assessment, when the account query fails", async () => {
    const fetchMock = routedFetch([
      ownerRoute([repoNode({ pkg: null })]),
      historyRoute([0, 1].map(commitNode)),
      (u, b) => (isIdentityQuery(u, b) ? new Response("boom", { status: 502 }) : undefined),
      weeklyRoute([]),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    await handler(request() as never, res as never);
    expect(captured.body).toMatchObject({ available: true });
    const input = captured.body?.input as { identities?: unknown; readNotes: string[] };
    expect(input.identities).toBeUndefined();
    expect(input.readNotes.join(" ")).toMatch(/Committer accounts could not be resolved/);
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

describe("collectShipping at a point in time", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes `until`, skips undatable reads and cuts the star history at the date", async () => {
    const past = new Date("2026-03-01T00:00:00Z");
    const fetchMock = routedFetch([
      ownerRoute([repoNode({ stargazerCount: 300, pkg: { text: JSON.stringify({ name: "@acme/sdk" }) } })]),
      historyRoute([0].map(commitNode)),
      identityRoute,
      starRoute([{ week: Math.floor(past.getTime() / 1000) + 7 * 86400, total: 7, days: [1, 1, 1, 1, 1, 1, 1] }, { week: Math.floor(past.getTime() / 1000) - 7 * 86400, total: 7, days: [1, 1, 1, 1, 1, 1, 1] }]),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const usage = { calls: 0, succeeded: 0 };
    const input = await collectShipping({ target: "acme", kind: "org", key: "k", usage, now: past, sector: { id: "dex", label: "x", keywords: /x/, repos: ["a/b"] } });
    const ownerCall = fetchMock.mock.calls.find((c) => isOwnerQuery(String(c[0]), String(c[1]?.body)));
    expect(JSON.parse(String(ownerCall?.[1]?.body)).variables.until).toBe(past.toISOString());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/stats/commit_activity"))).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("https://registry.npmjs.org"))).toBe(false);
    expect(fetchMock.mock.calls.some((c) => isPeerQuery(String(c[0]), String(c[1]?.body)))).toBe(false);
    expect(input.now).toBe(past.toISOString());
    expect(input.starHistory?.every((d) => d.date <= "2026-03-01")).toBe(true);
    expect(input.starHistory).toHaveLength(7);
    expect(input.readNotes?.join(" ")).toMatch(/Point-in-time read/);
  });
});
