// Scan analytics derived from the append-only audit log (local + the shared
// community log). Every audit/rescan is one row, so grouping by subject gives a
// real "how many times has this been scanned" count, a most-scanned ranking, a
// trend (accelerating vs cooling), and — with a time range + category filter —
// a "most scanned VCs in the last 24h" style leaderboard. No new storage.
import { mergedLog, type LogEntry } from "./auditlog";

export type ScanCategory = "founder" | "vc" | "kol" | "project" | "site" | "other";

export interface ScanStat {
  key: string;            // `${kind}:${ref}` — stable id
  kind: LogEntry["kind"];
  category: ScanCategory;
  ref: string;            // normalized subject id
  query: string;          // display label (@handle / $TICKER / host)
  count: number;          // scans within the selected window
  score?: number | null;
  verdict?: string | null;
  image?: string;         // best avatar for the subject
  lastTs: number;
  recentCount: number;    // scans in the more recent half of the window
  priorCount: number;     // scans in the earlier half
  trend: "up" | "down" | "flat";
  rank: number;           // 1-based, by count then recency
}

export interface ScanOpts {
  rangeMs?: number | null;      // only count scans newer than now-rangeMs (null = all time)
  category?: ScanCategory | null;
}

const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
const DEFAULT_HALF = 3 * 86400000; // all-time trend compares last 3d vs the 3d before

function categoryOf(e: LogEntry): ScanCategory {
  if (e.kind === "site") return "site";
  if (e.kind === "token") return "project"; // token / investigation audits are project deep-dives
  const role = (e.flags ?? []).map((f) => f.toLowerCase()).find((f) => f.startsWith("role:"))?.slice(5);
  if (role === "founder") return "founder";
  if (role === "investor") return "vc";
  if (role === "kol") return "kol";
  if (role === "project") return "project";
  return "other";
}

// Ranked scan stats, most-scanned first, within an optional time window + category.
export function scanStats(now = Date.now(), opts: ScanOpts = {}): ScanStat[] {
  const cutoff = opts.rangeMs ? now - opts.rangeMs : 0;
  // Trend split: the more recent half of the window vs the earlier half.
  const half = opts.rangeMs ? opts.rangeMs / 2 : DEFAULT_HALF;

  const by = new Map<string, ScanStat>();
  for (const e of mergedLog()) {
    if (e.ts < cutoff) continue;
    const ref = norm(e.ref ?? e.query);
    if (!ref) continue;
    const key = `${e.kind}:${ref}`;
    let s = by.get(key);
    if (!s) {
      s = { key, kind: e.kind, category: categoryOf(e), ref, query: e.query || (e.ref ?? ref), count: 0, lastTs: 0, recentCount: 0, priorCount: 0, trend: "flat", rank: 0 };
      by.set(key, s);
    }
    s.count += 1;
    if (e.ts > s.lastTs) { s.lastTs = e.ts; s.query = e.query || s.query; }
    if (s.score == null && e.score != null) s.score = e.score;
    if (!s.verdict && e.verdict) s.verdict = e.verdict;
    if (!s.image && e.image) s.image = e.image;
    const age = now - e.ts;
    if (age <= half) s.recentCount += 1;
    else if (age <= half * 2) s.priorCount += 1;
  }

  let out = [...by.values()];
  if (opts.category) out = out.filter((s) => s.category === opts.category);
  for (const s of out) s.trend = s.recentCount > s.priorCount ? "up" : s.recentCount < s.priorCount ? "down" : "flat";
  out.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
  out.forEach((s, i) => { s.rank = i + 1; });
  return out;
}

// All-time keyed map for the per-card scan chip. Cheap memo (500ms) so a page full
// of chips doesn't recompute the whole log per chip.
let _cache: { at: number; map: Map<string, ScanStat> } | null = null;
export function scanStatMapCached(): Map<string, ScanStat> {
  const now = Date.now();
  if (_cache && now - _cache.at < 500) return _cache.map;
  const map = new Map<string, ScanStat>();
  for (const s of scanStats(now)) map.set(s.key, s);
  _cache = { at: now, map };
  return map;
}

export function scanStatFor(kind: string, refId: string): ScanStat | undefined {
  return scanStatMapCached().get(`${kind}:${norm(refId)}`);
}

// Total scans on record (every audit/rescan row) — optionally within a window.
export function totalScans(rangeMs?: number | null): number {
  if (!rangeMs) return mergedLog().length;
  const cutoff = Date.now() - rangeMs;
  return mergedLog().filter((e) => e.ts >= cutoff).length;
}
