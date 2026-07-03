// Scan analytics derived from the append-only audit log (local + the shared
// community log). Every audit/rescan is one row, so grouping by subject gives a
// real "how many times has this been scanned" count, a most-scanned ranking, and
// a trend (is scan activity accelerating or cooling) — all live, no new storage.
import { mergedLog, type LogEntry } from "./auditlog";

export interface ScanStat {
  key: string;            // `${kind}:${ref}` — stable id
  kind: LogEntry["kind"];
  ref: string;            // normalized subject id
  query: string;          // display label (@handle / $TICKER / host)
  count: number;          // total scans on record
  score?: number | null;
  verdict?: string | null;
  image?: string;         // best avatar for the subject
  lastTs: number;
  recentCount: number;    // scans in the last window
  priorCount: number;     // scans in the window before that
  trend: "up" | "down" | "flat";
  rank: number;           // 1-based, by count then recency
}

const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");

// Trend windows (ms). Compare the most recent stretch against the one before it.
const RECENT = 3 * 86400000;
const PRIOR = 6 * 86400000;

// Ranked scan stats, most-scanned first. `now` is injectable for tests.
export function scanStats(now = Date.now()): ScanStat[] {
  const by = new Map<string, ScanStat>();
  for (const e of mergedLog()) {
    const ref = norm(e.ref ?? e.query);
    if (!ref) continue;
    const key = `${e.kind}:${ref}`;
    let s = by.get(key);
    if (!s) {
      s = { key, kind: e.kind, ref, query: e.query || (e.ref ?? ref), count: 0, lastTs: 0, recentCount: 0, priorCount: 0, trend: "flat", rank: 0 };
      by.set(key, s);
    }
    s.count += 1;
    if (e.ts > s.lastTs) { s.lastTs = e.ts; s.query = e.query || s.query; }
    // first entry that carries a score/verdict/image wins for display (newest-first log)
    if (s.score == null && e.score != null) s.score = e.score;
    if (!s.verdict && e.verdict) s.verdict = e.verdict;
    if (!s.image && e.image) s.image = e.image;
    const age = now - e.ts;
    if (age <= RECENT) s.recentCount += 1;
    else if (age <= PRIOR) s.priorCount += 1;
  }
  const out = [...by.values()];
  for (const s of out) {
    s.trend = s.recentCount > s.priorCount ? "up" : s.recentCount < s.priorCount ? "down" : "flat";
  }
  out.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
  out.forEach((s, i) => { s.rank = i + 1; });
  return out;
}

// Scans for one subject (ref+kind), for the per-card "N scans" chip.
export function scanCountFor(kind: string, ref: string, stats?: ScanStat[]): ScanStat | undefined {
  const list = stats ?? scanStats();
  const k = `${kind}:${norm(ref)}`;
  return list.find((s) => s.key === k);
}

// Total scans on record (every audit/rescan row).
export function totalScans(): number {
  return mergedLog().length;
}
