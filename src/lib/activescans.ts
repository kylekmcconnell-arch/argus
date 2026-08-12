// A live registry of scans currently in flight, so the sidebar can show a
// "scanning…" indicator for EVERY audit type — token, investigation, and site —
// not just the backgrounded person runs (which the runner tracks separately).
// A foreground run registers when it starts and clears when it finishes, so the
// sidebar always shows what's actively being scanned until it completes.
export interface ActiveScan {
  id: string;             // unique per run instance
  label: string;          // display label (e.g. $TICKER or a truncated address)
  kind: "token" | "site" | "investigation";
  ref: string;            // subject id, for an "open when done" click
  pct: number;            // 0-100 progress
  startedAt: number;
}

type Listener = () => void;
const scans = new Map<string, ActiveScan>();
const listeners = new Set<Listener>();
function emit() { for (const l of listeners) l(); }

export function subscribeScans(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function activeScans(): ActiveScan[] {
  return [...scans.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function beginScan(s: Omit<ActiveScan, "startedAt" | "pct"> & { pct?: number }): void {
  scans.set(s.id, { pct: 0, ...s, startedAt: Date.now() });
  emit();
}

export function updateScan(id: string, pct: number): void {
  const s = scans.get(id);
  if (s && pct !== s.pct) { s.pct = pct; emit(); }
}

export function endScan(id: string): void {
  if (scans.delete(id)) emit();
}
