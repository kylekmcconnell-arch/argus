import { afterEach, describe, expect, it, vi } from "vitest";
import { getCost, withCostLedger } from "../cost";
import { tokenByContract } from "./coingecko";
import { lookupOrganization } from "./crunchbase";
import { detectTokenLifecycle, lookupToken } from "./dexscreener";
import { githubAffiliations } from "./github";
import { heliusWalletActivity } from "./onchain";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("keyed provider adapter outcome accounting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("records one failed CoinGecko attempt after a transport error", async () => {
    vi.stubEnv("COINGECKO_API_KEY", "coingecko-key");
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const captured = await withCostLedger(async () => ({
      result: await tokenByContract("ethereum", "0xtoken"),
      cost: getCost(),
    }));
    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "coingecko", op: "contract-lookup", calls: 1,
      succeeded: 0, partial: 0, failed: 1, status: "failed",
      meta: expect.stringContaining("transport_error"),
    }));
  });

  it("records a valid empty Crunchbase search as succeeded", async () => {
    vi.stubEnv("CRUNCHBASE_API_KEY", "crunchbase-key");
    const fetchMock = vi.fn().mockResolvedValue(json({ entities: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const captured = await withCostLedger(async () => ({
      result: await lookupOrganization("Unknown Co"),
      cost: getCost(),
    }));
    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "crunchbase", calls: 1, succeeded: 1, failed: 0, status: "succeeded",
      meta: expect.stringContaining("no_match"),
    }));
  });

  it("records each DexScreener fetch once across empty and unreadable results", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ pairs: [] }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const captured = await withCostLedger(async () => ({
      token: await lookupToken("mint"),
      lifecycle: await detectTokenLifecycle("ARGUS"),
      cost: getCost(),
    }));
    expect(captured.token).toEqual({ address: "mint" });
    expect(captured.lifecycle).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "dexscreener", op: "token-pairs", calls: 1, succeeded: 1, status: "succeeded" }),
      expect.objectContaining({ provider: "dexscreener", op: "token-search", calls: 1, failed: 1, status: "failed" }),
    ]));
  });

  it("aggregates two GitHub fetches from their observed result shapes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ unexpected: true }))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", fetchMock);
    const captured = await withCostLedger(async () => ({
      result: await githubAffiliations("alice", "github-key"),
      cost: getCost(),
    }));
    expect(captured.result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "github", op: "users/alice", calls: 2,
      succeeded: 1, partial: 1, failed: 0, status: "partial",
      meta: expect.stringContaining("result_shape_error"),
    }));
  });

  it("records a Helius result-shape failure as one partial attempt", async () => {
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    const fetchMock = vi.fn().mockResolvedValue(json({ transactions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const captured = await withCostLedger(async () => ({
      result: await heliusWalletActivity("wallet"),
      cost: getCost(),
    }));
    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "helius", op: "address-transactions", calls: 1,
      succeeded: 0, partial: 1, failed: 0, status: "partial",
      meta: expect.stringContaining("result_shape_error"),
    }));
  });
});
