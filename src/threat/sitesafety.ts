// Linked-site safety: is the token's own website a drainer / blacklisted host,
// and does it even have an X account. The scanner already reads the token's
// links (dossier.socials); this checks the website URLs against the layered
// api/site-safety intel and folds in the missing-socials signal.
import type { SiteSafety } from "./types";
import { apiFetch } from "./net";

const RANK: Record<string, number> = { malicious: 3, suspicious: 2, unknown: 1, clean: 0 };
const isX = (s: { label: string; url: string }) =>
  /twitter|^x$/i.test(s.label) || /(^|\/\/)(www\.)?(x|twitter)\.com\//i.test(s.url);
const isSite = (s: { label: string; url: string }) =>
  /site|website|home/i.test(s.label) || (/^https?:\/\//i.test(s.url) && !/(t\.me|discord|twitter|x\.com|instagram|tiktok|youtube|github|medium|reddit)/i.test(s.url));
function xHandle(socials: { label: string; url: string }[]): string | null {
  for (const s of socials) {
    const m = s.url.match(/(?:x|twitter)\.com\/(?!home|search|i\/)([A-Za-z0-9_]{1,20})/i);
    if (m) return m[1];
  }
  return null;
}

// The account timeline as the API returns it, validated row by row. It crosses
// the network, so a malformed entry is dropped rather than rendered: the panel
// shows dates to a reader who will act on them.
export function parseTimeline(value: unknown): NonNullable<SiteSafety["xHistory"]>["accounts"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const account = raw as Record<string, unknown>;
    if (!Array.isArray(account.names)) return [];
    const names = account.names.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const name = entry as Record<string, unknown>;
      if (typeof name.handle !== "string") return [];
      return [{
        handle: name.handle,
        firstSeen: typeof name.firstSeen === "string" ? name.firstSeen : null,
        lastSeen: typeof name.lastSeen === "string" ? name.lastSeen : null,
      }];
    });
    return names.length ? [{ id: typeof account.id === "string" ? account.id : "", names }] : [];
  });
}

// Prior screen names for the linked account (api/x-handle-history -> memory.lol).
// Never throws and never blocks the scan: an archive miss returns null and the
// rest of the site lane reports as normal.
async function handleHistory(handle: string): Promise<SiteSafety["xHistory"]> {
  try {
    const r = await apiFetch(`/api/x-handle-history?handle=${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const value = (await r.json()) as unknown;
    const d = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    if (!d?.available || typeof d.handle !== "string" || typeof d.status !== "string" || typeof d.note !== "string") return null;
    if (!["renamed", "single", "unknown"].includes(d.status)) return null;
    return {
      handle: d.handle,
      status: d.status as NonNullable<SiteSafety["xHistory"]>["status"],
      priorHandles: Array.isArray(d.priorHandles) ? d.priorHandles.filter((h): h is string => typeof h === "string") : [],
      handleReused: d.handleReused === true,
      currentSince: typeof d.currentSince === "string" ? d.currentSince : null,
      ...(typeof d.currentNameInArchive === "boolean" ? { currentNameInArchive: d.currentNameInArchive } : {}),
      lastRenameSeen: typeof d.lastRenameSeen === "string" ? d.lastRenameSeen : null,
      accounts: parseTimeline(d.accounts),
      note: d.note,
    };
  } catch { return null; }
}

export async function siteSafety(socials: { label: string; url: string }[], address?: string, chain?: string): Promise<SiteSafety | null> {
  try {
    const hasX = socials.some(isX);
    const handle = xHandle(socials);
    // Authenticity: is the scanned CA in the project's official X bio?
    const xBio = handle && address && chain
      ? await apiFetch(`/api/x-authenticity?handle=${encodeURIComponent(handle)}&address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(12000) })
          .then((r) => (r.ok ? r.json() : null))
          .then((value: unknown) => {
            const d = value && typeof value === "object" && !Array.isArray(value)
              ? value as { available?: boolean; handle?: unknown; status?: unknown; note?: unknown }
              : null;
            if (!d?.available || typeof d.handle !== "string" || typeof d.status !== "string" || typeof d.note !== "string") return null;
            if (!["verified", "mismatch", "absent", "unreadable"].includes(d.status)) return null;
            return { handle: d.handle, status: d.status as NonNullable<SiteSafety["xBio"]>["status"], note: d.note };
          })
          .catch(() => null)
      : null;

    // Provenance: did this account answer to a different name before? Keyless
    // (memory.lol), so it runs whenever a handle is linked - it needs no CA and
    // no chain, unlike the bio check above.
    const xHistory = handle ? await handleHistory(handle) : null;

    const websites = socials.filter(isSite).map((s) => s.url).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
    if (!websites.length) return { hasX, hasWebsite: false, worst: "unknown", sites: [], xBio, xHistory };

    const sites = (await Promise.all(websites.map(async (url) => {
      try {
        const r = await apiFetch(`/api/site-safety?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(18000) });
        if (!r.ok) return null;
        const d = (await r.json()) as { verdict?: string; host?: string; flags?: string[]; sources?: string[] };
        return { url, host: d.host ?? "", verdict: d.verdict ?? "unknown", flags: d.flags ?? [], sources: d.sources ?? [] };
      } catch { return null; }
    }))).filter(Boolean) as SiteSafety["sites"];

    let worst: SiteSafety["worst"] = "clean";
    for (const s of sites) if ((RANK[s.verdict] ?? 0) > RANK[worst]) worst = (s.verdict as SiteSafety["worst"]);
    return { hasX, hasWebsite: true, worst, sites, xBio, xHistory };
  } catch {
    return null;
  }
}
