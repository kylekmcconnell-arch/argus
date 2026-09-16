import { describe, expect, it } from "vitest";
import { assessShipping, type ShippingCommit, type ShippingInput, type ShippingRepo } from "./shipping";

const NOW = "2026-09-15T12:00:00Z";
const DAY = 864e5;
const daysAgo = (d: number, hour = 9) => new Date(Date.parse(NOW) - d * DAY).toISOString().replace(/T\d\d/, `T${String(hour).padStart(2, "0")}`);

function repo(over: Partial<ShippingRepo> = {}): ShippingRepo {
  return {
    nameWithOwner: "acme/protocol",
    isFork: false,
    createdAt: "2024-01-01T00:00:00Z",
    pushedAt: daysAgo(1),
    stars: 0,
    forks: 0,
    license: "MIT",
    releases: [],
    releaseCount: 0,
    hasReadme: true,
    hasCi: true,
    hasTests: true,
    ...over,
  };
}

function commit(over: Partial<ShippingCommit> & { date: string }): ShippingCommit {
  return {
    sha: Math.random().toString(16).slice(2, 10),
    authorKey: "alice@acme.dev",
    authorName: "Alice",
    authorLogin: "alice",
    additions: 40,
    deletions: 12,
    files: 3,
    headline: "feat(router): batch quotes across pools",
    repo: "acme/protocol",
    ...over,
  };
}

function base(over: Partial<ShippingInput> = {}): ShippingInput {
  return { target: "acme", kind: "org", now: NOW, windowDays: 90, repos: [repo()], commits: [], ...over };
}

/** A three-person team committing most weekdays for the whole window. */
function teamCommits(): ShippingCommit[] {
  const out: ShippingCommit[] = [];
  const people = [
    { authorKey: "alice@acme.dev", authorName: "Alice", authorLogin: "alice" },
    { authorKey: "bob@acme.dev", authorName: "Bob", authorLogin: "bob" },
    { authorKey: "cy@acme.dev", authorName: "Cy", authorLogin: "cy" },
  ];
  for (let d = 88; d >= 0; d -= 2) {
    const p = people[d % 3];
    out.push(commit({ date: daysAgo(d), ...p, headline: `fix(core): tighten slippage guard ${d}` }));
  }
  return out;
}

describe("assessShipping · cadence and committers", () => {
  it("reads a steady multi-author history as a shipping team", () => {
    const a = assessShipping(base({ commits: teamCommits() }));
    expect(a.grade).toBe("shipping-team");
    expect(a.cadence.status).toBe("shipping");
    expect(a.cadence.activeWeeks).toBe(13);
    expect(a.committers.concentration).toBe("team");
    expect(a.committers.distinctHuman).toBe(3);
    expect(a.committers.top1SharePct).toBeLessThan(50);
    expect(a.authorship.verdict).toBe("hand-authored");
    expect(a.origin.verdict).toBe("original");
    expect(a.hygiene.verdict).toBe("maintained");
    expect(a.headline).toMatch(/Shipping as a team: 45 commits/);
  });

  it("reads a single committer as shipping solo and says so in the headline", () => {
    const commits = teamCommits().map((c) => ({ ...c, authorKey: "alice@acme.dev", authorName: "Alice", authorLogin: "alice" }));
    const a = assessShipping(base({ commits }));
    expect(a.grade).toBe("shipping-solo");
    expect(a.committers.concentration).toBe("single-author");
    expect(a.committers.top1SharePct).toBe(100);
    expect(a.headline).toMatch(/one person/);
  });

  it("reads a private-repo mirror as unattributed, never as a person", () => {
    // The private-mirror shape: every public commit is a squashed sync from a
    // bot account, so the public history says who published, not who wrote.
    const commits = Array.from({ length: 44 }, (_, i) =>
      commit({
        date: daysAgo(4 - Math.floor(i / 11), 6 + (i % 11)),
        authorKey: "327801004+mirror-labs@users.noreply.github.com",
        authorName: "Mirror Labs",
        authorLogin: "mirror-labs",
        authorAccountCreatedAt: daysAgo(4),
        headline: `Sync from Mirror Labs (${i.toString(16).padStart(7, "0")})`,
        body: "fix(ui): tolerate a root the public export does not carry\ndocs: the two GitHub budgets",
        additions: 200 + i,
        deletions: 100,
        files: 12,
        repo: "mirror-labs/mirror-open",
      }),
    );
    const a = assessShipping(base({ target: "mirror-labs", repos: [repo({ nameWithOwner: "mirror-labs/mirror-open", createdAt: daysAgo(4), stars: 0 })], commits }));
    expect(a.committers.concentration).toBe("unattributed");
    expect(a.committers.distinctHuman).toBe(0);
    expect(a.committers.mirrorSharePct).toBe(100);
    expect(a.authorship.verdict).toBe("mirrored");
    expect(a.grade).toBe("shipping-solo");
    expect(a.headline).toMatch(/unattributed mirror account/);
    expect(a.caveats.join(" ")).toMatch(/mirrored repository/);
    expect(a.caveats.join(" ")).toMatch(/created inside the window/);
    expect(a.stars.verdict).toBe("none");
  });

  it("grades dormant history as stalled and thin history as thin", () => {
    const stalled = assessShipping(base({ repos: [repo({ pushedAt: daysAgo(75) })], commits: [commit({ date: daysAgo(75) })] }));
    expect(stalled.cadence.status).toBe("dormant");
    expect(stalled.grade).toBe("stalled");
    expect(stalled.headline).toMatch(/stalled: last commit 75 days ago/);

    const thin = assessShipping(base({ commits: [commit({ date: daysAgo(2) }), commit({ date: daysAgo(20) })] }));
    expect(thin.grade).toBe("thin");
    expect(thin.cadence.longestGapDays).toBe(18);
  });

  it("returns unknown when there is nothing to read", () => {
    const a = assessShipping(base({ repos: [], commits: [] }));
    expect(a.grade).toBe("unknown");
    expect(a.cadence.status).toBe("unknown");
    expect(a.committers.concentration).toBe("unknown");
  });

  it("keeps bots out of the concentration read", () => {
    const commits = [
      ...teamCommits(),
      ...Array.from({ length: 60 }, (_, i) => commit({ date: daysAgo(i + 1), authorKey: "49699333+dependabot[bot]@users.noreply.github.com", authorName: "dependabot[bot]", authorLogin: "dependabot[bot]", headline: "chore(deps): bump vite" })),
    ];
    const a = assessShipping(base({ commits }));
    expect(a.committers.botSharePct).toBeGreaterThan(50);
    expect(a.committers.concentration).toBe("team");
    expect(a.committers.distinctHuman).toBe(3);
  });
});

