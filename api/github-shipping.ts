// Shipping assessment. GET /api/github-shipping?org=<org>|login=<user>[&sector=<id>][&repo=<owner/name>]
//
// Reads the public repositories behind a project and answers the questions a
// due-diligence reader actually has about a GitHub: is anyone still building,
// how many people, how substantial is the work, is it hand-authored or a
// mirror of something private, is the code theirs or a fork, are the stars
// proportionate to the rest of the attention, and how does the cadence sit
// against the leading repositories in the same sector. The judgement lives in
// src/threat/shipping.ts as a pure function; this handler only fetches and
// normalises, so the same assessment can be re-run on the client with the
// price series and the project's own posts joined in.
//
// Budget: one GraphQL query for the owner's repositories, one for commit
// history across the busiest repositories, one for the sector peers (cached a
// day), and up to four REST pages of daily star counts for the flagship
// repository. GitHub restricted stargazer LISTS to repository admins on
// 2026-06-30, so no stargazer sample is fetched; the star-history endpoint it
// shipped on 2026-09-04 (daily counts back to creation) is what the burst read
// runs on.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { assessShipping, type ShippingCommit, type ShippingInput, type ShippingPeerRepo, type ShippingRepo, type ShippingStarDay } from "../src/threat/shipping.js";
import { peerSectorById, type PeerSector } from "../src/threat/shippingPeers.js";

export const config = { maxDuration: 30 };

const GQL = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const API_VERSION = "2026-03-10";
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
const WINDOW_DAYS = 90;
const OWNER_REPOS = 12;
const HISTORY_REPOS = 4;
const HISTORY_PER_REPO = 100;
const CACHE_BUCKET_MS = 6 * 3600 * 1000;
const STAR_HISTORY_PAGES = 4; // 30 weeks a page: about 2.3 years of daily counts
const STAR_HISTORY_MIN_STARS = 30;

interface CallCounter { calls: number; succeeded: number }

