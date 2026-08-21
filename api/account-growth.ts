import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  adminClient,
  accountSnapshot,
  claimReferralCode,
  completeWaitlistSignup,
  loadProfile,
} from "./_growth.js";
import { requireVerifiedUser } from "./_auth.js";
import { REFERRAL_CODE } from "../src/lib/growth.js";

export const config = { maxDuration: 20 };

function requestBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const value = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).setHeader("Allow", "GET, POST").json({ error: "method_not_allowed" });
    return;
  }
  const user = await requireVerifiedUser(req, res);
  if (!user) return;
  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "growth_storage_unavailable" });
    return;
  }

  try {
    const organizationId = user.member?.organizationId || null;
    if (!organizationId) {
      const existing = await loadProfile(client, user.userId)
        || await completeWaitlistSignup(client, user.userId, user.email);
      if (!existing) {
        res.status(403).json({
          error: "access_not_provisioned",
          message: "This account is authenticated but has not been granted ARGUS access.",
        });
        return;
      }
    }

    if (req.method === "POST") {
      const body = requestBody(req);
      const code = typeof body?.referralCode === "string"
        ? body.referralCode.trim().toUpperCase()
        : "";
      if (!REFERRAL_CODE.test(code)) {
        res.status(400).json({ error: "valid_referral_code_required" });
        return;
      }
      const claimed = await claimReferralCode(client, user.userId, code);
      res.status(200).json({
        claimed,
        account: await accountSnapshot(client, user.userId, user.email, organizationId),
      });
      return;
    }

    res.status(200).json(await accountSnapshot(client, user.userId, user.email, organizationId));
  } catch (error) {
    console.error("[account-growth] failed", error);
    res.status(503).json({
      error: "growth_account_unavailable",
      message: "Credits and referrals could not be loaded.",
    });
  }
}
