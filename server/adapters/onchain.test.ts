import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import { onchainAdapter } from "./onchain";
import type { CollectContext } from "./types";

function context(wallets: CollectContext["evidence"]["wallets"] = []) {
  const evidence = emptyEvidence("@alice");
  evidence.wallets = wallets;
  const steps: Parameters<CollectContext["emit"]>[0][] = [];
  return {
    evidence,
    steps,
    ctx: {
      handle: "@alice",
      evidence,
      emit: (step) => steps.push(step),
    } satisfies CollectContext,
  };
}

describe("onchain provider execution truth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not advertise an unused Bitquery credential as an available collector", async () => {
    vi.stubEnv("BITQUERY_API_KEY", "configured-but-unused");
    vi.stubEnv("HELIUS_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context([{
      address: "0xabc",
      chain: "ethereum",
      link_tier: "SelfDoxxed",
      sold_into_own_promo: true,
    }]);

    expect(onchainAdapter.available()).toBe(false);
    await expect(onchainAdapter.run(ctx)).resolves.toMatchObject({
      state: "skipped",
      attempts: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips Helius when there is no attributed Solana wallet", async () => {
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, evidence, steps } = context([{
      address: "0xabc",
      chain: "ethereum",
      link_tier: "SelfDoxxed",
      sold_into_own_promo: true,
    }]);

    expect(onchainAdapter.applicable?.(evidence)).toBe(false);
    await expect(onchainAdapter.run(ctx)).resolves.toMatchObject({
      state: "skipped",
      attempts: 0,
      detail: expect.stringContaining("no attributed Solana wallet"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(steps).toEqual([]);
  });

  it("marks a valid Helius response executed only after the observed attempt", async () => {
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([{ signature: "5hELiusTransactionSignature", timestamp: 1_700_000_000 }]),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, evidence } = context([{
      address: "solana-wallet",
      chain: "solana",
      link_tier: "InvestigatorAttributed",
    }]);

    const captured = await withCostLedger(async () => ({
      result: await onchainAdapter.run(ctx),
      cost: getCost(),
    }));

    expect(onchainAdapter.applicable?.(evidence)).toBe(true);
    expect(captured.result).toMatchObject({ state: "executed", attempts: 1 });
    expect(evidence.wallets[0].activity_summary).toBe("1 recent txs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "helius",
      calls: 1,
      succeeded: 1,
      status: "succeeded",
    }));
  });

  it("reports a failed Helius attempt as failed rather than executed", async () => {
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context([{
      address: "solana-wallet",
      chain: "solana",
      link_tier: "SelfDoxxed",
    }]);

    const captured = await withCostLedger(async () => ({
      result: await onchainAdapter.run(ctx),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ state: "failed", attempts: 1 });
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "helius",
      calls: 1,
      failed: 1,
      status: "failed",
    }));
  });

  it("fails closed on malformed Helius transaction rows", async () => {
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([
        { signature: "valid-signature", timestamp: 1_700_000_000 },
        { timestamp: 1_700_000_001 },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, evidence } = context([{
      address: "solana-wallet",
      chain: "solana",
      link_tier: "SelfDoxxed",
    }]);

    const captured = await withCostLedger(async () => ({
      result: await onchainAdapter.run(ctx),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ state: "partial", attempts: 1 });
    expect(evidence.wallets[0].activity_summary).toBe("1 recent txs");
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "helius",
      calls: 1,
      partial: 1,
      status: "partial",
    }));
  });
});
