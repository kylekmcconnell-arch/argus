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
const ZERO = "0x0000000000000000000000000000000000000000";
// Exported for unit tests only. `pairAddress` is the audited pool when the
// caller knows it (the dossier's DexScreener pairAddress).
export async function evmSnipe(chainid: number, token: string, key: string, pairAddress: string | null = null) {
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

    // Identify the pool. The audited pair address is the pool by definition;
    // only without it do we fall back to the fan-out heuristic (the address
    // that SENDS to many distinct recipients in the early window), which a
    // pre-pool airdrop from the deployer can fool into calling the deployer
    // "the pool" and the airdrop block "the launch block".
    const senders = new Set(txs.map((t) => String(t.from ?? "").toLowerCase()));
    let pool: string | null = pairAddress && senders.has(pairAddress.toLowerCase()) ? pairAddress.toLowerCase() : null;
    if (!pool) {
      const bySender = new Map<string, Set<string>>();
      for (const t of txs) {
        const from = String(t.from ?? "").toLowerCase();
        const to = String(t.to ?? "").toLowerCase();
        if (!from || !to || from === ZERO) continue;
        (bySender.get(from) ?? bySender.set(from, new Set()).get(from)!).add(to);
      }
      let fan = 0;
      for (const [snd, tos] of bySender) if (tos.size > fan) { fan = tos.size; pool = snd; }
      if (!pool || fan < 2) return null;
    }

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
    // mint transfers (from 0x0) in the same page of results. Supply is the SUM
    // of every mint transfer, not the first one: a token that mints 5% to a
    // treasury and then 95% to the pool would otherwise measure launch buys
    // against the 5% tranche and read every 1% buy as 20% "of supply".
    const mints = txs.filter((t) => String(t.from ?? "").toLowerCase() === ZERO);
    const dec = Number(mints[0]?.tokenDecimal ?? buys[0]?.tokenDecimal ?? 18);
    const supply = mints.length ? mints.reduce((a, t) => a + Number(t.value) / 10 ** dec, 0) : null;
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
// Pons v1 (2026-07-13 to 2026-09-10, launching now disabled): fixed supply
// straight into a locked V3 pool, creator fees accrued and paid in BOTH the
// token and WETH. Both factories Blockscout-verified 2026-08-10; the split
// from v2 matters because v2 pays creators in the quote asset only.
const PONS_V1_FACTORIES = new Set([
  "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb", // PonsLaunchFactory (v1 active, verified)
  "0x0c37a24f5d23a486fa692d1500881d698b1f77a4", // legacy factory (docs)
]);
// Pons v2 (PonsV2LaunchDeployer, Blockscout-verified 2026-08-11; found via
// $SWIRL, which the v1-only set misread as fair-launch). v2 tokens are named
// PonsV2LauncherToken and the position still goes to a locker
// (PonsV2LaunchLocker, per the verified ILaunchpadV2 source).
const PONS_V2_FACTORIES = new Set([
  "0x3711cea4feade896c913c68f01eda97cb06d1a42",
]);
// Doppler protocol token factories (DopplerERC20V1Factory): the creating
// contract of every LONG and Bankr launch and of any other Doppler integrator.
// LONG and Bankr are told apart client-side by their vanity suffixes; a token
// created here without either suffix is reported as "doppler" so its custody
// and in-token fee mechanics still apply (docs/launchpads/, read 2026-09-23).
const DOPPLER_TOKEN_FACTORIES = new Set([
  "0x1b37d3a72082029c44b35b604ea473617580b69a", // Robinhood Chain
  "0x89c261c05b5f9b6bcba07c199b8dee7cfad45292", // Base
]);
// StonkBrokers Smart Launch V2 pads (one per quote lane) and the v1 ETH pad;
// each pad deploys the launch token itself. Addresses from the project's docs
// and ecosystem.json, read 2026-09-23 (docs/launchpads/stonkbrokers.md).
const STONKBROKERS_PADS = new Set([
  "0xfcd61b25bbf3abd6cf0070d6328e351cc30eec9f", // WETH pad
  "0x8f6782c5aa37804d08a9b7bf3984ff3245fd6cd4", // STONKBROKER pad
  "0xd4f20033586977a2511f4a2db4af7c79a340d70a", // USDG pad
  "0x4b9dcd6ccfaef0f6d23065dd78e79d5e20ec8cfd", // GME pad
  "0xee96d955d5634813374ece4c74f2c0ff71b1f9fb", // NVDA pad
  "0xb0453a81cbf963903409fff18ad92941e1c7a864", // AAPL pad
  "0x0c3b4eded41696eff0ed70841f132b519d81c947", // SPCX pad
  "0xdb3c81c841ff88db6cdfbddb0ee049d162a6053b", // USO pad
  "0x472a1ab6aeb77e3479193fbe83b718f9bf5f8604", // yBTC pad
  "0xeca5726dae1e53365c37ffc02369d947a91d71f9", // v1 ETH pad (sealed)
  "0x80a77001456bc986083678f9a112b1ec2aa07281", // Stonk Launcher factory
]);
// o1 Launchpad (o1.exchange) on Robinhood Chain: no bonding curve, the full
// supply goes into a Uniswap v4 pool under the o1 launch hook in the creation
// tx, so the pool reads as plain uniswap on DexScreener and only the creating
// contract gives it away. Every current and historical suite factory from o1's
// machine-readable registry (docs.o1.exchange/launchpad/reference/
// launch-contract-suites.json, lastUpdatedAt 2026-09-11) plus the current
// Launch Token Deployer: Blockscout reports the one-shot token deployer, not
// the factory, as contractFactory for $WRESTLER (read 2026-09-14). Blockscout
// verifies the current factory under the source name RWAERC20LaunchpadFactory.
const O1_FACTORIES = new Set([
  "0xce9c48cfa068947f77738c81be406b53338e5b0d", // Launch Factory, launchpad-v4-minimal (current)
  "0xf86dfdb678d8e5d932100ef479a59fa65a82a5eb", // Launch Token Deployer (current)
  "0xe64ac4113848bbc1a6dde1a6d1da96720a36f297", // robinhood-rwa-timestamp-v4 factory (historical)
  "0x411f21283d3e492bc395027329e08f9f4f560ba5", // robinhood-timestamp-v3 factory (historical)
  "0x76f0923ac4df0a079a10f628a7bce6426ccd344a", // robinhood-block-v2 factory (historical)
  "0x8b40fc20c405d47d725c9723d056a1c6f62bbccf", // robinhood-block-v1 factory (historical)
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
    // Shape: { address: <creator>, tokens: [{ tokenAddress, poolId, initializer, ... }] }.
    // Confirm the queried token is actually one of the creator's Bankr/Doppler
    // tokens (a poolId present) - a bare 200 with an empty list is not a match.
    const toks = Array.isArray(d?.tokens) ? d.tokens : [];
    const t = token.toLowerCase();
    return toks.some((x: any) => String(x?.tokenAddress ?? "").toLowerCase() === t && (x.poolId || x.initializer));
  } catch {
    return false;
  }
}

// o1 on Base cannot be read from the creating contract: Base o1 tokens are
// native B20 assets minted through the chain's genesis B20 Factory, so
// getcontractcreation names the B20 factory for every B20 asset, o1 or not.
// What IS o1-specific is the suite's Announcement Registry: the launch tx
// emits CreatorRegistered(address indexed token, address indexed creator) on
// it, so a log on that registry whose first indexed topic is the token is an
// o1 launch receipt (layout read off $SPIKE's launch tx 0x90db666c…, suite
// "timestamp v2", 2026-08-13). Every Base suite from o1's machine-readable
// registry (docs.o1.exchange/launchpad/reference/launch-contract-suites.json,
// lastUpdatedAt 2026-09-18), current first: a historical suite still hosts
// live pools - $SPIKE traded $5M on the 2026-07 suite six weeks after o1 had
// moved on - so a token from one must still resolve to o1.
const O1_BASE_ANNOUNCEMENT_REGISTRIES = [
  "0xab1243c97a37361115d5cef7666bf49ad2fb6baa", // launchpad-v4-minimal (current)
  "0x7ce9c6d4d0dce30895e5e35798954947071029c0",
  "0x4fa46c840df1d11b20750c08390f7dabfe0e1cca",
  "0xabdcbe060724b9bef5a2daad017d9ea3ed72de28", // timestamp v2 ($SPIKE)
  "0xa6bb57abd6d26cf862e6aab84f2bcd51210a060e",
];
// B20 system-address prefix (Base-native asset standard). Gates the log probe:
// a non-B20 Base token cannot be an o1 launch, so it never spends the calls.
const B20_SYSTEM_ADDRESS = /^0xb20/i;

export async function o1BaseAnnouncementVenue(token: string, etherscanKey: string): Promise<string | null> {
  if (!B20_SYSTEM_ADDRESS.test(token)) return null;
  const paddedToken = `0x${"0".repeat(24)}${token.slice(2).toLowerCase()}`;
  for (const registry of O1_BASE_ANNOUNCEMENT_REGISTRIES) {
    // One call per suite, token pinned to the first indexed topic; a miss on
    // every suite is "not attributed", never a guess.
    try {
      const q = new URLSearchParams({
        chainid: "8453", module: "logs", action: "getLogs",
        address: registry, topic1: paddedToken,
        fromBlock: "0", toBlock: "latest", page: "1", offset: "1",
        apikey: etherscanKey,
      });
      const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const d = (await r.json()) as { result?: unknown };
      if (Array.isArray(d.result) && d.result.length > 0) return "o1";
    } catch {
      continue;
    }
  }
  return null;
}

export interface RobinhoodCreation { venue: string | null; factory: string; creator: string | null; txHash: string | null }
export async function robinhoodCreation(token: string): Promise<RobinhoodCreation | null> {
  try {
    // The v2 REST route (/api/v2/addresses/{addr}) 500s on a LOWERCASE address
    // on this Blockscout instance - and the handler lowercases every address -
    // so this check silently returned null for every token since it shipped.
    // The v1 Etherscan-style route is case-tolerant and answers the actual
    // question directly: which FACTORY (if any) deployed this contract.
    const r = await fetch(`https://robinhoodchain.blockscout.com/api?module=contract&action=getcontractcreation&contractaddresses=${token}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const row = Array.isArray(d?.result) ? d.result[0] : null;
    if (!row) return null;
    const factory = String(row?.contractFactory ?? row?.contractCreator ?? "").toLowerCase();
    const creator = /^0x[0-9a-f]{40}$/i.test(String(row?.contractCreator ?? "")) ? String(row.contractCreator).toLowerCase() : null;
    const txHash = typeof row?.txHash === "string" ? row.txHash : null;
    let venue: string | null = null;
    if (PONS_V1_FACTORIES.has(factory)) venue = "pons v1";
    else if (PONS_V2_FACTORIES.has(factory)) venue = "pons";
    else if (O1_FACTORIES.has(factory)) venue = "o1";
    else if (DOPPLER_TOKEN_FACTORIES.has(factory)) venue = "doppler";
    else if (STONKBROKERS_PADS.has(factory)) venue = "stonkbrokers";
    return { venue, factory, creator, txHash };
  } catch {
    return null;
  }
}
export async function robinhoodCreatorVenue(token: string): Promise<string | null> {
  return (await robinhoodCreation(token))?.venue ?? null;
}

// ---- creator fee claims on venues that pay in the launched token ----
// LONG, Bankr and any Doppler integrator pay the pool's fee beneficiaries
// through the DopplerHookInitializer in both pool tokens; Pons v1 paid its
// creators in kind through the launch locker. The venue is a note. What
// turns it into a warning is conduct: a claimer who keeps drawing the token
// leg and selling it, directly or one hop through fresh wallets, with no
// buyback or burn to balance it (the wire bot, LEMON, MEME, TAIWAN reads).
// The venue contracts that pay creators in the launched token: Doppler's
// initializer (LONG, Bankr and any other integrator) and the Pons v1 lockers.
const DOPPLER_INITIALIZER = "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544";
const PONS_V1_LOCKERS = ["0x736d76699c26d0d966744cae304c000d471f7f35", "0x31ca5e101941a93a7dd6d0497928700625cf54b5"];
// Where a sale lands on this chain: the v4 PoolManager, the routers, the
// bridge, the app settler and the 0x settlers. A transfer into one of these
// is a sell (or a bridge-out, which for a creator's fee leg reads the same).
const RH_SELL_SINKS = new Set([
  "0x8366a39cc670b4001a1121b8f6a443a643e40951", // Uniswap v4 PoolManager
  "0x6f02324d20cc679d0e585290caa6b16bacbc0f77", // Doppler Rehype hook (LONG)
  "0x9982538f41f2ae29ddb9d3d9307010052984fdbb", // Doppler Rehype hook (Bankr)
  "0x8876789976decbfcbbbe364623c63652db8c0904", // UniversalRouter
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f", // RelayRouterV3 (bridge)
  "0x6aa80dbbed9ae5ab45fbf61f9644fada3b29326e", // RobinHoodSettler (app swaps)
  "0x0000000000001ff3684f28c67538d4d072c22734", // 0x AllowanceHolder
  "0x39b38686a19836ac10162c490e4558e120cbbe5f", // 0x settler
  "0xcaf681a66d020601342297493863e78c959e5cb2", // SwapRouter02
  "0xbdbae060cbab0e9cfe802a7513dd5ecb36cda6c3", // swap router (LEMON/wire reads)
  "0xdeadc0de0000e54725ad1bf220324717043e02bf", // proxy router (MEME read)
]);
const RH_BURN = new Set([ZERO, "0x000000000000000000000000000000000000dead"]);
const RH_POOLS = new Set(["0x8366a39cc670b4001a1121b8f6a443a643e40951"]);

// Blockscout's Etherscan-compatible token-transfer index. A full RPC log scan
// of this chain is not viable inside a request: topic-filtered eth_getLogs
// over a live token's history either times out on the node or blows the
// 10,000-log cap, and the chain is ~70M blocks deep. The v1 index answers the
// same question for one address and one token in a single call, and it is the
// route api/launch.ts already relies on for contract creation.
interface RhTransfer { from: string; to: string; value: string; tokenDecimal?: string; blockNumber: string }
type RhTransfers = { rows: RhTransfer[]; truncated: boolean } | null;
const RH_PAGE = 200;
async function rhTokenTransfers(address: string, token: string, budget: { calls: number; deadline?: number }, maxPages = 3): Promise<RhTransfers> {
  const rows: RhTransfer[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    if (budget.calls <= 0 || (budget.deadline != null && Date.now() > budget.deadline)) return null;
    budget.calls -= 1;
    try {
      const q = `module=account&action=tokentx&address=${address}&contractaddress=${token}&page=${page}&offset=${RH_PAGE}&sort=asc`;
      const r = await fetch(`https://robinhoodchain.blockscout.com/api?${q}`, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) return null;
      const d = (await r.json()) as any;
      // An empty result is reported as status "0" with a "No transactions
      // found" message: that is an answer, not a failure.
      if (d?.status === "0") return { rows, truncated: false };
      if (!Array.isArray(d?.result)) return null;
      rows.push(...(d.result as RhTransfer[]));
      if (d.result.length < RH_PAGE) return { rows, truncated: false };
    } catch {
      return null;
    }
  }
  return { rows, truncated: true };
}
const amountOf = (t: RhTransfer) => {
  const dec = Number(t.tokenDecimal ?? 18);
  const v = Number(t.value ?? 0);
  return Number.isFinite(v) && Number.isFinite(dec) ? v / 10 ** dec : 0;
};

export interface CreatorFeeUsage {
  claimer: string | null;
  claimCount: number;
  claimedTokens: number;
  soldTokens: number;
  burnedTokens: number;
  boughtBackTokens: number;
  heldTokens: number;
  usage: "lp-add" | "buyback-burn" | "buyback" | "hold" | "dump" | "unknown";
  note: string;
}
export interface ClaimTrace {
  claimCount: number;
  claimedTokens: number;
  directSold: number;
  forwardedSold: number;
  forwardedHeld: number;
  burned: number;
  boughtBack: number;
  held: number;
  firstClaimBlock: number | null;
  lastClaimBlock: number | null;
}
// Exported for unit tests: the verdict from the traced flows alone.
export function classifyCreatorFeeUsage(t: ClaimTrace, symbol = "the token"): { usage: CreatorFeeUsage["usage"]; note: string } {
  const claimed = t.claimedTokens;
  if (t.claimCount === 0 || claimed <= 0) return { usage: "unknown", note: "No creator fee claims observed in the launched token." };
  const sold = t.directSold + t.forwardedSold;
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const claims = `${t.claimCount} claim${t.claimCount === 1 ? "" : "s"} of ${fmt(claimed)} ${symbol}`;
  if (t.burned >= claimed * 0.5) return { usage: "buyback-burn", note: `${claims}; ${fmt(t.burned)} burned.` };
  if (t.boughtBack >= claimed * 0.5 && sold < claimed * 0.5) return { usage: "buyback", note: `${claims}; the claimer bought ${fmt(t.boughtBack)} back from the pool.` };
  if (sold >= claimed * 0.6 && t.claimCount >= 3) {
    const via = t.forwardedSold > t.directSold ? ", mostly one hop through fresh wallets" : "";
    return { usage: "dump", note: `${claims}; ${fmt(sold)} (${Math.round((sold / claimed) * 100)}%) sold into the pool or a router${via}; ${fmt(t.boughtBack)} bought back.` };
  }
  if (t.held + t.forwardedHeld >= claimed * 0.6) return { usage: "hold", note: `${claims}; ${fmt(t.held + t.forwardedHeld)} still held, none sold.` };
  return { usage: "unknown", note: `${claims}; ${fmt(sold)} sold, ${fmt(t.held)} held, ${fmt(t.boughtBack)} bought back - no dominant pattern yet.` };
}

/**
 * Read the creator's fee claims for one token on Robinhood Chain and follow
 * the token leg one hop. The claimer is the launch transaction's sender: on
 * Doppler venues the pool's default fee beneficiary, on Pons v1 the locker's
 * payee. Its own transfer feed is small; the fee source's is not, because
 * Doppler's hook passes every swap through the initializer, so that feed runs
 * to hundreds of thousands of rows on a live token and must not be read.
 *
 * Only conduct after the first claim is attributed to the fee stream: a launch
 * buy sold later is a sale, but not a sale of fees. Returns null when the
 * index could not answer or the claimer's history was too long to read in
 * full - a partial read must never be reported as "no claims".
 */
const RH_FEED_PAGES = 5;
export async function robinhoodCreatorFeeUsage(
  token: string,
  sources: string[],
  claimerAddress: string | null,
  symbol = "the token",
  budget: { calls: number; deadline?: number } = { calls: 6, deadline: Date.now() + 12_000 },
): Promise<CreatorFeeUsage | null> {
  const claimer = claimerAddress?.toLowerCase() ?? null;
  if (!claimer) return null;
  const src = new Set(sources.map((a) => a.toLowerCase()));
  const infra = new Set([...src, ...RH_SELL_SINKS, ...RH_BURN]);

  const feed = await rhTokenTransfers(claimer, token, budget, RH_FEED_PAGES);
  if (!feed || feed.truncated) return null;

  // 1. Claims: inbound from the venue's fee source.
  const claims = feed.rows.filter((t) => String(t.to).toLowerCase() === claimer && src.has(String(t.from).toLowerCase()));
  const none: CreatorFeeUsage = { claimer, claimCount: 0, claimedTokens: 0, soldTokens: 0, burnedTokens: 0, boughtBackTokens: 0, heldTokens: 0, usage: "unknown", note: "No creator fee claims observed in the launched token." };
  if (!claims.length) return none;
  const blk = (t: RhTransfer) => Number(t.blockNumber);
  const firstClaim = Math.min(...claims.map(blk));
  const trace: ClaimTrace = {
    claimCount: claims.length, claimedTokens: claims.reduce((a, t) => a + amountOf(t), 0),
    directSold: 0, forwardedSold: 0, forwardedHeld: 0, burned: 0, boughtBack: 0, held: 0,
    firstClaimBlock: firstClaim, lastClaimBlock: Math.max(...claims.map(blk)),
  };

  // 2. What the claimer did with it, counted from the first claim onward.
  const forwarded = new Map<string, number>();
  let inboundAll = 0, outboundAll = 0;
  for (const t of feed.rows) {
    const from = String(t.from).toLowerCase(); const to = String(t.to).toLowerCase(); const v = amountOf(t);
    if (to === claimer) {
      inboundAll += v;
      // A buy after the first claim, delivered by a pool or router, is the
      // creator putting fee proceeds (or other money) back into the token.
      if (blk(t) > firstClaim && !src.has(from) && (RH_POOLS.has(from) || RH_SELL_SINKS.has(from))) trace.boughtBack += v;
      continue;
    }
    if (from !== claimer) continue;
    outboundAll += v;
    if (blk(t) < firstClaim) continue;
    if (RH_SELL_SINKS.has(to)) trace.directSold += v;
    else if (RH_BURN.has(to)) trace.burned += v;
    else if (!infra.has(to)) forwarded.set(to, (forwarded.get(to) ?? 0) + v);
  }
  // Sales cannot exceed what was claimed when the question is what happened
  // to the fees; the remainder of the wallet's selling is other inventory.
  trace.directSold = Math.min(trace.directSold, trace.claimedTokens);
  trace.held = Math.min(trace.claimedTokens, Math.max(0, inboundAll - outboundAll));

  // 3. One hop: did the wallets the claimer forwarded to sell it on? A fee
  //    leg routed through a fresh wallet into the pool is the pattern the
  //    registry records for the wire bot, LEMON, MEME and TAIWAN.
  const hops = [...forwarded.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const [dest, v] of hops) {
    const hop = await rhTokenTransfers(dest, token, budget, 2);
    if (!hop) { trace.forwardedHeld += v; continue; }
    const soldOn = hop.rows
      .filter((t) => String(t.from).toLowerCase() === dest && RH_SELL_SINKS.has(String(t.to).toLowerCase()))
      .reduce((a, t) => a + amountOf(t), 0);
    trace.forwardedSold += Math.min(v, soldOn);
    trace.forwardedHeld += Math.max(0, v - soldOn);
  }
  trace.forwardedSold = Math.min(trace.forwardedSold, Math.max(0, trace.claimedTokens - trace.directSold));

  const { usage, note } = classifyCreatorFeeUsage(trace, symbol);
  return {
    claimer, claimCount: trace.claimCount, claimedTokens: trace.claimedTokens,
    soldTokens: trace.directSold + trace.forwardedSold, burnedTokens: trace.burned,
    boughtBackTokens: trace.boughtBack, heldTokens: trace.held + trace.forwardedHeld, usage, note,
  };
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
  const creation = chain === "robinhood" ? await robinhoodCreation(addr) : null;
  let creatorVenue: string | null = creation?.venue ?? null;
  if (!creatorVenue && chain === "base" && key) {
    // Base o1 launches are B20 assets announced in the suite's registry; the
    // creating-contract probe cannot see them (see o1BaseAnnouncementVenue).
    creatorVenue = await o1BaseAnnouncementVenue(addr, key);
  }
  if ((!creatorVenue || creatorVenue === "doppler") && (chain === "base" || chain === "robinhood")) {
    // A Doppler-factory token is Bankr's when Bankr's own API knows it;
    // otherwise it stays "doppler" (LONG is caught client-side by suffix).
    creatorVenue = (await bankrDopplerCheck(addr)) ? "bankr" : creatorVenue;
  }
  // Creator fee claims, read only where the venue pays in the token: every
  // Doppler-factory token (LONG, Bankr, others) and Pons v1. The venue is a
  // note; what the claimer does with the token leg is the finding.
  let feePromise: Promise<CreatorFeeUsage | null> = Promise.resolve(null);
  if (chain === "robinhood" && creation) {
    const sources = DOPPLER_TOKEN_FACTORIES.has(creation.factory) || creatorVenue === "bankr" ? [DOPPLER_INITIALIZER]
      : PONS_V1_FACTORIES.has(creation.factory) ? PONS_V1_LOCKERS
      : null;
    // Bounded so the endpoint stays inside the client's 20s budget; on expiry
    // the fee read is null and the venue answer still goes out.
    if (sources) feePromise = robinhoodCreatorFeeUsage(addr, sources, creation.creator, String(req.query.symbol ?? "the token").slice(0, 16) || "the token", { calls: 8, deadline: Date.now() + 12_000 }).catch(() => null);
  }
  if (!chainid || !key) { res.status(200).json({ available: !!creatorVenue, note: "snipe trace needs an Etherscan-covered chain and key", creatorVenue, pumpfun: null, snipe: null, creatorFees: await feePromise }); return; }
  const pairParam = String(req.query.pair ?? "").trim().toLowerCase();
  const [snipe, creatorFees] = await Promise.all([evmSnipe(chainid, addr, key, EVM.test(pairParam) ? pairParam : null), feePromise]);
  res.status(200).json({ available: true, chain, pumpfun: null, snipe, creatorVenue, creatorFees });
}
