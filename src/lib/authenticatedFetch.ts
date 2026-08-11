export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Supabase may emit SIGNED_IN again when a tab regains focus. */
export function shouldRevalidateSession(
  nextAccessToken: string | null,
  validatedAccessToken: string | null,
  pendingAccessToken: string | null,
): boolean {
  if (!nextAccessToken) return true;
  return nextAccessToken !== validatedAccessToken && nextAccessToken !== pendingAccessToken;
}

/**
 * Attach the current ARGUS session token without calling back into the auth
 * client. Supabase auth events can hold an internal client lock, so a fetch
 * interceptor that calls auth.getSession() can deadlock persisted sessions.
 */
export function createAuthenticatedFetch(
  nativeFetch: FetchLike,
  origin: string,
  getAccessToken: () => string | null,
  // Optional: refresh the session and return a fresh token. Called ONLY on a
  // 401 from an API request we authenticated (off the hot path, so it cannot
  // deadlock the way calling auth on every request would), then the request is
  // retried once. Without it, behaviour is unchanged.
  refreshAccessToken?: () => Promise<string | null>,
): FetchLike {
  return async (input, init) => {
    const rawUrl =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    const url = new URL(rawUrl, origin);

    if (url.origin !== origin || !url.pathname.startsWith("/api/")) {
      return nativeFetch(input, init);
    }

    const token = getAccessToken();
    if (!token) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const callerSuppliedAuth = headers.has("authorization");
    if (!callerSuppliedAuth) headers.set("authorization", `Bearer ${token}`);

    const res = await nativeFetch(input, { ...init, headers });

    // Idle tabs let Supabase's auto-refresh lapse, so a long-open report's
    // on-demand call (cohort / insider clusters) can hit an expired token.
    // Refresh once and retry so the panel loads instead of silently emptying.
    if (res.status === 401 && refreshAccessToken && !callerSuppliedAuth) {
      const fresh = await refreshAccessToken().catch(() => null);
      if (fresh && fresh !== token) {
        const retryHeaders = new Headers(init?.headers);
        new Headers(input instanceof Request ? input.headers : undefined).forEach((v, k) => { if (!retryHeaders.has(k)) retryHeaders.set(k, v); });
        retryHeaders.set("authorization", `Bearer ${fresh}`);
        return nativeFetch(input, { ...init, headers: retryHeaders });
      }
    }
    return res;
  };
}
