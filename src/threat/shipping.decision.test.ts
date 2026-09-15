import { describe, expect, it } from "vitest";
import { assessShipping, extractRoadmapClaims, roadmapDue, summarizeShipping, type ShippingCommit, type ShippingInput, type ShippingRepo, type ShippingSummary } from "./shipping";

const NOW = "2026-09-15T12:00:00Z";
const DAY = 864e5;
const daysAgo = (d: number, hour = 9) => new Date(Date.parse(NOW) - d * DAY).toISOString().replace(/T\d\d/, `T${String(hour).padStart(2, "0")}`);

function repo(over: Partial<ShippingRepo> = {}): ShippingRepo {
  return { nameWithOwner: "acme/protocol", isFork: false, createdAt: "2024-01-01T00:00:00Z", pushedAt: daysAgo(1), stars: 40, forks: 6, watchers: 4, license: "MIT", releases: [], releaseCount: 0, hasReadme: true, hasCi: true, hasTests: true, ...over };
}
function commit(over: Partial<ShippingCommit> & { date: string }): ShippingCommit {
  return { sha: Math.random().toString(16).slice(2, 10), authorKey: "alice@acme.dev", authorName: "Alice", authorLogin: "alice", additions: 40, deletions: 12, files: 3, headline: "feat(router): batch quotes across pools", repo: "acme/protocol", ...over };
}
function base(over: Partial<ShippingInput> = {}): ShippingInput {
  return { target: "acme", kind: "org", now: NOW, windowDays: 90, repos: [repo()], commits: [], ...over };
}
const people = [
  { authorKey: "alice@acme.dev", authorName: "Alice", authorLogin: "alice" },
  { authorKey: "bob@acme.dev", authorName: "Bob", authorLogin: "bob" },
  { authorKey: "cy@acme.dev", authorName: "Cy", authorLogin: "cy" },
];
function teamCommits(): ShippingCommit[] {
  const out: ShippingCommit[] = [];
  for (let d = 88; d >= 0; d -= 2) out.push(commit({ date: daysAgo(d), ...people[d % 3] }));
  return out;
}

describe("assessShipping · churn and identities", () => {
  it("flags a lead who stopped while the repository carried on", () => {
    // Alice wrote most of days 90..31, then vanished; Bob and Cy keep going.
    const commits: ShippingCommit[] = [];
    for (let d = 88; d > 30; d -= 2) commits.push(commit({ date: daysAgo(d), ...(d % 8 === 0 ? people[1] : people[0]) }));
    for (let d = 28; d >= 0; d -= 3) commits.push(commit({ date: daysAgo(d), ...(d % 2 ? people[1] : people[2]) }));
    const a = assessShipping(base({ commits }));
    expect(a.committers.churn.departed).toBe(true);
    expect(a.committers.churn.leadLogin).toBe("alice");
    expect(a.committers.churn.leadLast30).toBe(0);
    expect(a.committers.churn.detail).toMatch(/the lead has stopped and the repository has not/);
    expect(a.evidence.join(" ")).toMatch(/@alice wrote/);
  });

  it("does not call a whole-team stall a departure", () => {
    const commits = teamCommits().filter((c) => Date.parse(c.date) < Date.parse(daysAgo(35)));
    const a = assessShipping(base({ commits, repos: [repo({ pushedAt: daysAgo(36) })] }));
    expect(a.committers.churn.departed).toBe(false);
    expect(a.committers.churn.goneQuiet.length).toBe(3);
    expect(a.cadence.status).toBe("quiet");
  });

  it("joins X handles, employers and orgs onto the roster and tracks 30/60-day splits", () => {
    const a = assessShipping(base({
      commits: teamCommits(),
      identities: { alice: { login: "alice", twitter: "@alice_eth", company: "Acme Labs", orgs: ["acme", "ethereum"], name: "Alice Ng" } },
    }));
    const alice = a.committers.roster.find((r) => r.login === "alice")!;
    expect(alice.twitter).toBe("alice_eth");
    expect(alice.company).toBe("Acme Labs");
    expect(alice.orgs).toEqual(["acme", "ethereum"]);
    expect(alice.last30 + alice.prior60).toBeLessThanOrEqual(alice.commits);
    expect(alice.last30).toBeGreaterThan(0);
    expect(a.coverage.identitiesRead).toBe(1);
  });
});

