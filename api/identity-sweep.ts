// Past-identity sweep. GET /api/identity-sweep?handle=<x_handle>
//
// An "anonymous" founder is rarely anonymous across time and platforms. Two
// deterministic angles an investigator would piece together by hand:
//   1. HANDLE HISTORY (memory.lol): the X handles this account used BEFORE its
//      current one. A rebrand hides a past — old claims, abandoned projects.
//   2. CROSS-PLATFORM REUSE: the same username on GitHub / Farcaster / Reddit /
//      Telegram. People reuse handles; a match ties the pseudonym to a real,
//      dated footprint (account age, bio, karma) elsewhere.
// Plus best-effort archived bios for prior handles (what they claimed to be).
//
// Mostly keyless (memory.lol, Farcaster, Reddit, Telegram, Wayback); GITHUB_TOKEN
// only raises the GitHub rate limit. Read-only.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 30 };

const UA = "argus-osint/1.0 (+due-diligence)";
const HANDLE = /^[A-Za-z0-9_]{2,30}$/;
type ProviderUsage = Record<string, { calls: number; succeeded: number }>;

async function getJson(url: string, usage: ProviderUsage, provider: string, headers?: Record<string, string>, ms = 8000): Promise<any> {
  const counter = usage[provider] ?? (usage[provider] = { calls: 0, succeeded: 0 });
  counter.calls += 1;
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...(headers ?? {}) }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const data = await r.json();
    counter.succeeded += 1;
    return data;
  } catch {
    return null;
  }
}
async function getText(url: string, usage: ProviderUsage, provider: string, ms = 7000): Promise<string | null> {
  const counter = usage[provider] ?? (usage[provider] = { calls: 0, succeeded: 0 });
  counter.calls += 1;
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const data = await r.text();
    counter.succeeded += 1;
    return data;
  } catch {
    return null;
  }
}

// memory.lol: every X handle this account has used, oldest date seen.
async function handleHistory(handle: string, usage: ProviderUsage): Promise<{ prior: string[]; firstSeen: string | null }> {
  const d = await getJson(`https://api.memory.lol/v1/tw/${encodeURIComponent(handle)}`, usage, "memory.lol");
  const acct = d?.accounts?.[0];
  if (!acct?.screen_names) return { prior: [], firstSeen: null };
  const cur = handle.toLowerCase();
  const prior: string[] = [];
  let firstSeen: string | null = null;
  for (const [name, dates] of Object.entries(acct.screen_names as Record<string, string[]>)) {
    if (name.toLowerCase() !== cur) prior.push(name);
    const earliest = Array.isArray(dates) ? dates.filter(Boolean).sort()[0] : null;
    if (earliest && (!firstSeen || earliest < firstSeen)) firstSeen = earliest;
  }
  return { prior, firstSeen };
}

type Hit = { platform: string; username: string; url: string; detail: string };

async function github(u: string, key: string | undefined, usage: ProviderUsage): Promise<Hit | null> {
  const d = await getJson(`https://api.github.com/users/${encodeURIComponent(u)}`, usage, "github", key ? { authorization: `Bearer ${key}`, accept: "application/vnd.github+json" } : undefined);
  if (!d?.login) return null;
  const bits = [d.name || d.login, d.bio, `${d.public_repos ?? 0} repos`, d.created_at ? `since ${d.created_at.slice(0, 4)}` : ""].filter(Boolean);
  return { platform: "GitHub", username: u, url: `https://github.com/${d.login}`, detail: bits.join(" · ") };
}
async function farcaster(u: string, usage: ProviderUsage): Promise<Hit | null> {
  const d = await getJson(`https://api.warpcast.com/v2/user-by-username?username=${encodeURIComponent(u)}`, usage, "warpcast");
  const user = d?.result?.user;
  if (!user?.fid) return null;
  const bits = [user.displayName || u, user.profile?.bio?.text, `fid ${user.fid}`, user.followerCount != null ? `${user.followerCount} followers` : ""].filter(Boolean);
  return { platform: "Farcaster", username: u, url: `https://warpcast.com/${u}`, detail: bits.join(" · ") };
}
async function reddit(u: string, usage: ProviderUsage): Promise<Hit | null> {
  const d = await getJson(`https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`, usage, "reddit");
  const data = d?.data;
  if (!data?.name || data.is_suspended) return null;
  const yr = data.created_utc ? new Date(data.created_utc * 1000).toISOString().slice(0, 4) : "";
  const karma = data.total_karma ?? ((data.link_karma ?? 0) + (data.comment_karma ?? 0));
  return { platform: "Reddit", username: u, url: `https://reddit.com/user/${u}`, detail: [`u/${data.name}`, `${karma} karma`, yr ? `since ${yr}` : ""].filter(Boolean).join(" · ") };
}
async function telegram(u: string, usage: ProviderUsage): Promise<Hit | null> {
  const html = await getText(`https://t.me/${encodeURIComponent(u)}`, usage, "telegram");
  if (!html) return null;
  const title = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1]?.trim();
  // t.me returns a generic "Telegram" page for a non-existent username.
  if (!title || /^telegram$/i.test(title)) return null;
  const desc = html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1]?.trim();
  return { platform: "Telegram", username: u, url: `https://t.me/${u}`, detail: [title, desc && desc.length < 120 ? desc : ""].filter(Boolean).join(" · ") };
}

