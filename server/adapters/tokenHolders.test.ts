import { afterEach, describe, expect, it, vi } from "vitest";
import { collectHolderProfile } from "./tokenHolders";

const goplusBody = (over: Record<string, unknown> = {}) => ({
  result: {
    "0xabc": {
      holder_count: "370041",
      holders: [
        { address: "0x1", percent: "0.056", is_contract: 1 },
        { address: "0x2", percent: "0.04" },
        { address: "0x3", percent: "0.03" },
      ],
      lp_holders: [
        { address: "0x000000000000000000000000000000000000dead", percent: "0.6" },
        { address: "0x4", percent: "0.25", is_locked: 1 },
        { address: "0x5", percent: "0.15", is_locked: 0 },
      ],
      ...over,
    },
  },
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("collectHolderProfile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("profiles concentration and burned-or-locked liquidity from the GoPlus register", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(goplusBody())));
    const out = await collectHolderProfile("Ethereum", "0xabc");
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.topHolderPct).toBeCloseTo(5.6, 5);
    expect(out.value.top10Pct).toBeCloseTo(12.6, 5);
    expect(out.value.holderCount).toBe(370_041);
    // 60% burned (dead address) + 25% locked; the 15% unlocked wallet does not count.
    expect(out.value.lpLockedOrBurnedPct).toBeCloseTo(85, 5);
    expect(out.value.sourceUrl).toContain("gopluslabs.io/token-security/1/0xabc");
  });

  it("returns a completed no-data outcome for an unmapped chain without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await collectHolderProfile("Solana", "So11111111111111111111111111111111111111112");
    expect(out.available).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an empty register as no-data rather than minting a zero profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ result: { "0xabc": {} } })));
    const out = await collectHolderProfile("ethereum", "0xabc");
    expect(out.available).toBe(false);
  });
});
