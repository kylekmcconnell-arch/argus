// Client-side watchlist (localStorage). Saves audited subjects/tokens with a
// baseline snapshot so re-checking surfaces drift: verdict downgrades, liquidity
// pulls, score drops. Keyless "alerts" without a backend; true push alerts would
// be a Vercel cron over the collector later.

export interface WatchSnapshot {
  verdict: string;
  score: number | null;
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
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(items: WatchItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function isWatched(id: string): boolean {
  return getWatchlist().some((w) => w.id.toLowerCase() === id.toLowerCase());
}

export function addWatch(item: WatchItem) {
  const items = getWatchlist().filter((w) => w.id.toLowerCase() !== item.id.toLowerCase());
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
  save(getWatchlist().filter((w) => w.id.toLowerCase() !== id.toLowerCase()));
  void fetch(`/api/report?ref=${encodeURIComponent(id)}&kind=watch`, { method: "DELETE" }).catch(() => { /* offline */ });
}

// Pull the shared watchlist down and merge into local (an item another analyst
// watched appears here too). Local removals stick because removeWatch deletes
// the shared row as well.
export async function hydrateSharedWatchlist(): Promise<void> {
  try {
    const r = await fetch("/api/report?watches=1", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const d = await r.json();
    const shared: WatchItem[] = Array.isArray(d?.watches) ? d.watches : [];
    if (!shared.length) return;
    const local = getWatchlist();
    const have = new Set(local.map((w) => w.id.toLowerCase()));
    const merged = [...local, ...shared.filter((w) => w && w.id && !have.has(w.id.toLowerCase()))];
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
  const items = getWatchlist().map((w) => (w.id.toLowerCase() === id.toLowerCase() ? { ...w, snapshot } : w));
  save(items);
}
