// Deep team search for a project. GET /api/recon-team?domain=&name=&title=&names=&x=&gh=
//
// Four angles run concurrently and merge, because no single source finds the
// whole team:
//   1. WEB/LINKEDIN (Grok)  — Google, LinkedIn company + employees, Crunchbase,
//      press, X. Connects site names to profiles.
//   2. X-CONTENT (Grok)     — mines the project's OWN X posts (team intros, role
//      announcements, cofounder/advisor mentions).
//   3. X-FOLLOWING (data)   — accounts the project both FOLLOWS and TAGS in its
//      posts; deterministic, high-precision team/associates (twitterapi).
//   4. GITHUB (data)        — the org's public members + repo contributors, with
//      their linked X handle where set (the actual builders).
// Angles 3-4 read it off the data instead of guessing, so they catch people the
// LLM search misses. Results dedupe by handle/name.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, grokUsd, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 60 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const HANDLE = /^@?[A-Za-z0-9_]{2,30}$/;
const TW = "https://api.twitterapi.io";
const GH = "https://api.github.com";

interface TeamAngle {
  people: any[];
  provider: "grok" | "twitterapi" | "github";
  calls: number;
  usd: number;
  status: "succeeded" | "partial" | "failed";
}
interface CallCounter { calls: number; succeeded: number }
const counterStatus = (counter: CallCounter): TeamAngle["status"] => (
  counter.succeeded === counter.calls ? "succeeded" : counter.succeeded > 0 ? "partial" : "failed"
);

// ── Grok angles ──────────────────────────────────────────────────────────
async function grokPeople(key: string, system: string, user: string): Promise<TeamAngle> {
  let r: Response;
  try {
    r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
        max_tool_calls: 6, // cost cap: xAI bills live search per source
      }),
      signal: AbortSignal.timeout(50000),
    });
  } catch { return { people: [], provider: "grok", calls: 1, usd: 0, status: "failed" }; }
  if (!r.ok) return { people: [], provider: "grok", calls: 1, usd: 0, status: "failed" };

  let d: any;
  try { d = await r.json(); }
  catch { return { people: [], provider: "grok", calls: 1, usd: 0, status: "failed" }; }
  const toolCalls = Array.isArray(d?.output) ? d.output.filter((item: any) => /search|tool/.test(String(item?.type ?? ""))).length : 0;
  const text = d?.output_text ?? (Array.isArray(d?.output) ? d.output.flatMap((o: any) => o?.content ?? []).map((c: any) => c?.text ?? "").join(" ") : "") ?? "";
  const m = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
  let people: any[] = [];
  let validContract = false;
  if (m) {
    try {
      const parsed = JSON.parse(m[0]).people;
      if (Array.isArray(parsed)) { people = parsed; validContract = true; }
    } catch { /* invalid provider payload */ }
  }
  return { people, provider: "grok", calls: 1, usd: grokUsd(d?.usage, toolCalls), status: validContract ? "succeeded" : "partial" };
}

