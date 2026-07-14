import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { serviceCredentials } from "./_auth.js";

export const config = { maxDuration: 20 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_RESPONSE = Object.freeze({
  ok: true,
  message: "If this email is approved, a secure sign-in link is on its way.",
});

interface MemberRow {
  user_id?: unknown;
  normalized_email?: unknown;
  active?: unknown;
}

interface RateLimitRow {
  allowed?: unknown;
}

function singleHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function requestOrigin(req: VercelRequest): string | null {
  const rawOrigin = singleHeader(req.headers.origin).trim();
  const host = singleHeader(req.headers.host).trim();
  if (!rawOrigin || !host) return null;
  try {
    const origin = new URL(rawOrigin);
    const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
    if (origin.host !== host || (origin.protocol !== "https:" && !local)) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

function appOrigin(requestOrigin: string): string | null {
  try {
    const requestUrl = new URL(requestOrigin);
    const loopback = requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";
    if (process.env.NODE_ENV !== "production" && loopback && requestUrl.protocol === "http:") {
      return requestUrl.origin;
    }
  } catch {
    return null;
  }
  const configured = process.env.ARGUS_APP_ORIGIN?.trim();
  if (!configured) return null;
  try {
    const origin = new URL(configured);
    return origin.protocol === "https:" ? origin.origin : null;
  } catch {
    return null;
  }
}

function safeReturnPath(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "/";
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || value.includes("#")
  ) return null;
  try {
    const parsed = new URL(value, "https://argus.invalid");
    if (parsed.origin !== "https://argus.invalid") return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
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

function adminClient(): SupabaseClient | null {
  const credentials = serviceCredentials();
  if (!credentials) return null;
  return createClient(credentials.url, credentials.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function loginClient(): SupabaseClient | null {
  const credentials = serviceCredentials();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!credentials || !publishableKey) return null;
  return createClient(credentials.url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function isBanned(user: User): boolean {
  if (!user.banned_until) return false;
  const until = Date.parse(user.banned_until);
  return Number.isFinite(until) && until > Date.now();
}

function hasVerifiedEmail(user: User): boolean {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function keyHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function consumeRateLimit(
  client: SupabaseClient,
  scope: "signin_ip" | "signin_email",
  value: string,
  limit: number,
): Promise<boolean> {
  const windowSeconds = positiveInt(process.env.ARGUS_SIGNIN_RATE_WINDOW_SECONDS, 3_600, 3_600);
  const { data, error } = await client.rpc("consume_auth_request_limit", {
    p_scope: scope,
    p_key_hash: keyHash(value),
    p_window_seconds: Math.max(30, windowSeconds),
    p_limit: limit,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data as RateLimitRow[] : [];
  return rows[0]?.allowed === true;
}

async function sendApprovedLink(
  admin: SupabaseClient,
  login: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { data: rawMember, error: memberError } = await admin
    .from("argus_members")
    .select("user_id,normalized_email,active")
    .eq("normalized_email", email)
    .eq("active", true)
    .maybeSingle();
  if (memberError) throw memberError;
  const member = rawMember as MemberRow | null;
  const userId = typeof member?.user_id === "string" ? member.user_id : "";
  if (!userId || member?.active !== true || member.normalized_email !== email) return;

  const emailLimit = positiveInt(process.env.ARGUS_SIGNIN_EMAIL_LIMIT, 2, 10);
  if (!await consumeRateLimit(admin, "signin_email", email, emailLimit)) return;

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const user = userData.user;
  if (user.email?.trim().toLowerCase() !== email) return;
  if (!user?.id || user.deleted_at || isBanned(user)) return;

  let approvedUser = user;
  if (!hasVerifiedEmail(approvedUser)) {
    // Only recover accounts that were created by the owner invitation path.
    // Email possession is still proven by opening the fresh OTP link before a
    // session can exist. Arbitrary unconfirmed Auth users are never promoted.
    if (!approvedUser.invited_at) return;
    const { data, error } = await admin.auth.admin.updateUserById(approvedUser.id, {
      email_confirm: true,
    });
    if (error) {
      console.error("[signin] pending invitation recovery failed", error.code || "provider_error");
      return;
    }
    approvedUser = data.user;
  }
  if (!hasVerifiedEmail(approvedUser)) return;

  const { error } = await login.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  if (error) {
    console.error("[signin] link delivery failed", error.code || "provider_error");
  }
}

function requestIp(req: VercelRequest): string {
  const forwarded = singleHeader(req.headers["x-vercel-forwarded-for"])
    || singleHeader(req.headers["x-forwarded-for"])
    || singleHeader(req.headers["x-real-ip"]);
  return forwarded.split(",")[0]?.trim() || "unknown";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "method_not_allowed" });
    return;
  }

  const origin = requestOrigin(req);
  if (!origin) {
    res.status(403).json({ error: "same_origin_required" });
    return;
  }
  const body = requestBody(req);
  if (!body) {
    res.status(400).json({ error: "valid_json_body_required" });
    return;
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 320) {
    res.status(400).json({ error: "valid_email_required" });
    return;
  }
  const returnPath = safeReturnPath(body.returnTo);
  if (!returnPath) {
    res.status(400).json({ error: "relative_return_path_required" });
    return;
  }

  const admin = adminClient();
  const login = loginClient();
  const redirectOrigin = appOrigin(origin);
  if (!admin || !login || !redirectOrigin) {
    res.status(503).json({ error: "auth_not_configured" });
    return;
  }

  try {
    const ipLimit = positiveInt(process.env.ARGUS_SIGNIN_IP_LIMIT, 10, 100);
    if (await consumeRateLimit(admin, "signin_ip", requestIp(req), ipLimit)) {
      await sendApprovedLink(admin, login, email, new URL(returnPath, redirectOrigin).toString());
    }
  } catch (error) {
    console.error("[signin] request failed", error instanceof Error ? error.name : "provider_error");
    res.status(503).json({
      error: "auth_unavailable",
      message: "Sign-in is temporarily unavailable. Please try again shortly.",
    });
    return;
  }
  res.status(202).json(GENERIC_RESPONSE);
}
