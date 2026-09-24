// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";

// GoPlus sometimes answers lp_holders with the token's own contract address
// instead of the pool's holders. That is the provider handing the mint back,
// not a measurement of who controls the liquidity. Scoring it as "nobody has
// locked anything" publishes a removable-liquidity warning off data that was
// never collected, and it also suppressed the RugCheck fallback that can
// measure the lock properly.

const ADDRESS = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const WALLET = "0x4444444444444444444444444444444444444444";
const LOCKER = "0x5555555555555555555555555555555555555555";
const input = { kind: "token", via: "evm", ref: ADDRESS } as const;

const pair = () => ({
  chainId: "ethereum", dexId: "uniswap", pairAddress: POOL,
  baseToken: { address: ADDRESS, name: "Test", symbol: "TEST" },
  quoteToken: { address: "0xweth", symbol: "WETH" },
  liquidity: { usd: 100_000 }, fdv: 1_000_000, marketCap: 1_000_000,
  txns: { h24: { buys: 3, sells: 4 } }, volume: { h24: 5_000 },
});

const CLEAN_GOPLUS = {
  is_open_source: "1", is_mintable: "0", transfer_pausable: "0", selfdestruct: "0", is_in_dex: "1",
  buy_tax: "0", sell_tax: "0", cannot_sell_all: "0", is_honeypot: "0", holder_count: "120",
  owner_address: "0x0000000000000000000000000000000000000000", hidden_owner: "0", can_take_back_ownership: "0",
  holders: [{ address: WALLET, percent: "0.04", is_contract: 0 }],
};

function stubProviders(goplus: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/latest/dex/tokens/")) return Response.json({ pairs: [pair()] });
    if (u.includes("gopluslabs")) return Response.json({ code: 1, result: { [ADDRESS]: goplus } });
    if (u.includes("/api/bytecode")) return Response.json({ available: false });
    return Response.json({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a self-referential GoPlus LP list is unmeasured, not unlocked", () => {
  it("leaves the LP unassessed when the rows are the token's own contract", async () => {
    stubProviders({ ...CLEAN_GOPLUS, lp_holders: [
      { address: ADDRESS, percent: "0.97", is_contract: 1 },
      { address: WALLET, percent: "0.03", is_contract: 0 },
    ] });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.lpAssessed).toBe(false);
    const t1 = d!.axes.find((a) => a.key === "T1");
    expect(t1?.rationale ?? "").not.toMatch(/LP not locked/i);
  });

  it("still reports a genuinely unlocked LP held by a real wallet", async () => {
    stubProviders({ ...CLEAN_GOPLUS, lp_holders: [
      { address: WALLET, percent: "0.90", is_contract: 0 },
    ] });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.lpAssessed).toBe(true);
    expect(d?.safety.lpLocked).toBe(false);
  });

  it("still reports a locked LP", async () => {
    stubProviders({ ...CLEAN_GOPLUS, lp_holders: [
      { address: LOCKER, percent: "0.80", is_locked: 1, is_contract: 1 },
    ] });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.lpAssessed).toBe(true);
    expect(d?.safety.lpLocked).toBe(true);
  });

  it("does not call an unclassified pair-contract LP row unlocked", async () => {
    stubProviders({ ...CLEAN_GOPLUS, lp_holders: [
      { address: POOL, percent: "0.997", is_contract: 1, is_locked: 0 },
    ] });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.lpAssessed).toBe(false);
    const t1 = d!.axes.find((a) => a.key === "T1");
    expect(t1?.rationale ?? "").not.toMatch(/LP not locked/i);
    expect(t1?.rationale ?? "").toMatch(/liquidity protection unverified/i);
  });

  it("does not treat an unlocked contract LP row as a measured unlocked pool", async () => {
    stubProviders({ ...CLEAN_GOPLUS, lp_holders: [
      { address: "0x6666666666666666666666666666666666666666", percent: "0.95", is_contract: 1, is_locked: 0 },
    ] });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.lpAssessed).toBe(false);
    expect(d!.axes.find((a) => a.key === "T1")?.rationale ?? "").not.toMatch(/LP not locked/i);
  });

  it("reports a dead-address LP as burned, not unlocked", async () => {
    stubProviders({ ...CLEAN_GOPLUS, lp_holders: [
      { address: "0x000000000000000000000000000000000000dead", percent: "0.99", is_contract: 0, tag: "dead" },
    ] });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.lpAssessed).toBe(true);
    expect(d?.safety.lpBurnedPct).toBeGreaterThanOrEqual(99);
    const t1 = d!.axes.find((a) => a.key === "T1");
    expect(t1?.rationale ?? "").toMatch(/LP burned/i);
    expect(t1?.rationale ?? "").not.toMatch(/LP not locked/i);
  });
});

describe("a GoPlus pause flag with no reachable owner is not a live halt", () => {
  it("does not claim PEPE-shaped transfers can still be paused", async () => {
    stubProviders({
      ...CLEAN_GOPLUS,
      transfer_pausable: "1",
      owner_address: "0x0000000000000000000000000000000000000000",
    });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.ownerRenounced).toBe(true);
    expect(d?.safety.pausable).toBe(false);
    const t2 = d!.axes.find((a) => a.key === "T2");
    expect(t2?.rationale ?? "").not.toMatch(/pausable/i);
    expect(JSON.stringify(d!.findings)).not.toMatch(/paused|pausable/i);
  });

  it("still treats pause as live while an owner can call it", async () => {
    stubProviders({
      ...CLEAN_GOPLUS,
      transfer_pausable: "1",
      owner_address: WALLET,
    });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.ownerRenounced).toBe(false);
    expect(d?.safety.pausable).toBe(true);
    const t2 = d!.axes.find((a) => a.key === "T2");
    expect(t2?.rationale ?? "").toMatch(/pausable/i);
  });
});
