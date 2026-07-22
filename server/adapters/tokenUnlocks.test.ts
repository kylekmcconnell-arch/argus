import { afterEach, describe, expect, it, vi } from "vitest";
import { collectUpcomingUnlocks } from "./tokenUnlocks";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const mapBody = {
  data: [
    { id: 11, slug: "uniswap", symbol: "UNI", name: "Uniswap" },
    { id: 12, slug: "unicorn-chain", symbol: "UNI", name: "Unicorn Chain" },
    { id: 13, slug: "aave", symbol: "AAVE", name: "Aave" },
  ],
};

const eventsBody = {
  data: [
    {
      time: Date.UTC(2026, 7, 1),
      allocationName: "Team",
      unlockTokens: "12000000",
      percentOfSupply: 1.2,
      unlockValue: "27000000",
      percentOfMcap: 1.8,
      cumulativeUnlockedPercent: 63,
    },
    {
      time: Date.UTC(2026, 8, 1),
      allocationName: "Investors",
      percentOfSupply: 0.8,
      unlockValue: "18000000",
      percentOfMcap: 1.2,
      cumulativeUnlockedPercent: 64.2,
    },
  ],
};

describe("collectUpcomingUnlocks", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  it("stays dormant with zero requests until CRYPTORANK_API_KEY is set", async () => {
    delete process.env.CRYPTORANK_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await collectUpcomingUnlocks("Uniswap", "UNI");
    expect(out.available).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves the currency by symbol+name agreement and summarizes the next unlock", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return String(url).includes("/currencies/map") ? jsonResponse(mapBody) : jsonResponse(eventsBody);
    }));

    const out = await collectUpcomingUnlocks("Uniswap", "UNI");
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.nextUnlockDate).toBe("2026-08-01");
    expect(out.value.allocationName).toBe("Team");
    expect(out.value.percentOfSupply).toBe(1.2);
    expect(out.value.unlockValueUsd).toBe(27_000_000);
    expect(out.value.cumulativeUnlockedPercent).toBe(63);
    // Both events fall inside the 90-day window from the next unlock.
    expect(out.value.next90dPercentOfSupply).toBe(2);
    expect(out.value.sourceUrl).toBe("https://cryptorank.io/price/uniswap/vesting");
    // Resolved to id 11 (name agreement), never the same-symbol impostor id 12.
    expect(urls.some((url) => url.includes("/currencies/11/vesting/events"))).toBe(true);
  });

  it("fails closed on a symbol collision without name agreement", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/currencies/map")
        ? jsonResponse({ data: [
          { id: 21, slug: "alpha-one", symbol: "ALP", name: "Alpha One" },
          { id: 22, slug: "alpha-two", symbol: "ALP", name: "Alpha Two" },
        ] })
        : jsonResponse(eventsBody)));
    const out = await collectUpcomingUnlocks("Alpha", "ALP");
    expect(out.available).toBe(false);
  });

  it("reports a completed no-upcoming outcome instead of fabricating a schedule", async () => {
    process.env.CRYPTORANK_API_KEY = "cr-key";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/currencies/map") ? jsonResponse(mapBody) : jsonResponse({ data: [] })));
    const out = await collectUpcomingUnlocks("Uniswap", "UNI");
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected no-data");
    expect(out.note).toContain("no upcoming unlock events");
  });
});
