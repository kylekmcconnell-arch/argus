import { mergedLog, type LogEntry } from "./auditlog";
import { normalizeSubjectRef } from "./subjectRef";

// Most recent scored audits, one per subject. Shared by the home decision
// strip and the score ticker without mixing non-component exports into TSX.
export function recentScored(max: number, filter?: (entry: LogEntry) => boolean): LogEntry[] {
  const seen = new Set<string>();
  const entries: LogEntry[] = [];
  for (const entry of mergedLog()) {
    if (entry.score == null && !entry.verdict) continue;
    if (filter && !filter(entry)) continue;
    const key = `${entry.kind}:${normalizeSubjectRef(entry.ref ?? entry.query)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= max) break;
  }
  return entries;
}
