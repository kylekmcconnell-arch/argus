import { describe, it, expect, vi, afterEach } from "vitest";
import { buildClaimChecks, assessGithub, type GithubMatch } from "./github";

// ── buildClaimChecks: deterministic bio-vs-GitHub grading ───────────────────
describe("buildClaimChecks", () => {
  const healthy = { originalCount: 10, forkCount: 2, forkRatio: 0.17, totalStarsOnOriginals: 340 };

  it("grades a tenure claim consistent when the account predates it", () => {
    const checks = buildClaimChecks("Bitcoin since 2009, builder", { ...healthy, createdAt: "2009-05-14T00:00:00Z" });
    const tenure = checks.find((c) => /since 2009/.test(c.claim));
    expect(tenure?.grade).toBe("consistent");
  });

  it("flags a tenure claim as context when the account is far younger than claimed", () => {
    const checks = buildClaimChecks("here since 2009", { ...healthy, createdAt: "2015-01-01T00:00:00Z" });
    const tenure = checks.find((c) => /since 2009/.test(c.claim));
    expect(tenure?.grade).toBe("context");
  });

  it("parses two-digit 'since '09' tenure shorthand", () => {
    const checks = buildClaimChecks("degen since '09", { ...healthy, createdAt: "2009-01-01T00:00:00Z" });
    expect(checks.some((c) => /since 2009/.test(c.claim) && c.grade === "consistent")).toBe(true);
  });

  it("contradicts a builder persona when every repo is a fork", () => {
    const checks = buildClaimChecks("founder & builder", { originalCount: 0, forkCount: 6, forkRatio: 1, totalStarsOnOriginals: 0 });
    const persona = checks.find((c) => /builder\/founder persona/.test(c.claim));
    expect(persona?.grade).toBe("contradicted");
  });

  it("marks a builder persona unsupported when repos are overwhelmingly forks", () => {
    const checks = buildClaimChecks("i build things", { originalCount: 1, forkCount: 9, forkRatio: 0.9, totalStarsOnOriginals: 1 });
    const persona = checks.find((c) => /builder\/founder persona/.test(c.claim));
    expect(persona?.grade).toBe("unsupported");
  });

  it("marks a builder persona unsupported when there are zero repos", () => {
    const checks = buildClaimChecks("engineer & founder", { originalCount: 0, forkCount: 0, forkRatio: 0, totalStarsOnOriginals: 0 });
    const persona = checks.find((c) => /builder\/founder persona/.test(c.claim));
    expect(persona?.grade).toBe("unsupported");
  });

  it("supports a builder persona backed by real original work", () => {
    const checks = buildClaimChecks("builder", { ...healthy, createdAt: "2012-01-01T00:00:00Z" });
    const persona = checks.find((c) => /builder\/founder persona/.test(c.claim));
    expect(persona?.grade).toBe("consistent");
  });

  it("returns no checks when the bio makes no testable claim", () => {
    expect(buildClaimChecks("gm ☕", { ...healthy, createdAt: "2012-01-01T00:00:00Z" })).toHaveLength(0);
  });
});

// ── assessGithub: reducers over a mocked repos payload (no network) ──────────
describe("assessGithub", () => {
  afterEach(() => vi.unstubAllGlobals());

  const match: GithubMatch = { login: "octo", confidence: "gold" };

  function stubGithub(user: unknown, repos: unknown) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (/\/repos\?/.test(url) ? repos : user),
    })) as unknown as typeof fetch);
  }

  it("computes original/fork mix, stars, languages and notable repos", async () => {
    stubGithub(
      { login: "octo", created_at: "2015-06-01T00:00:00Z", public_repos: 4 },
      [
        { name: "orig-a", html_url: "u/orig-a", owner: { login: "octo", type: "User" }, stargazers_count: 300, fork: false, language: "TypeScript", pushed_at: "2025-01-01T00:00:00Z" },
        { name: "orig-b", html_url: "u/orig-b", owner: { login: "octo", type: "User" }, stargazers_count: 40, fork: false, language: "TypeScript", pushed_at: "2024-01-01T00:00:00Z" },
        { name: "orig-c", html_url: "u/orig-c", owner: { login: "octo", type: "User" }, stargazers_count: 5, fork: false, language: "Go", pushed_at: "2023-01-01T00:00:00Z" },
        { name: "forked", html_url: "u/forked", owner: { login: "octo", type: "User" }, stargazers_count: 999, fork: true, language: "C", pushed_at: "2022-01-01T00:00:00Z" },
      ],
    );
    const a = await assessGithub(match, "key", "builder since 2015");
    expect(a).toBeTruthy();
    expect(a!.originalCount).toBe(3);
    expect(a!.forkCount).toBe(1);
    expect(a!.forkRatio).toBe(0.25);
    expect(a!.totalStarsOnOriginals).toBe(345); // forked repo's 999 stars excluded
    expect(a!.topLanguages[0]).toEqual({ language: "TypeScript", repos: 2 });
    expect(a!.notableRepos[0].name).toBe("orig-a"); // sorted by stars desc
    expect(a!.notableRepos.every((r) => r.fork === false)).toBe(true);
    expect(a!.lastActivity).toBe("2025-01-01T00:00:00.000Z"); // max pushed_at
    expect(a!.claimChecks.some((c) => c.grade === "consistent")).toBe(true);
  });

  it("handles an account with no repos without dividing by zero", async () => {
    stubGithub({ login: "octo", created_at: "2020-01-01T00:00:00Z", public_repos: 0 }, []);
    const a = await assessGithub(match, "key", "founder");
    expect(a!.forkRatio).toBe(0);
    expect(a!.originalCount).toBe(0);
    expect(a!.notableRepos).toHaveLength(0);
    expect(a!.claimChecks.find((c) => /persona/.test(c.claim))?.grade).toBe("unsupported");
  });

  it("returns null when the user fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);
    expect(await assessGithub(match, "key", "")).toBeNull();
  });
});
