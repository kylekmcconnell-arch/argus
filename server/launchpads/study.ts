import { createHash } from "node:crypto";
import { tokenSubjectIdentity } from "../../src/lib/tokenIdentity.js";

export const PLATFORMS = ["bankr", "pumpfun", "long", "pons", "stonkbrokers", "letsbonk", "stonkfun", "bags"] as const;
export type Platform = typeof PLATFORMS[number];
export const METRICS = ["marketCapUsd", "liquidityUsd", "volume24hUsd", "volume7dUsd", "volume30dUsd"] as const;
export type Metric = typeof METRICS[number];
export const EXCHANGES = ["Bitget", "MEXC", "Bybit", "Gate", "OKX", "Binance.com", "Binance US", "Kraken", "Upbit", "Robinhood", "Crypto.com"] as const;
export interface LaunchObservation {
  address: string;
  /** Evidence must establish this token's origin, not an address suffix or name. */
  attribution: { status: "candidate" | "confirmed"; evidenceUrl: string; method: "factory-event" | "protocol-record" | "research-lead" };
  metrics: Partial<Record<Metric, number | null>>;
  /** Pool-specific depth, never a sum that includes the token as quote elsewhere. */
  liquidityBasis: "identified-pools" | "unverified";
  marketCapBasis: "circulating-supply" | "fdv" | "unknown";
  volumeQuality: "unreviewed" | "suspected-artificial" | "corroborated";
  listings: Array<{ exchange: typeof EXCHANGES[number]; evidenceUrl: string; checkedAt: string }>;
}
export interface StudyPage {
  platform: Platform;
  chain: string;
  /** Fixed observation time across pages; never combine different ranking dates. */
  asOf: string;
  sourceUrl: string;
  collectedAt: string;
  cursor: string | null;
  nextCursor: string | null;
  scope: "full-launch-population" | "provider-sample";
  rows: LaunchObservation[];
}
export interface StudyReceipt { sha256: string; page: StudyPage }
export interface StudyLedger { version: 1; receipts: StudyReceipt[] }
const hash = (page: StudyPage) => createHash("sha256").update(JSON.stringify(page)).digest("hex");
const iso = (value: unknown) => typeof value === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
function url(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
function assertPage(page: StudyPage): void {
  if (!page || !PLATFORMS.includes(page.platform) || !iso(page.asOf) || !iso(page.collectedAt)
    || Date.parse(page.collectedAt) < Date.parse(page.asOf) || !url(page.sourceUrl)
    || !["full-launch-population", "provider-sample"].includes(page.scope)
    || ![page.cursor, page.nextCursor].every(c => c === null || typeof c === "string" && c.length > 0 && c.length <= 2048)
    || !Array.isArray(page.rows) || page.rows.length > 10000) throw new Error("Invalid study page or provenance");
  const addresses = new Set<string>();
  for (const row of page.rows) {
    const identity = tokenSubjectIdentity(page.chain, row.address);
    if (!identity || identity.chain !== page.chain || addresses.has(identity.ref)) throw new Error("Invalid or duplicate token identity");
    addresses.add(identity.ref);
    if (!row.attribution || !url(row.attribution.evidenceUrl)
      || !["candidate", "confirmed"].includes(row.attribution.status)
      || !["factory-event", "protocol-record", "research-lead"].includes(row.attribution.method)
      || row.attribution.status === "confirmed" && row.attribution.method === "research-lead") throw new Error("Unproven launch attribution");
    if (!row.metrics || Object.entries(row.metrics).some(([key, value]) => !METRICS.includes(key as Metric) || value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))) throw new Error("Invalid metric");
    if (!["identified-pools", "unverified"].includes(row.liquidityBasis)
      || !["circulating-supply", "fdv", "unknown"].includes(row.marketCapBasis)
      || !["unreviewed", "suspected-artificial", "corroborated"].includes(row.volumeQuality)
      || !Array.isArray(row.listings) || row.listings.some(l => !EXCHANGES.includes(l.exchange) || !url(l.evidenceUrl) || !iso(l.checkedAt) || Date.parse(l.checkedAt) > Date.parse(page.collectedAt))) throw new Error("Invalid measurement or listing provenance");
  }
}
const group = (p: StudyPage) => `${p.platform}:${p.chain}:${Date.parse(p.asOf)}`;
/** Pure append: a repeated receipt is idempotent; a reused cursor with different data is rejected. */
export function appendStudyPage(ledger: StudyLedger, page: StudyPage): StudyLedger {
  assertPage(page);
  const sha256 = hash(page);
  if (ledger.receipts.some(r => r.sha256 === sha256)) return ledger;
  const previous = ledger.receipts.filter(r => group(r.page) === group(page));
  const last = previous.at(-1)?.page;
  if (!last && page.cursor !== null || last && (last.nextCursor === null || page.cursor !== last.nextCursor)) throw new Error("Cursor is out of sequence or collection is already terminal");
  if (last && (last.scope !== page.scope || last.sourceUrl !== page.sourceUrl)) throw new Error("Collection source or scope changed");
  if (page.nextCursor !== null && (page.nextCursor === page.cursor || previous.some(r => r.page.cursor === page.nextCursor))) throw new Error("Cursor loop");
  const seen = new Set(previous.flatMap(r => r.page.rows.map(row => tokenSubjectIdentity(page.chain, row.address)!.ref)));
  if (page.rows.some(row => seen.has(tokenSubjectIdentity(page.chain, row.address)!.ref))) throw new Error("Overlapping pages need reconciliation before indexing");
  return { version: 1, receipts: [...ledger.receipts, { sha256, page: structuredClone(page) }] };
}
/** Revalidate disk input and receipts before using a resumed ledger. */
export function readStudyLedger(input: unknown): StudyLedger {
  const raw = input as StudyLedger;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.receipts)) throw new Error("Invalid study ledger");
  let result: StudyLedger = { version: 1, receipts: [] };
  for (const receipt of raw.receipts) {
    if (!receipt || receipt.sha256 !== hash(receipt.page)) throw new Error("Study receipt hash mismatch");
    result = appendStudyPage(result, receipt.page);
  }
  return result;
}
export function studyCoverage(ledger: StudyLedger) {
  const groups = new Map<string, StudyReceipt[]>();
  for (const receipt of ledger.receipts) groups.set(group(receipt.page), [...(groups.get(group(receipt.page)) ?? []), receipt]);
  return [...groups.values()].map(receipts => {
    const first = receipts[0].page, last = receipts.at(-1)!.page;
    const rows = receipts.flatMap(r => r.page.rows.map(row => ({ ...row, receipt: r.sha256 })));
    const confirmed = rows.filter(row => row.attribution.status === "confirmed");
    const terminal = last.nextCursor === null;
    const populationReportedComplete = terminal && first.scope === "full-launch-population";
    const rankings = METRICS.map(metric => {
      const usable = confirmed.filter(row => typeof row.metrics[metric] === "number"
        && (metric !== "marketCapUsd" || row.marketCapBasis === "circulating-supply")
        && (metric !== "liquidityUsd" || row.liquidityBasis === "identified-pools")
        && (!metric.startsWith("volume") || row.volumeQuality === "corroborated"));
      const complete = populationReportedComplete && confirmed.length === rows.length && usable.length === rows.length;
      return { metric, status: complete ? "source-reported-complete" : "partial", measured: usable.length,
        excludedOrMissing: rows.length - usable.length,
        top25: [...usable].sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0) || a.address.localeCompare(b.address)).slice(0, 25)
          .map((row, index) => ({ rank: index + 1, address: row.address, value: row.metrics[metric], receipt: row.receipt })) };
    });
    return { platform: first.platform, chain: first.chain, asOf: first.asOf, nextCursor: last.nextCursor,
      terminal, populationReportedComplete, observed: rows.length, confirmed: confirmed.length, rankings };
  });
}
