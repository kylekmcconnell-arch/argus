// Behind the Ledger - pure transfer-graph analysis core (no I/O, fully
// testable). Underscore-prefixed so Vercel does not deploy it as a route;
// api/behindledger.ts fetches the raw logs and calls into here.
//
// The method (proven by hand on $BULL/Robinhood, 2026-08-15): take the token's
// full Transfer history, classify every address by its flow shape, then answer
// where sold tokens actually CAME FROM:
//   - genesis + allocation vaults -> presale/insider supply (tranche claims)
//   - emission farms -> "farming activity" (repeated payouts to many wallets)
//   - venues/routers/arb bots -> infrastructure, excluded from "user" selling
//   - everyone else -> traders (re-selling bought tokens = churn) or
//     wallet-hop funded sellers (fresh single-purpose feeder wallets)
// Sells are resolved to their true origin by walking transfer hops WITHIN one
// transaction (router/fee-path custody is transparent, not a seller).

export interface LedgerTransfer {
  b: number; // block number
  tx: string;
  li: number; // log index (orders hops within a tx)
  f: string; // from, lowercase
  t: string; // to, lowercase
  v: number; // amount in whole tokens (decimals already applied)
}

export interface AddressClasses {
  genesis: Set<string>; // direct mint recipients
  vaults: Set<string>; // presale/insider allocation stores fed by genesis
  farms: Set<string>; // emission contracts: many payouts, many wallets, multi-day
  venues: Set<string>; // pools/pool-managers/routers: same-tx passthrough at scale
  bots: Set<string>; // arb shuttles: same-tx passthrough, fewer counterparties
  burn: Set<string>;
}

export interface FarmStat { address: string; payouts: number; recipients: number; tokensOut: number; activeDays: number }
export interface VaultStat { address: string; claimants: number; tokensOut: number }

export interface SellerRow {
  address: string;
  sold: number;
  trades: number;
  farmPct: number; // share of their supply that came from emission farms
  vaultPct: number; // ... from presale/insider vaults
  boughtPct: number; // ... bought back from venues (churn)
  otherPct: number; // ... plain wallet transfers
  hopFunded: boolean; // fed through fresh single-purpose wallets
}

export interface LedgerAttribution {
  totalUserSold: number; // venue inflow resolved to real users (bots excluded)
  botShuttled: number; // arb volume moved between venues, not user exit
  farmPct: number;
  vaultPct: number;
  churnPct: number;
  hopPct: number;
  otherPct: number;
  earlyWindowSoldPct: number; // share of all user selling that happened in the launch window
  earlyVaultSoldPct: number; // share of vault-sourced selling that happened in the launch window
  sellers: SellerRow[];
}

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

interface Stat {
  in: number; out: number; nIn: number; nOut: number;
  outPeers: Set<string>; inPeers: Set<string>;
  firstB: number; lastB: number;
  sameTxPassthrough: number; // outgoing volume whose tx also fed this address
}

export function addressStats(transfers: LedgerTransfer[]): Map<string, Stat> {
  const m = new Map<string, Stat>();
  const get = (a: string): Stat => {
    let s = m.get(a);
    if (!s) { s = { in: 0, out: 0, nIn: 0, nOut: 0, outPeers: new Set(), inPeers: new Set(), firstB: Infinity, lastB: 0, sameTxPassthrough: 0 }; m.set(a, s); }
    return s;
  };
  // per-tx inflow marker for the passthrough test
  const txInflow = new Map<string, Set<string>>(); // tx -> addresses fed in that tx
  for (const t of transfers) {
    let set = txInflow.get(t.tx);
    if (!set) { set = new Set(); txInflow.set(t.tx, set); }
    set.add(t.t);
  }
  for (const t of transfers) {
    const f = get(t.f), r = get(t.t);
    f.out += t.v; f.nOut++; f.outPeers.add(t.t); f.firstB = Math.min(f.firstB, t.b); f.lastB = Math.max(f.lastB, t.b);
    r.in += t.v; r.nIn++; r.inPeers.add(t.f); r.firstB = Math.min(r.firstB, t.b); r.lastB = Math.max(r.lastB, t.b);
    if (txInflow.get(t.tx)?.has(t.f)) f.sameTxPassthrough += t.v;
  }
  return m;
}

