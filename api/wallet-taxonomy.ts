// Wallet taxonomy. GET /api/wallet-taxonomy?address=&chain=
//
// RAVN's holder-behaviour breakdown: classify a token's top holders by wallet
// AGE and FUNDING, with % of supply per cohort. A wall of "fresh, CEX-funded"
// top holders on a day-old token is a sniper/farm signature the holder chart
// hides. Keyless-first: EVM age + first funder via Etherscan txlist, CEX-funded
// via a curated hot-wallet list; Solana age via Helius signatures. Bounded and
// best-effort - any wallet that can't be read is "unknown", never fatal.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { arr, rec } from "../src/lib/json.js";

export const config = { maxDuration: 30 };

const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[a-f0-9]{40}$/;
const MAX = 15;
const DAY = 86400_000;

const ETHERSCAN_CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161, optimism: 10, avalanche: 43114, robinhood: 4663,
};
const GOPLUS_CHAIN: Record<string, string> = { ethereum: "1", bsc: "56", base: "8453", polygon: "137", arbitrum: "42161", optimism: "10", avalanche: "43114", robinhood: "4663" };

// Curated CEX/bridge hot wallets (funding source => "CEX-funded"). The big
// exchanges cover the large majority of the signal; a long-tail label service
// (eth-labels/Vybe) is a later enhancement. Lowercased. EVM + a few Solana.
const CEX_WALLETS = new Set([
  // Binance (EVM)
  "0x28c6c06298d514db089934071355e5743bf21d60", "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976", "0x4976a4a02f38326660d17bf34b431dc6e2eb2327",
  // Coinbase
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", "0x503828976d22510aad0201ac7ec88293211d23da",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740", "0x3cd751e6b0078be393132286c442345e5dc49699",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43", "0xeb2629a2734e272bcc07bda959863f316f4bd4cf",
  // OKX / Kraken / Bybit / KuCoin / Gate / Bitget / MEXC / Crypto.com
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b", "0x2c8fbb630289363ac80705a1a61273f76fd5a161",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40", "0x0d0707963952f2fba59dd06f2b425ace40b492fe",
  "0x1522900b6dafac587d499a862861c0869be6e428", "0x5041ed759dd4afc3a72b8192c143f72f4724081a",
  "0x0681d8db095565fe8a346fa0277bffde9c0edbbf", "0xfe9e8709d3215310075d67e3ed32a380ccf451c8",
  "0x9642b23ed1e01df1092b92641051881a322f5d4e", "0xe93381fb4c4f14bda253907b18fad305d799241a",
  "0xf60c2ea62edbfe808163751dd0d8693dcb30019c",
]);

// One Etherscan call per wallet. txlist (normal txns) is empty for the many
// holder addresses that never initiate a native tx - so use tokentx (token
// TRANSFERS), which every token holder necessarily has. The oldest token
// transfer dates the wallet's first on-chain activity (age); its sender is the
// first funder (CEX-funded when it's a known hot wallet).
async function evmClassify(chainid: number, wallet: string, key: string): Promise<{ ageDays: number | null; lastDays: number | null; cexFunded: boolean } | null> {
  try {
    const q = new URLSearchParams({ chainid: String(chainid), module: "account", action: "tokentx", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "1", sort: "asc", apikey: key });
    const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = rec(await r.json());
    if (d.status === "0" && /rate limit/i.test(String(d.message ?? d.result ?? ""))) return null;
    // rec() of a missing element would be a truthy {}, so the absent case is
    // kept as an explicit null exactly as it was.
    const rawFirst = Array.isArray(d.result) ? (d.result[0] as unknown) : null;
    const first = rawFirst == null ? null : rec(rawFirst);
    const firstTs = first ? Number(first.timeStamp) * 1000 : null;
    const firstFrom = first ? String(first.from ?? "").toLowerCase() : "";
    const now = Date.now();
    return {
      ageDays: firstTs ? Math.max(0, (now - firstTs) / DAY) : null,
      lastDays: null,
      cexFunded: CEX_WALLETS.has(firstFrom),
    };
  } catch { return null; }
}

// Run classify in small chunks so we respect Etherscan's ~5 req/s free tier.
async function inChunks<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>, gapMs = 250): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    if (i + size < items.length) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}

async function solClassify(key: string, wallet: string): Promise<{ ageDays: number | null; lastDays: number | null; cexFunded: boolean } | null> {
  try {
    const rpc = async (params: unknown) => {
      const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params }), signal: AbortSignal.timeout(9000) });
      return r.ok ? ((await r.json()) as unknown) : null;
    };
    const d = await rpc([wallet, { limit: 1000 }]);
    const sigs = arr(rec(d).result);
    if (!sigs.length) return { ageDays: null, lastDays: null, cexFunded: false };
    const newest = Number(rec(sigs[0]).blockTime ?? 0) * 1000;
    const oldest = Number(rec(sigs[sigs.length - 1]).blockTime ?? 0) * 1000;
    const now = Date.now();
    // <1000 sigs means we saw the wallet's whole life; oldest = first activity.
    const ageDays = oldest ? (now - oldest) / DAY : null;
    return { ageDays: sigs.length < 1000 && ageDays != null ? ageDays : null, lastDays: newest ? (now - newest) / DAY : null, cexFunded: false };
  } catch { return null; }
}

