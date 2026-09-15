// Shipping assessment: is the team actually building, who is doing the work,
// how substantial is it, and does the code match the marketing and the chart?
//
// This is the deterministic half of the GitHub read. The API handler
// (api/github-shipping.ts) fetches raw repository, commit, release and
// stargazer data and normalises it into `ShippingInput`; everything below is a
// pure function of that input so it can be replayed in tests and re-run on the
// client with the price series and the project's own posts joined in.
//
// Inspired by the way HEY Research Lab (heyresearch.xyz) separates "what was
// shipped" from "how the token trades": activity status is derived only from
// source-backed development, never from price. We go further in the directions
// a due-diligence report needs: committer concentration, commit substance,
// machine-authored and mirrored history, copied code, star authenticity,
// marketing claims against the commit log, and the sector peer baseline.
//
// Every verdict here is evidence-graded, never an accusation: "single-author"
// says one person wrote the code, not that the project is fake.

export interface ShippingCommit {
  sha: string;
  /** ISO committed date. */
  date: string;
  /** Lower-cased author email, or a login/name fallback when the email is hidden. */
  authorKey: string;
  authorName?: string;
  authorLogin?: string;
  /** ISO creation date of the author's GitHub account, when resolvable. */
  authorAccountCreatedAt?: string;
  additions?: number;
  deletions?: number;
  files?: number;
  headline: string;
  /** Full message body (trailers, squashed subjects) when the provider returned it. */
  body?: string;
  /** owner/name the commit was read from. */
  repo: string;
}

export interface ShippingRelease {
  tag: string;
  publishedAt: string;
}

export interface ShippingRepo {
  nameWithOwner: string;
  isFork: boolean;
  parent?: string;
  isTemplate?: boolean;
  isArchived?: boolean;
  createdAt: string;
  pushedAt?: string;
  stars: number;
  forks: number;
  /** Subscribers ("watching"), when the provider returned it. */
  watchers?: number;
  language?: string;
  license?: string;
  description?: string;
  releases: ShippingRelease[];
  releaseCount: number;
  /** Commits on the default branch inside the window, as counted by the provider. */
  commitsInWindow?: number;
  hasReadme?: boolean;
  hasCi?: boolean;
  hasTests?: boolean;
  openIssues?: number;
  openPullRequests?: number;
  /** State of the newest default-branch commit's checks, when the provider exposed it. */
  ciState?: "success" | "failure" | "pending" | "unknown";
  /** An audits/ or audit/ directory, or an audit report file, exists in the tree. */
  hasAudit?: boolean;
  /** Last commit that touched a lockfile (package-lock, pnpm-lock, yarn.lock, Cargo.lock, foundry.lock). */
  lockfileUpdatedAt?: string;
  /** `name` from package.json at HEAD, when present and public. */
  packageName?: string;
  /** Pull requests sampled newest-first with the author's association to the repository. */
  pullRequestsSampled?: number;
  externalPullRequests?: number;
  issuesSampled?: number;
  externalIssues?: number;
  /** Forks by others that were pushed to inside the window. */
  activeForks?: number;
  /** Weekly commit counts for the last year (provider stats), oldest first. */
  weeklyCommits?: { weekStart: string; commits: number }[];
}

/** What GitHub says about a committer's account, joined onto the roster. */
export interface ShippingIdentity {
  login: string;
  name?: string;
  twitter?: string;
  company?: string;
  website?: string;
  orgs?: string[];
  followers?: number;
  createdAt?: string;
}

/** An on-chain deployment or upgrade by the project's deployer: the code going live. */
export interface ShippingDeploy {
  date: string;
  address: string;
  verified?: boolean;
  kind?: "create" | "upgrade";
  label?: string;
}

/** A published package from a public registry. */
export interface ShippingPackage {
  name: string;
  registry: "npm" | "pypi" | "crates";
  versions: { version: string; date: string }[];
  downloadsLastMonth?: number;
}

/** The compact, frozen form written into a saved report and compared across versions. */
export interface ShippingSummary {
  version: 1;
  target: string;
  capturedAt: string;
  windowDays: number;
  grade: ShippingGrade;
  headline: string;
  cadenceStatus: CadenceStatus;
  totalCommits: number;
  activeWeeks: number;
  distinctHuman: number;
  concentration: Concentration;
  authorship: AuthorshipVerdict;
  origin: OriginVerdict;
  stars: StarVerdict;
  market: MarketRead;
  claimsSupported: number;
  claimsUnsupported: number;
  live: LiveVerdict;
  adoption: AdoptionVerdict;
  health: HealthVerdict;
  leadDeparted: boolean;
  reposRead: number;
  commitsRead: number;
  releasesInWindow: number;
}

export interface ShippingStargazer {
  starredAt: string;
  login: string;
  createdAt?: string;
  followers?: number;
  repos?: number;
}

export interface ShippingStarDay {
  /** ISO date (UTC day). */
  date: string;
  stars: number;
}

export interface ShippingPricePoint {
  /** ISO date of the close. */
  date: string;
  close: number;
}

export interface ShippingClaim {
  date: string;
  text: string;
  url?: string;
}

export interface ShippingPeerRepo {
  nameWithOwner: string;
  commitsInWindow: number;
  authorsInWindow: number;
  stars: number;
}

export interface ShippingPeers {
  sector: string;
  label: string;
  repos: ShippingPeerRepo[];
}

export interface ShippingInput {
  target: string;
  kind: "org" | "user";
  /** ISO time the read was taken; the window ends here. */
  now: string;
  windowDays: number;
  repos: ShippingRepo[];
  commits: ShippingCommit[];
  /** Most recent stargazers of the flagship repository, newest first. */
  stargazers?: ShippingStargazer[];
  /** Which repository the stargazer sample was read from. */
  stargazerRepo?: string;
  /** Daily star counts for the flagship repository from GitHub's star-history endpoint, any order. */
  starHistory?: ShippingStarDay[];
  /** Which repository the star history was read from. */
  starHistoryRepo?: string;
  priceSeries?: ShippingPricePoint[];
  claims?: ShippingClaim[];
  peers?: ShippingPeers;
  /** Account details for committer logins, keyed by lower-cased login. */
  identities?: Record<string, ShippingIdentity>;
  deploys?: ShippingDeploy[];
  packages?: ShippingPackage[];
  /** Roadmap or docs text with dated promises, for the roadmap read. */
  docsText?: string;
  docsSource?: string;
  /** The frozen summary from the previous saved report, for deltas. */
  previous?: ShippingSummary;
  /** A stage cohort computed elsewhere: same chain and cap band, similar age. */
  cohort?: ShippingCohort;
  /** How much of the account the provider actually read; surfaced verbatim. */
  readNotes?: string[];
  /** Repositories the owner has in total, when the provider reported it. */
  reposTotal?: number;
}

export interface ShippingCohort {
  label: string;
  size: number;
  medianCommits: number;
  medianAuthors: number;
  /** Subject's percentile within the cohort, 0-100. */
  percentileCommits?: number;
  percentileAuthors?: number;
  /** Share of the cohort whose grade is shipping (team or solo). */
  shippingSharePct?: number;
}

export type CadenceStatus = "shipping" | "active" | "quiet" | "dormant" | "unknown";
export type Concentration = "team" | "lead-plus" | "single-author" | "unattributed" | "unknown";
export type AuthorshipVerdict = "hand-authored" | "mixed" | "machine-heavy" | "mirrored" | "unknown";
export type OriginVerdict = "original" | "partly-derivative" | "derivative" | "unknown";
export type StarVerdict = "organic" | "suspect" | "insufficient" | "none";
export type MarketRead = "shipping-into-weakness" | "price-without-shipping" | "aligned-up" | "aligned-down" | "mixed" | "insufficient";
export type ClaimGrade = "supported" | "context" | "unsupported";
export type PeerPosition = "below" | "within" | "above" | "unknown";
export type HygieneVerdict = "maintained" | "partial" | "neglected" | "unknown";
export type ShippingGrade = "shipping-team" | "shipping-solo" | "thin" | "stalled" | "unknown";
export type LiveVerdict = "live" | "committed-only" | "deploys-without-code" | "unknown";
export type AdoptionVerdict = "used" | "noticed" | "unused" | "unknown";
export type HealthVerdict = "sound" | "mixed" | "poor" | "unknown";
export type LicenseClass = "permissive" | "copyleft" | "source-available" | "none" | "unknown";
export type RoadmapGrade = "met" | "missed" | "pending" | "unclear";

export interface CadenceWeek {
  weekStart: string;
  commits: number;
}

