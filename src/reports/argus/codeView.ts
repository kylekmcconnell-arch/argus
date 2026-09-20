/* The Code chapter's view model.

   Everything here reads the frozen development summary that the scan wrote
   into the saved report (ShippingSummary) plus the account-level GitHub
   assessment. Nothing is fetched, recomputed or inferred: a verdict the scan
   did not record stays "not established", and a count the read never took
   stays absent rather than zero. The committer roster is joined to the
   published people roster by GitHub login and X handle so the chapter can say
   whether the people writing the code are the people named as the team. */

import type { GithubAssessment } from "../../data/evidence";
import type { ShippingSummary, ShippingSummaryCommitter, ShippingSummaryWeek } from "../../threat/shipping";
import type { Tone } from "./model";
import type { PersonCardView } from "./view";

export interface CodeAreaView {
  id: string;
  /** The diligence question this area answers. */
  question: string;
  badge: { label: string; tone: Tone };
  answer: string;
  /** What the saved read measured, in plain numbers. */
  detail?: string | null;
  /** What would settle the question if the read could not. */
  next?: string | null;
}

export interface CodeCommitterView {
  key: string;
  name: string;
  login?: string | null;
  githubUrl?: string | null;
  commits: number;
  sharePct: number;
  kind: "human" | "bot" | "mirror";
  freshAccount: boolean;
  accountCreatedAt?: string | null;
  last30: number;
  prior60: number;
  xHandle?: string | null;
  xUrl?: string | null;
  company?: string | null;
  orgs?: string[];
  /** Active before, silent in the last 30 days. */
  quiet: boolean;
  /** Whether this committer appears in the report's published roster. */
  match: { label: string; tone: Tone; detail: string; personKey?: string | null };
}

export interface CodeAccountView {
  login: string;
  url: string;
  summary: string;
  confidence: "gold" | "weak";
  accountAgeYears?: number | null;
  publicRepos: number;
  originalCount: number;
  forkCount: number;
  totalStarsOnOriginals: number;
  languages: string[];
  lastActivity?: string | null;
  repoSampleState?: "complete" | "sample" | "unavailable" | null;
  claimChecks: GithubAssessment["claimChecks"];
  repos: Array<{ name: string; url: string; stars: number; language?: string | null; lastPush?: string | null; fork: boolean }>;
}

export interface CodeView {
  /** The organisation or user the development read covered. */
  target?: string | null;
  targetUrl?: string | null;
  /** Present when the scan froze a development read into this report. */
  read: ShippingSummary | null;
  /** Why no development read is shown, when there is none. */
  absentReason?: string | null;
  headline?: string | null;
  grade?: { label: string; tone: Tone } | null;
  capturedAt?: string | null;
  windowDays?: number | null;
  metrics: Array<{ label: string; value: string }>;
  areas: CodeAreaView[];
  committers: CodeCommitterView[];
  committerNote?: string | null;
  goneQuiet: string[];
  churnDetail?: string | null;
  coverage: string[];
  coverageLine?: string | null;
  /** Weekly activity for the chart, oldest first; empty when the read took none. */
  weeks: ShippingSummaryWeek[];
  trendSource?: string | null;
  account: CodeAccountView | null;
  /** True when the subject publishes no code the report could read. */
  noCodeFootprint: boolean;
}

const GRADE_LABEL: Record<ShippingSummary["grade"], string> = {
  "shipping-team": "Shipping, as a team",
  "shipping-solo": "Shipping, one builder",
  thin: "Thin development",
  stalled: "Development stalled",
  unknown: "Development not established",
};

const GRADE_TONE: Record<ShippingSummary["grade"], Tone> = {
  "shipping-team": "green",
  "shipping-solo": "amber",
  thin: "amber",
  stalled: "red",
  unknown: "neutral",
};

