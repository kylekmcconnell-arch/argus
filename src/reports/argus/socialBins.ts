import type { SocialActivityBucket, SocialActivitySnapshot, SocialActivityWindow } from "../../data/socialActivity";

function inWindow(bucket: SocialActivityBucket, window: SocialActivityWindow): boolean {
  const start = Date.parse(bucket.start);
  return start >= Date.parse(window.start) - 1000 && start < Date.parse(window.end);
}

/** Hourly buckets inside the saved 24-hour window. Only recorded bins; nothing interpolated. */
export function hourlyBins(snapshot: SocialActivitySnapshot): SocialActivityBucket[] {
  return (snapshot.hourlyPostCounts ?? []).filter((bucket) => inWindow(bucket, snapshot.windows.last24Hours));
}

/** Daily totals summed from recorded hourly buckets, only when every hour of the 7-day window is present. */
export function dailyBins(snapshot: SocialActivitySnapshot): Array<{ day: string; postCount: number }> | null {
  const window = snapshot.windows.last7Days;
  const buckets = (snapshot.hourlyPostCounts ?? []).filter((bucket) => inWindow(bucket, window));
  const hours = Math.round((Date.parse(window.end) - Date.parse(window.start)) / 3_600_000);
  if (!hours || buckets.length < hours - 1) return null;
  const byDay = new Map<string, number>();
  for (const bucket of buckets) {
    const day = bucket.start.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + bucket.postCount);
  }
  return [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, postCount]) => ({ day, postCount }));
}
