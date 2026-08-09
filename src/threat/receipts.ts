// Receipts: the scanner's recorded track record (localStorage, same pattern as
// lib/watchlist). Every scan is recorded with the liquidity AT flag time; a
// later re-check turns a flagged call into a receipt — "flagged DANGER at $32K
// liquidity, now $0, dead." The same ledger doubles as deployer memory: a
// deployer whose past tokens were flagged and died carries that history into
// every new scan.

import type { Receipt, ThreatVerdict } from "./types";
import { dexByToken, pickPair } from "../token/sources";

const KEY = "argus.threat.receipts.v1";
const MAX = 500;

export function getReceipts(): Receipt[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(items: Receipt[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* storage full/blocked — receipts are best-effort */
  }
}

export function recordReceipt(r: Receipt) {
  const items = getReceipts().filter(
    (x) => !(x.address.toLowerCase() === r.address.toLowerCase() && x.chain === r.chain),
  );
  items.unshift(r);
  save(items);
}

// Prior scans by the same deployer — the local "rug factory" memory.
export function byDeployer(deployer: string): Receipt[] {
  const d = deployer.toLowerCase();
  return getReceipts().filter((r) => r.deployer?.toLowerCase() === d);
}

const BAD: ThreatVerdict[] = ["DANGER", "RUG"];

// Re-check a receipt against the live market and grade the outcome. A token we
// flagged that lost its pool is a receipt; one that recovered is an honest miss
// and is shown just the same — a track record only means something with the
// misses left in.
export async function checkReceipt(r: Receipt): Promise<Receipt> {
  const pair = pickPair(await dexByToken(r.address), r.address);
  const liqNow = pair?.liquidity?.usd ?? 0;
  const priceDropPct =
    r.liqThen > 0 ? Math.max(0, Math.min(100, Math.round((1 - liqNow / r.liqThen) * 100))) : undefined;
  const status: Receipt["status"] =
    liqNow < 1000 ? "dead" : liqNow < r.liqThen * 0.2 ? "bleeding" : "alive";
  const updated: Receipt = { ...r, liqNow, priceDropPct, status, checkedAt: Date.now() };
  const items = getReceipts().map((x) =>
    x.address.toLowerCase() === r.address.toLowerCase() && x.chain === r.chain ? updated : x,
  );
  save(items);
  return updated;
}

// Summary line for the track-record header: of everything we flagged, how many
// went to zero.
export function receiptStats(): { flagged: number; confirmedDead: number; checked: number } {
  const flaggedList = getReceipts().filter((r) => BAD.includes(r.verdict));
  const checked = flaggedList.filter((r) => r.checkedAt != null);
  return {
    flagged: flaggedList.length,
    confirmedDead: checked.filter((r) => r.status === "dead").length,
    checked: checked.length,
  };
}
