/** LP-holder and pause-capability guards. GoPlus often mislabels the token
 *  contract as a 99% LP holder and reports a pause function after ownership is
 *  already 0x0. Those are not evidence that liquidity can be pulled or that
 *  trading can be paused. */

export interface LpHolderRow {
  address?: string;
  percent?: string | number;
  is_locked?: number;
  is_contract?: number;
  tag?: string;
}

export interface LpProtectionSummary {
  lpBurnedPct: number;
  lpLockedPct: number;
  lpTopUnlockedEoaPct: number;
  lpAssessed: boolean;
  lpLocked: boolean;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function sameAddress(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (EVM_ADDRESS.test(a) && EVM_ADDRESS.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

const isBurnAddr = (a?: string) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
const isBurnTag = (t?: string) => /null|burn|dead|0x0{4,}/i.test(t ?? "");

export function summarizeLpHolders(
  holders: LpHolderRow[] | undefined,
  opts: { tokenAddress?: string; poolAddresses?: string[] } = {},
): LpProtectionSummary {
  let lpBurnedPct = 0;
  let lpLockedPct = 0;
  let lpTopUnlockedEoaPct = 0;
  let lpContractPct = 0;
  let lpRowsSeen = 0;
  const pools = opts.poolAddresses ?? [];
  for (const holder of holders ?? []) {
    const pct = Number(holder.percent) * 100;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    const address = holder.address ?? "";
    if (opts.tokenAddress && sameAddress(address, opts.tokenAddress)) continue;
    if (pools.some((pool) => sameAddress(address, pool))) continue;
    lpRowsSeen += 1;
    if (isBurnAddr(address) || isBurnTag(holder.tag)) lpBurnedPct += pct;
    else if (holder.is_locked === 1) lpLockedPct += pct;
    else if (holder.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
    else lpContractPct += pct;
  }
  const accounted = lpBurnedPct + lpLockedPct + lpContractPct + lpTopUnlockedEoaPct;
  const lpAssessed = lpRowsSeen > 0 && accounted >= 50;
  return {
    lpBurnedPct,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    lpAssessed,
    lpLocked: lpBurnedPct + lpLockedPct >= 50,
  };
}

/** A pause function with no reachable owner is not a live trading halt. */
export function pauseIsCallable(input: {
  pausable: boolean;
  ownerRenounced: boolean;
  takeBack?: boolean;
  hiddenOwner?: boolean;
}): boolean {
  if (!input.pausable) return false;
  if (input.takeBack || input.hiddenOwner) return true;
  return !input.ownerRenounced;
}