// ── X following ∩ mentions (deterministic) ─────────────────────────────────
async function twJson(url: string, key: string, counter?: CallCounter): Promise<any> {
  if (counter) counter.calls += 1;
  try {
    const r = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const data = await r.json();
    if (counter) counter.succeeded += 1;
    return data;
  } catch { return null; }
}
// Chains/infra/tools every project follows + tags — not team, so filter them out.
const TW_DENY = new Set(["solana", "ethereum", "bitcoin", "base", "arbitrum", "optimism", "polygon", "bnbchain", "avax", "avalancheavax", "pumpdotfun", "dexscreener", "dextools", "coingecko", "coinmarketcap", "jupiterexchange", "raydiumprotocol", "binance", "coinbase", "uniswap", "tether_to", "circle"]);
async function followsAndTags(handle: string, key: string, counter?: CallCounter): Promise<any[]> {
  const u = handle.replace(/^@/, "");
  const postsD = await twJson(`${TW}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key, counter);
  const rawTweets = postsD?.data?.tweets ?? postsD?.tweets;
  const tweets: any[] = Array.isArray(rawTweets) ? rawTweets : [];
  const mentions = new Set<string>();
  for (const t of tweets) for (const mm of String(t.text ?? "").matchAll(/@([A-Za-z0-9_]{2,30})/g)) mentions.add(mm[1].toLowerCase());
  mentions.delete(u.toLowerCase());
  TW_DENY.forEach((d) => mentions.delete(d));
  if (!mentions.size) return [];
  const follows = new Map<string, any>();
  let cursor = "";
  for (let p = 0; p < 4; p++) {
    const d = await twJson(`${TW}/twitter/user/followings?userName=${encodeURIComponent(u)}&pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, key, counter);
    const list: any[] = d?.followings ?? d?.data?.followings ?? (Array.isArray(d?.data) ? d.data : []);
    if (!list?.length) break;
    for (const f of list) { const un = String(f.userName ?? f.screen_name ?? ""); if (un) follows.set(un.toLowerCase(), f); }
    if (!d?.has_next_page || !d?.next_cursor) break;
    cursor = d.next_cursor;
  }
  const out: any[] = [];
  for (const lk of mentions) {
    if (TW_DENY.has(lk)) continue;
    const f = follows.get(lk);
    // a chain/infra account usually has a huge following; people-team don't.
    if (f && Number(f.followers_count ?? f.followers ?? 0) < 2_000_000) {
      out.push({ name: f.name || "@" + (f.userName ?? lk), handle: "@" + (f.userName ?? lk), role: "follows + tags", evidence: "the project both follows and tags this account" });
    }
  }
  return out;
}

const DEVELOPER_ROLE = /\b(?:founder|co-?founder|cto|chief technology officer|lead (?:dev|developer|engineer)|engineering lead)\b/i;

export function profileDeveloperLinks(profile: any, handle: string): Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }> {
  const candidates = [
    profile?.url,
    profile?.website,
    profile?.link,
    profile?.profile_url,
    profile?.profile_bio?.entities?.url?.urls?.[0]?.expanded_url,
    ...(Array.isArray(profile?.profile_bio?.entities?.description?.urls)
      ? profile.profile_bio.entities.description.urls.map((entry: any) => entry?.expanded_url)
      : []),
    ...(Array.isArray(profile?.entities?.description?.urls)
      ? profile.entities.description.urls.map((entry: any) => entry?.expanded_url)
      : []),
    ...String(profile?.description ?? "").matchAll(/https?:\/\/(?:www\.)?(?:github\.com|huggingface\.co)\/[A-Za-z0-9_.-]+/gi),
  ].flatMap((value) => typeof value === "string" ? [value] : Array.isArray(value) ? [value[0]] : []);
  const sourceUrl = `https://x.com/${handle.replace(/^@/, "")}`;
  const out = new Map<string, { provider: "github" | "huggingface"; url: string; sourceUrl: string }>();
  for (const candidate of candidates) {
    const match = String(candidate).match(/https?:\/\/(?:www\.)?(github\.com|huggingface\.co)\/([A-Za-z0-9_.-]+)/i);
    if (!match) continue;
    const provider = match[1].toLowerCase() === "github.com" ? "github" : "huggingface";
    const url = `https://${match[1].toLowerCase()}/${match[2]}`;
    out.set(`${provider}:${match[2].toLowerCase()}`, { provider, url, sourceUrl });
  }
  return [...out.values()].slice(0, 3);
}

async function developerLinksFromX(handle: string, key: string, counter: CallCounter) {
  const user = handle.replace(/^@/, "");
  const payload = await twJson(`${TW}/twitter/user/info?userName=${encodeURIComponent(user)}`, key, counter);
  const profile = payload?.data ?? payload;
  return profileDeveloperLinks(profile, user);
}

