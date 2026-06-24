// TEMP probe — verify twitterapi check_follow_relationship shape on known pairs.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key) { res.status(500).json({ error: "no TWITTERAPI_KEY" }); return; }
  const pairs: [string, string][] = [
    ["solana", "VitalikButerin"],
    ["cdixon", "VitalikButerin"],
    ["cz_binance", "VitalikButerin"],
    ["solana", "aeyakovenko"],
    ["rajgokal", "aeyakovenko"],
  ];
  const out: any[] = [];
  for (const [s, t] of pairs) {
    const url = `https://api.twitterapi.io/twitter/user/check_follow_relationship?source_user_name=${encodeURIComponent(s)}&target_user_name=${encodeURIComponent(t)}`;
    try {
      const r = await fetch(url, { headers: { "x-api-key": key } });
      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch { /* not json */ }
      out.push({ pair: `${s}->${t}`, http: r.status, status: j?.status, data: j?.data, rawHead: text.slice(0, 180) });
    } catch (e) {
      out.push({ pair: `${s}->${t}`, err: String(e) });
    }
  }
  res.status(200).json(out);
}
