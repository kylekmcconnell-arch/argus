// Which unverified discovery leads may be shown against a PROJECT.
//
// Frozen discovery stays inspectable, but a search lane that looks a project up
// by name will find other companies wearing the same name. The audited project
// "Clutch" is a memecoin; there is also a Canadian used-car retailer called
// Clutch with real, well documented venture rounds, and a law firm's deal page
// about that company satisfied every test the funding branch used to apply. It
// published another company's Series B under a memecoin's fact sheet.
//
// The load-bearing detail of that failure: naming the subject is NOT the guard.
// A namesake page DOES name the subject, because the collision is the name. The
// only cheap discriminator left in the lead text is domain vocabulary, so a
// project lead that is not from the project's own scope has to name the subject
// AND read like it is about this industry. That is what separates "Clutch
// raised $60M in a Series B" on a car dealer's press page from the same
// sentence about a protocol.
//
// This module is the ONE copy of that rule. It used to live inside Report.tsx,
// so the investigation report (which renders the same leads for token audits)
// applied no filter at all and showed the collisions raw.

import { canonicalBasicFactPredicate } from "./basicFactQuestions";

/**
 * The minimum identity a project lead can be bound against. A Dossier
 * satisfies this structurally; a token investigation without an embedded
 * project account builds one from the project handle, name and site.
 */
export interface ProjectLeadSubject {
  handle: string;
  display_name: string;
  website?: string | null;
}

export interface ProjectLeadCandidate {
  predicate: string;
  value?: unknown;
  qualifier?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  excerpt?: string;
}

const PROJECT_LEAD_CONTEXT = /\b(?:blockchain|chain|crypto|defi|dex|launchpad|mainnet|memecoin|on[- ]chain|protocol|smart contract|token|trading|wallet)\b/i;
const PROJECT_RELATIONSHIP_CONTEXT = /\b(?:collaborat|counterpart|integrat|partner|provider|supplier)\w*\b/i;
const PROJECT_REPOSITORY_CONTEXT = /\b(?:bitbucket|github|gitlab|open[- ]source|repo(?:sitory)?|source code)\b/i;
const PROJECT_SECURITY_CONTEXT = /\b(?:exchange|issuer|listed|listing|publicly traded|security|stock|ticker|trades under)\b/i;
const PROJECT_FUNDING_CONTEXT = /\b(?:backed by|financ(?:e|ed|ing)|fund(?:ed|ing|raise)|invest(?:ed|ment|or)|pre[- ]?seed|raise[ds]?|round|seed|series [a-z]|venture capital)\b/i;
const PROJECT_INVESTOR_CONTEXT = /\b(?:backed by|funded by|invest(?:ed|ment|or)|led (?:the )?(?:financing|round)|participated in (?:the )?(?:financing|round))\b/i;
const PROJECT_NEGATIVE_AUDIT_CONTEXT = /\b(?:no|not|none|without)\b[^.]{0,80}\baudits?\b|\baudits?\b[^.]{0,80}\b(?:absent|limited|not published|unpublished|unknown)\b/i;

const UNBOUND_SOCIAL_LEAD_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
]);

export function isExactOfficialXProfile(url: string | undefined, handle: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return (host === "x.com" || host === "twitter.com")
      && path === `/${handle.replace(/^@/, "").toLowerCase()}`;
  } catch {
    return false;
  }
}

export function normalizedHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function sameHostScope(candidate: string | null, official: string | null): boolean {
  return Boolean(candidate && official && (
    candidate === official
    || candidate.endsWith(`.${official}`)
    || official.endsWith(`.${candidate}`)
  ));
}

export function projectLeadIsRelevant(subject: ProjectLeadSubject, lead: ProjectLeadCandidate): boolean {
  const sourceHost = normalizedHost(lead.sourceUrl);
  const officialHost = normalizedHost(subject.website ?? undefined);
  const officialSource = sameHostScope(sourceHost, officialHost)
    || isExactOfficialXProfile(lead.sourceUrl, subject.handle);
  const text = [lead.value, lead.qualifier, lead.sourceTitle, lead.excerpt]
    .filter(Boolean)
    .join(" ");
  const handle = subject.handle.replace(/^@/, "").toLowerCase();
  const displayName = subject.display_name.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  const wordText = normalizedText.replace(/[^a-z0-9]+/g, " ").trim();
  const wordName = displayName.replace(/[^a-z0-9]+/g, " ").trim();
  const namesSubject = Boolean(
    (handle && normalizedText.includes(handle))
    || (wordName.length >= 3 && ` ${wordText} `.includes(` ${wordName} `)),
  );
  const predicate = canonicalBasicFactPredicate(lead.predicate);

  // A generic-name social result is especially collision-prone and cannot be
  // bound to the project merely because its caption repeats the display name.
  // The exact official X account and official project domain remain eligible.
  if (sourceHost && UNBOUND_SOCIAL_LEAD_HOSTS.has(sourceHost) && !officialSource) return false;

  // A docs page is not a source-code repository, and merely running on a
  // counterparty's chain is not proof of a partnership. Keep those search hits
  // out of the reader-facing lead list until the relationship language exists.
  if (predicate === "repository") return PROJECT_REPOSITORY_CONTEXT.test(text);

  // Money is the collision that costs the most to get wrong, and it used to be
  // the only branch with no identity test at all: the predicate vocabulary
  // alone decided it, so any page containing the word "financing" qualified.
  // Off the project's own scope, a funding or investor lead now has to name the
  // subject and read as this industry. A same-named company in another sector
  // fails the second half, which is the half that does the work here.
  if (predicate === "funding" || predicate === "investor") {
    const vocabulary = predicate === "funding" ? PROJECT_FUNDING_CONTEXT : PROJECT_INVESTOR_CONTEXT;
    return vocabulary.test(text)
      && (officialSource || (namesSubject && PROJECT_LEAD_CONTEXT.test(text)));
  }

  // A third-party article saying public audit information is limited does not
  // prove a negative and merely repeats the dedicated audit/disclosure screen.
  if (predicate === "audit" && PROJECT_NEGATIVE_AUDIT_CONTEXT.test(text)) return false;
  if (predicate === "partnership") {
    return PROJECT_RELATIONSHIP_CONTEXT.test(text)
      && (officialSource || (namesSubject && PROJECT_LEAD_CONTEXT.test(text)));
  }
  if (predicate === "public_security") {
    return PROJECT_SECURITY_CONTEXT.test(text)
      && namesSubject
      && PROJECT_LEAD_CONTEXT.test(text);
  }
  if (officialSource) return true;
  return namesSubject && PROJECT_LEAD_CONTEXT.test(text);
}
