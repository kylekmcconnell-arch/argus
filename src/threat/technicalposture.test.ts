import { afterEach, describe, expect, it, vi } from "vitest";
import { technicalPosture } from "./technicalposture";

afterEach(() => vi.unstubAllGlobals());

const covered = {
  available: true, covered: true, stance: "bullish",
  readings: [{ timeframe: "1d", stance: "bullish", observations: ["Confirmed bullish breakout from consolidation"] }],
  note: null,
};

describe("the technical posture module", () => {
  it("returns a typed posture for a covered ticker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(covered), { status: 200 })));
    await expect(technicalPosture("BTC", 1_000_000_000)).resolves.toMatchObject({
      covered: true, stance: "bullish",
      readings: [{ timeframe: "1d", observations: ["Confirmed bullish breakout from consolidation"] }],
    });
  });

  it("stays silent (null) when the ticker is not covered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: true, covered: false, note: "not covered" }), { status: 200 })));
    await expect(technicalPosture("ZZZZZ", 50_000)).resolves.toBeNull();
  });

  it("stays silent on a route failure instead of throwing into the scan", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(technicalPosture("BTC", null)).resolves.toBeNull();
  });

  it("refuses a malformed symbol without a network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(technicalPosture("BT C$", null)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
