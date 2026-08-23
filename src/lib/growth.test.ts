import { describe, expect, it } from "vitest";
import {
  ARGUS_PLANS,
  cleanPublicName,
  creditsFromMillis,
  MIN_P90_CONTRIBUTION_MARGIN,
  OBSERVED_REPORT_COST_USD,
  planUnitEconomics,
  publicLeaderboardPayload,
  publicNameFromEmail,
  rankLeaderboard,
  splitSubscriptionCommission,
  STARTING_CREDIT_MILLIS,
} from "./growth";

describe("growth pricing and commission", () => {
  it("keeps one investigation as one credit and a 10-credit tester grant", () => {
    expect(creditsFromMillis(STARTING_CREDIT_MILLIS)).toBe(10);
    expect(ARGUS_PLANS.map((plan) => plan.id)).toEqual(["early_access", "analyst", "team"]);
    expect(ARGUS_PLANS.every((plan) => !("dailyLimit" in plan))).toBe(true);
    expect(ARGUS_PLANS[1]?.extraPack).toEqual({ credits: 10, usd: 59 });
  });

  it("keeps launch plans viable at measured p90 cost after referral share", () => {
    for (const plan of ARGUS_PLANS.filter((candidate) => candidate.monthlyUsd > 0)) {
      const economics = planUnitEconomics(
        plan.monthlyUsd,
        plan.investigationCredits,
        OBSERVED_REPORT_COST_USD.p90,
      );
      expect(economics.contributionMargin, plan.name).toBeGreaterThanOrEqual(MIN_P90_CONTRIBUTION_MARGIN);
    }
    const pack = ARGUS_PLANS[1].extraPack;
    expect(planUnitEconomics(pack.usd, pack.credits, OBSERVED_REPORT_COST_USD.p90).contributionMargin)
      .toBeGreaterThanOrEqual(MIN_P90_CONTRIBUTION_MARGIN);
  });

  it("splits 20% of subscription revenue into 25% credits and 75% cash", () => {
    expect(splitSubscriptionCommission(99_00)).toEqual({
      commissionCents: 1_980,
      creditCents: 495,
      cashCents: 1_485,
    });
    const split = splitSubscriptionCommission(1);
    expect(split.creditCents + split.cashCents).toBe(split.commissionCents);
  });
});

describe("public names and ranking", () => {
  it("rejects names that would leak emails or URLs", () => {
    expect(cleanPublicName(" Enigma Fund ")).toBe("Enigma Fund");
    expect(cleanPublicName("ab")).toBe("ab");
    expect(cleanPublicName("a")).toBeNull();
    expect(cleanPublicName("owner@argus.example")).toBeNull();
    expect(cleanPublicName("https://evil.example")).toBeNull();
  });

  it("derives a public name from an email local-part without keeping the domain", () => {
    expect(publicNameFromEmail("kyle.mcconnell@example.com")).toBe("kyle mcconnell");
  });

  it("ranks by qualified referrals, then earlier signup, and never exposes another user's id", () => {
    const ranked = rankLeaderboard([
      {
        userId: "b",
        publicName: "Later",
        code: "BBBBBBBB",
        status: "waitlist",
        createdAt: "2026-08-01T00:00:00.000Z",
        qualifiedReferrals: 4,
        paidReferrals: 1,
        revshareEarnedCents: 100,
        creditEarnedCents: 25,
        cashEarnedCents: 75,
      },
      {
        userId: "a",
        publicName: "Earlier",
        code: "AAAAAAAA",
        status: "admitted",
        createdAt: "2026-07-01T00:00:00.000Z",
        qualifiedReferrals: 4,
        paidReferrals: 0,
        revshareEarnedCents: 0,
        creditEarnedCents: 0,
        cashEarnedCents: 0,
      },
      {
        userId: "c",
        publicName: "Leader",
        code: "CCCCCCCC",
        status: "waitlist",
        createdAt: "2026-08-20T00:00:00.000Z",
        qualifiedReferrals: 9,
        paidReferrals: 2,
        revshareEarnedCents: 400,
        creditEarnedCents: 100,
        cashEarnedCents: 300,
      },
    ], "a");
    expect(ranked.map((row) => row.publicName)).toEqual(["Leader", "Earlier", "Later"]);
    expect(ranked[1]).toMatchObject({ rank: 2, isCurrentUser: true, access: "admitted" });
    expect(ranked[0]?.isCurrentUser).toBe(false);
    const published = publicLeaderboardPayload(ranked);
    expect(published[0]).toMatchObject({ rank: 1, codeTail: "CCCC" });
    expect(published[0]).not.toHaveProperty("code");
    expect(JSON.stringify(published)).not.toContain("@example");
  });
});