export interface ShippingCommitter {
  key: string;
  name: string;
  login?: string;
  commits: number;
  sharePct: number;
  kind: "human" | "bot" | "mirror";
  accountCreatedAt?: string;
  /** Account created inside the window: a fresh identity, not necessarily a fresh person. */
  freshAccount: boolean;
  /** Commits in the last 30 days and in the 60 days before that. */
  last30: number;
  prior60: number;
  twitter?: string;
  company?: string;
  orgs?: string[];
  website?: string;
}

export interface ShippingAssessment {
  target: string;
  windowDays: number;
  grade: ShippingGrade;
  headline: string;
  evidence: string[];
  caveats: string[];
  cadence: {
    status: CadenceStatus;
    totalCommits: number;
    activeWeeks: number;
    weeks: CadenceWeek[];
    lastCommitDaysAgo?: number;
    longestGapDays?: number;
    medianGapDays?: number;
    releasesInWindow: number;
  };
  committers: {
    concentration: Concentration;
    distinctHuman: number;
    distinctAll: number;
    top1SharePct: number;
    botSharePct: number;
    mirrorSharePct: number;
    hhi: number;
    roster: ShippingCommitter[];
    churn: {
      leadLogin?: string;
      leadName?: string;
      leadPriorSharePct: number;
      leadLast30: number;
      /** The prior-60-day lead stopped committing while the repository carried on. */
      departed: boolean;
      /** Human committers active in the prior 60 days who have no commits in the last 30. */
      goneQuiet: string[];
      detail: string;
    };
  };
  substance: {
    measuredCommits: number;
    medianLinesChanged?: number;
    meanLinesChanged?: number;
    medianFiles?: number;
    trivialSharePct?: number;
    docsOnlySharePct?: number;
    bulkDropCount: number;
  };
  authorship: {
    verdict: AuthorshipVerdict;
    aiTrailerCount: number;
    genericMessageSharePct?: number;
    bulkDropCount: number;
    mirroredSharePct: number;
    evidence: string[];
  };
  origin: {
    verdict: OriginVerdict;
    forks: { repo: string; parent: string }[];
    forkSharePct: number;
    templates: string[];
    /** Repositories whose window history opens with a bulk code drop: imported, not grown. */
    bulkImports: string[];
  };
  stars: {
    verdict: StarVerdict;
    total: number;
    sampled: number;
    repo?: string;
    lowActivitySharePct?: number;
    burstSharePct?: number;
    burstWindowStart?: string;
    /** Stars counted by the daily history, when one was read. */
    historyStars?: number;
    launchBurst?: boolean;
    evidence: string[];
  };
  hygiene: {
    verdict: HygieneVerdict;
    reposReviewed: number;
    withLicense: number;
    withReadme: number;
    withCi: number;
    withTests: number;
    archived: number;
    openIssues: number;
    openPullRequests: number;
  };
  market: {
    read: MarketRead;
    priceChangePct?: number;
    commitTrendPct?: number;
    detail: string;
  };
  claims: {
    graded: (ShippingClaim & { grade: ClaimGrade; matchedCommits: number; matchedRelease?: string })[];
    supported: number;
    context: number;
    unsupported: number;
    detail: string;
  };
  peers?: {
    sector: string;
    label: string;
    subject: { commitsInWindow: number; authorsInWindow: number; stars: number };
    median: { commitsInWindow: number; authorsInWindow: number; stars: number };
    position: { commits: PeerPosition; authors: PeerPosition; stars: PeerPosition };
    rows: ShippingPeerRepo[];
    detail: string;
  };
  cohort?: ShippingCohort & { detail: string };
  live: {
    verdict: LiveVerdict;
    deploysInWindow: number;
    verifiedDeploys: number;
    publishesInWindow: number;
    /** Deploys or publishes that followed a release or a burst of commits within 14 days. */
    codeToChain: number;
    detail: string;
  };
  adoption: {
    verdict: AdoptionVerdict;
    externalPrSharePct?: number;
    externalIssueSharePct?: number;
    externalPrs: number;
    externalIssues: number;
    activeForks: number;
    packageDownloadsLastMonth?: number;
    packages: string[];
    detail: string;
  };
  health: {
    verdict: HealthVerdict;
    ci: "success" | "failure" | "pending" | "unknown";
    license: LicenseClass;
    licenseId?: string;
    auditInTree: boolean;
    lockfileAgeDays?: number;
    detail: string;
  };
  trend: {
    /** Up to 52 weeks, oldest first; price is the week's median close when a series was supplied. */
    weeks: { weekStart: string; commits: number; price?: number; releases: number; deploys: number }[];
    lifeCommits: number;
    activeWeeksLife: number;
    source: "provider-weekly" | "window-commits" | "none";
    detail: string;
  };
  roadmap: {
    claims: { text: string; due: string; grade: RoadmapGrade; evidence: string }[];
    met: number;
    missed: number;
    pending: number;
    detail: string;
  };
  delta?: {
    capturedAt: string;
    grade: { from: ShippingGrade; to: ShippingGrade };
    commits: { from: number; to: number; changePct?: number };
    humans: { from: number; to: number };
    cadence: { from: CadenceStatus; to: CadenceStatus };
    stalled: boolean;
    detail: string;
  };
  coverage: {
    reposTotal?: number;
    reposRead: number;
    historyRepos: number;
    commitsCounted: number;
    commitsRead: number;
    starHistoryDays: number;
    weeklyStatsRead: boolean;
    identitiesRead: number;
    windowDays: number;
    notes: string[];
  };
}

const DAY = 864e5;

const BOT_NAME = /\[bot\]$|^(github-actions|dependabot|renovate|snyk-bot|greenkeeper|mergify|semantic-release|codecov|imgbot)/i;
const NOREPLY = /noreply\.github\.com$|^noreply@|^no-reply@/i;
const MIRROR_HEADLINE = /^(sync(ed|ing)?|mirror(ed)?|export(ed)?|publish(ed)?|import(ed)?)\b.*\b(from|to|of)\b|^sync from\b|^automated sync\b/i;
const GENERIC_HEADLINE = /^(update|updates|updated|fix|fixes|fixed|wip|changes|change|misc|stuff|test|tests|tmp|temp|asdf|\.+|init|initial commit|first commit|commit|save|cleanup|minor)\.?$/i;
const DOCS_HEADLINE = /\b(docs?|readme|typo|changelog|license|comment(s)?)\b/i;
const AI_TRAILER = /co-authored-by:[^\n]*\b(claude|copilot|chatgpt|openai|cursor|codex|devin|gemini|aider|sweep|windsurf)\b|generated with \[?claude|🤖 generated with|made with (cursor|copilot)/i;
const SHIP_CLAIM = /\b(launch(ed|ing|es)?|releas(ed|e|es|ing)|shipp(ed|ing)|v\d+(\.\d+)+|mainnet|is live|now live|went live|deploy(ed|ing)|beta|alpha|new version|update is (out|live)|rolled out|rolling out)\b/i;

const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|Unlicense|CC0-1\.0|0BSD|Zlib)$/i;
const COPYLEFT = /^(GPL|AGPL|LGPL)/i;
const SOURCE_AVAILABLE = /^(BUSL|BSL|SSPL|Elastic|Commons-Clause)/i;
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const ROADMAP_RE = new RegExp(`\\b(Q[1-4]\\s*['’]?(?:20)?\\d{2}|H[12]\\s*['’]?(?:20)?\\d{2}|(?:${MONTHS})\\.?\\s+20\\d{2}|(?:end of|by|before|in)\\s+20\\d{2})\\b`, "gi");

const BULK_LINES = 1500;
const BULK_FILES = 15;
const TRIVIAL_LINES = 5;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const parse = (iso?: string): number => (iso ? Date.parse(iso) : NaN);
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function committerKind(c: ShippingCommit): ShippingCommitter["kind"] {
  const name = c.authorName ?? "";
  if (BOT_NAME.test(name) || BOT_NAME.test(c.authorLogin ?? "")) return "bot";
  if (MIRROR_HEADLINE.test(c.headline) && (NOREPLY.test(c.authorKey) || !c.authorKey.includes("@"))) return "mirror";
  return "human";
}

function positionOf(value: number, med: number): PeerPosition {
  if (!Number.isFinite(med) || med <= 0) return "unknown";
  if (value < med * 0.5) return "below";
  if (value > med * 1.5) return "above";
  return "within";
}

function statusFromDays(days?: number): CadenceStatus {
  if (days == null) return "unknown";
  if (days <= 7) return "shipping";
  if (days <= 30) return "active";
  if (days <= 60) return "quiet";
  return "dormant";
}

