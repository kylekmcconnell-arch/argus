// X adapter — the signature data path, split into two layers per our provider
// review:
//   - twitterapi.io (TWITTERAPI_KEY): profile + the follow graph. The official
//     X API gates follower/following behind ~$42k/mo Enterprise, so the cheap
//     follow-check lives here and is isolated as the one gray-area dependency.
//   - Grok / xAI (XAI_API_KEY): real-time X *content* via Live Search, for the
//     acknowledgment half of testimonial corroboration (did @endorser ever
//     mention/reply/thank @subject) and recent-activity sentiment.

import type { Adapter, CollectContext } from "./types";
import { env } from "../config";
import { TestimonialVerdict, classifyTestimonial } from "../../src/engine";
import type { NotableFollower } from "../../src/data/evidence";

const TWITTERAPI = "https://api.twitterapi.io";

// Grok search via the current Responses API + tools (the legacy search_parameters
// Live Search API was retired -> 410 Gone). Returns the model's text, or null.
export async function grokSearch(system: string, user: string): Promise<string | null> {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  try {
    // The agentic web+X search can loop for a while; bound it so a slow call
    // can't stall the whole streaming audit (the function has a hard duration cap).
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const text =
      d.output_text ??
      (Array.isArray(d.output)
        ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ")
        : "") ??
      "";
    return text || null;
  } catch {
    return null;
  }
}

// twitterapi.io throttles hard (429) under bursty use, and occasionally 502/503.
// Retry transient statuses with exponential backoff; return the last response so
// the caller can still inspect a terminal error.
async function twFetch(url: string, key: string, tries = 2): Promise<Response | null> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "x-api-key": key } });
    last = res;
    if (res.status !== 429 && res.status !== 502 && res.status !== 503) return res;
    // Short backoff: a full 5s wait per 429 (free-tier QPS) balloons the whole
    // audit past its budget when many calls are made, so we keep this fast and
    // accept that a busy free-tier audit drops some calls. The real fix is a paid
    // tier (no QPS cap); see notableFollowers for the single-call accommodation.
    await new Promise((r) => setTimeout(r, res.status === 429 ? 1200 : 700 * (i + 1)));
  }
  return last;
}

// ── twitterapi.io: profile ───────────────────────────────────────────────
export interface XProfile {
  handle: string;
  name?: string;
  bio?: string;
  followers?: number;
  createdAt?: string;
}

export async function getProfile(handle: string): Promise<XProfile | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const u = handle.replace(/^@/, "");
  const url = `${TWITTERAPI}/twitter/user/info?userName=${encodeURIComponent(u)}`;
  // twitterapi.io returns HTTP 200 even on failure ({status:"error", data:null}),
  // and a COLD lookup of a less-trafficked account sometimes returns "not found"
  // once, then resolves once they fetch it. Retry the error envelope once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await twFetch(url, key);
      if (!res || !res.ok) return null;
      const d = (await res.json()) as any;
      if (d?.status === "error" || d?.data === null) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        return null;
      }
      const p = d.data ?? d;
      if (!p || (p.name == null && p.followers == null && p.followers_count == null && p.description == null)) return null;
      return {
        handle: "@" + u,
        name: p.name,
        bio: p.description,
        followers: p.followers ?? p.followers_count,
        createdAt: p.createdAt ?? p.created_at,
      };
    } catch {
      return null;
    }
  }
  return null;
}

