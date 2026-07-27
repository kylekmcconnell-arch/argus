/**
 * Notice when the signed-in session stops being accepted.
 *
 * ARGUS has no central API client: panels call fetch directly and most swallow
 * failures, so an expired session produced a scatter of quietly dead panels
 * with no explanation. Observed in production on 2026-07-27, where
 * /api/providers, /api/graph, /api/auditlog and /api/report all returned 401
 * and the page simply looked broken.
 *
 * This observes responses without changing them: the wrapper calls through and
 * only reads the status of same-origin /api/ requests. It never retries, never
 * redirects, and never cancels in-flight work, because an expired session
 * during a running scan must not silently discard the result the analyst is
 * paying for. Telling them once, clearly, is the whole job.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let expired = false;
let installed = false;

export function sessionExpired(): boolean {
  return expired;
}

export function subscribeSessionExpiry(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Exported for tests; production calls installSessionExpiryWatch once. */
export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* a listener must never break the watch */ }
  }
}

export function resetSessionExpiryForTest(): void {
  expired = false;
  installed = false;
  listeners.clear();
}

function isArgusApiRequest(input: RequestInfo | URL, origin: string): boolean {
  const raw = typeof input === "string" ? input
    : input instanceof URL ? input.toString()
      : input instanceof Request ? input.url
        : "";
  if (!raw) return false;
  if (raw.startsWith("/api/")) return true;
  try {
    const url = new URL(raw, origin);
    return url.origin === origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export function installSessionExpiryWatch(target: { fetch: typeof fetch; location?: { origin?: string } }): void {
  if (installed) return;
  installed = true;
  const origin = target.location?.origin ?? "";
  const original = target.fetch.bind(target);
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await original(input, init);
    // Read only. The caller receives the untouched response either way.
    if (response.status === 401 && isArgusApiRequest(input, origin)) markSessionExpired();
    return response;
  };
}
