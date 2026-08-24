// Buyer-cohort / "Common Coins". GET /api/cohort?address=&chain=
//
// RAVN's strongest idea: the top holders of a token are not random - the same
// crowd farms the same tokens. We take the top holders and ask "what OTHER
// tokens do several of them hold?" A set of wallets that all hold the same
// obscure coins is a coordinated cohort (an insider farm / bundled crowd) that
// no single-token holder chart reveals. Computed ON DEMAND per scan (top ~20
// holders x their token lists), so we need no historical index - unlike RAVN,
// our answer is never stale. Auth-gated (spends provider budget); Solana via
// Helius getTokenAccountsByOwner, EVM via keyless Blockscout token-balances.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { arr, rec } from "../src/lib/json.js";
import { requireArgusAuth } from "./_auth.js";
import { ledgerRecordHolderEdges, ledgerWalletReputation } from "./_ledger.js";

export const config = { maxDuration: 45 };

const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[a-f0-9]{40}$/;
const MAX_HOLDERS = 20;

// Never a "common coin": the scanned token, stables, wrapped natives, and the
// blue-chip majors everyone holds (they'd be noise, not a cohort signal).
const IGNORE = new Set([
  "so11111111111111111111111111111111111111112", "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v",
  "es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb", "usdc", "usdt", "dai", "weth", "wbnb", "weth9",
  "0x0000000000000000000000000000000000000000",
]);
const IGNORE_SYM = /^(usdc|usdt|usds|usdg|dai|weth|wbnb|wsol|sol|eth|bnb|usd1|frax|busd|tusd)$/i;

const BLOCKSCOUT: Record<string, string> = {
  ethereum: "https://eth.blockscout.com", base: "https://base.blockscout.com",
  optimism: "https://optimism.blockscout.com", arbitrum: "https://arbitrum.blockscout.com",
  polygon: "https://polygon.blockscout.com", gnosis: "https://gnosis.blockscout.com",
  robinhood: "https://robinhoodchain.blockscout.com",
};

async function heliusTokens(key: string, owner: string): Promise<string[]> {
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return [];
    const d = rec(await r.json());
    const out: string[] = [];
    for (const a of arr(rec(d.result).value)) {
      const info = rec(rec(rec(rec(rec(a).account).data).parsed).info);
      if (info.mint && Number(rec(info.tokenAmount).uiAmount ?? 0) > 0) out.push(String(info.mint).toLowerCase());
    }
    return out;
  } catch { return []; }
}

async function blockscoutTokens(base: string, addr: string): Promise<{ mint: string; symbol: string }[]> {
  try {
    const r = await fetch(`${base}/api/v2/addresses/${addr}/token-balances`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const d = await r.json();
    const out: { mint: string; symbol: string }[] = [];
    for (const entry of arr(d)) {
      const t = rec(entry);
      const token = rec(t.token);
      if (String(token.type ?? "").includes("ERC-20") && Number(t.value ?? 0) > 0) {
        out.push({ mint: String(token.address).toLowerCase(), symbol: String(token.symbol ?? "") });
      }
    }
    return out;
  } catch { return []; }
}

// Top holder addresses (non-pool) for the token.
async function solHolders(mint: string): Promise<string[]> {
  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const rc = rec(await r.json());
    const ka = rec(rc.knownAccounts);
    return arr(rc.topHolders)
      .map((entry) => rec(entry))
      .filter((h) => { const l = rec(ka[String(h.address)] || ka[String(h.owner)]); return !(l.type && /market|amm|pool|liquid|lp/i.test(String(l.type))) && !h.insider; })
      .map((h) => String(h.owner || h.address || ""))
      .filter((a) => SOLADDR.test(a)).slice(0, MAX_HOLDERS);
  } catch { return []; }
}
async function evmHolders(chainid: number, token: string): Promise<string[]> {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainid}?contract_addresses=${token}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const d = rec(await r.json());
    const info = rec(rec(d.result)[token.toLowerCase()]);
    return arr(info.holders)
      .map((entry) => rec(entry))
      .filter((h) => h.is_contract !== 1)
      .map((h) => String(h.address ?? "").toLowerCase())
      .filter((a) => EVM.test(a)).slice(0, MAX_HOLDERS);
  } catch { return []; }
}

const GOPLUS_CHAIN: Record<string, string> = { ethereum: "1", bsc: "56", base: "8453", polygon: "137", arbitrum: "42161", optimism: "10", avalanche: "43114", robinhood: "4663" };

