// KOL authenticity signals. GET /api/kol-signals?handle=<x_handle>
//
// A KOL's whole value is reach + trust, so the scam is faking both: bought bot
// followers and bought engagement. This samples the account's followers for bot
// markers and reads its recent posts' engagement to flag a paid/hollow audience.
// twitterapi.io (TWITTERAPI_KEY). Read-only.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 30 };

const TW = "https://api.twitterapi.io";
const HANDLE = /^[A-Za-z0-9_]{1,30}$/;

let twCalls = 0; // per-invocation counter (one request handled per lambda at a time)
async function tw(url: string, key: string): Promise<any> {
  twCalls += 1;
  try {
    const r = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(12000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const num = (...v: any[]) => { for (const x of v) if (typeof x === "number") return x; return undefined; };

// Red flags on a single follower account — the shape of a bought/spam bot.
function botFlags(f: any): number {
  const followers = num(f.followers, f.followers_count, f.followersCount) ?? 0;
  const following = num(f.following, f.following_count, f.followingCount, f.friends_count) ?? 0;
  const tweets = num(f.statusesCount, f.statuses_count, f.tweetsCount, f.tweet_count, f.statuses) ?? 0;
  const avatar = String(f.profilePicture || f.profile_image_url_https || f.profile_image_url || "");
  const created = f.createdAt || f.created_at;
  let flags = 0;
  if (followers < 5) flags++;
  if (following > 1500 && followers < following / 25) flags++; // mass-follow spam
  if (tweets <= 1) flags++;
  if (!avatar || /default_profile|default-avatar|abs\.twimg\.com\/sticky\/default/i.test(avatar)) flags++;
  if (created) { const d = Date.parse(created); if (!Number.isNaN(d) && Date.now() - d < 45 * 864e5) flags++; }
  return flags;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const key = process.env.TWITTERAPI_KEY;
  const handle = typeof req.query.handle === "string" ? req.query.handle.replace(/^@/, "").trim() : "";
  if (!handle || !HANDLE.test(handle)) { res.status(400).json({ error: "handle required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "twitterapi not configured." }); return; }
  twCalls = 0;

  try {
    const prof = await tw(`${TW}/twitter/user/info?userName=${encodeURIComponent(handle)}`, key);
    const p = prof?.data ?? prof ?? {};
    const totalFollowers = num(p.followers, p.followers_count) ?? 0;

    // Sample recent followers for bot markers (a few pages).
    let cursor = "";
    let sampled = 0;
    let likelyBots = 0;
    for (let page = 0; page < 3; page++) {
      const d = await tw(`${TW}/twitter/user/followers?userName=${encodeURIComponent(handle)}&pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, key);
      const list: any[] = d?.followers ?? d?.data?.followers ?? (Array.isArray(d?.data) ? d.data : []);
      if (!list?.length) break;
      for (const f of list) { sampled++; if (botFlags(f) >= 2) likelyBots++; }
      if (!d?.has_next_page || !d?.next_cursor) break;
      cursor = d.next_cursor;
    }
    const botPct = sampled ? Math.round((likelyBots / sampled) * 100) : null;

    // Engagement authenticity from recent posts.
    const postsD = await tw(`${TW}/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}`, key);
    const tweets: any[] = postsD?.data?.tweets ?? postsD?.tweets ?? [];
    const eng = tweets.slice(0, 20).map((t) => ({
      likes: num(t.likeCount, t.favorite_count, t.favoriteCount, t.likes) ?? 0,
      replies: num(t.replyCount, t.reply_count, t.replies) ?? 0,
      retweets: num(t.retweetCount, t.retweet_count, t.retweets) ?? 0,
      views: num(t.viewCount, t.view_count, t.views) ?? 0,
    }));
    const avg = (f: (e: typeof eng[number]) => number) => (eng.length ? Math.round(eng.reduce((s, e) => s + f(e), 0) / eng.length) : 0);
    const avgLikes = avg((e) => e.likes);
    const avgReplies = avg((e) => e.replies);
    const avgRetweets = avg((e) => e.retweets);
    const engagementRate = totalFollowers ? avgLikes / totalFollowers : 0; // likes per follower
    const likeReplyRatio = avgReplies ? avgLikes / avgReplies : avgLikes;

    const flags: string[] = [];
    if (botPct != null && botPct >= 35) flags.push(`~${botPct}% of sampled followers show bot markers`);
    if (totalFollowers >= 20000 && engagementRate < 0.0005) flags.push(`hollow reach: ${totalFollowers.toLocaleString()} followers but only ~${avgLikes} likes/post`);
    if (avgLikes >= 200 && likeReplyRatio > 150) flags.push(`bought-engagement shape: ~${avgLikes} likes but ~${avgReplies} replies/post (no real conversation)`);

    const note = flags.length
      ? `Audience red flags: ${flags.join("; ")}.`
      : sampled
        ? `No strong bot/bought-engagement signal in the sample (${botPct}% of ${sampled} sampled followers flagged, ~${avgLikes} likes & ~${avgReplies} replies/post on ${totalFollowers.toLocaleString()} followers).`
        : "Could not sample followers.";

    await attachPanelCost(auth.organizationId, handle, { provider: "twitterapi", op: "panel:kol-signals", calls: twCalls, usd: twCalls * 0.0002 }, "person");
    res.status(200).json({
      available: true,
      handle,
      totalFollowers,
      followerSample: sampled,
      botPct,
      engagement: { avgLikes, avgReplies, avgRetweets, engagementRate: Number(engagementRate.toFixed(5)), likeReplyRatio: Math.round(likeReplyRatio) },
      flags,
      note,
    });
  } catch (e) {
    res.status(200).json({ available: true, error: String(e), note: "KOL signals failed." });
  }
}
