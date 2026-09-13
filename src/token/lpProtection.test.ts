import { describe, expect, it } from "vitest";
import { pauseIsCallable, summarizeLpHolders } from "./lpProtection";

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";

describe("summarizeLpHolders", () => {
  it("does not treat the PEPE token contract as a 99% unlocked LP holder", () => {
    const summary = summarizeLpHolders([
      { address: PEPE, percent: "0.997020995012867747", is_locked: 0, is_contract: 1, tag: "" },
      { address: "0x000000000000000000000000000000000000dead", percent: "0.000091191289984855", is_locked: 1, is_contract: 0, tag: "" },
      { address: "0x4c3923c5e4e87eb2f0eb7db6818ee743ddc9cd50", percent: "0.000184552110224109", is_locked: 0, is_contract: 0, tag: "" },
    ], { tokenAddress: PEPE });
    expect(summary.lpAssessed).toBe(false);
    expect(summary.lpLocked).toBe(false);
    expect(summary.lpTopUnlockedEoaPct).toBeLessThan(1);
  });

  it("counts a majority burn as locked liquidity", () => {
    const summary = summarizeLpHolders([
      { address: "0x000000000000000000000000000000000000dead", percent: "0.93", is_locked: 0, is_contract: 0, tag: "" },
      { address: "0x1111111111111111111111111111111111111111", percent: "0.07", is_locked: 0, is_contract: 0, tag: "" },
    ]);
    expect(summary.lpBurnedPct).toBeGreaterThan(90);
    expect(summary.lpLocked).toBe(true);
    expect(summary.lpAssessed).toBe(true);
  });
});

describe("pauseIsCallable", () => {
  it("does not treat a renounced PEPE-style pause flag as a live halt", () => {
    expect(pauseIsCallable({ pausable: true, ownerRenounced: true, takeBack: false, hiddenOwner: false })).toBe(false);
  });

  it("still treats pause as live while an owner or reclaim path exists", () => {
    expect(pauseIsCallable({ pausable: true, ownerRenounced: false })).toBe(true);
    expect(pauseIsCallable({ pausable: true, ownerRenounced: true, takeBack: true })).toBe(true);
  });
});
