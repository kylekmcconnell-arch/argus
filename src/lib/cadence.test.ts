import { describe, it, expect } from "vitest";
import { analyzeCadence, type PostMeta } from "./cadence";

const DAY = 86_400_000;
// Build posts at the given day-offsets BEFORE `now` (0 = now, 30 = 30 days ago).
const at = (now: number, daysAgo: number[]): PostMeta[] =>
  daysAgo.map((d, i) => ({ text: `post ${i}`, createdAt: now - d * DAY }));

describe("analyzeCadence", () => {
  const NOW = 1_760_000_000_000; // fixed epoch, injected

  it("returns null with too few posts", () => {
    expect(analyzeCadence(at(NOW, [1, 3, 8]), NOW)).toBeNull();
  });

  it("steady daily posting is neither decaying nor silent", () => {
    const r = analyzeCadence(at(NOW, [1, 2, 3, 4, 5, 6, 7, 8]), NOW)!;
    expect(r.decaying).toBe(false);
    expect(r.silent).toBe(false);
    expect(r.medianGapDays).toBeCloseTo(1, 5);
  });

  it("flags a long silence at the tail as silent (gone quiet)", () => {
    // was posting ~every 2 days, then nothing for 90 days
    const r = analyzeCadence(at(NOW, [90, 92, 94, 96, 98, 100]), NOW)!;
    expect(r.silent).toBe(true);
    expect(Math.round(r.daysSinceLast)).toBe(90);
  });

  it("flags thinning cadence as decaying", () => {
    // recent gaps ~20d, earlier gaps ~1d
    const r = analyzeCadence(at(NOW, [1, 21, 41, 61, 62, 63, 64, 65]), NOW)!;
    expect(r.decaying).toBe(true);
  });

  it("does not trip decaying on a uniformly slow but steady poster", () => {
    const r = analyzeCadence(at(NOW, [5, 10, 15, 20, 25, 30]), NOW)!;
    expect(r.decaying).toBe(false);
  });
});
