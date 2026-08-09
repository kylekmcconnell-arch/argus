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
  // Fire-and-forget sync to the shared server ledger. This is what makes the
  // track record and deployer memory span every analyst, not just this browser.
  void fetch("/api/threat-receipts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: r.address, chain: r.chain, symbol: r.symbol, verdict: r.verdict,
      risk: r.risk, flaggedAt: r.flaggedAt, liqThen: r.liqThen, deployer: r.deployer,
      codeVerified: r.codeVerified, flagCount: r.flagCount,
    }),
  }).catch(() => { /* offline / static host — localStorage still holds it */ });
}

// Prior scans by the same deployer — the LOCAL "rug factory" memory (sync).
export function byDeployer(deployer: string): Receipt[] {
  const d = deployer.toLowerCase();
  return getReceipts().filter((r) => r.deployer?.toLowerCase() === d);
}

// The SHARED deployer memory: this browser's local receipts merged with every
// analyst's, from the server ledger. Async; falls back to local-only when the
// server is unreachable. Deduped by address, newest kept.
export async function sharedByDeployer(deployer: string): Promise<Receipt[]> {
  const local = byDeployer(deployer);
  try {
    const res = await fetch(`/api/threat-receipts?deployer=${encodeURIComponent(deployer)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return local;
    const d = (await res.json()) as { available?: boolean; receipts?: Receipt[] };
    if (!d.available || !Array.isArray(d.receipts)) return local;
    const byAddr = new Map<string, Receipt>();
    for (const r of [...d.receipts, ...local]) {
      const k = r.address.toLowerCase();
      const prev = byAddr.get(k);
      if (!prev || (r.flaggedAt ?? 0) > (prev.flaggedAt ?? 0)) byAddr.set(k, r);
    }
    return [...byAddr.values()];
  } catch {
    return local;
  }
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
// went to zero. Local-only (sync) — used for an instant first paint.
export function receiptStats(): { flagged: number; confirmedDead: number; checked: number } {
  const flaggedList = getReceipts().filter((r) => BAD.includes(r.verdict));
  const checked = flaggedList.filter((r) => r.checkedAt != null);
  return {
    flagged: flaggedList.length,
    confirmedDead: checked.filter((r) => r.status === "dead").length,
    checked: checked.length,
  };
}

// The SHARED track record from the server ledger (every analyst's flags), for
// the ledger line + a future track-record page. Falls back to local stats.
export async function sharedReceiptStats(): Promise<{ flagged: number; confirmedDead: number; checked: number; recent: Receipt[] }> {
  try {
    const res = await fetch("/api/threat-receipts", { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const d = (await res.json()) as { available?: boolean; receipts?: Receipt[]; stats?: { flagged: number; confirmedDead: number; checked: number } };
      if (d.available && d.stats) return { ...d.stats, recent: d.receipts ?? [] };
    }
  } catch { /* fall through to local */ }
  return { ...receiptStats(), recent: getReceipts().filter((r) => BAD.includes(r.verdict)).slice(0, 60) };
}
