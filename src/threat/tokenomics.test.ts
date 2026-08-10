import { describe, expect, it } from "vitest";
import { tokenomicsSignals } from "./solidity";
import { analyzeTokenomics } from "./tokenomics";
import type { GoPlusMeta } from "./deepsources";
import type { TokenDossier } from "../token/audit";

const RWA_TAX = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract StockRewardToken {
    uint256 public sellFee = 5;
    function _transfer(address from, address to, uint256 amount) internal {
        uint256 fee = amount * sellFee / 100;
        _buyStockAndDistribute(fee); // buys equity, distributes dividend to holders
    }
    function _buyStockAndDistribute(uint256 amt) internal {
        // swaps to USDC, buys tokenized stock, distributes dividend to shareholders
        distributeDividend(amt);
    }
    function distributeDividend(uint256 amt) internal {}
    function burn(uint256 amt) external {}
}`;

const REFLECT = `pragma solidity ^0.8.0;
contract Reflect {
    mapping(address=>uint256) private _rOwned;
    uint256 private _tFeeTotal;
    function _reflectFee(uint256 rFee, uint256 tFee) private { _tFeeTotal += tFee; }
}`;

describe("tokenomicsSignals", () => {
  it("reads an RWA/stock-distribution tax destination", () => {
    const t = tokenomicsSignals([{ path: "S.sol", content: RWA_TAX }]);
    expect(t.taxDestinations).toContain("rwa-distribution");
    expect(t.hasBurnFunction).toBe(true);
    expect(t.rwaKeywords.length).toBeGreaterThan(0);
  });
  it("reads reflection tokenomics", () => {
    const t = tokenomicsSignals([{ path: "R.sol", content: REFLECT }]);
    expect(t.taxDestinations).toContain("reflection");
  });
  it("reports nothing on a plain contract", () => {
    const t = tokenomicsSignals([{ path: "P.sol", content: "contract P { function transfer(address a, uint256 b) external {} }" }]);
    expect(t.taxDestinations).toHaveLength(0);
    expect(t.hasBurnFunction).toBe(false);
  });
});

// Minimal dossier factory for analyzeTokenomics.
function dossier(over: Partial<TokenDossier> = {}): TokenDossier {
  const safety: any = {
    available: true, buyTax: 0, sellTax: 5, lpBurnedPct: 0, lpLockedPct: 0,
    lpTopUnlockedEoaPct: 0, topHolderPct: 40, holderCount: 1000, creatorPercent: 0,
  };
  return {
    address: "0xabc", chain: "ethereum", symbol: "TKN", name: "Token", liquidityUsd: 50000,
    mcap: 100000, ageDays: 40, bundleRisk: "low", insiderPct: 0, bundleCount: 0,
    safety, findings: [], cg: null,
    ...over,
  } as TokenDossier;
}

function meta(over: Partial<GoPlusMeta> = {}): GoPlusMeta {
  return {
    fakeToken: false, fakeTokenOf: null, airdropScam: false, trustListed: false, inCex: false,
    holders: [], lpHolders: [], totalSupply: null, ...over,
  };
}

describe("analyzeTokenomics", () => {
  it("separates a pool from holder concentration", () => {
    const m = meta({
      holders: [
        { address: "0xpool", percent: 60, tag: "Uniswap V2 Pool", isLocked: false, isContract: true },
        { address: "0xwhale", percent: 20, tag: "", isLocked: false, isContract: false },
      ],
    });
    const tk = analyzeTokenomics(dossier(), m, null, null);
    expect(tk.pools).toHaveLength(1);
    expect(tk.realHolderTopPct).toBe(20); // the pool's 60% is excluded
  });

  it("treats a Uniswap V4 / concentrated pool as an NFT position, not 'removable'", () => {
    const tk = analyzeTokenomics(dossier({ dexId: "uniswap", dexLabels: ["v4"] }), meta(), null, null);
    expect(tk.lp.status).toBe("nft-position");
    expect(tk.lp.note).toMatch(/NFT position/i);
    expect(tk.lp.note).not.toMatch(/removable/i);
  });

  it("treats a Raydium CLMM pool as an NFT position", () => {
    const tk = analyzeTokenomics(dossier({ chain: "solana", dexId: "raydium clmm", dexLabels: [] }), meta(), null, null);
    expect(tk.lp.status).toBe("nft-position");
  });

  it("clamps impossible aggregates and suppresses inconsistent holder data", () => {
    // Free-tier rows that sum well past 100% must not yield a >100% figure.
    const m = meta({
      holders: [
        { address: "0x000000000000000000000000000000000000dead", percent: 200, tag: "burn", isLocked: false, isContract: false },
        { address: "0xwhale", percent: 180, tag: "", isLocked: false, isContract: false },
      ],
    });
    const tk = analyzeTokenomics(dossier(), m, null, null);
    expect(tk.burn.burnedSupplyPct).toBeLessThanOrEqual(100);
    expect(tk.realHolderTopPct).toBeLessThanOrEqual(100);
    // Inconsistent (sum > 105) → holder-derived separation is suppressed, not garbage.
    expect(tk.pools).toHaveLength(0);
  });

  it("reports one coherent LP-secured number (burn + lock)", () => {
    const d = dossier();
    (d.safety as any).lpBurnedPct = 30;
    (d.safety as any).lpLockedPct = 40;
    const tk = analyzeTokenomics(d, meta(), null, null);
    expect(tk.lp.status).toBe("locked");
    expect(tk.lp.lockedPct).toBe(70); // 30 burned + 40 locked = 70 secured, single figure
  });

  it("recognizes a launchpad locker as locked-by-design", () => {
    const m = meta({
      lpHolders: [{ address: "0xlock", percent: 100, tag: "Pons LaunchLocker", isLocked: false, isContract: true }],
    });
    const tk = analyzeTokenomics(dossier({ chain: "robinhood" }), m, null, null);
    expect(tk.lp.status).toBe("launchpad-locked");
    expect(tk.lp.lockers.join()).toMatch(/Pons/i);
  });

  it("does not assert 'removable' on a fresh/early-launchpad token", () => {
    const tk = analyzeTokenomics(dossier({ ageDays: 2 }), meta(), null, null);
    expect(tk.lp.status).toBe("unconfirmed");
    expect(tk.lp.note).toMatch(/launchpad|verify/i);
  });

  it("reads an RWA tax as a positive-toned destination", () => {
    const code = tokenomicsSignals([{ path: "S.sol", content: RWA_TAX }]);
    const tk = analyzeTokenomics(dossier(), meta(), null, code);
    expect(tk.tax.destinations).toContain("rwa-distribution");
    expect(tk.tax.tone).toBe("good");
  });

  it("computes % of supply burned and separates burn addresses", () => {
    const m = meta({
      holders: [
        { address: "0x000000000000000000000000000000000000dead", percent: 30, tag: "burn", isLocked: false, isContract: false },
        { address: "0xwhale", percent: 25, tag: "", isLocked: false, isContract: false },
      ],
    });
    const tk = analyzeTokenomics(dossier(), m, null, null);
    expect(Math.round(tk.burn.burnedSupplyPct)).toBe(30);
    expect(tk.realHolderTopPct).toBe(25);
  });
});