function licenseClass(id?: string): LicenseClass {
  if (!id) return "none";
  if (PERMISSIVE.test(id)) return "permissive";
  if (COPYLEFT.test(id)) return "copyleft";
  if (SOURCE_AVAILABLE.test(id)) return "source-available";
  return "unknown";
}

/** Turn a roadmap phrase into the last day of the period it names. */
export function roadmapDue(phrase: string, fallbackYearFrom?: string): number {
  const p = phrase.trim().toLowerCase().replace(/['’]/g, "");
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = p.match(/^q([1-4])\s*(\d{2,4})$/);
  if (m) return Date.UTC(year(m[2]), Number(m[1]) * 3, 0, 23, 59, 59);
  m = p.match(/^h([12])\s*(\d{2,4})$/);
  if (m) return Date.UTC(year(m[2]), Number(m[1]) * 6, 0, 23, 59, 59);
  m = p.match(new RegExp(`^(${MONTHS})\\.?\\s+(\\d{4})$`));
  if (m) {
    const idx = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(m[1].slice(0, 3));
    return Date.UTC(Number(m[2]), idx + 1, 0, 23, 59, 59);
  }
  m = p.match(/(\d{4})$/);
  if (m) return Date.UTC(Number(m[1]), 12, 0, 23, 59, 59);
  return fallbackYearFrom ? parse(fallbackYearFrom) : NaN;
}

/** Dated promises in roadmap or docs text: the phrase, the sentence it sits in, and its due date. */
export function extractRoadmapClaims(text: string | undefined, max = 12): { text: string; due: string }[] {
  if (!text) return [];
  const out: { text: string; due: string }[] = [];
  const seen = new Set<string>();
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?•\n])\s+|\s{2,}|\s[-–—]\s/);
  for (const sentence of sentences) {
    const hits = sentence.match(ROADMAP_RE);
    if (!hits) continue;
    const due = roadmapDue(hits[0]);
    if (!Number.isFinite(due)) continue;
    const clean = sentence.trim().slice(0, 160);
    const key = `${hits[0].toLowerCase()}|${clean.toLowerCase().slice(0, 60)}`;
    if (seen.has(key) || clean.length < 12) continue;
    seen.add(key);
    out.push({ text: clean, due: new Date(due).toISOString() });
    if (out.length >= max) break;
  }
  return out;
}

