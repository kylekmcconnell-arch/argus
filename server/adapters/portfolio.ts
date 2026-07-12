import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { PortfolioLead, SourceArtifact } from "../../src/data/evidence";
import { env } from "../config";
import { recordCall } from "../cost";
import { fetchPublicText, type PublicTextDocument, type PublicTextResult } from "../publicWeb";
import { discoverInvestorEvidenceText } from "./investorDiscovery";
import { getProfile } from "./x";
import type { AdapterRunResult, CollectContext } from "./types";

const MAX_CANDIDATES = 10;
const MAX_SOURCES_PER_CANDIDATE = 3;

const PRIMARY_HOSTS = [
  "sec.gov",
  "fca.org.uk",
  "gov.uk",
  "companieshouse.gov.uk",
  "asic.gov.au",
  "sedarplus.ca",
] as const;

const PRESS_HOSTS = [
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

// A path or subdomain on one of these services is controlled by an account,
// not by ownership of the parent domain. Treating it as an official investor
// domain would let a model-supplied Medium, Linktree, or free-hosting URL turn
// arbitrary copy into first-party evidence.
const SHARED_WEBSITE_HOSTS = [
  "amazonaws.com",
  "beacons.ai",
  "bio.link",
  "bio.site",
  "bit.ly",
  "blogspot.com",
  "blob.core.windows.net",
  "carrd.co",
  "github.io",
  "gitbook.io",
  "linktr.ee",
  "medium.com",
  "netlify.app",
  "notion.site",
  "notion.so",
  "pages.dev",
  "sites.google.com",
  "storage.googleapis.com",
  "substack.com",
  "t.co",
  "tinyurl.com",
  "twitter.com",
  "vercel.app",
  "webflow.io",
  "wixsite.com",
  "wordpress.com",
  "x.com",
] as const;

const PROFILE_AFFILIATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const PROFILE_AFFILIATION_CLOCK_SKEW_MS = 5 * 60 * 1_000;

// Reject, rather than redact and persist, signed or credential-bearing URLs.
// Keep this aligned with the provenance boundary in api/_provenance.ts.
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

type PortfolioSourceClass = NonNullable<SourceArtifact["sourceClass"]>;

export interface PortfolioCollectorDependencies {
  discover?: (ctx: CollectContext) => Promise<PortfolioLead[] | null>;
  fetchSource?: (url: string) => Promise<PublicTextResult>;
  resolveProjectDomain?: (lead: PortfolioLead) => Promise<string | undefined>;
  resolveInvestorDomain?: (lead: PortfolioLead, entity: PortfolioInvestorEntity) => Promise<string | undefined>;
  lookupProfile?: typeof getProfile;
  now?: () => Date;
}

export interface PortfolioInvestorEntity {
  name: string;
  aliases: string[];
  handle?: string;
  handleTrusted: boolean;
  domain?: string;
  attribution: "direct_subject" | "affiliated_fund";
  entityType: "person" | "organization";
  subjectHandle?: string;
  attributionSourceUrl?: string;
  attributionSourceContentHash?: string;
  attributionCapturedAt?: string;
  attributionSourceKind?: "provider_profile" | "verified_venture";
}

const clean = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const hostMatches = (host: string, expected: string): boolean => {
  const left = host.replace(/^www\./i, "").toLowerCase();
  const right = expected.replace(/^www\./i, "").toLowerCase();
  // A source may be on an exact official host or one of its subdomains. The
  // reverse is unsafe: medium.com is not first-party merely because the
  // verified website is fund.medium.com.
  return left === right || left.endsWith(`.${right}`);
};

const listedHost = (host: string, list: readonly string[]): boolean =>
  list.some((candidate) => hostMatches(host, candidate));

export function domainFromWebsite(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !host
      || isIP(host)
      || host === "localhost"
      || host.endsWith(".local")
      || host.endsWith(".internal")
      || listedHost(host, SHARED_WEBSITE_HOSTS)
    ) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

function safeCandidateUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !host
      || isIP(host)
      || host === "localhost"
      || host.endsWith(".local")
      || host.endsWith(".internal")
    ) return null;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function relationshipValue(value: unknown): "invested_in" {
  // All supported portfolio verbs normalize to the graph's single durable edge.
  // Stage/role nuance remains in the source excerpt rather than inventing an
  // ontology from model output.
  void value;
  return "invested_in";
}