// Handle-change history via memory.lol (keyless OSINT index that maps an X
// account id to every screen name it has used, with date ranges). A rebrand is a
// classic move to escape a burned reputation, and X keeps the same id across
// handle changes, so the old names are recoverable. Coverage is partial: an empty
// result means "not in the index", never a guarantee of no change.
export async function handleHistory(handle: string): Promise<{ priorHandles: string[]; idStr?: string } | null> {
  const u = handle.replace(/^@/, "");
  try {
    const res = await fetch(`https://api.memory.lol/v1/tw/${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const acct = (d.accounts ?? [])[0];
    if (!acct?.screen_names) return { priorHandles: [], idStr: acct?.id_str };
    const names = Object.keys(acct.screen_names);
    const prior = names.filter((n) => n.toLowerCase() !== u.toLowerCase());
    return { priorHandles: prior, idStr: acct.id_str };
  } catch {
    return null;
  }
}

// twitterapi.io: recent posts, fuel for claim extraction + activity signal.
export async function getRecentPosts(handle: string, limit = 20): Promise<string[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return [];
    const d = (await res.json()) as any;
    // twitterapi.io nests the array under data.tweets; tolerate the flatter shapes too.
    const tweets: any[] = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    return tweets
      .map((t) => t.text ?? t.full_text ?? "")
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// twitterapi.io: does `endorser` follow `subject`?  Best-effort: scan the
// endorser's followings for the subject. Returns null if unknown.
export async function followsSubject(endorser: string, subject: string): Promise<boolean | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const e = endorser.replace(/^@/, "");
  const s = subject.replace(/^@/, "").toLowerCase();
  try {
    const res = await fetch(`${TWITTERAPI}/twitter/user/followings?userName=${encodeURIComponent(e)}&pageSize=200`, {
      headers: { "x-api-key": key },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const list: any[] = d.followings ?? d.data ?? [];
    return list.some((u) => (u.userName ?? u.screen_name ?? "").toLowerCase() === s);
  } catch {
    return null;
  }
}

// ── Follower QUALITY: do respected accounts follow the subject? ──────────
// Follower count is trivially botted; follower IDENTITY is not. Being followed
// by known callers, founders, funds and infra is a real credibility signal a
// scam can't fake, and its absence on a high-count account is itself telling.
// twitterapi's check_follow_relationship answers "does A follow B" in one call,
// so we check a curated high-signal set against the subject — accurate at any
// account size (scanning a big account's followers would miss early followers).

// Curated, deliberately small, high-signal set. Labels/sizes are for context and
// may drift; the point is WHO. Grow this list as the trust graph matures.
const NOTABLE: NotableFollower[] = [
  { handle: "cobie", label: "trader", size: "700K" },
  { handle: "CryptoKaleo", label: "caller", size: "700K" },
  { handle: "blknoiz06", label: "caller", size: "750K" },
  { handle: "inversebrah", label: "KOL", size: "300K" },
  { handle: "CryptoCred", label: "trader", size: "400K" },
  { handle: "HsakaTrades", label: "trader", size: "450K" },
  { handle: "notthreadguy", label: "KOL", size: "250K" },
  { handle: "theunipcs", label: "caller", size: "250K" },
  { handle: "CryptoGodJohn", label: "caller", size: "400K" },
  { handle: "frankdegods", label: "founder/KOL", size: "350K" },
  { handle: "0xMert_", label: "infra (Helius)", size: "250K" },
  { handle: "aeyakovenko", label: "founder (Solana)", size: "470K" },
  { handle: "rajgokal", label: "founder (Solana)", size: "250K" },
  { handle: "VitalikButerin", label: "founder (Ethereum)", size: "5.6M" },
  { handle: "jessepollak", label: "founder (Base)", size: "350K" },
  { handle: "haydenzadams", label: "founder (Uniswap)", size: "300K" },
  { handle: "StaniKulechov", label: "founder (Aave)", size: "270K" },
  { handle: "cz_binance", label: "founder (Binance)", size: "9M" },
  { handle: "cdixon", label: "investor (a16z)", size: "900K" },
  { handle: "balajis", label: "investor", size: "1M" },
  { handle: "punk6529", label: "investor", size: "500K" },
  { handle: "solana", label: "infra (Solana)", size: "3M" },
  { handle: "pumpdotfun", label: "infra (Pump.fun)", size: "600K" },
  { handle: "base", label: "infra (Base)", size: "1.5M" },
];

// Does `source` follow `target`? One call via check_follow_relationship.
export async function checkFollow(source: string, target: string): Promise<{ following: boolean; followedBy: boolean } | null> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const s = source.replace(/^@/, "");
  const t = target.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/check_follow_relationship?source_user_name=${encodeURIComponent(s)}&target_user_name=${encodeURIComponent(t)}`, key);
    if (!res || !res.ok) return null;
    const d = (await res.json()) as any;
    if (d?.status === "error" || !d?.data) return null;
    return { following: !!d.data.following, followedBy: !!d.data.followed_by };
  } catch {
    return null;
  }
}

