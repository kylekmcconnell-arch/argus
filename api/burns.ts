// On-chain burn history + cadence. GET /api/burns?address=<0x…>&chain=<id>
//
// The user's methodology: identify the burn address, how much of total supply is
// burned, and whether burns are ONGOING and REGULAR vs a one-off — from the
// actual transfer history, so it works even for a token with no site/X (e.g.
// $FIH on Robinhood, burned regularly by hand). Two source paths:
//   - Etherscan v2 tokentx (keyed) for the major EVM chains.
//   - Blockscout token-transfers (keyless) for Robinhood Chain.
// EVM only (Solana burns are a program instruction, not a transfer to dead).
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 25 };

const ETHERSCAN_CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, cronos: 25, zksync: 324,
  linea: 59144, scroll: 534352,
};
const BLOCKSCOUT: Record<string, string> = {
  robinhood: "https://robinhoodchain.blockscout.com",
};
const BURN_ADDRS = [
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000",
];
const DAY = 86_400_000;

interface BurnTx { ts: number; amount: number }

// --- Etherscan path ---
// Returns the burn transfers (human units) AND the token's decimals as seen on
// the tokentx rows — the caller needs decimals to convert the raw base-unit
// supply from stats/tokensupply into the same human units, else burnedSupplyPct
// comes out ~0 on every 18-decimal token.
async function etherscanBurns(chainid: number, token: string, burn: string, key: string): Promise<{ txs: BurnTx[]; decimals: number | null }> {
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=${chainid}&module=account&action=tokentx&contractaddress=${token}&address=${burn}&startblock=0&endblock=99999999&sort=asc&apikey=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(14000) });
    if (!r.ok) return { txs: [], decimals: null };
    const d = (await r.json()) as any;
    if (d.status !== "1" || !Array.isArray(d.result)) return { txs: [], decimals: null };
    const out: BurnTx[] = [];
    let decimals: number | null = null;
    for (const t of d.result) {
      if (String(t.to ?? "").toLowerCase() !== burn) continue;
      const dec = Number(t.tokenDecimal ?? 18);
      if (decimals === null && Number.isFinite(dec)) decimals = dec;
      const amt = Number(t.value ?? 0) / 10 ** dec;
      const ts = Number(t.timeStamp ?? 0) * 1000;
      if (amt > 0 && ts > 0) out.push({ ts, amount: amt });
    }
    return { txs: out, decimals };
  } catch { return { txs: [], decimals: null }; }
}
async function etherscanSupply(chainid: number, token: string, key: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.etherscan.io/v2/api?chainid=${chainid}&module=stats&action=tokensupply&contractaddress=${token}&apikey=${key}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    return d.status === "1" ? Number(d.result) : null;
  } catch { return null; }
}