// ── GitHub org (deterministic) ─────────────────────────────────────────────
async function ghJson(path: string, key: string, counter?: CallCounter): Promise<any> {
  if (counter) counter.calls += 1;
  try {
    const r = await fetch(GH + path, { headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    if (counter) counter.succeeded += 1;
    return data;
  } catch { return null; }
}
async function githubOrgTeam(org: string, key: string, counter?: CallCounter): Promise<any[]> {
  const o = org.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "");
  if (!o) return [];
  const logins = new Set<string>();
  const members = await ghJson(`/orgs/${encodeURIComponent(o)}/public_members?per_page=20`, key, counter);
  for (const m of Array.isArray(members) ? members : []) if (m.login) logins.add(m.login);
  const repos = await ghJson(`/orgs/${encodeURIComponent(o)}/repos?sort=pushed&per_page=4`, key, counter);
  for (const repo of (Array.isArray(repos) ? repos : []).slice(0, 3)) {
    const contributors = await ghJson(`/repos/${o}/${repo.name}/contributors?per_page=10`, key, counter);
    for (const c of Array.isArray(contributors) ? contributors : []) if (c.login && c.type === "User") logins.add(c.login);
  }
  const out: any[] = [];
  for (const login of [...logins].slice(0, 12)) {
    const usr = await ghJson(`/users/${encodeURIComponent(login)}`, key, counter);
    if (!usr) continue;
    out.push({ name: usr.name || login, handle: usr.twitter_username && HANDLE.test(usr.twitter_username) ? "@" + usr.twitter_username : undefined, role: "github contributor", evidence: `GitHub: github.com/${o} (${login})` });
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const panelAuth = await requireArgusAuth(req, res, "analyst");
  if (!panelAuth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(panelAuth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({
      error: panelToken ? "invalid_panel_context" : "panel_context_required",
      message: "Persist a fresh report before running paid deep-team discovery.",
    });
    return;
  }
  const xaiKey = process.env.XAI_API_KEY;
  const twKey = process.env.TWITTERAPI_KEY;
  const ghKey = process.env.GITHUB_TOKEN;
  const domain = q(req.query.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const name = q(req.query.name);
  const title = q(req.query.title);
  const x = q(req.query.x).replace(/^@/, "");
  const gh = q(req.query.gh);
  const siteNames = q(req.query.names).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!domain && !name && !x && !gh) { res.status(400).json({ error: "domain, name, x or gh required" }); return; }

  const proj = name || domain || `@${x}`;
  const webSystem =
    "You are a forensic OSINT researcher with live web and X search. Find EVERY person behind a crypto/tech project: founders, cofounders, core team, engineers, AND advisors/backers. " +
    "DIG hard: Google, the project's LinkedIn company page and its listed employees, Crunchbase, the GitHub org and its contributors, press/interviews, podcasts, and X. Connect any names already found on the site to their X handle and LinkedIn. " +
    "Be EXHAUSTIVE: list everyone you can attribute with public evidence, not just the top one or two. ONLY real people tied to THIS specific project (match domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"\",\"evidence\":\"\"}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const webUser = `Project: ${proj}${domain ? ` (website ${domain})` : ""}.${title ? ` Site title: "${title}".` : ""}${x ? ` Official X account: @${x}.` : ""}${siteNames.length ? ` Names already on the site: ${siteNames.join(", ")}.` : ""} Find every founder, team member, and advisor; connect each to their X handle and LinkedIn.`;
  const xSystem =
    "You are a forensic researcher with live X search. Mine the given project's OWN X account and posts mentioning it for EVERY team member and advisor it names. " +
    "Read its own posts (team intros, role announcements like 'welcome @y as our CTO', 'our founder @z', cofounder mentions, 'advised by @w'), pinned and OLDER posts, and posts that tag the team. Be EXHAUSTIVE. EXCLUDE the project account and hype repliers. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"\",\"evidence\":\"\"}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const xUser = `Project X account: @${x}${name ? ` (${name})` : ""}. List every founder, team member, and advisor named in its posts or in posts tagging it. Search older posts too.`;

  const angles: Promise<TeamAngle>[] = [];
  if (xaiKey) {
    angles.push(grokPeople(xaiKey, webSystem, webUser));
    if (x && HANDLE.test(x)) angles.push(grokPeople(xaiKey, xSystem, xUser));
  }
  if (twKey && x && HANDLE.test(x)) {
    const counter = { calls: 0, succeeded: 0 };
    angles.push(followsAndTags(x, twKey, counter)
      .then((people): TeamAngle => ({ people, provider: "twitterapi", calls: counter.calls, usd: counter.calls * 0.0002, status: counterStatus(counter) }))
      .catch((): TeamAngle => ({ people: [], provider: "twitterapi", calls: counter.calls, usd: counter.calls * 0.0002, status: counter.succeeded > 0 ? "partial" : "failed" })));
  }
  if (ghKey && gh) {
    const counter = { calls: 0, succeeded: 0 };
    angles.push(githubOrgTeam(gh, ghKey, counter)
      .then((people): TeamAngle => ({ people, provider: "github", calls: counter.calls, usd: 0, status: counterStatus(counter) }))
      .catch((): TeamAngle => ({ people: [], provider: "github", calls: counter.calls, usd: 0, status: counter.succeeded > 0 ? "partial" : "failed" })));
  }
  if (!angles.length) { res.status(200).json({ available: false, people: [] }); return; }

  try {
    const results = await Promise.all(angles);
    const providerTotals = new Map<string, { calls: number; usd: number; statuses: TeamAngle["status"][] }>();
    for (const angle of results) {
      const current = providerTotals.get(angle.provider) ?? { calls: 0, usd: 0, statuses: [] };
      current.calls += angle.calls;
      current.usd += angle.usd;
      current.statuses.push(angle.status);
      providerTotals.set(angle.provider, current);
    }
    await Promise.all([...providerTotals].filter(([, total]) => total.calls > 0).map(([provider, total]) => attachPanelCost(
      panelAuth.organizationId,
      panelCostVersionId,
      {
        provider,
        op: "panel:recon-team",
        calls: total.calls,
        usd: total.usd,
        initiatedBy: panelAuth.userId,
        status: total.statuses.every((status) => status === "succeeded")
          ? "succeeded"
          : total.statuses.every((status) => status === "failed")
            ? "failed"
            : "partial",
      },
    )));

    const self = new Set([domain.toLowerCase(), x.toLowerCase()].filter(Boolean));
    const byKey = new Map<string, any>();
    for (const { people: arr } of results) {
      for (const p of arr) {
        if (!p || typeof p.name !== "string" || !p.name.trim()) continue;
        const handle = p.handle && HANDLE.test(p.handle) ? "@" + p.handle.replace(/^@/, "") : undefined;
        const linkedin = typeof p.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined;
        const cleaned = { name: p.name.trim(), handle, linkedin, role: (p.role || "team").toString(), evidence: typeof p.evidence === "string" ? p.evidence : undefined };
        if (!cleaned.handle && !cleaned.linkedin && !cleaned.evidence) continue;
        const hk = handle ? handle.replace(/^@/, "").toLowerCase() : "";
        if (hk && self.has(hk)) continue;
        const k = hk || cleaned.name.toLowerCase();
        const ex = byKey.get(k);
        if (ex) {
          ex.handle = ex.handle ?? cleaned.handle;
          ex.linkedin = ex.linkedin ?? cleaned.linkedin;
          if (!ex.evidence || (cleaned.evidence && cleaned.evidence.length > ex.evidence.length)) ex.evidence = cleaned.evidence ?? ex.evidence;
        } else {
          byKey.set(k, cleaned);
        }
      }
    }
    // If the project has no official GitHub, inspect the personal X profiles of
    // its technical leaders for links they published themselves. This is a
    // direct identity bridge, never a name search.
    if (!gh && twKey) {
      const developerProfileCounter: CallCounter = { calls: 0, succeeded: 0 };
      const eligible = [...byKey.values()]
        .filter((person) => person.handle && DEVELOPER_ROLE.test(String(person.role ?? "")))
        .slice(0, 5);
      await Promise.all(eligible.map(async (person) => {
        const profiles = await developerLinksFromX(person.handle, twKey, developerProfileCounter);
        if (profiles.length) person.developerProfiles = profiles;
      }));
      if (developerProfileCounter.calls > 0) {
        await attachPanelCost(panelAuth.organizationId, panelCostVersionId, {
          provider: "twitterapi",
          op: "panel:recon-team-developer-links",
          calls: developerProfileCounter.calls,
          usd: developerProfileCounter.calls * 0.0002,
          initiatedBy: panelAuth.userId,
          status: counterStatus(developerProfileCounter),
        });
      }
    }
    res.status(200).json({ available: true, people: [...byKey.values()].slice(0, 20) });
  } catch (e) {
    res.status(200).json({ available: true, people: [], error: String(e) });
  }
}