function pct(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value)}%`;
}

function count(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US");
}

function join(parts: Array<string | null | undefined>, separator = " "): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
}

function normalizeHandle(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0].toLowerCase();
}

function normalizeLogin(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").split(/[/?#]/)[0].toLowerCase();
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Match one committer against the published roster: same GitHub login, same X handle, or the same full name. */
function matchCommitter(committer: ShippingSummaryCommitter, people: PersonCardView[]): CodeCommitterView["match"] {
  if (committer.kind === "bot") {
    return { label: "Automation", tone: "neutral", detail: "An automated account, not a person. Its commits are excluded from the human count." };
  }
  if (committer.kind === "mirror") {
    return { label: "Mirror account", tone: "amber", detail: "Commits arrive as an export from a private repository, so the authorship of the original work is not visible." };
  }
  if (people.length === 0) {
    return {
      label: "No roster to match",
      tone: "neutral",
      detail: "This report publishes no team roster, so no committer can be matched to a named person. That is a gap in the report, not a finding about the committer.",
    };
  }
  const login = normalizeLogin(committer.login);
  const handle = normalizeHandle(committer.twitter);
  const name = normalizeName(committer.name);
  for (const person of people) {
    const profiles = (person.developerProfiles ?? []).map((profile) => normalizeLogin(profile.url.replace(/^https?:\/\/(www\.)?github\.com\//i, "")));
    const personHandle = normalizeHandle(person.contacts.x?.label ?? person.contacts.x?.url);
    if (login && profiles.includes(login)) {
      return { label: "Named in this report", tone: "green", detail: `The saved roster records this GitHub account for ${person.name} (${person.role}).`, personKey: person.key };
    }
    if (handle && personHandle && handle === personHandle) {
      return { label: "Named in this report", tone: "green", detail: `The committer's X account matches the one recorded for ${person.name} (${person.role}).`, personKey: person.key };
    }
    if (name && normalizeName(person.name) === name) {
      return { label: "Same name as a named person", tone: "amber", detail: `The commit name matches ${person.name} (${person.role}). A name match is not identity verification.`, personKey: person.key };
    }
  }
  if (committer.freshAccount) {
    return { label: "Not in this report", tone: "amber", detail: "No published team member matches this account, and the account was created inside the read window." };
  }
  return { label: "Not in this report", tone: "amber", detail: "No published team member matches this account. It may be a contractor, a second account or someone the project does not name." };
}

function hygieneArea(read: ShippingSummary): CodeAreaView {
  const label = read.hygiene && read.hygiene !== "unknown" ? read.hygiene : "not established";
  const tone: Tone = read.health === "sound" ? "green" : read.health === "mixed" ? "amber" : read.health === "poor" ? "red" : "neutral";
  const bits = [
    read.ci && read.ci !== "unknown" ? `Continuous integration on the default branch: ${read.ci}.` : null,
    read.auditInTree === true ? "The tree carries an audit directory." : null,
    read.lockfileAgeDays != null ? `Dependencies were last pinned ${count(read.lockfileAgeDays)} days before the read.` : null,
  ];
  return {
    id: "health",
    question: "Is the code kept properly?",
    badge: { label: `Repository health: ${read.health === "unknown" ? "not established" : read.health}`, tone },
    answer: `Maintenance of the repositories read: ${label}. Health combines the branch check state, the licence, an audit directory and how recently dependencies were pinned.`,
    detail: bits.length ? join(bits) : null,
    next: read.health === "unknown" ? "A repository read with the GitHub lane configured settles this." : null,
  };
}

function licenseArea(read: ShippingSummary, account: CodeAccountView | null): CodeAreaView {
  const license = read.license ?? "unknown";
  const open = license === "permissive" || license === "copyleft";
  const tone: Tone = open ? "green" : license === "source-available" ? "amber" : license === "none" ? "amber" : "neutral";
  const answer = license === "unknown"
    ? "The saved read did not record a licence, so the source terms are not established."
    : license === "none"
      ? "The repositories carry no licence. Code that is published without a licence is readable but not legally reusable, which is closed source in effect."
      : license === "source-available"
        ? `The licence is source-available (${read.licenseId ?? "recorded without an identifier"}). The code can be read, but use is restricted.`
        : `The licence is ${license}${read.licenseId ? ` (${read.licenseId})` : ""}, so the published code is open source.`;
  return {
    id: "open-source",
    question: "Open source or closed source?",
    badge: { label: license === "unknown" ? "Licence not established" : open ? "Open source" : "Not open source", tone },
    answer,
    detail: account ? `${count(account.publicRepos)} public repositories are attributed to the account, ${count(account.originalCount)} of them original.` : null,
    next: license === "unknown" ? "The licence file of the flagship repository settles this." : null,
  };
}

