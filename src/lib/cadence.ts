// Post-cadence analysis. A team that whittles down its posting, or goes silent
// after a launch, is a disappearing-act / soft-rug tell straight out of the
// playbook. Pure and time-injected (no Date.now) so it is deterministic and
// unit-testable; the timestamped-post fetch that feeds it lives in the X adapter.

export interface PostMeta {
  text: string;
  createdAt: number; // epoch ms
}

export interface CadenceReport {
  postsAnalyzed: number;
  daysSinceLast: number;
  medianGapDays: number; // median gap across the analyzed window
  recentGapDays: number; // gap between the two most recent posts
  decaying: boolean; // recent cadence materially slower than the historical baseline
  silent: boolean; // long quiet stretch at the tail (gone quiet)
  summary: string;
}

const DAY = 86_400_000;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// `now` is injected so the result is deterministic. Returns null when there are
// too few posts to say anything (a handful of posts is not a cadence).
export function analyzeCadence(posts: PostMeta[], now: number): CadenceReport | null {
  const times = posts
    .map((p) => p.createdAt)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a); // newest first
  if (times.length < 4) return null;

  const gaps: number[] = [];
  for (let i = 0; i < times.length - 1; i++) gaps.push((times[i] - times[i + 1]) / DAY);
  const medianGapDays = median(gaps);
  const recentGapDays = gaps[0];
  const daysSinceLast = (now - times[0]) / DAY;

  // Baseline = median gap of the OLDER half; recent = median gap of the NEWER
  // half. Decaying when the recent typical gap is >=3x the historical one and
  // the absolute slowdown is at least 3 days (so noise on a fast cadence doesn't
  // trip it).
  const half = Math.floor(gaps.length / 2);
  const recentMedian = median(gaps.slice(0, half || 1));
  const olderMedian = median(gaps.slice(half)) || medianGapDays;
  const decaying = olderMedian > 0 && recentMedian >= olderMedian * 3 && recentMedian - olderMedian >= 3;

  // Silent when the tail gap dwarfs the normal cadence: at least 21 days AND at
  // least 4x the typical gap, so an already-slow poster is judged on its own norm.
  const silent = daysSinceLast >= Math.max(21, medianGapDays * 4);

  const summary = silent
    ? `Silent ${Math.round(daysSinceLast)}d (typical gap ~${medianGapDays.toFixed(1)}d): went quiet.`
    : decaying
      ? `Cadence thinning: recent gaps ~${recentMedian.toFixed(1)}d vs ~${olderMedian.toFixed(1)}d earlier.`
      : `Posting steady (~${medianGapDays.toFixed(1)}d gap, last post ${Math.round(daysSinceLast)}d ago).`;

  return { postsAnalyzed: times.length, daysSinceLast, medianGapDays, recentGapDays, decaying, silent, summary };
}
