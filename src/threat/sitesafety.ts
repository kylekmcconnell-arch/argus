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

export async function siteSafety(socials: { label: string; url: string }[], address?: string, chain?: string): Promise<SiteSafety | null> {
  try {
    const hasX = socials.some(isX);
    const handle = xHandle(socials);
    // Authenticity: is the scanned CA in the project's official X bio?
    const xBio = handle && address && chain
      ? await apiFetch(`/api/x-authenticity?handle=${encodeURIComponent(handle)}&address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(12000) })
          .then((r) => (r.ok ? r.json() : null))
          .then((d: any) => (d?.available ? { handle: d.handle, status: d.status, note: d.note } : null))
          .catch(() => null)
      : null;

    const websites = socials.filter(isSite).map((s) => s.url).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
    if (!websites.length) return { hasX, hasWebsite: false, worst: "unknown", sites: [], xBio };

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
    return { hasX, hasWebsite: true, worst, sites, xBio };
  } catch {
    return null;
  }
}
