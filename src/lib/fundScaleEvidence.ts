const SHA256_HEX = /^[a-f0-9]{64}$/i;
const CLAIM_ID = /^[A-Za-z0-9:_-]{8,180}$/;
const HANDLE = /^[A-Za-z0-9_]{2,30}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 5 * 60 * 1_000;
const AUM_MAX_AGE_MS = 731 * DAY_MS;
const AUM_CORROBORATION_WINDOW_MS = 90 * DAY_MS;

const SHARED_PUBLICATION_HOSTS = new Set([
  "amazonaws.com",
  "beacons.ai",
  "bio.link",
  "bio.site",
  "bit.ly",
  "blogspot.com",
  "blob.core.windows.net",
  "carrd.co",
  "discord.com",
  "discord.gg",
  "facebook.com",
  "github.com",
  "githubusercontent.com",
  "github.io",
  "gitlab.com",
  "gitbook.io",
  "hackmd.io",
  "instagram.com",
  "ipfs.io",
  "linktr.ee",
  "linkedin.com",
  "medium.com",
  "mirror.xyz",
  "arweave.net",
  "cloudflare-ipfs.com",
  "dweb.link",
  "netlify.app",
  "notion.site",
  "notion.so",
  "pages.dev",
  "paragraph.xyz",
  "pinata.cloud",
  "raw.githubusercontent.com",
  "docs.google.com",
  "drive.google.com",
  "dropbox.com",
  "box.com",
  "firebaseapp.com",
  "framer.app",
  "framer.website",
  "railway.app",
  "render.com",
  "sites.google.com",
  "storage.googleapis.com",
  "substack.com",
  "t.co",
  "t.me",
  "telegram.me",
  "threads.net",
  "tiktok.com",
  "tinyurl.com",
  "twitch.tv",
  "twitter.com",
  "vercel.app",
  "webflow.io",
  "wixsite.com",
  "wordpress.com",
  "x.com",
  "youtu.be",
  "youtube.com",
]);

const INDEPENDENT_PRESS_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "techcrunch.com",
  "fortune.com",
  "coindesk.com",
  "theblock.co",
  "decrypt.co",
  "blockworks.co",
  "venturebeat.com",
] as const;

const PUBLIC_SUFFIX_ONLY = new Set([
  "com", "org", "net", "edu", "gov", "io", "ai", "app", "co", "xyz",
  "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au",
  "co.nz", "com.br", "co.jp",
]);

const SECOND_LEVEL_PUBLIC_SUFFIX_LABELS = new Set([
  "ac", "asn", "co", "com", "edu", "firm", "gen", "go", "gov", "id", "ind", "ltd",
  "me", "mil", "net", "ne", "nom", "or", "org", "plc", "police", "res", "sch", "school",
]);

const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

type EvidenceRecord = Record<string, unknown>;

export interface FundScaleValidationContext {
  now?: Date;
  /** Canonical handle of the audited report subject. */
  subjectHandle?: string;
  /** Frozen provider profile from the same audit packet/report. */
  profile?: unknown;
}

const asRecord = (value: unknown): EvidenceRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as EvidenceRecord : null;

const comparable = (value: unknown): string => typeof value === "string"
  ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  : "";

const namesExactlyMatch = (left: unknown, right: unknown): boolean => {
  const a = comparable(left);
  const b = comparable(right);
  return Boolean(a && b && a === b);
};

const canonicalHandle = (value: unknown): string => typeof value === "string"
  ? value.trim().replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "").toLowerCase()
  : "";

const normalizedWords = (value: unknown): string => typeof value === "string"
  ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@_]+/g, " ").trim()
  : "";