export function parsePortfolioCandidates(text: string): PortfolioLead[] | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const rows = (payload as Record<string, unknown>).investments;
  if (!Array.isArray(rows)) return null;

  const leads: PortfolioLead[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const projectName = clean(row.project, 120);
    if (!projectName) continue;
    const sources: { url: string; title?: string }[] = [];
    const rawSources = Array.isArray(row.sources) ? row.sources : [];
    for (const candidate of rawSources) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const source = candidate as Record<string, unknown>;
      const url = safeCandidateUrl(source.url);
      if (!url) continue;
      sources.push({ url, ...(clean(source.title, 180) ? { title: clean(source.title, 180) } : {}) });
    }
    const singularUrl = safeCandidateUrl(row.source_url);
    if (singularUrl) sources.push({
      url: singularUrl,
      ...(clean(row.source_title, 180) ? { title: clean(row.source_title, 180) } : {}),
    });
    const uniqueSources = sources.filter((source, index) =>
      sources.findIndex((candidate) => candidate.url === source.url) === index,
    ).slice(0, MAX_SOURCES_PER_CANDIDATE);
    const investorEntityName = clean(row.investor_entity, 120);
    const attribution = row.attribution === "affiliated_fund" ? "affiliated_fund" : row.attribution === "direct_subject" ? "direct_subject" : undefined;
    const key = `${investorEntityName?.toLowerCase() ?? ""}::${attribution ?? ""}::${projectName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const projectHandle = clean(row.project_x_handle ?? row.x_handle, 40)?.replace(/^@/, "");
    const projectDomain = domainFromWebsite(clean(row.project_domain ?? row.domain, 300));
    const investorHandle = clean(row.investor_x_handle, 40)?.replace(/^@/, "");
    const contract = clean(row.contract, 90);
    leads.push({
      projectName,
      ...(projectHandle && /^[A-Za-z0-9_]{2,30}$/.test(projectHandle) ? { projectHandle: `@${projectHandle}` } : {}),
      ...(projectDomain ? { projectDomain } : {}),
      ...(investorEntityName ? { investorEntityName } : {}),
      ...(investorHandle && /^[A-Za-z0-9_]{2,30}$/.test(investorHandle) ? { investorEntityHandle: `@${investorHandle}` } : {}),
      ...(attribution ? { attribution } : {}),
      relationship: relationshipValue(row.relationship),
      ...(clean(row.stage, 60) ? { stage: clean(row.stage, 60) } : {}),
      ...(clean(row.year, 20) ? { year: clean(row.year, 20) } : {}),
      ...(clean(row.ticker, 20) ? { ticker: clean(row.ticker, 20) } : {}),
      ...(contract && /^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(contract) ? { contract } : {}),
      ...(clean(row.chain, 30) ? { chain: clean(row.chain, 30)?.toLowerCase() } : {}),
      sources: uniqueSources,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
    });
    if (leads.length >= MAX_CANDIDATES) break;
  }
  return leads;
}

export async function discoverPortfolioCandidates(ctx: CollectContext): Promise<PortfolioLead[] | null> {
  if (!env("XAI_API_KEY")) return null;
  const text = await discoverInvestorEvidenceText(ctx);
  return text ? parsePortfolioCandidates(text) : null;
}

const defaultProjectDomainResolver = async (lead: PortfolioLead, lookupProfile = getProfile): Promise<string | undefined> => {
  if (!lead.projectHandle || (lookupProfile === getProfile && !env("TWITTERAPI_KEY"))) return undefined;
  const profile = await lookupProfile(lead.projectHandle);
  if (!profile?.name || !entityNamesMatch(profile.name, lead.projectName)) return undefined;
  return domainFromWebsite(profile.website);
};

function likelyIndividualSubject(ctx: CollectContext): boolean {
  if (ctx.evidence.profile.resolved_name?.trim()) return true;
  const display = ctx.evidence.profile.display_name.trim();
  const bio = normalized(ctx.evidence.profile.bio);
  return display.split(/\s+/).filter(Boolean).length >= 2
    && /\b(?:i am|i m|my |(?:founder|co founder|partner|principal|engineer|researcher|investor|cto)\s*(?:at|with|@))/.test(bio);
}

interface AttributionProof {
  subjectHandle: string;
  attributionSourceUrl: string;
  attributionSourceContentHash: string;
  attributionCapturedAt: string;
  attributionSourceKind: "provider_profile" | "verified_venture";
}

const canonicalSubjectHandle = (value: string): string | null => {
  const bare = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(bare) ? `@${bare.toLowerCase()}` : null;
};

const attributionProofHash = (value: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function sourcePathBindsSubjectHandle(sourceUrl: string, subjectHandle: string): boolean {
  try {
    const tokens = decodeURIComponent(new URL(sourceUrl).pathname)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(Boolean);
    return tokens.includes(subjectHandle.replace(/^@/, "").toLowerCase());
  } catch {
    return false;
  }
}

function providerProfileAffiliationProof(ctx: CollectContext, now: Date): AttributionProof | null {
  const profile = ctx.evidence.profile;
  const subjectHandle = canonicalSubjectHandle(ctx.handle);
  const captured = typeof profile.profile_captured_at === "string"
    ? new Date(profile.profile_captured_at)
    : null;
  if (
    !subjectHandle
    || profile.profile_collection_state !== "resolved"
    || profile.profile_provider !== "twitterapi"
    || !captured
    || !Number.isFinite(captured.getTime())
    || !Number.isFinite(now.getTime())
    || captured.getTime() > now.getTime() + PROFILE_AFFILIATION_CLOCK_SKEW_MS
    || now.getTime() - captured.getTime() > PROFILE_AFFILIATION_MAX_AGE_MS
  ) return null;

  const attributionCapturedAt = captured.toISOString();
  const attributionSourceUrl = `https://x.com/${subjectHandle.slice(1)}`;
  return {
    subjectHandle,
    attributionSourceUrl,
    attributionSourceContentHash: attributionProofHash({
      kind: "provider_profile",
      provider: profile.profile_provider,
      subjectHandle,
      displayName: profile.display_name,
      resolvedName: profile.resolved_name ?? null,
      bio: profile.bio,
      capturedAt: attributionCapturedAt,
    }),
    attributionCapturedAt,
    attributionSourceKind: "provider_profile",
  };
}

