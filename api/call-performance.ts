// Shill-timing: how a KOL's call actually performed. GET /api/call-performance
//   ?handle=<kol>&ticker=$X&address=<mint>&chain=<dexscreener chain>
//
// Finds the earliest tweet where the KOL called the token (their "call"), reads
// the on-chain price at that moment, then measures the token 1h / 12h / 24h / 1w
// / 1m / 2m / 3m later. Turns "they promoted it" into "promoted at $8M, -95% a
// month later." If no call tweet is found, anchors to the token's launch instead
// and says so. twitterapi.io (call tweet) + GeckoTerminal (price, no key).
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const TW = "https://api.twitterapi.io";
const GT = "https://api.geckoterminal.com/api/v2";
const HANDLE = /^[A-Za-z0-9_]{1,30}$/;

const NETWORK: Record<string, string> = {
  solana: "solana", ethereum: "eth", eth: "eth", bsc: "bsc", base: "base",
  arbitrum: "arbitrum", polygon: "polygon_pos", polygon_pos: "polygon_pos",
  avalanche: "avax", avax: "avax", optimism: "optimism", fantom: "ftm",
  sui: "sui", ton: "ton", tron: "tron", blast: "blast", sei: "sei-evm",
};

// hours after the call → label
const OFFSETS: [string, number][] = [
  ["1h", 1], ["12h", 12], ["24h", 24], ["1w", 168], ["1m", 720], ["2m", 1440], ["3m", 2160],
];

async function gt(path: string): Promise<any | null> {
  try { const r = await fetch(`${GT}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function tw(url: string, key: string): Promise<any | null> {
  try { const r = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(12000) }); return r.ok ? await r.json() : null; } catch { return null; }
}

type Candle = [number, number, number, number, number, number]; // ts,o,h,l,c,v
function nearest(candles: Candle[], targetSec: number): number | null {
  if (!candles.length) return null;
  let best: Candle | null = null;
  let bestD = Infinity;
  for (const c of candles) { const d = Math.abs(c[0] - targetSec); if (d < bestD) { bestD = d; best = c; } }
  // Reject if the closest candle is more than ~2 days off the target (no data there).
  return best && bestD <= 2 * 86400 ? best[4] : null;
}

async function poolFor(network: string, address: string): Promise<string | null> {
  const d = await gt(`/networks/${network}/tokens/${address}/pools?page=1`);
  const first = d?.data?.[0];
  const id: string | undefined = first?.attributes?.address ?? first?.id;
  return id ? id.replace(`${network}_`, "") : null;
}

// The earliest tweet from this handle that mentions the token (contract first,
// then ticker). Returns { sec, url, text } or null.
async function findCall(handle: string, ticker: string | undefined, address: string | undefined, key: string) {
  const queries = [address ? `from:${handle} ${address}` : "", ticker ? `from:${handle} ${ticker.startsWith("$") ? ticker : "$" + ticker}` : ""].filter(Boolean);
  for (const q of queries) {
    const d = await tw(`${TW}/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Latest`, key);
    const tweets: any[] = d?.tweets ?? d?.data?.tweets ?? [];
    if (!tweets.length) continue;
    const dated = tweets
      .map((t) => ({ sec: Math.floor(Date.parse(t.createdAt ?? t.created_at ?? "") / 1000), url: t.url ?? t.twitterUrl ?? (t.id ? `https://x.com/${handle}/status/${t.id}` : undefined), text: (t.text ?? "").slice(0, 160) }))
      .filter((t) => Number.isFinite(t.sec));
    if (!dated.length) continue;
    dated.sort((a, b) => a.sec - b.sec); // earliest = the first time they called it
    return dated[0];
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query;
  const handle = typeof q.handle === "string" ? q.handle.replace(/^@/, "").trim() : "";
  const ticker = typeof q.ticker === "string" ? q.ticker.trim() : undefined;
  const address = typeof q.address === "string" ? q.address.trim() : undefined;
  const chain = typeof q.chain === "string" ? q.chain.trim().toLowerCase() : "";
  if (!handle || !HANDLE.test(handle) || !address) { res.status(400).json({ error: "handle + address required" }); return; }
  const network = NETWORK[chain] ?? chain;
  if (!network) { res.status(200).json({ available: true, note: "unsupported chain" }); return; }

  try {
    const pool = await poolFor(network, address);
    if (!pool) { res.status(200).json({ available: true, note: "no pool indexed for this token" }); return; }

    // Find the call time (or fall back to the token's launch = oldest candle).
    const twKey = process.env.TWITTERAPI_KEY;
    const call = twKey ? await findCall(handle, ticker, address, twKey) : null;

    // Daily candles across the token's life (for launch anchor + long offsets).
    const dailyD = await gt(`/networks/${network}/pools/${pool}/ohlcv/day?aggregate=1&limit=200&currency=usd`);
    const daily: Candle[] = (dailyD?.data?.attributes?.ohlcv_list ?? []).slice().sort((a: Candle, b: Candle) => a[0] - b[0]);
    if (daily.length < 2) { res.status(200).json({ available: true, note: "not enough price history" }); return; }

    const anchorSec = call?.sec ?? daily[0][0];
    const anchor = call ? "call" : "launch";

    // Hourly candles around the anchor for fine early offsets (1h..1w).
    const hourlyD = await gt(`/networks/${network}/pools/${pool}/ohlcv/hour?aggregate=1&limit=200&before_timestamp=${anchorSec + 8 * 86400}&currency=usd`);
    const hourly: Candle[] = (hourlyD?.data?.attributes?.ohlcv_list ?? []).slice().sort((a: Candle, b: Candle) => a[0] - b[0]);

    const priceAt = (sec: number): number | null => {
      const h = nearest(hourly, sec);
      if (h != null) return h;
      return nearest(daily, sec);
    };

    const anchorPrice = priceAt(anchorSec);
    if (anchorPrice == null || anchorPrice <= 0) { res.status(200).json({ available: true, note: "no price at anchor time", _dbg: { anchor, anchorSec, dailyLen: daily.length, dailyFirst: daily[0]?.[0], dailyLast: daily[daily.length - 1]?.[0], hourlyLen: hourly.length, hourlyFirst: hourly[0]?.[0], hourlyLast: hourly[hourly.length - 1]?.[0], callFound: !!call } }); return; }

    const nowSec = daily[daily.length - 1][0];
    const periods = OFFSETS.map(([label, hrs]) => {
      const t = anchorSec + hrs * 3600;
      if (t > nowSec + 86400) return { label, pct: null as number | null, elapsed: false };
      const p = priceAt(t);
      return { label, pct: p != null ? ((p - anchorPrice) / anchorPrice) * 100 : null, elapsed: true };
    });

    const curPrice = daily[daily.length - 1][4];
    const peak = Math.max(...daily.filter((c) => c[0] >= anchorSec).map((c) => c[4]), anchorPrice);

    res.status(200).json({
      available: true,
      anchor,
      anchorTime: anchorSec,
      anchorPrice,
      tweetUrl: call?.url ?? null,
      tweetText: call?.text ?? null,
      periods,
      current: { pct: ((curPrice - anchorPrice) / anchorPrice) * 100 },
      peakPct: ((peak - anchorPrice) / anchorPrice) * 100,
    });
  } catch (e) {
    res.status(200).json({ available: true, error: String(e), note: "call-performance failed" });
  }
}
