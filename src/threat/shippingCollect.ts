// Collecting the raw material for the shipping assessment from GitHub and npm.
// Pure fetch: no auth, no cache and no Vercel types, so the same reader serves
// the paid panel (api/github-shipping.ts), the scan-time summary lane
// (api/shipping-summary.ts), the watchlist sweep (server/sweep.ts) and the
// point-in-time backtest (scripts/backtest-shipping.ts).
//
// Budget for one read: GraphQL for the owner's repositories (1), commit
// history across the busiest four (1), committer accounts (1), sector peers
// (1, cached a day by the caller); REST for yearly commit statistics on those
// four repos (up to 4), daily star counts for the flagship (up to 4 pages), and
// the npm registry for up to three published packages (up to 6, keyless).
// GitHub restricted stargazer LISTS to repository admins on 2026-06-30; the
// star-history endpoint it shipped on 2026-09-04 is what the burst read runs on.
import type { ShippingCommit, ShippingIdentity, ShippingInput, ShippingPackage, ShippingPeerRepo, ShippingRepo, ShippingStarDay } from "./shipping";
import type { PeerSector } from "./shippingPeers";

const GQL = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-month";
const API_VERSION = "2026-03-10";
export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const GITHUB_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
const LOGIN_RE = GITHUB_LOGIN_RE;
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const WINDOW_DAYS = 90;
const OWNER_REPOS = 10;
const OWNER_REPOS_FALLBACK = 5; // a lighter second try when GitHub times the big query out
const HISTORY_REPOS = 4;
const HISTORY_PER_REPO = 100;
const IDENTITY_MAX = 25;
const PACKAGES_MAX = 3;
const STAR_HISTORY_PAGES = 4; // 30 weeks a page: about 2.3 years of daily counts
const STAR_HISTORY_MIN_STARS = 30;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "foundry.lock"];

/** A day-scoped cache the caller may supply for the sector peer baseline. */
export interface PeerCache {
  get(key: string): Promise<ShippingPeerRepo[] | null>;
  set(key: string, rows: ShippingPeerRepo[]): Promise<void>;
}

export interface CallCounter { calls: number; succeeded: number }

const gh = (key: string) => ({ authorization: `Bearer ${key}`, "user-agent": "argus-due-diligence" });
let fetchImpl: typeof fetch = (...args) => fetch(...args);