// DexScreener batch: symbol + mcap + liquidity for the common coins (a live
// outcome proxy - RAVN shows retro ATH; we show what the cohort's shared bags
// are worth NOW, sourced fresh).
async function enrich(chain: string, mints: string[]): Promise<Map<string, { symbol: string; mcap: number | null; liq: number | null }>> {
  const out = new Map<string, { symbol: string; mcap: number | null; liq: number | null }>();
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.slice(0, 30).join(",")}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return out;
    const d = rec(await r.json());
    for (const entry of arr(d.pairs)) {
      const p = rec(entry);
      const baseToken = rec(p.baseToken);
      const a = String(baseToken.address ?? "").toLowerCase();
      if (a && !out.has(a)) out.set(a, { symbol: String(baseToken.symbol ?? ""), mcap: (p.marketCap ?? p.fdv ?? null) as number | null, liq: (rec(p.liquidity).usd ?? null) as number | null });
    }
  } catch { /* best-effort */ }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const address = String(req.query.address ?? "").trim();
  const chain = String(req.query.chain ?? "").trim().toLowerCase();
  const sol = chain === "solana";
  if (sol ? !SOLADDR.test(address) : !EVM.test(address.toLowerCase())) { res.status(400).json({ error: "valid address required" }); return; }

  const self = address.toLowerCase();
  const verdict = String(req.query.verdict ?? "").slice(0, 12) || null;
  const symbol = String(req.query.symbol ?? "").slice(0, 24) || null;
  const holders = sol ? await solHolders(address) : await evmHolders(Number(GOPLUS_CHAIN[chain] ?? 0), address.toLowerCase());

  // Bank the holder -> token edges (fire-and-forget) so wallet reputation
  // compounds from now, and read back any prior track record for these holders.
  const holderAddrs = holders.map((h) => h);
  void ledgerRecordHolderEdges(address, symbol, verdict, holderAddrs).catch(() => {});
  const repMap = await ledgerWalletReputation(holderAddrs).catch(() => ({}));
  const repd = Object.values(repMap as Record<string, { held: number; dead: number }>);
  const reputation = {
    holdersWithHistory: repd.filter((r) => r.held > 0).length,
    holdersWithDeadBags: repd.filter((r) => r.dead > 0).length,
    topOffenders: Object.entries(repMap as Record<string, { held: number; dead: number; deadSymbols: string[] }>)
      .filter(([, r]) => r.dead > 0).sort((a, b) => b[1].dead - a[1].dead).slice(0, 6)
      .map(([wallet, r]) => ({ wallet, held: r.held, dead: r.dead, deadSymbols: r.deadSymbols })),
  };

  if (holders.length < 4) { res.status(200).json({ available: true, cohortSize: holders.length, commonCoins: [], reputation, note: "Too few non-pool holders resolved to build a cohort." }); return; }

  // Each holder's token list, in parallel (bounded).
  const key = process.env.HELIUS_API_KEY;
  const bs = BLOCKSCOUT[chain];
  if (sol && !key) { res.status(200).json({ available: false, note: "Helius not configured." }); return; }
  if (!sol && !bs) { res.status(200).json({ available: false, note: `Cohort overlap not available on ${chain} (no keyless holdings source).` }); return; }

  const lists = await Promise.all(holders.map(async (h) => {
    if (sol) return (await heliusTokens(key!, h)).map((m) => ({ mint: m, symbol: "" }));
    return blockscoutTokens(bs!, h);
  }));

  // Count how many holders hold each other token; a common coin = held by many.
  const count = new Map<string, number>();
  const symOf = new Map<string, string>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const t of list) {
      const m = t.mint;
      if (m === self || IGNORE.has(m) || IGNORE_SYM.test(t.symbol) || seen.has(m)) continue;
      seen.add(m);
      count.set(m, (count.get(m) ?? 0) + 1);
      if (t.symbol && !symOf.has(m)) symOf.set(m, t.symbol);
    }
  }
  const threshold = Math.max(4, Math.ceil(holders.length * 0.25));
  const common = [...count.entries()].filter(([, c]) => c >= threshold).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const meta = await enrich(chain, common.map(([m]) => m));
  const commonCoins = common.map(([mint, held]) => {
    const m = meta.get(mint);
    return {
      address: mint,
      symbol: m?.symbol || symOf.get(mint) || mint.slice(0, 6),
      heldBy: held,
      pctOfCohort: Math.round((held / holders.length) * 100),
      mcap: m?.mcap ?? null,
      liqUsd: m?.liq ?? null,
    };
  });

  res.status(200).json({
    available: true, chain, cohortSize: holders.length, threshold,
    commonCoins, reputation,
    note: commonCoins.length
      ? `${commonCoins.length} token(s) are held by ${threshold}+ of the ${holders.length} analyzed top holders - a shared-bag signature.`
      : `No shared holdings across ${threshold}+ of the ${holders.length} top holders - they look independent.`,
  });
}