describe("assessShipping · live, adoption and health", () => {
  it("reads deploys that follow releases as the code going live", () => {
    const repos = [repo({ releases: [{ tag: "v2.0.0", publishedAt: daysAgo(20) }], releaseCount: 1 })];
    const a = assessShipping(base({ commits: teamCommits(), repos, deploys: [{ date: daysAgo(18), address: "0xabc", verified: true, kind: "create" }, { date: daysAgo(70), address: "0xdef", verified: false }] }));
    expect(a.live.verdict).toBe("live");
    expect(a.live.deploysInWindow).toBe(2);
    expect(a.live.verifiedDeploys).toBe(1);
    expect(a.live.codeToChain).toBeGreaterThanOrEqual(1);
  });

  it("reads commits with no deploy or publish as committed only, and deploys with no code as unseen shipping", () => {
    const committed = assessShipping(base({ commits: teamCommits(), deploys: [] }));
    expect(committed.live.verdict).toBe("committed-only");
    const unseen = assessShipping(base({ commits: [], repos: [repo({ pushedAt: daysAgo(80) })], deploys: [{ date: daysAgo(5), address: "0x1" }] }));
    expect(unseen.live.verdict).toBe("deploys-without-code");
    expect(assessShipping(base({ commits: teamCommits() })).live.verdict).toBe("unknown");
  });

  it("counts package publishes and downloads as live and adopted", () => {
    const a = assessShipping(base({ commits: teamCommits(), packages: [{ name: "@acme/sdk", registry: "npm", versions: [{ version: "1.4.0", date: daysAgo(3) }, { version: "1.3.0", date: daysAgo(200) }], downloadsLastMonth: 4200 }] }));
    expect(a.live.publishesInWindow).toBe(1);
    expect(a.live.verdict).toBe("live");
    expect(a.adoption.verdict).toBe("used");
    expect(a.adoption.packages).toEqual(["npm:@acme/sdk"]);
  });

  it("grades adoption from outside contribution, not stars", () => {
    const used = assessShipping(base({ commits: teamCommits(), repos: [repo({ pullRequestsSampled: 20, externalPullRequests: 6, issuesSampled: 15, externalIssues: 9, activeForks: 7 })] }));
    expect(used.adoption.verdict).toBe("used");
    expect(used.adoption.externalPrSharePct).toBe(30);
    const unused = assessShipping(base({ commits: teamCommits(), repos: [repo({ stars: 5000, pullRequestsSampled: 20, externalPullRequests: 0, issuesSampled: 4, externalIssues: 0, activeForks: 0 })] }));
    expect(unused.adoption.verdict).toBe("unused");
    expect(unused.adoption.detail).toMatch(/Nobody outside the team/);
  });

  it("scores repository health from checks, licence, audit and lockfile age", () => {
    const sound = assessShipping(base({ commits: teamCommits(), repos: [repo({ ciState: "success", license: "Apache-2.0", hasAudit: true, lockfileUpdatedAt: daysAgo(10) })] }));
    expect(sound.health).toMatchObject({ verdict: "sound", ci: "success", license: "permissive", auditInTree: true, lockfileAgeDays: 10 });
    const poor = assessShipping(base({ commits: teamCommits(), repos: [repo({ ciState: "failure", license: undefined, hasAudit: false, lockfileUpdatedAt: daysAgo(500) })] }));
    expect(poor.health.verdict).toBe("poor");
    expect(poor.health.license).toBe("none");
    expect(poor.health.detail).toMatch(/checks FAIL/);
    expect(poor.evidence.join(" ")).toMatch(/latest default-branch checks fail/);
    const busl = assessShipping(base({ commits: teamCommits(), repos: [repo({ license: "BUSL-1.1" })] }));
    expect(busl.health.license).toBe("source-available");
  });
});

