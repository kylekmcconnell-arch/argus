// Reddit adapter. Community FUD / reputation signal (F5 / I5 / AG4). Free tier
// works via OAuth client credentials. Gated on REDDIT_CLIENT_ID + SECRET.

import type { Adapter, CollectContext } from "./types";
import { recordCall } from "../cost";
import { env } from "../config";

let cachedToken: { token: string; exp: number } | null = null;
type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

function recordRedditAttempt(op: "oauth-token" | "search", status: "succeeded" | "partial" | "failed", meta?: string) {
  recordCall("reddit", op, 0, meta, status);
}

async function getToken(): Promise<string | null> {
  const id = env("REDDIT_CLIENT_ID");
  const secret = env("REDDIT_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  let res: Response;
  try {
    res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "argus-dd/1.0",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    recordRedditAttempt("oauth-token", "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordRedditAttempt("oauth-token", "failed", `http_${res.status}`);
    return null;
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    recordRedditAttempt("oauth-token", "failed", "response_json_error");
    return null;
  }
  const d = asRecord(raw);
  const token = typeof d?.access_token === "string" && d.access_token ? d.access_token : null;
  if (!token) {
    recordRedditAttempt("oauth-token", "partial", "missing_access_token");
    return null;
  }
  const expiresIn = typeof d?.expires_in === "number" && Number.isFinite(d.expires_in) ? d.expires_in : null;
  if (expiresIn == null) {
    recordRedditAttempt("oauth-token", "partial", "missing_expiry");
    return token;
  }
  cachedToken = { token, exp: Date.now() + (expiresIn - 60) * 1000 };
  recordRedditAttempt("oauth-token", "succeeded");
  return token;
}

export async function searchMentions(query: string): Promise<{ title: string; sub: string; score: number; url: string }[]> {
  const token = await getToken();
  if (!token) return [];
  let res: Response;
  try {
    res = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=relevance&limit=15&t=year`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": "argus-dd/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    recordRedditAttempt("search", "failed", "transport_error");
    return [];
  }
  if (!res.ok) {
    recordRedditAttempt("search", "failed", `http_${res.status}`);
    return [];
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    recordRedditAttempt("search", "failed", "response_json_error");
    return [];
  }
  const d = asRecord(raw);
  const data = asRecord(d?.data);
  if (!Array.isArray(data?.children)) {
    recordRedditAttempt("search", "partial", "missing_children");
    return [];
  }

  let invalidChildren = 0;
  const hits = data.children.flatMap((child) => {
    const item = asRecord(asRecord(child)?.data);
    const title = typeof item?.title === "string" ? item.title : null;
    const sub = typeof item?.subreddit_name_prefixed === "string" ? item.subreddit_name_prefixed : null;
    const permalink = typeof item?.permalink === "string" ? item.permalink : null;
    if (!title || !sub || !permalink) {
      invalidChildren += 1;
      return [];
    }
    return [{
      title,
      sub,
      score: typeof item?.score === "number" && Number.isFinite(item.score) ? item.score : 0,
      url: "https://reddit.com" + permalink,
    }];
  });
  recordRedditAttempt(
    "search",
    invalidChildren ? "partial" : "succeeded",
    invalidChildren ? `dropped_${invalidChildren}_invalid_results` : `${hits.length}_results`,
  );
  return hits;
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
        source_author: "reddit",
        verification_status: "Reported",
        independent_source_count: 1,
        polarity: -1,
        provider: "reddit",
        evidence_origin: "deterministic",
        artifact_verified: true,
        finding_scope: {
          scope: "direct_subject",
          target_entity_key: ctx.evidence.profile.handle,
          target_entity_type: "person",
          relationship_to_subject: "self",
          relationship_label: "Reddit search result naming the audited handle",
        },
      });
    }
    ctx.emit({ phase: "Reputation", label: `${hits.length} threads`, detail: `Top: "${hits[0].title.slice(0, 70)}" (${hits[0].sub})`, source: "reddit", tone: hits.length > 3 ? "warn" : "neutral" });
  },
};