function cadenceArea(read: ShippingSummary): CodeAreaView {
  const tone: Tone = read.cadenceStatus === "shipping" ? "green"
    : read.cadenceStatus === "active" ? "green"
      : read.cadenceStatus === "quiet" ? "amber"
        : read.cadenceStatus === "dormant" ? "red" : "neutral";
  return {
    id: "cadence",
    question: "How often do they ship?",
    badge: { label: `Cadence: ${read.cadenceStatus === "unknown" ? "not established" : read.cadenceStatus}`, tone },
    answer: `${count(read.totalCommits)} commits landed in the ${count(read.windowDays)}-day window, across ${count(read.activeWeeks)} active weeks, with ${count(read.releasesInWindow)} published releases.`,
    detail: read.market !== "insufficient" ? `Development against price over the same window: ${read.market.replace(/-/g, " ")}.` : null,
  };
}

function substanceArea(read: ShippingSummary): CodeAreaView {
  const bits = [
    read.medianLinesChanged != null ? `Median commit: ${count(read.medianLinesChanged)} lines` : null,
    read.medianFiles != null ? `${count(read.medianFiles)} files` : null,
    read.trivialSharePct != null ? `${pct(read.trivialSharePct)} of commits change five lines or fewer` : null,
    read.bulkDropCount ? `${count(read.bulkDropCount)} bulk drops of 1,500 lines or more` : null,
  ];
  const thin = read.trivialSharePct != null && read.trivialSharePct >= 60;
  return {
    id: "substance",
    question: "Is the work substantial, or activity for its own sake?",
    badge: { label: thin ? "Mostly small commits" : "Measured", tone: thin ? "amber" : "neutral" },
    answer: bits.length
      ? `${join(bits, ". ")}.`
      : "The saved read did not measure commit size, so substance is not established.",
    detail: "Commit counts alone can be inflated. Size, file spread and bulk imports are what separate real work from noise.",
  };
}

function authorshipArea(read: ShippingSummary): CodeAreaView {
  const verdict = read.authorship;
  const label = verdict === "hand-authored" ? "Hand-authored"
    : verdict === "mixed" ? "AI-assisted, human-directed"
      : verdict === "machine-heavy" ? "Machine-heavy"
        : verdict === "mirrored" ? "Mirrored from a private repository" : "Not established";
  const tone: Tone = verdict === "hand-authored" ? "green" : verdict === "mixed" ? "neutral" : verdict === "machine-heavy" ? "amber" : verdict === "mirrored" ? "amber" : "neutral";
  const bits = [
    read.aiTrailerCount ? `${count(read.aiTrailerCount)} commits carry an assistant co-author trailer` : null,
    read.genericMessageSharePct != null ? `${pct(read.genericMessageSharePct)} of commit messages are placeholders such as "update" or "wip"` : null,
    read.mirrorSharePct ? `${pct(read.mirrorSharePct)} of commits are squashed sync exports` : null,
    read.bulkDropCount ? `${count(read.bulkDropCount)} bulk code drops` : null,
  ];
  return {
    id: "authorship",
    question: "Is this vibe-coded, or real engineering with assistance?",
    badge: { label, tone },
    answer: verdict === "machine-heavy"
      ? "The commit record reads as machine-generated: assistant trailers, placeholder messages and large drops dominate."
      : verdict === "mixed"
        ? "The commit record shows assistant use inside human-directed work. Assistance is not the same as an empty product."
        : verdict === "hand-authored"
          ? "The commit record reads as hand-authored work."
          : verdict === "mirrored"
            ? "Commits arrive as exports from a private repository, so authorship of the original work cannot be read at all."
            : "The saved read did not establish how the code was authored.",
    detail: bits.length ? `${join(bits, ". ")}.` : null,
    next: "Assistant use is not itself a finding. What matters is whether the work is substantial, whether it reaches production and whether people outside the project use it.",
  };
}

function originArea(read: ShippingSummary): CodeAreaView {
  const tone: Tone = read.origin === "original" ? "green" : read.origin === "partly-derivative" ? "amber" : read.origin === "derivative" ? "red" : "neutral";
  return {
    id: "origin",
    question: "Is the code theirs?",
    badge: { label: read.origin === "unknown" ? "Not established" : read.origin.replace(/-/g, " "), tone },
    answer: read.origin === "derivative"
      ? "The repositories read are largely forks, templates or bulk imports, so the work on display is mostly someone else's."
      : read.origin === "partly-derivative"
        ? "Part of what is published is forked, templated or imported in bulk."
        : read.origin === "original"
          ? "The repositories read are original rather than forks or templates."
          : "The saved read did not establish whether the code is original.",
  };
}

