// Chart posture. GET /api/technical-posture?symbol=PEPE&mcap=1234567
//
// Reads a self-hosted chart-signal service (major-venue market data for assets
// listed on large exchanges) and translates its machine slugs into generic
// technical observations: "confirmed bullish breakout with exceptional volume",
// "potential bearish reversal forming". The upstream provider is deliberately
// never named anywhere in the output - readings render as plain chart language.
//
// Coverage is majors-only. A fresh CA is usually not covered, and a namesake
// that merely shares a ticker with a listed asset is the real hazard: when the
// caller supplies the scanned token's market cap, any candidate row whose cap
// differs by more than 5x is treated as a different asset and dropped.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

// slug -> generic reading; tilt drives the stance tally (+bullish / -bearish)
const PHRASES: Record<string, { text: string; tilt: number }> = {
  green_bars: { text: "Established uptrend in force", tilt: 2 },
  red_bars: { text: "Established downtrend in force", tilt: -2 },
  squeeze: { text: "Volatility compression - a tightening range that often precedes a large move", tilt: 0 },
  sga: { text: "Early bullish breakout attempt forming", tilt: 1 },
  big_green_arrows: { text: "Confirmed bullish breakout from consolidation", tilt: 3 },
  big_red_arrows: { text: "Confirmed bearish breakdown from consolidation", tilt: -3 },
  reversal_bull: { text: "Potential bullish reversal forming (unconfirmed)", tilt: 1 },
  reversal_bull_confirmed: { text: "Confirmed bullish reversal", tilt: 3 },
  reversal_bear: { text: "Potential bearish reversal forming (unconfirmed)", tilt: -1 },
  reversal_bear_confirmed: { text: "Confirmed bearish reversal", tilt: -3 },
  topping_indy: { text: "Potential local top signal", tilt: -2 },
  strength: { text: "Trend-continuation strength - the pullback reads as corrective", tilt: 2 },
  weakness: { text: "Trend-continuation weakness - the bounce reads as corrective", tilt: -2 },
  bulldiv: { text: "Bullish momentum divergence", tilt: 1 },
  beardiv: { text: "Bearish momentum divergence", tilt: -1 },
  thrustup: { text: "Unusually strong buying pressure", tilt: 2 },
  thrustdown: { text: "Unusually strong selling pressure", tilt: -2 },
  td8_up: { text: "Extended consecutive decline (oversold exhaustion count)", tilt: 1 },
  td9_up: { text: "Deeply extended decline (strong oversold exhaustion count)", tilt: 1 },
  td8_down: { text: "Extended consecutive advance (overbought exhaustion count)", tilt: -1 },
  td9_down: { text: "Deeply extended advance (strong overbought exhaustion count)", tilt: -1 },
  above_trackline: { text: "Holding above dynamic trend support", tilt: 1 },
  below_trackline: { text: "Trading below dynamic trend resistance", tilt: -1 },
  volume_high: { text: "Elevated volume participation", tilt: 0 },
  volume_extreme: { text: "Exceptional volume participation", tilt: 0 },
};
// high-sensitivity / intensity variants collapse onto their base phrase
const ALIASES: Record<string, string> = {
  hs_squeeze: "squeeze", hs_sga: "sga",
  hs_big_green_arrows: "big_green_arrows", hs_big_red_arrows: "big_red_arrows",
  above_trackline_med: "above_trackline", above_trackline_low: "above_trackline",
  below_trackline_med: "below_trackline", below_trackline_low: "below_trackline",
};

