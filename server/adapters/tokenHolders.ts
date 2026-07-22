// Float-control profile for a PROJECT's verified canonical token: who holds the
// supply, and whether the DEX liquidity can walk away. The token-scan pipeline
// already computes this from GoPlus (free, keyless); project reports never did,
// leaving the reader's "is the float insider-controlled / can the LP be pulled?"
// question unanswered. This mirrors src/token/audit.ts semantics exactly (percent
// strings are fractions of supply; LP burned-or-locked classification) so both
// report surfaces agree. Disclosure data only: it mints a checkable tokenomics
// fact and never a score floor or a rug verdict on its own.
import { GOPLUS_CHAIN, goplus } from "../../src/token/sources";
import { recordCall } from "../cost";

export interface HolderProfile {
  /** largest single holder, percent of supply */
  topHolderPct: number | null;
  /** top ten holders combined, percent of supply (capped at 100) */
  top10Pct: number | null;
  holderCount: number | null;
  /** DEX liquidity burned or verifiably locked, percent; null when GoPlus reports no LP register */
  lpLockedOrBurnedPct: number | null;
  sourceUrl: string;
}

export type HolderProfileOutcome =
  | { available: true; value: HolderProfile }
  | { available: false; note: string };

const FETCH_TIMEOUT_MS = 8_000;

const isBurnAddr = (a?: string) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
const isBurnTag = (t?: string) => /null|burn|dead|0x0{4,}/i.test(t ?? "");

/** Never throws; a missing chain map, timeout, or empty register is a completed no-data outcome. */
export async function collectHolderProfile(chain: string, address: string): Promise<HolderProfileOutcome> {
  const chainId = GOPLUS_CHAIN[chain.trim().toLowerCase()];
  if (!chainId || !address) {
    return { available: false, note: `No GoPlus holder register for chain "${chain}".` };
  }
  // sources.goplus carries no abort signal; box it so one slow origin cannot
  // eat the collection budget (same pattern as grounded-search page fetches).
  const gp = await Promise.race([
    goplus(chainId, address).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
  ]);
  if (!gp) {
    recordCall("goplus", "holder-profile", 0, `${chain}:${address.slice(0, 10)} · no_data`, "partial");
    return { available: false, note: "GoPlus returned no token security record." };
  }

  const holders = Array.isArray(gp.holders) ? gp.holders : [];
  const pct = (raw?: string): number | null => {
    const value = Number(raw) * 100;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const topHolderPct = holders.length ? pct(holders[0].percent) : null;
  const top10 = holders.slice(0, 10)
    .map((holder) => pct(holder.percent) ?? 0)
    .reduce((total, share) => total + share, 0);
  const top10Pct = holders.length ? Math.min(100, top10) : null;
  const holderCountRaw = Number(gp.holder_count);
  const holderCount = Number.isFinite(holderCountRaw) && holderCountRaw > 0 ? Math.round(holderCountRaw) : null;

  const lpHolders = Array.isArray(gp.lp_holders) ? gp.lp_holders : [];
  let lpLockedOrBurned = 0;
  for (const holder of lpHolders) {
    const share = pct(holder.percent);
    if (share === null) continue;
    if (isBurnAddr(holder.address) || isBurnTag(holder.tag) || holder.is_locked === 1) lpLockedOrBurned += share;
  }
  const lpLockedOrBurnedPct = lpHolders.length ? Math.min(100, lpLockedOrBurned) : null;

  if (topHolderPct === null && holderCount === null && lpLockedOrBurnedPct === null) {
    recordCall("goplus", "holder-profile", 0, `${chain}:${address.slice(0, 10)} · empty_register`, "succeeded");
    return { available: false, note: "GoPlus reported no holder or liquidity register for this token." };
  }
  recordCall("goplus", "holder-profile", 0, `${chain}:${address.slice(0, 10)} · top_${topHolderPct === null ? "na" : Math.round(topHolderPct)}pct`, "succeeded");
  return {
    available: true,
    value: {
      topHolderPct,
      top10Pct,
      holderCount,
      lpLockedOrBurnedPct,
      sourceUrl: `https://gopluslabs.io/token-security/${chainId}/${address}`,
    },
  };
}
