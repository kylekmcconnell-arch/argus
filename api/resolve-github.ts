// Resolve a PERSON's GitHub account. GET /api/resolve-github?handle=<x>&name=<display>&bio=<xbio>
//
// A person audit should check the subject's code footprint, but a report only has
// their X handle/name/bio — not a GitHub login. This bridges that (Enigma's memo:
// "his X handle was in his GitHub bio but it never checked his GitHub"). Three
// corroborating signals, scored so a same-username coincidence alone isn't trusted:
//   1. a github.com/<login> link in the subject's X bio (they linked it);
//   2. a GitHub user at the same login whose profile links back to the same X;
//   3. GitHub user-search for the X handle IN A BIO (the memo's exact case).
// Returns the best-matching login for /api/github-forensics to analyse. Cached 24h.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 20 };

const GH = "https://api.github.com";
const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const RESERVED = /^(orgs|sponsors|topics|features|about|marketplace|explore|pricing|settings|login|join|team|enterprise|readme|search|apps|collections)$/i;

type GhUser = { login: string; name?: string | null; twitter_username?: string | null; followers?: number; public_repos?: number; bio?: string | null; html_url?: string };
interface CallCounter { calls: number; succeeded: number }

const comparableName = (value: string): string => value
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

async function ghUser(login: string, key: string, usage: CallCounter): Promise<GhUser | null> {
  usage.calls += 1;
  try {
    const r = await fetch(`${GH}/users/${encodeURIComponent(login)}`, { headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = (await r.json()) as GhUser;
    usage.succeeded += 1;
    return data;
  } catch { return null; }
}

async function searchBio(handle: string, key: string, usage: CallCounter): Promise<string[]> {
  usage.calls += 1;
  try {
    const r = await fetch(`${GH}/search/users?q=${encodeURIComponent(`"${handle}" in:bio`)}&per_page=5`, { headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const d = (await r.json()) as { items?: { login: string }[] };
    usage.succeeded += 1;
    return (d.items ?? []).map((i) => i.login).filter(Boolean).slice(0, 5);
  } catch { return []; }
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

  const handle = (typeof req.query.handle === "string" ? req.query.handle : "").replace(/^@/, "").trim().slice(0, 40);
  const name = (typeof req.query.name === "string" ? req.query.name : "").trim().slice(0, 80);
  const bio = (typeof req.query.bio === "string" ? req.query.bio : "").slice(0, 400);
  if (!handle && !name) { res.status(400).json({ error: "handle or name required" }); return; }
  const key = process.env.GITHUB_TOKEN;
  if (!key) { res.status(200).json({ available: false, note: "GitHub not configured (no GITHUB_TOKEN)." }); return; }

  // v3: a cached v2 row could carry a medium-confidence, GitHub-side-only match.
  const ck = `ghresolve:${handle.toLowerCase()}:${name.toLowerCase()}:v3`;
  const cached = await cacheGetJson<Record<string, unknown>>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const hlow = handle.toLowerCase();
    const nlow = name.toLowerCase();
    const scores = new Map<string, { score: number; why: string[]; user?: GhUser }>();
    const entry = (login: string) => { const k = login.toLowerCase(); let e = scores.get(k); if (!e) { e = { score: 0, why: [] }; scores.set(k, e); } return e; };
    const bump = (login: string, pts: number, why: string) => {
      if (!login || !LOGIN_RE.test(login) || RESERVED.test(login)) return;
      const e = entry(login); e.score += pts; e.why.push(why);
    };

    // 1. A github.com/<login> link in the X bio — the only subject-side proof
    // available here: the audited X account itself points to it. Everything
    // the GitHub side declares (twitter_username, the handle in a GitHub bio)
    // is self-asserted and forgeable by an impersonator, so on its own it is a
    // lead, never a resolution that feeds commit-email ties into the graph.
    const bioLink = bio.match(/github\.com\/([A-Za-z0-9-]{1,39})/i)?.[1];
    if (bioLink) bump(bioLink, 4, "linked from the X bio");
    const subjectLinksBack = (login: string) => Boolean(bioLink && bioLink.toLowerCase() === login.toLowerCase());

    // 2. Candidates: same-username, the bio-link login, and a bio-search for the handle.
    const candidates = new Set<string>([handle, bioLink, ...(handle ? await searchBio(handle, key, usage) : [])].filter(Boolean) as string[]);
    for (const login of candidates) {
      if (!LOGIN_RE.test(login) || RESERVED.test(login)) continue;
      const u = await ghUser(login, key, usage);
      if (!u || !LOGIN_RE.test(u.login) || RESERVED.test(u.login)) continue;
      if (u.login.toLowerCase() === hlow) bump(u.login, 1, "same username as the X handle");
      // Self-declared on the GitHub side, so spoofable — corroborating, not proof.
      if (u.twitter_username && u.twitter_username.toLowerCase().replace(/^@/, "") === hlow) bump(u.login, 2, "GitHub profile links to the same X account");
      // Full-name equality only: "Li" is not "Alice Li".
      if (nlow && u.name && comparableName(u.name) === comparableName(nlow)) bump(u.login, 1, "name matches");
      if (bio && u.bio && handle && u.bio.toLowerCase().includes(hlow)) bump(u.login, 2, "X handle appears in the GitHub bio");
      entry(u.login).user = u; // attach the fetched profile to whatever entry exists
    }

    // Resolution requires the subject's own back-link. GitHub-side claims rank
    // the leads but never resolve an account by themselves.
    const ranked = [...scores.values()].filter((v) => v.user).sort((a, b) => b.score - a.score);
    const best = ranked.find((v) => v.score >= 4 && subjectLinksBack(v.user!.login));
    const lead = !best ? ranked.find((v) => v.score >= 2) : undefined;
    const out = best?.user
      ? { available: true, login: best.user.login, name: best.user.name ?? null, followers: best.user.followers ?? 0, repos: best.user.public_repos ?? 0, url: best.user.html_url ?? `https://github.com/${best.user.login}`, why: [...new Set(best.why)], confidence: "high" as const }
      : lead?.user
        ? { available: false, lead: { login: lead.user.login, why: [...new Set(lead.why)] }, note: `github.com/${lead.user.login} claims this person, but nothing on the subject's side links back to it. Unconfirmed, not attributed.` }
        : { available: false, note: "No GitHub account could be confidently matched to this person." };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "GitHub resolution failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "github",
        op: "panel:resolve-github",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
