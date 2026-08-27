// Behind the Ledger. GET /api/behindledger?address=<token>&chain=<id>&pair=<pool>
//
// An in-depth read of the token's actual Transfer ledger: all farming activity,
// launch selling, pre-sale and insider vault allocations, trader churn, and
// wallet-hop funded distribution. Built from the $BULL post-mortem method
// (2026-08-15): pull the transfer history, classify every address by flow shape
// (genesis / vault / emission farm / venue / arb bot), resolve each sell back
// through same-tx custody hops to its true origin, then attribute sold volume
// to where that seller's tokens came from. Answers, with numbers:
//   - is anyone farming token emissions and dumping them?
//   - how much of the selling is presale/insider supply, and when did it exit?
//   - how much is plain churn (bought tokens re-sold)?
//   - is supply being distributed through fresh hop wallets to hide a seller?
//   - are LPs fleeing the pool (adds vs removes)?
// EVM only; scan window is budgeted, newest blocks first, so a partial read
// still covers the recent action. The analysis core is api/_ledgerflow.ts.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  addressStats, classifyAddresses, attributeSells, farmStats, vaultStats,
  type LedgerTransfer,
} from "./_ledgerflow.js";

export const config = { maxDuration: 60 };

// Chain profiles: RPC pool + approximate cadence (drives day bucketing and the
// scan-window maths). A chain missing here degrades to "not supported".
const CHAINS: Record<string, { rpc: string[]; blockSec: number }> = {
  ethereum: { rpc: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"], blockSec: 12 },
  base: { rpc: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"], blockSec: 2 },
  bsc: { rpc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"], blockSec: 3 },
  robinhood: { rpc: ["https://rpc.mainnet.chain.robinhood.com"], blockSec: 0.1 },
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// Pair-event topics used only to classify pair txs (swap vs liquidity op):
const SWAP_TOPICS = new Set([
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67", // v3/Slipstream Swap
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", // v2 Swap
]);
const LP_TOPICS = new Set([
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0763b1fa3a936f74", // v3 Mint
  "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c", // v3 Burn
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f", // v2 Mint
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496", // v2 Burn
]);

const TARGET_DAYS = 14; // ideal window; the budget may shrink it
const MAX_TRANSFERS = 60_000;
const TIME_BUDGET_MS = 40_000;
// The launch window gets its own guaranteed slice of the budget, scanned FIRST.
// On a busy ledger the newest-first sweep never reaches launch day - and the
// launch window is where presale/insider vault loads and the launch dump live,
// which is the panel's headline promise (learned on $BULL: 300k+ transfers in
// 8 days left the whole insider story outside a recent-only window).
const LAUNCH_HOURS = 6;
const LAUNCH_MAX_TRANSFERS = 25_000;
const LAUNCH_BUDGET_MS = 15_000;

// Contract-creation lookup, for anchoring the launch window. Blockscout v1
// where available (NOTE: the Robinhood v2 REST route 500s on lowercase
// addresses; the v1 module route is case-tolerant), Etherscan v2 elsewhere
// when a key is present. Failure just degrades to the recent-only scan.
const BLOCKSCOUT: Record<string, string> = {
  robinhood: "https://robinhoodchain.blockscout.com",
  base: "https://base.blockscout.com",
};
const ETHERSCAN_CHAINID: Record<string, number> = { ethereum: 1, bsc: 56 };

interface RawLog { blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string; address: string }

async function creationBlock(chain: string, address: string, rpc: string[]): Promise<bigint | null> {
  const bs = BLOCKSCOUT[chain];
  const esId = ETHERSCAN_CHAINID[chain];
  const esKey = process.env.ETHERSCAN_API_KEY;
  try {
    let row: any = null;
    if (bs) {
      const r = await fetch(`${bs}/api?module=contract&action=getcontractcreation&contractaddresses=${address}`, { signal: AbortSignal.timeout(8000) });
      row = ((await r.json()) as any)?.result?.[0] ?? null;
    } else if (esId && esKey) {
      const r = await fetch(`https://api.etherscan.io/v2/api?chainid=${esId}&module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${esKey}`, { signal: AbortSignal.timeout(8000) });
      row = ((await r.json()) as any)?.result?.[0] ?? null;
    }
    if (!row) return null;
    // Blockscout answers with blockNumber inline; Etherscan gives only the
    // creation txHash, one receipt lookup away.
    if (row.blockNumber != null && /^\d+$/.test(String(row.blockNumber))) return BigInt(row.blockNumber);
    const txHash = row.txHash ?? row.transactionHash ?? null;
    if (!txHash) return null;
    const receipt = await rpcCall(rpc, "eth_getTransactionReceipt", [txHash]);
    return receipt?.blockNumber ? BigInt(receipt.blockNumber) : null;
  } catch {
    return null;
  }
}

async function rpcCall(urls: string[], method: string, params: unknown[], timeoutMs = 9000): Promise<any> {
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as any;
      if (d.error) throw Object.assign(new Error(String(d.error.message ?? "rpc error")), { rpcError: true });
      if (d.result !== undefined) return d.result;
    } catch (e) {
      if ((e as any)?.rpcError) throw e; // a real node answer (e.g. log cap) - don't retry siblings
      /* network trouble: try the next endpoint */
    }
  }
  return undefined;
}

// Adaptive getLogs: providers cap results (often at 10k) or reject wide ranges
// outright - split on any failure or a suspiciously capped result.
async function getLogsAdaptive(
  urls: string[], filter: { address: string; topics?: (string | null)[] },
  lo: bigint, hi: bigint, out: RawLog[], deadline: number, maxOut = MAX_TRANSFERS,
): Promise<boolean> {
  if (Date.now() > deadline || out.length > maxOut) return false;
  let logs: RawLog[] | undefined;
  try {
    logs = await rpcCall(urls, "eth_getLogs", [{ ...filter, fromBlock: "0x" + lo.toString(16), toBlock: "0x" + hi.toString(16) }]);
  } catch {
    logs = undefined;
  }
  if (logs === undefined || logs.length >= 9_999) {
    if (hi - lo < 200n) return true; // give up on a stubborn sliver, keep going
    const mid = lo + (hi - lo) / 2n;
    const a = await getLogsAdaptive(urls, filter, lo, mid, out, deadline, maxOut);
    const b = await getLogsAdaptive(urls, filter, mid + 1n, hi, out, deadline, maxOut);
    return a && b;
  }
  out.push(...logs);
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").trim().toLowerCase();
  const chain = String(req.query.chain ?? "").toLowerCase();
  const pair = typeof req.query.pair === "string" && /^0x[a-fA-F0-9]{40}$/.test(req.query.pair) ? req.query.pair.toLowerCase() : undefined;
  if (!/^0x[a-f0-9]{40}$/.test(address)) { res.status(400).json({ available: false, error: "valid token address required" }); return; }
  const profile = CHAINS[chain];
  if (!profile) { res.status(200).json({ available: false, note: `Behind the Ledger reads EVM transfer logs; '${chain}' is not supported yet.` }); return; }

  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  try {
    const headHex = await rpcCall(profile.rpc, "eth_blockNumber", []);
    if (!headHex) { res.status(200).json({ available: false, note: "The chain's RPC did not answer." }); return; }
    const head = BigInt(headHex);
    const blocksPerDay = Math.round(86_400 / profile.blockSec);
    const windowBlocks = BigInt(blocksPerDay * TARGET_DAYS);
    const from = head > windowBlocks ? head - windowBlocks : 0n;

    // decimals, for whole-token amounts
    const decHex = await rpcCall(profile.rpc, "eth_call", [{ to: address, data: "0x313ce567" }, "latest"]);
    const decimals = decHex && decHex !== "0x" ? Number(BigInt(decHex)) : 18;
    const scale = 10 ** decimals;

    // Phase A - the launch window, scanned FIRST with its own budget slice.
    // Creation block -> first LAUNCH_HOURS of the ledger: the mint, the
    // presale/insider vault loads, and the launch-day dump all live here, and
    // a newest-first sweep of a busy ledger never reaches them.
    const launchRaw: RawLog[] = [];
    let launchLo: bigint | null = null;
    let launchHi: bigint | null = null;
    // Engage whenever creation is more than a day back - not just when it
    // predates the target window: on a busy ledger the newest-first sweep can
    // run out of budget long before reaching even a week-old launch. Overlap
    // with the recent sweep is deduped below.
    const born = await creationBlock(chain, address, profile.rpc);
    if (born != null && head - born > BigInt(blocksPerDay)) {
      launchLo = born;
      launchHi = born + BigInt(Math.round((blocksPerDay * LAUNCH_HOURS) / 24));
      const launchDeadline = Math.min(started + LAUNCH_BUDGET_MS, deadline);
      await getLogsAdaptive(profile.rpc, { address, topics: [TRANSFER_TOPIC] }, launchLo, launchHi, launchRaw, launchDeadline, LAUNCH_MAX_TRANSFERS);
    }

    // Phase B - newest-first in day-sized strides with the remaining budget,
    // so the recent window (what the user is looking at) stays complete.
    const raw: RawLog[] = [];
    let coveredFrom = head;
    const stride = BigInt(blocksPerDay);
    for (let hi = head; hi > from; ) {
      const lo = hi - stride + 1n > from ? hi - stride + 1n : from;
      const done = await getLogsAdaptive(profile.rpc, { address, topics: [TRANSFER_TOPIC] }, lo, hi, raw, deadline);
      if (!done) break;
      coveredFrom = lo;
      hi = lo - 1n;
      if (Date.now() > deadline || raw.length + launchRaw.length > MAX_TRANSFERS) break;
    }

    const transfers: LedgerTransfer[] = [];
    const seen = new Set<string>();
    for (const l of [...launchRaw, ...raw]) {
      if (l.topics?.[0] !== TRANSFER_TOPIC || l.topics.length !== 3) continue;
      const key = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(key)) continue; // launch and recent windows can overlap on a young token
      seen.add(key);
      let v = 0;
      try { v = Number(BigInt(l.data)) / scale; } catch { continue; }
      transfers.push({
        b: Number(BigInt(l.blockNumber)), tx: l.transactionHash, li: Number(BigInt(l.logIndex)),
        f: "0x" + l.topics[1].slice(26).toLowerCase(), t: "0x" + l.topics[2].slice(26).toLowerCase(), v,
      });
    }
    transfers.sort((a, b) => a.b - b.b || a.li - b.li);
    if (transfers.length < 25) {
      res.status(200).json({ available: false, note: "Too little transfer history in the scan window to read anything from the ledger." });
      return;
    }
    const coverage: "full" | "partial" = coveredFrom <= from + 1n ? "full" : "partial";
    const coveredDays = Math.max(1, Math.round(Number(head - coveredFrom) / blocksPerDay));

    // Pair event classification (swap vs LP op) + LP add/remove tallies - for
    // BOTH windows, so the launchpad's initial liquidity add isn't miscounted
    // as launch selling.
    const swapTx = new Set<string>();
    const lpTx = new Set<string>();
    if (pair) {
      const pairLogs: RawLog[] = [];
      const pairDeadline = Math.min(deadline + 6_000, started + 52_000);
      if (launchLo != null && launchHi != null && launchHi < coveredFrom) {
        await getLogsAdaptive(profile.rpc, { address: pair }, launchLo, launchHi, pairLogs, pairDeadline);
      }
      await getLogsAdaptive(profile.rpc, { address: pair }, coveredFrom, head, pairLogs, pairDeadline);
      for (const l of pairLogs) {
        const t0 = l.topics?.[0];
        if (t0 && SWAP_TOPICS.has(t0)) swapTx.add(l.transactionHash);
        else if (t0 && LP_TOPICS.has(t0)) lpTx.add(l.transactionHash);
      }
    }

    // ---- the core read ----
    const stats = addressStats(transfers);
    const minted = transfers.filter((t) => t.f === "0x0000000000000000000000000000000000000000").reduce((a, t) => a + t.v, 0);
    const totalMinted = minted > 0 ? minted : transfers.reduce((a, t) => a + t.v, 0) * 0.1; // fallback floor basis when mint predates the window
    const cls = classifyAddresses(transfers, stats, { pair, blocksPerDay, totalMinted });
    // "Launch window" = the token's first ~48h when creation is known, else the
    // covered ledger's first ~48h (the pre-two-phase behavior).
    const earlyEndBlock = (launchLo != null ? Number(launchLo) : transfers[0].b) + blocksPerDay * 2;
    const attribution = attributeSells(transfers, stats, cls, { swapTx: swapTx.size ? swapTx : undefined, lpTx, pair, earlyEndBlock });
    const farms = farmStats(cls, stats, blocksPerDay).slice(0, 5);
    const vaults = vaultStats(transfers, cls).slice(0, 6);

    // LP flow on the primary pair, from token transfers in LP-classified txs.
    let lpAdded = 0, lpRemoved = 0, lpRemovedRecent = 0;
    const recentStart = Number(head) - blocksPerDay * 3;
    if (pair) {
      for (const t of transfers) {
        if (!lpTx.has(t.tx)) continue;
        if (t.t === pair) lpAdded += t.v;
        if (t.f === pair) { lpRemoved += t.v; if (t.b >= recentStart) lpRemovedRecent += t.v; }
      }
    }

    // ---- plain-English findings, house voice ----
    const findings: string[] = [];
    const pct = (n: number) => `${Math.round(n)}%`;
    if (farms.length) {
      const f = farms[0];
      findings.push(`Emission farming is real here: ${farms.length} farm contract${farms.length === 1 ? "" : "s"} paid ${f.recipients}+ wallets across ${f.activeDays} day${f.activeDays === 1 ? "" : "s"}, and ${pct(attribution.farmPct)} of all user selling traces back to farmed tokens.`);
    } else {
      findings.push("No token-denominated emission farm found in the window - selling here is not farmers dumping emissions.");
    }
    const sawLaunch = minted > 0; // the mint is inside the window, so "first 48h" really is the launch
    if (vaults.length && attribution.vaultPct >= 5) {
      findings.push(`Pre-sale / insider vaults supplied ${pct(attribution.vaultPct)} of everything sold${sawLaunch && attribution.earlyVaultSoldPct >= 60 ? `, and ${pct(attribution.earlyVaultSoldPct)} of that insider selling happened in the launch window - the allocation holders exited at the top` : ""}.`);
    } else if (vaults.length) {
      findings.push(`Allocation vaults exist (${vaults.length} identified) but their supply accounts for only ${pct(attribution.vaultPct)} of selling so far.`);
    }
    if (attribution.churnPct >= 50) {
      findings.push(`${pct(attribution.churnPct)} of selling is churn - traders re-selling tokens they bought, the signature of capitulation rather than new supply hitting the market.`);
    }
    if (attribution.hopPct >= 8) {
      findings.push(`${pct(attribution.hopPct)} of selling arrives through fresh single-purpose hop wallets - someone is distributing supply in disguise before selling it.`);
    }
    if (sawLaunch && attribution.earlyWindowSoldPct >= 40) {
      findings.push(`${pct(attribution.earlyWindowSoldPct)} of all user selling happened in the token's first 48 hours - launch selling dominates this ledger.`);
    }
    if (pair && lpRemoved > lpAdded * 1.3 && lpRemovedRecent > 0) {
      findings.push("Liquidity providers are leaving: LP removals outweigh adds in the window, with removals continuing in the last 3 days - exits get more expensive from here.");
    }

    res.status(200).json({
      available: true,
      coverage, coveredDays, transferCount: transfers.length,
      attribution: {
        totalUserSold: attribution.totalUserSold,
        botShuttled: attribution.botShuttled,
        farmPct: attribution.farmPct, vaultPct: attribution.vaultPct,
        churnPct: attribution.churnPct, hopPct: attribution.hopPct, otherPct: attribution.otherPct,
        earlyWindowSoldPct: attribution.earlyWindowSoldPct,
        earlyVaultSoldPct: attribution.earlyVaultSoldPct,
      },
      sellers: attribution.sellers,
      farms, vaults,
      lp: pair ? { added: lpAdded, removed: lpRemoved, removedLast3d: lpRemovedRecent } : null,
      findings,
      note: coverage === "full"
        ? `Read ${transfers.length.toLocaleString()} transfers across the last ${coveredDays} days of the ledger.`
        : launchLo != null
          ? `Budgeted read of ${transfers.length.toLocaleString()} transfers: the launch window (first ${LAUNCH_HOURS}h from creation) plus the most recent ${coveredDays} day${coveredDays === 1 ? "" : "s"} - a busy ledger, the days between not covered.`
          : `Budgeted read: the most recent ${coveredDays} day${coveredDays === 1 ? "" : "s"} (${transfers.length.toLocaleString()} transfers) - a busy ledger, older history (including launch) not covered.`,
    });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Behind the Ledger failed to read the chain." });
  }
}