const providerEntityNamesMatch = (left: unknown, right: unknown): boolean => {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 5
    && (longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`));
};

const regexEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const AFFILIATION_ROLE = "(?:founding |general |managing |research )?(?:partner|principal|investor|researcher|research|engineer|developer|employee|advisor|adviser|cto|chief technology officer|team member|team|lead|director|gp)|(?:co founder|cofounder|founder|ceo|chief executive officer|cio|chief investment officer|portfolio manager|managing director)";

const profileBioHasCurrentAffiliation = (profile: EvidenceRecord, value: EvidenceRecord): boolean => {
  const bio = normalizedWords(profile.bio);
  if (!bio) return false;
  const entity = normalizedWords(value.investorEntityName ?? value.fundName);
  const handle = canonicalHandle(value.investorEntityHandle);
  const aliases = [entity, handle].filter((alias, index, all) => Boolean(alias) && all.indexOf(alias) === index);
  const role = `(?:${AFFILIATION_ROLE})`;
  const affiliationLink = "(?:(?:at|with)\\s+|@\\s*)";
  return aliases.some((alias) => {
    const escaped = normalizedWords(alias).split(/\s+/).filter(Boolean).map(regexEscape).join("[^a-z0-9@_]+");
    if (!escaped) return false;
    const patterns = [
      new RegExp(`(?:${role})\\s+${affiliationLink}(?:the\\s+)?@?${escaped}(?=$|[^a-z0-9_])`, "gi"),
      new RegExp(`@?${escaped}[^a-z0-9_]+(?:${role})\\b`, "gi"),
      new RegExp(`\\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\\s+${affiliationLink}(?:the\\s+)?@?${escaped}(?=$|[^a-z0-9_])`, "gi"),
    ];
    return patterns.some((pattern) => [...bio.matchAll(pattern)].some((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const before = bio.slice(Math.max(0, start - 70), start);
      const after = bio.slice(end, Math.min(bio.length, end + 55));
      const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
      const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
      const lastEnded = endedMarkers.at(-1)?.index ?? -1;
      const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
      if (lastEnded >= 0 && lastCurrent < lastEnded) return false;
      const matchedContext = `${before.slice(-40)} ${match[0]}`;
      if (new RegExp(`\\b(?:not|never)\\s+(?:currently\\s+)?(?:an?\\s+)?(?:${AFFILIATION_ROLE})\\b`, "i").test(matchedContext)
        || /\b(?:no\s+(?:current\s+)?affiliation|not\s+affiliated|never\s+(?:worked|working))\b/i.test(matchedContext)
        || (/\b(?:not|never)(?:\s+an?)?\s*$/i.test(before)
          && new RegExp(`(?:${role})\\b`, "i").test(match[0]))) return false;
      return !/^.{0,45}\b(?:former|formerly|no longer|left|departed|retired|until|through)\b/i.test(after);
    }));
  });
};

const profileBioHasCurrentHandleAffiliation = (profile: EvidenceRecord, value: unknown): boolean => {
  const bio = normalizedWords(profile.bio);
  const handle = canonicalHandle(value);
  if (!bio || !HANDLE.test(handle)) return false;
  const role = `(?:${AFFILIATION_ROLE})`;
  const pattern = new RegExp(`@${regexEscape(handle)}(?=$|[^a-z0-9_])`, "gi");
  for (const match of bio.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = bio.slice(Math.max(0, start - 100), start);
    const after = bio.slice(end, Math.min(bio.length, end + 70));
    const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
    const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
    const lastEnded = endedMarkers.at(-1)?.index ?? -1;
    const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
    if (lastEnded >= 0 && lastCurrent < lastEnded) continue;
    if (/^[^.;|]{0,55}\b(?:no longer|left|departed|retired|until|through)\b/i.test(after)) continue;
    if (new RegExp(`\\b(?:not|never)\\s+(?:currently\\s+)?(?:an?\\s+)?(?:${AFFILIATION_ROLE})\\b[^.;|]{0,35}$`, "i").test(before)
      || /\b(?:no\s+(?:current\s+)?affiliation|not\s+affiliated|never\s+(?:worked|working))\b[^.;|]{0,35}$/i.test(before)) continue;
    if (/\b(?:not|never)(?:\s+an?)?\s*$/i.test(before)
      && new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) continue;
    if (new RegExp(`${role}\\s*(?:(?:at|with)\\s*)?$`, "i").test(before)) return true;
    if (/\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\s*(?:(?:at|with)\s*)?$/i.test(before)) return true;
    if (new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) return true;
  }
  return false;
};

const cleanHost = (value: string): string => value.replace(/^www\./i, "").toLowerCase();

const isSharedPublicationHost = (host: string): boolean => {
  const clean = cleanHost(host);
  return [...SHARED_PUBLICATION_HOSTS].some((candidate) => clean === candidate || clean.endsWith(`.${candidate}`));
};

const isPublicHostname = (value: string): boolean => {
  const host = cleanHost(value).replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !host
    || host.includes(":")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    || host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".test")
    || host.endsWith(".invalid")
  ) return false;
  const labels = host.split(".");
  return labels.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    && /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels.at(-1) ?? "");
};

export const isCredibleOfficialDomain = (value: string): boolean => {
  const host = cleanHost(value).replace(/\.$/, "");
  if (
    !isPublicHostname(host)
    || PUBLIC_SUFFIX_ONLY.has(host)
    || isSharedPublicationHost(host)
    || INDEPENDENT_PRESS_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))
    || ["sec.gov", "fca.org.uk", "gov.uk", "companieshouse.gov.uk", "asic.gov.au", "sedarplus.ca"]
      .some((candidate) => host === candidate || host.endsWith(`.${candidate}`))
  ) return false;
  const labels = host.split(".");
  return !(labels.length === 2 && labels[1].length === 2 && SECOND_LEVEL_PUBLIC_SUFFIX_LABELS.has(labels[0]));
};

const listedHost = (host: string, list: readonly string[]): boolean =>
  list.some((candidate) => hostMatches(host, candidate));

const boundedWebUrl = (value: unknown): URL | null => {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !url.hostname
      || !isPublicHostname(url.hostname)
      || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))
    ) return null;
    return url;
  } catch {
    return null;
  }
};

const profileWebsiteHost = (value: unknown): string | null => {
  return canonicalOfficialWebsite(value)?.domain ?? null;
};

export interface OfficialWebsiteScope {
  domain: string;
  canonicalUrl: string;
}

export const canonicalPublicProfileWebsite = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = cleanHost(url.hostname).replace(/\.$/, "");
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || url.port
      || !isPublicHostname(host)
      || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))
    ) return null;
    const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return `https://${host}${pathname === "/" ? "/" : pathname}`;
  } catch {
    return null;
  }
};