// Classify every address from its flow shape alone. `pair` (the DEX pool from
// the dossier) is always a venue; everything else is inferred.
export function classifyAddresses(
  transfers: LedgerTransfer[],
  stats: Map<string, Stat>,
  opts: { pair?: string; blocksPerDay: number; totalMinted: number },
): AddressClasses {
  const genesis = new Set<string>();
  const vaults = new Set<string>();
  const farms = new Set<string>();
  const venues = new Set<string>();
  const bots = new Set<string>();
  const burn = new Set<string>([ZERO, DEAD]);
  if (opts.pair) venues.add(opts.pair.toLowerCase());

  for (const t of transfers) if (t.f === ZERO) genesis.add(t.t);

  // Vaults: fed >=0.5% of supply straight from genesis (or genesis itself when
  // it distributes onward) - the presale/allocation tier.
  const vaultFloor = opts.totalMinted * 0.005;
  const fromGenesis = new Map<string, number>();
  for (const t of transfers) {
    if (genesis.has(t.f) && !genesis.has(t.t) && t.t !== ZERO) {
      fromGenesis.set(t.t, (fromGenesis.get(t.t) ?? 0) + t.v);
    }
  }
  for (const [a, v] of fromGenesis) {
    const s = stats.get(a);
    // an allocation store distributes onward; a plain whale just holds
    if (v >= vaultFloor && s && s.nOut >= 2) vaults.add(a);
  }

  // Same-tx passthrough at scale = swap infrastructure. Two sub-shapes matter:
  // an ARB BOT trades venue-to-venue (both legs on venues), while a router or
  // launchpad fee-path CUSTODIAN stands between users and a venue (one leg).
  // Custodians must stay walkable (a sell through them belongs to the feeder);
  // only true bots are excluded from user selling.
  const passthrough: string[] = [];
  for (const [a, s] of stats) {
    if (genesis.has(a) || vaults.has(a) || burn.has(a) || venues.has(a)) continue;
    const flow = Math.max(s.in, s.out);
    if (flow <= 0 || s.nOut < 20) continue;
    // A POOL is not same-tx passthrough (a swap's output comes from inventory,
    // not that tx's inflow) - its signature is two-sided flow from MANY
    // independent wallets on both sides. Catch pools/pool-managers first.
    if (s.inPeers.size >= 50 && s.outPeers.size >= 50 && s.nIn >= 100 && s.nOut >= 100) {
      venues.add(a);
      continue;
    }
    const balanced = Math.abs(s.in - s.out) <= flow * 0.05;
    const passShare = s.out > 0 ? s.sameTxPassthrough / s.out : 0;
    if (balanced && passShare >= 0.8) {
      // everyone-touches-it scale is a venue outright (main router)
      if (s.outPeers.size >= 200 || s.inPeers.size >= 200) venues.add(a);
      else passthrough.push(a);
    }
  }
  // Split the remaining passthroughs by which side of them touches venues.
  const venueIn = new Map<string, number>();
  const venueOut = new Map<string, number>();
  for (const t of transfers) {
    if (venues.has(t.f)) venueIn.set(t.t, (venueIn.get(t.t) ?? 0) + t.v);
    if (venues.has(t.t)) venueOut.set(t.f, (venueOut.get(t.f) ?? 0) + t.v);
  }
  for (const a of passthrough) {
    const s = stats.get(a)!;
    const inShare = s.in > 0 ? (venueIn.get(a) ?? 0) / s.in : 0;
    const outShare = s.out > 0 ? (venueOut.get(a) ?? 0) / s.out : 0;
    if (inShare >= 0.9 && outShare >= 0.9) bots.add(a); // venue-to-venue: arb
    else venues.add(a); // one-legged: custody path, walk sells through it
  }
  for (const [a, s] of stats) {
    if (genesis.has(a) || vaults.has(a) || burn.has(a) || venues.has(a) || bots.has(a)) continue;
    if (s.nOut < 20) continue;
    const passShare = s.out > 0 ? s.sameTxPassthrough / s.out : 0;
    // Emission farm: pays MANY wallets over MANY days, is fed by a HANDFUL of
    // treasury loads (a pool would have many senders), and its outflow is not
    // same-tx passthrough (it holds a budget and drips it out).
    const activeDays = (s.lastB - s.firstB) / opts.blocksPerDay;
    if (s.nOut >= 100 && s.outPeers.size >= 50 && s.inPeers.size <= 10 && activeDays >= 2 && passShare < 0.3) farms.add(a);
  }
  return { genesis, vaults, farms, venues, bots, burn };
}

