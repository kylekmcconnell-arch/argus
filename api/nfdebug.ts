// TEMP probe — followers endpoint shape (fields + cursor) for the scan approach.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key) { res.status(500).json({ error: "no TWITTERAPI_KEY" }); return; }
  const u = (typeof req.query.h === "string" ? req.query.h : "kkonmcc").replace(/^@/, "");
  const url = `https://api.twitterapi.io/twitter/user/followers?userName=${encodeURIComponent(u)}&pageSize=200`;
  try {
    const r = await fetch(url, { headers: { "x-api-key": key } });
    const text = await r.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* */ }
    const arr = j?.followers ?? j?.data?.followers ?? (Array.isArray(j?.data) ? j.data : []);
    res.status(200).json({
      http: r.status,
      topKeys: j ? Object.keys(j) : null,
      followerCount: Array.isArray(arr) ? arr.length : null,
      sampleFollower: Array.isArray(arr) && arr[0] ? { userName: arr[0].userName, screen_name: arr[0].screen_name, name: arr[0].name, followers: arr[0].followers, followers_count: arr[0].followers_count } : null,
      cursorFields: j ? { has_next_page: j.has_next_page, next_cursor: j.next_cursor, nextCursor: j.nextCursor } : null,
      rawHead: text.slice(0, 200),
    });
  } catch (e) {
    res.status(200).json({ err: String(e) });
  }
}
