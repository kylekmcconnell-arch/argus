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
const XAI = "https://api.x.ai/v1/chat/completions";

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
    const res = await fetch(`${TWITTERAPI}/twitter/user/info?userName=${encodeURIComponent(u)}`, {
      headers: { "x-api-key": key },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const p = d.data ?? d;
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
    const res = await fetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, {
      headers: { "x-api-key": key },
    });
    if (!res.ok) return [];
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
  try {
    const res = await fetch(XAI, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
        messages: [
          {
            role: "system",
            content:
              "You verify endorsements for a due-diligence engine. Decide the strongest public acknowledgment @" +
              e + " has ever made of @" + s + " on X, and overall sentiment. Reply with ONLY a compact JSON object " +
              '{"ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none"}.',
          },
          { role: "user", content: `Has @${e} ever publicly acknowledged @${s}?` },
        ],
        search_parameters: {
          mode: "on",
          sources: [{ type: "x", x_handles: [e] }],
          max_search_results: 20,
        },
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const text: string = d.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return { ack: parsed.ack ?? "none", sentiment: parsed.sentiment ?? "none" };
  } catch {
    return null;
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