/**
 * Canonicalize a provider-returned official website without retaining URL
 * credentials, fragments, or query material. A non-root path is retained as a
 * conservative ownership scope: on an otherwise unknown hosted publisher it
 * is the only boundary separating one account from another.
 */
export const canonicalOfficialWebsite = (value: unknown): OfficialWebsiteScope | null => {
  const canonical = canonicalPublicProfileWebsite(value);
  if (!canonical) return null;
  try {
    const url = new URL(canonical);
    const domain = cleanHost(url.hostname).replace(/\.$/, "");
    if (!isCredibleOfficialDomain(domain)) return null;
    return {
      domain,
      canonicalUrl: canonical,
    };
  } catch {
    return null;
  }
};

export const sourceMatchesOfficialWebsiteScope = (sourceValue: unknown, profileWebsite: unknown): boolean => {
  const source = sourceValue instanceof URL ? sourceValue : boundedWebUrl(sourceValue);
  const scope = canonicalOfficialWebsite(profileWebsite);
  if (!source || !scope || !hostMatches(source.hostname, scope.domain)) return false;
  const scopeUrl = new URL(scope.canonicalUrl);
  if (scopeUrl.pathname === "/") return true;
  const sourcePath = source.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  const scopePath = scopeUrl.pathname.replace(/\/$/, "");
  return cleanHost(source.hostname) === scope.domain
    && (sourcePath === scopePath || sourcePath.startsWith(`${scopePath}/`));
};

const validatedPacketProfile = (
  context: FundScaleValidationContext,
  now: Date,
  artifactCapturedAt: Date,
): EvidenceRecord | null => {
  const profile = asRecord(context.profile);
  const expectedHandle = canonicalHandle(context.subjectHandle);
  const profileCapturedAt = validDate(profile?.profile_captured_at);
  if (
    !profile
    || !expectedHandle
    || canonicalHandle(profile.handle) !== expectedHandle
    || profile.profile_collection_state !== "resolved"
    || profile.profile_provider !== "twitterapi"
    || !profileCapturedAt
    || profileCapturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS
    || profileCapturedAt.getTime() > artifactCapturedAt.getTime() + CLOCK_SKEW_MS
    || artifactCapturedAt.getTime() - profileCapturedAt.getTime() > 7 * DAY_MS
  ) return null;
  return profile;
};

const hostMatches = (host: string, expected: string): boolean => {
  const left = cleanHost(host);
  const right = cleanHost(expected);
  return left === right || left.endsWith(`.${right}`);
};

