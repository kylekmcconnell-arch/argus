import { canonicalOfficialWebsite } from "../src/lib/fundScaleEvidence";
import type { TeamCompanyCheck, TeamCompanyHint } from "../src/lib/teamCompanyBinding";
import { fetchPublicTextWithRecovery, type PublicTextResult } from "./publicWeb";

export interface CompanyCandidate { name: string; handle?: string; linkedin?: string; sourceUrl?: string; role: string; companyHint?: TeamCompanyHint }
const plain = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const domain = (s?: string) => canonicalOfficialWebsite(s)?.domain ?? null;

/** Only the employer's explicit Website field, never arbitrary external links. */
export function employerWebsite(text: string): string | null {
  const normalized = text.replace(/&amp;/g, "&");
  const labelled = normalized.match(/(?:Website\s*(?:<[^>]*>|\s|:|\*)*)\s*(?:\[)?((?:https?:\/\/|www\.)[a-z0-9.-]+(?:\/[^\s<>"\])]+)?)/i)
    ?? normalized.match(/Website[\s\S]{0,250}?href=["'](https?:\/\/[^"']+)["']/i);
  return labelled ? domain(labelled[1]) : null;
}
function activityClass(text: string): string | null {
  const body = plain(text).toLowerCase();
  if (/\b(mining|extraction|drilling|geothermal)\b/.test(body) && /\b(minerals|subsurface|fiber laser|geology|resource prime)\b/.test(body)) return "resource-extraction";
  if (/\b(privacy|confidential)\b/.test(body) && /\b(protocol|blockchain|transactions|zero.knowledge|homomorphic|assets)\b/.test(body)) return "privacy-protocol";
  return null;
}
function personMention(text: string, candidate: CompanyCandidate): boolean {
  const body = plain(text).toLowerCase();
  const anchors = [candidate.name, candidate.handle].filter((s): s is string => Boolean(s)).map(s => s.replace(/^@/, "").toLowerCase()).filter(s => s.length > 2);
  for (const anchor of anchors) {
    const at = body.indexOf(anchor);
    if (at < 0 || /[a-z0-9_]/.test(body[at - 1] ?? "") || /[a-z0-9_]/.test(body[at + anchor.length] ?? "")) continue;
    const context = body.slice(Math.max(0, at - 120), at + anchor.length + 160);
    if (/\b(former|left|departed|no longer|not affiliated|never worked)\b/.test(context)) continue;
    if (/\b(founder|cofounder|co-founder|engineer|team|ceo|cto|coo|advisor|director|employee|built by|builder)\b/.test(context)) return true;
  }
  return false;
}
function linkedinCompany(url?: string): boolean {
  try { const u = new URL(url ?? ""); return /^(?:www\.)?linkedin\.com$/.test(u.hostname) && /^\/company\/[^/]+\/?$/.test(u.pathname); } catch { return false; }
}

export async function verifyTeamCompanyCandidates<T extends CompanyCandidate>(
  candidates: T[], officialWebsite: string | undefined, subjectHandle: string,
  deps: { read: (url: string) => Promise<PublicTextResult>; maxPages: number } = { read: fetchPublicTextWithRecovery, maxPages: 8 },
): Promise<{ accepted: T[]; checks: TeamCompanyCheck[] }> {
  const official = domain(officialWebsite);
  const cache = new Map<string, Promise<PublicTextResult>>();
  const read = async (url: string): Promise<PublicTextResult> => {
    if (!cache.has(url)) {
      if (cache.size >= deps.maxPages) return { status: "failed", reason: "page_budget_exhausted" };
      cache.set(url, deps.read(url).catch(() => ({ status: "failed" as const, reason: "source_unavailable" })));
    }
    return cache.get(url)!;
  };
  const accepted: T[] = [], checks: TeamCompanyCheck[] = [];
  // This is deliberately bounded and sequential. Unknown is not a company match.
  for (const candidate of candidates.slice(0, 48)) {
    const check: TeamCompanyCheck = { name: candidate.name, handle: candidate.handle, linkedin: candidate.linkedin,
      officialDomain: official, state: "unresolved", reason: "No independent company binding", activity: "unresolved", capturedAt: new Date().toISOString(), sources: [] };
    checks.push(check);
    const record = (page: Extract<PublicTextResult, { status: "ok" }>, excerpt: string) => {
      const readable = plain(excerpt);
      const nameAt = readable.toLowerCase().indexOf(candidate.name.toLowerCase());
      const websiteAt = readable.toLowerCase().indexOf("website");
      const at = websiteAt >= 0 ? websiteAt : Math.max(0, nameAt - 240);
      check.sources.push({ url: page.url, contentHash: page.contentHash, capturedAt: page.capturedAt, excerpt: readable.slice(Math.max(0, at - 100), Math.max(0, at - 100) + 1800) });
    };
    const hint = candidate.companyHint;
    if (hint?.website && official && domain(hint.website) !== official) {
      check.reason = "Discovery reports a different employer website; candidate excluded pending primary evidence";
      // A model's reported mismatch is not itself a confirmed adverse finding.
    }
    if (linkedinCompany(hint?.companyUrl)) {
      check.employerUrl = hint!.companyUrl;
      const employer = await read(hint!.companyUrl!);
      if (employer.status !== "ok") { check.reason = `Employer page unavailable: ${employer.reason}`; continue; }
      const employerDomain = employerWebsite(employer.text);
      record(employer, employer.text);
      if (!employerDomain || !official) { check.reason = "Employer Website field or official account website missing"; continue; }
      check.employerDomain = employerDomain;
      if (employerDomain !== official) { check.state = "rejected"; check.reason = "Employer Website field points to a different company domain"; continue; }
      const officialPage = await read(`https://${official}/`);
      if (officialPage.status === "ok") {
        record(officialPage, officialPage.text);
        const a = activityClass(employer.text), b = activityClass(officialPage.text);
        check.activity = a && b ? a === b ? "consistent" : "conflicting" : "unresolved";
        if (check.activity === "conflicting") { check.state = "rejected"; check.reason = "Employer and official company describe incompatible businesses"; continue; }
      }
      // Matching employer alone does not prove this particular person's role.
      const rolePage = candidate.sourceUrl ? await read(candidate.sourceUrl) : null;
      if (!rolePage || rolePage.status !== "ok" || !personMention(rolePage.text, candidate)) { check.reason = "Company matched, but a person-specific role passage was not retrieved"; continue; }
      const roleDomain = domain(rolePage.url);
      const exactCompanySource = rolePage.url.replace(/\/$/, "") === hint!.companyUrl!.replace(/\/$/, "");
      const linksEmployer = rolePage.text.includes(hint!.companyUrl!.replace(/^https?:\/\//, "").replace(/\/$/, ""));
      if (roleDomain !== official && !exactCompanySource && !linksEmployer) { check.reason = "Role passage does not link this employer"; continue; }
      record(rolePage, rolePage.text);
      check.state = "matched_company"; check.reason = "Retrieved employer Website field matches; role passage retained as a sourced employment claim";
      accepted.push(candidate); continue;
    }
    // First-party attribution can establish a role without a LinkedIn company.
    if (candidate.sourceUrl) {
      let firstParty = Boolean(official && domain(candidate.sourceUrl) === official);
      try {
        const u = new URL(candidate.sourceUrl);
        firstParty ||= /^(?:www\.)?(?:x|twitter)\.com$/.test(u.hostname) && u.pathname.toLowerCase().startsWith(`/${subjectHandle.replace(/^@/, "").toLowerCase()}/status/`);
      } catch { /* A malformed source stays unresolved. */ }
      if (firstParty) {
        const page = await read(candidate.sourceUrl);
        if (page.status === "ok" && personMention(page.text, candidate)) {
          record(page, page.text); check.state = "matched_company"; check.reason = "Person and role appear on a retrieved first-party company source";
          // A first-party role never validates a separately guessed LinkedIn account.
          accepted.push({ ...candidate, linkedin: undefined });
        } else check.reason = page.status === "ok" ? "First-party page does not name this person in a role context" : `Role source unavailable: ${page.reason}`;
      }
    }
  }
  return { accepted, checks };
}