interface UpstreamRow {
  ticker?: unknown; timeframe?: unknown; signals?: unknown; high_low?: unknown;
  green_dot_count?: unknown; red_dot_count?: unknown;
  bottoms_last_count?: unknown; bottoms_last_age?: unknown;
  up_bars_30?: unknown; market_cap_usd?: unknown;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function readRow(row: UpstreamRow): { timeframe: string; stance: string; observations: string[]; tilt: number } {
  const slugs = new Set(
    (Array.isArray(row.signals) ? row.signals : []).map((s) => ALIASES[String(s)] ?? String(s)),
  );
  const observations: string[] = [];
  let tilt = 0;
  for (const s of slugs) {
    const p = PHRASES[s];
    if (!p) continue;
    observations.push(p.text);
    tilt += p.tilt;
  }
  // volume pairs with a directional read - phrase it as one combined line
  if (slugs.has("big_green_arrows") && (slugs.has("volume_high") || slugs.has("volume_extreme"))) {
    observations.unshift("Bullish breakout formation paired with strong volume");
  }
  const greenDots = num(row.green_dot_count) ?? 0;
  const redDots = num(row.red_dot_count) ?? 0;
  if (greenDots > 0) { observations.push(`Short-term momentum bullish (${greenDots} consecutive readings)`); tilt += Math.min(2, greenDots / 5); }
  if (redDots > 0) { observations.push(`Short-term momentum bearish (${redDots} consecutive readings)`); tilt -= Math.min(2, redDots / 5); }
  const bottomsAge = num(row.bottoms_last_age);
  if (bottomsAge != null && bottomsAge <= 10 && (num(row.bottoms_last_count) ?? 0) > 0) {
    observations.push(`Basing / bottoming signals printed ${bottomsAge} bars ago`); tilt += 1;
  }
  const hl = new Set(Array.isArray(row.high_low) ? row.high_low.map(String) : []);
  if (hl.has("52w_high")) { observations.push("Trading at 52-week highs"); tilt += 1; }
  else if (hl.has("26w_high")) { observations.push("Trading at 26-week highs"); tilt += 0.5; }
  if (hl.has("52w_low")) { observations.push("Trading at 52-week lows"); tilt -= 1; }
  const stance = tilt >= 2.5 ? "bullish" : tilt <= -2.5 ? "bearish" : observations.length ? "mixed" : "neutral";
  return { timeframe: String(row.timeframe ?? "?"), stance, observations, tilt };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const symbol = String(req.query.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return res.status(400).json({ error: "bad symbol" });
  const scanMcap = num(req.query.mcap);

  const base = process.env.CHART_SIGNALS_URL;
  const token = process.env.CHART_SIGNALS_TOKEN;
  res.setHeader("cache-control", "private, max-age=300");
  if (!base || !token) {
    // absent config is a visible gap, never an empty "all clear"
    return res.status(200).json({ available: false, covered: false, note: "chart-signal service not configured" });
  }

  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/ta/${encodeURIComponent(symbol)}`, {
      headers: { "x-ta-token": token }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(200).json({ available: false, covered: false, note: `chart-signal service error (${r.status})` });
    const d = (await r.json()) as { covered?: unknown; rows?: unknown };
    if (d.covered !== true || !Array.isArray(d.rows)) {
      return res.status(200).json({ available: true, covered: false, note: "not covered by major-venue chart data" });
    }

    // one row per timeframe: prefer the USD pair, then USDT, else first seen
    const byTf = new Map<string, UpstreamRow>();
    const pref = (t: string) => (t.endsWith("-USD") ? 0 : t.endsWith("-USDT") ? 1 : 2);
    for (const raw of d.rows as UpstreamRow[]) {
      const tf = String(raw.timeframe ?? "");
      const cur = byTf.get(tf);
      if (!cur || pref(String(raw.ticker ?? "")) < pref(String(cur.ticker ?? ""))) byTf.set(tf, raw);
    }

    // namesake guard: the scanned token and the listed asset must be the same
    // order of magnitude, or the ticker match is a different asset entirely
    let rows = [...byTf.values()];
    if (scanMcap != null && scanMcap > 0) {
      rows = rows.filter((row) => {
        const feedCap = num(row.market_cap_usd);
        if (feedCap == null || feedCap <= 0) return true;
        const ratio = feedCap / scanMcap;
        return ratio < 5 && ratio > 0.2;
      });
      if (rows.length === 0) {
        return res.status(200).json({
          available: true, covered: false,
          note: "a listed asset shares this ticker at a very different market cap; chart data skipped to avoid misattribution",
        });
      }
    }

    const readings = rows.map(readRow).sort((a, b) => (a.timeframe > b.timeframe ? 1 : -1));
    const total = readings.reduce((s, r) => s + r.tilt, 0);
    const stance = total >= 2.5 ? "bullish" : total <= -2.5 ? "bearish" : readings.some((r) => r.observations.length) ? "mixed" : "neutral";
    return res.status(200).json({
      available: true, covered: true, symbol, stance,
      readings: readings.map(({ timeframe, stance: s, observations }) => ({ timeframe, stance: s, observations })),
      note: null,
    });
  } catch (e) {
    return res.status(200).json({ available: false, covered: false, note: `chart-signal lookup failed: ${String((e as Error).message).slice(0, 80)}` });
  }
}
