// GitHub commit forensics. GET /api/github-forensics?login=<user>  |  ?org=<org>
//
// A crypto team can scrub its site, use pseudonyms on X, and rotate wallets — but
// the git history is the thing they forget. Every commit carries an author name
// and an author EMAIL, written by the dev's local git config. Personal emails
// (real name @ gmail) de-anonymize an "anonymous" founder; the full author roster
// exposes the real team behind a pseudonymous project; a repo that's a fork of
// another project reveals copied code passed off as original. This is the OSINT
// unlock an investigator does by hand, one commit at a time — automated across
// the repos. (Timezone offsets aren't used: GitHub's REST API normalizes the
// commit date to UTC, so the local offset isn't recoverable this way.)
//
// Gated on GITHUB_TOKEN (already set). Read-only. ~1 call per repo scanned.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

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
interface CallCounter { calls: number; succeeded: number }
async function gh<T>(path: string, key: string, usage: CallCounter): Promise<T | null> {
  usage.calls += 1;
  try {
    const r = await fetch(GH + path, { headers: headers(key), signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const data = (await r.json()) as T;
    usage.succeeded += 1;
    return data;
  } catch {
    return null;
  }
}

const domainOf = (email: string) => (email.includes("@") ? email.split("@")[1].toLowerCase() : "");

interface RepoRef { name: string; full: string; fork: boolean; parent?: string }
interface Identity { name: string; email: string; login?: string; commits: number; kind: "personal" | "corporate" | "unknown"; repos: string[] }

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
  const target = login || org;
  if (!target || !LOGIN_RE.test(target)) { res.status(400).json({ error: "login or org required" }); return; }
  if (!key) { res.status(200).json({ target, available: false, note: "GitHub not configured (no GITHUB_TOKEN)." }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    // Repos to mine: the org's, or the user's own (non-fork first).
    const repoList = org
      ? await gh<any[]>(`/orgs/${encodeURIComponent(org)}/repos?sort=pushed&type=public&per_page=${MAX_REPOS * 2}`, key, usage)
      : await gh<any[]>(`/users/${encodeURIComponent(login)}/repos?sort=pushed&type=owner&per_page=${MAX_REPOS * 2}`, key, usage);
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

    for (const repo of chosen) {
      const q = login ? `?author=${encodeURIComponent(login)}&per_page=${COMMITS_PER_REPO}` : `?per_page=${COMMITS_PER_REPO}`;
      const commits = await gh<any[]>(`/repos/${repo.full}/commits${q}`, key, usage);
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
          id = { name, email, login: c.author?.login, commits: 0, kind, repos: [] };
          identities.set(k, id);
        }
        id.commits++;
        if (c.author?.login && !id.login) id.login = c.author.login;
        if (!id.repos.includes(repo.name)) id.repos.push(repo.name);
      }
    }

    const people = [...identities.values()].sort((a, b) => b.commits - a.commits).slice(0, 25);
    const leaks = people.filter((p) => p.kind === "personal");

    const note = !people.length
      ? "No commit-author metadata recovered (repos empty, or authors use GitHub's email privacy)."
      : `${people.length} distinct commit author${people.length === 1 ? "" : "s"} across ${chosen.length} repo${chosen.length === 1 ? "" : "s"}. ` +
        (leaks.length ? `${leaks.length} leaked a personal email — real-identity exposure. ` : "") +
        (forks.length ? `${forks.length} repo(s) are forks of other projects (copied code).` : "");

    res.status(200).json({
      target,
      kind: org ? "org" : "user",
      available: true,
      reposScanned: chosen.map((r) => r.full),
      identities: people,
      emailLeaks: leaks.map((p) => ({ name: p.name, email: p.email, login: p.login, commits: p.commits })),
      forks,
      note,
    });
  } catch (e) {
    res.status(200).json({ target, available: true, error: String(e), note: "GitHub forensics failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "github",
        op: "panel:github-forensics",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
