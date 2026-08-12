import type { Dossier } from "../data/dossier";

export interface ProjectWebSurface {
  host: string;
  url: string;
}

const NON_SITE_HOST = /(^|\.)(?:x\.com|twitter\.com|t\.me|telegram\.me|discord\.com|discord\.gg|github\.com|medium\.com|mirror\.xyz|substack\.com|linkedin\.com|youtube\.com|youtu\.be|reddit\.com|warpcast\.com)$/i;

function publicOrigin(raw: string): ProjectWebSurface | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || NON_SITE_HOST.test(host)) return null;
    return { host, url: `${parsed.protocol}//${host}` };
  } catch {
    return null;
  }
}

/**
 * Recover official project/company sites from frozen, verified first-party
 * evidence. Some token investigations store the token landing page in the
 * profile website field while the protocol site survives only on fact
 * citations. Those are different entities and must remain visible as such.
 */
export function projectWebSurfaces(project: Dossier | null): ProjectWebSurface[] {
  if (!project) return [];
  const byHost = new Map<string, ProjectWebSurface & { citations: number }>();
  for (const fact of project.basicFacts ?? []) {
    if (fact.status !== "verified" && fact.status !== "corroborated") continue;
    for (const source of fact.sources ?? []) {
      if (source.sourceClass !== "official_subject" || source.relation !== "supports" || source.artifactVerified !== true) continue;
      const site = publicOrigin(source.url);
      if (!site) continue;
      const current = byHost.get(site.host);
      byHost.set(site.host, { ...site, citations: (current?.citations ?? 0) + 1 });
    }
  }

  return [...byHost.values()]
    // When both clutch.markets and docs.clutch.markets are cited, the root is
    // the public site and the docs host is already reachable through evidence.
    // Check the whole set before ranking so a frequently cited docs host cannot
    // outrank and preserve itself ahead of its cited root.
    .filter((site, _index, all) => !all.some((other) =>
      other.host !== site.host && site.host.endsWith(`.${other.host}`)))
    .sort((a, b) => b.citations - a.citations || a.host.split(".").length - b.host.split(".").length || a.host.localeCompare(b.host))
    .map(({ host, url }) => ({ host, url }));
}
