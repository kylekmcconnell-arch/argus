// Sell-structure / bad-seller analysis. GET /api/sell-structure?address=&chain=[&creator=]
//
// The scanner already answers "CAN holders sell" (honeypot sim) and "who is
// POSITIONED to dump" (insider funding clusters). This answers the third
// question: who has ACTUALLY been selling, how much, and are they the bad
// actors. Sells are transfers INTO a pool/router; buys are transfers OUT of one.
// Per wallet we net bought vs sold to get realized exit, then flag the sellers
// that matter: the deployer/creator ("dev sold"), wallets the deployer seeded
// directly (a funded dump), and launch-block snipers who've since unloaded.
// EVM only here (keyless via Etherscan tokentx); Solana is a Helius follow-on.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const ETHERSCAN_CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, robinhood: 4663,
};
// GeckoTerminal network slugs (keyless trades tape). Robinhood not covered.
const GECKO_NET: Record<string, string> = {
  ethereum: "eth", bsc: "bsc", base: "base", polygon: "polygon_pos",
  arbitrum: "arbitrum", optimism: "optimism", avalanche: "avax", solana: "solana",
};
const EVM = /^0x[a-f0-9]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";
// AMM custody/routers that never "fan out" like a pool (V4 singleton holds every
// pool; routers relay) - a transfer to these is a sell even if the heuristic
// misses them. Matches the client tokenomics singleton set.
const KNOWN_POOLS = new Set([
  "0x000000000004444c5dc75cb358380d2e3de08a90", "0x498581ff718922c3f8e6a244956af099b2652b2b",
  "0x360e68faccca8ca495c1b759fd9eee466db9fb32", "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
  "0x67366782805870060151383f4bbff9dab53e5cd6", "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df", // Uniswap V4 PoolManagers
  "0xba12222222228d8ba445958a75a0704d566bf2c8", // Balancer V2 Vault
  "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544", // Doppler hook initializer (Bankr)
  // Universal Routers - V4 swaps often show the router (not the PoolManager) as
  // the ERC20 counterparty; a transfer to the router is still a sell in flow terms.
  "0x6ff5693b99212da76ad316178a184ab56d299b43", // Universal Router - Ethereum
  "0x6fF5693b99212Da76ad316178A184AB56D299b43".toLowerCase(),
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Universal Router (v1) - multi-chain
  "0x2626664c2603336e57b271c5c0b26f421741e481", // SwapRouter02 - Base
  "0x198ef79f1f515f02dfe9e3115ed9fc07183f02fc", // Universal Router - Base
]);
const PAGE = 1000, MAX_PAGES = 6; // bounded: ~6k transfers, oldest first

async function tokentx(chainid: number, token: string, key: string): Promise<{ txs: any[]; truncated: boolean }> {
  const out: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      chainid: String(chainid), module: "account", action: "tokentx", contractaddress: token,
      startblock: "0", endblock: "99999999", page: String(page), offset: String(PAGE), sort: "asc", apikey: key,
    });
    const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!r?.ok) break;
    const d = (await r.json()) as any;
    if (d.status !== "1" || !Array.isArray(d.result) || !d.result.length) break;
    out.push(...d.result);
    if (d.result.length < PAGE) return { txs: out, truncated: false };
  }
  return { txs: out, truncated: out.length >= PAGE * MAX_PAGES };
}

