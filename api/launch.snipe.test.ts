import { afterEach, describe, expect, it, vi } from "vitest";

import { evmSnipe } from "./launch";

// 2026-09-14 deep-dive review, token lane finding 11. The launch-block snipe
// read took "supply" from the FIRST mint transfer only, so a token that mints
// 5% to a treasury and then 95% to the pool measured every launch buy against
// the 5% tranche (a 1% buy read as 20% "of supply", the judge's flag line). It
// also picked "the pool" as the biggest fan-out sender in the first 300
// transfers, which a pre-pool airdrop from the deployer wins.

const ZERO = "0x0000000000000000000000000000000000000000";
const TREASURY = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const DEPLOYER = "0x3333333333333333333333333333333333333333";
const DEC = "18";
const wei = (units: number) => (BigInt(units) * 10n ** 18n).toString();

const tx = (from: string, to: string, units: number, blockNumber: number) => ({ from, to, value: wei(units), tokenDecimal: DEC, blockNumber: String(blockNumber) });

function stub(rows: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "1", result: rows }), { status: 200 })));
}

afterEach(() => vi.unstubAllGlobals());

describe("evmSnipe supply and pool identification", () => {
  it("measures launch-block buys against the SUM of all mint transfers", async () => {
    stub([
      tx(ZERO, TREASURY, 50_000, 100),   // 5% tranche minted first
      tx(ZERO, POOL, 950_000, 100),      // 95% to the pool
      tx(POOL, "0xaaaa000000000000000000000000000000000001", 5_000, 101),
      tx(POOL, "0xaaaa000000000000000000000000000000000002", 5_000, 101),
      tx(POOL, "0xaaaa000000000000000000000000000000000003", 5_000, 102),
    ]);
    const snipe = await evmSnipe(1, "0xtoken", "key");
    // 10,000 of 1,000,000 = 1% of supply, not 20% of the first tranche.
    expect(snipe?.pctOfSupply).toBeCloseTo(1, 5);
    expect(snipe?.sameBlockBuyers).toBe(2);
  });

  it("uses the audited pair address as the pool instead of the biggest fan-out sender", async () => {
    const airdrop = Array.from({ length: 6 }, (_, i) => tx(DEPLOYER, `0xbbbb00000000000000000000000000000000000${i}`, 1_000, 90));
    stub([
      tx(ZERO, DEPLOYER, 1_000_000, 80),
      ...airdrop,                                   // pre-pool airdrop: the deployer fans out to 6 wallets
      tx(DEPLOYER, POOL, 900_000, 95),
      tx(POOL, "0xaaaa000000000000000000000000000000000001", 2_000, 101),
      tx(POOL, "0xaaaa000000000000000000000000000000000002", 2_000, 101),
    ]);
    const withPair = await evmSnipe(1, "0xtoken", "key", POOL);
    expect(withPair?.window).toContain("first block 101");
    expect(withPair?.sameBlockBuyers).toBe(2);

    // The heuristic path (no pair known) is what the airdrop used to fool.
    const heuristic = await evmSnipe(1, "0xtoken", "key");
    expect(heuristic?.window).toContain("first block 90");
    expect(heuristic?.sameBlockBuyers).toBe(6);
  });
});
