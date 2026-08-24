export interface SpendEvent { createdAt: string; usd: number; claudeUsd: number }
export interface SpendData { truncated: boolean; runs: string[]; events: SpendEvent[] }
export interface SpendDay { day: string; label: string; runs: number; usd: number; claudeUsd: number }

// Bucket recorded usage by the analyst's local calendar day, newest first.
// A capped feed drops its oldest returned day because that day may be partial.
export function buildSpendDays(data: SpendData): SpendDay[] {
  const days = new Map<string, SpendDay>();
  const bucketFor = (at: Date): SpendDay => {
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    const existing = days.get(day);
    if (existing) return existing;
    const fresh: SpendDay = {
      day,
      label: at.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      runs: 0,
      usd: 0,
      claudeUsd: 0,
    };
    days.set(day, fresh);
    return fresh;
  };
  for (const run of data.runs) {
    const at = new Date(run);
    if (Number.isNaN(at.getTime())) continue;
    bucketFor(at).runs += 1;
  }
  for (const event of data.events) {
    const at = new Date(event.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = bucketFor(at);
    bucket.usd += event.usd;
    bucket.claudeUsd += event.claudeUsd;
  }
  const ordered = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  if (data.truncated && ordered.length > 1) ordered.pop();
  return ordered;
}
