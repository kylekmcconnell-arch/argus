import { tokenSubjectIdentity } from "./tokenIdentity";
// Client-side watchlist (localStorage). Saves audited subjects/tokens with a
// baseline snapshot so re-checking surfaces drift: verdict downgrades, liquidity
// pulls, score drops. Keyless "alerts" without a backend; true push alerts would
// be a Vercel cron over the collector later.

import { normalizeSubjectRef } from "./subjectRef";
import type { ReportCompletenessState } from "./reportVersion";

export interface WatchSnapshot {
  verdict: string;
  score: number | null;
  /** Frozen coverage state used to keep positive verdicts fail-closed. */
  completenessState?: ReportCompletenessState;
  liquidityUsd?: number;
  mcap?: number;
}

export interface WatchItem {
  id: string; // "@handle" or token contract address
  kind: "person" | "token";
  label: string; // "@handle" or "$SYM"
  chain?: string;
  via?: "evm" | "solana" | "dexscreener";
  addedAt: number;
  snapshot: WatchSnapshot;
}

const KEY = "argus.watchlist.v1";

export function getWatchlist(): WatchItem[] {
  try {
    const rows: WatchItem[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    return rows.map(row => row.kind === "token" && row.chain ? { ...row, id: tokenSubjectIdentity(row.chain, row.id.includes(":") ? row.id.split(":")[1] : row.id)?.ref ?? row.id } : row);
  } catch {
    return [];
  }
}

function save(items: WatchItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function isWatched(id: string): boolean {
  return getWatchlist().some((w) => normalizeSubjectRef(w.id) === normalizeSubjectRef(id));
}

export function addWatch(item: WatchItem) {
  if (item.kind === "token") item = { ...item, id: tokenSubjectIdentity(item.chain, item.id.includes(":") ? item.id.split(":")[1] : item.id)?.ref ?? item.id };
  const itemRef = normalizeSubjectRef(item.id);
  const items = getWatchlist().filter((w) => normalizeSubjectRef(w.id) !== itemRef);
  items.unshift(item);
  save(items);
  // Sync up (kind='watch' row) so the watchlist is SHARED between analysts and
  // visible to the manual sweep. Fire-and-forget; local stays the working copy.
  void fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "watch", ref: item.id, query: item.label, payload: { item } }),
  }).catch(() => { /* offline */ });
}

export function removeWatch(id: string) {
  const target = normalizeSubjectRef(id);
  save(getWatchlist().filter((w) => normalizeSubjectRef(w.id) !== target));
  void fetch(`/api/report?ref=${encodeURIComponent(id)}&kind=watch`, { method: "DELETE" }).catch(() => { /* offline */ });
}

// Pull the shared watchlist down and merge into local (an item another analyst
// watched appears here too). Local removals stick because removeWatch deletes
// the shared row as well.
/**
 * Shared rows are written by other analysts' clients (possibly older builds)
 * and by the server, so they are validated before they reach every browser's
 * localStorage: a row without a kind, label, or a snapshot verdict crashed the
 * Watchlist page for everyone until it was removed by hand.
 */
export function parseSharedWatchItem(value: unknown): WatchItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  if (row.kind !== "person" && row.kind !== "token") return null;
  if (typeof row.label !== "string" || !row.label.trim()) return null;
  const snapshot = row.snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const snap = snapshot as Record<string, unknown>;
  if (typeof snap.verdict !== "string" || !snap.verdict.trim()) return null;
  if (snap.score !== null && snap.score !== undefined && typeof snap.score !== "number") return null;
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    ...(typeof row.chain === "string" ? { chain: row.chain } : {}),
    ...(row.via === "evm" || row.via === "solana" || row.via === "dexscreener" ? { via: row.via } : {}),
    addedAt: typeof row.addedAt === "number" && Number.isFinite(row.addedAt) ? row.addedAt : Date.now(),
    snapshot: {
      verdict: snap.verdict,
      score: typeof snap.score === "number" ? snap.score : null,
      ...(typeof snap.completenessState === "string" ? { completenessState: snap.completenessState as ReportCompletenessState } : {}),
      ...(typeof snap.liquidityUsd === "number" ? { liquidityUsd: snap.liquidityUsd } : {}),
      ...(typeof snap.mcap === "number" ? { mcap: snap.mcap } : {}),
    },
  };
}

export async function hydrateSharedWatchlist(): Promise<void> {
  try {
    const r = await fetch("/api/report?watches=1", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const d = await r.json() as { watches?: unknown[] };
    const shared = (Array.isArray(d?.watches) ? d.watches : [])
      .map(parseSharedWatchItem)
      .filter((w): w is WatchItem => w !== null);
    if (!shared.length) return;
    const local = getWatchlist();
    const have = new Set(local.map((w) => normalizeSubjectRef(w.id)));
    const merged = [...local, ...shared.filter((w) => !have.has(normalizeSubjectRef(w.id)))];
    if (merged.length !== local.length) save(merged);
  } catch { /* stay local-only */ }
}

export function toggleWatch(item: WatchItem): boolean {
  if (isWatched(item.id)) {
    removeWatch(item.id);
    return false;
  }
  addWatch(item);
  return true;
}

// re-baseline an item to the current snapshot (mark as seen)
export function rebaseline(id: string, snapshot: WatchSnapshot) {
  const target = normalizeSubjectRef(id);
  const items = getWatchlist().map((w) => (normalizeSubjectRef(w.id) === target ? { ...w, snapshot } : w));
  save(items);
}