async function footprintFor(u: string, key: string | undefined, usage: ProviderUsage): Promise<Hit[]> {
  const [g, f, r, t] = await Promise.all([github(u, key, usage), farcaster(u, usage), reddit(u, usage), telegram(u, usage)]);
  return [g, f, r, t].filter(Boolean) as Hit[];
}

// Best-effort archived X bio for a (usually prior) handle: the identity's old
// self-description, straight from an archived profile page.
async function archivedBio(handle: string, usage: ProviderUsage): Promise<{ handle: string; year: string; bio: string } | null> {
  const avail = await getJson(`https://archive.org/wayback/available?url=twitter.com/${encodeURIComponent(handle)}`, usage, "wayback");
  const snap = avail?.archived_snapshots?.closest;
  if (!snap?.available || !snap.timestamp) return null;
  const html = await getText(`https://web.archive.org/web/${snap.timestamp}id_/https://twitter.com/${handle}`, usage, "wayback");
  if (!html) return null;
  const bio = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (!bio || bio.length < 8) return null;
  return { handle, year: snap.timestamp.slice(0, 4), bio: bio.replace(/\s+/g, " ").trim().slice(0, 220) };
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

  const handle = (typeof req.query.handle === "string" ? req.query.handle : "").replace(/^@/, "").trim();
  if (!handle || !HANDLE.test(handle)) { res.status(400).json({ error: "an X handle is required" }); return; }
  const key = process.env.GITHUB_TOKEN;

  const usage: ProviderUsage = {};
  try {
    const { prior, firstSeen } = await handleHistory(handle, usage);
    // Usernames to correlate: current + prior handles (deduped, capped).
    const usernames = [...new Set([handle, ...prior].map((h) => h.toLowerCase()))].filter((u) => HANDLE.test(u)).slice(0, 5);

    const [footprints, priorBios] = await Promise.all([
      Promise.all(usernames.map((u) => footprintFor(u, key, usage).then((hits) => ({ username: u, hits })))),
      Promise.all(prior.slice(0, 3).map((h) => archivedBio(h, usage))),
    ]);

    const footprint = footprints.flatMap((f) => f.hits);
    const bios = priorBios.filter(Boolean) as { handle: string; year: string; bio: string }[];
    const platforms = [...new Set(footprint.map((h) => h.platform))];

    const bits: string[] = [];
    if (prior.length) bits.push(`Previously went by ${prior.map((p) => "@" + p).join(", ")} — a rebrand${firstSeen ? ` (account seen since ${firstSeen.slice(0, 4)})` : ""}.`);
    if (platforms.length) bits.push(`Same username exists on ${platforms.join(", ")} — a cross-platform lead. Check the details: strong for an obscure pseudonym, but on well-known handles these can be squatters or impersonators.`);
    if (bios.length) bits.push(`Recovered ${bios.length} archived bio(s) from prior handle(s).`);
    const note = bits.length ? bits.join(" ") : "No prior X handles (no rebrand on memory.lol) and no same-username accounts found on GitHub / Farcaster / Reddit / Telegram.";

    res.status(200).json({
      handle,
      available: true,
      priorHandles: prior,
      firstSeen: firstSeen ? firstSeen.slice(0, 10) : null,
      footprint,
      platforms,
      archivedBios: bios,
      note,
    });
  } catch (e) {
    res.status(200).json({ handle, available: true, error: String(e), note: "Identity sweep failed." });
  } finally {
    await Promise.all(Object.entries(usage)
      .filter(([, counter]) => counter.calls > 0)
      .map(([provider, counter]) => attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider,
        op: "panel:identity-sweep",
        calls: counter.calls,
        usd: 0,
        meta: provider === "github" ? "subscription/keyed" : "keyless",
        initiatedBy: auth.userId,
        status: counter.succeeded === counter.calls ? "succeeded" : counter.succeeded > 0 ? "partial" : "failed",
      })));
  }
}
