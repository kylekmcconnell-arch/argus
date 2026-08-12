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

// A team member with a LinkedIn but no X handle still has a face: unavatar's
// linkedin provider resolves the /in/<slug> profile photo. fallback=false makes
// a miss return 404 so the Avatar cleanly drops to a letter (not a grey blob).
export function linkedinAvatar(linkedin?: string | null): string | null {
  if (!linkedin) return null;
  const slug = linkedin.match(/(?:^|\/)in\/([A-Za-z0-9\-_%.]+)/i)?.[1];
  return slug ? `https://unavatar.io/linkedin/${slug}?fallback=false` : null;
}

// Best photo for a team member: their X profile, else their LinkedIn.
export function personAvatar(handle?: string | null, linkedin?: string | null): string | null {
  if (handle) return xAvatar(handle);
  return linkedinAvatar(linkedin);
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