const registrableApprox = (host: string): string => {
  const parts = cleanHost(host).split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffixes = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.nz", "co.jp"]);
  const tail = parts.slice(-2).join(".");
  return twoLevelSuffixes.has(tail) ? parts.slice(-3).join(".") : tail;
};

const validDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const isAumMetric = (metric: unknown): boolean => metric === "regulatory_aum" || metric === "reported_aum";

const isRecordSpecificRegulatoryUrl = (url: URL): boolean => {
  const host = cleanHost(url.hostname);
  const path = url.pathname;
  if (host === "sec.gov" || host.endsWith(".sec.gov")) {
    return /^\/Archives\/edgar\/data\/\d{1,12}\/\d{18}\/[^/]+\.(?:html?|txt|xml|json)$/i.test(path)
      || /^\/firm\/summary\/\d+\/?$/i.test(path);
  }
  if (host === "fca.org.uk" || host.endsWith(".fca.org.uk")) {
    return /\/(?:firm|individual)\/details\/\d+/i.test(path) || /\/services\/v1\/(?:firm|individual)\//i.test(path);
  }
  if (
    host === "companieshouse.gov.uk"
    || host.endsWith(".companieshouse.gov.uk")
    || host === "find-and-update.company-information.service.gov.uk"
    || host === "api.company-information.service.gov.uk"
  ) {
    return /\/company\/[A-Z0-9]{6,12}(?:\/|$)/i.test(path);
  }
  return false;
};

const hasCurrentAffiliationProof = (
  value: EvidenceRecord,
  capturedAt: Date,
  now: Date,
  profile?: EvidenceRecord | null,
): boolean => {
  const subjectName = comparable(value.subjectName);
  const handle = typeof value.subjectHandle === "string" ? value.subjectHandle.trim().replace(/^@/, "") : "";
  const source = boundedWebUrl(value.attributionSourceUrl);
  const sourceHash = typeof value.attributionSourceContentHash === "string" ? value.attributionSourceContentHash : "";
  const affiliationCapturedAt = validDate(value.attributionCapturedAt);
  if (
    !subjectName
    || !HANDLE.test(handle)
    || !source
    || !SHA256_HEX.test(sourceHash)
    || !affiliationCapturedAt
  ) return false;
  if (
    affiliationCapturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS
    || affiliationCapturedAt.getTime() > capturedAt.getTime() + CLOCK_SKEW_MS
    || capturedAt.getTime() - affiliationCapturedAt.getTime() > 7 * DAY_MS
  ) return false;
  const host = cleanHost(source.hostname);
  const path = source.pathname.split("/").filter(Boolean);
  if (value.attributionSourceKind !== "provider_profile") return false;
  const sourceBound = (host === "x.com" || host === "twitter.com")
      && path.length === 1
      && path[0].toLowerCase() === handle.toLowerCase()
      && !source.search
      && !source.hash;
  if (!sourceBound) return false;
  if (!profile) return true;
  const profileCapturedAt = validDate(profile.profile_captured_at);
  return Boolean(
    profileCapturedAt
    && Math.abs(profileCapturedAt.getTime() - affiliationCapturedAt.getTime()) <= 1_000
    && profileBioHasCurrentAffiliation(profile, value),
  );
};

const hasOfficialInvestorDomainProof = (
  value: EvidenceRecord,
  capturedAt: Date,
  now: Date,
  profile: EvidenceRecord | null,
): boolean => {
  const officialDomain = typeof value.investorEntityDomain === "string"
    ? cleanHost(value.investorEntityDomain)
    : "";
  const source = boundedWebUrl(value.investorDomainSourceUrl);
  const sourceHash = typeof value.investorDomainSourceContentHash === "string"
    ? value.investorDomainSourceContentHash
    : "";
  const domainCapturedAt = validDate(value.investorDomainCapturedAt);
  const fundHandle = canonicalHandle(value.investorEntityHandle);
  const profileName = typeof value.investorDomainProfileName === "string"
    ? value.investorDomainProfileName.trim()
    : "";
  const profileWebsite = typeof value.investorDomainProfileWebsite === "string"
    ? value.investorDomainProfileWebsite.trim()
    : "";
  const profileWebsiteUrl = boundedWebUrl(profileWebsite);
  if (
    value.investorDomainSourceKind !== "provider_profile"
    || !isCredibleOfficialDomain(officialDomain)
    || !source
    || !SHA256_HEX.test(sourceHash)
    || !domainCapturedAt
    || !fundHandle
    || !profileName
    || !profileWebsite
    || !profileWebsiteUrl
    || profileWebsiteUrl.search
    || profileWebsiteUrl.hash
    || !providerEntityNamesMatch(profileName, value.investorEntityName)
    || profileWebsiteHost(profileWebsite) !== officialDomain
    || !sourceMatchesOfficialWebsiteScope(value.sourceUrl, profileWebsite)
    || !profile
    || !profileBioHasCurrentHandleAffiliation(profile, fundHandle)
  ) return false;
  if (
    domainCapturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS
    || domainCapturedAt.getTime() > capturedAt.getTime() + CLOCK_SKEW_MS
    || capturedAt.getTime() - domainCapturedAt.getTime() > 7 * DAY_MS
  ) return false;
  const host = cleanHost(source.hostname);
  const path = source.pathname.split("/").filter(Boolean);
  return (host === "x.com" || host === "twitter.com")
    && path.length === 1
    && path[0].toLowerCase() === fundHandle
    && !source.search
    && !source.hash;
};