function claimsArea(read: ShippingSummary): CodeAreaView {
  const unsupported = read.claimsUnsupported ?? 0;
  const supported = read.claimsSupported ?? 0;
  const roadmap = [
    read.roadmapMet ? `${count(read.roadmapMet)} met` : null,
    read.roadmapMissed ? `${count(read.roadmapMissed)} missed` : null,
    read.roadmapPending ? `${count(read.roadmapPending)} still pending` : null,
  ];
  const tone: Tone = unsupported > 0 ? "red" : supported > 0 ? "green" : "neutral";
  return {
    id: "claims",
    question: "Does the marketing match the code?",
    badge: { label: unsupported > 0 ? `${count(unsupported)} unsupported` : supported > 0 ? "Claims supported" : "No claims graded", tone },
    answer: supported || unsupported
      ? `Shipping claims in the project's own posts were matched to releases and commit activity: ${count(supported)} supported, ${count(unsupported)} unsupported.`
      : "No shipping claim from the project's own posts was graded against the commit record in this read.",
    detail: roadmap.some(Boolean) ? `Dated promises found in the project's own documents: ${join(roadmap, ", ")}.` : null,
    next: unsupported > 0 ? "An unsupported claim is a claim without matching code in the window, not proof of a lie. Read the posts beside the commit dates before relying on it." : null,
  };
}

function starsArea(read: ShippingSummary): CodeAreaView {
  const tone: Tone = read.stars === "organic" ? "green" : read.stars === "suspect" ? "red" : "neutral";
  const bits = [
    read.starsTotal != null ? `${count(read.starsTotal)} stars in total` : null,
    read.starBurstSharePct != null ? `the largest three-day burst carries ${pct(read.starBurstSharePct)} of them` : null,
    read.starBurstWindowStart ? `starting ${read.starBurstWindowStart.slice(0, 10)}` : null,
    read.starLaunchBurst ? "inside the repository's first month, which is expected for a launch" : null,
    read.starHistoryDays ? `${count(read.starHistoryDays)} days of daily star history were read` : null,
  ];
  return {
    id: "stars",
    question: "Are the stars real, or bought?",
    badge: {
      label: read.stars === "organic" ? "Stars look organic" : read.stars === "suspect" ? "Star pattern suspect" : read.stars === "none" ? "No stars" : "Not enough to judge",
      tone,
    },
    answer: read.stars === "suspect"
      ? "The star history concentrates in a short burst out of proportion with forks, watchers and commits. That pattern is what purchased or coordinated starring looks like."
      : read.stars === "organic"
        ? "Stars accumulate over time and stay in proportion with forks, watchers and commits."
        : read.stars === "none"
          ? "There are no stars to authenticate. That is not a finding against the project, but nothing is endorsing it either."
          : "There is not enough star history to judge authenticity.",
    detail: bits.length ? `${join(bits, ", ")}.` : null,
    next: "GitHub restricted the list of who starred a repository to its own admins on 30 June 2026, so the account-level check cannot run unless the project grants access. Timing and proportion are what remain readable.",
  };
}

function adoptionArea(read: ShippingSummary): CodeAreaView {
  const tone: Tone = read.adoption === "used" ? "green" : read.adoption === "noticed" ? "amber" : read.adoption === "unused" ? "amber" : "neutral";
  const bits = [
    read.externalPrs != null ? `${count(read.externalPrs)} pull requests from outside the project` : null,
    read.externalIssues != null ? `${count(read.externalIssues)} issues from outside` : null,
    read.activeForks != null ? `${count(read.activeForks)} forks pushed to inside the window` : null,
    read.packageDownloadsLastMonth != null ? `${count(read.packageDownloadsLastMonth)} package downloads in the last month` : null,
    read.packages && read.packages.length ? `published as ${read.packages.join(", ")}` : null,
  ];
  return {
    id: "adoption",
    question: "Is anyone actually using this?",
    badge: {
      label: read.adoption === "used" ? "Used outside the project" : read.adoption === "noticed" ? "Noticed, not used" : read.adoption === "unused" ? "No outside use" : "Not established",
      tone,
    },
    answer: read.adoption === "used"
      ? "People outside the project contribute, fork and pull the published packages. That is use, not attention."
      : read.adoption === "noticed"
        ? "The repositories draw attention, but outside contribution and package use stay near zero."
        : read.adoption === "unused"
          ? "No use from outside the project is recorded: no outside pull requests or issues, no active forks, no package downloads."
          : "The saved read did not measure outside use.",
    detail: bits.length ? `${join(bits, ", ")}.` : null,
    next: "Stars and followers are attention. Outside pull requests, active forks and package downloads are the closest public proxies for real use; revenue is not published by GitHub and is not established here.",
  };
}

