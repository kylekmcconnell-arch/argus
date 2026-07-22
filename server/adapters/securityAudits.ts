// Security-audit collector: verifies independent audits the rug-unfakeable way.
//
// A project's own /security page listing "Trail of Bits, CertiK, ..." is
// SELF-ATTESTATION: any scam can publish that list, so a first-party page can
// never mint a verified audit fact by itself. What a scam cannot do is make
// the auditor's own website name it. This collector therefore works in two
// hops:
//
//   1. Fetch the subject's security/audits page (candidates: DeFiLlama
//      audit_links plus the {officialSite}/security convention) and extract
//      which KNOWN auditors it names, plus outbound links into each auditor's
//      own domain.
//   2. Fetch the auditor-domain page and require the subject's name in its
//      text. Only that counterparty confirmation upgrades an auditor claim to
//      CORROBORATED; everything else stays a self-attested research lead,
//      visible for transparency and excluded from scoring gates.
//
// All fetches are bounded direct requests (no article-recovery retry ladder)
// and the collector never throws.

export interface AuditorEvidence {
  auditor: string;
  /** Page on the auditor's own domain that names the subject. */
  auditorUrl: string;
  /** Bounded excerpt from the auditor page containing the subject's name. */
  excerpt: string;
}

export interface SecurityAuditsResult {
  available: boolean;
  note: string;
  /** First-party security page that was successfully fetched, when any. */
  securityPageUrl: string | null;
  /** Auditor names the subject's own page claims (self-attestation only). */
  selfAttested: string[];
  /** Auditor claims confirmed on the auditor's own domain. */
  corroborated: AuditorEvidence[];
  capturedAt: string;
}

/**
 * Known independent security firms and their canonical domains. A name match
 * on the subject's page is only a claim; the domain is where confirmation
 * must come from. Immunefi is deliberately excluded: a bug bounty is not an
 * audit.
 */
const AUDITOR_REGISTRY: ReadonlyArray<{ name: string; pattern: RegExp; domains: string[] }> = [
  { name: "Trail of Bits", pattern: /trail\s*of\s*bits/i, domains: ["trailofbits.com"] },
  { name: "OpenZeppelin", pattern: /open\s*zeppelin/i, domains: ["openzeppelin.com"] },
  { name: "Certora", pattern: /certora/i, domains: ["certora.com"] },
  { name: "ChainSecurity", pattern: /chain\s*security/i, domains: ["chainsecurity.com"] },
  { name: "Sigma Prime", pattern: /sigma\s*prime/i, domains: ["sigmaprime.io"] },
  { name: "PeckShield", pattern: /peck\s*shield/i, domains: ["peckshield.com"] },
  { name: "ABDK", pattern: /\babdk\b/i, domains: ["abdk.consulting"] },
  { name: "Spearbit", pattern: /spearbit/i, domains: ["spearbit.com", "cantina.xyz"] },
  { name: "Cantina", pattern: /cantina/i, domains: ["cantina.xyz"] },
  { name: "MixBytes", pattern: /mixbytes/i, domains: ["mixbytes.io"] },
  { name: "Consensys Diligence", pattern: /consensys\s*diligence/i, domains: ["consensys.io", "diligence.consensys.net"] },
  { name: "Sherlock", pattern: /sherlock/i, domains: ["sherlock.xyz"] },
  { name: "Halborn", pattern: /halborn/i, domains: ["halborn.com"] },
  { name: "Quantstamp", pattern: /quantstamp/i, domains: ["quantstamp.com"] },
  { name: "Zellic", pattern: /zellic/i, domains: ["zellic.io"] },
  { name: "OtterSec", pattern: /otter\s*sec/i, domains: ["osec.io"] },
  { name: "CertiK", pattern: /certik/i, domains: ["certik.com"] },
];

const FETCH_TIMEOUT_MS = 15_000;
const MAX_AUDITOR_FETCHES = 4;
const USER_AGENT = "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)";

export interface SecurityAuditsDependencies {
  fetcher?: typeof fetch;
}

/** Bounded direct text fetch. Returns null on any failure; never throws. */
async function fetchPageText(url: string, fetcher: typeof fetch): Promise<string | null> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const text = await response.text();
    // 2MB bound keeps a hostile page from ballooning memory.
    return text.length > 2_000_000 ? text.slice(0, 2_000_000) : text;
  } catch {
    return null;
  }
}

