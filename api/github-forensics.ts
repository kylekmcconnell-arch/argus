// GitHub commit forensics. GET /api/github-forensics?login=<user>  |  ?org=<org>
//
// A crypto team can scrub its site, use pseudonyms on X, and rotate wallets — but
// the git history is the thing they forget. Every commit carries an author name,
// an author EMAIL, and a timezone offset, written by the dev's local git config.
// Personal emails (real name @ gmail) de-anonymize an "anonymous" founder; the
// spread of timezone offsets geolocates the team; a repo that's a fork of a known
// project reveals copied code and fake "original" work. This is the OSINT unlock
// an investigator does by hand, one commit at a time — automated across the repos.
//
// Gated on GITHUB_TOKEN (already set). Read-only. ~1 call per repo scanned.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const GH = "https://api.github.com";
const MAX_REPOS = 6;
const COMMITS_PER_REPO = 100;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// Personal / free mail providers — a commit email here is very likely the dev's
// real personal identity, not a work address.
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "protonmail.com", "proton.me", "pm.me", "outlook.com",
  "hotmail.com", "live.com", "icloud.com", "me.com", "yahoo.com", "ymail.com", "hey.com",
  "yandex.ru", "gmx.com", "qq.com", "163.com", "126.com", "mail.ru", "zoho.com",
]);
// Bot / noreply authors to ignore.
const isNoise = (email: string, name: string) =>
  !email ||
  /noreply\.github\.com$/i.test(email) ||
  /\[bot\]$/i.test(name) ||
  /^(github-actions|dependabot|renovate|snyk-bot|greenkeeper)/i.test(name);

function headers(key: string) {
  return { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" };
}
async function gh<T>(path: string, key: string): Promise<T | null> {
  try {
    const r = await fetch(GH + path, { headers: headers(key), signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// Offset from an ISO commit date ("2023-06-01T14:23:11+08:00" / "...Z") — the
// dev's local UTC offset, straight out of their git config. Geography, leaked.
function tzOffset(iso: string): string | null {
  if (typeof iso !== "string") return null;
  if (/Z$/.test(iso)) return "+00:00";
  const m = iso.match(/([+-]\d{2}:\d{2})$/);
  return m ? m[1] : null;
}
const domainOf = (email: string) => (email.includes("@") ? email.split("@")[1].toLowerCase() : "");

interface RepoRef { name: string; full: string; fork: boolean; parent?: string }
interface Identity { name: string; email: string; login?: string; commits: number; kind: "personal" | "corporate" | "unknown"; timezones: Record<string, number>; repos: string[] }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.GITHUB_TOKEN;
  const login = typeof req.query.login === "string" ? req.query.login.replace(/^@/, "").trim() : "";
  const org = typeof req.query.org === "string" ? req.query.org.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "").trim() : "";
  const target = login || org;
  if (!target || !LOGIN_RE.test(target)) { res.status(400).json({ error: "login or org required" }); return; }
  if (!key) { res.status(200).json({ target, available: false, note: "GitHub not configured (no GITHUB_TOKEN)." }); return; }

  try {
    // Repos to mine: the org's, or the user's own (non-fork first).
    const repoList = org
      ? await gh<any[]>(`/orgs/${encodeURIComponent(org)}/repos?sort=pushed&type=public&per_page=${MAX_REPOS * 2}`, key)
      : await gh<any[]>(`/users/${encodeURIComponent(login)}/repos?sort=pushed&type=owner&per_page=${MAX_REPOS * 2}`, key);
    if (!Array.isArray(repoList)) { res.status(200).json({ target, available: true, note: "No public repos found for this account." }); return; }

    const forks: { repo: string; parent: string }[] = [];
    const chosen: RepoRef[] = [];
    for (const r of repoList) {
      const ref: RepoRef = { name: r.name, full: r.full_name, fork: !!r.fork, parent: r.parent?.full_name };
      if (r.fork) { if (r.parent?.full_name) forks.push({ repo: r.full_name, parent: r.parent.full_name }); }
      if (chosen.length < MAX_REPOS) chosen.push(ref);
    }
    // Forks need a second call to learn the parent (list endpoint omits it).
    const identities = new Map<string, Identity>();
    const tzTotals: Record<string, number> = {};

    for (const repo of chosen) {
      const q = login ? `?author=${encodeURIComponent(login)}&per_page=${COMMITS_PER_REPO}` : `?per_page=${COMMITS_PER_REPO}`;
      const commits = await gh<any[]>(`/repos/${repo.full}/commits${q}`, key);
      for (const c of commits ?? []) {
        const a = c.commit?.author ?? {};
        const name = String(a.name ?? "").trim();
        const email = String(a.email ?? "").trim().toLowerCase();
        if (isNoise(email, name)) continue;
        const k = email || name.toLowerCase();
        let id = identities.get(k);
        if (!id) {
          const dom = domainOf(email);
          const kind = PERSONAL.has(dom) ? "personal" : dom ? "corporate" : "unknown";
          id = { name, email, login: c.author?.login, commits: 0, kind, timezones: {}, repos: [] };
          identities.set(k, id);
        }
        id.commits++;
        if (c.author?.login && !id.login) id.login = c.author.login;
        if (!id.repos.includes(repo.name)) id.repos.push(repo.name);
        const off = tzOffset(a.date);
        if (off) { id.timezones[off] = (id.timezones[off] ?? 0) + 1; tzTotals[off] = (tzTotals[off] ?? 0) + 1; }
      }
    }

    const people = [...identities.values()].sort((a, b) => b.commits - a.commits).slice(0, 25);
    const leaks = people.filter((p) => p.kind === "personal");
    const dominantTz = Object.entries(tzTotals).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([off, n]) => ({ offset: off, commits: n }));

    const note = !people.length
      ? "No commit-author metadata recovered (repos empty, or authors use GitHub's email privacy)."
      : `${people.length} distinct commit author${people.length === 1 ? "" : "s"} across ${chosen.length} repo${chosen.length === 1 ? "" : "s"}. ` +
        (leaks.length ? `${leaks.length} leaked a personal email (real-identity exposure). ` : "") +
        (dominantTz.length ? `Primary timezone ${dominantTz[0].offset}. ` : "") +
        (forks.length ? `${forks.length} repo(s) are forks of other projects (copied code).` : "");

    res.status(200).json({
      target,
      kind: org ? "org" : "user",
      available: true,
      reposScanned: chosen.map((r) => r.full),
      identities: people,
      emailLeaks: leaks.map((p) => ({ name: p.name, email: p.email, login: p.login, commits: p.commits })),
      timezones: dominantTz,
      forks,
      note,
    });
  } catch (e) {
    res.status(200).json({ target, available: true, error: String(e), note: "GitHub forensics failed." });
  }
}