describe("assessShipping · trend, roadmap, cohort, delta, coverage", () => {
  it("builds a yearly trend from provider weekly stats with price, releases and deploys per week", () => {
    const weeklyCommits = Array.from({ length: 52 }, (_, i) => ({ weekStart: daysAgo((52 - i) * 7).slice(0, 10), commits: i % 2 ? 4 : 1 }));
    const price = Array.from({ length: 200 }, (_, i) => ({ date: daysAgo(200 - i), close: 1 + i / 100 }));
    const a = assessShipping(base({
      commits: teamCommits(),
      repos: [repo({ weeklyCommits, releases: [{ tag: "v1", publishedAt: daysAgo(10) }], releaseCount: 1 })],
      priceSeries: price,
      deploys: [{ date: daysAgo(9), address: "0x1" }],
    }));
    expect(a.trend.source).toBe("provider-weekly");
    expect(a.trend.weeks).toHaveLength(52);
    expect(a.trend.lifeCommits).toBe(26 * 4 + 26 * 1);
    const recent = a.trend.weeks[a.trend.weeks.length - 2];
    expect(recent.releases + a.trend.weeks[a.trend.weeks.length - 1].releases).toBe(1);
    expect(a.trend.weeks.filter((w) => w.deploys > 0)).toHaveLength(1);
    expect(a.trend.weeks.filter((w) => w.price != null).length).toBeGreaterThan(20);
  });

  it("falls back to the window's own weeks when no provider stats exist", () => {
    const a = assessShipping(base({ commits: teamCommits() }));
    expect(a.trend.source).toBe("window-commits");
    expect(a.trend.weeks).toHaveLength(13);
  });

  it("extracts dated promises and grades them against releases, commits and time", () => {
    expect(roadmapDue("Q3 2026")).toBe(Date.UTC(2026, 9, 0, 23, 59, 59));
    expect(new Date(roadmapDue("H1 2026")).toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(new Date(roadmapDue("March 2026")).toISOString().slice(0, 10)).toBe("2026-03-31");
    const docs = "Roadmap. Q2 2026: mainnet launch of the perps engine. Q3 2026: mobile app beta. Q4 2026: governance token. We raised in 2025.";
    const claims = extractRoadmapClaims(docs);
    expect(claims.map((c) => c.due.slice(0, 10))).toEqual(["2026-06-30", "2026-09-30", "2026-12-31", "2025-12-31"]);
    const a = assessShipping(base({
      commits: teamCommits(),
      repos: [repo({ releases: [{ tag: "v1.0.0", publishedAt: "2026-06-20T00:00:00Z" }], releaseCount: 1, weeklyCommits: Array.from({ length: 52 }, (_, i) => ({ weekStart: daysAgo((52 - i) * 7).slice(0, 10), commits: 0 })) })],
      docsText: docs,
    }));
    const byDue = Object.fromEntries(a.roadmap.claims.map((c) => [c.due.slice(0, 10), c.grade]));
    expect(byDue["2026-06-30"]).toBe("met");
    expect(byDue["2026-09-30"]).toBe("pending");
    expect(byDue["2026-12-31"]).toBe("pending");
    expect(byDue["2025-12-31"]).toBe("missed");
    expect(a.roadmap.detail).toMatch(/1 met, 1 missed, 2 still ahead/);
  });

  it("renders a stage cohort as percentiles", () => {
    const a = assessShipping(base({ commits: teamCommits(), cohort: { label: "Robinhood Chain tokens under $1M launched within 60 days", size: 38, medianCommits: 6, medianAuthors: 1, percentileCommits: 91, percentileAuthors: 88, shippingSharePct: 22 } }));
    expect(a.cohort?.detail).toMatch(/Among 38 Robinhood Chain tokens/);
    expect(a.cohort?.detail).toMatch(/91th percentile/);
    expect(a.cohort?.detail).toMatch(/22% of the cohort is still shipping/);
  });

  it("reports the delta against the previous saved summary and names a stall", () => {
    const prevAssessment = assessShipping(base({ commits: teamCommits() }));
    const previous: ShippingSummary = summarizeShipping(prevAssessment, "2026-06-01T00:00:00Z");
    expect(previous).toMatchObject({ version: 1, grade: "shipping-team", totalCommits: 45, distinctHuman: 3, cadenceStatus: "shipping", live: "unknown", adoption: "unknown", leadDeparted: false });
    const now = assessShipping(base({ commits: [commit({ date: daysAgo(70) }), commit({ date: daysAgo(68) })], repos: [repo({ pushedAt: daysAgo(68) })], previous }));
    expect(now.delta).toMatchObject({ stalled: true, grade: { from: "shipping-team", to: "stalled" }, commits: { from: 45, to: 2 }, humans: { from: 3, to: 1 } });
    expect(now.delta?.detail).toMatch(/Since the report of 2026-06-01/);
    expect(now.delta?.detail).toMatch(/was shipping then and is not now/);
    expect(now.evidence.join(" ")).toMatch(/Since the report of 2026-06-01/);
  });

  it("discloses coverage honestly", () => {
    const a = assessShipping(base({ commits: teamCommits(), repos: [repo({ commitsInWindow: 400 })], reposTotal: 12, readNotes: ["Stargazer lists are admin-only since June 2026."] }));
    expect(a.coverage).toMatchObject({ reposTotal: 12, reposRead: 1, commitsCounted: 400, commitsRead: 45, weeklyStatsRead: false, identitiesRead: 0 });
    const notes = a.coverage.notes.join(" ");
    expect(notes).toMatch(/1 of 12 repositories reviewed/);
    expect(notes).toMatch(/45 of 400 window commits read in detail/);
    expect(notes).toMatch(/admin-only since June 2026/);
    expect(notes).toMatch(/No project posts were joined/);
  });
});
