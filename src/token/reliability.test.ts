import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";
const address = "0x1111111111111111111111111111111111111111";
const input = { kind: "token", via: "evm", ref: address } as const;
const pair = { chainId: "ethereum", dexId: "test", pairAddress: address, baseToken: { address, name: "Test", symbol: "TEST" }, liquidity: { usd: 100000 } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("token evidence and deadline regressions", () => {
  it("excludes empty provider capabilities from score weight", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => Response.json(String(url).includes("/latest/dex/tokens/") ? { pairs: [pair] } : String(url).includes("gopluslabs") ? { code: 1, result: { [address]: {} } } : {})));
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.contractPropertiesAssessed).toBe(false);
    expect(d?.safety.taxesAssessed).toBe(false);
    expect(d?.axes.filter((a) => ["T2", "T3", "T4"].includes(a.key)).every((a) => a.weight === 0 && a.score === 0 && a.assessed === false)).toBe(true);
    expect(d?.assessment).toMatchObject({ provisional: true, assessedWeight: 24 });
    expect(d?.score).toBe(75);
  });
  it("aborts without starting downstream providers or publishing a cache entry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = auditToken(input, undefined, { force: true, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not cache a DEX outage as a missing token", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const rejected = expect(auditToken(input, undefined, { force: true })).rejects.toThrow("token_market_unavailable");
    await vi.runAllTimersAsync(); await rejected;
    fetcher.mockImplementation(async () => Response.json({ pairs: [] }));
    const before = fetcher.mock.calls.length;
    expect(await auditToken(input)).toBeNull();
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);
  });
});

it("assesses a known-chain Solana mint without inventing DEX measurements", async () => {
  const mint = "So11111111111111111111111111111111111111112";
  vi.stubGlobal("fetch", vi.fn(async (url) => Response.json(String(url).includes("/latest/dex/tokens/") ? { pairs: [] } : String(url).includes("gopluslabs") ? { result: { [mint]: { metadata: { name: "Test mint", symbol: "TEST" }, mintable: { status: "0" }, freezable: { status: "0" }, metadata_mutable: { status: "0" }, transfer_hook: [], transfer_fee: {} } } } : {})));
  const d = await auditToken({ kind: "token", via: "solana", ref: mint }, undefined, { force: true, skipSim: true });
  expect(d).toMatchObject({ address: mint, symbol: "TEST", marketEvidence: { liquidityUsd: false, mcap: false }, assessment: { provisional: true } });
  expect(d?.axes.find((a) => a.key === "T1")).toMatchObject({ assessed: false, weight: 0 });
  expect(d?.findings.some((f) => f.claim.includes("Thin liquidity"))).toBe(false);
});
