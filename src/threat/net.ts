// Network shim for the threat pipeline. In the browser this is a pass-through:
// apiFetch("/api/x") === fetch("/api/x"), and the app's authenticated-fetch
// patch (src/auth.tsx) injects the Supabase bearer as always. Server-side (the
// Telegram bot runs the REAL threatScan inside a Vercel function), relative
// /api/ paths have no origin - configureThreatNet() sets an absolute base and
// an internal-auth header so the same pipeline runs unmodified.
let base = "";
let extraHeaders: Record<string, string> = {};

export function configureThreatNet(apiBase: string, headers: Record<string, string> = {}) {
  base = apiBase.replace(/\/$/, "");
  extraHeaders = headers;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!base) return fetch(path, init);
  const merged = { ...extraHeaders, ...((init?.headers as Record<string, string>) ?? {}) };
  return fetch(`${base}${path}`, { ...init, headers: merged });
}

// True when running outside a browser (no localStorage) - receipts fall back to
// server-ledger-only in that case.
export const hasLocalStorage = typeof localStorage !== "undefined";
