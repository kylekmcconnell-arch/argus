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
}

const KEY = "argus:auditlog";
const CAP = 250;

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
  try {
    const log = getLog();
    // de-dupe an immediate repeat of the same query+kind within 5s
    const recent = log[0];
    if (!(recent && recent.kind === e.kind && recent.query === e.query && ts - recent.ts < 5000)) {
      log.unshift(entry);
      localStorage.setItem(KEY, JSON.stringify(log.slice(0, CAP)));
    }
  } catch {
    /* storage unavailable — non-fatal */
  }
  return entry;
}

export function clearLog(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
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