const registrableHost = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const hostMatchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/** Outbound hrefs from raw HTML that land on one of the given domains. */
function outboundLinksTo(html: string, domains: string[]): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/href=["']?(https?:\/\/[^"'\s>]+)/gi)) {
    const host = registrableHost(match[1]);
    if (host && domains.some((domain) => hostMatchesDomain(host, domain))) links.push(match[1]);
  }
  return [...new Set(links)];
}

/** Strip tags/scripts to searchable text. Crude on purpose: name presence, not semantics. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

// A subject-name mention on an auditor's site only corroborates an
// engagement when the surrounding text reads like one. Auditors also write
// ABOUT projects (incident analyses, exploit postmortems); those mentions
// must never corroborate a security-engagement claim.
const ENGAGEMENT_CONTEXT = /\b(?:audit(?:s|ed|ing)?|review(?:s|ed)?|assessment|formal verification|verification|engagement|client|bounty|bounties|competition|contest)\b/i;
const ADVERSE_CONTEXT = /\b(?:exploit(?:s|ed)?|hack(?:s|ed)?|incident|post-?mortem|stolen|drained|rug(?:ged)?|scam)\b/i;

/**
 * Bounded excerpt around the first subject-name occurrence whose surrounding
 * window reads as a security engagement and not an incident writeup. Returns
 * null when no qualifying occurrence exists.
 */