// --- Blockscout path (keyless) ---
async function blockscoutToken(base: string, token: string): Promise<{ supply: number; decimals: number } | null> {
  try {
    const r = await fetch(`${base}/api/v2/tokens/${token}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const decimals = Number(d.decimals ?? 18);
    return { supply: Number(d.total_supply ?? 0) / 10 ** decimals, decimals };
  } catch { return null; }
}
async function blockscoutBurns(base: string, token: string, burn: string, decimals: number): Promise<BurnTx[]> {
  const out: BurnTx[] = [];
  let next: string | null = "";
  for (let page = 0; page < 4; page++) { // bounded
    try {
      const q: string = next ? `&${next}` : "";
      const r = await fetch(`${base}/api/v2/addresses/${burn}/token-transfers?token=${token}&type=ERC-20${q}`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) break;
      const d = (await r.json()) as any;
      for (const it of d.items ?? []) {
        if (String(it.to?.hash ?? "").toLowerCase() !== burn) continue;
        const amt = Number(it.total?.value ?? 0) / 10 ** Number(it.total?.decimals ?? decimals);
        const ts = Date.parse(it.timestamp ?? "");
        if (amt > 0 && Number.isFinite(ts)) out.push({ ts, amount: amt });
      }
      const np = d.next_page_params;
      if (!np) break;
      next = new URLSearchParams(np as Record<string, string>).toString();
    } catch { break; }
  }
  return out;
}

function assess(events: BurnTx[], now: number): { cadence: string; medianIntervalDays: number | null; ongoing: boolean } {
  if (events.length === 0) return { cadence: "none", medianIntervalDays: null, ongoing: false };
  if (events.length === 1) return { cadence: "one-off", medianIntervalDays: null, ongoing: now - events[0].ts < 30 * DAY };
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) gaps.push((events[i].ts - events[i - 1].ts) / DAY);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  const cv = mean > 0 ? sd / mean : 0;
  const sinceLast = (now - events[events.length - 1].ts) / DAY;
  const last30 = events.filter((e) => now - e.ts < 30 * DAY).length;
  // "Regular" = evenly spaced (low CV) OR a frequent, still-active program (many
  // recent burns). A high-frequency ongoing burn is regular even if intervals
  // vary — that's what a hand-run burn program (e.g. $FIH) looks like.
  const cadence = sinceLast > 90 && median < 45 ? "stalled"
    : events.length >= 3 && (cv < 0.9 || (last30 >= 8 && sinceLast < 14)) ? "regular"
    : "irregular";
  return { cadence, medianIntervalDays: Math.round(median * 10) / 10, ongoing: sinceLast < 30 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").toLowerCase();
  const chain = String(req.query.chain ?? "ethereum");
  if (!/^0x[a-f0-9]{40}$/.test(address)) { res.status(400).json({ available: false, error: "bad address" }); return; }
  if (BURN_ADDRS.includes(address)) { res.status(200).json({ available: true, count: 0, cadence: "none" }); return; }

  let events: BurnTx[] = [];
  let supply: number | null = null;
  const bs = BLOCKSCOUT[chain];
  const esId = ETHERSCAN_CHAINID[chain];
  const esKey = process.env.ETHERSCAN_API_KEY;

  if (bs) {
    const tok = await blockscoutToken(bs, address);
    supply = tok?.supply ?? null;
    const lists = await Promise.all(BURN_ADDRS.map((b) => blockscoutBurns(bs, address, b, tok?.decimals ?? 18)));
    events = lists.flat();
  } else if (esId && esKey) {
    const [lists, sup] = await Promise.all([
      Promise.all(BURN_ADDRS.map((b) => etherscanBurns(esId, address, b, esKey))),
      etherscanSupply(esId, address, esKey),
    ]);
    events = lists.flatMap((l) => l.txs);
    // tokensupply returns RAW base units; convert to the same human units as the
    // burn amounts using the decimals seen on the tokentx rows (default 18).
    const decimals = lists.find((l) => l.decimals != null)?.decimals ?? 18;
    supply = sup != null ? sup / 10 ** decimals : null;
  } else {
    res.status(200).json({ available: false, note: bs ? "" : "burn history needs an Etherscan key or a Blockscout chain" });
    return;
  }

  events.sort((a, b) => a.ts - b.ts);
  const now = Date.now();
  const totalBurned = events.reduce((a, e) => a + e.amount, 0);
  const burnedSupplyPct = supply && supply > 0 ? Math.min(100, (totalBurned / supply) * 100) : null;
  const last30 = events.filter((e) => now - e.ts < 30 * DAY);
  const { cadence, medianIntervalDays, ongoing } = assess(events, now);
  const step = Math.max(1, Math.ceil(events.length / 60));
  let cum = 0;
  const series: { ts: number; cumulative: number }[] = [];
  events.forEach((e, i) => { cum += e.amount; if (i % step === 0 || i === events.length - 1) series.push({ ts: e.ts, cumulative: cum }); });

  res.status(200).json({
    available: true,
    count: events.length,
    totalBurned,
    burnedSupplyPct,
    firstBurnAt: events[0]?.ts ?? null,
    lastBurnAt: events[events.length - 1]?.ts ?? null,
    burnsLast30d: last30.length,
    burnedLast30d: last30.reduce((a, e) => a + e.amount, 0),
    cadence,
    medianIntervalDays,
    ongoing,
    series,
  });
}
