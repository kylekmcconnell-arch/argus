// Tokenomics analysis — the user's required standing checks, assembled from data
// already fetched (GoPlus labeled holders/LP, RugCheck lockers, the contract's
// own source signals). Five things, each surfaced on its own terms rather than
// collapsed into "big holder = bad":
//   1. Separate the LIQUIDITY POOL(s) from holder concentration.
//   2. LP lock status — INCLUDING launchpad-level lockers (Pons LaunchLocker on
//      Robinhood, Team Finance, Unicrypt…), with the caveat that on early
//      launchpad chains a real lock may not surface in standard tools.
//   3. Identify REWARD / mining / emission pools and separate them out.
//   4. Buy/sell TAX and what it DOES (reflection / buyback-burn / RWA-stock
//      distribution / treasury) — a tax destination can be a positive.
//   5. BURN address(es) and % of total supply burned.
// The time-series pieces the user also wants (reward-emission cadence graph,
// FDV-vs-mcap by stage, X-feed burn cadence) need snapshot infra and are tracked
// as the next phase (see RESEARCH.md) — this file does the point-in-time read.

import type { TokenDossier } from "../token/audit";
import type { CodeTokenomics, TaxDestination } from "./solidity";
import type { GoPlusMeta, LabeledHolder, RugcheckReport } from "./deepsources";

// Known LP/market and launchpad-locker labels. Matched against holder tags so a
// pool or a locker is never mistaken for an insider wallet.
const POOL_TAG = /pool|amm|\blp\b|pair|dex|raydium|meteora|orca|uniswap|pancake|pump|aerodrome|curve|balancer|market\s?maker/i;
const CEX_TAG = /cex|exchange|binance|coinbase|kraken|okx|bybit|kucoin|gate|bitget|mexc|htx|hot\s?wallet/i;
const REWARD_TAG = /stak|reward|farm|emission|distribut|vest|incentive|masterchef|gauge|mining/i;
const BURN_TAG = /burn|dead|null|0x0{4,}|0xdead/i;
// Launchpad / third-party lockers — a lock even when is_locked isn't set, because
// custody sits in a recognized locker contract.
const LOCKER_TAG = /lock|pons|launchlock|team\.?finance|unicrypt|pinklock|pinksale|streamflow|bonfida|flooz|dxlock|onlymoons|mudra/i;
const LAUNCHPAD_LOCKER = /pons|launchlock/i; // "locked by design" launchpad custody

const isBurnAddr = (a: string) => /^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, ""));

export type LpStatus = "burned" | "locked" | "launchpad-locked" | "unlocked" | "unconfirmed";

export interface TokenomicsView {
  pools: { address: string; label: string; pct: number }[];
  cexHeld: { address: string; label: string; pct: number }[];
  rewardPools: { address: string; label: string; pct: number }[];
  lp: {
    status: LpStatus;
    burnedPct: number;
    lockedPct: number;
    unlockedTopPct: number;
    lockers: string[];
    note: string;
  };
  tax: {
    buy: number;
    sell: number;
    destinations: TaxDestination[];
    note: string;
    tone: "good" | "warn" | "neutral";
  };
  burn: {
    burnedSupplyPct: number; // % of TOTAL SUPPLY sent to burn addresses
    hasBurnFunction: boolean;
    hasAutoBurn: boolean;
    addresses: string[];
    note: string;
  };
  // Genuine holder concentration AFTER pools/CEX/rewards/burns are removed.
  realHolderTopPct: number;
  note: string;
}

function label(h: LabeledHolder, fallback: string): string {
  return h.tag?.trim() || fallback;
}

const TAX_DEST_LABEL: Record<TaxDestination, string> = {
  reflection: "reflected to holders",
  "buyback-burn": "buyback & burn",
  "rwa-distribution": "buying real-world assets/stocks to distribute to holders",
  "marketing-treasury": "a marketing/treasury wallet",
  liquidity: "auto-added to liquidity",
  unknown: "an undetermined destination",
};