function liveArea(read: ShippingSummary): CodeAreaView {
  const tone: Tone = read.live === "live" ? "green" : read.live === "deploys-without-code" ? "red" : read.live === "committed-only" ? "amber" : "neutral";
  const bits = [
    read.deploysInWindow != null ? `${count(read.deploysInWindow)} on-chain deployments` : null,
    read.publishesInWindow != null ? `${count(read.publishesInWindow)} package publishes` : null,
    read.codeToChain != null ? `${count(read.codeToChain)} of them followed a release or a burst of commits within 14 days` : null,
  ];
  return {
    id: "live",
    question: "Does the code reach production?",
    badge: {
      label: read.live === "live" ? "Code reaches production" : read.live === "committed-only" ? "Committed, not shipped" : read.live === "deploys-without-code" ? "Deploys without public code" : "Not established",
      tone,
    },
    answer: read.live === "live"
      ? "Commits are followed by deployments or package publishes, so the work reaches users rather than staying in the repository."
      : read.live === "committed-only"
        ? "Commits land, but no deployment or package publish follows them in the window."
        : read.live === "deploys-without-code"
          ? "Contracts are deployed without matching public code, so what runs cannot be checked against what is published."
          : "The saved read did not establish whether the code reaches production.",
    detail: bits.length ? `${join(bits, ", ")}.` : null,
  };
}

function peersArea(read: ShippingSummary): CodeAreaView | null {
  if (!read.peerSector && !read.cohortLabel) return null;
  const position = read.peerPositionCommits;
  const tone: Tone = position === "above" ? "green" : position === "below" ? "amber" : "neutral";
  const peerLine = read.peerSector
    ? `Against the public repositories of ${read.peerSector}, commit volume sits ${position ?? "unread"}${read.peerPositionAuthors ? `, contributor count ${read.peerPositionAuthors}` : ""}${read.peerPositionStars ? `, stars ${read.peerPositionStars}` : ""} the peer median.`
    : null;
  const cohortLine = read.cohortLabel
    ? `Against ${read.cohortLabel} (${count(read.cohortSize)} projects at a similar stage)${read.cohortPercentileCommits != null ? `, this subject sits at the ${Math.round(read.cohortPercentileCommits)}th percentile on commits` : ""}${read.cohortShippingSharePct != null ? `, and ${pct(read.cohortShippingSharePct)} of that group is still shipping` : ""}.`
    : null;
  return {
    id: "peers",
    question: "How does this compare with the projects it competes with?",
    badge: { label: position ? `Commits ${position} peer median` : "Compared", tone },
    answer: join([peerLine, cohortLine]),
    next: "Sector leaders are the ceiling, not the yardstick. The same-stage group is the fairer comparison, and neither is a score.",
  };
}

function committerArea(read: ShippingSummary, roster: CodeCommitterView[], hasRoster: boolean): CodeAreaView {
  const named = roster.filter((person) => person.match.tone === "green").length;
  const humans = roster.filter((person) => person.kind === "human").length;
  const tone: Tone = read.leadDeparted ? "red"
    : read.concentration === "team" ? "green"
      : read.concentration === "unattributed" ? "amber"
        : read.concentration === "single-author" ? "amber" : "neutral";
  return {
    id: "committers",
    question: "Who is actually writing the code?",
    badge: {
      label: read.leadDeparted ? "Lead committer stopped" : `Concentration: ${read.concentration === "unknown" ? "not established" : read.concentration.replace(/-/g, " ")}`,
      tone,
    },
    answer: `${count(read.distinctHuman)} human accounts committed in the window.${humans && hasRoster ? ` ${named} of the ${humans} in the roster below match a person this report names.` : ""}`,
    detail: read.churnDetail ?? null,
    next: humans && named === 0 && hasRoster
      ? "Nobody writing this code is named as a team member in this report. Identify them before treating the roster as the builders."
      : !hasRoster && humans
        ? "This report names no team, so these accounts cannot be matched to people. Resolve the committers before treating them as the team."
        : null,
  };
}

