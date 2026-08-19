import { describe, expect, it } from "vitest";
import {
  SERPER_PURCHASES,
  activeCreditTotal,
  earliestActivePurchase,
  isPurchaseActive,
  latestPurchase,
  listSerperPurchases,
  purchaseExpiryInstant,
} from "./serperPurchases";

describe("Serper purchase ledger", () => {
  const starter = SERPER_PURCHASES[0];

  it("records today's Starter pack with a 6-month expiry", () => {
    expect(starter).toMatchObject({
      usd: 50,
      credits: 50_000,
      pack: "Starter",
    });
    expect(starter.purchasedAt.startsWith("2026-08-19")).toBe(true);
    expect(starter.expiresAt.startsWith("2027-02-19")).toBe(true);
    const purchased = Date.parse(starter.purchasedAt);
    const expires = purchaseExpiryInstant(starter.expiresAt).getTime();
    const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
    const sevenMonthsMs = 220 * 24 * 60 * 60 * 1000;
    expect(expires - purchased).toBeGreaterThan(sixMonthsMs - 10 * 24 * 60 * 60 * 1000);
    expect(expires - purchased).toBeLessThan(sevenMonthsMs);
  });

  it("marks the Starter pack active through the Cancun expiry day and not after", () => {
    expect(isPurchaseActive(starter, new Date("2026-08-19T16:00:00.000Z"))).toBe(true);
    expect(isPurchaseActive(starter, new Date("2027-02-19T23:00:00-05:00"))).toBe(true);
    expect(isPurchaseActive(starter, new Date("2027-02-20T00:00:00-05:00"))).toBe(false);
    const views = listSerperPurchases(new Date("2026-08-19T16:00:00.000Z"));
    expect(views[0]?.active).toBe(true);
    expect(listSerperPurchases(new Date("2027-02-20T12:00:00-05:00"))[0]?.active).toBe(false);
  });

  it("sums only unexpired credits and points at the latest pack", () => {
    expect(activeCreditTotal(SERPER_PURCHASES, new Date("2026-08-19T16:00:00.000Z"))).toBe(50_000);
    expect(activeCreditTotal(SERPER_PURCHASES, new Date("2027-02-20T12:00:00-05:00"))).toBe(0);
    expect(latestPurchase()?.pack).toBe("Starter");
    expect(earliestActivePurchase(SERPER_PURCHASES, new Date("2026-08-19T16:00:00.000Z"))?.credits).toBe(50_000);
    expect(earliestActivePurchase(SERPER_PURCHASES, new Date("2027-02-20T12:00:00-05:00"))).toBeNull();
  });
});
