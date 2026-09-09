import { describe, expect, it } from "vitest";
import {
  gapInvestigationReserves,
  ANALYST_FINALIZATION_RESERVE_MS,
  ANALYST_SCORING_TIMEOUT_MS,
  COLLECTION_ANALYST_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
  SOCIAL_ACTIVITY_BUDGET_MS,
  TRUST_GRAPH_SCREEN_RESERVE_MS,
} from "./investigationRuntime";

// These constants encode the run's time budget. The never-waive trust-graph
// screen runs in a window carved from the analyst reserve, so the arithmetic
// below is load-bearing: break it and either the analyst loses its scoring
// window (INCOMPLETE) or the graph screen loses its window (PROVISIONAL on a
// clip). Lock the invariants so a future retune cannot silently regress them.
describe("investigation runtime budget invariants", () => {
  it("reserves a robust, bounded window for the never-waive trust-graph screen", () => {
    // >= 45s: a live run clipped the screen at 30s because a slow optional pass
    // (Grok adverse-sweep) overran the window; the margin must stay wide enough
    // to absorb that overrun so the never-waive screen isn't skipped. Guards
    // against a future retune silently shrinking it back to a flappy value.
    expect(TRUST_GRAPH_SCREEN_RESERVE_MS).toBeGreaterThanOrEqual(45_000);
    expect(TRUST_GRAPH_SCREEN_RESERVE_MS).toBeLessThan(COLLECTION_ANALYST_RESERVE_MS);
  });

  it("leaves the analyst its full scoring window after the graph screen", () => {
    // General collection stops at analystDeadline - COLLECTION_ANALYST_RESERVE_MS;
    // the graph screen may then run for TRUST_GRAPH_SCREEN_RESERVE_MS. Whatever
    // remains before analystDeadline must still cover a full analyst scoring pass.
    expect(COLLECTION_ANALYST_RESERVE_MS - TRUST_GRAPH_SCREEN_RESERVE_MS)
      .toBeGreaterThanOrEqual(ANALYST_SCORING_TIMEOUT_MS);
  });

  it("keeps collection reserve + finalization reserve inside the function ceiling", () => {
    const ceilingMs = DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000;
    expect(COLLECTION_ANALYST_RESERVE_MS + ANALYST_FINALIZATION_RESERVE_MS).toBeLessThan(ceilingMs);
  });

  it("caps social-activity collection so a 5,000-post search cannot starve required checks", () => {
    expect(SOCIAL_ACTIVITY_BUDGET_MS).toBeGreaterThanOrEqual(15_000);
    expect(SOCIAL_ACTIVITY_BUDGET_MS).toBeLessThanOrEqual(45_000);
    expect(SOCIAL_ACTIVITY_BUDGET_MS).toBeLessThan(TRUST_GRAPH_SCREEN_RESERVE_MS);
  });
});

describe("authorized gap investigation budgets", () => {
  it("leaves positive collection, graph and scoring windows for every allowed budget", () => {
    for (let budget = 180; budget <= 540; budget++) {
      const { collectionReserveMs, graphScreenReserveMs } = gapInvestigationReserves(budget);
      const collectionDeadline = budget * 1000 - 30_000 - collectionReserveMs;
      expect(collectionDeadline).toBeGreaterThanOrEqual(60_000);
      expect(graphScreenReserveMs).toBeGreaterThan(0);
      expect(collectionReserveMs - graphScreenReserveMs).toBeGreaterThanOrEqual(60_000);
      expect(collectionReserveMs).toBeLessThanOrEqual(COLLECTION_ANALYST_RESERVE_MS);
    }
  });
  it("gives a 240-second scan 84 seconds to launch collection", () => {
    const reserves = gapInvestigationReserves(240);
    expect(240_000 - 30_000 - reserves.collectionReserveMs).toBe(84_000);
  });
  it.each([0, 179, 541, NaN, Infinity, 180.5])("rejects invalid budget %s", (budget) => {
    expect(() => gapInvestigationReserves(budget)).toThrow(RangeError);
  });
});
