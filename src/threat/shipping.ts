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
}

export interface ShippingStargazer {
  starredAt: string;
  login: string;
  createdAt?: string;
  followers?: number;
  repos?: number;
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
  priceSeries?: ShippingPricePoint[];
  claims?: ShippingClaim[];
  peers?: ShippingPeers;
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
}

const DAY = 864e5;

const BOT_NAME = /\[bot\]$|^(github-actions|dependabot|renovate|snyk-bot|greenkeeper|mergify|semantic-release|codecov|imgbot)/i;
const NOREPLY = /noreply\.github\.com$|^noreply@|^no-reply@/i;
const MIRROR_HEADLINE = /^(sync(ed|ing)?|mirror(ed)?|export(ed)?|publish(ed)?|import(ed)?)\b.*\b(from|to|of)\b|^sync from\b|^automated sync\b/i;
const GENERIC_HEADLINE = /^(update|updates|updated|fix|fixes|fixed|wip|changes|change|misc|stuff|test|tests|tmp|temp|asdf|\.+|init|initial commit|first commit|commit|save|cleanup|minor)\.?$/i;
const DOCS_HEADLINE = /\b(docs?|readme|typo|changelog|license|comment(s)?)\b/i;
const AI_TRAILER = /co-authored-by:[^\n]*\b(claude|copilot|chatgpt|openai|cursor|codex|devin|gemini|aider|sweep|windsurf)\b|generated with \[?claude|🤖 generated with|made with (cursor|copilot)/i;
const SHIP_CLAIM = /\b(launch(ed|ing|es)?|releas(ed|e|es|ing)|shipp(ed|ing)|v\d+(\.\d+)+|mainnet|is live|now live|went live|deploy(ed|ing)|beta|alpha|new version|update is (out|live)|rolled out|rolling out)\b/i;

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
      };
      roster.set(key, row);
    }
    row.commits++;
    if (!row.login && c.authorLogin) row.login = c.authorLogin;
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
  const sample = input.stargazers ?? [];
  const starTotal = input.repos.reduce((n, r) => n + r.stars, 0);
  const starEvidence: string[] = [];
  let starVerdict: StarVerdict;
  let lowActivitySharePct: number | undefined;
  let burstSharePct: number | undefined;
  let burstWindowStart: string | undefined;
  if (starTotal === 0) {
    starVerdict = "none";
    starEvidence.push("No stars on the reviewed repositories, so there is nothing to authenticate.");
  } else if (sample.length < 20) {
    // GitHub no longer serves stargazer lists to ordinary tokens (every
    // stargazers endpoint returned 404 / an empty connection on 2026-09-15), so
    // the account-level read usually has no sample. Fall back to proportion:
    // bought stars buy nothing else, so a repository with many stars and almost
    // no forks, watchers or commits is disproportionate in a way organic
    // attention is not.
    const flagship = [...input.repos].sort((a, b) => b.stars - a.stars)[0];
    if (flagship && flagship.stars >= 100) {
      const forkRatio = flagship.forks / flagship.stars;
      const watchRatio = flagship.watchers != null ? flagship.watchers / flagship.stars : undefined;
      const commitsOnFlagship = commits.filter((c) => c.repo === flagship.nameWithOwner).length;
      const thinWork = commitsOnFlagship < 5 && (flagship.commitsInWindow ?? commitsOnFlagship) < 5;
      const disproportionate = forkRatio < 0.02 && (watchRatio == null || watchRatio < 0.01) && (thinWork || flagship.stars >= 1000);
      starVerdict = disproportionate ? "suspect" : "insufficient";
      starEvidence.push(`No stargazer sample was available, so the read is proportional: ${flagship.nameWithOwner} has ${flagship.stars} stars against ${flagship.forks} forks${flagship.watchers != null ? ` and ${flagship.watchers} watchers` : ""}${thinWork ? " with under five commits in the window" : ""}.`);
      if (disproportionate) starEvidence.push("Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone.");
      else starEvidence.push("The proportions are ordinary; nothing here separates bought stars from earned ones without the stargazer list.");
    } else {
      starVerdict = "insufficient";
      starEvidence.push(`Only ${sample.length} stargazer${sample.length === 1 ? "" : "s"} could be sampled; a star-authenticity read needs at least 20.`);
    }
  } else {
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
    const flagship = input.repos.find((r) => r.nameWithOwner === input.stargazerRepo);
    const repoAgeAtBurstDays = flagship && Number.isFinite(bestStart) ? (bestStart - parse(flagship.createdAt)) / DAY : undefined;
    const launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    const suspect = lowActivitySharePct >= 40 || (burstSharePct >= 50 && !launchBurst);
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${lowActivitySharePct}% of ${sample.length} sampled stargazers are low-activity accounts (created within 30 days of starring, or no repos and no followers).`);
    starEvidence.push(`${burstSharePct}% of sampled stars landed inside one 72-hour window${launchBurst ? " during the repository's first month, which is a normal launch pattern" : ""}.`);
    if (suspect) starEvidence.push("This is the signature StarScout (Six Million Suspected Fake Stars, ICSE 2026) associates with purchased stars.");
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

  evidence.push(`${total} commits across ${activeWeeks} of ${weekCount} weeks; last activity ${lastCommitDaysAgo != null ? `${lastCommitDaysAgo} day${lastCommitDaysAgo === 1 ? "" : "s"} ago` : "unknown"}${longestGapDays != null ? `; longest gap ${longestGapDays} days` : ""}.`);
  if (rows.length) evidence.push(`${humans.length} human committer${humans.length === 1 ? "" : "s"}${botCommits ? `, ${pct(botCommits, total)}% bot commits` : ""}${mirrorCommits ? `, ${mirroredSharePct}% mirrored` : ""}; top author holds ${top1SharePct}% of attributable commits.`);
  if (substance.medianLinesChanged != null) evidence.push(`Median commit changes ${substance.medianLinesChanged} lines${substance.medianFiles != null ? ` across ${substance.medianFiles} files` : ""}; ${substance.trivialSharePct}% are trivial (${TRIVIAL_LINES} lines or fewer).`);
  if (releasesInWindow) evidence.push(`${releasesInWindow} tagged release${releasesInWindow === 1 ? "" : "s"} in the window.`);
  if (forks.length) evidence.push(`${forks.length} of ${input.repos.length} repositories are forks: ${forks.slice(0, 3).map((f) => `${f.repo.split("/")[1]} ← ${f.parent}`).join("; ")}.`);
  if (bulkImports.length) evidence.push(`${bulkImports.length} repositor${bulkImports.length === 1 ? "y opens" : "ies open"} with a bulk code drop rather than incremental history: ${bulkImports.join(", ")}.`);
  evidence.push(...authorshipEvidence);
  if (starVerdict === "suspect") evidence.push(`Star authenticity is suspect: ${starEvidence[0]}`);
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
    },
    substance,
    authorship: { verdict: authorship, aiTrailerCount, genericMessageSharePct: total ? pct(generic, total) : undefined, bulkDropCount: bulkDrops.length, mirroredSharePct, evidence: authorshipEvidence },
    origin: { verdict: origin, forks, forkSharePct, templates, bulkImports },
    stars: { verdict: starVerdict, total: starTotal, sampled: sample.length, repo: input.stargazerRepo, lowActivitySharePct, burstSharePct, burstWindowStart, evidence: starEvidence },
    hygiene: { verdict: hygieneVerdict, ...hyg },
    market: { read: marketRead, priceChangePct, commitTrendPct, detail: marketDetail },
    claims: { graded, supported, context, unsupported, detail: claimDetail },
    ...(peers ? { peers } : {}),
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