// Follower QUALITY, surfaced two ways from a scan of the subject's followers:
//   1. curated accounts (known callers/founders/funds) that follow them, and
//   2. HIGH-REACH accounts — anyone with a large audience of their own, even if
//      not on the curated list ("2 accounts with >1M followers follow them").
// Each follower object carries followers_count, so we bucket by reach and sort by
// it. Now that the QPS cap is lifted (paid credits) we scan several pages; results
// are the highest-reach + curated followers among them.
const HIGH_REACH = 100_000;

export async function notableFollowers(subject: string): Promise<NotableFollower[]> {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const u = subject.replace(/^@/, "");
  const curated = new Map(NOTABLE.map((n) => [n.handle.toLowerCase(), n]));
  const found = new Map<string, NotableFollower>();
  let cursor = "";
  const MAX_PAGES = 8; // ~1600 most-recent followers

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${TWITTERAPI}/twitter/user/followers?userName=${encodeURIComponent(u)}&pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await twFetch(url, key);
    if (!res || !res.ok) break;
    const d = (await res.json()) as any;
    if (d?.status === "error") break;
    const followers: any[] = d.followers ?? d.data?.followers ?? [];
    if (!followers.length) break;
    for (const f of followers) {
      const h = String(f.userName ?? f.screen_name ?? "");
      if (!h) continue;
      const lk = h.toLowerCase();
      if (found.has(lk)) continue;
      const fc = Number(f.followers_count ?? f.followers ?? 0);
      const cur = curated.get(lk);
      if (cur) {
        found.set(lk, { handle: h, label: cur.label, size: fc ? fmtFollowers(fc) : cur.size, count: fc || undefined });
      } else if (fc >= HIGH_REACH) {
        found.set(lk, { handle: h, label: "high reach", size: fmtFollowers(fc), count: fc });
      }
    }
    if (!d.has_next_page || !d.next_cursor) break;
    cursor = d.next_cursor;
  }
  // Biggest audiences first; cap the list.
  return [...found.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 16);
}

// ── Grok Live Search: did endorser publicly acknowledge subject? ─────────
export async function acknowledgment(endorser: string, subject: string): Promise<{
  ack: "none" | "mention" | "thanks" | "endorsement";
  sentiment: "positive" | "neutral" | "negative" | "none";
} | null> {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  const e = endorser.replace(/^@/, "");
  const s = subject.replace(/^@/, "");
  const system =
    "You verify endorsements for a due-diligence engine, with live web and X search. Decide the strongest public acknowledgment @" +
    e + " has ever made of @" + s + " on X, and overall sentiment. Reply with ONLY a compact JSON object " +
    '{"ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none"}.';
  const text = await grokSearch(system, `Has @${e} ever publicly acknowledged @${s} on X? Search @${e}'s posts.`);
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return { ack: parsed.ack ?? "none", sentiment: parsed.sentiment ?? "none" };
  } catch {
    return null;
  }
}

// ── Grok identity discovery: every venture/affiliation the subject is publicly
//    tied to, not just the ones they founded. Many people's real history lives
//    OFF their X and OFF their LinkedIn (early-employee/contributor roles, press,
//    accelerator pages, GitHub). A founder-only grammar misses all of it, so we
//    ask for the full affiliation set: founded, led, worked at, contributed to,
//    or otherwise publicly tied. Strictly grounded: only ties with a real, cited
//    source, never guesses. We also capture the venture's own X handle + domain
//    so the orchestrator can corroborate the tie (follow-graph, archived team page).
export interface DiscoveredAffiliation {
  name: string;
  role: string;          // founder | cofounder | exec | employee | engineer | contributor | advisor | affiliate
  year?: string;
  evidence?: string;     // one short source phrase
  x_handle?: string;     // the VENTURE's X account, if found (e.g. @deksxyz)
  domain?: string;       // the venture's website host, if found (e.g. deks.xyz)
}

