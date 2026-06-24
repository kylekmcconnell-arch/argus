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
import { env } from "../config";
import { VentureOutcome } from "../../src/engine";

const GH = "https://api.github.com";
const headers = (key: string) => ({
  authorization: `Bearer ${key}`,
  accept: "application/vnd.github+json",
  "user-agent": "argus-due-diligence",
});

async function ghJson<T>(path: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(GH + path, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface GhUser { login: string; name?: string; bio?: string; company?: string; twitter_username?: string; blog?: string }
interface GhOrg { login: string; description?: string }
interface GhRepo { name: string; html_url: string; owner: { login: string; type: string }; stargazers_count?: number; fork?: boolean }

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
