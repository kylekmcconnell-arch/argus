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
  "/api/deep-launch",
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
  "/api/holder-history",
  "/api/person-research",
  "/api/holder-alerts",
  "/api/augment",
  // Keyless read-only lookup of a public OFAC SDN address list. Runs inline on
  // every token scan, so it must be viewer-reachable and unmetered: gating it
  // to analyst or charging API budget would silently degrade the sanctions
  // screen (and per-report readiness) once a batch sweep exhausts the budget.
  "/api/sanctions",
]);
const OWNER_PATHS = new Set(["/api/reclassify", "/api/members", "/api/waitlist", "/api/threat-recheck"]);
// Admission budget for bounded paid panels/chat; scan credits remain separate.
// Paid panels: routes that spend provider money on an open report or a running
// scan. Each one also attributes its cost through the same capability, so this
// list must match the routes that resolve a panel token; a contract test
// asserts that.
const PAID_PANEL_PATHS = new Set([
  "arkham", "arkham-counterparties", "arkham-holdings", "arkham-money-flow",
  "arkham-risk-paths", "arkham-token-holders", "call-performance",
  "challenge-verdict", "cluster", "deployer", "evm-cluster", "evm-deployer",
  "evm-funder", "funder", "github-forensics", "github-shipping",
  "identity-sweep", "kol-signals", "namesake", "pfp-check", "project-docs",
  "recon-team", "resolve-github", "token-identity", "vc-portfolio", "x-find",
  "x-posts",
].map((route) => `/api/${route}`));

/** A standalone ArrayBuffer copy: Web Crypto refuses a SharedArrayBuffer view. */
const toBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

const base64UrlToBytes = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
};

/**
 * Verify a panel capability here, at the one place every paid panel passes.
 *
 * The signing helper in api/_cache.js uses node:crypto, which the Edge runtime
 * does not have, so this re-verifies the same HMAC with Web Crypto. It only
 * decides ADMISSION: the handlers still resolve the token themselves to decide
 * whether it also names a report version for cost attribution (#356).
 */
async function panelCapabilityValid(organizationId: string, token: string | null): Promise<boolean> {
  const secret = process.env.PANEL_COST_TOKEN_SECRET;
  if (!secret || !token || token.length > 2048) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
  const signature = base64UrlToBytes(parts[1]);
  const payloadBytes = base64UrlToBytes(parts[0]);
  if (!signature || !payloadBytes) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = await crypto.subtle.verify("HMAC", key, toBuffer(signature), toBuffer(new TextEncoder().encode(parts[0])));
    if (!signed) return false;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      v?: number; org?: string; report?: string; scan?: string; exp?: number;
    };
    if (!payload
      || typeof payload.org !== "string"
      || payload.org.toLowerCase() !== organizationId.toLowerCase()
      || !Number.isSafeInteger(payload.exp)
      || (payload.exp ?? 0) <= Math.floor(Date.now() / 1000)) return false;
    // A version capability names a report; a scan capability names a run.
    return (payload.v === 1 && typeof payload.report === "string" && !!payload.report)
      || (payload.v === 2 && typeof payload.scan === "string" && !!payload.scan);
  } catch {
    return false;
  }
}

