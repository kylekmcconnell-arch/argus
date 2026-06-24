// TEMP diagnostic — is twitterapi rate-limited (QPS) or is the handle not found?
// Bursts 3 back-to-back profile calls (no delay) so a per-second QPS cap shows.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key) { res.status(500).json({ error: "no TWITTERAPI_KEY in env" }); return; }
  const u = (typeof req.query.h === "string" ? req.query.h : "VitalikButerin").replace(/^@/, "");
  const url = `https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(u)}`;
  const results: any[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { "x-api-key": key } });
      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch { /* */ }
      results.push({
        call: i + 1,
        http: r.status,
        status: j?.status,
        msg: j?.msg ?? j?.message ?? j?.error,
        name: j?.data?.name,
        followers: j?.data?.followers,
        ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({ call: i + 1, err: String(e), ms: Date.now() - t0 });
    }
  }
  res.status(200).json({ handle: u, results });
}
