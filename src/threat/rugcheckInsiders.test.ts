import { afterEach, describe, expect, it, vi } from "vitest";
import { rugcheckReport } from "./deepsources";

// 2026-09-14 deep-dive review, token lane finding 5. RugCheck's insider
// networks OVERLAP (one wallet can sit in several), so summing their token
// amounts invents supply that does not exist: two 40% clusters read as an 80%
// "insider network", crossed the judge's 25% flag and failed the holders check
// on a token the token lane (src/token/sources.ts, api/holders.ts) reads at 40%.
// The threat lane now reads the same payload the same way: largest cluster only,
// range-checked, with RugCheck's own graph count for the wallet figure.

afterEach(() => vi.unstubAllGlobals());

function stub(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    score_normalised: 10, token: { supply: "1000" }, risks: [], rugged: false, lockers: {}, totalMarketLiquidity: 0,
    ...body,
  }), { status: 200 })));
}

describe("RugCheck insider math agrees with the token lane", () => {
  it("two overlapping 40% clusters are 40% in one hidden hand, not 80%", async () => {
    stub({
      insiderNetworks: [
        { size: 20, tokenAmount: "400" },
        { size: 20, tokenAmount: "400" },
      ],
      graphInsidersDetected: 25,
    });
    const rc = await rugcheckReport("mint");
    expect(rc?.insiderPct).toBe(40);
    expect(rc?.insidersDetected).toBe(25);
  });

  it("an out-of-range cluster share is a bad payload, never a number above 100%", async () => {
    stub({ insiderNetworks: [{ size: 5, tokenAmount: "5000" }, { size: 3, tokenAmount: "100" }] });
    const rc = await rugcheckReport("mint");
    expect(rc?.insiderPct).toBe(10);
  });

  it("without RugCheck's graph count the largest cluster's own size is the floor", async () => {
    stub({ insiderNetworks: [{ wallets: [{}, {}, {}], tokenAmount: "300" }, { size: 40, tokenAmount: "50" }] });
    const rc = await rugcheckReport("mint");
    expect(rc?.insiderPct).toBe(30);
    expect(rc?.insidersDetected).toBe(3);
  });
});
