export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Attach the current ARGUS session token without calling back into the auth
 * client. Supabase auth events can hold an internal client lock, so a fetch
 * interceptor that calls auth.getSession() can deadlock persisted sessions.
 */
export function createAuthenticatedFetch(
  nativeFetch: FetchLike,
  origin: string,
  getAccessToken: () => string | null,
): FetchLike {
  return (input, init) => {
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
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }

    return nativeFetch(input, { ...init, headers });
  };
}
