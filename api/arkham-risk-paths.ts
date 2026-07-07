// Arkham risk paths — WHY a wallet is risky. GET /api/arkham-risk-paths?address=<addr>
//
// The risk score says "flagged"; this says why: the seed→target trace showing which
// hacker / mixer / sanctioned entity the wallet is exposed to, in which direction,
// how many hops away, and how much USD flowed. Turns "⚠ risk" into "$72M, 1 hop from
// Tornado.Cash". Seeds are labeled with their Arkham entity so they read as names,
// not hashes. Top paths by USD contribution, deduped per seed, cached 24h.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 20 };

const RISK = "https://api.arkm.com/risk/address/";
const INTEL = "https://api.arkm.com/intelligence/address/";

type PathOut = { seed: string; seedName?: string; seedType?: string; category?: string; direction: string; score: number; usd: number; hops: number };

async function seedName(addr: string, key: string): Promise<{ name?: string; type?: string }> {
  try {
    const r = await fetch(`${INTEL}${encodeURIComponent(addr)}`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(7000) });
    if (!r.ok) return {};
    const d = (await r.json()) as { arkhamEntity?: { name?: string; type?: string }; arkhamLabel?: { name?: string } };
    return { name: d.arkhamEntity?.name || d.arkhamLabel?.name, type: d.arkhamEntity?.type };
  } catch { return {}; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured." }); return; }
  const addr = (typeof req.query.address === "string" ? req.query.address : "").trim();
  if (!addr || addr.length < 8) { res.status(400).json({ error: "address required" }); return; }

  const ck = `arkham-paths:${addr.toLowerCase()}:v1`;
  const cached = await cacheGetJson<any>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  try {
    const r = await fetch(`${RISK}${encodeURIComponent(addr)}/paths`, { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) { res.status(200).json({ available: false, note: `Arkham ${r.status}` }); return; }
    const d = (await r.json()) as { paths?: any[] };
    const raw = Array.isArray(d?.paths) ? d.paths : [];
    // Best path per seed (highest USD contribution), then the top few overall.
    const bySeed = new Map<string, any>();
    for (const p of raw) {
      const s = String(p?.seed_address ?? "");
      if (!s) continue;
      const ex = bySeed.get(s);
      if (!ex || Number(p?.contribution_usd ?? 0) > Number(ex?.contribution_usd ?? 0)) bySeed.set(s, p);
    }
    const top = [...bySeed.values()].sort((a, b) => Number(b?.contribution_usd ?? 0) - Number(a?.contribution_usd ?? 0)).slice(0, 6);
    // Label the seeds (parallel, bounded).
    const labels = await Promise.all(top.map((p) => seedName(String(p.seed_address), key)));
    const paths: PathOut[] = top.map((p, i) => ({
      seed: String(p.seed_address),
      seedName: labels[i].name,
      seedType: labels[i].type,
      category: p?.risk_category,
      direction: p?.direction === "backward" ? "backward" : "forward",
      score: Number(p?.score ?? 0),
      usd: Number(p?.contribution_usd ?? 0),
      hops: Number(p?.hop_distance ?? 0),
    }));
    const out = { available: true, paths };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Risk paths lookup failed." });
  }
}