// Walk a venue-bound transfer back through custody hops (router, fee path)
// inside the same tx to the address that actually parted with the tokens.
export function resolveOrigin(
  tr: LedgerTransfer,
  txTransfers: LedgerTransfer[],
  cls: AddressClasses,
  depth = 0,
): string {
  const isCustody = cls.venues.has(tr.f) || cls.vaults.has(tr.f) || cls.genesis.has(tr.f);
  if (depth > 4 || !isCustody) return tr.f; // a bot or plain wallet IS the origin
  const feed = txTransfers.filter((x) => x.t === tr.f && x.li < tr.li).sort((a, b) => b.li - a.li)[0];
  return feed ? resolveOrigin(feed, txTransfers, cls, depth + 1) : tr.f;
}

// A hop-funded seller: their supply arrived from wallets that exist only to
// pass tokens along (<=3 counterparties, >=90% of their inflow from one hand).
function isHopWallet(a: string, stats: Map<string, Stat>): boolean {
  const s = stats.get(a);
  if (!s) return false;
  const peers = s.inPeers.size + s.outPeers.size;
  return peers <= 3 && s.nIn >= 1 && s.out >= s.in * 0.9;
}

export function attributeSells(
  transfers: LedgerTransfer[],
  stats: Map<string, Stat>,
  cls: AddressClasses,
  opts: {
    swapTx?: Set<string>; // pair txs known to be swaps (LP adds excluded when present)
    lpTx?: Set<string>; // pair txs known to be liquidity ops
    pair?: string;
    earlyEndBlock: number; // end of the "launch window" (first ~48h)
  },
): LedgerAttribution {
  const pair = opts.pair?.toLowerCase();
  const byTx = new Map<string, LedgerTransfer[]>();
  for (const t of transfers) {
    let a = byTx.get(t.tx);
    if (!a) { a = []; byTx.set(t.tx, a); }
    a.push(t);
  }

  // source composition of each address's inflows
  const srcOf = (addr: string) => {
    let farm = 0, vault = 0, bought = 0, other = 0, hop = 0;
    for (const t of transfers) {
      if (t.t !== addr) continue;
      if (cls.farms.has(t.f)) farm += t.v;
      else if (cls.vaults.has(t.f) || cls.genesis.has(t.f)) vault += t.v;
      else if (cls.venues.has(t.f) || cls.bots.has(t.f)) bought += t.v;
      else if (isHopWallet(t.f, stats)) hop += t.v;
      else other += t.v;
    }
    // no traceable inflows (supply predates the window): count it as plain
    if (farm + vault + bought + other + hop === 0) other = 1;
    return { farm, vault, bought, other, hop, total: farm + vault + bought + other + hop };
  };

  const sellers = new Map<string, { sold: number; trades: number; early: number }>();
  let botShuttled = 0;
  let totalUserSold = 0;
  for (const t of transfers) {
    if (!cls.venues.has(t.t)) continue;
    if (pair && t.t === pair) {
      if (opts.lpTx?.has(t.tx)) continue; // an LP add, not a sell
      if (opts.swapTx && !opts.swapTx.has(t.tx)) continue;
    }
    if (cls.venues.has(t.f)) continue; // venue-to-venue plumbing
    const origin = resolveOrigin(t, byTx.get(t.tx) ?? [], cls);
    if (cls.bots.has(origin) || cls.venues.has(origin)) { botShuttled += t.v; continue; }
    if (cls.burn.has(origin)) continue;
    totalUserSold += t.v;
    let s = sellers.get(origin);
    if (!s) { s = { sold: 0, trades: 0, early: 0 }; sellers.set(origin, s); }
    s.sold += t.v; s.trades++;
    if (t.b <= opts.earlyEndBlock) s.early += t.v;
  }

  let farmSold = 0, vaultSold = 0, churnSold = 0, hopSold = 0, otherSold = 0;
  let earlySold = 0, earlyVaultSold = 0;
  const rows: SellerRow[] = [];
  for (const [a, s] of sellers) {
    const src = srcOf(a);
    const tot = src.total || 1;
    farmSold += s.sold * (src.farm / tot);
    vaultSold += s.sold * (src.vault / tot);
    churnSold += s.sold * (src.bought / tot);
    hopSold += s.sold * (src.hop / tot);
    otherSold += s.sold * (src.other / tot);
    earlySold += s.early;
    earlyVaultSold += s.early * (src.vault / tot);
    rows.push({
      address: a, sold: s.sold, trades: s.trades,
      farmPct: (src.farm / tot) * 100, vaultPct: (src.vault / tot) * 100,
      boughtPct: (src.bought / tot) * 100,
      otherPct: ((src.other + src.hop) / tot) * 100,
      hopFunded: src.hop / tot >= 0.5,
    });
  }
  rows.sort((a, b) => b.sold - a.sold);
  const T = totalUserSold || 1;
  return {
    totalUserSold, botShuttled,
    farmPct: (farmSold / T) * 100,
    vaultPct: (vaultSold / T) * 100,
    churnPct: (churnSold / T) * 100,
    hopPct: (hopSold / T) * 100,
    otherPct: (otherSold / T) * 100,
    earlyWindowSoldPct: (earlySold / T) * 100,
    earlyVaultSoldPct: vaultSold > 0 ? (earlyVaultSold / vaultSold) * 100 : 0,
    sellers: rows.slice(0, 12),
  };
}

