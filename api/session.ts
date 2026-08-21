import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireVerifiedUser } from "./_auth.js";
import { adminClient, completeWaitlistSignup, loadProfile } from "./_growth.js";

export const config = { maxDuration: 10 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }
  const verified = await requireVerifiedUser(req, res);
  if (!verified) return;
  if (verified.member) {
    res.status(200).json({
      access: "member",
      user: {
        id: verified.member.userId,
        email: verified.member.email,
        displayName: verified.member.displayName,
      },
      organizationId: verified.member.organizationId,
      role: verified.member.role,
    });
    return;
  }

  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "auth_not_configured", message: "ARGUS authentication is not configured." });
    return;
  }
  try {
    let profile = await loadProfile(client, verified.userId);
    if (!profile) profile = await completeWaitlistSignup(client, verified.userId, verified.email);
    if (!profile) {
      res.status(403).json({
        error: "access_not_provisioned",
        message: "This account is authenticated but has not been granted ARGUS access.",
      });
      return;
    }
    res.status(200).json({
      access: "waitlist",
      user: { id: verified.userId, email: verified.email, displayName: profile.publicName },
      waitlist: {
        publicName: profile.publicName,
        code: profile.code,
        status: profile.status,
      },
    });
  } catch (error) {
    console.error("[session] waitlist resolve failed", error);
    res.status(503).json({
      error: "auth_unavailable",
      message: "ARGUS could not verify access right now.",
    });
  }
}
