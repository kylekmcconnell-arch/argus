import { next } from "@vercel/functions";

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/v1/openapi.json",
  "/api/card",
  "/api/og",
]);
const VIEWER_GET_PATHS = new Set([
  "/api/session",
  "/api/report",
  "/api/case-brief",
  "/api/graph",
  "/api/auditlog",
  "/api/providers",
  "/api/changelog",
  "/api/keys-status",
  "/api/provider-usage",
  "/api/alerts",
  "/api/augment",
]);
const OWNER_PATHS = new Set(["/api/reclassify", "/api/members"]);
const UNMETERED_COLLABORATION_PATHS = new Set(["/api/case-brief"]);
const ROLE_RANK: Record<string, number> = { viewer: 0, analyst: 1, owner: 2 };
const ROUTE_UNITS: Record<string, number> = {
  "/api/audit": 15,
  "/api/v1/person": 15,
  "/api/v1/token": 1,
  "/api/sweep": 12,
  "/api/vc-portfolio": 6,
  "/api/challenge-verdict": 4,
  "/api/ask": 3,
  "/api/reclassify": 4,
  "/api/pfp-check": 2,
  "/api/identity-sweep": 3,
  "/api/project-docs": 3,
  "/api/legal-screen": 2,
  "/api/namesake": 3,
  "/api/x-find": 3,
  "/api/recon-team": 3,
};

export const config = {
  matcher: "/api/:path*",
};

/**
 * Reject anonymous or inactive-member API traffic before a paid serverless
 * function starts. Persistence and destructive handlers independently verify
 * JWTs and roles as defense in depth.
 */
export default async function middleware(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin") || "";
    const allowed = new Set((process.env.ARGUS_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
    const headers: Record<string, string> = {
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-max-age": "600",
      vary: "Origin",
    };
    if (
      origin
      && (pathname.startsWith("/api/v1/") || pathname === "/api/case-brief")
      && allowed.has(origin)
    ) {
      headers["access-control-allow-origin"] = origin;
    }
    // Never forward an unauthenticated preflight into handlers that may ignore
    // the HTTP method and execute provider work.
    return new Response(null, { status: 204, headers });
  }
  if (PUBLIC_API_PATHS.has(pathname)) return next();

  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return Response.json(
      { error: "authentication_required", message: "Sign in to use ARGUS APIs." },
      {
        status: 401,
        headers: {
          "cache-control": "no-store",
          "www-authenticate": 'Bearer realm="ARGUS"',
        },
      },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return Response.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, authorization },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!userResponse?.ok) {
    return Response.json(
      { error: "invalid_session", message: "Your session is invalid or expired." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const user = (await userResponse.json().catch(() => ({}))) as {
    id?: unknown;
    email_confirmed_at?: unknown;
    confirmed_at?: unknown;
  };
  if (typeof user.id !== "string" || !user.id) {
    return Response.json({ error: "invalid_session" }, { status: 401 });
  }
  if (typeof user.email_confirmed_at !== "string" && typeof user.confirmed_at !== "string") {
    return Response.json({ error: "email_not_verified" }, { status: 403 });
  }

  // /api/session is the allowlisted first-login provisioning path. Its handler
  // performs the membership decision and creates an approved member if needed.
  if (pathname === "/api/session") return next();

  const serviceHeaders: Record<string, string> = { apikey: serviceKey };
  if (!serviceKey.startsWith("sb_secret_")) serviceHeaders.authorization = `Bearer ${serviceKey}`;
  const memberResponse = await fetch(
    `${supabaseUrl}/rest/v1/argus_members?select=organization_id,role,active&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    {
      headers: serviceHeaders,
      signal: AbortSignal.timeout(8_000),
    },
  ).catch(() => null);
  if (!memberResponse?.ok) {
    return Response.json({ error: "membership_unavailable" }, { status: 503 });
  }
  const members = (await memberResponse.json().catch(() => [])) as Array<{
    organization_id?: unknown;
    role?: unknown;
    active?: unknown;
  }>;
  const member = Array.isArray(members) ? members[0] : null;
  const role = typeof member?.role === "string" ? member.role : "";
  const organizationId = typeof member?.organization_id === "string" ? member.organization_id : "";
  if (member?.active !== true || !(role in ROLE_RANK) || !organizationId) {
    return Response.json({ error: "access_not_provisioned" }, { status: 403 });
  }

  const augmentRole = pathname === "/api/augment"
    ? request.method === "GET"
      ? requestUrl.searchParams.has("view") ? "owner" : "viewer"
      : request.method === "PATCH" ? "owner" : "analyst"
    : null;
  const requiredRole = augmentRole
    ?? (OWNER_PATHS.has(pathname)
      ? "owner"
      : request.method === "GET" && VIEWER_GET_PATHS.has(pathname)
        ? "viewer"
        : "analyst");
  if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    return Response.json({ error: "insufficient_role", requiredRole }, { status: 403 });
  }

  let apiBudgetRemaining: number | null = null;
  if (
    ROLE_RANK[requiredRole] >= ROLE_RANK.analyst
    && !UNMETERED_COLLABORATION_PATHS.has(pathname)
    && !(pathname === "/api/augment" && request.method === "GET")
  ) {
    const configuredLimit = Number.parseInt(
      role === "owner"
        ? process.env.ARGUS_OWNER_DAILY_API_UNITS || "1500"
        : process.env.ARGUS_DAILY_API_UNITS || "300",
      10,
    );
    const dailyLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 300;
    const quotaResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_usage_quota`, {
      method: "POST",
      headers: { ...serviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_user_id: user.id,
        p_event_type: "api.budget",
        p_route: pathname,
        p_daily_limit: dailyLimit,
        p_metadata: { method: request.method },
        p_units: ROUTE_UNITS[pathname] || 1,
      }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!quotaResponse?.ok) {
      return Response.json({ error: "quota_unavailable" }, { status: 503 });
    }
    const quotaRows = (await quotaResponse.json().catch(() => [])) as Array<{
      allowed?: unknown;
      remaining?: unknown;
    }>;
    const quota = Array.isArray(quotaRows) ? quotaRows[0] : null;
    if (quota?.allowed !== true) {
      return Response.json({ error: "daily_api_budget_reached", remaining: 0 }, { status: 429 });
    }
    apiBudgetRemaining = typeof quota.remaining === "number" ? quota.remaining : null;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-argus-user-id", user.id);
  requestHeaders.set("x-argus-role", role);
  return next({
    request: { headers: requestHeaders },
    ...(apiBudgetRemaining === null
      ? {}
      : { headers: { "x-argus-api-budget-remaining": String(apiBudgetRemaining) } }),
  });
}
