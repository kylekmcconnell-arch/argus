import { describe, expect, it } from "vitest";
import {
  addClaudeUsage,
  addGrokUsage,
  getCost,
  recordCall,
  withCostLedger,
} from "./cost";

describe("per-audit cost isolation", () => {
  it("keeps interleaved async investigations in separate ledgers", async () => {
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstRecorded!: () => void;
    const firstReady = new Promise<void>((resolve) => { firstRecorded = resolve; });

    const first = withCostLedger(async () => {
      recordCall("provider-a", "lookup", 0.25);
      firstRecorded();
      await firstPaused;
      addClaudeUsage({ input_tokens: 1_000, output_tokens: 100 }, "analysis-a");
      return getCost();
    });

    await firstReady;
    const second = withCostLedger(async () => {
      recordCall("provider-b", "lookup", 0.5);
      addGrokUsage({ input_tokens: 2_000, output_tokens: 200, num_sources_used: 2 }, 0, "search-b");
      await Promise.resolve();
      return getCost();
    });

    releaseFirst();
    const [firstCost, secondCost] = await Promise.all([first, second]);

    expect(firstCost.calls.map((line) => line.provider).sort()).toEqual(["claude", "provider-a"]);
    expect(firstCost.calls.some((line) => line.provider === "provider-b")).toBe(false);
    expect(firstCost.claudeCalls).toBe(1);
    expect(firstCost.grokCalls).toBe(0);

    expect(secondCost.calls.map((line) => line.provider).sort()).toEqual(["grok", "provider-b"]);
    expect(secondCost.calls.some((line) => line.provider === "provider-a")).toBe(false);
    expect(secondCost.grokCalls).toBe(1);
    expect(secondCost.claudeCalls).toBe(0);
  });
});
