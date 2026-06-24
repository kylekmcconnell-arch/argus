// TEMP diagnostic — inspect the raw twitterapi.io user/info shape for a handle.
// Returns status + top-level keys + a few safe fields. No secrets echoed. Remove after use.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key) { res.status(500).json({ error: "no TWITTERAPI_KEY" }); return; }
  const u = (typeof req.query.h === "string" ? req.query.h : "aeyakovenko").replace(/^@/, "");
  const url = `https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(u)}`;
  try {
    const r = await fetch(url, { headers: { "x-api-key": key } });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    const data = json?.data ?? json;
    res.status(200).json({
      handle: u,
      httpStatus: r.status,
      topLevelKeys: json ? Object.keys(json) : null,
      dataKeys: data && typeof data === "object" ? Object.keys(data) : null,
      sample: data && typeof data === "object" ? {
        name: data.name,
        followers: data.followers,
        followers_count: data.followers_count,
        createdAt: data.createdAt,
        created_at: data.created_at,
        status: json?.status,
        msg: json?.msg ?? json?.message,
      } : null,
      rawHead: text.slice(0, 240),
    });
  } catch (e) {
    res.status(200).json({ handle: u, fetchError: String(e) });
  }
}
