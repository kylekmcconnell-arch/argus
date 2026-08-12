import { describe, expect, it } from "vitest";
import {
  addClaudeUsage,
  addGrokUsage,
  getCost,
  providerFailureLines,
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

  it("does not turn a recovered retry into a terminal provider failure", () => {
    const cost = withCostLedger(() => {
      recordCall("twitterapi", "user-tweets", 0, "http_503", "failed");
      recordCall("twitterapi", "user-tweets", 0.0002, "retry_ok", "succeeded");
      recordCall("serper", "search", 0, "http_401", "failed");
      return getCost();
    });

    expect(providerFailureLines(cost)).toEqual([expect.objectContaining({
      provider: "serper",
      op: "search",
      failed: 1,
    })]);
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

describe("live-search source accounting", () => {
  it("never books zero cost when the provider reports tool calls but no sources", async () => {
    const captured = await withCostLedger(async () => {
      // Exactly what xAI returns: several tool calls, num_sources_used 0.
      addGrokUsage({ input_tokens: 20_000, output_tokens: 900, num_sources_used: 0 }, 6);
      return getCost();
    });
    expect(captured.sources).toBeGreaterThan(0);
    expect(captured.grokUsd).toBeGreaterThan(0.05);
  });

  it("prefers the provider's own source count when it actually reports one", async () => {
    const captured = await withCostLedger(async () => {
      addGrokUsage({ input_tokens: 1_000, output_tokens: 100, num_sources_used: 40 }, 2);
      return getCost();
    });
    expect(captured.sources).toBe(40);
  });
});

// Prompt-cache tokens arrive in their own usage fields and bill at their own
// rates (writes 1.25x input, reads 0.1x). The ledger must price them exactly,
// or the in-app numbers drift from the invoice in either direction.
describe("prompt-cache token pricing", () => {
  it("prices cache writes at 1.25x and cache reads at 0.1x of the model input rate", async () => {
    const { withCostLedger, addClaudeUsage, getCost } = await import("./cost");
    const cost = await withCostLedger(async () => {
      addClaudeUsage({
        input_tokens: 1_000,
        output_tokens: 100,
        cache_creation_input_tokens: 10_000,
        cache_read_input_tokens: 100_000,
      }, "analysis-cached");
      return getCost();
    });
    const line = cost.calls.find((entry) => entry.op === "analysis-cached");
    expect(line).toBeDefined();
    // Sonnet rates: in $3/M, out $15/M.
    const expected = 1_000 * 3 / 1e6
      + 10_000 * 3 * 1.25 / 1e6
      + 100_000 * 3 * 0.1 / 1e6
      + 100 * 15 / 1e6;
    expect(line!.usd).toBeCloseTo(expected, 8);
    expect(line!.meta).toContain("cache r100000/w10000");
    // Uncached equivalent would price the same tokens 10x higher on the reads.
    expect(line!.usd).toBeLessThan((1_000 + 10_000 + 100_000) * 3 / 1e6 + 100 * 15 / 1e6);
  });
});
