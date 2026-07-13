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

    expect(firstCost.schemaVersion).toBe(1);
    expect(secondCost.schemaVersion).toBe(1);
    expect(firstCost.calls.map((line) => line.provider).sort()).toEqual(["claude", "provider-a"]);
    expect(firstCost.calls.some((line) => line.provider === "provider-b")).toBe(false);
    expect(firstCost.claudeCalls).toBe(1);
    expect(firstCost.grokCalls).toBe(0);

    expect(secondCost.calls.map((line) => line.provider).sort()).toEqual(["grok", "provider-b"]);
    expect(secondCost.calls.some((line) => line.provider === "provider-a")).toBe(false);
    expect(secondCost.grokCalls).toBe(1);
    expect(secondCost.claudeCalls).toBe(0);
  });

  it("keeps attempt outcomes and derives an aggregate status per operation", () => {
    const cost = withCostLedger(() => {
      recordCall("provider-a", "lookup", 0, "http_503", "failed");
      recordCall("provider-a", "lookup", 0.25, "retry_ok", "succeeded");
      recordCall("provider-b", "parse", 0.1, "missing_field", "partial");
      return getCost();
    });

    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "provider-a",
      op: "lookup",
      calls: 2,
      succeeded: 1,
      partial: 0,
      failed: 1,
      status: "partial",
      usd: 0.25,
      meta: "http_503 · retry_ok",
    }));
    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "provider-b",
      calls: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      status: "partial",
    }));
  });

  it("counts failed paid attempts even when usage metrics are unavailable", () => {
    const cost = withCostLedger(() => {
      addGrokUsage(undefined, 0, "search", "failed", "transport_error");
      addClaudeUsage(undefined, "analysis", "failed", "http_500");
      return getCost();
    });

    expect(cost.grokCalls).toBe(1);
    expect(cost.claudeCalls).toBe(1);
    expect(cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "grok", calls: 1, failed: 1, status: "failed", usd: 0 }),
      expect.objectContaining({ provider: "claude", calls: 1, failed: 1, status: "failed", usd: 0 }),
    ]));
  });

  it("attributes Claude hosted web-search usage to the exact operation", () => {
    const cost = withCostLedger(() => {
      addClaudeUsage({
        input_tokens: 1_000,
        output_tokens: 100,
        server_tool_use: { web_search_requests: 2 },
      }, "basic-facts-search");
      return getCost();
    });

    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "basic-facts-search",
      usd: 0.0245,
      meta: "1100 tok · 2 web searches",
    }));
  });
});