describe("assessShipping · substance, authorship and origin", () => {
  it("flags machine-heavy authorship from AI trailers and placeholder messages", () => {
    const commits = Array.from({ length: 30 }, (_, i) =>
      commit({
        date: daysAgo(i * 3),
        headline: i % 2 ? "update" : "fix",
        body: i % 3 === 0 ? "Co-authored-by: Claude <noreply@anthropic.com>" : undefined,
        additions: 2000,
        deletions: 300,
        files: 40,
      }),
    );
    const a = assessShipping(base({ commits }));
    expect(a.authorship.verdict).toBe("machine-heavy");
    expect(a.authorship.aiTrailerCount).toBe(10);
    expect(a.authorship.genericMessageSharePct).toBe(100);
    expect(a.substance.bulkDropCount).toBe(30);
    expect(a.authorship.evidence.join(" ")).toMatch(/AI co-author trailer/);
  });

  it("measures commit substance and trivial share", () => {
    const commits = [
      commit({ date: daysAgo(1), additions: 1, deletions: 1, files: 1 }),
      commit({ date: daysAgo(2), additions: 2, deletions: 0, files: 1 }),
      commit({ date: daysAgo(3), additions: 300, deletions: 50, files: 9 }),
      commit({ date: daysAgo(4), additions: 120, deletions: 20, files: 4 }),
    ];
    const a = assessShipping(base({ commits }));
    expect(a.substance.measuredCommits).toBe(4);
    expect(a.substance.medianLinesChanged).toBe(71);
    expect(a.substance.trivialSharePct).toBe(50);
    expect(a.substance.medianFiles).toBe(2.5);
  });

  it("reads an all-fork account as derivative and a bulk-import repo as partly derivative", () => {
    const derivative = assessShipping(base({ repos: [repo({ isFork: true, parent: "Uniswap/v4-core" }), repo({ nameWithOwner: "acme/ui", isFork: true, parent: "Uniswap/interface" })], commits: teamCommits() }));
    expect(derivative.origin.verdict).toBe("derivative");
    expect(derivative.origin.forkSharePct).toBe(100);
    expect(derivative.evidence.join(" ")).toMatch(/protocol ← Uniswap\/v4-core/);

    const imported = assessShipping(base({
      repos: [repo({ createdAt: daysAgo(20) })],
      commits: [commit({ date: daysAgo(20), headline: "initial commit", additions: 48000, deletions: 0, files: 620 }), ...teamCommits().filter((c) => Date.parse(c.date) > Date.parse(daysAgo(20)))],
    }));
    expect(imported.origin.verdict).toBe("partly-derivative");
    expect(imported.origin.bulkImports).toEqual(["acme/protocol"]);
  });
});