export function analyzeTokenomics(
  d: TokenDossier,
  meta: GoPlusMeta | null,
  rc: RugcheckReport | null,
  code: CodeTokenomics | null,
): TokenomicsView {
  const s = d.safety;
  const sol = d.chain === "solana";
  const holders: LabeledHolder[] = meta?.holders ?? [];

  // --- 1. separate pools / CEX / reward pools / burns from holders ---
  const pools: TokenomicsView["pools"] = [];
  const cexHeld: TokenomicsView["cexHeld"] = [];
  const rewardPools: TokenomicsView["rewardPools"] = [];
  const burnHolders: LabeledHolder[] = [];
  const realHolders: LabeledHolder[] = [];
  for (const h of holders) {
    if (isBurnAddr(h.address) || BURN_TAG.test(h.tag)) { burnHolders.push(h); continue; }
    if (POOL_TAG.test(h.tag)) { pools.push({ address: h.address, label: label(h, "pool"), pct: h.percent }); continue; }
    if (CEX_TAG.test(h.tag)) { cexHeld.push({ address: h.address, label: label(h, "exchange"), pct: h.percent }); continue; }
    if (REWARD_TAG.test(h.tag) || (h.isContract && REWARD_TAG.test(h.tag))) { rewardPools.push({ address: h.address, label: label(h, "reward pool"), pct: h.percent }); continue; }
    realHolders.push(h);
  }
  // When there are no labeled holders (Solana — meta is EVM-only), fall back to
  // the base audit's top-holder figure rather than reporting a misleading 0%.
  const realHolderTopPct = realHolders.length
    ? Math.max(...realHolders.map((h) => h.percent))
    : (s.topHolderPct ?? 0);

  // --- 2. LP lock, launchpad-aware ---
  const lpHolders = meta?.lpHolders ?? [];
  let burnedPct = s.lpBurnedPct;
  let lockedPct = s.lpLockedPct;
  let unlockedTopPct = s.lpTopUnlockedEoaPct;
  const lockers = new Set<string>();
  // Recognize lockers by tag even when is_locked wasn't set (launchpad custody).
  let launchpadLockedPct = 0;
  for (const h of lpHolders) {
    if (LOCKER_TAG.test(h.tag)) {
      lockers.add(h.tag.trim());
      if (!h.isLocked) launchpadLockedPct += h.percent; // counted as locked-by-custody
    }
  }
  // RugCheck lockers (Solana) fold in.
  if (rc?.lockerNames?.length) rc.lockerNames.forEach((n) => lockers.add(n));
  if (rc && rc.lockerPct > lockedPct) lockedPct = rc.lockerPct;
  const effectiveLocked = lockedPct + launchpadLockedPct;
  const hasLaunchpadLocker = [...lockers].some((l) => LAUNCHPAD_LOCKER.test(l));

  let status: LpStatus;
  let note: string;
  if (burnedPct >= 50) { status = "burned"; note = `${burnedPct.toFixed(0)}% of the liquidity is burned — permanently unpullable.`; }
  else if (effectiveLocked >= 50) {
    if (hasLaunchpadLocker && lockedPct < 50) { status = "launchpad-locked"; note = `Liquidity is held by a launchpad locker (${[...lockers].join(", ")}) — auto-locked by design.`; }
    else { status = "locked"; note = `${effectiveLocked.toFixed(0)}% of the liquidity is locked${lockers.size ? ` (${[...lockers].join(", ")})` : ""}.`; }
  } else if (unlockedTopPct >= 50) { status = "unlocked"; note = `${unlockedTopPct.toFixed(0)}% of the liquidity sits in a single unlocked wallet — it can be pulled at any time.`; }
  else if (hasLaunchpadLocker) { status = "launchpad-locked"; note = `A launchpad locker (${[...lockers].join(", ")}) holds liquidity — likely auto-locked by design; confirm on the launchpad.`; }
  else {
    // The Robinhood/Pons caveat: an early-launchpad lock may not surface in
    // DexScreener/GoPlus. Don't assert "removable" as fact.
    status = "unconfirmed";
    note = sol || d.chain === "robinhood" || (d.ageDays ?? 999) < 30
      ? "Lock not confirmed by standard tools. On early-stage launchpad chains (e.g. Robinhood/Pons) liquidity is sometimes locked at the launchpad contract and does not surface here — verify on the launchpad/explorer before assuming it's removable."
      : "Liquidity does not appear locked or burned in standard tools — treat the pool as removable unless a lock is confirmed elsewhere.";
  }

  // --- 3. reward pools already separated above; note cadence is a next phase ---

  // --- 4. tax destination ---
  const dests = code?.taxDestinations ?? [];
  const positiveDest = dests.includes("reflection") || dests.includes("buyback-burn") || dests.includes("rwa-distribution");
  const taxTotal = s.buyTax + s.sellTax;
  let taxNote: string;
  let taxTone: "good" | "warn" | "neutral";
  if (taxTotal === 0 && !dests.length) { taxNote = sol ? "No transfer tax detected." : "No buy or sell tax."; taxTone = "good"; }
  else if (dests.length) {
    const readable = dests.map((x) => TAX_DEST_LABEL[x]).join(", ");
    taxNote = `Tax (buy ${s.buyTax.toFixed(1)}% / sell ${s.sellTax.toFixed(1)}%) routes to ${readable}.`;
    // RWA/reflection/buyback are legitimate — even attractive — mechanisms.
    taxTone = positiveDest && s.sellTax < 15 ? "good" : s.sellTax >= 20 ? "warn" : "neutral";
  } else { taxNote = `Tax (buy ${s.buyTax.toFixed(1)}% / sell ${s.sellTax.toFixed(1)}%) — destination not readable from ${d.chain === "solana" ? "an SPL token" : "the code"}.`; taxTone = s.sellTax >= 20 ? "warn" : "neutral"; }

  // --- 5. burns ---
  const burnedSupplyPct = burnHolders.reduce((a, h) => a + h.percent, 0);
  const burnAddresses = burnHolders.map((h) => h.address);
  const hasBurnFunction = !!code?.hasBurnFunction;
  const hasAutoBurn = !!code?.hasAutoBurn;
  let burnNote: string;
  if (burnedSupplyPct >= 1) burnNote = `~${burnedSupplyPct.toFixed(burnedSupplyPct < 10 ? 1 : 0)}% of total supply has been sent to burn addresses${hasAutoBurn ? "; the contract also auto-burns a share of every taxed transfer" : hasBurnFunction ? "; the contract exposes a burn function" : ""}.`;
  else if (hasAutoBurn) burnNote = "The contract auto-burns a share of every taxed transfer (ongoing deflation), though little supply has accumulated at burn addresses yet.";
  else if (hasBurnFunction) burnNote = "The contract exposes a burn function, but little supply has been burned so far.";
  else burnNote = "No meaningful burn detected.";

  const summary = [
    pools.length ? `${pools.length} pool${pools.length === 1 ? "" : "s"} identified and excluded from holder concentration` : "",
    rewardPools.length ? `${rewardPools.length} reward/emission pool${rewardPools.length === 1 ? "" : "s"} separated` : "",
    `real top holder ${realHolderTopPct.toFixed(0)}% after exclusions`,
  ].filter(Boolean).join("; ");

  return {
    pools, cexHeld, rewardPools,
    lp: { status, burnedPct, lockedPct: effectiveLocked, unlockedTopPct, lockers: [...lockers], note },
    tax: { buy: s.buyTax, sell: s.sellTax, destinations: dests, note: taxNote, tone: taxTone },
    burn: { burnedSupplyPct, hasBurnFunction, hasAutoBurn, addresses: burnAddresses, note: burnNote },
    realHolderTopPct, note: summary,
  };
}
