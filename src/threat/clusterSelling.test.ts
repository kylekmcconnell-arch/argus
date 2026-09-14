import { describe, expect, it } from "vitest";

import { clusterSelling } from "./scan";
import type { SellStructure } from "./types";

// The question this rule answers: days after launch, is the launch cluster
// (same-block snipers, deployer-seeded wallets, the deployer, curated farm or
// snipe-ring wallets) still the one selling on the recent tape? The rule
// measures wallets and USD; the verdict copy is written from those numbers.

const SNIPER = "0x709b3fa0f8c85cff157fb92b045ae02321b0483b"; // HEY block+24 ring, registry
const SEEDED = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ORGANIC = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DEPLOYER = "0xcccccccccccccccccccccccccccccccccccccccc";

function sellers(over: Partial<SellStructure> = {}): SellStructure {
  return {
    available: true, truncated: false, launchBlock: 58729102, sellerCount: 40, devSold: false,
    soldToPoolTotalPct: 60, badSellerCount: 0,
    topSellers: [
      { wallet: SEEDED, soldPct: 2, boughtPct: 2, realizedExitPct: 100, sameBlockSniper: false, isDeployer: false, deployerSeeded: true, flags: [] },
      { wallet: ORGANIC, soldPct: 1, boughtPct: 1, realizedExitPct: 100, sameBlockSniper: false, isDeployer: false, deployerSeeded: false, flags: [] },
    ],
    recentTape: {
      sells: 20, buys: 15, sellUsd: 5000, buyUsd: 3000, distinctSellers: 12, distinctBuyers: 10,
      topSellers: [
        { wallet: SNIPER, usd: 900, isDeployer: false, isCreator: false },
        { wallet: SEEDED, usd: 600, isDeployer: false, isCreator: false },
        { wallet: ORGANIC, usd: 2000, isDeployer: false, isCreator: false },
      ],
      note: "",
    },
    note: "",
    ...over,
  };
}

describe("clusterSelling", () => {
  it("counts a curated snipe-ring wallet and a deployer-seeded wallet, and skips organic sellers", () => {
    const cs = clusterSelling(sellers(), "robinhood");
    expect(cs.wallets).toBe(2);
    expect(cs.usd).toBe(1500);
    expect(cs.kinds).toContain("deployer-seeded");
    expect(cs.kinds).toContain("snipe ring wallet");
    expect(cs.kinds).not.toContain("launch-block sniper");
  });

  it("only matches registry wallets on their own chain", () => {
    const cs = clusterSelling(sellers(), "base");
    expect(cs.wallets).toBe(1); // the seeded wallet still counts via the sell history
    expect(cs.kinds).toEqual(["deployer-seeded"]);
  });

  it("treats the deployer on the tape as launch-connected even with no sell history row", () => {
    const s = sellers({ topSellers: [] });
    s.recentTape!.topSellers = [{ wallet: DEPLOYER, usd: 300, isDeployer: true, isCreator: false }];
    const cs = clusterSelling(s, "robinhood");
    expect(cs).toEqual({ wallets: 1, usd: 300, kinds: ["deployer"] });
  });

  it("returns zero without a tape", () => {
    expect(clusterSelling(sellers({ recentTape: null }), "robinhood")).toEqual({ wallets: 0, usd: 0, kinds: [] });
    expect(clusterSelling(null, "robinhood")).toEqual({ wallets: 0, usd: 0, kinds: [] });
  });
});
