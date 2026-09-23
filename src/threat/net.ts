// Browser pass-through and server-side transport for the shared threat pipeline.
export interface ThreatNetContext {
  base: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}
let legacyContext: ThreatNetContext | undefined;
let contextForRequest: (() => ThreatNetContext | undefined) | undefined;

/** Legacy Telegram configuration; authenticated audit runs use request scope. */
export function configureThreatNet(apiBase: string, headers: Record<string, string> = {}) {
  legacyContext = { base: apiBase.replace(/\/$/, ""), headers };
}

/** Installed by the server-only runtime, never by browser callers. */
export function installThreatNetContext(reader: () => ThreatNetContext | undefined) {
  contextForRequest = reader;
}

export function hasThreatApiContext(): boolean {
  return !!(contextForRequest?.() ?? legacyContext)?.base;
}

export const apiFetch: typeof fetch = (input, init) => {
  const context = contextForRequest?.() ?? legacyContext;
  if (!context) return fetch(input, init);
  context.signal?.throwIfAborted();
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const relativeApi = raw.startsWith("/api/");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  // Credentials only accompany our relative API calls. Public data providers
  // never receive the analyst bearer, panel capability or deployment bypass.
  if (relativeApi) Object.entries(context.headers).forEach(([key, value]) => headers.set(key, value));
  const signals = [context.signal, init?.signal, input instanceof Request ? input.signal : undefined]
    .filter((signal): signal is AbortSignal => !!signal);
  return fetch(relativeApi ? `${context.base}${raw}` : input, {
    ...init, headers,
    ...(relativeApi ? { redirect: "error" as const } : {}),
    ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
  });
};

export const hasLocalStorage = typeof localStorage !== "undefined";
