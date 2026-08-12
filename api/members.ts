import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  requireArgusAuth,
  serviceCredentials,
  type ArgusRole,
} from "./_auth.js";

export const config = { maxDuration: 20 };

const ROLES: ReadonlySet<ArgusRole> = new Set(["owner", "analyst", "viewer"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MemberRow {
  user_id: string;
  organization_id: string;
  role: ArgusRole;
  display_name: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface MemberEventRow {
  id: string;
  target_user_id: string | null;
  target_email: string;
  actor_user_id: string | null;
  event_type: string;
  previous_state: Record<string, unknown>;
  next_state: Record<string, unknown>;
  created_at: string;
}

function adminClient(): SupabaseClient | null {
  const credentials = serviceCredentials();
  if (!credentials) return null;
  return createClient(credentials.url, credentials.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

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

function roleValue(value: unknown): ArgusRole | null {
  return typeof value === "string" && ROLES.has(value as ArgusRole)
    ? value as ArgusRole
    : null;
}

function cleanDisplayName(value: unknown, email: string): string {
  const fallback = email.split("@")[0] || "investigator";
  return (typeof value === "string" ? value.trim() : fallback).slice(0, 80) || fallback;
}

function invitationOrigin(): string {
  const configured = process.env.ARGUS_APP_ORIGIN?.trim();
  const vercelHost = process.env.VERCEL_URL?.trim();
  const candidate = configured || (vercelHost ? `https://${vercelHost}` : "http://localhost:5173");
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return url.origin;
    }
  } catch {
    // Configuration errors fall back to local development, never a request host.
  }
  return "http://localhost:5173";
}

async function allAuthUsers(client: SupabaseClient): Promise<User[]> {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users;
}

function hasVerifiedEmail(user: User): boolean {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

async function resendPendingInvitation(
  client: SupabaseClient,
  email: string,
): Promise<Error | null> {
  const { error } = await client.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: invitationOrigin() },
  });
  return error;
}

function memberView(member: MemberRow, user?: User) {
  return {
    userId: member.user_id,
    email: user?.email || "",
    displayName: member.display_name || user?.email?.split("@")[0] || "investigator",
    role: member.role,
    active: member.active,
    emailVerified: Boolean(user?.email_confirmed_at || user?.confirmed_at),
    lastSignInAt: user?.last_sign_in_at || null,
    createdAt: member.created_at,
    updatedAt: member.updated_at,
  };
}

async function manageMember(
  client: SupabaseClient,
  input: {
    organizationId: string;
    actorUserId: string;
    targetUserId: string;
    targetEmail: string;
    role: ArgusRole;
    displayName: string;
    active: boolean;
    eventType: string;
  },
): Promise<MemberRow> {
  const { data, error } = await client.rpc("manage_member_access", {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_target_user_id: input.targetUserId,
    p_target_email: input.targetEmail,
    p_role: input.role,
    p_display_name: input.displayName,
    p_active: input.active,
    p_event_type: input.eventType,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("member access update returned no row");
  }
  return data as MemberRow;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (!(["GET", "POST", "PUT"] as Array<string | undefined>).includes(req.method)) {
    res.status(405).setHeader("Allow", "GET, POST, PUT").json({ error: "method_not_allowed" });
    return;
  }

  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;
  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "auth_not_configured" });
    return;
  }

  try {
    if (req.method === "GET") {
      const [memberResult, users, eventResult] = await Promise.all([
        client
          .from("argus_members")
          .select("user_id,organization_id,role,display_name,active,created_at,updated_at")
          .eq("organization_id", auth.organizationId)
          .order("created_at", { ascending: true }),
        allAuthUsers(client),
        client
          .from("member_events")
          .select("id,target_user_id,target_email,actor_user_id,event_type,previous_state,next_state,created_at")
          .eq("organization_id", auth.organizationId)
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      if (memberResult.error) throw memberResult.error;
      if (eventResult.error) throw eventResult.error;
      const userById = new Map(users.map((user) => [user.id, user]));
      const members = (memberResult.data as MemberRow[]).map((member) =>
        memberView(member, userById.get(member.user_id)),
      );
      const events = (eventResult.data as MemberEventRow[]).map((event) => ({
        id: event.id,
        targetUserId: event.target_user_id,
        targetEmail: event.target_email,
        actorEmail: event.actor_user_id ? userById.get(event.actor_user_id)?.email || null : null,
        type: event.event_type,
        previousState: event.previous_state,
        nextState: event.next_state,
        createdAt: event.created_at,
      }));
      res.status(200).json({ members, events, currentUserId: auth.userId });
      return;
    }

    const body = requestBody(req);
    if (!body) {
      res.status(400).json({ error: "valid_json_body_required" });
      return;
    }

    if (req.method === "POST") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = roleValue(body.role) || "analyst";
      if (!EMAIL.test(email) || email.length > 320) {
        res.status(400).json({ error: "valid_email_required" });
        return;
      }
      if (body.role !== undefined && !roleValue(body.role)) {
        res.status(400).json({ error: "invalid_role" });
        return;
      }

      const { count, error: countError } = await client
        .from("argus_members")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", auth.organizationId);
      if (countError) throw countError;
      if ((count || 0) >= 100) {
        res.status(409).json({ error: "workspace_member_limit_reached" });
        return;
      }

      const users = await allAuthUsers(client);
      let user = users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
      let invitationSent = false;
      let invitationResent = false;
      let authUserCreated = false;
      if (!user) {
        const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
          redirectTo: invitationOrigin(),
        });
        if (error) {
          console.error("[members] invitation failed", error.code || error.message);
          res.status(502).json({ error: "invitation_failed", message: "Supabase could not send the invitation." });
          return;
        }
        user = data.user;
        invitationSent = true;
        authUserCreated = true;
      } else if (!hasVerifiedEmail(user)) {
        const resendError = await resendPendingInvitation(client, email);
        if (resendError) {
          console.error("[members] invitation resend failed", resendError.message);
          res.status(502).json({
            error: "invitation_resend_failed",
            message: "Supabase could not resend the invitation.",
          });
          return;
        }
        invitationSent = true;
        invitationResent = true;
      }
      if (!user?.id) throw new Error("invitation returned no user");

      const displayName = cleanDisplayName(body.displayName, email);
      const member = await manageMember(client, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        targetUserId: user.id,
        targetEmail: email,
        role,
        displayName,
        active: true,
        eventType: invitationSent ? "member.invited" : "member.access_granted",
      });
      res.status(authUserCreated ? 201 : 200).json({
        member: memberView(member, user),
        invitationSent,
        invitationResent,
      });
      return;
    }

    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!UUID.test(userId)) {
      res.status(400).json({ error: "valid_user_id_required" });
      return;
    }
    const { data: existingData, error: existingError } = await client
      .from("argus_members")
      .select("user_id,organization_id,role,display_name,active,created_at,updated_at")
      .eq("organization_id", auth.organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existingData) {
      res.status(404).json({ error: "member_not_found" });
      return;
    }
    const existing = existingData as MemberRow;
    if (body.role !== undefined && !roleValue(body.role)) {
      res.status(400).json({ error: "invalid_role" });
      return;
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      res.status(400).json({ error: "active_must_be_boolean" });
      return;
    }
    if (body.resendInvitation !== undefined && typeof body.resendInvitation !== "boolean") {
      res.status(400).json({ error: "resend_invitation_must_be_boolean" });
      return;
    }

    const nextRole = roleValue(body.role) || existing.role;
    const nextActive = typeof body.active === "boolean" ? body.active : existing.active;
    const users = await allAuthUsers(client);
    const targetUser = users.find((user) => user.id === userId);
    if (!targetUser) {
      res.status(404).json({ error: "auth_user_not_found" });
      return;
    }
    const email = targetUser.email?.trim().toLowerCase() || "unknown@invalid.local";
    const nextDisplayName = body.displayName === undefined
      ? existing.display_name || email.split("@")[0]
      : cleanDisplayName(body.displayName, email);

    if (body.resendInvitation === true) {
      if (!existing.active) {
        res.status(409).json({
          error: "member_disabled",
          message: "Restore this member before resending an invitation.",
        });
        return;
      }
      if (hasVerifiedEmail(targetUser)) {
        res.status(409).json({
          error: "email_already_verified",
          message: "This member has already verified their email.",
        });
        return;
      }
      const resendError = await resendPendingInvitation(client, email);
      if (resendError) {
        console.error("[members] invitation resend failed", resendError.message);
        res.status(502).json({
          error: "invitation_resend_failed",
          message: "Supabase could not resend the invitation.",
        });
        return;
      }
      const member = await manageMember(client, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        targetUserId: userId,
        targetEmail: email,
        role: existing.role,
        displayName: existing.display_name || email.split("@")[0],
        active: true,
        eventType: "member.invited",
      });
      res.status(200).json({
        member: memberView(member, targetUser),
        invitationSent: true,
        invitationResent: true,
      });
      return;
    }

    if (auth.userId === userId && (nextRole !== "owner" || !nextActive)) {
      res.status(409).json({
        error: "self_lockout_prevented",
        message: "Owners cannot remove their own owner access.",
      });
      return;
    }
    if (
      nextRole === existing.role &&
      nextActive === existing.active &&
      nextDisplayName === existing.display_name
    ) {
      res.status(200).json({ member: memberView(existing, targetUser), unchanged: true });
      return;
    }

    const eventType = nextActive !== existing.active
      ? nextActive ? "member.access_enabled" : "member.access_disabled"
      : nextRole !== existing.role
        ? "member.role_changed"
        : "member.profile_updated";
    const member = await manageMember(client, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      targetUserId: userId,
      targetEmail: email,
      role: nextRole,
      displayName: nextDisplayName,
      active: nextActive,
      eventType,
    });
    res.status(200).json({ member: memberView(member, targetUser) });
  } catch (error) {
    console.error("[members] failed", error);
    res.status(500).json({ error: "member_admin_failed" });
  }
}
