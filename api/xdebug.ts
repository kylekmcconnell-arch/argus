// TEMPORARY diagnostic: reveals the STRUCTURE (key names, lengths, types) of the
// twitterapi.io responses so the adapter field-mapping can be fixed. Returns no
// bio/tweet text — only shape + the follower/createdAt scalars. Delete after use.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.TWITTERAPI_KEY;
  const h = String(req.query.handle ?? "").replace(/^@/, "");
  const out: Record<string, unknown> = { hasKey: !!key, handle: h };
  if (!key || !h) { res.status(200).json({ ...out, error: "missing key or handle" }); return; }

  try {
    const r = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(h)}`, { headers: { "x-api-key": key } });
    const j = (await r.json()) as any;
    const p = j?.data ?? j;
    out.info = {
      status: r.status,
      topKeys: Object.keys(j ?? {}),
      dataKeys: j?.data ? Object.keys(j.data) : null,
      sample: { name: p?.name, descLen: (p?.description ?? "").length, followers: p?.followers, createdAt: p?.createdAt },
    };
  } catch (e) { out.info = { err: String(e) }; }

  try {
    const r = await fetch(`https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(h)}`, { headers: { "x-api-key": key } });
    const j = (await r.json()) as any;
    const arr = j?.data?.tweets ?? j?.tweets ?? (Array.isArray(j?.data) ? j.data : []);
    out.tweets = {
      status: r.status,
      topKeys: Object.keys(j ?? {}),
      dataType: Array.isArray(j?.data) ? "array" : typeof j?.data,
      dataKeys: j?.data && !Array.isArray(j.data) ? Object.keys(j.data) : null,
      tweetsLen: Array.isArray(arr) ? arr.length : "not-array",
      firstTweetKeys: Array.isArray(arr) && arr[0] ? Object.keys(arr[0]) : null,
    };
  } catch (e) { out.tweets = { err: String(e) }; }

  res.status(200).json(out);
}