export function buildCodeView(input: {
  shipping?: ShippingSummary | null;
  github?: GithubAssessment | null;
  people: PersonCardView[];
  /** GitHub organisation linked by the project, when the scan recorded one. */
  linkedOrg?: string | null;
  /** Why the development read is missing, when the caller knows. */
  absentReason?: string | null;
}): CodeView {
  const read = input.shipping ?? null;
  const github = input.github ?? null;
  const account: CodeAccountView | null = github
    ? {
        login: github.login,
        url: `https://github.com/${github.login}`,
        summary: github.summary,
        confidence: github.confidence,
        accountAgeYears: github.accountAgeYears ?? null,
        publicRepos: github.publicRepos,
        originalCount: github.originalCount,
        forkCount: github.forkCount,
        totalStarsOnOriginals: github.totalStarsOnOriginals,
        languages: (github.topLanguages ?? []).map((entry) => entry.language),
        lastActivity: github.lastActivity ?? null,
        repoSampleState: github.repoSampleState ?? null,
        claimChecks: github.claimChecks ?? [],
        repos: (github.notableRepos ?? []).map((repo) => ({
          name: repo.name,
          url: repo.url,
          stars: repo.stars,
          language: repo.language ?? null,
          lastPush: repo.lastPush ?? null,
          fork: Boolean(repo.fork),
        })),
      }
    : null;

  const target = read?.target ?? input.linkedOrg ?? github?.login ?? null;
  const committers: CodeCommitterView[] = (read?.committers ?? []).map((committer, index) => ({
    key: `${committer.login ?? committer.name}-${index}`,
    name: committer.name,
    login: committer.login ?? null,
    githubUrl: committer.login ? `https://github.com/${committer.login}` : null,
    commits: committer.commits,
    sharePct: committer.sharePct,
    kind: committer.kind,
    freshAccount: committer.freshAccount,
    accountCreatedAt: committer.accountCreatedAt ?? null,
    last30: committer.last30,
    prior60: committer.prior60,
    xHandle: committer.twitter ?? null,
    xUrl: committer.twitter ? `https://x.com/${normalizeHandle(committer.twitter)}` : null,
    company: committer.company ?? null,
    orgs: committer.orgs ?? [],
    quiet: committer.prior60 > 0 && committer.last30 === 0,
    match: matchCommitter(committer, input.people),
  }));

  const areas: CodeAreaView[] = [];
  if (read) {
    areas.push(cadenceArea(read));
    areas.push(committerArea(read, committers, input.people.length > 0));
    areas.push(substanceArea(read));
    areas.push(authorshipArea(read));
    areas.push(originArea(read));
    areas.push(licenseArea(read, account));
    areas.push(hygieneArea(read));
    areas.push(claimsArea(read));
    areas.push(starsArea(read));
    areas.push(adoptionArea(read));
    areas.push(liveArea(read));
    const peers = peersArea(read);
    if (peers) areas.push(peers);
  }

  const metrics: Array<{ label: string; value: string }> = [];
  if (read) {
    metrics.push({ label: `Commits · ${count(read.windowDays)}d`, value: count(read.totalCommits) ?? "n/a" });
    metrics.push({ label: "Human committers", value: count(read.distinctHuman) ?? "n/a" });
    metrics.push({ label: "Active weeks", value: count(read.activeWeeks) ?? "n/a" });
    metrics.push({ label: "Releases", value: count(read.releasesInWindow) ?? "n/a" });
  }

  const coverage = read?.coverageNotes ?? [];
  const coverageLine = read
    ? join([
        `${count(read.reposRead)}${read.reposTotal != null ? ` of ${count(read.reposTotal)}` : ""} repositories read`,
        read.commitsRead != null ? `${count(read.commitsRead)} commits read in full${read.commitsCounted != null ? ` of ${count(read.commitsCounted)} counted` : ""}` : null,
        read.starHistoryDays ? `${count(read.starHistoryDays)} days of star history` : null,
      ], ", ")
    : null;

  return {
    target,
    targetUrl: target ? `https://github.com/${target}` : null,
    read,
    absentReason: read ? null : input.absentReason ?? null,
    headline: read?.headline ?? null,
    grade: read ? { label: GRADE_LABEL[read.grade], tone: GRADE_TONE[read.grade] } : null,
    capturedAt: read?.capturedAt ?? null,
    windowDays: read?.windowDays ?? null,
    metrics,
    areas,
    committers,
    committerNote: read && committers.length === 0 ? "This saved read recorded no committer roster." : null,
    goneQuiet: read?.goneQuiet ?? [],
    churnDetail: read?.churnDetail ?? null,
    coverage,
    coverageLine: coverageLine ? `${coverageLine}.` : null,
    weeks: read?.trendWeeks ?? [],
    trendSource: read?.trendSource ?? null,
    account,
    noCodeFootprint: !read && !account,
  };
}