export async function discoverAffiliations(handle: string, name?: string): Promise<DiscoveredAffiliation[]> {
  const h = handle.replace(/^@/, "");
  const system =
    "You are a forensic due-diligence researcher with live web and X search. Find EVERY company, crypto project, fund, DAO, or venture that THIS SPECIFIC person (the holder of the given X account) is publicly tied to in ANY working capacity: founded, co-founded, led, was an early employee of, worked at, contributed to, was a core team member of, or advised. " +
    "Look beyond their own bio and LinkedIn: accelerator/portfolio pages, press, team pages, GitHub orgs, podcasts, Crunchbase. There MUST be public evidence tying THAT EXACT person to the venture. " +
    "For each, also report the venture's own X handle and website domain if you can find them. " +
    "Reply with ONLY compact JSON: {\"affiliations\":[{\"name\":\"\",\"role\":\"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate\",\"year\":\"\",\"evidence\":\"one short source phrase\",\"x_handle\":\"@...\",\"domain\":\"example.com\"}]}. " +
    "Include ONLY affiliations you found real, attributable evidence for. If you cannot confidently tie a venture to THIS person, omit it. If you find nothing, return {\"affiliations\":[]}. NEVER invent, guess, or include a venture just because the name is common. Never use em dashes.";
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}). Every company or project they have founded, led, worked at, contributed to, or advised, however small the role. Search the web and X, including team and accelerator pages.`);
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const out: DiscoveredAffiliation[] = Array.isArray(parsed.affiliations)
      ? parsed.affiliations
      : Array.isArray(parsed.ventures) // tolerate the old key
        ? parsed.ventures
        : [];
    return out
      .filter((v) => v && typeof v.name === "string" && v.name.trim())
      .map((v) => ({
        name: v.name.trim(),
        role: v.role || "affiliate",
        year: v.year,
        evidence: v.evidence,
        x_handle: v.x_handle && /^@?[A-Za-z0-9_]{2,30}$/.test(v.x_handle) ? "@" + v.x_handle.replace(/^@/, "") : undefined,
        domain: v.domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.domain) ? v.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
      }))
      .slice(0, 10);
  } catch {
    return [];
  }
}

// Reverse-mention discovery: the complement to discoverAffiliations. That one
// asks "what has THIS person done"; this one asks "who has ever NAMED this
// person as theirs". A co-founder announcement, a "meet the team" thread, a
// launch post tagging the subject — these live on the PROJECT's timeline, not
// the subject's, and often in OLD posts a recency-biased search skips. This is
// the angle that catches a role the subject never tweeted about themselves.
export async function discoverByMentions(handle: string, name?: string, oldHandles: string[] = []): Promise<DiscoveredAffiliation[]> {
  const h = handle.replace(/^@/, "");
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")} — search posts mentioning those old handles too, since their history may live under them.` : "";
  const system =
    "You are a forensic due-diligence researcher with live X (Twitter) search. Find every company, crypto project, fund, or DAO ACCOUNT that has publicly NAMED, TAGGED, ANNOUNCED, or referred to the given person as a founder, co-founder, team member, or employee. " +
    "Search X thoroughly INCLUDING OLDER / HISTORICAL posts, not just recent ones — co-founder announcements and 'meet the team' posts are often years old. There MUST be a real post tying the project to this exact person. " +
    "Reply with ONLY compact JSON: {\"affiliations\":[{\"name\":\"\",\"role\":\"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate\",\"year\":\"\",\"evidence\":\"the post / what it said\",\"x_handle\":\"@projectAccount\",\"domain\":\"example.com\"}]}. " +
    "Include ONLY ties backed by a real post you found. If none, return {\"affiliations\":[]}. NEVER invent. Never use em dashes.";
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Which project or company accounts on X have ever named, tagged, or announced this person as a founder, co-founder, or team member? Search historical posts too, going back years.`);
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const out: DiscoveredAffiliation[] = Array.isArray(parsed.affiliations) ? parsed.affiliations : [];
    return out
      .filter((v) => v && typeof v.name === "string" && v.name.trim())
      .map((v) => ({
        name: v.name.trim(),
        role: v.role || "affiliate",
        year: v.year,
        evidence: v.evidence,
        x_handle: v.x_handle && /^@?[A-Za-z0-9_]{2,30}$/.test(v.x_handle) ? "@" + v.x_handle.replace(/^@/, "") : undefined,
        domain: v.domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.domain) ? v.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
      }))
      .slice(0, 10);
  } catch {
    return [];
  }
}

// ── Team extraction from X content ──
// The people behind a project are usually NAMED in the project account's own
// posts (team intros, "meet the team", role announcements like "welcome @x as
// our CTO") and in posts that tag them, long before any of it reaches a website.
// This mines that content for team members the site/bio never listed.
export interface TeamMember { name: string; handle?: string; role: string; evidence?: string; kind: "team" | "advisor" }

export async function findTeam(handle: string, name: string | undefined, posts: string[] = []): Promise<TeamMember[]> {
  const h = handle.replace(/^@/, "");
  const postContext = posts.length
    ? `\n\nThe account's recent posts (mine these for team intros / role + advisor announcements):\n${posts.slice(0, 15).map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";
  const system =
    "You are a forensic researcher with live X search. Identify the PEOPLE publicly tied to the project behind the given X account, in two groups: " +
    "(1) TEAM — founders, cofounders, and core team members; and (2) ADVISORS — people the project names as advisors, mentors, or backers (a frequent scam vector when the named advisor never actually agreed). " +
    "Look especially at the account's OWN posts (team intros, 'welcome @x as our CTO', 'our founder @y', 'advised by @z', 'backed by @w') and posts that tag these people, plus posts mentioning the project that name its people. " +
    "For each person give name, X handle if found, role, a short evidence phrase, and kind ('team' or 'advisor'). Include ONLY people with real public evidence tying them to THIS project. EXCLUDE the project account itself, generic shillers, hype repliers, and unrelated mentions. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"role\":\"founder|cofounder|ceo|cto|engineer|advisor|backer|team\",\"kind\":\"team|advisor\",\"evidence\":\"\"}]}. If none, return {\"people\":[]}. NEVER invent. Never use em dashes.";
  const text = await grokSearch(system, `X account: @${h}${name && name !== h ? ` (${name})` : ""}. Who are the founders, team members, AND advisors/backers of this project? Search the account's own posts and the posts that mention it.${postContext}`);
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const out: any[] = Array.isArray(parsed.people) ? parsed.people : Array.isArray(parsed.team) ? parsed.team : [];
    const self = h.toLowerCase();
    return out
      .filter((t) => t && typeof t.name === "string" && t.name.trim())
      .map((t) => {
        const role = (t.role || "team").toString();
        const kind: "team" | "advisor" = (t.kind === "advisor" || /advisor|advis|backer|mentor/i.test(role)) ? "advisor" : "team";
        return {
          name: t.name.trim(),
          handle: t.handle && /^@?[A-Za-z0-9_]{2,30}$/.test(t.handle) ? "@" + t.handle.replace(/^@/, "") : undefined,
          role,
          evidence: t.evidence,
          kind,
        };
      })
      .filter((t) => !t.handle || t.handle.replace(/^@/, "").toLowerCase() !== self)
      .slice(0, 14);
  } catch {
    return [];
  }
}