async function graphql<T>(query: string, variables: Record<string, unknown>, key: string, usage: CallCounter): Promise<T> {
  usage.calls += 1;
  const r = await fetchImpl(GQL, {
    method: "POST",
    headers: { ...gh(key), "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`GitHub GraphQL ${r.status}`);
  const body = (await r.json()) as { data?: T; errors?: { message: string; type?: string }[] };
  // A NOT_FOUND on one alias is an answer for that alias; any other error is a failure.
  const hard = (body.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
  if (hard.length) throw new Error(`GitHub GraphQL: ${hard[0].message}`);
  if (!body.data) throw new Error("GitHub GraphQL returned no data");
  usage.succeeded += 1;
  return body.data;
}

async function rest<T>(path: string, key: string, usage: CallCounter): Promise<{ status: number; data: T | null }> {
  usage.calls += 1;
  const r = await fetchImpl(REST + path, {
    headers: { ...gh(key), accept: "application/vnd.github+json", "x-github-api-version": API_VERSION },
    signal: AbortSignal.timeout(9000),
  });
  // 202 is "statistics are being computed": a measured not-yet, not a failure.
  if (r.status === 202) { usage.succeeded += 1; return { status: 202, data: null }; }
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = (await r.json()) as T;
  usage.succeeded += 1;
  return { status: r.status, data };
}

async function keyless<T>(url: string, usage: CallCounter): Promise<T | null> {
  usage.calls += 1;
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = (await r.json()) as T;
    usage.succeeded += 1;
    return data;
  } catch {
    return null;
  }
}

/** Weekly rows { week: unix seconds, total, days[7] } flattened to one point per day. */
function flattenWeeks(rows: { week: number; total?: number; days: number[] }[]): ShippingStarDay[] {
  const out: ShippingStarDay[] = [];
  for (const row of rows) {
    if (typeof row?.week !== "number" || !Array.isArray(row.days)) continue;
    row.days.forEach((n, i) => {
      if (typeof n === "number" && Number.isFinite(n)) out.push({ date: new Date((row.week + i * 86400) * 1000).toISOString().slice(0, 10), stars: n });
    });
  }
  return out;
}

/** Daily star counts: GET /repos/{o}/{r}/stargazers/history, newest first, 30 weeks a page. */
async function readStarHistory(full: string, key: string, usage: CallCounter): Promise<ShippingStarDay[]> {
  const out: ShippingStarDay[] = [];
  for (let page = 1; page <= STAR_HISTORY_PAGES; page++) {
    const { data: rows } = await rest<{ week: number; total: number; days: number[] }[]>(`/repos/${full}/stargazers/history?per_page=30&page=${page}`, key, usage);
    if (!Array.isArray(rows)) throw new Error("GitHub star history had an invalid shape");
    out.push(...flattenWeeks(rows));
    if (rows.length < 30) break;
  }
  return out;
}

/** Weekly commit counts for the last year: GET /repos/{o}/{r}/stats/commit_activity (202 while computing). */
async function readWeeklyCommits(full: string, key: string, usage: CallCounter): Promise<{ weekStart: string; commits: number }[] | null> {
  const { status, data } = await rest<{ week: number; total: number; days: number[] }[]>(`/repos/${full}/stats/commit_activity`, key, usage);
  if (status === 202 || !Array.isArray(data)) return null;
  return data
    .filter((w) => typeof w?.week === "number" && typeof w.total === "number")
    .map((w) => ({ weekStart: new Date(w.week * 1000).toISOString().slice(0, 10), commits: w.total }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

const REPO_FIELDS = `
  nameWithOwner isFork isTemplate isArchived description
  parent { nameWithOwner }
  createdAt pushedAt stargazerCount forkCount
  watchers { totalCount }
  primaryLanguage { name }
  licenseInfo { spdxId }
  releases(first: 12, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName publishedAt } }
  openIssues: issues(states: OPEN) { totalCount }
  openPrs: pullRequests(states: OPEN) { totalCount }
  prSample: pullRequests(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { authorAssociation createdAt } }
  issueSample: issues(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { authorAssociation createdAt } }
  forks(first: 12, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { pushedAt } }
  readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  workflows: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
  testDir: object(expression: "HEAD:test") { ... on Tree { entries { name } } }
  testsDir: object(expression: "HEAD:tests") { ... on Tree { entries { name } } }
  auditsDir: object(expression: "HEAD:audits") { ... on Tree { entries { name } } }
  auditDir: object(expression: "HEAD:audit") { ... on Tree { entries { name } } }
  pkg: object(expression: "HEAD:package.json") { ... on Blob { text } }
  defaultBranchRef { target { ... on Commit {
    history(since: $since, until: $until) { totalCount }
    statusCheckRollup { state }
    ${LOCKFILES.map((f, i) => `lock${i}: history(first: 1, path: ${JSON.stringify(f)}) { nodes { committedDate } }`).join("\n    ")}
  } } }
`;

const HISTORY_FIELDS = `
  nameWithOwner
  defaultBranchRef { target { ... on Commit { history(first: ${HISTORY_PER_REPO}, since: $since, until: $until) { nodes {
    oid committedDate additions deletions changedFilesIfAvailable messageHeadline messageBody
    author { name email user { login createdAt } }
  } } } } }
`;

type Tree = { entries?: { name: string }[] } | null;
type GqlRepo = {
  nameWithOwner: string; isFork: boolean; isTemplate?: boolean; isArchived?: boolean; description?: string | null;
  parent?: { nameWithOwner: string } | null; createdAt: string; pushedAt?: string | null; stargazerCount: number; forkCount: number;
  watchers?: { totalCount: number } | null; primaryLanguage?: { name: string } | null; licenseInfo?: { spdxId?: string | null } | null;
  releases?: { totalCount: number; nodes: { tagName: string; publishedAt?: string | null }[] } | null;
  openIssues?: { totalCount: number } | null; openPrs?: { totalCount: number } | null;
  prSample?: { nodes: { authorAssociation?: string; createdAt?: string }[] } | null;
  issueSample?: { nodes: { authorAssociation?: string; createdAt?: string }[] } | null;
  forks?: { nodes: { pushedAt?: string | null }[] } | null;
  readme?: { byteSize?: number } | null; workflows?: Tree; testDir?: Tree; testsDir?: Tree; auditsDir?: Tree; auditDir?: Tree;
  pkg?: { text?: string | null } | null;
  defaultBranchRef?: { target?: ({ history?: { totalCount: number }; statusCheckRollup?: { state?: string } | null } & Record<string, unknown>) | null } | null;
};
type GqlCommit = {
  oid: string; committedDate: string; additions?: number; deletions?: number; changedFilesIfAvailable?: number | null;
  messageHeadline: string; messageBody?: string | null;
  author?: { name?: string | null; email?: string | null; user?: { login: string; createdAt?: string } | null } | null;
};
type GqlUser = {
  login: string; name?: string | null; twitterUsername?: string | null; company?: string | null; websiteUrl?: string | null; createdAt?: string;
  followers?: { totalCount: number } | null; organizations?: { nodes: { login: string }[] } | null;
};

const INSIDER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const isExternal = (assoc?: string) => !!assoc && !INSIDER.has(assoc);

function packageNameOf(text?: string | null): string | undefined {
  if (!text || text.length > 200_000) return undefined;
  try {
    const pkg = JSON.parse(text) as { name?: unknown; private?: unknown };
    if (pkg.private === true) return undefined;
    return typeof pkg.name === "string" && NPM_NAME_RE.test(pkg.name) ? pkg.name : undefined;
  } catch {
    return undefined;
  }
}

function normaliseRepo(r: GqlRepo, since: string): ShippingRepo {
  const target = r.defaultBranchRef?.target;
  const ciRaw = target?.statusCheckRollup?.state;
  const ciState: ShippingRepo["ciState"] = ciRaw === "SUCCESS" ? "success" : ciRaw === "FAILURE" || ciRaw === "ERROR" ? "failure" : ciRaw === "PENDING" || ciRaw === "EXPECTED" ? "pending" : "unknown";
  const lockDates = LOCKFILES.map((_, i) => (target?.[`lock${i}`] as { nodes?: { committedDate?: string }[] } | undefined)?.nodes?.[0]?.committedDate).filter((d): d is string => !!d).sort();
  const sinceMs = Date.parse(since);
  const prs = r.prSample?.nodes ?? [];
  const issues = r.issueSample?.nodes ?? [];
  const hasEntries = (t: Tree) => (t?.entries?.length ?? 0) > 0;
  return {
    nameWithOwner: r.nameWithOwner,
    isFork: !!r.isFork,
    parent: r.parent?.nameWithOwner,
    isTemplate: !!r.isTemplate,
    isArchived: !!r.isArchived,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt ?? undefined,
    stars: r.stargazerCount ?? 0,
    forks: r.forkCount ?? 0,
    watchers: r.watchers?.totalCount,
    language: r.primaryLanguage?.name,
    license: r.licenseInfo?.spdxId ?? undefined,
    description: r.description ?? undefined,
    releases: (r.releases?.nodes ?? []).filter((n) => n.publishedAt).map((n) => ({ tag: n.tagName, publishedAt: n.publishedAt as string })),
    releaseCount: r.releases?.totalCount ?? 0,
    commitsInWindow: target?.history?.totalCount,
    hasReadme: (r.readme?.byteSize ?? 0) > 0,
    hasCi: hasEntries(r.workflows ?? null),
    hasTests: hasEntries(r.testDir ?? null) || hasEntries(r.testsDir ?? null),
    hasAudit: hasEntries(r.auditsDir ?? null) || hasEntries(r.auditDir ?? null),
    openIssues: r.openIssues?.totalCount,
    openPullRequests: r.openPrs?.totalCount,
    ciState,
    lockfileUpdatedAt: lockDates.length ? lockDates[lockDates.length - 1] : undefined,
    packageName: packageNameOf(r.pkg?.text),
    pullRequestsSampled: prs.length,
    externalPullRequests: prs.filter((p) => isExternal(p.authorAssociation)).length,
    issuesSampled: issues.length,
    externalIssues: issues.filter((p) => isExternal(p.authorAssociation)).length,
    activeForks: (r.forks?.nodes ?? []).filter((f) => f.pushedAt && Date.parse(f.pushedAt) >= sinceMs).length,
  };
}

function normaliseCommit(c: GqlCommit, repo: string): ShippingCommit {
  const email = (c.author?.email ?? "").trim().toLowerCase();
  const login = c.author?.user?.login;
  const name = (c.author?.name ?? "").trim();
  return {
    sha: c.oid,
    date: c.committedDate,
    authorKey: email || (login ? login.toLowerCase() : name.toLowerCase()),
    authorName: name || undefined,
    authorLogin: login ?? undefined,
    authorAccountCreatedAt: c.author?.user?.createdAt,
    additions: c.additions,
    deletions: c.deletions,
    files: c.changedFilesIfAvailable ?? undefined,
    headline: c.messageHeadline,
    body: c.messageBody ?? undefined,
    repo,
  };
}

const alias = (i: number) => `r${i}`;
const splitRepo = (full: string) => { const [owner, name] = full.split("/"); return { owner, name }; };

async function readOwnerRepos(owner: string, since: string, until: string | null, key: string, usage: CallCounter, notes?: string[]): Promise<{ repos: ShippingRepo[]; total: number }> {
  const query = (first: number) => `query($login: String!, $since: GitTimestamp!, $until: GitTimestamp) { repositoryOwner(login: $login) { repositories(first: ${first}, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount nodes { ${REPO_FIELDS} } } } }`;
  type Out = { repositoryOwner?: { repositories?: { totalCount: number; nodes: GqlRepo[] } } | null };
  let d: Out;
  try {
    d = await graphql<Out>(query(OWNER_REPOS), { login: owner, since, until }, key, usage);
  } catch (e) {
    // Large organisations time the wide query out at GitHub's edge (502/504).
    // Read fewer repositories rather than nothing, and say so.
    if (!/GraphQL 50[234]/.test(String(e))) throw e;
    d = await graphql<Out>(query(OWNER_REPOS_FALLBACK), { login: owner, since, until }, key, usage);
    notes?.push(`GitHub timed out on the wide read; only the ${OWNER_REPOS_FALLBACK} most recently pushed repositories were reviewed.`);
  }
  if (!d.repositoryOwner) throw new Error("owner_not_found");
  return { repos: (d.repositoryOwner.repositories?.nodes ?? []).map((r) => normaliseRepo(r, since)), total: d.repositoryOwner.repositories?.totalCount ?? 0 };
}

async function readSingleRepo(full: string, since: string, until: string | null, key: string, usage: CallCounter): Promise<{ repos: ShippingRepo[]; total: number }> {
  const { owner, name } = splitRepo(full);
  const q = `query($owner: String!, $name: String!, $since: GitTimestamp!, $until: GitTimestamp) { repository(owner: $owner, name: $name) { ${REPO_FIELDS} } }`;
  const d = await graphql<{ repository?: GqlRepo | null }>(q, { owner, name, since, until }, key, usage);
  return d.repository ? { repos: [normaliseRepo(d.repository, since)], total: 1 } : { repos: [], total: 0 };
}

async function readHistory(repos: ShippingRepo[], since: string, until: string | null, key: string, usage: CallCounter): Promise<ShippingCommit[]> {
  if (!repos.length) return [];
  const parts = repos.map((r, i) => { const { owner, name } = splitRepo(r.nameWithOwner); return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${HISTORY_FIELDS} }`; });
  const q = `query($since: GitTimestamp!, $until: GitTimestamp) { ${parts.join("\n")} }`;
  const d = await graphql<Record<string, { nameWithOwner: string; defaultBranchRef?: { target?: { history?: { nodes: GqlCommit[] } } | null } | null } | null>>(q, { since, until }, key, usage);
  const out: ShippingCommit[] = [];
  for (const node of Object.values(d)) {
    if (!node) continue;
    for (const c of node.defaultBranchRef?.target?.history?.nodes ?? []) out.push(normaliseCommit(c, node.nameWithOwner));
  }
  return out;
}

/** Who the committers are, from their own GitHub profiles: X handle, employer, public orgs. */
async function readIdentities(logins: string[], key: string, usage: CallCounter): Promise<Record<string, ShippingIdentity>> {
  const out: Record<string, ShippingIdentity> = {};
  const wanted = [...new Set(logins.map((l) => l.toLowerCase()))].filter((l) => LOGIN_RE.test(l)).slice(0, IDENTITY_MAX);
  if (!wanted.length) return out;
  const parts = wanted.map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { login name twitterUsername company websiteUrl createdAt followers { totalCount } organizations(first: 5) { nodes { login } } }`);
  const d = await graphql<Record<string, GqlUser | null>>(`{ ${parts.join("\n")} }`, {}, key, usage);
  for (const u of Object.values(d)) {
    if (!u?.login) continue;
    out[u.login.toLowerCase()] = {
      login: u.login,
      name: u.name ?? undefined,
      twitter: u.twitterUsername ?? undefined,
      company: u.company?.trim() || undefined,
      website: u.websiteUrl ?? undefined,
      orgs: (u.organizations?.nodes ?? []).map((o) => o.login),
      followers: u.followers?.totalCount,
      createdAt: u.createdAt,
    };
  }
  return out;
}

/** Published versions and last-month downloads for the packages the repositories declare. */
async function readPackages(names: string[], usage: CallCounter): Promise<ShippingPackage[]> {
  const out: ShippingPackage[] = [];
  for (const name of [...new Set(names)].slice(0, PACKAGES_MAX)) {
    const meta = await keyless<{ name?: string; time?: Record<string, string> }>(`${NPM_REGISTRY}/${encodeURIComponent(name).replace("%40", "@")}`, usage);
    if (!meta?.time) continue;
    const versions = Object.entries(meta.time)
      .filter(([v]) => v !== "created" && v !== "modified")
      .map(([version, date]) => ({ version, date }))
      .filter((v) => Number.isFinite(Date.parse(v.date)));
    const dl = await keyless<{ downloads?: number }>(`${NPM_DOWNLOADS}/${encodeURIComponent(name).replace("%40", "@")}`, usage);
    out.push({ name, registry: "npm", versions, downloadsLastMonth: typeof dl?.downloads === "number" ? dl.downloads : undefined });
  }
  return out;
}

async function readPeers(sector: PeerSector, since: string, key: string, usage: CallCounter, cache?: PeerCache): Promise<ShippingPeerRepo[]> {
  // The cache holds an entry for a day; a day-stamped key is the TTL.
  const ck = `ghpeers:${sector.id}:${new Date().toISOString().slice(0, 10)}:v1`;
  const cached = cache ? await cache.get(ck) : null;
  if (cached) return cached;
  const parts = sector.repos.map((full, i) => { const { owner, name } = splitRepo(full); return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner stargazerCount defaultBranchRef { target { ... on Commit { history(first: 100, since: $since) { totalCount nodes { author { email user { login } } } } } } } }`; });
  const q = `query($since: GitTimestamp!) { ${parts.join("\n")} }`;
  const d = await graphql<Record<string, { nameWithOwner: string; stargazerCount: number; defaultBranchRef?: { target?: { history?: { totalCount: number; nodes: { author?: { email?: string | null; user?: { login: string } | null } | null }[] } } | null } | null } | null>>(q, { since }, key, usage);
  const rows: ShippingPeerRepo[] = [];
  for (const node of Object.values(d)) {
    if (!node) continue;
    const h = node.defaultBranchRef?.target?.history;
    const authors = new Set<string>();
    for (const c of h?.nodes ?? []) {
      const k = c.author?.user?.login?.toLowerCase() || c.author?.email?.toLowerCase();
      if (k && !/\[bot\]|noreply\.github\.com$/i.test(k)) authors.add(k);
    }
    rows.push({ nameWithOwner: node.nameWithOwner, commitsInWindow: h?.totalCount ?? 0, authorsInWindow: authors.size, stars: node.stargazerCount ?? 0 });
  }
  if (rows.length && cache) await cache.set(ck, rows);
  return rows;
}

export interface CollectShippingOptions {
  /** owner/name to read one repository, or an owner login to read its public repositories. */
  target: string;
  kind: "org" | "user" | "repo";
  key: string;
  usage: CallCounter;
  sector?: PeerSector | null;
  /** End of the window; defaults to now. A past `now` turns the read into a point-in-time read for backtests. */
  now?: Date;
  windowDays?: number;
  /** Skip the reads a backtest cannot date (yearly statistics, peers). */
  pointInTime?: boolean;
  /** Day-scoped cache for the sector peer baseline. */
  peerCache?: PeerCache;
  /** Injected fetch (tests, the collector bundle). */
  fetchImpl?: typeof fetch;
}

/** Everything GitHub and npm can say about the target, normalised for assessShipping. */
export async function collectShipping(opts: CollectShippingOptions): Promise<ShippingInput> {
  const { target, key, usage } = opts;
  if (opts.fetchImpl) fetchImpl = opts.fetchImpl;
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const pointInTime = !!opts.pointInTime || (opts.now != null && Date.now() - opts.now.getTime() > 3600e3);
  const since = new Date(now.getTime() - windowDays * 864e5).toISOString();
  const until = pointInTime ? now.toISOString() : null;
  const readNotes: string[] = [];

  const { repos, total: reposTotal } = opts.kind === "repo"
    ? await readSingleRepo(target, since, until, key, usage)
    : await readOwnerRepos(target, since, until, key, usage, readNotes);
  // Mine history from the busiest original repositories first; forks only if
  // nothing else was touched in the window.
  const ranked = [...repos].sort((a, b) => Number(a.isFork) - Number(b.isFork) || (b.commitsInWindow ?? 0) - (a.commitsInWindow ?? 0));
  const active = ranked.filter((r) => (r.commitsInWindow ?? 0) > 0).slice(0, HISTORY_REPOS);
  const commits = await readHistory(active, since, until, key, usage);

  // Committer accounts: X handle, employer, public orgs. A failure here loses
  // the join, never the assessment.
  let identities: Record<string, ShippingIdentity> | undefined;
  const logins = [...new Set(commits.map((c) => c.authorLogin).filter((l): l is string => !!l && !/\[bot\]$/i.test(l)))];
  if (logins.length) {
    try { identities = await readIdentities(logins, key, usage); } catch { readNotes.push("Committer accounts could not be resolved."); }
  }

  // Yearly weekly commit counts for the mined repositories (not datable, so skipped in a backtest).
  if (!pointInTime) {
    let pending = 0;
    for (const r of active) {
      try {
        const weekly = await readWeeklyCommits(r.nameWithOwner, key, usage);
        if (weekly) r.weeklyCommits = weekly; else pending++;
      } catch { pending++; }
    }
    if (pending) readNotes.push(`Yearly commit statistics were still being computed for ${pending} repositor${pending === 1 ? "y" : "ies"}; the trend uses the window's commits there.`);
  } else {
    readNotes.push("Point-in-time read: yearly commit statistics and peer baselines were not read.");
  }

  // Star timing for the most-starred repository, when there are enough stars to time.
  const flagship = [...repos].sort((a, b) => b.stars - a.stars)[0];
  let starHistory: ShippingStarDay[] | undefined;
  if (flagship && flagship.stars >= STAR_HISTORY_MIN_STARS) {
    try {
      const days = await readStarHistory(flagship.nameWithOwner, key, usage);
      const cut = until ? days.filter((d) => d.date <= until.slice(0, 10)) : days;
      if (cut.length) starHistory = cut;
    } catch {
      readNotes.push("The star history could not be read; the star read is proportional.");
    }
  }
  readNotes.push("GitHub restricted stargazer lists to repository admins on 2026-06-30, so the accounts behind the stars are not readable.");

  // Packages the repositories publish (keyless registry reads).
  let packages: ShippingPackage[] | undefined;
  const names = repos.map((r) => r.packageName).filter((n): n is string => !!n);
  if (names.length && !pointInTime) {
    packages = await readPackages(names, usage);
    if (!packages.length) packages = undefined;
  }

  let peers: ShippingInput["peers"];
  if (opts.sector && !pointInTime) {
    try {
      const rows = await readPeers(opts.sector, since, key, usage, opts.peerCache);
      if (rows.length) peers = { sector: opts.sector.id, label: opts.sector.label, repos: rows };
    } catch {
      readNotes.push("The sector baseline could not be read.");
    }
  }

  return {
    target,
    kind: opts.kind === "user" ? "user" : "org",
    now: now.toISOString(),
    windowDays,
    repos,
    reposTotal,
    commits,
    ...(identities ? { identities } : {}),
    ...(starHistory && flagship ? { starHistory, starHistoryRepo: flagship.nameWithOwner } : {}),
    ...(packages ? { packages } : {}),
    ...(peers ? { peers } : {}),
    readNotes,
  };
}

