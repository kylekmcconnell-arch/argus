// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The pool-creation instant used to be read once, converted to a day count, and
// dropped. Everything downstream that wants to age the deployer wallet AT the
// launch (rather than against whatever day the report is reopened) needs the raw
// instant, and a wallet minted minutes before its token is 0 days old.
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const POOL = "FNZk3jfkVwd1uNn8EmNsyVxou2WpQx8BEEdGnQwv6Qkx";
const PAIR_CREATED_AT = 1785452189000;

function dexPair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "solana",
    dexId: "pumpswap",
    pairAddress: POOL,
    baseToken: { address: MINT, name: "linkrbot", symbol: "LINKR" },
    quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
    priceUsd: "0.000015",
    liquidity: { usd: 8329.01 },
    fdv: 14976,
    marketCap: 14976,
    pairCreatedAt: PAIR_CREATED_AT,
    volume: { h24: 166000 },
    priceChange: { h24: -5 },
    txns: { h24: { buys: 200, sells: 210 } },
    ...overrides,
  };
}

function stubNetwork(pair: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });
    if (url.includes("dexscreener")) return json({ pairs: [pair] });
    return json({});
  }));
}

const run = () => auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

describe("launch instant on the dossier", () => {
  it("freezes the raw pool-creation instant, not just the day count derived from it", async () => {
    stubNetwork(dexPair());
    const dossier = await run();

    expect(dossier!.pairCreatedAt).toBe(PAIR_CREATED_AT);
    // The day count stays too: it is what the maturity axis scores. The point is
    // that the instant survives alongside it, because a day count cannot be
    // re-measured against anything.
    expect(dossier!.ageDays).toBeTypeOf("number");
  });

  it("reports an unreported launch as not measured rather than as the epoch", async () => {
    stubNetwork(dexPair({ pairCreatedAt: undefined }));
    const dossier = await run();

    // Null, never 0. A token DexScreener did not date did not launch in 1970,
    // and a zero here would age every deployer wallet against that instant.
    expect(dossier!.pairCreatedAt).toBeNull();
    expect(dossier!.ageDays).toBeUndefined();
  });
});
