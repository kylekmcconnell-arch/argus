import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPriceHistory } from "./priceHistory";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPriceHistory", () => {
  it("dates the series so it can be frozen and distinguished from a live refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        attributes: {
          ohlcv_list: [
            [3, 0, 0, 0, 1.4],
            [1, 0, 0, 0, 1],
            [2, 0, 0, 0, 1.2],
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const history = await fetchPriceHistory(
      "0x4444444444444444444444444444444444444444",
      "ethereum",
      "0x5555555555555555555555555555555555555555",
    );

    expect(history).toMatchObject({
      points: [1, 1.2, 1.4],
      first: 1,
      last: 1.4,
      peak: 1.4,
      timeframe: "day",
    });
    expect(Date.parse(history?.capturedAt ?? "")).not.toBeNaN();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