const structurallyStrictFundScaleArtifact = (
  value: EvidenceRecord,
  now: Date,
  context: FundScaleValidationContext,
): boolean => {
  if (value.kind !== "fund_scale" || value.provider !== "fund-scale-web" || value.match !== "fund_scale_confirmed") return false;
  const sourceUrl = boundedWebUrl(value.sourceUrl);
  const capturedAt = validDate(value.capturedAt);
  const fundName = comparable(value.fundName);
  const investorName = comparable(value.investorEntityName);
  const amount = value.fundSizeUsd;
  const attribution = value.attribution;
  const sourceClass = value.sourceClass;
  const metric = value.fundScaleMetric;
  const qualifier = value.fundAmountQualifier;
  const basis = value.fundScaleBasis;
  const temporalState = value.fundScaleTemporalState;
  const claimId = typeof value.fundScaleClaimId === "string" ? value.fundScaleClaimId : "";
  if (
    !SHA256_HEX.test(typeof value.contentHash === "string" ? value.contentHash : "")
    || !SHA256_HEX.test(typeof value.sourceContentHash === "string" ? value.sourceContentHash : "")
    || !sourceUrl
    || !capturedAt
    || capturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS
    || typeof amount !== "number"
    || !Number.isSafeInteger(amount)
    || amount < 100_000
    || amount > 10_000_000_000_000
    || !fundName
    || !investorName
    || !namesExactlyMatch(value.fundName, value.investorEntityName)
    || (attribution !== "direct_subject" && attribution !== "affiliated_fund")
    || !["first_party_subject", "first_party_investor", "public_primary", "independent_press"].includes(String(sourceClass))
    || !["regulatory_aum", "reported_aum", "fund_vehicle", "first_close", "final_close"].includes(String(metric))
    || !["exact", "at_least", "approximate"].includes(String(qualifier))
    || !["regulatory", "manager_reported", "press_corroborated"].includes(String(basis))
    || !CLAIM_ID.test(claimId)
  ) return false;

  const expectedSubjectHandle = context.subjectHandle;
  if (expectedSubjectHandle) {
    const observedHandle = canonicalHandle(value.subjectHandle);
    if (!observedHandle || observedHandle !== canonicalHandle(expectedSubjectHandle)) return false;
  }
  const profile = expectedSubjectHandle ? validatedPacketProfile(context, now, capturedAt) : null;
  if (expectedSubjectHandle && !profile) return false;

  if (attribution === "direct_subject") {
    if (!namesExactlyMatch(value.subjectName, value.fundName)) return false;
    if (profile && ![profile.resolved_name, profile.display_name].some((name) => namesExactlyMatch(name, value.fundName))) return false;
  } else if (!hasCurrentAffiliationProof(value, capturedAt, now, profile)) return false;

  if (sourceClass === "first_party_subject" || sourceClass === "first_party_investor") {
    const officialDomain = typeof value.investorEntityDomain === "string" ? cleanHost(value.investorEntityDomain) : "";
    if (
      !isCredibleOfficialDomain(officialDomain)
      || !hostMatches(sourceUrl.hostname, officialDomain)
      || basis !== "manager_reported"
      || metric === "regulatory_aum"
      || (sourceClass === "first_party_subject") !== (attribution === "direct_subject")
    ) return false;
    if (sourceClass === "first_party_investor") {
      if (!hasOfficialInvestorDomainProof(value, capturedAt, now, profile)) return false;
    } else if (profile && (
      profileWebsiteHost(profile.website) !== officialDomain
      || !sourceMatchesOfficialWebsiteScope(sourceUrl, profile.website)
    )) return false;
  } else if (sourceClass === "public_primary") {
    if (basis !== "regulatory" || metric !== "regulatory_aum" || !isRecordSpecificRegulatoryUrl(sourceUrl)) return false;
  } else if (
    basis !== "press_corroborated"
    || metric === "regulatory_aum"
    || !listedHost(sourceUrl.hostname, INDEPENDENT_PRESS_HOSTS)
    || typeof value.fundScaleSourceCount !== "number"
    || !Number.isInteger(value.fundScaleSourceCount)
    || value.fundScaleSourceCount < 2
  ) return false;

  if (isAumMetric(metric)) {
    const asOf = validDate(value.fundScaleAsOf);
    if (
      temporalState !== "current"
      || !asOf
      || asOf.getTime() > capturedAt.getTime() + DAY_MS
      || capturedAt.getTime() - asOf.getTime() > AUM_MAX_AGE_MS
    ) return false;
  } else {
    if (temporalState !== "fixed_historical") return false;
    if (typeof value.fundVehicle !== "string" || !comparable(value.fundVehicle)) return false;
  }
  if (metric === "first_close" && qualifier !== "at_least") return false;
  return true;
};

