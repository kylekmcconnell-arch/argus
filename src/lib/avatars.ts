// Best-effort imagery for an audited subject, keyless and derived where possible
// so it stays stable and needs no storage:
//   - person  -> the X profile photo (unavatar proxies pbs.twimg; X is the best
//                source, and a handle-derived URL never goes stale)
//   - site    -> the domain favicon
//   - token   -> the DexScreener logo, captured at audit time (needs the chain,
//                so it is passed through on the log entry, not derived here)

export function xAvatar(handle: string): string {
  return `https://unavatar.io/x/${handle.replace(/^@/, "")}`;
}

export function faviconFor(url: string): string | null {
  try {
    const host = new URL(/^https?:\/\//.test(url) ? url : "https://" + url).hostname;
    return host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : null;
  } catch {
    return null;
  }
}

// Resolve the best image for a logged audit. A stored image (token logo) wins;
// otherwise derive from the handle/host. Returns null -> caller shows a letter.
export function auditImage(e: { kind: string; query: string; ref?: string; image?: string }): string | null {
  if (e.image) return e.image;
  const id = e.ref ?? e.query;
  if (e.kind === "person") return xAvatar(id);
  if (e.kind === "site") return faviconFor(id);
  return null;
}
