import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serviceCredentials } from "./_auth.js";
import { stageWaitlistSignup } from "./_growth.js";
import { REFERRAL_CODE, cleanPublicName } from "../src/lib/growth.js";

export const config = { maxDuration: 20 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_RESPONSE = Object.freeze({
  ok: true,
  message: "If this email can join, a secure ARGUS link is on its way.",
});

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
  const publicName = cleanPublicName(body.publicName);
  const referralCode = typeof body.referralCode === "string"
    ? body.referralCode.trim().toUpperCase()
    : "";
  if (!EMAIL.test(email) || email.length > 320) {
    res.status(400).json({ error: "valid_email_required" });
    return;
  }
  if (!publicName) {
    res.status(400).json({ error: "valid_public_name_required" });
    return;
  }
  if (referralCode && !REFERRAL_CODE.test(referralCode)) {
    res.status(400).json({ error: "valid_referral_code_required" });
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
    const ipLimit = positiveInt(process.env.ARGUS_JOIN_IP_LIMIT, 8, 100);
    const emailLimit = positiveInt(process.env.ARGUS_JOIN_EMAIL_LIMIT, 2, 10);
    if (await consumeRateLimit(admin, "signin_ip", requestIp(req), ipLimit)) {
      if (await consumeRateLimit(admin, "signin_email", email, emailLimit)) {
        await stageWaitlistSignup(admin, email, publicName, referralCode || null);
        const { error } = await login.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: new URL(returnPath, redirectOrigin).toString(),
          },
        });
        if (error) console.error("[join] link delivery failed", error.code || "provider_error");
      }
    }
  } catch (error) {
    console.error("[join] request failed", error instanceof Error ? error.name : "provider_error");
    res.status(503).json({
      error: "auth_unavailable",
      message: "Early access signup is temporarily unavailable. Please try again shortly.",
    });
    return;
  }
  res.status(202).json(GENERIC_RESPONSE);
}
