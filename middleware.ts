import { next } from "@vercel/functions";

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/v1/openapi.json",
  "/api/card",
  "/api/og",
  "/api/shared-report",
  "/api/signin",
  "/api/join",
  "/api/leaderboard",
]);
const WAITLIST_API_PATHS = new Set(["/api/account-growth"]);
const VIEWER_MUTATION_PATHS = new Set(["/api/account-growth", "/api/feedback"]);
// Vercel cron paths. These carry no Supabase session (the scheduler is not a
// member), so the normal bearer-JWT gate would always 401 them. Vercel instead
// sends "Authorization: Bearer ${CRON_SECRET}" when that env var is set, so we
// authenticate these by the shared cron secret and fail closed when it is unset
// or does not match. The handler re-checks the same secret (defense in depth).
const CRON_API_PATHS = new Set(["/api/threat-recheck"]);
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
  "/api/serper-credits",
  "/api/alerts",
  "/api/augment",
  // Keyless read-only lookup of a public OFAC SDN address list. Runs inline on
  // every token scan, so it must be viewer-reachable and unmetered: gating it
  // to analyst or charging API budget would silently degrade the sanctions
  // screen (and per-report readiness) once a batch sweep exhausts the budget.
  "/api/sanctions",
]);
const OWNER_PATHS = new Set(["/api/reclassify", "/api/members", "/api/waitlist"]);
const ROLE_RANK: Record<string, number> = { viewer: 0, analyst: 1, owner: 2 };

export const config = {
  matcher: "/api/:path*",
};

// Constant-time string comparison for the shared cron secret. The Edge runtime
// has no crypto.timingSafeEqual, so accumulate a XOR over every byte instead of
// letting === short-circuit on the first mismatch. A length difference returns
// early (the secret's length is not itself sensitive).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  if (CRON_API_PATHS.has(pathname)) {
    const cronSecret = process.env.CRON_SECRET;
    const authz = request.headers.get("authorization") || "";
    if (cronSecret && timingSafeEqual(authz, `Bearer ${cronSecret}`)) return next();
    return Response.json(
      { error: "authentication_required", message: "This endpoint is cron-only." },
      { status: 401, headers: { "cache-control": "no-store", "www-authenticate": 'Bearer realm="ARGUS"' } },
    );
  }

  // OENBOT's provider-cost view is a server-to-server read-only feed. Its
  // dedicated token is not a Supabase user session; admit only this exact path
  // before the generic JWT gate. The handler repeats the check.
  if (pathname === "/api/provider-billing") {
    const feedToken = process.env.ARGUS_BILLING_FEED_TOKEN;
    const authz = request.headers.get("authorization") || "";
    if (feedToken && timingSafeEqual(authz, `Bearer ${feedToken}`)) return next();
    return Response.json(
      { error: "authentication_required", message: "This endpoint is an authenticated operations feed." },
      { status: 401, headers: { "cache-control": "no-store", "www-authenticate": 'Bearer realm="ARGUS provider telemetry"' } },
    );
  }

  // Telegram calls the webhook with its own secret header (no bearer); the
  // handler validates x-telegram-bot-api-secret-token and fails closed, same
  // defense-in-depth shape as the cron route.
  if (pathname === "/api/telegram") return next();

  // Server-to-server: the Telegram webhook function runs the real threat
  // pipeline, which calls back into these /api routes. It authenticates with a
  // dedicated internal secret - fail closed when unset, constant-time compare
  // like the cron branch. Never issued to browsers.
  {
    const internal = process.env.INTERNAL_API_SECRET;
    const authz = request.headers.get("authorization") || "";
    if (internal && timingSafeEqual(authz, `Bearer ${internal}`)) return next();
  }

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
    if (WAITLIST_API_PATHS.has(pathname)) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-argus-user-id", user.id);
      requestHeaders.set("x-argus-role", "waitlist");
      return next({ request: { headers: requestHeaders } });
    }
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
      : VIEWER_MUTATION_PATHS.has(pathname)
        ? "viewer"
        : request.method === "GET" && VIEWER_GET_PATHS.has(pathname)
          ? "viewer"
          : "analyst");
  if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    return Response.json({ error: "insufficient_role", requiredRole }, { status: 403 });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-argus-user-id", user.id);
  requestHeaders.set("x-argus-role", role);
  return next({ request: { headers: requestHeaders } });
}
