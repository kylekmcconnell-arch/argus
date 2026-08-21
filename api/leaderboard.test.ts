import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  publicLeaderboard: vi.fn(),
}));

vi.mock("./_growth.js", () => ({
  adminClient: mocks.adminClient,
  publicLeaderboard: mocks.publicLeaderboard,
}));

import handler from "./leaderboard";

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
    setHeader() { return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

describe("public referral leaderboard", () => {
  beforeEach(() => {
    mocks.adminClient.mockReturnValue({});
    mocks.publicLeaderboard.mockResolvedValue([
      {
        rank: 1,
        publicName: "Enigma",
        code: "SECRETCODE99",
        access: "admitted",
        qualifiedReferrals: 12,
        paidReferrals: 2,
        revshareEarnedCents: 1980,
        revsharePercent: 20,
        creditEarnedCents: 495,
        cashEarnedCents: 1485,
        isCurrentUser: false,
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("publishes ranks without the full referral code", async () => {
    const { res, captured } = response();
    await handler({ method: "GET" } as VercelRequest, res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      leaderboard: Array<Record<string, unknown>>;
      revenueShare: { creditSplitPercent: number; cashSplitPercent: number };
    };
    expect(body.leaderboard[0]).toMatchObject({
      rank: 1,
      publicName: "Enigma",
      codeTail: "DE99",
      qualifiedReferrals: 12,
    });
    expect(body.leaderboard[0]).not.toHaveProperty("code");
    expect(JSON.stringify(body)).not.toContain("SECRETCODE99");
    expect(body.revenueShare).toMatchObject({ creditSplitPercent: 25, cashSplitPercent: 75 });
  });
});
