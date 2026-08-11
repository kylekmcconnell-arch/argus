// Launch tracing. GET /api/launch?address=<addr>&chain=<chain>[&creator=<addr>]
//
// Two jobs, both about the token's FIRST moments:
//  1. SNIPE TRACE (EVM): read the token's earliest transfers and count distinct
//     buyers inside the launch block(s) - a cluster of wallets buying in the
//     same block the pool went live is a coordinated entry at t=0, which is the
//     on-chain signature of a bundled launch.
//  2. LAUNCHPAD STATE (Solana): proxy the launch venue's public API for
//     bonding-curve state (progress / graduated) and creator-fee activity, so
//     the client never depends on a third-party CORS policy.
// Everything degrades to nulls - a missing key or unsupported chain returns
// available:false rather than an error.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const ETHERSCAN_CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, robinhood: 4663,
};
const EVM = /^0x[a-f0-9]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---- EVM snipe trace ----
// The earliest token transfers, oldest first. The first swap-out transfers from
// the pool are the launch buys; distinct recipients in the pool's first active
// block are the same-block snipers.
async function evmSnipe(chainid: number, token: string, key: string) {
  try {
    const q = new URLSearchParams({
      chainid: String(chainid), module: "account", action: "tokentx",
      contractaddress: token, startblock: "0", endblock: "99999999",
      page: "1", offset: "300", sort: "asc", apikey: key,
    });
    const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(14000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    if (d.status !== "1" || !Array.isArray(d.result) || !d.result.length) return null;
    const txs = d.result as any[];

    // Identify the pool: the address that SENDS to many distinct recipients in
    // the early window (swap outs). Mint/deploy transfers come from 0x0 or the
    // deployer to one or two addresses; the pool fans out.
    const bySender = new Map<string, Set<string>>();
    for (const t of txs) {
      const from = String(t.from ?? "").toLowerCase();
      const to = String(t.to ?? "").toLowerCase();
      if (!from || !to || from === "0x0000000000000000000000000000000000000000") continue;
      (bySender.get(from) ?? bySender.set(from, new Set()).get(from)!).add(to);
    }
    let pool: string | null = null;
    let fan = 0;
    for (const [snd, tos] of bySender) if (tos.size > fan) { fan = tos.size; pool = snd; }
    if (!pool || fan < 2) return null;

    // Buys = transfers FROM the pool. Group by block; the pool's first active
    // block is the launch block.
    const buys = txs.filter((t) => String(t.from ?? "").toLowerCase() === pool);
    if (!buys.length) return null;
    const firstBlock = Number(buys[0].blockNumber);
    const inLaunchBlock = buys.filter((t) => Number(t.blockNumber) === firstBlock);
    const sameBlockBuyers = new Set(inLaunchBlock.map((t) => String(t.to).toLowerCase())).size;
    const within3 = buys.filter((t) => Number(t.blockNumber) <= firstBlock + 2);
    const buyers3 = new Set(within3.map((t) => String(t.to).toLowerCase())).size;

    // % of supply taken in the launch block, when supply is derivable from the
    // mint transfer (from 0x0) in the same page of results.
    const mint = txs.find((t) => String(t.from ?? "").toLowerCase() === "0x0000000000000000000000000000000000000000");
    const dec = Number(mint?.tokenDecimal ?? buys[0]?.tokenDecimal ?? 18);
    const supply = mint ? Number(mint.value) / 10 ** dec : null;
    const taken = inLaunchBlock.reduce((a, t) => a + Number(t.value) / 10 ** dec, 0);
    const pctOfSupply = supply && supply > 0 ? Math.min(100, (taken / supply) * 100) : null;

    return {
      window: `first block ${firstBlock}${within3.length > inLaunchBlock.length ? ` (+2 blocks: ${buyers3} buyers)` : ""}`,
      buyers: buyers3,
      sameBlockBuyers,
      pctOfSupply,
      note: `${sameBlockBuyers} distinct wallets received tokens from the pool in its first active block.`,
    };
  } catch {
    return null;
  }
}

// ---- Solana launchpad state (pump.fun family) ----
// Public frontend API; proxied server-side so the client isn't at the mercy of
// CORS or host changes. Best-effort: any failure returns null.
async function pumpfunState(mint: string) {
  // frontend-api-v3 is the live host (verified 2026-08-10; the old
  // frontend-api host is dead). Fields verified: complete (graduation bool),
  // creator, pump_swap_pool / raydium_pool (pre-2025 grads), real_sol_reserves.
  // The curve completes at ~85 SOL raised, so progress derives from reserves.
  try {
    const r = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    if (!d || typeof d !== "object") return null;
    const realSol = typeof d.real_sol_reserves === "number" ? d.real_sol_reserves / 1e9 : null;
    return {
      complete: !!d.complete,
      raydiumPool: d.pump_swap_pool ?? d.raydium_pool ?? null,
      creator: typeof d.creator === "string" ? d.creator : null,
      curvePct: d.complete ? 100 : realSol != null ? Math.min(99, (realSol / 85) * 100) : null,
      usdMarketCap: typeof d.usd_market_cap === "number" ? d.usd_market_cap : null,
    };
  } catch {
    return null;
  }
}

// ---- creator-contract venue check (Robinhood Chain) ----
// Pons pools read as plain uniswap v3/WETH on DexScreener - the only reliable
// fingerprint is the token's creator: PonsLaunchFactory. Both addresses
// Blockscout-verified 2026-08-10 (active + legacy factory).
const PONS_FACTORIES = new Set([
  "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb", // PonsLaunchFactory (active, verified)
  "0x0c37a24f5d23a486fa692d1500881d698b1f77a4", // legacy factory (docs)
]);
// Bankr launches on Base/Robinhood run on Doppler protocol (not Clanker since
// mid-2026): no vanity suffix, no fixed deployer EOA (per-user 4337 wallets) -
// but Bankr's own keyless API resolves any of its Doppler tokens per-address.
// (Verified live on $KUPO 2026-08-11; clanker.world's by-address lookup is now
// key-gated, so this is the reliable probe.)
async function bankrDopplerCheck(token: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.bankr.bot/public/doppler/token-fees/${token}`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return false;
    const d = (await r.json()) as any;
    return !!(d && (d.poolId || d.initializer || d.data?.poolId));
  } catch {
    return false;
  }
}

async function robinhoodCreatorVenue(token: string): Promise<string | null> {
  try {
    const r = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${token}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const creator = String(d.creator_address_hash ?? "").toLowerCase();
    if (PONS_FACTORIES.has(creator)) return "pons";
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").trim();
  const chain = String(req.query.chain ?? "").trim().toLowerCase();
  if (!address || !chain) { res.status(400).json({ error: "address and chain required" }); return; }
  res.setHeader("cache-control", "s-maxage=600, stale-while-revalidate=3600");

  if (chain === "solana") {
    if (!SOL_ADDR.test(address)) { res.status(400).json({ error: "bad address" }); return; }
    // Only pump.fun mints live on the pump.fun API - bonk/LaunchLab tokens are
    // Raydium's program (their on-curve state shows via the launchlab dexId).
    const pump = /pump$/.test(address) ? await pumpfunState(address) : null;
    res.status(200).json({ available: true, chain, pumpfun: pump, snipe: null });
    return;
  }

  const chainid = ETHERSCAN_CHAINID[chain];
  const key = process.env.ETHERSCAN_API_KEY;
  const addr = address.toLowerCase();
  if (!EVM.test(addr)) { res.status(400).json({ error: "bad address" }); return; }
  let creatorVenue = chain === "robinhood" ? await robinhoodCreatorVenue(addr) : null;
  if (!creatorVenue && (chain === "base" || chain === "robinhood")) {
    creatorVenue = (await bankrDopplerCheck(addr)) ? "bankr" : null;
  }
  if (!chainid || !key) { res.status(200).json({ available: !!creatorVenue, note: "snipe trace needs an Etherscan-covered chain and key", creatorVenue, pumpfun: null, snipe: null }); return; }
  const snipe = await evmSnipe(chainid, addr, key);
  res.status(200).json({ available: true, chain, pumpfun: null, snipe, creatorVenue });
}