async function graphql<T>(query: string, variables: Record<string, unknown>, key: string, usage: CallCounter): Promise<T> {
  usage.calls += 1;
  const r = await fetch(GQL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "argus-due-diligence" },
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

async function rest<T>(path: string, key: string, usage: CallCounter): Promise<T> {
  usage.calls += 1;
  const r = await fetch(REST + path, {
    headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "x-github-api-version": API_VERSION, "user-agent": "argus-due-diligence" },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data: unknown = await r.json();
  usage.succeeded += 1;
  return data as T;
}

/**
 * Daily star counts for one repository: GET /repos/{o}/{r}/stargazers/history
 * returns weeks (newest first, 30 a page) as { week: unix seconds, total, days[7] }.
 * Flattened to one point per day; a short page ends the walk.
 */
async function readStarHistory(full: string, key: string, usage: CallCounter): Promise<ShippingStarDay[]> {
  const out: ShippingStarDay[] = [];
  for (let page = 1; page <= STAR_HISTORY_PAGES; page++) {
    const rows = await rest<{ week: number; total: number; days: number[] }[]>(`/repos/${full}/stargazers/history?per_page=30&page=${page}`, key, usage);
    if (!Array.isArray(rows)) throw new Error("GitHub star history had an invalid shape");
    for (const row of rows) {
      if (typeof row?.week !== "number" || !Array.isArray(row.days)) continue;
      row.days.forEach((n, i) => {
        if (typeof n === "number" && Number.isFinite(n)) out.push({ date: new Date((row.week + i * 86400) * 1000).toISOString().slice(0, 10), stars: n });
      });
    }
    if (rows.length < 30) break;
  }
  return out;
}

const REPO_FIELDS = `
  nameWithOwner isFork isTemplate isArchived description
  parent { nameWithOwner }
  createdAt pushedAt stargazerCount forkCount
  watchers { totalCount }
  primaryLanguage { name }
  licenseInfo { spdxId }
  releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName publishedAt } }
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  workflows: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
  testDir: object(expression: "HEAD:test") { ... on Tree { entries { name } } }
  testsDir: object(expression: "HEAD:tests") { ... on Tree { entries { name } } }
  defaultBranchRef { target { ... on Commit { history(since: $since) { totalCount } } } }
`;

const HISTORY_FIELDS = `
  nameWithOwner
  defaultBranchRef { target { ... on Commit { history(first: ${HISTORY_PER_REPO}, since: $since) { nodes {
    oid committedDate additions deletions changedFilesIfAvailable messageHeadline messageBody
    author { name email user { login createdAt } }
  } } } } }
`;

type GqlRepo = {
  nameWithOwner: string; isFork: boolean; isTemplate?: boolean; isArchived?: boolean; description?: string | null;
  parent?: { nameWithOwner: string } | null; createdAt: string; pushedAt?: string | null; stargazerCount: number; forkCount: number;
  watchers?: { totalCount: number } | null; primaryLanguage?: { name: string } | null; licenseInfo?: { spdxId?: string | null } | null;
  releases?: { totalCount: number; nodes: { tagName: string; publishedAt?: string | null }[] } | null;
  issues?: { totalCount: number } | null; pullRequests?: { totalCount: number } | null;
  readme?: { byteSize?: number } | null; workflows?: { entries?: { name: string }[] } | null;
  testDir?: { entries?: { name: string }[] } | null; testsDir?: { entries?: { name: string }[] } | null;
  defaultBranchRef?: { target?: { history?: { totalCount: number } } | null } | null;
};
type GqlCommit = {
  oid: string; committedDate: string; additions?: number; deletions?: number; changedFilesIfAvailable?: number | null;
  messageHeadline: string; messageBody?: string | null;
  author?: { name?: string | null; email?: string | null; user?: { login: string; createdAt?: string } | null } | null;
};

function normaliseRepo(r: GqlRepo): ShippingRepo {
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
    commitsInWindow: r.defaultBranchRef?.target?.history?.totalCount,
    hasReadme: (r.readme?.byteSize ?? 0) > 0,
    hasCi: (r.workflows?.entries?.length ?? 0) > 0,
    hasTests: (r.testDir?.entries?.length ?? 0) > 0 || (r.testsDir?.entries?.length ?? 0) > 0,
    openIssues: r.issues?.totalCount,
    openPullRequests: r.pullRequests?.totalCount,
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

async function readOwnerRepos(owner: string, since: string, key: string, usage: CallCounter): Promise<ShippingRepo[]> {
  const q = `query($login: String!, $since: GitTimestamp!) { repositoryOwner(login: $login) { repositories(first: ${OWNER_REPOS}, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: OWNER, privacy: PUBLIC) { nodes { ${REPO_FIELDS} } } } }`;
  const d = await graphql<{ repositoryOwner?: { repositories?: { nodes: GqlRepo[] } } | null }>(q, { login: owner, since }, key, usage);
  if (!d.repositoryOwner) throw new Error("owner_not_found");
  return (d.repositoryOwner.repositories?.nodes ?? []).map(normaliseRepo);
}

async function readSingleRepo(full: string, since: string, key: string, usage: CallCounter): Promise<ShippingRepo[]> {
  const { owner, name } = splitRepo(full);
  const q = `query($owner: String!, $name: String!, $since: GitTimestamp!) { repository(owner: $owner, name: $name) { ${REPO_FIELDS} } }`;
  const d = await graphql<{ repository?: GqlRepo | null }>(q, { owner, name, since }, key, usage);
  return d.repository ? [normaliseRepo(d.repository)] : [];
}

async function readHistory(repos: ShippingRepo[], since: string, key: string, usage: CallCounter): Promise<ShippingCommit[]> {
  if (!repos.length) return [];
  const parts = repos.map((r, i) => { const { owner, name } = splitRepo(r.nameWithOwner); return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${HISTORY_FIELDS} }`; });
  const q = `query($since: GitTimestamp!) { ${parts.join("\n")} }`;
  const d = await graphql<Record<string, { nameWithOwner: string; defaultBranchRef?: { target?: { history?: { nodes: GqlCommit[] } } | null } | null } | null>>(q, { since }, key, usage);
  const out: ShippingCommit[] = [];
  for (const node of Object.values(d)) {
    if (!node) continue;
    for (const c of node.defaultBranchRef?.target?.history?.nodes ?? []) out.push(normaliseCommit(c, node.nameWithOwner));
  }
  return out;
}

async function readPeers(sector: PeerSector, since: string, key: string, usage: CallCounter): Promise<ShippingPeerRepo[]> {
  // The cache holds an entry for a day; a day-stamped key is the TTL.
  const ck = `ghpeers:${sector.id}:${new Date().toISOString().slice(0, 10)}:v1`;
  const cached = await cacheGetJson<ShippingPeerRepo[]>(ck);
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
  if (rows.length) await cacheSetJson(ck, rows);
  return rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

  const key = process.env.GITHUB_TOKEN;
  const login = typeof req.query.login === "string" ? req.query.login.replace(/^@/, "").trim() : "";
  const org = typeof req.query.org === "string" ? req.query.org.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "").trim() : "";
  const repoParam = typeof req.query.repo === "string" ? req.query.repo.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").trim() : "";
  const sector = peerSectorById(typeof req.query.sector === "string" ? req.query.sector : "");
  const target = repoParam || login || org;
  if (!target || !(repoParam ? REPO_RE.test(repoParam) : LOGIN_RE.test(target))) { res.status(400).json({ error: "org, login or repo required" }); return; }
  if (!key) { res.status(200).json({ target, available: false, note: "GitHub not configured (no GITHUB_TOKEN)." }); return; }

  // Six-hour buckets in the key: the shared cache keeps entries for a day, and
  // a shipping read older than that would say "shipping" about a repo that
  // went quiet this morning.
  const ck = `ghship:${target.toLowerCase()}:${sector?.id ?? "none"}:${Math.floor(Date.now() / CACHE_BUCKET_MS)}:v1`;
  const cached = await cacheGetJson<Record<string, unknown>>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 864e5).toISOString();
  try {
    const repos = repoParam
      ? await readSingleRepo(repoParam, since, key, usage)
      : await readOwnerRepos(target, since, key, usage);
    // Mine history from the busiest original repositories first; forks only if
    // nothing else was touched in the window.
    const ranked = [...repos].sort((a, b) => Number(a.isFork) - Number(b.isFork) || (b.commitsInWindow ?? 0) - (a.commitsInWindow ?? 0));
    const active = ranked.filter((r) => (r.commitsInWindow ?? 0) > 0).slice(0, HISTORY_REPOS);
    const commits = await readHistory(active, since, key, usage);
    // Star timing for the most-starred repository, when there are enough stars
    // to time. A failed history read is a missing read, not a failed assessment.
    const flagship = [...repos].sort((a, b) => b.stars - a.stars)[0];
    let starHistory: ShippingStarDay[] | undefined;
    if (flagship && flagship.stars >= STAR_HISTORY_MIN_STARS) {
      try {
        const days = await readStarHistory(flagship.nameWithOwner, key, usage);
        if (days.length) starHistory = days;
      } catch {
        // proportional fallback in the module
      }
    }
    let peers: ShippingInput["peers"];
    if (sector) {
      try {
        const rows = await readPeers(sector, since, key, usage);
        if (rows.length) peers = { sector: sector.id, label: sector.label, repos: rows };
      } catch {
        // A missing baseline is a missing baseline; it never fails the read.
      }
    }
    const input: ShippingInput = {
      target,
      kind: repoParam ? "org" : login ? "user" : "org",
      now: now.toISOString(),
      windowDays: WINDOW_DAYS,
      repos,
      commits,
      ...(starHistory && flagship ? { starHistory, starHistoryRepo: flagship.nameWithOwner } : {}),
      ...(peers ? { peers } : {}),
    };
    const assessment = assessShipping(input);
    const out = {
      target,
      available: true,
      reposScanned: repos.map((r) => r.nameWithOwner),
      historyRepos: active.map((r) => r.nameWithOwner),
      input,
      assessment,
      note: repos.length ? assessment.headline : "No public repositories found for this account.",
    };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    const msg = String(e);
    res.status(200).json({ target, available: false, error: msg, note: /owner_not_found/.test(msg) ? "No GitHub account or organization exists at that name." : "GitHub shipping assessment did not complete." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "github",
        op: "panel:github-shipping",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
