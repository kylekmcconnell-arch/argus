import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { adminClient, ensureGrowthProfile, ensureStartingCredits, loadProfile } from "./_growth.js";

export const config = { maxDuration: 20 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;
  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "waitlist_unavailable" });
    return;
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await client
        .from("referral_profiles")
        .select("user_id,public_name,code,status,created_at")
        .eq("status", "waitlist")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      res.status(200).json({ items: data || [] });
      return;
    }

    const body = requestBody(req);
    const userId = typeof body?.userId === "string" && UUID.test(body.userId) ? body.userId : "";
    if (!userId) {
      res.status(400).json({ error: "valid_user_id_required" });
      return;
    }
    const existing = await loadProfile(client, userId);
    if (!existing || existing.status === "declined") {
      res.status(404).json({ error: "waitlist_entry_not_found" });
      return;
    }
    const { data: userData, error: userError } = await client.auth.admin.getUserById(userId);
    if (userError) throw userError;
    const email = userData.user?.email?.trim().toLowerCase() || "";
    if (!email) {
      res.status(404).json({ error: "auth_user_not_found" });
      return;
    }

    const { data: member, error: memberError } = await client.rpc("manage_member_access", {
      p_organization_id: auth.organizationId,
      p_actor_user_id: auth.userId,
      p_target_user_id: userId,
      p_target_email: email,
      p_role: "viewer",
      p_display_name: existing.publicName,
      p_active: true,
      p_event_type: "member.access_granted",
    });
    if (memberError) throw memberError;
    await ensureGrowthProfile(client, {
      userId,
      email,
      organizationId: auth.organizationId,
      publicName: existing.publicName,
      status: "admitted",
    });
    await ensureStartingCredits(client, userId, auth.organizationId);
    res.status(200).json({ admitted: true, member });
  } catch (error) {
    console.error("[waitlist] failed", error);
    res.status(503).json({
      error: "waitlist_unavailable",
      message: "The waitlist could not be updated.",
    });
  }
}
