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
async function twFetch(url: string, key: string, tries = 3): Promise<Response | null> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "x-api-key": key } });
    last = res;
    if (res.status !== 429 && res.status !== 502 && res.status !== 503) return res;
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
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
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/info?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return null;
    const d = (await res.json()) as any;
    // twitterapi.io returns HTTP 200 even on failure, with {status:"error", data:null}
    // (rate limit, user-not-found). Treat that as a miss, not an empty profile.
    if (d?.status === "error" || d?.data === null) return null;
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
export async function discoverByMentions(handle: string, name?: string): Promise<DiscoveredAffiliation[]> {
  const h = handle.replace(/^@/, "");
  const system =
    "You are a forensic due-diligence researcher with live X (Twitter) search. Find every company, crypto project, fund, or DAO ACCOUNT that has publicly NAMED, TAGGED, ANNOUNCED, or referred to the given person as a founder, co-founder, team member, or employee. " +
    "Search X thoroughly INCLUDING OLDER / HISTORICAL posts, not just recent ones — co-founder announcements and 'meet the team' posts are often years old. There MUST be a real post tying the project to this exact person. " +
    "Reply with ONLY compact JSON: {\"affiliations\":[{\"name\":\"\",\"role\":\"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate\",\"year\":\"\",\"evidence\":\"the post / what it said\",\"x_handle\":\"@projectAccount\",\"domain\":\"example.com\"}]}. " +
    "Include ONLY ties backed by a real post you found. If none, return {\"affiliations\":[]}. NEVER invent. Never use em dashes.";
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}). Which project or company accounts on X have ever named, tagged, or announced this person as a founder, co-founder, or team member? Search historical posts too, going back years.`);
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

    // 2. corroborate each claimed testimonial / advisory relationship
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised];
    for (const t of claims) {
      const endorser = (t as any).claimed_endorser_handle || (t as any).project_handle;
      if (!endorser) continue;
      const follows = await followsSubject(endorser, ctx.handle);
      const ack = await acknowledgment(endorser, ctx.handle);
      if (follows !== null) t.follows_subject = follows;
      if (ack) {
        t.public_acknowledgment = ack.ack;
        t.sentiment = ack.sentiment;
        t.relationship_corroborated = ack.ack === "endorsement" || ack.ack === "thanks";
        t.fud_present = ack.sentiment === "negative";
      }
      // re-derive the verdict from the freshly collected observations
      t.corroboration_verdict = classifyTestimonial(t);
      const tone = t.corroboration_verdict === TestimonialVerdict.CONTRADICTED ? "bad" : t.corroboration_verdict === TestimonialVerdict.CORROBORATED ? "good" : "warn";
      ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${t.corroboration_verdict}${follows === false ? " · does not follow subject" : ""}`, source: "X", tone });
    }
  },
};
