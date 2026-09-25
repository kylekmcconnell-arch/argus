/** Frozen employment disambiguation receipts. A company match is not proof of employment. */
export interface TeamCompanyCheck {
  name: string;
  handle?: string;
  linkedin?: string;
  officialDomain: string | null;
  employerDomain?: string;
  employerUrl?: string;
  state: "matched_company" | "rejected" | "unresolved";
  reason: string;
  capturedAt: string;
  sources: Array<{ url: string; capturedAt: string; contentHash: string; excerpt: string }>;
  activity: "consistent" | "conflicting" | "unresolved";
}

export interface TeamCompanyHint {
  companyUrl?: string;
  website?: string;
  activityMatches?: boolean;
}

function profileKey(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:/i.test(value) ? value : `https://${value}`);
    return /^(?:www\.)?linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+\/?$/.test(url.pathname)
      ? `linkedin:${url.pathname.toLowerCase().replace(/\/$/, "")}` : null;
  } catch { return null; }
}
export function sameTeamIdentity(a: { name: string; handle?: string; linkedin?: string; sourceUrl?: string }, b: { name: string; handle?: string; linkedin?: string; sourceUrl?: string }): boolean {
  const handle = (s?: string) => s?.replace(/^@/, "").toLowerCase();
  if (a.handle && b.handle) return handle(a.handle) === handle(b.handle);
  const al = profileKey(a.linkedin), bl = profileKey(b.linkedin);
  if (al && bl) return al === bl;
  // One exact role artifact may name the person, but matching display names
  // across different sources are never permission to enrich or promote a row.
  return Boolean(a.sourceUrl && a.sourceUrl === b.sourceUrl && a.name.trim().toLowerCase() === b.name.trim().toLowerCase());
}
