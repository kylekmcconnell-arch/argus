// Security-audit collector: bounded counterparty corroboration.
//
// A project's own /security page listing "Trail of Bits, CertiK, ..." is
// SELF-ATTESTATION: any scam can publish that list, so a first-party page can
// never mint a verified audit fact by itself. This collector therefore works
// in two hops:
//
//   1. Fetch the subject's security/audits page (candidates: DeFiLlama
//      audit_links plus the {officialSite}/security convention) and extract
//      which KNOWN auditors it names, plus outbound links into each auditor's
//      own domain.
//   2. Fetch the auditor-domain page and require explicit audit context near
//      the subject name plus an official-domain or canonical-contract anchor.
//      Everything else stays an unverified lead, visible for transparency and
//      excluded from scoring gates.
//
// All fetches are bounded direct requests (no article-recovery retry ladder)
// and the collector never throws.

import { captureTimestamp } from "../captureTime";

export interface AuditorEvidence {
  auditor: string;
  /** Page on the auditor's own domain that carries the bounded evidence. */
  auditorUrl: string;
  /** Bounded excerpt with explicit audit context around the subject name. */
  excerpt: string;
  /** Non-name subject identity that the same local evidence window matched. */
  matchedIdentityAnchor:
    | { type: "official_domain"; value: string }
    | { type: "canonical_contract"; value: string };
}

export interface SecurityAuditsResult {
  available: boolean;
  note: string;
  /** Primary audit-discovery page. It is not necessarily first-party. */
  securityPageUrl: string | null;
  /** Legacy union of unverified auditor leads from every bounded candidate. */
  selfAttested: string[];
  /** Exact origin of each unverified auditor lead. */
  attestations: Array<{
    auditor: string;
    origin: "subject_page" | "curated_audit_link";
    sourceUrl: string;
  }>;
  /** Auditor claims confirmed by audit context plus canonical identity. */
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
  /** Verified canonical token or protocol contract supplied by orchestration. */
  canonicalContractAddress?: string;
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

const urlIdentityText = (rawUrl: string): string => {
  const addresses = rawUrl.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  const host = registrableHost(rawUrl.replace(/[),.;]+$/, ""));
  return ` ${[host, ...addresses].filter(Boolean).join(" ")} `;
};

/** Strip tags/scripts while retaining only identity-bearing URL tokens. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, (_tag, href: string) => urlIdentityText(href))
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => urlIdentityText(url))
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

// Only explicit audit work qualifies. A client list, generic engagement,
// bounty, competition, or contest does not establish that an audit happened.
const EXPLICIT_AUDIT_CONTEXT = /\b(?:audit(?:s|ed|ing)?|security\s+(?:review|reviews|assessment|assessments)|formal\s+verification)\b/i;
const ADVERSE_CONTEXT = /\b(?:exploit(?:s|ed)?|hack(?:s|ed)?|incident|post-?mortem|stolen|drained|rug(?:ged)?|scam)\b/i;

type AuditorIdentityAnchor = AuditorEvidence["matchedIdentityAnchor"];

const domainLiteralPattern = (host: string): RegExp => new RegExp(
  `(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*${escapeRegExp(host)}(?=$|[^a-z0-9.-]|\\.(?:\\s|$))`,
  "i",
);

const contractLiteralPattern = (address: string): RegExp => new RegExp(
  `(?:^|[^A-Za-z0-9])${escapeRegExp(address)}(?=$|[^A-Za-z0-9])`,
  /^0x[a-fA-F0-9]+$/.test(address) ? "i" : "",
);

function matchedIdentityAnchor(
  window: string,
  officialHost: string | null,
  canonicalContractAddress: string | undefined,
): AuditorIdentityAnchor | null {
  const contract = canonicalContractAddress?.trim();
  if (contract && contract.length >= 8 && contractLiteralPattern(contract).test(window)) {
    return { type: "canonical_contract", value: contract };
  }
  if (officialHost && domainLiteralPattern(officialHost).test(window)) {
    return { type: "official_domain", value: officialHost };
  }
  return null;
}

/**
 * Bounded excerpt around the first subject-name occurrence whose local window
 * states explicit audit work, avoids incident-only prose, and carries a
 * canonical non-name identity anchor. Returns null otherwise.
 */