function ventureAffiliationEnded(venture: CollectContext["evidence"]["ventures"][number]): boolean {
  const description = normalized([
    venture.role,
    venture.period,
    venture.notes ?? "",
  ].join(" "));
  if (/\b(?:former|formerly|previously|ex|no longer|left|departed|retired|until)\b/.test(description)) return true;
  return /(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:19|20)\d{2}/i.test(venture.period)
    && !/\b(?:present|current|ongoing|now)\b/i.test(venture.period);
}

function verifiedVentureAffiliationProof(
  ctx: CollectContext,
  venture: CollectContext["evidence"]["ventures"][number],
  now: Date,
): AttributionProof | null {
  const subjectHandle = canonicalSubjectHandle(ctx.handle);
  const sourceUrl = safeCandidateUrl(venture.evidence_url);
  const provider = clean(venture.provider, 100);
  if (
    !subjectHandle
    || !sourceUrl
    || !sourcePathBindsSubjectHandle(sourceUrl, subjectHandle)
    || !provider
    || !Number.isFinite(now.getTime())
    || venture.artifact_verified !== true
    || (venture.evidence_origin !== "deterministic" && venture.evidence_origin !== "human_verified")
    || ventureAffiliationEnded(venture)
  ) return null;

  const attributionCapturedAt = now.toISOString();
  return {
    subjectHandle,
    attributionSourceUrl: sourceUrl,
    attributionSourceContentHash: attributionProofHash({
      kind: "verified_venture",
      provider,
      subjectHandle,
      projectName: venture.project_name,
      projectHandle: venture.x_handle ?? null,
      projectDomain: domainFromWebsite(venture.domain) ?? null,
      role: venture.role,
      period: venture.period,
      outcome: venture.outcome,
      evidenceUrl: sourceUrl,
      notes: venture.notes ?? null,
      capturedAt: attributionCapturedAt,
    }),
    attributionCapturedAt,
    attributionSourceKind: "verified_venture",
  };
}

/**
 * Resolve the exact investor entity named by a discovery lead. `now` is the
 * collector's clock and is injectable so provider-profile freshness remains
 * deterministic in tests and in fund-scale's shared entity resolution path.
 */
