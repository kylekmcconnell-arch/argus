/** Registry identity links must name an account, not a post or lookalike host. */
const X_RESERVED_PATHS = new Set([
  "i",
  "home",
  "search",
  "intent",
  "share",
  "hashtag",
  "explore",
  "settings",
  "messages",
  "notifications",
  "compose",
  "login",
  "signup",
  "privacy",
  "tos",
  "about",
  "download",
  "jobs",
  "help",
]);


export function officialXProfileHandle(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["https:", "http:"].includes(url.protocol) || (host !== "x.com" && host !== "twitter.com")) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return null;
    const handle = segments[0];
    if (!/^[A-Za-z0-9_]{2,30}$/.test(handle) || X_RESERVED_PATHS.has(handle.toLowerCase())) return null;
    return handle;
  } catch {
    return null;
  }
}