function engagementEvidence(
  text: string,
  needle: RegExp,
  officialHost: string | null,
  canonicalContractAddress: string | undefined,
): { excerpt: string; matchedIdentityAnchor: AuditorIdentityAnchor } | null {
  const global = new RegExp(needle.source, "gi");
  for (const match of text.matchAll(global)) {
    if (match.index === undefined) continue;
    const start = Math.max(0, match.index - 480);
    const window = text.slice(start, match.index + match[0].length + 480);
    if (!EXPLICIT_AUDIT_CONTEXT.test(window) || ADVERSE_CONTEXT.test(window)) continue;
    const identityAnchor = matchedIdentityAnchor(window, officialHost, canonicalContractAddress);
    if (!identityAnchor) continue;
    // Persist the same bounded proof window that passed the rule. A shorter
    // name-only excerpt can omit the audit phrase or identity anchor and make
    // the corroboration impossible to replay from the frozen report.
    return { excerpt: window.trim().slice(0, 1_200), matchedIdentityAnchor: identityAnchor };
  }
  return null;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Collect independent-audit evidence for a project.
 *
 * @param subjectName the project's verified name ("Aave"); the auditor page
 *   must contain it in explicit audit context for corroboration.
 * @param officialSite the project's verified official site, used for the
 *   /security convention candidate and as a non-name identity anchor.
 */
export async function collectSecurityAudits(
  subjectName: string,
  officialSite: string | undefined,
  candidateUrls: string[],
  deps: SecurityAuditsDependencies = {},
): Promise<SecurityAuditsResult> {
  const fetcher = deps.fetcher ?? fetch;
  const capturedAt = captureTimestamp();
  const name = subjectName.trim();
  const officialHost = officialSite ? registrableHost(officialSite) : null;
  const empty = (note: string): SecurityAuditsResult => ({
    available: false, note, securityPageUrl: null, selfAttested: [], attestations: [], corroborated: [], capturedAt,
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

  // URL-level lead discovery (no fetch). Blue chips publish audits as PDFs or
  // behind bot walls, so page fetches often return nothing (observed live:
  // Uniswap -> "No named security auditor found"). But the curated audit-link
  // URLS themselves carry the evidence: a link hosted on the auditor's OWN
  // domain, or naming a registry auditor in its path, identifies an auditor
  // lead regardless of whether the document body is fetchable. URL shape never
  // establishes an engagement and cannot enter corroborated evidence alone.
  const urlLeads = new Map<string, {
    auditor: (typeof AUDITOR_REGISTRY)[number];
    sourceLinks: string[];
    auditorDomainLinks: string[];
  }>();
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
      const current = urlLeads.get(auditor.name) ?? { auditor, sourceLinks: [], auditorDomainLinks: [] };
      if (!current.sourceLinks.includes(link)) current.sourceLinks.push(link);
      // Only auditor-domain-hosted links qualify as hop-2 corroboration
      // candidates; a path mention alone stays attestation-only.
      if (domainHit && !current.auditorDomainLinks.includes(link)) current.auditorDomainLinks.push(link);
      urlLeads.set(auditor.name, current);
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
  if (!matchedPages.length && !urlLeads.size) return empty("No fetchable security page or audit link named a known auditor.");

  const primary = matchedPages.length
    ? matchedPages.reduce((best, page) => (page.named.length > best.named.length ? page : best))
    : null;
  const securityPageUrl = primary?.url
    ?? [...urlLeads.values()].flatMap((entry) => entry.auditorDomainLinks)[0]
    ?? candidateUrls.find((link) => /^https?:\/\//i.test(link))
    ?? candidates[0];
  const named = AUDITOR_REGISTRY.filter((auditor) =>
    matchedPages.some((page) => page.named.includes(auditor)) || urlLeads.has(auditor.name));
  const selfAttested = named.map((auditor) => auditor.name);
  const isSubjectPage = (url: string): boolean => {
    const host = registrableHost(url);
    return Boolean(host && officialHost && (
      host === officialHost
      || host.endsWith(`.${officialHost}`)
      || officialHost.endsWith(`.${host}`)
    ));
  };
  const attestations: SecurityAuditsResult["attestations"] = [];
  const seenAttestations = new Set<string>();
  const addAttestation = (
    auditor: string,
    origin: SecurityAuditsResult["attestations"][number]["origin"],
    sourceUrl: string,
  ) => {
    const key = `${auditor}\n${origin}\n${sourceUrl}`;
    if (seenAttestations.has(key)) return;
    seenAttestations.add(key);
    attestations.push({ auditor, origin, sourceUrl });
  };
  for (const auditor of named) {
    for (const page of matchedPages.filter((candidate) => candidate.named.includes(auditor))) {
      addAttestation(auditor.name, isSubjectPage(page.url) ? "subject_page" : "curated_audit_link", page.url);
    }
    for (const link of urlLeads.get(auditor.name)?.sourceLinks ?? []) {
      addAttestation(auditor.name, "curated_audit_link", link);
    }
  }
  attestations.sort((left, right) =>
    left.auditor.localeCompare(right.auditor)
    || left.origin.localeCompare(right.origin)
    || left.sourceUrl.localeCompare(right.sourceUrl),
  );

  // Hop 2: the auditor's own page must carry explicit audit context, the
  // subject name, and a canonical identity anchor in one bounded window.
  // Search-free landing-page fallback is deliberately not attempted.
  const subjectNeedle = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  const corroborated: AuditorEvidence[] = [];
  const usedAuditorUrls = new Set<string>();
  const fetchedPages = new Map<string, string | null>();
  let fetches = 0;
  for (const auditor of named) {
    // Outbound links come from the pages that actually named this auditor,
    // plus any curated audit link already hosted on the auditor's own domain
    // (that URL can corroborate only if its body passes every content check).
    const outbound = [...new Set([
      ...matchedPages
        .filter((page) => page.named.includes(auditor))
        .flatMap((page) => outboundLinksTo(page.html, auditor.domains)),
      ...(urlLeads.get(auditor.name)?.auditorDomainLinks ?? []),
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
      const match = engagementEvidence(
        htmlToText(html),
        subjectNeedle,
        officialHost,
        deps.canonicalContractAddress,
      );
      if (match) {
        usedAuditorUrls.add(link);
        corroborated.push({
          auditor: auditor.name,
          auditorUrl: link,
          excerpt: match.excerpt,
          matchedIdentityAnchor: match.matchedIdentityAnchor,
        });
        break;
      }
    }
  }

  return {
    available: true,
    note: corroborated.length
      ? `${corroborated.length} auditor${corroborated.length === 1 ? "" : "s"} confirmed with explicit audit context and a canonical identity anchor on their own domains.`
      : "Audit discovery sources name auditors; no auditor-domain confirmation succeeded.",
    securityPageUrl,
    selfAttested,
    attestations,
    corroborated,
    capturedAt,
  };
}
