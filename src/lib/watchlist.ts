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
}

export function removeWatch(id: string) {
  save(getWatchlist().filter((w) => w.id.toLowerCase() !== id.toLowerCase()));
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
