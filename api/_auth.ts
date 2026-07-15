import type { VercelRequest, VercelResponse } from "@vercel/node";

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

    let member = await readMember(credentials, userId);
    if (!member) {
      const role = allowedRole(email);
      if (!role) {
        return reject(
          res,
          403,
          "access_not_provisioned",
          "This account is authenticated but has not been granted ARGUS access.",
        );
      }
      member = await provisionAllowedMember(credentials, userId, email, role);
    }

    if (member.active !== true) {
      return reject(res, 403, "account_disabled", "This ARGUS membership is disabled.");
    }
    const organizationId = typeof member.organization_id === "string" ? member.organization_id : "";
    const role = isRole(member.role) ? member.role : null;
    if (!organizationId || !role) {
      return reject(res, 403, "invalid_membership", "This ARGUS membership is incomplete.");
    }
    if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
      return reject(res, 403, "insufficient_role", `${minimumRole} access is required.`);
    }

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
  } catch (error) {
    console.error("[auth] verification failed", error);
    return reject(res, 503, "auth_unavailable", "ARGUS could not verify access right now.");
  }
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  remaining: number;
  error?: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function consumeInvestigationQuota(
  auth: AuthContext,
  route: string,
  metadata: Record<string, unknown> = {},
): Promise<QuotaResult> {
  const credentials = serviceCredentials();
  if (!credentials) return { allowed: false, used: 0, remaining: 0, error: "storage_not_configured" };

  const dailyLimit =
    auth.role === "owner"
      ? positiveInt(process.env.ARGUS_OWNER_DAILY_INVESTIGATION_LIMIT, 100)
      : positiveInt(process.env.ARGUS_DAILY_INVESTIGATION_LIMIT, 25);

  // The daily investigation limit is a soft guardrail. If the usage RPC is
  // transiently unreachable (Supabase latency blip, cold connection), fail OPEN
  // so a bookkeeping hiccup never kills a multi-minute scan the user is waiting
  // on. Enforcement resumes automatically the moment the RPC recovers, and a
  // genuine over-limit response (RPC succeeds, allowed=false) is still enforced.
  const failOpen = (): QuotaResult => ({ allowed: true, used: 0, remaining: dailyLimit });
  try {
    const response = await fetch(`${credentials.url}/rest/v1/rpc/consume_usage_quota`, {
      method: "POST",
      headers: serviceHeaders(credentials.key),
      body: JSON.stringify({
        p_organization_id: auth.organizationId,
        p_user_id: auth.userId,
        p_event_type: "investigation.started",
        p_route: route,
        p_daily_limit: dailyLimit,
        p_metadata: metadata,
      }),
      // Fail-open handles a slow RPC, so a modest timeout suffices; kept in step
      // with the Edge middleware's api.budget check (both ~8s over the ~5s cold
      // RPC), and short enough not to stall a scan waiting on a wedged call.
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error("[quota] RPC failed; allowing (fail-open)", response.status, (await response.text()).slice(0, 300));
      return failOpen();
    }
    const rows = (await response.json()) as unknown;
    const row = Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
      ? (rows[0] as Record<string, unknown>)
      : null;
    if (!row) {
      console.error("[quota] RPC returned no row; allowing (fail-open)");
      return failOpen();
    }
    return {
      allowed: row.allowed === true,
      used: typeof row.used === "number" ? row.used : 0,
      remaining: typeof row.remaining === "number" ? row.remaining : 0,
    };
  } catch (error) {
    console.error("[quota] check failed; allowing (fail-open)", error);
    return failOpen();
  }
}