export function portfolioEntityForLead(
  ctx: CollectContext,
  lead: PortfolioLead,
  now: Date = new Date(),
): PortfolioInvestorEntity | null {
  const directName = ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle;
  const subjectHandle = canonicalSubjectHandle(ctx.handle) ?? ctx.handle;
  const directAliases = [directName, ctx.evidence.profile.display_name, ctx.handle.replace(/^@/, "")]
    .filter((value): value is string => Boolean(value?.trim()));
  const requested = lead.investorEntityName?.trim();
  const requestedHandle = lead.investorEntityHandle?.replace(/^@/, "").toLowerCase();
  const matches = (values: Array<string | undefined>) => values.some((value) => {
    if (!value || !requested) return false;
    const left = compact(value);
    const right = compact(requested);
    return left === right || (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left)));
  });

  if (!requested || matches(directAliases) || requestedHandle === ctx.handle.replace(/^@/, "").toLowerCase()) {
    return {
      name: directName,
      aliases: directAliases,
      handle: ctx.handle,
      handleTrusted: true,
      // A person's X website frequently points to their employer fund. Treating
      // that fund portfolio as the person's first-party page would manufacture
      // personal investments. Personal attribution therefore requires the
      // person's name in the fetched source unless an explicit personal-domain
      // verifier is added later.
      domain: likelyIndividualSubject(ctx) ? undefined : domainFromWebsite(ctx.evidence.profile.website),
      attribution: "direct_subject",
      entityType: likelyIndividualSubject(ctx) ? "person" : "organization",
      subjectHandle,
    };
  }

  // An explicit affiliation in the provider-returned official bio can ground
  // fund context, but never a claim that the person invested personally.
  const bio = normalized(ctx.evidence.profile.bio);
  const profileProof = providerProfileAffiliationProof(ctx, now);
  if (lead.attribution === "affiliated_fund" && profileProof && bioHasCurrentAffiliation(bio, requested, requestedHandle)) {
    return {
      name: requested,
      aliases: [requested],
      handle: lead.investorEntityHandle,
      handleTrusted: false,
      attribution: "affiliated_fund",
      entityType: "organization",
      ...profileProof,
    };
  }

  // A separately verified current venture remains a fallback when the official
  // profile does not state the affiliation. The strict I3 gate currently keeps
  // this proof visible but non-scoring until its upstream employment artifact
  // can be cross-checked in the same frozen packet.
  const verifiedAffiliation = ctx.evidence.ventures
    .map((venture) => ({ venture, proof: verifiedVentureAffiliationProof(ctx, venture, now) }))
    .find(({ venture, proof }) => Boolean(proof) && (
      matches([venture.project_name])
      || (requestedHandle && venture.x_handle?.replace(/^@/, "").toLowerCase() === requestedHandle)
    ));
  if (verifiedAffiliation?.proof) {
    const { venture, proof } = verifiedAffiliation;
    return {
      name: venture.project_name,
      aliases: [venture.project_name, requested].filter(Boolean),
      handle: venture.x_handle || lead.investorEntityHandle,
      handleTrusted: Boolean(venture.x_handle),
      domain: domainFromWebsite(venture.domain),
      attribution: "affiliated_fund",
      entityType: "organization",
      ...proof,
    };
  }
  return null;
}

export const defaultInvestorDomainResolver = async (lead: PortfolioLead, entity: PortfolioInvestorEntity, lookupProfile = getProfile): Promise<string | undefined> => {
  if (entity.domain) return entity.domain;
  if (entity.entityType === "person") return undefined;
  const handle = entity.handle || lead.investorEntityHandle;
  if (!handle || (lookupProfile === getProfile && !env("TWITTERAPI_KEY"))) return undefined;
  const profile = await lookupProfile(handle);
  // The requested handle itself is model output, so observing the same handle
  // after calling getProfile(handle) is tautological. The provider-returned
  // display name must independently match the attributed entity.
  if (!profile?.name || !entityNamesMatch(profile.name, entity.name)) return undefined;
  return domainFromWebsite(profile.website);
};

function sourceClass(
  host: string,
  investorDomain?: string,
  projectDomain?: string,
  attribution: PortfolioInvestorEntity["attribution"] = "direct_subject",
): PortfolioSourceClass {
  if (listedHost(host, PRIMARY_HOSTS)) return "public_primary";
  if (listedHost(host, PRESS_HOSTS)) return "independent_press";
  if (investorDomain && hostMatches(host, investorDomain)) {
    return attribution === "direct_subject" ? "first_party_subject" : "first_party_investor";
  }
  if (projectDomain && hostMatches(host, projectDomain)) return "first_party_project";
  return "other_public";
}

function htmlToVisibleText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

const normalized = (value: string): string => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9@$._ -]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const compact = (value: string): string => normalized(value).replace(/[^a-z0-9]+/g, "");

const regexEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function entityWords(entity: string): string[] {
  return normalized(entity.replace(/^@/, ""))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function entityPattern(entity: string, global = false): RegExp | null {
  const words = entityWords(entity);
  if (!words.length || (words.length === 1 && words[0].length < 2)) return null;
  const phrase = words.map(regexEscape).join("[^a-z0-9]+");
  return new RegExp(`(?:^|[^a-z0-9])(${phrase})(?=$|[^a-z0-9])`, global ? "gi" : "i");
}

function entitySpans(text: string, entity: string): Array<{ start: number; end: number }> {
  const pattern = entityPattern(entity, true);
  if (!pattern) return [];
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const phrase = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].lastIndexOf(phrase);
    spans.push({ start, end: start + phrase.length });
  }
  return spans;
}

function containsEntity(text: string, entity: string): boolean {
  return entitySpans(normalized(text), entity).length > 0;
}

function ambiguousSingleWord(entity: string): boolean {
  const words = entityWords(entity);
  return words.length === 1 && words[0].length <= 4;
}

function containsProjectEntity(text: string, project: string): boolean {
  if (!ambiguousSingleWord(project)) return containsEntity(text, project);
  const word = project.trim().replace(/^@/, "");
  return new RegExp(`(?:^|[^A-Za-z0-9])${regexEscape(word)}(?=$|[^A-Za-z0-9])`).test(text);
}

