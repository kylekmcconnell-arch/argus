import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient, publicLeaderboard } from "./_growth.js";
import { ARGUS_PLANS, DEFAULT_REVENUE_SHARE, publicLeaderboardPayload } from "../src/lib/growth.js";

export const config = { maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "public, max-age=30, stale-while-revalidate=60");
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }
  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "leaderboard_unavailable" });
    return;
  }
  try {
    const rows = await publicLeaderboard(client);
    res.status(200).json({
      leaderboard: publicLeaderboardPayload(rows),
      revenueShare: DEFAULT_REVENUE_SHARE,
      pricing: {
        currency: "USD",
        creditDefinition: "One standard investigation",
        plans: ARGUS_PLANS,
        checkoutActive: false,
      },
    });
  } catch (error) {
    console.error("[leaderboard] failed", error);
    res.status(503).json({
      error: "leaderboard_unavailable",
      message: "The referral leaderboard could not be loaded.",
    });
  }
}