export function fmtFollowers(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export const xAdapter: Adapter = {
  id: "x",
  label: "X (Grok + twitterapi.io)",
  available: () => !!env("TWITTERAPI_KEY") || !!env("XAI_API_KEY"),
  async run(ctx: CollectContext) {
    // 1. profile via twitterapi.io — fallback retry only if coldIntake didn't
    //    already resolve the follower count (so a busy/empty bio still gets it).
    const haveProfile = ctx.evidence.profile.followers && ctx.evidence.profile.followers !== "—";
    const prof = haveProfile ? null : await getProfile(ctx.handle);
    if (prof) {
      ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
      ctx.evidence.profile.bio = prof.bio ?? ctx.evidence.profile.bio;
      ctx.evidence.profile.followers = fmtFollowers(prof.followers);
      if (prof.createdAt) {
        const d = new Date(prof.createdAt);
        if (!isNaN(d.getTime())) {
          ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
        }
      }
      ctx.emit({ phase: "P0 · Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle}, ${fmtFollowers(prof.followers)} followers`, source: "twitterapi.io", tone: "neutral" });
    }

    // recent posts (skip if already pulled upstream for claim extraction)
    if (!ctx.evidence.recentActivity.length) {
      const posts = await getRecentPosts(ctx.handle);
      if (posts.length) {
        ctx.evidence.recentActivity = posts;
        ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Pulled ${posts.length} recent posts.`, source: "twitterapi.io", tone: "neutral" });
      }
    }

    // 1b. follower QUALITY: which respected accounts follow the subject. The
    //     answer (who, not how many) is a credibility signal a bot farm can't fake.
    if (!ctx.evidence.notableFollowers.length) {
      ctx.emit({ phase: "P0 · Intake", label: "Notable followers", detail: "Scanning followers for high-reach accounts and known callers/founders/funds…", source: "twitterapi.io", tone: "neutral" });
      const nf = await notableFollowers(ctx.handle);
      ctx.evidence.notableFollowers = nf;
      if (nf.length) {
        const over1m = nf.filter((n) => (n.count ?? 0) >= 1e6).length;
        const over100k = nf.filter((n) => (n.count ?? 0) >= 1e5).length;
        const reach = over1m ? `${over1m} with >1M followers` : over100k ? `${over100k} with >100K followers` : "";
        ctx.emit({ phase: "P0 · Intake", label: "Notable followers", detail: `Followed by ${nf.length} notable account${nf.length === 1 ? "" : "s"}${reach ? ` (${reach})` : ""}: ${nf.slice(0, 6).map((n) => `@${n.handle}${n.size ? ` ${n.size}` : ""}`).join(", ")}${nf.length > 6 ? ", …" : ""}.`, source: "twitterapi.io", tone: "good" });
      } else {
        ctx.emit({ phase: "P0 · Intake", label: "Notable followers", detail: "No high-reach or known accounts among the subject's recent followers.", source: "twitterapi.io", tone: "neutral" });
      }
    }

    // 2. corroborate each claimed testimonial / advisory / advisor relationship.
    //    Run concurrently and cap the count: each does a follow-graph check plus a
    //    Grok acknowledgment, and a sequential loop over many claims (advisors add
    //    to it) would blow the audit's time budget.
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised]
      .filter((t) => (t as any).claimed_endorser_handle || (t as any).project_handle)
      .slice(0, 6);
    await Promise.all(
      claims.map(async (t) => {
        const endorser = (t as any).claimed_endorser_handle || (t as any).project_handle;
        const [follows, ack] = await Promise.all([followsSubject(endorser, ctx.handle), acknowledgment(endorser, ctx.handle)]);
        if (follows !== null) t.follows_subject = follows;
        if (ack) {
          t.public_acknowledgment = ack.ack;
          t.sentiment = ack.sentiment;
          t.relationship_corroborated = ack.ack === "endorsement" || ack.ack === "thanks";
          t.fud_present = ack.sentiment === "negative";
        }
        t.corroboration_verdict = classifyTestimonial(t);
        const tone = t.corroboration_verdict === TestimonialVerdict.CONTRADICTED ? "bad" : t.corroboration_verdict === TestimonialVerdict.CORROBORATED ? "good" : "warn";
        ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${(t as any).claimed_relationship ?? "endorser"}: ${t.corroboration_verdict}${follows === false ? " · does not follow subject" : ""}`, source: "X", tone });
      }),
    );
  },
};