function explicitAmbiguousRelationship(text: string, project: string): boolean {
  const word = project.trim().replace(/^@/, "");
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9])(${regexEscape(word)})(?=$|[^A-Za-z0-9])`, "g");
  for (const match of text.matchAll(pattern)) {
    const phrase = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].lastIndexOf(phrase);
    const before = text.slice(Math.max(0, start - 100), start).toLowerCase();
    const after = text.slice(start + phrase.length, start + phrase.length + 100).toLowerCase();
    if (/(?:invested in|investment in|backed|portfolio includes|portfolio company[: -]|led (?:the )?round in)\s*$/.test(before)) return true;
    if (/^\s*(?:is|was|—|-|:)\s*(?:an? )?(?:investment|portfolio company|backed company)\b/.test(after)) return true;
  }
  return false;
}

function entityNamesMatch(leftRaw: string, rightRaw: string): boolean {
  const left = normalized(leftRaw);
  const right = normalized(rightRaw);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 5 && (
    longer.startsWith(`${shorter} `)
    || longer.endsWith(` ${shorter}`)
  );
}

function bioHasCurrentAffiliation(bio: string, entity: string, handle?: string): boolean {
  const aliases = [entity, handle?.replace(/^@/, "")].filter((value): value is string => Boolean(value));
  const role = "(?:founding |general |managing |research )?(?:partner|principal|investor|researcher|research|engineer|developer|employee|advisor|adviser|cto|chief technology officer|team member|team|lead|director|gp)";
  for (const alias of aliases) {
    for (const span of entitySpans(bio, alias)) {
      const before = bio.slice(Math.max(0, span.start - 100), span.start);
      const after = bio.slice(span.end, Math.min(bio.length, span.end + 70));
      const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
      const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
      const lastEnded = endedMarkers.at(-1)?.index ?? -1;
      const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
      // A current marker overrides an old-role marker only when it occurs after
      // that marker and therefore scopes the matched affiliation ("previously
      // at X, now partner at Y"). "Currently independent, formerly partner at
      // Y" must remain ended.
      const endedBefore = lastEnded >= 0 && lastCurrent < lastEnded;
      const endedAfter = /^[^.;|]{0,55}\b(?:no longer|left|departed|retired|until|through)\b/i.test(after);
      if (endedBefore || endedAfter) continue;
      if (new RegExp(`${role}\\s+(?:at|with|@)\\s*(?:the\\s+)?$`, "i").test(before)) return true;
      if (/\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\s+(?:at|with|@)\s*(?:the\s+)?$/i.test(before)) return true;
      if (new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) return true;
    }
  }
  return false;
}

const RELATION = /\b(?:invest(?:ed|ing|ment|ments|or|ors)?|back(?:ed|ing|er|ers)?|portfolio|funding|financing|capital raise|led (?:the )?round|participat(?:ed|ing) in (?:the )?round|seed round|pre seed|series [a-e]|strategic round|incubat(?:ed|or|ion))\b/i;
const NEGATED = /\b(?:did not|does not|do not|never|no)\s+(?:invest|back|participate)|\bnot\s+(?:an?\s+)?(?:investor|backer)|\bden(?:y|ies|ied)\s+(?:investing|the investment|backing)\b/i;

export interface RelationshipMatch {
  supported: boolean;
  excerpt?: string;
}

export function supportsPortfolioRelationship(input: {
  document: PublicTextDocument;
  sourceClass: PortfolioSourceClass;
  subjectAliases: string[];
  projectName: string;
}): RelationshipMatch {
  const visible = htmlToVisibleText(input.document.text);
  if (!containsProjectEntity(visible, input.projectName)) return { supported: false };
  const segments = visible
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9@])/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 3 && segment.length <= 1_600);
  const projectSegments = segments.filter((segment) => containsProjectEntity(segment, input.projectName));
  const portfolioPath = /\/(?:portfolio|investments?|companies|backed)(?:\/|$)/i.test(new URL(input.document.url).pathname);
  const portfolioPage = portfolioPath
    || projectSegments.some((segment) => RELATION.test(segment))
    || /\b(?:our )?(?:portfolio|investments)\b/i.test(visible.slice(0, 1_200));

  if (input.sourceClass === "first_party_subject" || input.sourceClass === "first_party_investor") {
    const ambiguous = ambiguousSingleWord(input.projectName);
    const pathMentionsProject = new URL(input.document.url).pathname
      .split("/")
      .some((part) => normalized(part) === normalized(input.projectName));
    const supportedSegment = projectSegments.find((segment) =>
      !NEGATED.test(segment)
      && (!ambiguous || pathMentionsProject || explicitAmbiguousRelationship(segment, input.projectName)));
    if (!portfolioPage || !supportedSegment) return { supported: false };
    return { supported: true, excerpt: supportedSegment.slice(0, 700) };
  }

  // Third-party, primary, and project announcements must express the investor,
  // predicate, and project in the same sentence/card. A page-level bag of words
  // is not relationship evidence.
  const supportedSegment = projectSegments.find((segment) =>
    input.subjectAliases.some((alias) => containsEntity(segment, alias))
    && RELATION.test(segment)
    && !NEGATED.test(segment));
  if (!supportedSegment) return { supported: false };
  return { supported: true, excerpt: supportedSegment.slice(0, 700) };
}

function registrableApprox(host: string): string {
  const parts = host.replace(/^www\./i, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffix = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.nz", "co.jp"]);
  const tail = parts.slice(-2).join(".");
  return twoLevelSuffix.has(tail) ? parts.slice(-3).join(".") : tail;
}

function artifactHash(artifact: Omit<SourceArtifact, "contentHash">): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

interface InspectedSource {
  lead: PortfolioLead;
  entity?: PortfolioInvestorEntity;
  source: PortfolioLead["sources"][number];
  document?: PublicTextDocument;
  sourceClass?: PortfolioSourceClass;
  officialProjectDomain?: string;
  officialInvestorDomain?: string;
  match?: RelationshipMatch;
  failed: boolean;
}

export async function collectPortfolioRelationships(
  ctx: CollectContext,
  dependencies: PortfolioCollectorDependencies = {},
): Promise<AdapterRunResult> {
  const discover = dependencies.discover ?? discoverPortfolioCandidates;
  const fetchSource = dependencies.fetchSource ?? fetchPublicText;
  const lookupProfile = dependencies.lookupProfile ?? getProfile;
  const now = dependencies.now?.() ?? new Date();
  const resolveProjectDomain = dependencies.resolveProjectDomain
    ?? ((lead: PortfolioLead) => defaultProjectDomainResolver(lead, lookupProfile));
  const resolveInvestorDomain = dependencies.resolveInvestorDomain
    ?? ((lead: PortfolioLead, entity: PortfolioInvestorEntity) => defaultInvestorDomainResolver(lead, entity, lookupProfile));

  if (!dependencies.discover && !env("XAI_API_KEY")) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "Source-linked portfolio discovery is not configured; Crunchbase is optional and is not required",
      provider: "portfolio-web",
    });
    return { state: "skipped", detail: "source-linked portfolio discovery is not configured" };
  }

  ctx.emit({
    phase: "Investor",
    label: "Portfolio evidence",
    detail: "Discovering cited investments, then fetching each source and verifying the relationship before scoring…",
    source: "grok · first-party pages · primary sources · independent press",
    tone: "neutral",
  });

  const leads = await discover(ctx);
  if (!leads) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "Source-linked portfolio discovery did not return a complete response",
      provider: "portfolio-web",
    });
    return { state: "failed", detail: "portfolio discovery failed" };
  }
  ctx.evidence.portfolioLeads = leads.slice(0, MAX_CANDIDATES).map((lead) => ({ ...lead, sources: lead.sources.map((source) => ({ ...source })) }));

  if (!leads.length) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "Discovery returned no source-linked candidates, but a model search is not an exhaustive portfolio screen; no authoritative portfolio surface was inspected",
      provider: "portfolio-web",
    });
    ctx.emit({ phase: "Investor", label: "Portfolio coverage unavailable", detail: "Discovery returned no cited candidates; ARGUS did not treat model silence as evidence that no portfolio exists.", source: "portfolio-web", tone: "warn" });
    return { state: "partial", detail: "0 source-linked candidates · no authoritative surface inspected" };
  }

  const entityByLead = new Map<PortfolioLead, PortfolioInvestorEntity | null>(
    leads.slice(0, MAX_CANDIDATES).map((lead) => [lead, portfolioEntityForLead(ctx, lead, now)]),
  );
  const unattributedCandidates = [...entityByLead.values()].filter((entity) => !entity).length;
  const sourceLessCandidates = [...entityByLead.entries()].filter(([lead, entity]) => Boolean(entity) && lead.sources.length === 0).length;
  const inspections: InspectedSource[] = (await Promise.all(leads.slice(0, MAX_CANDIDATES).map(async (lead) => {
    const entity = entityByLead.get(lead) ?? null;
    if (!entity) return [];
    const officialInvestorDomain = await resolveInvestorDomain(lead, entity).catch(() => entity.domain);
    const investorAliases = [
      ...entity.aliases,
      entity.handle && (entity.handleTrusted || officialInvestorDomain)
        ? entity.handle.replace(/^@/, "")
        : undefined,
    ].filter((value): value is string => Boolean(value?.trim()));
    const candidateHosts = lead.sources.flatMap((source) => {
      try { return [new URL(source.url).hostname.replace(/^www\./i, "").toLowerCase()]; }
      catch { return []; }
    });
    const needsProjectDomain = candidateHosts.some((host) =>
      !(officialInvestorDomain && hostMatches(host, officialInvestorDomain))
      && !listedHost(host, PRIMARY_HOSTS)
      && !listedHost(host, PRESS_HOSTS),
    );
    const officialProjectDomain = needsProjectDomain ? await resolveProjectDomain(lead).catch(() => undefined) : undefined;
    return Promise.all(lead.sources.slice(0, MAX_SOURCES_PER_CANDIDATE).map(async (source): Promise<InspectedSource> => {
      const result = await fetchSource(source.url);
      if (result.status !== "ok") {
        recordCall("portfolio-web", "source-fetch", 0, result.reason, "failed");
        return { lead, entity, source, officialProjectDomain, officialInvestorDomain, failed: true };
      }
      const classification = sourceClass(result.host, officialInvestorDomain, officialProjectDomain, entity.attribution);
      const match = supportsPortfolioRelationship({
        document: result,
        sourceClass: classification,
        subjectAliases: investorAliases,
        projectName: lead.projectName,
      });
      recordCall("portfolio-web", "source-fetch", 0, `${classification} · ${match.supported ? "relationship_supported" : "no_relationship_match"}`, "succeeded");
      return { lead, entity, source, document: result, sourceClass: classification, officialProjectDomain, officialInvestorDomain, match, failed: false };
    }));
  }))).flat();

  const supported = inspections.filter((item): item is InspectedSource & {
    entity: PortfolioInvestorEntity;
    document: PublicTextDocument;
    sourceClass: PortfolioSourceClass;
    match: RelationshipMatch & { supported: true };
  } => Boolean(item.entity && item.document && item.sourceClass && item.match?.supported));
  const failed = inspections.filter((item) => item.failed).length;
  const successfulFetches = inspections.length - failed;

  const byProject = new Map<string, typeof supported>();
  for (const item of supported) {
    const key = `${item.entity.name.toLowerCase()}::${item.lead.projectName.toLowerCase()}`;
    byProject.set(key, [...(byProject.get(key) ?? []), item]);
  }

  const confirmedProjects = new Set<string>();
  const confirmationByProject = new Map<string, { confirmed: boolean; pressConfirmed: boolean }>();
  for (const [project, rows] of byProject) {
    const authoritative = rows.some((row) => row.sourceClass === "first_party_subject"
      || row.sourceClass === "first_party_investor"
      || row.sourceClass === "first_party_project"
      || row.sourceClass === "public_primary");
    const pressDomains = new Set(rows
      .filter((row) => row.sourceClass === "independent_press")
      .map((row) => registrableApprox(row.document.host)));
    const pressFingerprints = new Set(rows
      .filter((row) => row.sourceClass === "independent_press")
      .map((row) => createHash("sha256").update(normalized(row.match.excerpt ?? "")).digest("hex")));
    const pressConfirmed = pressDomains.size >= 2 && pressFingerprints.size >= 2;
    const confirmed = authoritative || pressConfirmed;
    confirmationByProject.set(project, { confirmed, pressConfirmed });
    if (confirmed) confirmedProjects.add(project);
  }

  for (const row of supported) {
    const projectKey = `${row.entity.name.toLowerCase()}::${row.lead.projectName.toLowerCase()}`;
    const confirmation = confirmationByProject.get(projectKey);
    const sourceConfirmed = Boolean(confirmation?.confirmed && (
      row.sourceClass === "first_party_subject"
      || row.sourceClass === "first_party_investor"
      || row.sourceClass === "first_party_project"
      || row.sourceClass === "public_primary"
      || (row.sourceClass === "independent_press" && confirmation.pressConfirmed)
    ));
    const unhashed: Omit<SourceArtifact, "contentHash"> = {
      kind: "portfolio_relationship",
      provider: "portfolio-web",
      title: `${row.entity.name} → ${row.lead.projectName}`,
      sourceUrl: row.document.url,
      capturedAt: row.document.capturedAt,
      sourceContentHash: row.document.contentHash,
      excerpt: row.match.excerpt,
      match: sourceConfirmed ? "relationship_confirmed" : "candidate",
      relationship: "invested_in",
      subjectName: ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle,
      subjectHandle: row.entity.subjectHandle ?? ctx.handle,
      investorEntityName: row.entity.name,
      ...(row.entity.handle && (row.entity.handleTrusted || row.officialInvestorDomain)
        ? { investorEntityHandle: row.entity.handle }
        : {}),
      ...(row.officialInvestorDomain ? { investorEntityDomain: row.officialInvestorDomain } : {}),
      attribution: row.entity.attribution,
      ...(row.entity.attributionSourceUrl ? { attributionSourceUrl: row.entity.attributionSourceUrl } : {}),
      ...(row.entity.attributionSourceContentHash
        ? { attributionSourceContentHash: row.entity.attributionSourceContentHash }
        : {}),
      ...(row.entity.attributionCapturedAt ? { attributionCapturedAt: row.entity.attributionCapturedAt } : {}),
      ...(row.entity.attributionSourceKind ? { attributionSourceKind: row.entity.attributionSourceKind } : {}),
      projectName: row.lead.projectName,
      ...(row.officialProjectDomain ? { projectDomain: row.officialProjectDomain } : {}),
      ...(row.officialProjectDomain && row.lead.projectHandle ? { projectHandle: row.lead.projectHandle } : {}),
      sourceClass: row.sourceClass,
    };
    const artifact: SourceArtifact = { ...unhashed, contentHash: artifactHash(unhashed) };
    const exists = ctx.evidence.sourceArtifacts.some((candidate) =>
      candidate.kind === artifact.kind
      && candidate.investorEntityName?.toLowerCase() === artifact.investorEntityName?.toLowerCase()
      && candidate.projectName?.toLowerCase() === artifact.projectName?.toLowerCase()
      && candidate.sourceUrl === artifact.sourceUrl,
    );
    if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
  }

  const reportedProjects = [...byProject.keys()].filter((project) => !confirmedProjects.has(project)).length;
  const incompleteDispositions = unattributedCandidates + sourceLessCandidates + failed;
  if (confirmedProjects.size > 0 && incompleteDispositions > 0) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: `${confirmedProjects.size} portfolio relationship${confirmedProjects.size === 1 ? " was" : "s were"} verified, but coverage remained incomplete: ${unattributedCandidates} candidate${unattributedCandidates === 1 ? "" : "s"} could not be safely attributed, ${sourceLessCandidates} had no inspectable source, and ${failed} cited source fetch${failed === 1 ? "" : "es"} failed`,
      provider: "portfolio-web",
      sourceCount: confirmedProjects.size,
    });
    ctx.emit({ phase: "Investor", label: "Portfolio verification partial", detail: `${confirmedProjects.size} relationship${confirmedProjects.size === 1 ? "" : "s"} verified, but ${incompleteDispositions} candidate disposition${incompleteDispositions === 1 ? " remains" : "s remain"} incomplete.`, source: "portfolio-web", tone: "warn" });
    return { state: "partial", detail: `${confirmedProjects.size} verified · ${reportedProjects} reported · ${incompleteDispositions} incomplete` };
  }
  if (confirmedProjects.size > 0) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "confirmed",
      note: `${confirmedProjects.size} unique portfolio relationship${confirmedProjects.size === 1 ? "" : "s"} verified from fetched first-party, primary, or independently corroborated sources${reportedProjects ? ` · ${reportedProjects} additional project${reportedProjects === 1 ? "" : "s"} remained reported-only` : ""}`,
      provider: "portfolio-web",
      sourceCount: confirmedProjects.size,
    });
    ctx.emit({ phase: "Investor", label: "Portfolio relationships verified", detail: `${confirmedProjects.size}/${leads.length} source-linked candidate${leads.length === 1 ? "" : "s"} met the deterministic confirmation threshold.`, source: "portfolio-web", tone: "good" });
    return { state: "executed", detail: `${confirmedProjects.size} verified · ${reportedProjects} reported` };
  }

  if (!inspections.length || incompleteDispositions > 0) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: inspections.length
        ? `Portfolio verification was incomplete: ${failed} of ${inspections.length} cited source fetch${inspections.length === 1 ? "" : "es"} failed, ${unattributedCandidates} candidate${unattributedCandidates === 1 ? "" : "s"} could not be safely attributed, ${sourceLessCandidates} had no inspectable source, and no relationship reached the confirmation threshold`
        : `Portfolio candidates were returned without a complete inspectable attribution path (${unattributedCandidates} unattributed · ${sourceLessCandidates} without sources)`,
      provider: "portfolio-web",
      sourceCount: 0,
    });
    return { state: successfulFetches ? "partial" : "failed", detail: `${successfulFetches} fetched · ${incompleteDispositions} incomplete · 0 verified` };
  }

  ctx.recordCheck?.({
    id: "vc-portfolio-track-record",
    status: "checked-empty",
    note: `Fetched and inspected ${successfulFetches} cited source${successfulFetches === 1 ? "" : "s"} across ${leads.length} candidate project${leads.length === 1 ? "" : "s"}; no relationship met the verification threshold${reportedProjects ? ` (${reportedProjects} remained reported-only)` : ""}. This is not proof that no portfolio exists`,
    provider: "portfolio-web",
  });
  ctx.emit({ phase: "Investor", label: "Portfolio coverage limited", detail: "The bounded source review completed, but no investment relationship met the confirmation threshold.", source: "portfolio-web", tone: "warn" });
  return { state: "executed", detail: `${successfulFetches} sources inspected · 0 verified` };
}