async function solHolders(mint: string): Promise<{ addr: string; pct: number }[]> {
  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const rc = rec(await r.json());
    const ka = rec(rc.knownAccounts);
    return arr(rc.topHolders)
      .map((entry) => rec(entry))
      // String() rather than a "" default: property access already coerces a
      // missing key to the string "undefined", and that lookup must not move.
      .filter((h) => { const l = rec(ka[String(h.address)] || ka[String(h.owner)]); return !(l.type && /market|amm|pool|liquid|lp/i.test(String(l.type))) && !h.insider; })
      .map((h) => ({ addr: String(h.owner || h.address || ""), pct: Number(h.pct ?? 0) }))
      .filter((h) => SOLADDR.test(h.addr)).slice(0, MAX);
  } catch { return []; }
}
async function evmHolders(chainid: number, token: string): Promise<{ addr: string; pct: number }[]> {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainid}?contract_addresses=${token}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const d = rec(await r.json());
    const info = rec(rec(d.result)[token.toLowerCase()]);
    return arr(info.holders)
      .map((entry) => rec(entry))
      .filter((h) => h.is_contract !== 1)
      // The second Number() keeps its missing default off deliberately: an
      // absent percent yields NaN, NaN <= 1 is false, so the multiplier stays 1.
      .map((h) => ({ addr: String(h.address ?? "").toLowerCase(), pct: Number(h.percent ?? 0) * (Number(h.percent) <= 1 ? 100 : 1) }))
      .filter((h) => EVM.test(h.addr)).slice(0, MAX);
  } catch { return []; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").trim();
  const chain = String(req.query.chain ?? "").trim().toLowerCase();
  const sol = chain === "solana";
  if (sol ? !SOLADDR.test(address) : !EVM.test(address.toLowerCase())) { res.status(400).json({ error: "valid address required" }); return; }
  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=1800");

  const key = process.env.HELIUS_API_KEY;
  const esKey = process.env.ETHERSCAN_API_KEY;
  const chainid = ETHERSCAN_CHAINID[chain];
  if (sol && !key) { res.status(200).json({ available: false, note: "Helius not configured." }); return; }
  if (!sol && (!chainid || !esKey)) { res.status(200).json({ available: false, note: `Wallet taxonomy needs an Etherscan-covered chain (${chain} not supported).` }); return; }

  const holders = sol ? await solHolders(address) : await evmHolders(Number(GOPLUS_CHAIN[chain] ?? 0), address.toLowerCase());
  if (!holders.length) { res.status(200).json({ available: true, analyzed: 0, cohorts: {}, note: "No non-pool top holders resolved." }); return; }

  const rows = await inChunks(holders, sol ? 8 : 4, async (h) => {
    const c = sol ? await solClassify(key!, h.addr) : await evmClassify(chainid, h.addr, esKey!);
    return { ...h, ...(c ?? { ageDays: null, lastDays: null, cexFunded: false }) };
  });

  const bucket = { fresh: { n: 0, pct: 0 }, recent: { n: 0, pct: 0 }, dormant: { n: 0, pct: 0 }, cexFunded: { n: 0, pct: 0 }, aged: { n: 0, pct: 0 }, unknown: { n: 0, pct: 0 } };
  for (const r of rows) {
    if (r.cexFunded) { bucket.cexFunded.n++; bucket.cexFunded.pct += r.pct; }
    if (r.ageDays == null) { bucket.unknown.n++; bucket.unknown.pct += r.pct; }
    else if (r.ageDays < 3) { bucket.fresh.n++; bucket.fresh.pct += r.pct; }
    else if (r.ageDays < 30) { bucket.recent.n++; bucket.recent.pct += r.pct; }
    else { bucket.aged.n++; bucket.aged.pct += r.pct; }
    if (r.lastDays != null && r.lastDays > 30) { bucket.dormant.n++; bucket.dormant.pct += r.pct; }
  }
  const round = (o: { n: number; pct: number }) => ({ n: o.n, pct: Math.round(o.pct * 10) / 10 });

  res.status(200).json({
    available: true, chain, analyzed: rows.length,
    cohorts: { fresh: round(bucket.fresh), recent: round(bucket.recent), aged: round(bucket.aged), dormant: round(bucket.dormant), cexFunded: round(bucket.cexFunded), unknown: round(bucket.unknown) },
    note: `${rows.length} top holders classified by wallet age and funding.${sol ? " CEX-funding tags are EVM-only for now." : ""}`,
  });
}
