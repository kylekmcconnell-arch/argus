// Find and break down a project's official X account.
// GET /api/x-find?name=<project>&domain=<host>&handle=<optional seed>
//
// Recon often has a project name + website but no linked X account (JS-rendered
// sites hide it). This searches X for the official account, resolves its profile,
// and CROSS-CHECKS the match (does the account's own website link back to the
// project's domain? does the name align?) so we return a match with a confidence,
// not a guess. Grok (search) + twitterapi.io (profile). 24h-cached.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 30 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const HANDLE = /^@?[A-Za-z0-9_]{2,30}$/;
const bare = (h: string) => h.replace(/^@/, "");
const num = (...v: any[]) => { for (const x of v) if (typeof x === "number") return x; return undefined; };

// Grok: the official X handle for a named project.
async function findHandle(name: string, domain: string, key: string): Promise<string | null> {
  const system =
    "You identify the ONE official X (Twitter) account for a crypto/tech project, using live web + X search. " +
    "Return the account the project itself operates (matches its name + website), NOT a fan, a founder's personal account, or an impersonator. " +
    "Reply with ONLY compact JSON: {\"handle\":\"@...\"} — or {\"handle\":null} if you cannot confidently identify it. Never invent.";
  const user = `Project: "${name}"${domain ? ` (website ${domain})` : ""}. What is its official X account handle?`;
  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ARGUS_GROK_MODEL || "grok-4-fast", input: [{ role: "system", content: system }, { role: "user", content: user }], tools: [{ type: "web_search" }, { type: "x_search" }], max_tool_calls: 4 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const text = d.output_text ?? (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ?? "";
    const h = text.match(/\{[\s\S]*\}/) ? JSON.parse(text.match(/\{[\s\S]*\}/)[0]).handle : null;
    return typeof h === "string" && HANDLE.test(h) ? bare(h) : null;
  } catch { return null; }
}

// twitterapi.io profile.
async function profile(handle: string, key: string): Promise<any | null> {
  try {
    const r = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(handle)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const p = d?.data ?? d;
    if (!p || (p.name == null && p.followers == null && p.followers_count == null && p.description == null)) return null;
    const website = p?.profile_bio?.entities?.url?.urls?.[0]?.expanded_url ?? p?.entities?.url?.urls?.[0]?.expanded_url ?? p?.url ?? null;
    return {
      handle: "@" + bare(handle),
      name: p.name ?? null,
      bio: p.description ?? p.bio ?? null,
      followers: num(p.followers, p.followers_count, p.followersCount) ?? null,
      following: num(p.following, p.following_count, p.followingCount) ?? null,
      tweets: num(p.statusesCount, p.statuses_count, p.tweetsCount) ?? null,
      created: p.createdAt ?? p.created_at ?? null,
      verified: !!(p.isBlueVerified ?? p.blue_verified ?? p.verified ?? p.isVerified),
      website: typeof website === "string" ? website : null,
      avatar: p.profilePicture ?? p.profile_image_url_https ?? null,
    };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = q(req.query.name);
  const domain = q(req.query.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  const seed = q(req.query.handle);
  if (!name && !seed) { res.status(400).json({ error: "name or handle required" }); return; }

  const cacheKey = `xfind:${(name || seed).toLowerCase()}:${domain}`;
  const cached = await cacheGetJson<any>(cacheKey);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const twKey = process.env.TWITTERAPI_KEY;
  const xaiKey = process.env.XAI_API_KEY;

  // A seed handle (from the page) is resolved directly; otherwise search for it.
  let handle = seed && HANDLE.test(seed) ? bare(seed) : null;
  if (!handle && name && xaiKey) handle = await findHandle(name, domain, xaiKey);
  if (!handle) { res.status(200).json({ available: true, found: false, note: "No official X account could be identified." }); return; }
  if (!twKey) { res.status(200).json({ available: true, found: true, handle: "@" + handle, note: "twitterapi not configured for profile detail." }); return; }

  const p = await profile(handle, twKey);
  if (!p) { res.status(200).json({ available: true, found: true, handle: "@" + handle, note: "Account named but profile could not be resolved." }); return; }

  // Confidence: the account's own linked website matching the project's domain is
  // the strongest possible signal it's genuinely theirs.
  const siteMatches = !!(domain && p.website && p.website.toLowerCase().includes(domain));
  const nameMatches = !!(name && p.name && (p.name.toLowerCase().includes(name.toLowerCase().split(/\s+/)[0]) || name.toLowerCase().includes((p.name || "").toLowerCase().split(/\s+/)[0])));
  const confidence = siteMatches ? "high" : seed ? "high" : nameMatches ? "medium" : "low";
  const matchReason = siteMatches ? `the account's own website links to ${domain}` : seed ? "the handle was found on the project's own site" : nameMatches ? "the account name aligns with the project" : "identified by search, not independently confirmed";

  const out = { available: true, found: true, confidence, matchReason, siteMatches, ...p };
  await cacheSetJson(cacheKey, out);
  res.status(200).json(out);
}