export function assessShipping(input: ShippingInput): ShippingAssessment {
  const nowMs = parse(input.now);
  const windowMs = input.windowDays * DAY;
  const windowStart = nowMs - windowMs;
  const evidence: string[] = [];
  const caveats: string[] = [];

  const commits = input.commits
    .filter((c) => Number.isFinite(parse(c.date)) && parse(c.date) >= windowStart && parse(c.date) <= nowMs + DAY)
    .sort((a, b) => parse(a.date) - parse(b.date));

  // ---- cadence ---------------------------------------------------------
  const weekCount = Math.max(1, Math.ceil(input.windowDays / 7));
  const weeks: CadenceWeek[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = nowMs - (i + 1) * 7 * DAY;
    const end = start + 7 * DAY;
    const n = commits.filter((c) => parse(c.date) >= start && parse(c.date) < end).length;
    weeks.push({ weekStart: isoDate(start), commits: n });
  }
  const activeWeeks = weeks.filter((w) => w.commits > 0).length;
  const lastCommitMs = commits.length ? parse(commits[commits.length - 1].date) : NaN;
  const lastPushMs = Math.max(...input.repos.map((r) => parse(r.pushedAt)).filter(Number.isFinite), NaN);
  const recencyMs = Number.isFinite(lastCommitMs) ? lastCommitMs : lastPushMs;
  const lastCommitDaysAgo = Number.isFinite(recencyMs) ? Math.max(0, Math.round((nowMs - recencyMs) / DAY)) : undefined;
  const gaps: number[] = [];
  for (let i = 1; i < commits.length; i++) gaps.push((parse(commits[i].date) - parse(commits[i - 1].date)) / DAY);
  if (commits.length) gaps.push((nowMs - lastCommitMs) / DAY);
  const longestGapDays = gaps.length ? round1(Math.max(...gaps)) : undefined;
  const medianGapDays = gaps.length ? round1(median(gaps) ?? 0) : undefined;
  const releasesInWindow = input.repos.reduce((n, r) => n + r.releases.filter((rel) => parse(rel.publishedAt) >= windowStart).length, 0);
  const status: CadenceStatus = input.repos.length === 0 && commits.length === 0 ? "unknown" : statusFromDays(lastCommitDaysAgo);

  // ---- committers ------------------------------------------------------
  const roster = new Map<string, ShippingCommitter>();
  const last30Start = nowMs - 30 * DAY;
  const prior60Start = nowMs - 90 * DAY;
  const identities = input.identities ?? {};
  for (const c of commits) {
    const kind = committerKind(c);
    const key = kind === "mirror" ? `mirror:${c.authorKey}` : c.authorKey;
    let row = roster.get(key);
    if (!row) {
      const createdMs = parse(c.authorAccountCreatedAt);
      row = {
        key,
        name: c.authorName || c.authorLogin || c.authorKey,
        login: c.authorLogin,
        commits: 0,
        sharePct: 0,
        kind,
        accountCreatedAt: c.authorAccountCreatedAt,
        freshAccount: Number.isFinite(createdMs) && createdMs >= windowStart,
        last30: 0,
        prior60: 0,
      };
      roster.set(key, row);
    }
    row.commits++;
    const t = parse(c.date);
    if (t >= last30Start) row.last30++;
    else if (t >= prior60Start) row.prior60++;
    if (!row.login && c.authorLogin) row.login = c.authorLogin;
  }
  for (const row of roster.values()) {
    const id = row.login ? identities[row.login.toLowerCase()] : undefined;
    if (!id) continue;
    if (id.twitter) row.twitter = id.twitter.replace(/^@/, "");
    if (id.company) row.company = id.company;
    if (id.website) row.website = id.website;
    if (id.orgs?.length) row.orgs = id.orgs.slice(0, 5);
    if (id.name && (!row.name || row.name === row.login)) row.name = id.name;
    if (id.createdAt && !row.accountCreatedAt) { row.accountCreatedAt = id.createdAt; row.freshAccount = parse(id.createdAt) >= windowStart; }
  }
  const rows = [...roster.values()].sort((a, b) => b.commits - a.commits);
  const total = commits.length;
  for (const r of rows) r.sharePct = pct(r.commits, total);
  const humans = rows.filter((r) => r.kind === "human");
  const humanCommits = humans.reduce((n, r) => n + r.commits, 0);
  const botCommits = rows.filter((r) => r.kind === "bot").reduce((n, r) => n + r.commits, 0);
  const mirrorCommits = rows.filter((r) => r.kind === "mirror").reduce((n, r) => n + r.commits, 0);
  const attributable = humanCommits + mirrorCommits;
  const top1SharePct = attributable ? pct(Math.max(...rows.filter((r) => r.kind !== "bot").map((r) => r.commits)), attributable) : 0;
  const hhi = attributable
    ? Math.round(rows.filter((r) => r.kind !== "bot").reduce((s, r) => s + Math.pow(r.commits / attributable, 2), 0) * 1000) / 1000
    : 0;
  let concentration: Concentration;
  if (total === 0) concentration = "unknown";
  else if (humans.length === 0) concentration = "unattributed";
  else if (top1SharePct >= 85) concentration = "single-author";
  else if (top1SharePct >= 50) concentration = "lead-plus";
  else concentration = "team";

  // Churn: who carried the prior 60 days, and are they still here? A lead who
  // stops while the repository carries on is the strongest departure signal a
  // public repo gives; a lead who stops with everyone else is just a stall.
  const priorLead = [...humans].sort((a, b) => b.prior60 - a.prior60)[0];
  const priorTotal = humans.reduce((n, r) => n + r.prior60, 0);
  const recentTotal = humans.reduce((n, r) => n + r.last30, 0);
  const leadPriorSharePct = priorLead && priorTotal ? pct(priorLead.prior60, priorTotal) : 0;
  const departed = !!priorLead && priorLead.prior60 >= 5 && priorLead.last30 === 0 && recentTotal >= 3;
  const goneQuiet = humans.filter((h) => h.prior60 >= 3 && h.last30 === 0).map((h) => h.login ? `@${h.login}` : h.name);
  const churnDetail = !priorLead || priorTotal === 0
    ? "Not enough history before the last 30 days to read committer churn."
    : departed
      ? `${priorLead.login ? `@${priorLead.login}` : priorLead.name} wrote ${leadPriorSharePct}% of the prior 60 days' commits and none in the last 30 while ${recentTotal} commits landed from others: the lead has stopped and the repository has not.`
      : goneQuiet.length
        ? `${goneQuiet.length} committer${goneQuiet.length === 1 ? "" : "s"} active in the prior 60 days ${goneQuiet.length === 1 ? "has" : "have"} no commits in the last 30 (${goneQuiet.slice(0, 3).join(", ")}).`
        : `${priorLead.login ? `@${priorLead.login}` : priorLead.name} carried ${leadPriorSharePct}% of the prior 60 days and is still committing (${priorLead.last30} in the last 30).`;

  // ---- substance -------------------------------------------------------
  const measured = commits.filter((c) => c.additions != null && c.deletions != null);
  const lines = measured.map((c) => (c.additions ?? 0) + (c.deletions ?? 0));
  const files = measured.map((c) => c.files ?? 0).filter((n) => n > 0);
  const trivial = measured.filter((c) => (c.additions ?? 0) + (c.deletions ?? 0) <= TRIVIAL_LINES).length;
  const docsOnly = commits.filter((c) => DOCS_HEADLINE.test(c.headline) && !/\b(feat|feature|add|implement|fix)\b/i.test(c.headline)).length;
  const bulkDrops = measured.filter((c) => (c.additions ?? 0) + (c.deletions ?? 0) >= BULK_LINES && (c.files ?? 0) >= BULK_FILES);
  const substance = {
    measuredCommits: measured.length,
    medianLinesChanged: median(lines),
    meanLinesChanged: lines.length ? Math.round(lines.reduce((a, b) => a + b, 0) / lines.length) : undefined,
    medianFiles: median(files),
    trivialSharePct: measured.length ? pct(trivial, measured.length) : undefined,
    docsOnlySharePct: total ? pct(docsOnly, total) : undefined,
    bulkDropCount: bulkDrops.length,
  };

  // ---- authorship ------------------------------------------------------
  const aiTrailerCount = commits.filter((c) => AI_TRAILER.test(`${c.headline}\n${c.body ?? ""}`)).length;
  const generic = commits.filter((c) => GENERIC_HEADLINE.test(c.headline.trim())).length;
  const mirroredSharePct = total ? pct(mirrorCommits, total) : 0;
  const authorshipEvidence: string[] = [];
  let authorship: AuthorshipVerdict;
  if (total === 0) authorship = "unknown";
  else if (mirroredSharePct >= 80) {
    authorship = "mirrored";
    authorshipEvidence.push(`${mirroredSharePct}% of commits are sync/mirror exports from a private repository, so the public history says who published, not who wrote.`);
  } else {
    const aiShare = pct(aiTrailerCount, total);
    const genericShare = pct(generic, total);
    if (aiShare >= 30 || (bulkDrops.length >= 3 && genericShare >= 30)) authorship = "machine-heavy";
    else if (aiShare > 0 || genericShare >= 30 || bulkDrops.length >= 2) authorship = "mixed";
    else authorship = "hand-authored";
    if (aiTrailerCount) authorshipEvidence.push(`${aiTrailerCount} commit${aiTrailerCount === 1 ? "" : "s"} carry an AI co-author trailer (Claude, Copilot, Cursor or similar).`);
    if (genericShare >= 30) authorshipEvidence.push(`${genericShare}% of commit messages are placeholders ("update", "fix", "wip").`);
    if (bulkDrops.length) authorshipEvidence.push(`${bulkDrops.length} bulk drop${bulkDrops.length === 1 ? "" : "s"} of ${BULK_LINES}+ lines across ${BULK_FILES}+ files landed as single commits.`);
    if (authorship === "hand-authored") authorshipEvidence.push("Commit messages are specific and the change sizes are incremental, consistent with hand-authored work.");
  }

  // ---- origin ----------------------------------------------------------
  const forks = input.repos.filter((r) => r.isFork).map((r) => ({ repo: r.nameWithOwner, parent: r.parent ?? "unknown upstream" }));
  const templates = input.repos.filter((r) => r.isTemplate).map((r) => r.nameWithOwner);
  const forkSharePct = input.repos.length ? pct(forks.length, input.repos.length) : 0;
  const bulkImports: string[] = [];
  for (const r of input.repos) {
    const first = commits.find((c) => c.repo === r.nameWithOwner);
    if (!first) continue;
    const opensWithDrop = (first.additions ?? 0) >= BULK_LINES && (first.files ?? 0) >= BULK_FILES && parse(r.createdAt) >= windowStart;
    if (opensWithDrop) bulkImports.push(r.nameWithOwner);
  }
  let origin: OriginVerdict;
  if (input.repos.length === 0) origin = "unknown";
  else if (forkSharePct >= 80 || (forks.length > 0 && forks.length === input.repos.length)) origin = "derivative";
  else if (forks.length > 0 || bulkImports.length > 0) origin = "partly-derivative";
  else origin = "original";

  // ---- stars -----------------------------------------------------------
  // GitHub restricted stargazer LISTS to a repository's own admins on
  // 2026-06-30 (spam scraping), so the account-level StarScout read (young,
  // empty accounts) can only run on a sample someone else supplied. What is
  // public since 2026-09-04 is the star HISTORY: daily counts back to creation.
  // That carries the other StarScout signature, lockstep timing, and the
  // proportion check (stars against forks, watchers and work) needs no list.
  const sample = input.stargazers ?? [];
  const starTotal = input.repos.reduce((n, r) => n + r.stars, 0);
  const starEvidence: string[] = [];
  let starVerdict: StarVerdict;
  let lowActivitySharePct: number | undefined;
  let burstSharePct: number | undefined;
  let burstWindowStart: string | undefined;
  let historyStars: number | undefined;
  let launchBurst = false;
  const flagship = input.repos.find((r) => r.nameWithOwner === (input.starHistoryRepo ?? input.stargazerRepo)) ?? [...input.repos].sort((a, b) => b.stars - a.stars)[0];
  const proportion = (() => {
    if (!flagship || flagship.stars < 100) return null;
    const forkRatio = flagship.forks / flagship.stars;
    const watchRatio = flagship.watchers != null ? flagship.watchers / flagship.stars : undefined;
    const commitsOnFlagship = commits.filter((c) => c.repo === flagship.nameWithOwner).length;
    const thinWork = commitsOnFlagship < 5 && (flagship.commitsInWindow ?? commitsOnFlagship) < 5;
    const disproportionate = forkRatio < 0.02 && (watchRatio == null || watchRatio < 0.01) && (thinWork || flagship.stars >= 1000);
    const line = `${flagship.nameWithOwner} has ${flagship.stars} stars against ${flagship.forks} forks${flagship.watchers != null ? ` and ${flagship.watchers} watchers` : ""}${thinWork ? " with under five commits in the window" : ""}.`;
    return { disproportionate, line };
  })();
  const history = (input.starHistory ?? []).filter((d) => Number.isFinite(parse(d.date)) && Number.isFinite(d.stars) && d.stars >= 0).sort((a, b) => parse(a.date) - parse(b.date));
  if (history.length) {
    historyStars = history.reduce((n, d) => n + d.stars, 0);
    if (historyStars >= 30) {
      // Largest three consecutive days against everything the history holds.
      let best = 0;
      let bestStart = history[0].date;
      for (let i = 0; i < history.length; i++) {
        let n = 0;
        for (let j = i; j < history.length && parse(history[j].date) - parse(history[i].date) < 3 * DAY; j++) n += history[j].stars;
        if (n > best) { best = n; bestStart = history[i].date; }
      }
      burstSharePct = pct(best, historyStars);
      burstWindowStart = bestStart;
      const repoAgeAtBurstDays = flagship ? (parse(bestStart) - parse(flagship.createdAt)) / DAY : undefined;
      launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    }
  }
  if (starTotal === 0) {
    starVerdict = "none";
    starEvidence.push("No stars on the reviewed repositories, so there is nothing to authenticate.");
  } else if (sample.length >= 20) {
    const low = sample.filter((s) => {
      const created = parse(s.createdAt);
      const starred = parse(s.starredAt);
      const youngAccount = Number.isFinite(created) && Number.isFinite(starred) && starred - created <= 30 * DAY;
      const empty = (s.repos ?? 1) === 0 && (s.followers ?? 1) === 0;
      return youngAccount || empty;
    }).length;
    lowActivitySharePct = pct(low, sample.length);
    const times = sample.map((s) => parse(s.starredAt)).filter(Number.isFinite).sort((a, b) => a - b);
    let best = 0;
    let bestStart = times[0];
    for (let i = 0, j = 0; i < times.length; i++) {
      while (times[i] - times[j] > 72 * 3600e3) j++;
      const n = i - j + 1;
      if (n > best) { best = n; bestStart = times[j]; }
    }
    burstSharePct = pct(best, times.length);
    burstWindowStart = Number.isFinite(bestStart) ? new Date(bestStart).toISOString() : undefined;
    const sampledRepo = input.repos.find((r) => r.nameWithOwner === input.stargazerRepo);
    const repoAgeAtBurstDays = sampledRepo && Number.isFinite(bestStart) ? (bestStart - parse(sampledRepo.createdAt)) / DAY : undefined;
    launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    const suspect = lowActivitySharePct >= 40 || (burstSharePct >= 50 && !launchBurst);
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${lowActivitySharePct}% of ${sample.length} sampled stargazers are low-activity accounts (created within 30 days of starring, or no repos and no followers).`);
    starEvidence.push(`${burstSharePct}% of sampled stars landed inside one 72-hour window${launchBurst ? " during the repository's first month, which is a normal launch pattern" : ""}.`);
    if (suspect) starEvidence.push("This is the signature StarScout (Six Million Suspected Fake Stars, ICSE 2026) associates with purchased stars.");
  } else if (burstSharePct != null && historyStars != null && flagship) {
    // Timing from the public daily history, proportion from the repo counts.
    const timedBurst = burstSharePct >= 50 && !launchBurst;
    const softBurst = burstSharePct >= 30 && !launchBurst;
    const suspect = timedBurst || (softBurst && !!proportion?.disproportionate) || (!!proportion?.disproportionate && burstSharePct >= 15);
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${burstSharePct}% of ${flagship.nameWithOwner}'s ${historyStars.toLocaleString("en-US")} stars arrived inside one three-day window starting ${burstWindowStart}${launchBurst ? ", inside the repository's first month, which is a normal launch pattern" : ""}.`);
    if (proportion) starEvidence.push(proportion.line + (proportion.disproportionate ? " Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone." : ""));
    if (suspect) starEvidence.push("A star burst outside launch week, with nothing else growing alongside it, is the lockstep signature StarScout associates with purchased stars. GitHub no longer exposes who starred, so the accounts themselves cannot be checked.");
    else starEvidence.push("Star timing is spread across the history; the accounts behind the stars are no longer readable since GitHub restricted stargazer lists in June 2026.");
  } else if (proportion) {
    starVerdict = proportion.disproportionate ? "suspect" : "insufficient";
    starEvidence.push(`No star history or stargazer sample was available, so the read is proportional: ${proportion.line}`);
    if (proportion.disproportionate) starEvidence.push("Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone.");
    else starEvidence.push("The proportions are ordinary; nothing here separates bought stars from earned ones without the star history.");
  } else {
    starVerdict = "insufficient";
    starEvidence.push(historyStars != null && historyStars < 30
      ? `The star history holds ${historyStars} star${historyStars === 1 ? "" : "s"}; a timing read needs at least 30.`
      : `Only ${sample.length} stargazer${sample.length === 1 ? "" : "s"} could be sampled; a star-authenticity read needs at least 20.`);
  }

  // ---- hygiene ---------------------------------------------------------
  const hyg = {
    reposReviewed: input.repos.length,
    withLicense: input.repos.filter((r) => !!r.license).length,
    withReadme: input.repos.filter((r) => r.hasReadme).length,
    withCi: input.repos.filter((r) => r.hasCi).length,
    withTests: input.repos.filter((r) => r.hasTests).length,
    archived: input.repos.filter((r) => r.isArchived).length,
    openIssues: input.repos.reduce((n, r) => n + (r.openIssues ?? 0), 0),
    openPullRequests: input.repos.reduce((n, r) => n + (r.openPullRequests ?? 0), 0),
  };
  let hygieneVerdict: HygieneVerdict = "unknown";
  if (input.repos.length) {
    const score = [hyg.withLicense, hyg.withReadme, hyg.withCi, hyg.withTests].filter((n) => n > 0).length;
    hygieneVerdict = score >= 3 ? "maintained" : score >= 1 ? "partial" : "neglected";
  }

  // ---- market ----------------------------------------------------------
  const price = (input.priceSeries ?? []).filter((p) => Number.isFinite(p.close) && Number.isFinite(parse(p.date)) && parse(p.date) >= windowStart).sort((a, b) => parse(a.date) - parse(b.date));
  let marketRead: MarketRead = "insufficient";
  let priceChangePct: number | undefined;
  let commitTrendPct: number | undefined;
  let marketDetail = "Not enough price history or commits to compare the chart with the commit log.";
  if (price.length >= 4 && total > 0) {
    priceChangePct = round1(((price[price.length - 1].close - price[0].close) / price[0].close) * 100);
    const mid = nowMs - windowMs / 2;
    const firstHalf = commits.filter((c) => parse(c.date) < mid).length;
    const secondHalf = total - firstHalf;
    commitTrendPct = firstHalf > 0 ? round1(((secondHalf - firstHalf) / firstHalf) * 100) : secondHalf > 0 ? 100 : 0;
    const shippingUp = secondHalf >= firstHalf && secondHalf > 0;
    const shippingDown = secondHalf < firstHalf * 0.5;
    if (priceChangePct <= -15 && shippingUp) {
      marketRead = "shipping-into-weakness";
      marketDetail = `Price is down ${Math.abs(priceChangePct)}% over the window while commits held or rose (${firstHalf} then ${secondHalf} per half): the team kept building through the drawdown.`;
    } else if (priceChangePct >= 30 && (shippingDown || secondHalf === 0)) {
      marketRead = "price-without-shipping";
      marketDetail = `Price is up ${priceChangePct}% while commits fell (${firstHalf} then ${secondHalf} per half): the move is not backed by visible development.`;
    } else if (priceChangePct >= 0 && shippingUp) {
      marketRead = "aligned-up";
      marketDetail = `Price (${priceChangePct >= 0 ? "+" : ""}${priceChangePct}%) and commit cadence (${firstHalf} then ${secondHalf} per half) rose together.`;
    } else if (priceChangePct < 0 && shippingDown) {
      marketRead = "aligned-down";
      marketDetail = `Price (${priceChangePct}%) and commit cadence (${firstHalf} then ${secondHalf} per half) fell together: a project going quiet, not one being ignored.`;
    } else {
      marketRead = "mixed";
      marketDetail = `Price moved ${priceChangePct >= 0 ? "+" : ""}${priceChangePct}% with commits at ${firstHalf} then ${secondHalf} per half: no clean relationship.`;
    }
  } else if (total === 0 && price.length >= 4) {
    priceChangePct = round1(((price[price.length - 1].close - price[0].close) / price[0].close) * 100);
    marketRead = priceChangePct >= 30 ? "price-without-shipping" : "insufficient";
    marketDetail = priceChangePct >= 30 ? `Price is up ${priceChangePct}% over a window with no commits at all.` : "No commits in the window, so there is no development to set against the chart.";
  }

  // ---- claims ----------------------------------------------------------
  const claimsIn = (input.claims ?? []).filter((c) => SHIP_CLAIM.test(c.text) && Number.isFinite(parse(c.date)));
  const releases = input.repos.flatMap((r) => r.releases.map((rel) => ({ ...rel, repo: r.nameWithOwner })));
  const graded = claimsIn.map((claim) => {
    const at = parse(claim.date);
    const matchedCommits = commits.filter((c) => parse(c.date) >= at - 7 * DAY && parse(c.date) <= at + 2 * DAY).length;
    const rel = releases.find((r) => Math.abs(parse(r.publishedAt) - at) <= 7 * DAY);
    const grade: ClaimGrade = rel || matchedCommits >= 3 ? "supported" : matchedCommits > 0 ? "context" : "unsupported";
    return { ...claim, grade, matchedCommits, matchedRelease: rel?.tag };
  });
  const supported = graded.filter((g) => g.grade === "supported").length;
  const context = graded.filter((g) => g.grade === "context").length;
  const unsupported = graded.filter((g) => g.grade === "unsupported").length;
  const claimDetail = !graded.length
    ? "No shipping claims were found in the project's posts inside the window."
    : `${graded.length} shipping claim${graded.length === 1 ? "" : "s"} in the project's posts: ${supported} backed by a release or a burst of commits, ${context} near light activity, ${unsupported} with nothing in the public repositories within a week.`;

  // ---- peers -----------------------------------------------------------
  let peers: ShippingAssessment["peers"];
  if (input.peers && input.peers.repos.length) {
    const subject = {
      commitsInWindow: total,
      authorsInWindow: humans.length,
      stars: starTotal,
    };
    const med = {
      commitsInWindow: median(input.peers.repos.map((r) => r.commitsInWindow)) ?? 0,
      authorsInWindow: median(input.peers.repos.map((r) => r.authorsInWindow)) ?? 0,
      stars: median(input.peers.repos.map((r) => r.stars)) ?? 0,
    };
    const position = {
      commits: positionOf(subject.commitsInWindow, med.commitsInWindow),
      authors: positionOf(subject.authorsInWindow, med.authorsInWindow),
      stars: positionOf(subject.stars, med.stars),
    };
    const word = (p: PeerPosition) => (p === "below" ? "below" : p === "above" ? "above" : p === "within" ? "in line with" : "not comparable to");
    peers = {
      sector: input.peers.sector,
      label: input.peers.label,
      subject,
      median: med,
      position,
      rows: input.peers.repos,
      detail: `Against ${input.peers.label} (${input.peers.repos.map((r) => r.nameWithOwner).join(", ")}): ${subject.commitsInWindow} commits is ${word(position.commits)} the peer median of ${Math.round(med.commitsInWindow)}, ${subject.authorsInWindow} human author${subject.authorsInWindow === 1 ? "" : "s"} is ${word(position.authors)} the median of ${Math.round(med.authorsInWindow)}, and ${starTotal} stars is ${word(position.stars)} the median of ${Math.round(med.stars)}.`,
    };
  }

  // ---- live: is the code reaching the chain? ---------------------------
  const deploys = (input.deploys ?? []).filter((d) => Number.isFinite(parse(d.date)) && parse(d.date) >= windowStart);
  const publishes = (input.packages ?? []).flatMap((pk) => pk.versions.filter((v) => Number.isFinite(parse(v.date)) && parse(v.date) >= windowStart).map((v) => ({ ...v, name: pk.name })));
  const releaseTimes = input.repos.flatMap((r) => r.releases.map((rel) => parse(rel.publishedAt))).filter(Number.isFinite);
  const followsCode = (t: number) => releaseTimes.some((r) => t >= r && t - r <= 14 * DAY) || commits.filter((c) => parse(c.date) <= t && t - parse(c.date) <= 14 * DAY).length >= 3;
  const codeToChain = [...deploys.map((d) => parse(d.date)), ...publishes.map((p) => parse(p.date))].filter(followsCode).length;
  const verifiedDeploys = deploys.filter((d) => d.verified).length;
  let liveVerdict: LiveVerdict;
  if (!input.deploys && !input.packages) liveVerdict = "unknown";
  else if ((deploys.length || publishes.length) && codeToChain > 0) liveVerdict = "live";
  else if (deploys.length || publishes.length) liveVerdict = "deploys-without-code";
  else liveVerdict = total > 0 ? "committed-only" : "unknown";
  const liveDetail =
    liveVerdict === "unknown" ? "No deployer history or package registry was read, so whether the code reached production is not known."
      : liveVerdict === "live" ? `${deploys.length} on-chain deploy${deploys.length === 1 ? "" : "s"}${verifiedDeploys ? ` (${verifiedDeploys} verified)` : ""} and ${publishes.length} package publish${publishes.length === 1 ? "" : "es"} in the window; ${codeToChain} followed a release or a burst of commits within two weeks, so the public code is what is going live.`
        : liveVerdict === "deploys-without-code" ? `${deploys.length} deploy${deploys.length === 1 ? "" : "s"} and ${publishes.length} publish${publishes.length === 1 ? "" : "es"} in the window with no matching activity in the public repositories: the shipping happens somewhere this read cannot see.`
          : `${total} commits in the window and no on-chain deploy or package publish: work committed, nothing visibly shipped to users yet.`;

  // ---- adoption: is anyone outside the team using it? --------------------
  const prsSampled = input.repos.reduce((n, r) => n + (r.pullRequestsSampled ?? 0), 0);
  const externalPrs = input.repos.reduce((n, r) => n + (r.externalPullRequests ?? 0), 0);
  const issuesSampled = input.repos.reduce((n, r) => n + (r.issuesSampled ?? 0), 0);
  const externalIssues = input.repos.reduce((n, r) => n + (r.externalIssues ?? 0), 0);
  const activeForks = input.repos.reduce((n, r) => n + (r.activeForks ?? 0), 0);
  const packageDownloads = (input.packages ?? []).reduce<number | undefined>((n, pk) => (pk.downloadsLastMonth == null ? n : (n ?? 0) + pk.downloadsLastMonth), undefined);
  const externalPrSharePct = prsSampled ? pct(externalPrs, prsSampled) : undefined;
  const externalIssueSharePct = issuesSampled ? pct(externalIssues, issuesSampled) : undefined;
  let adoptionVerdict: AdoptionVerdict = "unknown";
  const adoptionRead = prsSampled > 0 || issuesSampled > 0 || input.repos.some((r) => r.activeForks != null) || packageDownloads != null;
  if (adoptionRead) {
    const strong = externalPrs >= 3 || (packageDownloads ?? 0) >= 1000 || activeForks >= 5;
    const some = externalPrs >= 1 || externalIssues >= 3 || (packageDownloads ?? 0) >= 100 || activeForks >= 1;
    adoptionVerdict = strong ? "used" : some ? "noticed" : "unused";
  }
  const adoptionDetail = !adoptionRead
    ? "No pull-request, issue, fork or download data was read."
    : `${externalPrs} of ${prsSampled} sampled pull requests and ${externalIssues} of ${issuesSampled} sampled issues came from outside the team; ${activeForks} fork${activeForks === 1 ? "" : "s"} pushed to in the window${packageDownloads != null ? `; ${packageDownloads.toLocaleString("en-US")} package downloads last month` : ""}. ${adoptionVerdict === "used" ? "Outsiders are contributing, which is the hardest attention signal to fake." : adoptionVerdict === "noticed" ? "Some outside attention, not yet outside contribution." : "Nobody outside the team is contributing, filing or forking."}`;

  // ---- health: the questions a fund's diligence checklist asks -----------
  const flagshipForHealth = flagship ?? input.repos[0];
  const ci = flagshipForHealth?.ciState ?? "unknown";
  const licenseId = flagshipForHealth?.license;
  const license = flagshipForHealth ? licenseClass(licenseId) : "unknown";
  const auditInTree = input.repos.some((r) => r.hasAudit);
  const lockfileAgeDays = flagshipForHealth?.lockfileUpdatedAt && Number.isFinite(parse(flagshipForHealth.lockfileUpdatedAt)) ? Math.max(0, Math.round((nowMs - parse(flagshipForHealth.lockfileUpdatedAt)) / DAY)) : undefined;
  let healthVerdict: HealthVerdict = "unknown";
  if (input.repos.length) {
    let good = 0;
    let bad = 0;
    if (ci === "success") good++; else if (ci === "failure") bad++;
    if (license === "permissive") good++; else if (license === "none") bad++;
    if (auditInTree) good++;
    if (lockfileAgeDays != null) { if (lockfileAgeDays <= 90) good++; else if (lockfileAgeDays > 365) bad++; }
    healthVerdict = bad === 0 && good >= 2 ? "sound" : bad >= 2 ? "poor" : "mixed";
  }
  const healthDetail = !input.repos.length ? "No repository to assess." : [
    ci === "success" ? "Latest default-branch checks pass" : ci === "failure" ? "Latest default-branch checks FAIL" : ci === "pending" ? "Latest checks still running" : "No check status exposed",
    license === "permissive" ? `${licenseId} licence (permissive)` : license === "copyleft" ? `${licenseId} licence (copyleft; derivative work must be shared)` : license === "source-available" ? `${licenseId} (source-available, not open source)` : license === "none" ? "no licence file, so the code cannot legally be reused" : `${licenseId ?? "unrecognised"} licence`,
    auditInTree ? "an audit report is in the tree" : "no audit report in the tree",
    lockfileAgeDays != null ? `dependencies last locked ${lockfileAgeDays} days ago` : "no lockfile read",
  ].join("; ") + ".";

  // ---- trend: the whole life, not the window ------------------------------
  const weeklyMap = new Map<string, number>();
  let trendSource: ShippingAssessment["trend"]["source"] = "none";
  for (const r of input.repos) for (const w of r.weeklyCommits ?? []) { weeklyMap.set(w.weekStart, (weeklyMap.get(w.weekStart) ?? 0) + w.commits); trendSource = "provider-weekly"; }
  if (trendSource === "none" && commits.length) {
    for (const w of weeks) weeklyMap.set(w.weekStart, w.commits);
    trendSource = "window-commits";
  }
  const trendKeys = [...weeklyMap.keys()].sort().slice(-52);
  const weekOf = (t: number) => trendKeys.find((k, i) => t >= parse(k) && (i === trendKeys.length - 1 || t < parse(trendKeys[i + 1])));
  const priceByWeek = new Map<string, number[]>();
  for (const pt of input.priceSeries ?? []) { const k = weekOf(parse(pt.date)); if (k) { priceByWeek.set(k, [...(priceByWeek.get(k) ?? []), pt.close]); } }
  const releasesByWeek = new Map<string, number>();
  for (const t of releaseTimes) { const k = weekOf(t); if (k) releasesByWeek.set(k, (releasesByWeek.get(k) ?? 0) + 1); }
  const deploysByWeek = new Map<string, number>();
  for (const d of input.deploys ?? []) { const k = weekOf(parse(d.date)); if (k) deploysByWeek.set(k, (deploysByWeek.get(k) ?? 0) + 1); }
  const trendWeeks = trendKeys.map((k) => ({ weekStart: k, commits: weeklyMap.get(k) ?? 0, price: median(priceByWeek.get(k) ?? []), releases: releasesByWeek.get(k) ?? 0, deploys: deploysByWeek.get(k) ?? 0 }));
  const lifeCommits = trendWeeks.reduce((n, w) => n + w.commits, 0);
  const activeWeeksLife = trendWeeks.filter((w) => w.commits > 0).length;
  const trendDetail = trendSource === "none" ? "No weekly history was read." : `${lifeCommits} commits across ${activeWeeksLife} of the last ${trendWeeks.length} weeks${trendSource === "window-commits" ? " (window only; the provider's yearly statistics were not available)" : ""}.`;

  // ---- roadmap: dated promises against what happened -----------------------
  const roadmapClaims = extractRoadmapClaims(input.docsText).map((c) => {
    const due = parse(c.due);
    const from = due - 30 * DAY;
    const to = due + 30 * DAY;
    const rel = releaseTimes.filter((t) => t >= from && t <= to).length;
    const dep = deploys.filter((d) => parse(d.date) >= from && parse(d.date) <= to).length;
    const com = commits.filter((c2) => parse(c2.date) >= from && parse(c2.date) <= to).length;
    const weekly = trendWeeks.filter((w) => parse(w.weekStart) >= from - 7 * DAY && parse(w.weekStart) <= to).reduce((n, w) => n + w.commits, 0);
    let grade: RoadmapGrade;
    let evidence: string;
    if (due > nowMs) { grade = "pending"; evidence = `Due ${c.due.slice(0, 10)}; not yet reached.`; }
    else if (rel || dep) { grade = "met"; evidence = `${rel} release${rel === 1 ? "" : "s"} and ${dep} deploy${dep === 1 ? "" : "s"} within a month of ${c.due.slice(0, 10)}.`; }
    else if (com >= 5 || weekly >= 10) { grade = "met"; evidence = `${Math.max(com, weekly)} commits within a month of ${c.due.slice(0, 10)}; no tagged release or deploy to name.`; }
    else if (due < windowStart - 30 * DAY && trendSource !== "provider-weekly") { grade = "unclear"; evidence = `Due ${c.due.slice(0, 10)}, before this read's history begins.`; }
    else { grade = "missed"; evidence = `Nothing in the repositories within a month of ${c.due.slice(0, 10)}.`; }
    return { text: c.text, due: c.due, grade, evidence };
  });
  const roadmapMet = roadmapClaims.filter((c) => c.grade === "met").length;
  const roadmapMissed = roadmapClaims.filter((c) => c.grade === "missed").length;
  const roadmapPending = roadmapClaims.filter((c) => c.grade === "pending").length;
  const roadmapDetail = !input.docsText ? "No roadmap or docs text was read." : !roadmapClaims.length ? "The docs carry no dated promises to check." : `${roadmapClaims.length} dated promise${roadmapClaims.length === 1 ? "" : "s"} in the docs: ${roadmapMet} met, ${roadmapMissed} missed, ${roadmapPending} still ahead.`;

  // ---- cohort: like against like ------------------------------------------
  const cohort = input.cohort && input.cohort.size > 0 ? {
    ...input.cohort,
    detail: `Among ${input.cohort.size} ${input.cohort.label}: ${total} commits sits ${input.cohort.percentileCommits != null ? `at the ${Math.round(input.cohort.percentileCommits)}th percentile` : `against a median of ${Math.round(input.cohort.medianCommits)}`}, ${humans.length} human author${humans.length === 1 ? "" : "s"} ${input.cohort.percentileAuthors != null ? `at the ${Math.round(input.cohort.percentileAuthors)}th` : `against a median of ${Math.round(input.cohort.medianAuthors)}`}${input.cohort.shippingSharePct != null ? `; ${Math.round(input.cohort.shippingSharePct)}% of the cohort is still shipping` : ""}.`,
  } : undefined;

  // ---- coverage: what this read actually saw --------------------------------
  const commitsCounted = input.repos.reduce((n, r) => n + (r.commitsInWindow ?? 0), 0);
  const historyRepos = new Set(commits.map((c) => c.repo)).size;
  const coverageNotes = [...(input.readNotes ?? [])];
  if (input.reposTotal != null && input.reposTotal > input.repos.length) coverageNotes.push(`${input.repos.length} of ${input.reposTotal} repositories reviewed (most recently pushed first).`);
  if (commitsCounted > total) coverageNotes.push(`${total} of ${commitsCounted} window commits read in detail; cadence and authorship come from the read set, the count from the provider.`);
  if (!input.starHistory?.length && starTotal > 0) coverageNotes.push("No star history was read; the star read is proportional.");
  if (!input.identities) coverageNotes.push("Committer accounts were not resolved to X handles or employers.");
  if (!input.deploys && !input.packages) coverageNotes.push("No on-chain deployer history or package registry was joined.");
  if (!input.priceSeries?.length) coverageNotes.push("No price series was joined; the chart-versus-commits read is empty.");
  if (!input.claims?.length) coverageNotes.push("No project posts were joined; shipping claims were not graded.");
  if (!input.docsText) coverageNotes.push("No roadmap or docs text was joined.");

  // ---- grade + headline --------------------------------------------------
  let grade: ShippingGrade;
  if (status === "unknown") grade = "unknown";
  else if (status === "dormant") grade = "stalled";
  else if (total < 10 || (substance.medianLinesChanged != null && substance.medianLinesChanged < 10 && releasesInWindow === 0)) grade = "thin";
  else if (concentration === "team" || concentration === "lead-plus") grade = "shipping-team";
  else grade = "shipping-solo";

  const who =
    concentration === "team" ? `${humans.length} people`
      : concentration === "lead-plus" ? `${humans.length} people with one carrying ${top1SharePct}%`
        : concentration === "single-author" ? "one person"
          : concentration === "unattributed" ? "an unattributed mirror account"
            : "nobody visible";
  const headline =
    grade === "unknown" ? `No public code activity could be read for ${input.target}.`
      : grade === "stalled" ? `Development has stalled: last commit ${lastCommitDaysAgo} days ago.`
        : grade === "thin" ? `Thin development: ${total} commit${total === 1 ? "" : "s"} in ${input.windowDays} days from ${who}.`
          : grade === "shipping-team" ? `Shipping as a team: ${total} commits in ${input.windowDays} days from ${who}.`
            : `Shipping, but it is ${who}: ${total} commits in ${input.windowDays} days.`;

  // ---- delta against the previous saved report -----------------------------
  let delta: ShippingAssessment["delta"];
  if (input.previous) {
    const prev = input.previous;
    const changePct = prev.totalCommits > 0 ? round1(((total - prev.totalCommits) / prev.totalCommits) * 100) : undefined;
    const stalled = (prev.grade === "shipping-team" || prev.grade === "shipping-solo") && (grade === "stalled" || grade === "thin" || status === "quiet" || status === "dormant");
    const parts: string[] = [];
    if (prev.grade !== grade) parts.push(`grade ${shippingGradeLabel(prev.grade).toLowerCase()} → ${shippingGradeLabel(grade).toLowerCase()}`);
    if (changePct != null) parts.push(`commits ${prev.totalCommits} → ${total} (${changePct >= 0 ? "+" : ""}${changePct}%)`);
    else if (prev.totalCommits !== total) parts.push(`commits ${prev.totalCommits} → ${total}`);
    if (prev.distinctHuman !== humans.length) parts.push(`human committers ${prev.distinctHuman} → ${humans.length}`);
    if (prev.cadenceStatus !== status) parts.push(`cadence ${prev.cadenceStatus} → ${status}`);
    delta = {
      capturedAt: prev.capturedAt,
      grade: { from: prev.grade, to: grade },
      commits: { from: prev.totalCommits, to: total, changePct },
      humans: { from: prev.distinctHuman, to: humans.length },
      cadence: { from: prev.cadenceStatus, to: status },
      stalled,
      detail: parts.length ? `Since the report of ${prev.capturedAt.slice(0, 10)}: ${parts.join("; ")}.${stalled ? " The project was shipping then and is not now." : ""}` : `Unchanged since the report of ${prev.capturedAt.slice(0, 10)}.`,
    };
  }

  evidence.push(`${total} commits across ${activeWeeks} of ${weekCount} weeks; last activity ${lastCommitDaysAgo != null ? `${lastCommitDaysAgo} day${lastCommitDaysAgo === 1 ? "" : "s"} ago` : "unknown"}${longestGapDays != null ? `; longest gap ${longestGapDays} days` : ""}.`);
  if (rows.length) evidence.push(`${humans.length} human committer${humans.length === 1 ? "" : "s"}${botCommits ? `, ${pct(botCommits, total)}% bot commits` : ""}${mirrorCommits ? `, ${mirroredSharePct}% mirrored` : ""}; top author holds ${top1SharePct}% of attributable commits.`);
  if (substance.medianLinesChanged != null) evidence.push(`Median commit changes ${substance.medianLinesChanged} lines${substance.medianFiles != null ? ` across ${substance.medianFiles} files` : ""}; ${substance.trivialSharePct}% are trivial (${TRIVIAL_LINES} lines or fewer).`);
  if (releasesInWindow) evidence.push(`${releasesInWindow} tagged release${releasesInWindow === 1 ? "" : "s"} in the window.`);
  if (forks.length) evidence.push(`${forks.length} of ${input.repos.length} repositories are forks: ${forks.slice(0, 3).map((f) => `${f.repo.split("/")[1]} ← ${f.parent}`).join("; ")}.`);
  if (bulkImports.length) evidence.push(`${bulkImports.length} repositor${bulkImports.length === 1 ? "y opens" : "ies open"} with a bulk code drop rather than incremental history: ${bulkImports.join(", ")}.`);
  evidence.push(...authorshipEvidence);
  if (starVerdict === "suspect") evidence.push(`Star authenticity is suspect: ${starEvidence[0]}`);
  if (departed) evidence.push(churnDetail);
  if (liveVerdict === "live" || liveVerdict === "deploys-without-code") evidence.push(liveDetail);
  if (adoptionVerdict === "used") evidence.push(adoptionDetail);
  if (roadmapMissed) evidence.push(`${roadmapMissed} dated roadmap promise${roadmapMissed === 1 ? "" : "s"} passed with nothing in the repositories to show for ${roadmapMissed === 1 ? "it" : "them"}.`);
  if (ci === "failure") evidence.push("The latest default-branch checks fail.");
  if (delta?.stalled) evidence.push(delta.detail);
  const fresh = humans.filter((h) => h.freshAccount);
  if (fresh.length) caveats.push(`${fresh.length} committer account${fresh.length === 1 ? " was" : "s were"} created inside the window; new accounts are not new people, but they carry no history to check.`);
  if (authorship === "mirrored") caveats.push("A mirrored repository can hide a real team or a single contractor equally well; ask for the private repository's contributor list.");
  if (input.repos.length && input.repos.every((r) => parse(r.createdAt) >= windowStart)) caveats.push("Every reviewed repository was created inside the window, so cadence cannot be distinguished from a launch push.");
  if (starVerdict === "insufficient") caveats.push(starEvidence[0]);

  return {
    target: input.target,
    windowDays: input.windowDays,
    grade,
    headline,
    evidence,
    caveats,
    cadence: { status, totalCommits: total, activeWeeks, weeks, lastCommitDaysAgo, longestGapDays, medianGapDays, releasesInWindow },
    committers: {
      concentration,
      distinctHuman: humans.length,
      distinctAll: rows.length,
      top1SharePct,
      botSharePct: total ? pct(botCommits, total) : 0,
      mirrorSharePct: mirroredSharePct,
      hhi,
      roster: rows.slice(0, 25),
      churn: { leadLogin: priorLead?.login, leadName: priorLead?.name, leadPriorSharePct, leadLast30: priorLead?.last30 ?? 0, departed, goneQuiet, detail: churnDetail },
    },
    substance,
    authorship: { verdict: authorship, aiTrailerCount, genericMessageSharePct: total ? pct(generic, total) : undefined, bulkDropCount: bulkDrops.length, mirroredSharePct, evidence: authorshipEvidence },
    origin: { verdict: origin, forks, forkSharePct, templates, bulkImports },
    stars: { verdict: starVerdict, total: starTotal, sampled: sample.length, repo: input.starHistoryRepo ?? input.stargazerRepo, lowActivitySharePct, burstSharePct, burstWindowStart, historyStars, launchBurst, evidence: starEvidence },
    hygiene: { verdict: hygieneVerdict, ...hyg },
    market: { read: marketRead, priceChangePct, commitTrendPct, detail: marketDetail },
    claims: { graded, supported, context, unsupported, detail: claimDetail },
    ...(peers ? { peers } : {}),
    ...(cohort ? { cohort } : {}),
    live: { verdict: liveVerdict, deploysInWindow: deploys.length, verifiedDeploys, publishesInWindow: publishes.length, codeToChain, detail: liveDetail },
    adoption: { verdict: adoptionVerdict, externalPrSharePct, externalIssueSharePct, externalPrs, externalIssues, activeForks, packageDownloadsLastMonth: packageDownloads, packages: (input.packages ?? []).map((pk) => `${pk.registry}:${pk.name}`), detail: adoptionDetail },
    health: { verdict: healthVerdict, ci, license, licenseId, auditInTree, lockfileAgeDays, detail: healthDetail },
    trend: { weeks: trendWeeks, lifeCommits, activeWeeksLife, source: trendSource, detail: trendDetail },
    roadmap: { claims: roadmapClaims, met: roadmapMet, missed: roadmapMissed, pending: roadmapPending, detail: roadmapDetail },
    ...(delta ? { delta } : {}),
    coverage: { reposTotal: input.reposTotal, reposRead: input.repos.length, historyRepos, commitsCounted, commitsRead: total, starHistoryDays: input.starHistory?.length ?? 0, weeklyStatsRead: trendSource === "provider-weekly", identitiesRead: Object.keys(identities).length, windowDays: input.windowDays, notes: coverageNotes },
  };
}

