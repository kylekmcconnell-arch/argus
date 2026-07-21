import { describe, expect, it } from "vitest";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  ANALYST_SCORING_TIMEOUT_MS,
  COLLECTION_ANALYST_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
  TRUST_GRAPH_SCREEN_RESERVE_MS,
} from "./investigationRuntime";

// These constants encode the run's time budget. The never-waive trust-graph
// screen runs in a window carved from the analyst reserve, so the arithmetic
// below is load-bearing: break it and either the analyst loses its scoring
// window (INCOMPLETE) or the graph screen loses its window (PROVISIONAL on a
// clip). Lock the invariants so a future retune cannot silently regress them.
describe("investigation runtime budget invariants", () => {
  it("reserves a real, bounded window for the never-waive trust-graph screen", () => {
    expect(TRUST_GRAPH_SCREEN_RESERVE_MS).toBeGreaterThan(0);
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
});
