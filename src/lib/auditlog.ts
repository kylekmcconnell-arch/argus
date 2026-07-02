// Every audit that runs is logged locally — the analyst's own record, for
// self-verification ("what did we actually return for that query?") and the
// beginnings of the data asset. Persisted to localStorage until there is a
// backend; capped so it cannot grow unbounded.

export type AuditKind = "site" | "token" | "person";

export interface LogEntry {
  id: string;
  ts: number;
  kind: AuditKind;
  query: string;          // display label (e.g. $SYMBOL, @handle, a site URL)
  ref?: string;           // the re-runnable identifier (contract / handle / url)
  image?: string;         // logo/photo URL captured at audit time (e.g. token logo)
  verdict?: string;       // PASS/CAUTION/FAIL/AVOID, or site coverage status
  score?: number | null;
  summary: string;        // one-line takeaway (identity line / headline)
  coverage?: string;      // 'rendered' | 'recovered' | 'gap' for site recon
  flags?: string[];       // caps, coverage gaps, contradictions worth surfacing
  contributor?: string;   // analyst who ran it (shared-log rows only; local rows omit it)
}

const KEY = "argus:auditlog";
const CAP = 250;
const SYNC_URL = "/api/auditlog";

export function getLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

let counter = 0;
function makeId(ts: number): string {
  // deterministic-enough id without Math.random; ts + a per-session counter
  counter += 1;
  return `${ts.toString(36)}-${counter.toString(36)}`;
}

export function logAudit(e: Omit<LogEntry, "id" | "ts">): LogEntry {
  const ts = Date.now();
  const entry: LogEntry = { ...e, id: makeId(ts), ts };
  let isNew = true;
  try {
    const log = getLog();
    // de-dupe an immediate repeat of the same query+kind within 5s
    const recent = log[0];
    if (!(recent && recent.kind === e.kind && recent.query === e.query && ts - recent.ts < 5000)) {
      log.unshift(entry);
      localStorage.setItem(KEY, JSON.stringify(log.slice(0, CAP)));
    } else {
      isNew = false;
    }
  } catch {
    /* storage unavailable — non-fatal */
  }
  if (isNew) { void syncEntry(entry); emitLogChange(); }
  return entry;
}

export function clearLog(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  emitLogChange();
}

// ── shared audit log: push up on write, hydrate down on load ────────────────
type LogListener = () => void;
const listeners = new Set<LogListener>();
export function subscribeLog(cb: LogListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function emitLogChange(): void {
  for (const cb of [...listeners]) { try { cb(); } catch { /* */ } }
}

async function syncEntry(entry: LogEntry): Promise<void> {
  try {
    const { getAnalyst } = await import("./analyst");
    await fetch(SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entry, contributor: getAnalyst() }),
    });
  } catch {
    /* offline or no backend — the local log still holds it */
  }
}

let sharedCache: LogEntry[] = [];
let hydrated = false;
// The community feed (all analysts), fetched once per session. Kept SEPARATE
// from the local log so "mine" and "community" stay distinguishable; callers
// merge them via mergedLog(). No-op when no backend is configured.
export async function hydrateSharedLog(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const r = await fetch(SYNC_URL, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return;
    const d = await r.json();
    if (d?.available === false || !Array.isArray(d?.entries)) return;
    sharedCache = d.entries as LogEntry[];
    emitLogChange();
  } catch {
    /* stay local-only */
  }
}

export function getSharedLog(): LogEntry[] {
  return sharedCache;
}

// Local + community, de-duped by id, newest first. Local entries win (they carry
// the freshest "mine" view); remote-only entries bring their contributor tag.
export function mergedLog(): LogEntry[] {
  const local = getLog();
  const seen = new Set(local.map((e) => e.id));
  const out = [...local];
  for (const e of sharedCache) if (!seen.has(e.id)) out.push(e);
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

export function logStats(log: LogEntry[]): { total: number; gaps: number; byKind: Record<AuditKind, number> } {
  const byKind: Record<AuditKind, number> = { site: 0, token: 0, person: 0 };
  let gaps = 0;
  for (const e of log) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.coverage === "gap" || e.flags?.some((f) => /gap/i.test(f))) gaps += 1;
  }
  return { total: log.length, gaps, byKind };
}
