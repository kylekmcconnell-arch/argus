// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const WALLET = "0x4444444444444444444444444444444444444444";
const input = { kind: "token", via: "evm", ref: ADDRESS } as const;

const pair = (txns: { buys: number; sells: number }, volume = 27_700_000) => ({
  chainId: "ethereum", dexId: "uniswap", pairAddress: POOL,
  baseToken: { address: ADDRESS, name: "UNI", symbol: "UNI" },
  quoteToken: { address: "0xweth", symbol: "WETH" },
  liquidity: { usd: 14_000_000 }, fdv: 5_670_000_000, marketCap: 3_960_000_000,
  txns: { h24: txns }, volume: { h24: volume }, priceChange: { h24: 1.2 },
});

const CLEAN_GOPLUS = {
  is_open_source: "1", is_mintable: "0", transfer_pausable: "0", selfdestruct: "0", is_in_dex: "1",
  buy_tax: "0", sell_tax: "0", cannot_sell_all: "0", is_honeypot: "0", holder_count: "120",
  owner_address: WALLET, hidden_owner: "0", can_take_back_ownership: "0",
  holders: [{ address: WALLET, percent: "0.04", is_contract: 0 }],
};

function stubProviders(txns: { buys: number; sells: number }, volume?: number) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/latest/dex/tokens/")) return Response.json({ pairs: [pair(txns, volume)] });
    if (u.includes("gopluslabs")) return Response.json({ code: 1, result: { [ADDRESS]: CLEAN_GOPLUS } });
    if (u.includes("/api/bytecode")) return Response.json({ available: false });
    return Response.json({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("incomplete DexScreener swap counts stay out of T5", () => {
  it("omits 1 buy / 2 sells against tens of millions of volume", async () => {
    stubProviders({ buys: 1, sells: 2 });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    const t5 = d!.axes.find((a) => a.key === "T5");
    expect(t5?.rationale ?? "").toMatch(/swap counts for this pool were incomplete/i);
    expect(t5?.rationale ?? "").not.toMatch(/1 buys|2 sells/);
  });

  it("still publishes a complete tape", async () => {
    stubProviders({ buys: 180, sells: 160 }, 8_000_000);
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    const t5 = d!.axes.find((a) => a.key === "T5");
    expect(t5?.rationale ?? "").toMatch(/180 buys \/ 160 sells/);
    expect(t5?.rationale ?? "").not.toMatch(/incomplete/i);
  });
});