const compatiblePressClaim = (left: EvidenceRecord, right: EvidenceRecord): boolean => {
  if (
    left.fundScaleClaimId !== right.fundScaleClaimId
    || left.fundScaleMetric !== right.fundScaleMetric
    || left.attribution !== right.attribution
    || !namesExactlyMatch(left.fundName, right.fundName)
    || !namesExactlyMatch(left.investorEntityName, right.investorEntityName)
  ) return false;
  const leftAmount = left.fundSizeUsd as number;
  const rightAmount = right.fundSizeUsd as number;
  const tolerance = isAumMetric(left.fundScaleMetric) ? 0.1 : 0.01;
  if (Math.abs(leftAmount - rightAmount) / Math.max(leftAmount, rightAmount) > tolerance) return false;
  if (!isAumMetric(left.fundScaleMetric)) return comparable(left.fundVehicle) === comparable(right.fundVehicle);
  const leftAsOf = validDate(left.fundScaleAsOf);
  const rightAsOf = validDate(right.fundScaleAsOf);
  return Boolean(leftAsOf && rightAsOf && Math.abs(leftAsOf.getTime() - rightAsOf.getTime()) <= AUM_CORROBORATION_WINDOW_MS);
};

/**
 * Browser-safe scoring gate shared by the server evidence catalog and report UI.
 * Independent press is verified only when the frozen packet retains two
 * compatible, distinct-domain and distinct-content source artifacts.
 */
export function isStrictFundScaleArtifact(
  value: unknown,
  peers: readonly unknown[] = [],
  context: FundScaleValidationContext = {},
): boolean {
  const now = context.now ?? new Date();
  const record = asRecord(value);
  if (
    !record
    || !Number.isFinite(now.getTime())
    || !structurallyStrictFundScaleArtifact(record, now, context)
  ) return false;
  if (record.sourceClass !== "independent_press") return true;
  if (typeof record.fundScaleSourceCount !== "number" || record.fundScaleSourceCount < 2) return false;

  const compatible = [record, ...peers.map(asRecord).filter((peer): peer is EvidenceRecord => Boolean(peer))]
    .filter((peer, index, rows) => rows.indexOf(peer) === index)
    .filter((peer) => peer.sourceClass === "independent_press"
      && structurallyStrictFundScaleArtifact(peer, now, context)
      && compatiblePressClaim(record, peer));
  const domains = new Set<string>();
  const hashes = new Set<string>();
  const prose = new Set<string>();
  for (const peer of compatible) {
    const source = boundedWebUrl(peer.sourceUrl);
    if (!source) continue;
    domains.add(registrableApprox(source.hostname));
    hashes.add(String(peer.sourceContentHash).toLowerCase());
    const excerpt = comparable(peer.excerpt);
    if (excerpt) prose.add(excerpt);
  }
  return domains.size >= 2 && hashes.size >= 2 && prose.size >= 2;
}
