export type AuthEnvironment = Record<string, string | undefined>;

function normalizedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.pathname === "/"
      && !url.search
      && !url.hash
      && !url.username
      && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function jwtRole(value: string): string | null {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

function isServerOnlyCredential(value: string): boolean {
  return value.startsWith("sb_secret_") || jwtRole(value) === "service_role";
}

export function authEnvironmentErrors(env: AuthEnvironment): string[] {
  const enforced = env.VERCEL_ENV === "production"
    || env.ARGUS_ENFORCE_AUTH_ENV_CONTRACT === "true";
  if (!enforced) return [];

  const errors: string[] = [];
  const serverOrigin = normalizedOrigin(env.SUPABASE_URL);
  const clientOrigin = normalizedOrigin(env.VITE_SUPABASE_URL);
  const serverPublishableKey = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "").trim();
  const browserPublishableKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  const serverSecrets = [
    env.SUPABASE_SECRET_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SERVICE_KEY,
  ].map((value) => value?.trim() || "").filter(Boolean);

  if (!serverOrigin) errors.push("SUPABASE_URL must be a valid HTTPS origin");
  if (!clientOrigin) errors.push("VITE_SUPABASE_URL must be a valid HTTPS origin");
  if (serverOrigin && clientOrigin && serverOrigin !== clientOrigin) {
    errors.push("server and browser Supabase URLs must use the same project");
  }
  if (!serverPublishableKey) errors.push("SUPABASE_PUBLISHABLE_KEY is required");
  if (!browserPublishableKey) {
    errors.push("VITE_SUPABASE_PUBLISHABLE_KEY is required");
  }
  if (
    serverPublishableKey
    && browserPublishableKey
    && serverPublishableKey !== browserPublishableKey
  ) {
    errors.push("server and browser Supabase publishable keys must match");
  }
  if (serverPublishableKey && isServerOnlyCredential(serverPublishableKey)) {
    errors.push("SUPABASE_PUBLISHABLE_KEY must not contain a server-only credential");
  }
  if (browserPublishableKey && isServerOnlyCredential(browserPublishableKey)) {
    errors.push("VITE_SUPABASE_PUBLISHABLE_KEY must not contain a server-only credential");
  }
  if (browserPublishableKey && serverSecrets.includes(browserPublishableKey)) {
    errors.push("the browser Supabase key must not match a server-only credential");
  }
  if (!serverSecrets.length) errors.push("a server-only Supabase credential is required");
  if (!normalizedOrigin(env.ARGUS_APP_ORIGIN)) {
    errors.push("ARGUS_APP_ORIGIN must be a valid HTTPS origin");
  }
  if (env.VITE_ARGUS_ALLOW_BOOTSTRAP_SIGNUP === "true") {
    errors.push("bootstrap signup must be disabled in production");
  }
  return errors;
}
