// Reddit adapter. Community FUD / reputation signal (F5 / I5 / AG4). Free tier
// works via OAuth client credentials. Gated on REDDIT_CLIENT_ID + SECRET.

import type { Adapter, CollectContext } from "./types";
import { recordCall } from "../cost";
import { env } from "../config";

let cachedToken: { token: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  const id = env("REDDIT_CLIENT_ID");
  const secret = env("REDDIT_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "argus-dd/1.0",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    cachedToken = { token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export async function searchMentions(query: string): Promise<{ title: string; sub: string; score: number; url: string }[]> {
  const token = await getToken();
  if (!token) return [];
  try {
    recordCall("reddit", "search", 0);
    const res = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=relevance&limit=15&t=year`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": "argus-dd/1.0" },
    });
    if (!res.ok) return [];
    const d = (await res.json()) as any;
    return (d.data?.children ?? []).map((c: any) => ({
      title: c.data.title,
      sub: c.data.subreddit_name_prefixed,
      score: c.data.score,
      url: "https://reddit.com" + c.data.permalink,
    }));
  } catch {
    return [];
  }
}

export const redditAdapter: Adapter = {
  id: "reddit",
  label: "Reddit",
  available: () => !!env("REDDIT_CLIENT_ID") && !!env("REDDIT_CLIENT_SECRET"),
  async run(ctx: CollectContext) {
    const handle = ctx.handle.replace(/^@/, "");
    ctx.emit({ phase: "Reputation", label: "FUD scan", detail: `Searching Reddit for "${handle}" mentions…`, tone: "neutral" });
    const hits = await searchMentions(`${handle} (scam OR rug OR warning OR review)`);
    if (!hits.length) {
      ctx.emit({ phase: "Reputation", label: "No FUD surfaced", detail: "No notable Reddit complaints in the last year.", source: "reddit", tone: "neutral" });
      return;
    }
    for (const h of hits.slice(0, 5)) {
      ctx.evidence.findings.push({
        finding_type: "CommunityFUD",
        claim: h.title,
        source_url: h.url,
        source_date: new Date().toISOString().slice(0, 10),
        verification_status: "Reported",
        independent_source_count: 1,
        polarity: -1,
      });
    }
    ctx.emit({ phase: "Reputation", label: `${hits.length} threads`, detail: `Top: "${hits[0].title.slice(0, 70)}" (${hits[0].sub})`, source: "reddit", tone: hits.length > 3 ? "warn" : "neutral" });
  },
};