function engagementExcerpt(text: string, needle: RegExp): string | null {
  const global = new RegExp(needle.source, "gi");
  for (const match of text.matchAll(global)) {
    if (match.index === undefined) continue;
    const start = Math.max(0, match.index - 240);
    const window = text.slice(start, match.index + match[0].length + 280);
    if (ENGAGEMENT_CONTEXT.test(window) && !ADVERSE_CONTEXT.test(window)) return window.trim();
  }
  return null;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Collect independent-audit evidence for a project.
 *
 * @param subjectName the project's verified name ("Aave"); the auditor page
 *   must contain it (word-bounded) for corroboration.
 * @param officialSite the project's verified official site, used for the
 *   /security convention candidate. Candidate pages are only trusted as
 *   SELF-attestation regardless of host, so a wrong candidate cannot verify
 *   anything by itself.
 */
export async function collectSecurityAudits(
  subjectName: string,
  officialSite: string | undefined,
  candidateUrls: string[],
  deps: SecurityAuditsDependencies = {},
): Promise<SecurityAuditsResult> {
  const fetcher = deps.fetcher ?? fetch;
  const capturedAt = new Date().toISOString();
  const name = subjectName.trim();
  const empty = (note: string): SecurityAuditsResult => ({
    available: false, note, securityPageUrl: null, selfAttested: [], corroborated: [], capturedAt,
  });
  if (name.length < 2) return empty("No subject name to corroborate against.");

  const conventionCandidates: string[] = [];
  if (officialSite) {
    try {
      const base = new URL(officialSite);
      conventionCandidates.push(new URL("/security", base).toString());
    } catch { /* not a URL; skip the convention candidate */ }
  }
  const candidates = [...new Set([...candidateUrls, ...conventionCandidates])].slice(0, 4);
  if (!candidates.length) return empty("No candidate security pages.");

  // URL-level attestation (no fetch). Blue chips publish audits as PDFs or
  // behind bot walls, so page fetches often return nothing (observed live:
  // Uniswap -> "No named security auditor found"). But the curated audit-link
  // URLS themselves carry the evidence: a link hosted on the auditor's OWN
  // domain, or naming a registry auditor in its path, attests the engagement
  // regardless of whether the document body is fetchable. These links come
  // from DeFiLlama's listing (candidateUrls), not the subject's prose, so the
  // subject cannot mint them by writing auditor names into its own page.
  const urlAttested = new Map<string, { auditor: (typeof AUDITOR_REGISTRY)[number]; auditorDomainLinks: string[] }>();
  for (const link of candidateUrls) {
    let parsed: URL;
    try { parsed = new URL(link); } catch { continue; }
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    let path = `${parsed.pathname}${parsed.search}`;
    try { path = decodeURIComponent(path); } catch { /* keep raw path */ }
    for (const auditor of AUDITOR_REGISTRY) {
      const domainHit = auditor.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
      const pathHit = auditor.pattern.test(path);
      if (!domainHit && !pathHit) continue;
      const current = urlAttested.get(auditor.name) ?? { auditor, auditorDomainLinks: [] };
      // Only auditor-domain-hosted links qualify as hop-2 corroboration
      // candidates; a path mention alone stays attestation-only.
      if (domainHit && !current.auditorDomainLinks.includes(link)) current.auditorDomainLinks.push(link);
      urlAttested.set(auditor.name, current);
    }
  }

  // Hop 1: the subject's pages name auditors (self-attestation). Audit
  // disclosures are commonly SPREAD across candidates -- DeFiLlama audit_links
  // typically point at one report per auditor -- so stopping at the first
  // matching page collapsed a Trail-of-Bits+ABDK+Certora protocol to a single
  // name (observed live: "1 auditors are named" for Uniswap). Scan every
  // bounded candidate and union the registry matches; the page with the most
  // matches is the primary security page.
  const matchedPages: Array<{ url: string; html: string; named: typeof AUDITOR_REGISTRY[number][] }> = [];
  for (const candidate of candidates) {
    const html = await fetchPageText(candidate, fetcher);
    if (!html) continue;
    const named = AUDITOR_REGISTRY.filter((auditor) => auditor.pattern.test(html));
    if (named.length) matchedPages.push({ url: candidate, html, named });
  }
  if (!matchedPages.length && !urlAttested.size) return empty("No fetchable security page or audit link named a known auditor.");

  const primary = matchedPages.length
    ? matchedPages.reduce((best, page) => (page.named.length > best.named.length ? page : best))
    : null;
  const securityPageUrl = primary?.url
    ?? [...urlAttested.values()].flatMap((entry) => entry.auditorDomainLinks)[0]
    ?? candidateUrls.find((link) => /^https?:\/\//i.test(link))
    ?? candidates[0];
  const named = AUDITOR_REGISTRY.filter((auditor) =>
    matchedPages.some((page) => page.named.includes(auditor)) || urlAttested.has(auditor.name));
  const selfAttested = named.map((auditor) => auditor.name);

  // Hop 2: the auditor's own domain must name the subject. Prefer the exact
  // outbound links from the security page; fall back to the auditor's site
  // search-free landing pages is deliberately NOT attempted (too weak).
  const subjectNeedle = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  const corroborated: AuditorEvidence[] = [];
  const usedAuditorUrls = new Set<string>();
  const fetchedPages = new Map<string, string | null>();
  let fetches = 0;
  for (const auditor of named) {
    // Outbound links come from the pages that actually named this auditor,
    // plus any curated audit link already hosted on the auditor's own domain
    // (that URL may itself corroborate if it fetches and names the subject).
    const outbound = [...new Set([
      ...matchedPages
        .filter((page) => page.named.includes(auditor))
        .flatMap((page) => outboundLinksTo(page.html, auditor.domains)),
      ...(urlAttested.get(auditor.name)?.auditorDomainLinks ?? []),
    ])].slice(0, 2);
    for (const link of outbound) {
      // One auditor page corroborates ONE claim: sister brands sharing a
      // domain (Spearbit/Cantina) must not each mint a fact from the same
      // page.
      if (usedAuditorUrls.has(link)) break;
      let html = fetchedPages.get(link);
      if (html === undefined) {
        if (fetches >= MAX_AUDITOR_FETCHES) break;
        fetches += 1;
        html = await fetchPageText(link, fetcher);
        fetchedPages.set(link, html);
      }
      if (!html) continue;
      const excerpt = engagementExcerpt(htmlToText(html), subjectNeedle);
      if (excerpt) {
        usedAuditorUrls.add(link);
        corroborated.push({ auditor: auditor.name, auditorUrl: link, excerpt: excerpt.slice(0, 320) });
        break;
      }
    }
  }

  return {
    available: true,
    note: corroborated.length
      ? `${corroborated.length} auditor${corroborated.length === 1 ? "" : "s"} confirmed on their own domains.`
      : "Security page names auditors; no auditor-domain confirmation succeeded.",
    securityPageUrl,
    selfAttested,
    corroborated,
    capturedAt,
  };
}