/** The compact form frozen into a saved report and compared on the next scan. */
export function summarizeShipping(a: ShippingAssessment, capturedAt: string): ShippingSummary {
  return {
    version: 1,
    target: a.target,
    capturedAt,
    windowDays: a.windowDays,
    grade: a.grade,
    headline: a.headline,
    cadenceStatus: a.cadence.status,
    totalCommits: a.cadence.totalCommits,
    activeWeeks: a.cadence.activeWeeks,
    distinctHuman: a.committers.distinctHuman,
    concentration: a.committers.concentration,
    authorship: a.authorship.verdict,
    origin: a.origin.verdict,
    stars: a.stars.verdict,
    market: a.market.read,
    claimsSupported: a.claims.supported,
    claimsUnsupported: a.claims.unsupported,
    live: a.live.verdict,
    adoption: a.adoption.verdict,
    health: a.health.verdict,
    leadDeparted: a.committers.churn.departed,
    reposRead: a.coverage.reposRead,
    commitsRead: a.coverage.commitsRead,
    releasesInWindow: a.cadence.releasesInWindow,
  };
}

/** Plain-language label for a grade, for chips and headlines. */
export function shippingGradeLabel(grade: ShippingGrade): string {
  switch (grade) {
    case "shipping-team": return "Shipping · team";
    case "shipping-solo": return "Shipping · solo";
    case "thin": return "Thin";
    case "stalled": return "Stalled";
    default: return "Unread";
  }
}

export function cadenceStatusLabel(status: CadenceStatus): string {
  switch (status) {
    case "shipping": return "Shipping (≤7d)";
    case "active": return "Active (≤30d)";
    case "quiet": return "Quiet (≤60d)";
    case "dormant": return "Dormant (60d+)";
    default: return "Unknown";
  }
}