describe("assessShipping · stars", () => {
  const gazers = (n: number, over: (i: number) => Partial<ShippingInput["stargazers"] extends (infer T)[] | undefined ? T : never>) =>
    Array.from({ length: n }, (_, i) => ({ starredAt: daysAgo(60 - (i % 50)), login: `u${i}`, createdAt: "2019-01-01T00:00:00Z", followers: 12, repos: 8, ...over(i) }));

  it("reads a spread of established accounts as organic", () => {
    const a = assessShipping(base({ repos: [repo({ stars: 400 })], commits: teamCommits(), stargazers: gazers(60, () => ({})), stargazerRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("organic");
    expect(a.stars.lowActivitySharePct).toBe(0);
  });

  it("flags a burst of fresh empty accounts as suspect", () => {
    const burst = gazers(60, (i) => ({ starredAt: daysAgo(30, 1 + (i % 20)), createdAt: daysAgo(31), followers: 0, repos: 0 }));
    const a = assessShipping(base({ repos: [repo({ stars: 900 })], commits: teamCommits(), stargazers: burst, stargazerRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("suspect");
    expect(a.stars.lowActivitySharePct).toBe(100);
    expect(a.stars.burstSharePct).toBe(100);
    expect(a.evidence.join(" ")).toMatch(/Star authenticity is suspect/);
  });

  it("does not call a launch-week burst on a new repository suspect", () => {
    const launch = gazers(60, (i) => ({ starredAt: daysAgo(10, 1 + (i % 20)) }));
    const a = assessShipping(base({ repos: [repo({ stars: 300, createdAt: daysAgo(12) })], commits: teamCommits(), stargazers: launch, stargazerRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("organic");
    expect(a.stars.evidence.join(" ")).toMatch(/normal launch pattern/);
  });

  it("falls back to proportions when no stargazer sample is available", () => {
    // Stars without forks, watchers or work: the shape of a bought number.
    const bought = assessShipping(base({ repos: [repo({ stars: 2400, forks: 3, watchers: 2, commitsInWindow: 2 })], commits: [commit({ date: daysAgo(3) })] }));
    expect(bought.stars.verdict).toBe("suspect");
    expect(bought.stars.evidence.join(" ")).toMatch(/the stars alone/);

    const earned = assessShipping(base({ repos: [repo({ stars: 2400, forks: 310, watchers: 80 })], commits: teamCommits() }));
    expect(earned.stars.verdict).toBe("insufficient");
    expect(earned.stars.evidence.join(" ")).toMatch(/proportions are ordinary/);
  });

  // Daily counts from GitHub's star-history endpoint (the only star timing that
  // is public since stargazer lists were restricted in June 2026).
  const spread = (total: number, days = 300) => Array.from({ length: days }, (_, i) => ({ date: daysAgo(days - i).slice(0, 10), stars: i % Math.max(1, Math.round(days / total)) === 0 ? 1 : 0 }));

  it("times a burst outside launch month from the daily history and calls it suspect", () => {
    const history = spread(60, 300);
    history[200] = { ...history[200], stars: 400 };
    history[201] = { ...history[201], stars: 350 };
    const a = assessShipping(base({ repos: [repo({ stars: 900, forks: 4, watchers: 3 })], commits: teamCommits(), starHistory: history, starHistoryRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("suspect");
    expect(a.stars.burstSharePct).toBeGreaterThan(80);
    expect(a.stars.launchBurst).toBe(false);
    expect(a.stars.historyStars).toBeGreaterThan(700);
    expect(a.stars.evidence.join(" ")).toMatch(/lockstep signature/);
    expect(a.stars.evidence.join(" ")).toMatch(/no longer exposes who starred/);
  });

  it("reads a launch-month burst in the history as normal", () => {
    const created = daysAgo(40);
    const history = spread(20, 40).map((d, i) => (i === 2 ? { ...d, stars: 250 } : d));
    const a = assessShipping(base({ repos: [repo({ stars: 300, forks: 20, watchers: 10, createdAt: created })], commits: teamCommits(), starHistory: history, starHistoryRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("organic");
    expect(a.stars.launchBurst).toBe(true);
    expect(a.stars.evidence.join(" ")).toMatch(/normal launch pattern/);
  });

  it("reads spread star timing with ordinary proportions as organic", () => {
    const a = assessShipping(base({ repos: [repo({ stars: 300, forks: 40, watchers: 12 })], commits: teamCommits(), starHistory: spread(300, 300), starHistoryRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("organic");
    expect(a.stars.burstSharePct).toBeLessThan(10);
    expect(a.stars.evidence.join(" ")).toMatch(/spread across the history/);
  });

  it("combines a soft burst with disproportion into suspect", () => {
    const history = spread(100, 300);
    history[150] = { ...history[150], stars: 60 };
    const a = assessShipping(base({ repos: [repo({ stars: 1200, forks: 5, watchers: 2, commitsInWindow: 1 })], commits: [commit({ date: daysAgo(3) })], starHistory: history, starHistoryRepo: "acme/protocol" }));
    expect(a.stars.burstSharePct).toBeGreaterThanOrEqual(30);
    expect(a.stars.burstSharePct).toBeLessThan(50);
    expect(a.stars.verdict).toBe("suspect");
  });

  it("refuses a timing read on a history with fewer than 30 stars", () => {
    const a = assessShipping(base({ repos: [repo({ stars: 12 })], commits: teamCommits(), starHistory: spread(12, 100), starHistoryRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("insufficient");
    expect(a.caveats.join(" ")).toMatch(/needs at least 30/);
  });

  it("refuses a read on fewer than 20 sampled stargazers", () => {
    const a = assessShipping(base({ repos: [repo({ stars: 30 })], commits: teamCommits(), stargazers: gazers(5, () => ({})), stargazerRepo: "acme/protocol" }));
    expect(a.stars.verdict).toBe("insufficient");
    expect(a.caveats.join(" ")).toMatch(/at least 20/);
  });
});

describe("assessShipping · market, claims and peers", () => {
  const series = (from: number, to: number) => Array.from({ length: 30 }, (_, i) => ({ date: daysAgo(87 - i * 3), close: from + ((to - from) * i) / 29 }));

  it("calls shipping into weakness when price falls while commits hold", () => {
    const a = assessShipping(base({ commits: teamCommits(), priceSeries: series(1, 0.5) }));
    expect(a.market.read).toBe("shipping-into-weakness");
    expect(a.market.priceChangePct).toBe(-50);
  });

  it("calls price without shipping when price rallies into a quiet repo", () => {
    const commits = teamCommits().filter((c) => Date.parse(c.date) < Date.parse(daysAgo(50)));
    const a = assessShipping(base({ commits, repos: [repo({ pushedAt: daysAgo(51) })], priceSeries: series(1, 2) }));
    expect(a.market.read).toBe("price-without-shipping");
    expect(a.market.commitTrendPct).toBe(-100);
  });

  it("reports insufficient without a price series", () => {
    expect(assessShipping(base({ commits: teamCommits() })).market.read).toBe("insufficient");
  });

  it("grades shipping claims against releases and commit bursts", () => {
    const commits = teamCommits();
    const repos = [repo({ releases: [{ tag: "v1.2.0", publishedAt: daysAgo(10) }], releaseCount: 1 })];
    const claims = [
      { date: daysAgo(9), text: "v1.2.0 is live: batch routing shipped to mainnet", url: "https://x.com/acme/status/1" },
      { date: daysAgo(40), text: "we just launched the new dashboard" },
      { date: daysAgo(3), text: "gm, community call tomorrow" },
    ];
    const a = assessShipping(base({ commits, repos, claims }));
    expect(a.claims.graded).toHaveLength(2);
    expect(a.claims.graded[0]).toMatchObject({ grade: "supported", matchedRelease: "v1.2.0" });
    expect(a.claims.graded[1].grade).toBe("supported");
    expect(a.cadence.releasesInWindow).toBe(1);

    const quiet = assessShipping(base({ commits: [], repos: [repo()], claims: [{ date: daysAgo(5), text: "Beta launched today!" }] }));
    expect(quiet.claims.graded[0].grade).toBe("unsupported");
    expect(quiet.claims.unsupported).toBe(1);
    expect(quiet.claims.detail).toMatch(/nothing in the public repositories/);
  });

  it("positions the subject against the peer median", () => {
    const a = assessShipping(base({
      commits: teamCommits(),
      repos: [repo({ stars: 40 })],
      peers: {
        sector: "dex",
        label: "leading decentralized exchanges",
        repos: [
          { nameWithOwner: "Uniswap/v4-core", commitsInWindow: 400, authorsInWindow: 20, stars: 1500 },
          { nameWithOwner: "aerodrome-finance/contracts", commitsInWindow: 60, authorsInWindow: 4, stars: 300 },
          { nameWithOwner: "Uniswap/interface", commitsInWindow: 900, authorsInWindow: 30, stars: 5000 },
        ],
      },
    }));
    expect(a.peers?.median).toEqual({ commitsInWindow: 400, authorsInWindow: 20, stars: 1500 });
    expect(a.peers?.position).toEqual({ commits: "below", authors: "below", stars: "below" });
    expect(a.peers?.detail).toMatch(/45 commits is below the peer median of 400/);
  });
});