// Recent 24h trade tape via GeckoTerminal (keyless, per-wallet USD, already
// classified buy/sell). This is the reliable "who is selling now" primary
// source - independent of Etherscan history, which rate-limits and misses
// V4-routed tokens. Bounded to the token's deepest pool and the API's recent
// window (~300 trades).
async function geckoTape(net: string, token: string, deployer: string) {
  try {
    const pr = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${token}/pools?page=1`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (!pr.ok) return null;
    const pd = (await pr.json()) as any;
    const pool = pd?.data?.[0]?.attributes?.address;
    if (!pool) return null;
    const tr = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/trades`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (!tr.ok) return null;
    const td = (await tr.json()) as any;
    const trades = Array.isArray(td?.data) ? td.data : [];
    const now = Date.now();
    const sells = new Map<string, number>(), buys = new Map<string, number>();
    let sellUsd = 0, buyUsd = 0, sN = 0, bN = 0;
    for (const t of trades) {
      const a = t?.attributes ?? {};
      const w = String(a.tx_from_address ?? "").toLowerCase();
      const usd = Number(a.volume_in_usd ?? 0);
      const ts = a.block_timestamp ? Date.parse(a.block_timestamp) : 0;
      if (!w || !(now - ts < 24 * 3600_000)) continue;
      if (a.kind === "sell") { sN++; sellUsd += usd; sells.set(w, (sells.get(w) ?? 0) + usd); }
      else if (a.kind === "buy") { bN++; buyUsd += usd; buys.set(w, (buys.get(w) ?? 0) + usd); }
    }
    if (sN === 0 && bN === 0) return null;
    const topSellers = [...sells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([wallet, usd]) => ({
      wallet, usd: Math.round(usd), isDeployer: !!deployer && wallet === deployer, isCreator: false,
    }));
    const ratio = bN > 0 ? sN / bN : sN;
    return {
      sells: sN, buys: bN, sellUsd: Math.round(sellUsd), buyUsd: Math.round(buyUsd),
      distinctSellers: sells.size, distinctBuyers: buys.size, topSellers,
      note: `Last 24h: ${sN} sells ($${Math.round(sellUsd).toLocaleString()}) vs ${bN} buys ($${Math.round(buyUsd).toLocaleString()}) across ${sells.size} sellers / ${buys.size} buyers.${bN === 0 && sN > 0 ? " No buyers - only exits." : ratio >= 3 ? " Heavily sell-skewed." : ""}`,
    };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawAddr = String(req.query.address ?? "").trim();
  const chain = String(req.query.chain ?? "").toLowerCase();
  const sol = chain === "solana";
  const creator = String(req.query.creator ?? "").toLowerCase();
  const address = sol ? rawAddr : rawAddr.toLowerCase();
  const validAddr = sol ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : EVM.test(address);
  if (!validAddr) { res.status(400).json({ error: "bad address" }); return; }
  const chainid = ETHERSCAN_CHAINID[chain];
  const key = process.env.ETHERSCAN_API_KEY;
  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=1800");

  // Recent trade tape first - the reliable primary source, always attempted
  // (keyless, and the ONLY source on Solana - Etherscan history is EVM-only).
  const recentTape = GECKO_NET[chain] ? await geckoTape(GECKO_NET[chain], address, sol ? creator : creator) : null;

  if (sol || !chainid || !key) { res.status(200).json({ available: !!recentTape, hit: !!recentTape, recentTape, devSold: null, sellerCount: 0, badSellerCount: 0, topSellers: [], note: recentTape ? "" : (sol ? "No recent trades found for this token." : "Recent-tape only (no Etherscan history source for this chain).") }); return; }

  const { txs, truncated } = await tokentx(chainid, address, key);
  // Etherscan history is best-effort; if it's empty/rate-limited we still return
  // the GeckoTerminal tape, which is the more reliable "who's selling" answer.
  if (!txs.length) { res.status(200).json({ available: !!recentTape, hit: !!recentTape, recentTape, devSold: null, sellerCount: 0, badSellerCount: 0, topSellers: [], note: recentTape ? "" : "No Etherscan token-transfer history (rate-limited or unindexed) and no recent trades." }); return; }
  const dec = Number(txs[0]?.tokenDecimal ?? 18);
  const amt = (v: unknown) => Number(v ?? 0) / 10 ** dec;
  const mint = txs.find((t) => String(t.from).toLowerCase() === ZERO);
  const supply = mint ? amt(mint.value) : null;

  // Pools = addresses that both send to and receive from many distinct
  // counterparties (AMM behavior), plus the known custody/router set.
  const sends = new Map<string, Set<string>>();
  const recvs = new Map<string, Set<string>>();
  for (const t of txs) {
    const f = String(t.from).toLowerCase(), to = String(t.to).toLowerCase();
    if (f !== ZERO) (sends.get(f) ?? sends.set(f, new Set()).get(f)!).add(to);
    (recvs.get(to) ?? recvs.set(to, new Set()).get(to)!).add(f);
  }
  const pools = new Set<string>(KNOWN_POOLS);
  for (const [a, tos] of sends) if (tos.size >= 4 && (recvs.get(a)?.size ?? 0) >= 4) pools.add(a);
  const isPool = (a: string) => pools.has(a);

  // Per-wallet flow + first funder (for deployer-seeded detection).
  type W = { bought: number; sold: number; firstFrom: string | null; firstBlock: number; soldToPool: boolean };
  const w = new Map<string, W>();
  const touch = (a: string, block: number, from: string): W => {
    let x = w.get(a);
    if (!x) { x = { bought: 0, sold: 0, firstFrom: from, firstBlock: block, soldToPool: false }; w.set(a, x); }
    return x;
  };
  let launchBlock = Infinity;
  for (const t of txs) {
    const f = String(t.from).toLowerCase(), to = String(t.to).toLowerCase(), v = amt(t.value), b = Number(t.blockNumber);
    if (isPool(f) && !isPool(to)) { touch(to, b, f).bought += v; if (b < launchBlock) launchBlock = b; }       // buy
    else if (isPool(to) && !isPool(f)) { const x = touch(f, b, to); x.sold += v; x.soldToPool = true; }         // sell
    else if (!isPool(f) && !isPool(to) && f !== ZERO) { if (!w.has(to)) touch(to, b, f); }                       // transfer-in (funding)
  }

  const sellers = [...w.entries()].filter(([, x]) => x.sold > 0);
  const pctS = (v: number) => (supply && supply > 0 ? (v / supply) * 100 : null);
  const devSold = creator && EVM.test(creator) ? (w.get(creator)?.soldToPool ?? false) : null;

  const ranked = sellers.map(([wallet, x]) => {
    const realizedExitPct = x.bought > 0 ? Math.min(100, (x.sold / x.bought) * 100) : 100; // sold with no recorded buy = seeded/airdropped exit
    const sameBlockSniper = x.firstBlock === launchBlock && x.bought > 0;
    const isDeployer = !!creator && wallet === creator;
    const deployerSeeded = !!creator && x.firstFrom === creator && x.bought === 0; // got tokens straight from the deployer, not the pool, then sold
    const flags: string[] = [];
    if (isDeployer) flags.push("deployer/creator wallet");
    if (deployerSeeded) flags.push("seeded directly by the deployer");
    if (sameBlockSniper) flags.push("launch-block sniper");
    if (x.bought > 0 && realizedExitPct >= 90) flags.push("exited ~all of its position");
    return { wallet, soldPct: pctS(x.sold), boughtPct: pctS(x.bought), realizedExitPct: Math.round(realizedExitPct), sameBlockSniper, isDeployer, deployerSeeded, flags };
  }).sort((a, b) => (b.soldPct ?? 0) - (a.soldPct ?? 0));

  const bad = ranked.filter((s) => s.flags.length > 0);
  const soldToPoolTotalPct = pctS(sellers.reduce((a, [, x]) => a + Math.min(x.sold, x.bought || x.sold), 0));

  res.status(200).json({
    available: true, hit: true, chain, truncated,
    poolCount: pools.size, launchBlock: Number.isFinite(launchBlock) ? launchBlock : null,
    sellerCount: sellers.length,
    devSold,
    soldToPoolTotalPct,
    badSellerCount: bad.length,
    topSellers: ranked.slice(0, 12),
    recentTape,
    note: truncated ? "Based on the token's first ~6k transfers; very active tokens are analyzed partially." : "",
  });
}