const SUPPLEMENTAL_PATHS = new Set([
  "social-activity", "find-wallet", "x-authenticity",
  "ask", "arkham", "arkham-money-flow", "arkham-counterparties", "arkham-holdings", "arkham-token-holders", "arkham-risk-paths",
  "project-docs", "recon-team", "github-forensics", "resolve-github", "x-find", "pfp-check", "kol-signals", "token-identity",
  "identity-sweep", "challenge-verdict", "vc-portfolio", "call-performance", "namesake", "cluster", "funder", "deployer",
  "evm-funder", "evm-cluster", "evm-deployer", "code-review", "wallet-taxonomy", "deployer-origin", "migration", "early-buyers",
  "person-research", "cohort", "wallet-holdings", "deployer-risk", "holder-enrichment", "reclassify", "resolve-deployer", "ocr-clue",
].map((route) => `/api/${route}`));
// Routes that reserve their own supplemental unit from the handler, after
// validation and immediately before paid work (reserveSupplementalBudget in
// api/_auth.ts). Reserving here charged the daily allowance for 4xx
// rejections, clarification-only turns and provider outages that delivered
// nothing. Every path listed here MUST call the helper before its model call.
export const HANDLER_METERED_SUPPLEMENTAL_PATHS = new Set(["/api/ask", "/api/reclassify", "/api/person-research"]);
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
      "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key",
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
    // Manual requests continue through normal owner authentication below.
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

  // Identity the handlers may trust: set after authentication, always
  // overwriting whatever arrived, so a client-supplied value never reaches a
  // handler. Panels gated here rather than calling requireArgusAuth need the
  // workspace to attribute their provider spend (#356).
  const authenticatedUserId: string = user.id;
  const forwardAuthenticated = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-argus-user-id", authenticatedUserId);
    requestHeaders.set("x-argus-role", role);
    requestHeaders.set("x-argus-organization-id", organizationId);
    return next({ request: { headers: requestHeaders } });
  };

  // A paid panel must present a capability: one issued for the open report's
  // version, or for the scan that is still running. Without this the whole
  // paid surface ran on the analyst role alone (#356). Checked before any
  // budget is reserved, so a refused panel costs nothing.
  if (PAID_PANEL_PATHS.has(pathname)
    && !(await panelCapabilityValid(organizationId, request.headers.get("x-argus-panel-token")))) {
    return Response.json({
      error: "panel_capability_required",
      message: "Open this panel from a saved report or a running scan. Its capability is missing or has expired.",
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const scanKey = request.headers.get("x-argus-scan-key");
  if (scanKey && (pathname === "/api/social-activity" || pathname === "/api/x-authenticity")) {
    const body = request.method === "POST" ? await request.clone().json().catch(() => ({})) : {};
    const subject = pathname === "/api/social-activity" ? body.contractAddress : requestUrl.searchParams.get("address");
    const claim = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_scan_supplement`, {
      method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ p_organization_id: organizationId, p_user_id: user.id, p_run_key: scanKey, p_route: pathname, p_subject: typeof subject === "string" ? subject : "" }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!claim?.ok) return Response.json({ error: "scan_supplement_unavailable" }, { status: 503 });
    if (await claim.json() === true) return forwardAuthenticated();
    // Invalid/used scope cannot bypass the ordinary daily allowance.
  }

  const supplementalRoute = SUPPLEMENTAL_PATHS.has(pathname)
    || (["/api/augment", "/api/deep-launch"].includes(pathname) && request.method === "POST");
  if (supplementalRoute && !HANDLER_METERED_SUPPLEMENTAL_PATHS.has(pathname)) {
    const configuredLimit = Number(process.env.ARGUS_SUPPLEMENTAL_DAILY_LIMIT ?? 100);
    if (!Number.isInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 100000) {
      return Response.json({ error: "supplemental_budget_not_configured" }, { status: 503 });
    }
    // The workspace allowance is shared, so without a per-analyst share one
    // session can lock every colleague out for the rest of the UTC day (#356).
    // Unset means no per-user cap, which is the previous behaviour.
    const rawUserLimit = process.env.ARGUS_SUPPLEMENTAL_USER_DAILY_LIMIT;
    const configuredUserLimit = rawUserLimit == null || rawUserLimit === "" ? null : Number(rawUserLimit);
    if (configuredUserLimit !== null
      && (!Number.isInteger(configuredUserLimit) || configuredUserLimit < 1 || configuredUserLimit > 100000)) {
      return Response.json({ error: "supplemental_budget_not_configured" }, { status: 503 });
    }
    const reservation = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_supplemental_budget`, {
      method: "POST", headers: { ...serviceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ p_organization_id: organizationId, p_user_id: user.id, p_route: pathname, p_daily_limit: configuredLimit, p_user_daily_limit: configuredUserLimit }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const rows: unknown = reservation?.ok ? await reservation.json().catch(() => null) : null;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || typeof row.allowed !== "boolean") {
      return Response.json({ error: "supplemental_budget_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    if (!row.allowed) {
      const perUser = row.reason === "user_daily_limit";
      return Response.json(perUser
        ? {
          error: "supplemental_user_daily_limit_reached",
          limit: configuredUserLimit,
          message: "You have reached your own daily limit for supplemental checks and report chat. The workspace still has budget; it resets at 00:00 UTC.",
        }
        : {
          error: "supplemental_daily_limit_reached",
          limit: configuredLimit,
          message: "This workspace has reached its daily limit for supplemental checks and report chat.",
        },
        { status: 429, headers: { "cache-control": "no-store" } });
    }
  }

  return forwardAuthenticated();
}
