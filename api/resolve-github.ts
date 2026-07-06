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
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 20 };

const GH = "https://api.github.com";
const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const RESERVED = /^(orgs|sponsors|topics|features|about|marketplace|explore|pricing|settings|login|join|team|enterprise|readme|search|apps|collections)$/i;

type GhUser = { login: string; name?: string | null; twitter_username?: string | null; followers?: number; public_repos?: number; bio?: string | null; html_url?: string };

async function ghUser(login: string, key: string): Promise<GhUser | null> {
  try {
    const r = await fetch(`${GH}/users/${encodeURIComponent(login)}`, { headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return (await r.json()) as GhUser;
  } catch { return null; }
}

async function searchBio(handle: string, key: string): Promise<string[]> {
  try {
    const r = await fetch(`${GH}/search/users?q=${encodeURIComponent(`"${handle}" in:bio`)}&per_page=5`, { headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const d = (await r.json()) as { items?: { login: string }[] };
    return (d.items ?? []).map((i) => i.login).filter(Boolean).slice(0, 5);
  } catch { return []; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = (typeof req.query.handle === "string" ? req.query.handle : "").replace(/^@/, "").trim().slice(0, 40);
  const name = (typeof req.query.name === "string" ? req.query.name : "").trim().slice(0, 80);
  const bio = (typeof req.query.bio === "string" ? req.query.bio : "").slice(0, 400);
  if (!handle && !name) { res.status(400).json({ error: "handle or name required" }); return; }
  const key = process.env.GITHUB_TOKEN;
  if (!key) { res.status(200).json({ available: false, note: "GitHub not configured (no GITHUB_TOKEN)." }); return; }

  const ck = `ghresolve:${handle.toLowerCase()}:${name.toLowerCase()}`;
  const cached = await cacheGetJson<any>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const hlow = handle.toLowerCase();
  const nlow = name.toLowerCase();
  const scores = new Map<string, { score: number; why: string[]; user?: GhUser }>();
  const bump = (login: string, pts: number, why: string) => {
    if (!login || !LOGIN_RE.test(login) || RESERVED.test(login)) return;
    const e = scores.get(login.toLowerCase()) ?? { score: 0, why: [] };
    e.score += pts; e.why.push(why); scores.set(login.toLowerCase(), e);
  };

  // 1. A github.com/<login> link in the X bio — they linked it themselves.
  const bioLink = bio.match(/github\.com\/([A-Za-z0-9-]{1,39})/i)?.[1];
  if (bioLink) bump(bioLink, 3, "linked from the X bio");

  // 2. Candidates: same-username, the bio-link login, and a bio-search for the handle.
  const candidates = new Set<string>([handle, bioLink, ...(handle ? await searchBio(handle, key) : [])].filter(Boolean) as string[]);
  for (const login of candidates) {
    if (!LOGIN_RE.test(login) || RESERVED.test(login)) continue;
    const u = await ghUser(login, key);
    if (!u) continue;
    if (login.toLowerCase() === hlow) bump(u.login, 1, "same username as the X handle");
    if (u.twitter_username && u.twitter_username.toLowerCase().replace(/^@/, "") === hlow) bump(u.login, 3, "GitHub profile links to the same X account");
    if (nlow && u.name && (u.name.toLowerCase().includes(nlow) || nlow.includes(u.name.toLowerCase()))) bump(u.login, 1, "name matches");
    if (bio && u.bio && handle && u.bio.toLowerCase().includes(hlow)) bump(u.login, 2, "X handle appears in the GitHub bio");
    scores.get(u.login.toLowerCase())!.user = u;
  }

  // Pick the strongest candidate that clears the corroboration bar (>=2 = a strong
  // signal, or two weak ones — never a same-username coincidence alone).
  const best = [...scores.entries()].map(([, v]) => v).filter((v) => v.score >= 2 && v.user).sort((a, b) => b.score - a.score)[0];
  const out = best?.user
    ? { available: true, login: best.user.login, name: best.user.name ?? null, followers: best.user.followers ?? 0, repos: best.user.public_repos ?? 0, url: best.user.html_url ?? `https://github.com/${best.user.login}`, why: [...new Set(best.why)], confidence: best.score >= 3 ? "high" : "medium" }
    : { available: false, note: "No GitHub account could be confidently matched to this person." };
  await cacheSetJson(ck, out);
  res.status(200).json(out);
}