export function farmStats(cls: AddressClasses, stats: Map<string, Stat>, blocksPerDay: number): FarmStat[] {
  const out: FarmStat[] = [];
  for (const a of cls.farms) {
    const s = stats.get(a);
    if (!s) continue;
    out.push({
      address: a, payouts: s.nOut, recipients: s.outPeers.size, tokensOut: s.out,
      activeDays: Math.max(1, Math.round((s.lastB - s.firstB) / blocksPerDay)),
    });
  }
  return out.sort((a, b) => b.tokensOut - a.tokensOut);
}

export function vaultStats(transfers: LedgerTransfer[], cls: AddressClasses): VaultStat[] {
  const agg = new Map<string, { claimants: Set<string>; tokensOut: number }>();
  for (const t of transfers) {
    if (!cls.vaults.has(t.f)) continue;
    // infra recipients are budget moves, not insider claims
    if (cls.vaults.has(t.t) || cls.genesis.has(t.t) || cls.venues.has(t.t) || cls.burn.has(t.t) || cls.farms.has(t.t) || cls.bots.has(t.t)) continue;
    let a = agg.get(t.f);
    if (!a) { a = { claimants: new Set(), tokensOut: 0 }; agg.set(t.f, a); }
    a.claimants.add(t.t); a.tokensOut += t.v;
  }
  return [...agg.entries()]
    .map(([address, a]) => ({ address, claimants: a.claimants.size, tokensOut: a.tokensOut }))
    .sort((a, b) => b.tokensOut - a.tokensOut);
}
