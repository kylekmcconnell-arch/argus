import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CREDIT_MILLIS } from "../src/lib/growth.js";

export type ArgusRole = "owner" | "analyst" | "viewer";

export interface AuthContext {
  userId: string;
  email: string;
  organizationId: string;
  role: ArgusRole;
  displayName: string;
}

interface SupabaseUser {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
}

interface MemberRow {
  user_id?: unknown;
  organization_id?: unknown;
  role?: unknown;
  display_name?: unknown;
  active?: unknown;
}

export interface ServiceCredentials {
  url: string;
  key: string;
}

export const DEFAULT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

const ROLE_RANK: Record<ArgusRole, number> = { viewer: 0, analyst: 1, owner: 2 };

export function serviceCredentials(): ServiceCredentials | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url, key } : null;
}

export function serviceHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {
    apikey: key,
    "content-type": "application/json",
    ...extra,
  };
  // Legacy service_role keys are JWTs and historically require both headers.
  // New sb_secret_* keys are opaque and must never be sent as Bearer JWTs.
  if (!key.startsWith("sb_secret_")) result.authorization = `Bearer ${key}`;
  return result;
}

function bearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = typeof value === "string" ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null;
  return match?.[1] || null;
}

function allowedRole(email: string): ArgusRole | null {
  const normalized = email.trim().toLowerCase();
  const configured = (name: string) =>
    new Set(
      (process.env[name] || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );

  if (configured("ARGUS_OWNER_EMAILS").has(normalized)) return "owner";
  if (configured("ARGUS_ANALYST_EMAILS").has(normalized)) return "analyst";
  if (configured("ARGUS_VIEWER_EMAILS").has(normalized)) return "viewer";
  return null;
}

function isRole(value: unknown): value is ArgusRole {
  return value === "owner" || value === "analyst" || value === "viewer";
}

async function readMember(
  credentials: ServiceCredentials,
  userId: string,
): Promise<MemberRow | null> {
  const response = await fetch(
    `${credentials.url}/rest/v1/argus_members?select=user_id,organization_id,role,display_name,active&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      headers: serviceHeaders(credentials.key),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`membership read failed (${response.status})`);
  const rows = (await response.json()) as unknown;
  return Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
    ? (rows[0] as MemberRow)
    : null;
}

async function provisionAllowedMember(
  credentials: ServiceCredentials,
  userId: string,
  email: string,
  role: ArgusRole,
): Promise<MemberRow> {
  const displayName = email.split("@")[0] || "analyst";
  const response = await fetch(
    `${credentials.url}/rest/v1/argus_members?on_conflict=user_id`,
    {
      method: "POST",
      headers: serviceHeaders(credentials.key, {
        prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify({
        user_id: userId,
        organization_id: DEFAULT_ORGANIZATION_ID,
        role,
        display_name: displayName,
        active: true,
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`membership provision failed (${response.status})`);
  const rows = (await response.json()) as unknown;
  const member = Array.isArray(rows) ? rows[0] : null;
  if (!member || typeof member !== "object") throw new Error("membership provision returned no row");
  return member as MemberRow;
}

function reject(res: VercelResponse, status: number, error: string, message: string): null {
  res.status(status).json({ error, message });
  return null;
}

function memberContext(userId: string, email: string, member: MemberRow): AuthContext | null {
  if (member.active !== true) return null;
  const organizationId = typeof member.organization_id === "string" ? member.organization_id : "";
  const role = isRole(member.role) ? member.role : null;
  if (!organizationId || !role) return null;
  return {
    userId,
    email,
    organizationId,
    role,
    displayName:
      typeof member.display_name === "string" && member.display_name.trim()
        ? member.display_name.trim()
        : email,
  };
}

export interface VerifiedUser {
  userId: string;
  email: string;
  displayName: string;
  member: AuthContext | null;
}

/**
 * Verify the Supabase access token and email. Allowlisted users are provisioned
 * as members. Everyone else may be a waitlist identity without product access.
 */
export async function requireVerifiedUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VerifiedUser | null> {
  const token = bearerToken(req);
  if (!token) return reject(res, 401, "authentication_required", "Sign in to continue.");

  const credentials = serviceCredentials();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!credentials || !publishableKey) {
    return reject(res, 503, "auth_not_configured", "ARGUS authentication is not configured.");
  }

  try {
    const userResponse = await fetch(`${credentials.url}/auth/v1/user`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!userResponse.ok) {
      return reject(res, 401, "invalid_session", "Your session is invalid or expired.");
    }

    const user = (await userResponse.json()) as SupabaseUser;
    const userId = typeof user.id === "string" ? user.id : "";
    const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!userId || !email) return reject(res, 401, "invalid_session", "The session has no verified user.");
    if (typeof user.email_confirmed_at !== "string" && typeof user.confirmed_at !== "string") {
      return reject(res, 403, "email_not_verified", "Verify ownership of this email before entering ARGUS.");
    }

    let memberRow = await readMember(credentials, userId);
    if (!memberRow) {
      const role = allowedRole(email);
      if (role) memberRow = await provisionAllowedMember(credentials, userId, email, role);
    }
    if (memberRow && memberRow.active !== true) {
      return reject(res, 403, "account_disabled", "This ARGUS membership is disabled.");
    }
    const member = memberRow ? memberContext(userId, email, memberRow) : null;
    if (memberRow && !member) {
      return reject(res, 403, "invalid_membership", "This ARGUS membership is incomplete.");
    }
    return {
      userId,
      email,
      displayName: member?.displayName || email.split("@")[0] || "investigator",
      member,
    };
  } catch (error) {
    console.error("[auth] verification failed", error);
    return reject(res, 503, "auth_unavailable", "ARGUS could not verify access right now.");
  }
}

/**
 * Verify the Supabase access token, resolve server-owned membership, and enforce
 * the minimum role. Roles are never accepted from JWT user metadata or request
 * input. An allowlisted, verified Supabase user is provisioned on first access.
 */
export async function requireArgusAuth(
  req: VercelRequest,
  res: VercelResponse,
  minimumRole: ArgusRole = "viewer",
): Promise<AuthContext | null> {
  const verified = await requireVerifiedUser(req, res);
  if (!verified) return null;
  if (!verified.member) {
    return reject(
      res,
      403,
      "access_not_provisioned",
      "This account is authenticated but has not been granted ARGUS access.",
    );
  }
  if (ROLE_RANK[verified.member.role] < ROLE_RANK[minimumRole]) {
    return reject(res, 403, "insufficient_role", `${minimumRole} access is required.`);
  }
  return verified.member;
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  remaining: number;
  creditRemaining?: number;
  error?: string;
  reason?: "credit_budget_exhausted";
}

export async function consumeInvestigationQuota(
  auth: AuthContext,
  route: string,
  metadata: Record<string, unknown> = {},
  idempotencyKey: string = crypto.randomUUID(),
): Promise<QuotaResult> {
  const credentials = serviceCredentials();
  if (!credentials) return { allowed: false, used: 0, remaining: 0, error: "storage_not_configured" };
  // Every investigator, including workspace owners, uses the same visible
  // credit ledger. Role controls administration, never hidden free usage.
  try {
    const response = await fetch(`${credentials.url}/rest/v1/rpc/consume_investigation_credit`, {
      method: "POST",
      headers: serviceHeaders(credentials.key),
      body: JSON.stringify({
        p_organization_id: auth.organizationId,
        p_user_id: auth.userId,
        p_idempotency_key: `investigation:${auth.userId}:${idempotencyKey}`,
        p_cost_millis: CREDIT_MILLIS,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error("[credits] ledger RPC failed", response.status, (await response.text()).slice(0, 300));
      return { allowed: false, used: 0, remaining: 0, error: "credit_ledger_unavailable" };
    }
    const rows = (await response.json()) as unknown;
    const row = Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
      ? (rows[0] as Record<string, unknown>)
      : null;
    if (!row) {
      return { allowed: false, used: 0, remaining: 0, error: "credit_ledger_unavailable" };
    }
    const creditRemaining = typeof row.balance_millis === "number"
      ? Math.max(0, row.balance_millis / CREDIT_MILLIS)
      : 0;
    if (row.allowed !== true) {
      return { allowed: false, used: 0, remaining: creditRemaining, creditRemaining, reason: "credit_budget_exhausted" };
    }
    return { allowed: true, used: 1, remaining: creditRemaining, creditRemaining };
  } catch (error) {
    console.error("[credits] ledger check failed", error, metadata);
    return { allowed: false, used: 0, remaining: 0, error: "credit_ledger_unavailable" };
  }
}

/**
 * Reverse one investigation debit that can never be spent: the receipt claim
 * for its key collided with another analyst's run. Idempotent on the key so a
 * repeated collision never refunds twice. Never used for an own-run failure:
 * the debit RPC replays on the same key, so a refunded key that is retried
 * would run for free. Own-run claim failures hold the credit on the key and
 * the retry with the same key claims it without a second charge.
 */
export async function refundInvestigationCredit(
  auth: AuthContext,
  idempotencyKey: string,
  cause: string,
): Promise<boolean> {
  const credentials = serviceCredentials();
  if (!credentials) return false;
  try {
    const response = await fetch(`${credentials.url}/rest/v1/credit_ledger?on_conflict=organization_id,idempotency_key`, {
      method: "POST",
      headers: serviceHeaders(credentials.key, { prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify({
        organization_id: auth.organizationId,
        user_id: auth.userId,
        amount_millis: CREDIT_MILLIS,
        reason: "refund",
        idempotency_key: `refund:investigation:${auth.userId}:${idempotencyKey}`,
        metadata: { userId: auth.userId, debitKey: `investigation:${auth.userId}:${idempotencyKey}`, cause },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.error("[credits] refund rejected", response.status);
    return response.ok;
  } catch (error) {
    console.error("[credits] refund failed", error instanceof Error ? error.message : "transport");
    return false;
  }
}

export interface SupplementalReservation {
  allowed: boolean;
  used?: number;
  remaining?: number;
  limit: number;
  error?: "supplemental_budget_not_configured" | "supplemental_budget_unavailable";
}

/**
 * Reserve one unit of the workspace's daily supplemental allowance from inside
 * a handler, after the request has been validated and the paid work is about
 * to start. Routes listed as handler-metered in middleware.ts are not reserved
 * there, so a rejected or clarification-only request costs nothing.
 */
export async function reserveSupplementalBudget(auth: AuthContext, route: string): Promise<SupplementalReservation> {
  const configured = process.env.ARGUS_SUPPLEMENTAL_DAILY_LIMIT?.trim();
  const limit = configured ? Number(configured) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
    return { allowed: false, limit: 0, error: "supplemental_budget_not_configured" };
  }
  const credentials = serviceCredentials();
  if (!credentials) return { allowed: false, limit, error: "supplemental_budget_unavailable" };
  try {
    const response = await fetch(`${credentials.url}/rest/v1/rpc/reserve_supplemental_budget`, {
      method: "POST",
      headers: serviceHeaders(credentials.key),
      body: JSON.stringify({ p_organization_id: auth.organizationId, p_user_id: auth.userId, p_route: route, p_daily_limit: limit }),
      signal: AbortSignal.timeout(8_000),
    });
    const rows: unknown = response.ok ? await response.json().catch(() => null) : null;
    const row = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] as Record<string, unknown> : null;
    if (!row || typeof row.allowed !== "boolean") return { allowed: false, limit, error: "supplemental_budget_unavailable" };
    return {
      allowed: row.allowed,
      used: typeof row.used === "number" ? row.used : undefined,
      remaining: typeof row.remaining === "number" ? row.remaining : undefined,
      limit,
    };
  } catch (error) {
    console.error("[supplemental] reservation failed", error instanceof Error ? error.message : "transport");
    return { allowed: false, limit, error: "supplemental_budget_unavailable" };
  }
}

/** Write the standard response for a refused supplemental reservation. Returns true when the request must stop. */
export function rejectSupplementalReservation(res: VercelResponse, reservation: SupplementalReservation): boolean {
  if (reservation.allowed) return false;
  res.setHeader("cache-control", "no-store");
  if (reservation.error) {
    res.status(503).json({ error: reservation.error });
    return true;
  }
  res.status(429).json({
    error: "supplemental_daily_limit_reached",
    limit: reservation.limit,
    message: "This workspace has reached its daily limit for supplemental checks and report chat.",
  });
  return true;
}
