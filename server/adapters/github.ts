// GitHub forensics. For a builder, GitHub is the affiliation signal that is
// hardest to scrub and most precise to attribute: a person's public org
// memberships and the org repos they push to are a near-permanent record of who
// they actually build with, independent of LinkedIn or their bio.
//
// Resolution is the disciplined part. A name search alone is ambiguous, so we
// only ACT on a gold match: a GitHub account whose `twitter_username` equals the
// subject's X handle. That single field ties the two identities with almost no
// false-positive surface. A bare same-login coincidence is reported but not
// trusted. Evidence discipline over reach.

import type { Adapter, CollectContext } from "./types";
import { recordCall } from "../cost";
import { env } from "../config";
import { VentureOutcome, SubjectClass } from "../../src/engine";
import type { GithubAssessment, GithubClaimCheck, GithubRepoBrief } from "../../src/data/evidence";

const GH = "https://api.github.com";
const headers = (key: string) => ({
  authorization: `Bearer ${key}`,
  accept: "application/vnd.github+json",
  "user-agent": "argus-due-diligence",
});

async function ghJson<T>(path: string, key: string): Promise<T | null> {
  try {
    recordCall("github", path.split("?")[0].split("/").slice(1, 3).join("/") || "api", 0);
    const res = await fetch(GH + path, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface GhUser { login: string; name?: string; bio?: string; company?: string; twitter_username?: string; blog?: string; created_at?: string; public_repos?: number }
interface GhOrg { login: string; description?: string }
interface GhRepo { name: string; html_url: string; owner: { login: string; type: string }; stargazers_count?: number; fork?: boolean; language?: string; pushed_at?: string }

export interface GithubMatch {
  login: string;
  name?: string;
  bio?: string;
  company?: string;
  confidence: "gold" | "weak";
}

// Resolve the subject's GitHub account. Gold = twitter_username matches the X
// handle. Weak = login equals the handle but no twitter confirmation (reported,
// never acted on). Returns null if nothing credible.
export async function resolveGithub(handle: string, name: string | undefined, key: string): Promise<GithubMatch | null> {
  const h = handle.replace(/^@/, "").toLowerCase();
  const candidates = new Set<string>([h]);
  for (const q of [name, handle.replace(/^@/, "")]) {
    if (!q) continue;
    const found = await ghJson<{ items?: { login: string }[] }>(`/search/users?q=${encodeURIComponent(q)}&per_page=5`, key);
    for (const it of found?.items ?? []) candidates.add(it.login);
  }
  let weak: GithubMatch | null = null;
  for (const login of [...candidates].slice(0, 8)) {
    const u = await ghJson<GhUser>(`/users/${encodeURIComponent(login)}`, key);
    if (!u) continue;
    if ((u.twitter_username ?? "").toLowerCase() === h) {
      return { login: u.login, name: u.name, bio: u.bio, company: u.company, confidence: "gold" };
    }
    if (!weak && u.login.toLowerCase() === h) {
      weak = { login: u.login, name: u.name, bio: u.bio, company: u.company, confidence: "weak" };
    }
  }
  return weak;
}

// Org memberships + the org-owned repos the user pushes to: the affiliations.
export async function githubAffiliations(login: string, key: string): Promise<{ org: string; description?: string; via: string }[]> {
  const out = new Map<string, { org: string; description?: string; via: string }>();
  const orgs = await ghJson<GhOrg[]>(`/users/${encodeURIComponent(login)}/orgs`, key);
  for (const o of orgs ?? []) out.set(o.login.toLowerCase(), { org: o.login, description: o.description, via: "public org member" });
  const repos = await ghJson<GhRepo[]>(`/users/${encodeURIComponent(login)}/repos?sort=pushed&type=all&per_page=30`, key);
  for (const r of repos ?? []) {
    if (r.fork) continue;
    const owner = r.owner;
    if (owner.type === "Organization" && owner.login.toLowerCase() !== login.toLowerCase()) {
      const k = owner.login.toLowerCase();
      if (!out.has(k)) out.set(k, { org: owner.login, via: `repo ${r.name}` });
    }
  }
  return [...out.values()].slice(0, 10);
}

// Team fan-out budget + the leader-role test (a project's founders/leads only).
const MAX_TEAM = 5;
const LEADER_RE = /founder|cofounder|co-?founder|ceo|cto|coo|president|chief|head of|\blead\b/i;

const yearsSince = (fromIso: string, toMs: number): number | undefined => {
  const t = Date.parse(fromIso);
  return Number.isFinite(t) ? (toMs - t) / (365.25 * 864e5) : undefined;
};

// Deterministic (no-LLM) cross-check of the X bio's self-claims against what the
// GitHub account actually shows. Every result is GRADED, never accusatory: a
// "contradicted" grade means bio and GitHub disagree on a checkable fact, which
// is a lead for a human, not a verdict.
export function buildClaimChecks(
  bio: string,
  a: { createdAt?: string; accountAgeYears?: number; originalCount: number; forkCount: number; forkRatio: number; totalStarsOnOriginals: number },
): GithubClaimCheck[] {
  const checks: GithubClaimCheck[] = [];
  const b = bio ?? "";

  // 1) "since YYYY" / "est. 'YY" tenure claims vs the account's creation year.
  const ym = b.match(/\b(?:since|est\.?|building since|from)\s*'?(\d{4})\b/i) ?? b.match(/\bsince\s*'?(\d{2})\b/i);
  if (ym && a.createdAt) {
    let claimedYear = parseInt(ym[1], 10);
    if (claimedYear < 100) claimedYear += 2000; // "since '09" -> 2009
    const createdYear = new Date(a.createdAt).getFullYear();
    if (Number.isFinite(createdYear)) {
      if (claimedYear >= createdYear - 1) {
        checks.push({ claim: `Bio implies presence since ${claimedYear}`, observation: `GitHub account created ${createdYear} — consistent`, grade: "consistent" });
      } else {
        checks.push({ claim: `Bio implies presence since ${claimedYear}`, observation: `but the GitHub account was only created in ${createdYear}`, grade: "context" });
      }
    }
  }

  // 2) Builder/founder persona vs actual original output.
  if (/founder|co-?founder|builder|\bbuild|\bdev\b|developer|engineer|\bship|core contributor|hacker|programmer/i.test(b)) {
    const total = a.originalCount + a.forkCount;
    const claim = "Bio presents a builder/founder persona";
    if (total === 0) {
      checks.push({ claim, observation: "GitHub account has no public repositories", grade: "unsupported" });
    } else if (a.originalCount === 0) {
      checks.push({ claim, observation: `all ${total} public repos are forks — no original repositories`, grade: "contradicted" });
    } else if (a.forkRatio >= 0.8) {
      checks.push({ claim, observation: `${a.forkCount} of ${total} repos are forks; ${a.originalCount} original with ${a.totalStarsOnOriginals}★`, grade: "unsupported" });
    } else {
      checks.push({ claim, observation: `${a.originalCount} original repos (${a.totalStarsOnOriginals}★)`, grade: "consistent" });
    }
  }

  return checks;
}

// Assess a resolved GitHub account: age, original-vs-fork mix, stars, languages,
// recency, and the bio-claim cross-checks. Two API calls (user + repos list);
// every field is derived from the list payload, so no per-repo detail fetch.
export async function assessGithub(match: GithubMatch, key: string, bio: string, opts?: { maxRepos?: number }): Promise<GithubAssessment | null> {
  const login = match.login;
  const perPage = opts?.maxRepos ?? 30;
  const u = await ghJson<GhUser>(`/users/${encodeURIComponent(login)}`, key);
  if (!u) return null;
  const repos = (await ghJson<GhRepo[]>(`/users/${encodeURIComponent(login)}/repos?sort=pushed&type=owner&per_page=${perPage}`, key)) ?? [];

  const originals = repos.filter((r) => !r.fork);
  const forks = repos.filter((r) => r.fork);
  const total = repos.length;
  const forkRatio = total ? forks.length / total : 0;
  const totalStarsOnOriginals = originals.reduce((s, r) => s + (r.stargazers_count ?? 0), 0);

  const langTally = new Map<string, number>();
  for (const r of originals) if (r.language) langTally.set(r.language, (langTally.get(r.language) ?? 0) + 1);
  const topLanguages = [...langTally.entries()].map(([language, repos]) => ({ language, repos })).sort((a, b) => b.repos - a.repos).slice(0, 6);

  const notableRepos: GithubRepoBrief[] = [...originals]
    .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
    .slice(0, 5)
    .map((r) => ({ name: r.name, stars: r.stargazers_count ?? 0, language: r.language, lastPush: r.pushed_at, fork: false, url: r.html_url }));

  const nowMs = Date.now();
  const pushes = repos.map((r) => (r.pushed_at ? Date.parse(r.pushed_at) : NaN)).filter((t) => Number.isFinite(t));
  const lastMs = pushes.length ? Math.max(...pushes) : undefined;
  const ageY = u.created_at ? yearsSince(u.created_at, nowMs) : undefined;

  const base = {
    createdAt: u.created_at,
    accountAgeYears: ageY != null ? Math.round(ageY * 10) / 10 : undefined,
    originalCount: originals.length,
    forkCount: forks.length,
    forkRatio: Math.round(forkRatio * 100) / 100,
    totalStarsOnOriginals,
  };
  const summary = `github.com/${login}: ${ageY != null ? `~${Math.round(ageY)}y old, ` : ""}${originals.length} original + ${forks.length} fork repos${totalStarsOnOriginals ? `, ${totalStarsOnOriginals}★ on originals` : ""}${topLanguages.length ? ` (${topLanguages.slice(0, 3).map((l) => l.language).join(", ")})` : ""}.`;

  return {
    login,
    confidence: match.confidence,
    ...base,
    publicRepos: u.public_repos ?? total,
    topLanguages,
    notableRepos,
    lastActivity: lastMs ? new Date(lastMs).toISOString() : undefined,
    daysSinceActivity: lastMs ? Math.round((nowMs - lastMs) / 864e5) : undefined,
    claimChecks: buildClaimChecks(bio, base),
    summary,
  };
}

export const githubAdapter: Adapter = {
  id: "github",
  label: "GitHub forensics",
  available: () => !!env("GITHUB_TOKEN"),
  async run(ctx: CollectContext) {
    const key = env("GITHUB_TOKEN");
    if (!key) return;
    const name = ctx.evidence.profile.display_name;
    ctx.emit({ phase: "P1 · Identity", label: "GitHub resolution", detail: `Matching ${ctx.handle} to a GitHub account by linked X handle…`, source: "github", tone: "neutral" });
    const match = await resolveGithub(ctx.handle, name, key);
    if (!match) {
      ctx.emit({ phase: "P1 · Identity", label: "No GitHub match", detail: "No GitHub account links back to this X handle.", source: "github", tone: "neutral" });
      return;
    }
    if (match.confidence === "weak") {
      // login coincidence without a twitter_username confirmation — surface as a
      // lead only, never an attributed fact.
      ctx.emit({ phase: "P1 · Identity", label: "Possible GitHub", detail: `github.com/${match.login} shares the handle but does not link back to X. Unconfirmed, not attributed.`, source: "github", tone: "warn" });
      return;
    }
    // gold: twitter_username == subject handle
    ctx.evidence.profile.identity_confidence = "Probable";
    ctx.evidence.profile.identity_note = `GitHub github.com/${match.login}${match.name ? ` (${match.name})` : ""} links back to this X handle.`;
    ctx.emit({ phase: "P1 · Identity", label: "GitHub confirmed", detail: `github.com/${match.login} links back to ${ctx.handle} (twitter_username match).`, source: "github", tone: "good" });

    // Assess the subject's own account: quality of work, account history, and how
    // the X bio's self-claims hold up against the actual GitHub.
    const assessment = await assessGithub(match, key, ctx.evidence.profile.bio);
    if (assessment) {
      ctx.evidence.profile.githubAssessment = assessment;
      ctx.emit({ phase: "P1 · Identity", label: "GitHub assessment", detail: assessment.summary, source: "github", tone: assessment.forkRatio > 0.8 || assessment.originalCount === 0 ? "warn" : "neutral" });
      for (const c of assessment.claimChecks) {
        if (c.grade === "contradicted" || c.grade === "unsupported") {
          ctx.emit({ phase: "P1 · Identity", label: "Bio vs GitHub", detail: `${c.claim} — ${c.observation}.`, source: "github", tone: "warn" });
        }
      }
    }

    // Project path: resolve + assess the founders'/leaders' GitHubs by matching
    // each leader's X handle to a GitHub twitter_username (gold match only), so a
    // project account's real builders get the same scrutiny as a person.
    if (ctx.evidence.roles.includes(SubjectClass.PROJECT)) {
      const leaders = (ctx.evidence.webTeam ?? []).filter((m) => m.handle && LEADER_RE.test(m.role ?? "")).slice(0, MAX_TEAM);
      let assessed = 0;
      for (const m of leaders) {
        const tm = await resolveGithub(m.handle!, m.name, key);
        if (tm?.confidence !== "gold") continue;
        const ta = await assessGithub(tm, key, "", { maxRepos: 15 });
        if (ta) { m.github = ta; assessed++; }
      }
      if (leaders.length) {
        ctx.emit({ phase: "P1 · Identity", label: "Team GitHubs", detail: assessed ? `${assessed} of ${leaders.length} leader X handle(s) linked to a GitHub (twitter_username match) and assessed.` : "No leader X handle linked back to a GitHub account.", source: "github", tone: assessed ? "good" : "neutral" });
      }
    }

    const affs = await githubAffiliations(match.login, key);
    if (!affs.length) {
      ctx.emit({ phase: "P1 · Identity", label: "No public orgs", detail: "GitHub account has no public org memberships or org-repo contributions.", source: "github", tone: "neutral" });
      return;
    }
    const have = new Set(ctx.evidence.ventures.map((v) => v.project_name.toLowerCase()));
    const added: string[] = [];
    for (const a of affs) {
      if (have.has(a.org.toLowerCase())) continue;
      have.add(a.org.toLowerCase());
      ctx.evidence.ventures.push({
        project_name: a.org,
        role: "github contributor",
        period: "",
        outcome: VentureOutcome.ACTIVE,
        evidence_url: `https://github.com/${a.org}`,
        notes: `GitHub: ${a.via}`,
      });
      ctx.evidence.associates.push({ associate_handle: a.org, relation: "github org", evidence_url: `https://github.com/${a.org}` });
      added.push(a.org);
    }
    ctx.emit({ phase: "P1 · Identity", label: "GitHub affiliations", detail: `${added.length} org(s) this account builds with (near-permanent, hard to scrub): ${added.slice(0, 5).join(", ")}.`, source: "github", tone: "good" });
  },
};
