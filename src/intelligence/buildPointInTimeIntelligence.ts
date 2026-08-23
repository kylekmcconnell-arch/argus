import type {
  BasicFact,
  BasicFactPredicate,
  BasicFactQuestionLedgerEntry,
  BasicFactSource,
  CollectedEvidence,
} from "../data/evidence";
import { findingHasEligibleArtifact, findingTargetsAuditedSubject } from "../engine/audit";
import { SubjectClass } from "../engine/taxonomy";
import {
  normalizeAddress as normalizeGraphAddress,
  normalizeChain as normalizeGraphChain,
} from "../graph/network";
import { canonicalOfficialWebsite, isStrictFundScaleArtifact } from "../lib/fundScaleEvidence";
import { axisLabel } from "../lib/verdict";
import {
  portfolioRelationshipBinding,
  type PortfolioRelationshipBinding,
} from "../lib/portfolioRelationshipBinding";
import {
  classifyProjectArchetypes,
  contradictingFactSources,
  factContradictionSourceId,
  factContradictionSourceRefs,
  factSourceHasEligibleArtifact,
  factSupportSourceId,
  factSupportSourceRefs,
  factTargetsAuditedSubject,
  isStrictSourceBackedFact,
  supportingFactSources,
} from "./archetypes";
import type {
  DecisionLens,
  DecisionLensId,
  DerivedIntelligenceSignal,
  IntelligenceCoverageState,
  IntelligenceArithmeticReceipt,
  IntelligenceDomain,
  IntelligenceDomainCoverage,
  IntelligenceMeasurement,
  IntelligenceQuestion,
  IntelligenceQuestionState,
  IntelligenceSignalSeverity,
  IntelligenceSourceClass,
  IntelligenceSourceRef,
  IntelligenceSpineSnapshot,
  NumberIntelligenceMeasurement,
  ProductArchetype,
} from "./types";

const DOMAIN_ORDER: readonly IntelligenceDomain[] = [
  "identity",
  "product",
  "team",
  "market",
  "liquidity",
  "supply",
  "economics",
  "funding",
  "treasury",
  "governance",
  "control",
  "security",
  "legal",
  "chronology",
] as const;

const LENS_ORDER: readonly DecisionLensId[] = [
  "investment",
  "alpha_research",
  "counterparty",
  "general_diligence",
] as const;

const SEVERITY_RANK: Record<IntelligenceSignalSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  context: 3,
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: number | null | undefined): value is number {
  return finite(value) && value > 0;
}

function percentageInRange(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function normalizedProducerIdentifier(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function normalizedProducerAddress(address: unknown, chain: unknown): string | null {
  if (typeof address !== "string" || !address.trim() || typeof chain !== "string" || !chain.trim()) return null;
  return normalizeGraphAddress(normalizeGraphChain(chain), address);
}

function isCompleteHttpReceipt(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.username === ""
      && parsed.password === ""
      && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function canonicalProducerHost(value: unknown): string | null {
  return canonicalOfficialWebsite(value)?.domain ?? null;
}

function relatedCanonicalHosts(left: string | null, right: string | null): boolean {
  return Boolean(
    left
    && right
    && (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)),
  );
}

function canonicalCompanyHost(evidence: Readonly<CollectedEvidence>): string | null {
  const tokenHomepage = evidence.projectToken?.verified === true
    ? canonicalProducerHost(evidence.projectToken.homepage)
    : null;
  return tokenHomepage ?? canonicalProducerHost(evidence.profile.website);
}

function canonicalDomainRegistrationHost(evidence: Readonly<CollectedEvidence>): string | null {
  return canonicalProducerHost(evidence.profile.website)
    ?? (evidence.projectToken?.verified === true
      ? canonicalProducerHost(evidence.projectToken.homepage)
      : null);
}

function sourceUrlMatchesHost(sourceUrl: unknown, expectedHost: string | null): boolean {
  if (!isCompleteHttpReceipt(sourceUrl) || !expectedHost) return false;
  try {
    return relatedCanonicalHosts(new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, ""), expectedHost);
  } catch {
    return false;
  }
}

function rdapSourceMatchesDomain(sourceUrl: unknown, domain: string | null): boolean {
  if (!isCompleteHttpReceipt(sourceUrl) || !domain) return false;
  try {
    const pathParts = decodeURIComponent(new URL(sourceUrl).pathname)
      .split("/")
      .map((part) => part.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean);
    return pathParts.at(-1) === domain;
  } catch {
    return false;
  }
}

function validFrozenTime(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function wholeUtcMonthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, from.getUTCDate() > to.getUTCDate() ? months - 1 : months);
}

interface DerivedLaunchWindow {
  earliest: string;
  earliestSource: "domain" | "account";
  latest: string;
  latestSource: "domain" | "account";
  gapMonths: number;
  summary: string;
}

function monthYearUtc(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function recomputeLaunchWindow(
  evidence: Readonly<CollectedEvidence>,
  domainRegistrationMatched: boolean,
  accountCreationReceiptComplete: boolean,
): DerivedLaunchWindow | null {
  if (!domainRegistrationMatched || !accountCreationReceiptComplete || !evidence.domainRegistration) return null;
  const domainDate = new Date(evidence.domainRegistration.registeredAt).toISOString();
  const accountDate = new Date(evidence.profile.account_created_at!).toISOString();
  const domainFirst = Date.parse(domainDate) <= Date.parse(accountDate);
  const earliest = domainFirst ? domainDate : accountDate;
  const latest = domainFirst ? accountDate : domainDate;
  const gapMonths = wholeUtcMonthsBetween(earliest, latest);
  const earliestLabel = domainFirst ? "the official domain was registered" : "the official X account was created";
  const latestLabel = domainFirst ? "the official X account followed" : "the official domain was registered";
  const gapNote = gapMonths >= 24
    ? ` The two are ${Math.round(gapMonths / 12)} years apart, so one public surface long predates the other.`
    : gapMonths >= 6
      ? ` The two are about ${gapMonths} months apart.`
      : " Both public surfaces appeared within months of each other.";
  return {
    earliest,
    earliestSource: domainFirst ? "domain" : "account",
    latest,
    latestSource: domainFirst ? "account" : "domain",
    gapMonths,
    summary: `The bounded public-footprint window starts ${monthYearUtc(earliest)}, when ${earliestLabel}; ${latestLabel} ${monthYearUtc(latest)}.${gapNote}`,
  };
}

interface CrossProducerIdentityBindings {
  canonicalTokenVerified: boolean;
  canonicalAddress: string | null;
  canonicalChain: string | null;
  canonicalGeckoId: string | null;
  protocolTvlMatched: boolean;
  protocolFundingMatched: boolean;
  protocolFeesReceiptComplete: boolean;
  protocolFeesMatched: boolean;
  holderProfileMatched: boolean;
  canonicalCompanyHost: string | null;
  companyRequestedHost: string | null;
  companyMatchedHost: string | null;
  companyEnrichmentReceiptComplete: boolean;
  companyEnrichmentMatched: boolean;
  canonicalDomainHost: string | null;
  registeredDomain: string | null;
  registeredHostname: string | null;
  domainRegistrationReceiptComplete: boolean;
  domainRegistrationMatched: boolean;
  accountCreationReceiptComplete: boolean;
  tokenUnlockReceiptComplete: boolean;
  tokenUnlocksMatched: boolean;
  evmControlMatched: boolean;
}

function crossProducerIdentityBindings(
  evidence: Readonly<CollectedEvidence>,
): CrossProducerIdentityBindings {
  const token = evidence.projectToken;
  const canonicalTokenVerified = (token as { verified?: unknown } | undefined)?.verified === true;
  const canonicalChain = canonicalTokenVerified
    ? normalizedProducerIdentifier(token?.chain)
    : null;
  const canonicalAddress = canonicalTokenVerified
    ? normalizedProducerAddress(token?.address, canonicalChain)
    : null;
  const canonicalGeckoId = canonicalTokenVerified
    ? normalizedProducerIdentifier(token?.coingeckoId)
    : null;
  const protocolTvlMatched = Boolean(
    evidence.protocolTvl
    && canonicalGeckoId
    && normalizedProducerIdentifier(evidence.protocolTvl.geckoId) === canonicalGeckoId,
  );
  const protocolFundingMatched = Boolean(
    evidence.protocolFunding
    && canonicalGeckoId
    && normalizedProducerIdentifier(evidence.protocolFunding.geckoId) === canonicalGeckoId,
  );
  const matchedProtocolSlugs = new Set([
    ...(protocolTvlMatched ? [normalizedProducerIdentifier(evidence.protocolTvl?.slug)] : []),
    ...(protocolFundingMatched ? [normalizedProducerIdentifier(evidence.protocolFunding?.slug)] : []),
  ].filter((slug): slug is string => slug !== null));
  const protocolFeesSlug = normalizedProducerIdentifier(evidence.protocolFees?.slug);
  const protocolFeesBinding = evidence.protocolFees?.binding;
  const protocolFeesReceiptComplete = Boolean(
    protocolFeesBinding
    && protocolFeesBinding.method === "matched_protocol_gecko_id"
    && protocolFeesSlug
    && normalizedProducerIdentifier(protocolFeesBinding.protocolSlug) === protocolFeesSlug
    && canonicalGeckoId
    && normalizedProducerIdentifier(protocolFeesBinding.canonicalGeckoId) === canonicalGeckoId,
  );
  const protocolFeesMatched = Boolean(
    evidence.protocolFees
    && protocolFeesSlug
    && protocolFeesReceiptComplete
    && matchedProtocolSlugs.has(protocolFeesSlug),
  );
  const holderBinding = evidence.holderProfile?.binding;
  const holderChain = normalizedProducerIdentifier(holderBinding?.chain);
  const holderAddress = normalizedProducerAddress(holderBinding?.canonicalAddress, holderChain);
  const holderProfileMatched = Boolean(
    evidence.holderProfile
    && holderBinding?.method === "canonical_token_address_chain"
    && canonicalTokenVerified
    && canonicalChain
    && canonicalAddress
    && holderChain === canonicalChain
    && holderAddress === canonicalAddress,
  );
  const expectedCompanyHost = canonicalCompanyHost(evidence);
  const company = evidence.companyEnrichment;
  const companyRequestedHost = canonicalProducerHost(company?.requestedDomain);
  const companyMatchedHost = canonicalProducerHost(company?.matchedDomain);
  const companyMethodCoherent = company?.matchMethod === "exact_host"
    ? companyRequestedHost !== null && companyRequestedHost === companyMatchedHost
    : company?.matchMethod === "parent_or_subdomain"
      ? relatedCanonicalHosts(companyRequestedHost, companyMatchedHost)
      : false;
  const companyEnrichmentReceiptComplete = Boolean(
    company
    && company.identityMatch === "official_domain"
    && expectedCompanyHost
    && companyRequestedHost
    && companyMatchedHost
    && companyMethodCoherent
    && sourceUrlMatchesHost(company.sourceUrl, companyMatchedHost)
    && validFrozenTime(company.capturedAt),
  );
  const companyEnrichmentMatched = Boolean(
    companyEnrichmentReceiptComplete
    && relatedCanonicalHosts(expectedCompanyHost, companyRequestedHost)
    && relatedCanonicalHosts(expectedCompanyHost, companyMatchedHost),
  );
  const expectedDomainHost = canonicalDomainRegistrationHost(evidence);
  const registration = evidence.domainRegistration;
  const registeredDomain = canonicalProducerHost(registration?.domain);
  const registeredHostname = canonicalProducerHost(registration?.hostname);
  const registrationTime = validFrozenTime(registration?.registeredAt)
    ? Date.parse(registration.registeredAt)
    : NaN;
  const registrationCaptureTime = validFrozenTime(registration?.capturedAt)
    ? Date.parse(registration.capturedAt)
    : NaN;
  const domainRegistrationReceiptComplete = Boolean(
    registration
    && registeredDomain
    && registeredHostname
    && Number.isFinite(registrationTime)
    && Number.isFinite(registrationCaptureTime)
    && registrationTime <= registrationCaptureTime
    && rdapSourceMatchesDomain(registration.source, registeredDomain),
  );
  const domainRegistrationMatched = Boolean(
    domainRegistrationReceiptComplete
    && expectedDomainHost
    && registeredHostname === expectedDomainHost
    && (expectedDomainHost === registeredDomain || expectedDomainHost.endsWith(`.${registeredDomain}`)),
  );
  const accountCreatedTime = validFrozenTime(evidence.profile.account_created_at)
    ? Date.parse(evidence.profile.account_created_at)
    : NaN;
  const profileCaptureTime = validFrozenTime(evidence.profile.profile_captured_at)
    ? Date.parse(evidence.profile.profile_captured_at)
    : NaN;
  const accountCreationReceiptComplete = Boolean(
    evidence.profile.profile_collection_state === "resolved"
    && Number.isFinite(accountCreatedTime)
    && Number.isFinite(profileCaptureTime)
    && accountCreatedTime <= profileCaptureTime,
  );
  const unlocks = evidence.tokenUnlocks;
  const unlockChain = normalizedProducerIdentifier(unlocks?.chain);
  const unlockAddress = normalizedProducerAddress(unlocks?.canonicalAddress, unlockChain);
  const tokenUnlockReceiptComplete = Boolean(
    unlocks
    && Number.isSafeInteger(unlocks.currencyId)
    && (unlocks.currencyId ?? -1) >= 0
    && isCompleteHttpReceipt(unlocks.contractSourceUrl)
    && isCompleteHttpReceipt(unlocks.eventsSourceUrl)
    && unlockChain
    && unlockAddress,
  );
  const tokenUnlocksMatched = Boolean(
    canonicalTokenVerified
    && canonicalChain
    && canonicalAddress
    && tokenUnlockReceiptComplete
    && unlockChain === canonicalChain
    && unlockAddress === canonicalAddress,
  );
  const control = evidence.evmControlReality;
  const controlChain = normalizedProducerIdentifier(control?.chain);
  const controlAddress = normalizedProducerAddress(control?.target, controlChain);
  const evmControlMatched = Boolean(
    control
    && canonicalTokenVerified
    && canonicalChain
    && canonicalAddress
    && controlChain === canonicalChain
    && controlAddress === canonicalAddress,
  );

  return {
    canonicalTokenVerified,
    canonicalAddress,
    canonicalChain,
    canonicalGeckoId,
    protocolTvlMatched,
    protocolFundingMatched,
    protocolFeesReceiptComplete,
    protocolFeesMatched,
    holderProfileMatched,
    canonicalCompanyHost: expectedCompanyHost,
    companyRequestedHost,
    companyMatchedHost,
    companyEnrichmentReceiptComplete,
    companyEnrichmentMatched,
    canonicalDomainHost: expectedDomainHost,
    registeredDomain,
    registeredHostname,
    domainRegistrationReceiptComplete,
    domainRegistrationMatched,
    accountCreationReceiptComplete,
    tokenUnlockReceiptComplete,
    tokenUnlocksMatched,
    evmControlMatched,
  };
}

type HolderAggregateBasis =
  | { kind: "top_10"; assessedWalletCount: 10; sharePct: number }
  | { kind: "floor"; assessedWalletCount: number; sharePct: number };

function holderAggregateBasis(
  holders: NonNullable<CollectedEvidence["holderProfile"]>,
): HolderAggregateBasis | null {
  if (holders.holdersAssessed === false || !finite(holders.top10Pct)) return null;
  const count = holders.assessedWalletCount;
  if (!Number.isInteger(count) || count == null || count < 1 || count > 10) return null;
  if (holders.top10PctIsFloor === true && count < 10) {
    return { kind: "floor", assessedWalletCount: count, sharePct: holders.top10Pct };
  }
  if (holders.top10PctIsFloor === false && count === 10) {
    return { kind: "top_10", assessedWalletCount: 10, sharePct: holders.top10Pct };
  }
  return null;
}

function holderDistributionExcerpt(
  holders: NonNullable<CollectedEvidence["holderProfile"]>,
): string {
  const basis = holderAggregateBasis(holders);
  if (basis?.kind === "floor") {
    return `At least ${basis.sharePct}% of supply was observed across ${basis.assessedWalletCount} assessed wallet${basis.assessedWalletCount === 1 ? "" : "s"}. The bounded register returned fewer than 10 usable wallet rows, so this is a floor and not a top-10 total.`;
  }
  if (basis?.kind === "top_10") {
    return `The bounded ordered register reported ${basis.sharePct}% of supply across 10 assessed wallets.`;
  }
  if (finite(holders.top10Pct)) {
    return "The frozen aggregate lacks a structural assessed-wallet count or floor flag, so it is not treated as a top-10 measurement.";
  }
  return holders.distributionNote ?? "No usable wallet-concentration aggregate was frozen.";
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function refsFromMeasurements(
  measurements: ReadonlyMap<string, IntelligenceMeasurement>,
  measurementIds: readonly string[],
): string[] {
  return uniqueSorted(measurementIds.flatMap((id) => measurements.get(id)?.sourceRefs ?? []));
}

function addNumber(
  measurements: IntelligenceMeasurement[],
  value: number | null | undefined,
  input: Omit<NumberIntelligenceMeasurement, "value" | "valueType">,
): void {
  if (!finite(value)) return;
  measurements.push({ ...input, valueType: "number", value });
}

function factSourceClass(source: BasicFactSource): IntelligenceSourceClass {
  switch (source.sourceClass) {
    case "official_subject": return "official_subject";
    case "official_counterparty": return "official_counterparty";
    case "regulatory_or_onchain": return "public_registry";
    case "independent_press": return "independent_publication";
    case "other_public": return "other_public";
  }
}

function addSnapshotSource(
  sources: IntelligenceSourceRef[],
  source: IntelligenceSourceRef | null,
): void {
  if (source) sources.push(source);
}

function sortedCorroboratedAudits(evidence: Readonly<CollectedEvidence>) {
  return (evidence.securityAudits?.corroborated ?? [])
    .map((audit, originalIndex) => ({ audit, originalIndex }))
    .sort((left, right) =>
      left.audit.auditor.localeCompare(right.audit.auditor)
      || left.audit.auditorUrl.localeCompare(right.audit.auditorUrl),
    );
}

function corroboratedAuditSourceId(index: number): string {
  return `audit:corroborated:${String(index + 1).padStart(2, "0")}`;
}

type CorroboratedAuditRow = NonNullable<CollectedEvidence["securityAudits"]>["corroborated"][number];

type AuditIdentityAnchorValidation =
  | { state: "matched" }
  | { state: "missing" }
  | { state: "invalid" };

function normalizedAuditContractIdentityValue(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const address = value.trim();
  if (!address || /\s/.test(address)) return null;
  return /^0x[a-f0-9]+$/i.test(address) ? address.toLowerCase() : address;
}

function canonicalAuditOfficialSiteHost(evidence: Readonly<CollectedEvidence>): string | null {
  if (evidence.projectToken?.verified === true && evidence.projectToken.homepage !== undefined) {
    return canonicalOfficialWebsite(evidence.projectToken.homepage)?.domain ?? null;
  }
  return canonicalOfficialWebsite(evidence.profile.website)?.domain ?? null;
}

function validatedAuditIdentityAnchor(
  audit: Readonly<CorroboratedAuditRow>,
  evidence: Readonly<CollectedEvidence>,
): AuditIdentityAnchorValidation {
  const anchor = audit.matchedIdentityAnchor;
  if (!anchor) return { state: "missing" };
  if (anchor.type === "canonical_contract") {
    if (evidence.projectToken?.verified !== true) return { state: "invalid" };
    const canonicalAddress = normalizedAuditContractIdentityValue(evidence.projectToken.address);
    const anchoredAddress = normalizedAuditContractIdentityValue(anchor.value);
    return canonicalAddress && anchoredAddress && canonicalAddress === anchoredAddress
      ? { state: "matched" }
      : { state: "invalid" };
  }
  const canonicalHost = canonicalAuditOfficialSiteHost(evidence);
  const anchoredHost = canonicalOfficialWebsite(anchor.value)?.domain ?? null;
  return canonicalHost && anchoredHost && canonicalHost === anchoredHost
    ? { state: "matched" }
    : { state: "invalid" };
}

function sortedAuditAttestations(evidence: Readonly<CollectedEvidence>) {
  return (evidence.securityAudits?.attestations ?? [])
    .map((attestation, originalIndex) => ({ attestation, originalIndex }))
    .sort((left, right) =>
      left.attestation.auditor.localeCompare(right.attestation.auditor)
      || left.attestation.origin.localeCompare(right.attestation.origin)
      || left.attestation.sourceUrl.localeCompare(right.attestation.sourceUrl),
    );
}

function auditLeadSourceId(index: number): string {
  return `audit:lead:${String(index + 1).padStart(2, "0")}`;
}

type FrozenSourceArtifact = CollectedEvidence["sourceArtifacts"][number];
type FrozenAxisEvidence = NonNullable<CollectedEvidence["axisEvidenceCatalog"]>[number];
type FrozenTrustConnection = NonNullable<CollectedEvidence["trustGraphScreen"]>["connections"][number];

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_PHOTO_REVIEW_LEADS = new Set([
  "studio_or_stock",
  "ai_generated",
  "celebrity_or_public_figure",
]);

function boundedText(value: string | undefined, limit = 500): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function sourceArtifactId(index: number): string {
  return `source-artifact:${String(index + 1).padStart(3, "0")}`;
}

function contradictionLeadSourceId(index: number): string {
  return `contradiction-lead:${String(index + 1).padStart(3, "0")}`;
}

function axisEvidenceSourceId(artifactId: string): string {
  return `axis-evidence:${encodeURIComponent(artifactId)}`;
}

function projectStrengthSourceId(axis: string): string {
  return `project-strength:${encodeURIComponent(axis)}`;
}

function axisAssessmentSourceId(axis: string): string {
  return `axis-assessment:${encodeURIComponent(axis)}`;
}

function sourceArtifactClass(artifact: Readonly<FrozenSourceArtifact>): IntelligenceSourceClass {
  if (artifact.sourceClass === "first_party_subject") return "official_subject";
  if (artifact.sourceClass === "first_party_investor" || artifact.sourceClass === "first_party_project") return "official_counterparty";
  if (artifact.sourceClass === "public_primary") return "public_registry";
  if (artifact.sourceClass === "independent_press") return "independent_publication";
  if (artifact.provider === "courtlistener" || artifact.provider === "opensanctions") return "public_registry";
  if (artifact.provider === "google-news") return "independent_publication";
  if (artifact.provider === "twitterapi") return "first_party_profile";
  if (artifact.provider === "argus-graph" || artifact.provider === "claude-vision") return "bounded_collection_record";
  return "other_public";
}

function isStrictFrozenFundScaleArtifact(
  artifact: Readonly<FrozenSourceArtifact>,
  evidence: Readonly<CollectedEvidence>,
): boolean {
  const capturedAt = new Date(artifact.capturedAt);
  return Number.isFinite(capturedAt.getTime())
    && isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts, {
      now: capturedAt,
      subjectHandle: evidence.profile.handle,
      profile: evidence.profile,
    });
}

// A strict fund-scale artifact is identity-bound and time-bound, but neither
// gate says anything about WHO published the amount. Only a regulatory basis
// is independent of the subject; a manager-reported figure sitting on the
// fund's own domain stays attributed context. The entity builder already
// treats the identical artifact this way, and the two must not assign the
// same record opposite epistemic tiers.
function fundScaleEvidenceState(
  artifact: Readonly<FrozenSourceArtifact>,
): IntelligenceSourceRef["evidenceState"] {
  return artifact.fundScaleBasis === "regulatory" ? "verified" : "reported_context";
}

function sourceArtifactState(
  artifact: Readonly<FrozenSourceArtifact>,
  evidence: Readonly<CollectedEvidence>,
): IntelligenceSourceRef["evidenceState"] {
  if (portfolioRelationshipBinding(artifact, evidence)) return "verified";
  if (isStrictFrozenFundScaleArtifact(artifact, evidence)) return fundScaleEvidenceState(artifact);
  if (artifact.coverageState === "unavailable" || artifact.match === "no_match" || artifact.match === "screened_clear") return "bounded";
  return "reported_context";
}

function sourceArtifactExcerpt(
  artifact: Readonly<FrozenSourceArtifact>,
  evidence: Readonly<CollectedEvidence>,
): string | undefined {
  const original = boundedText(artifact.excerpt, 420);
  if (artifact.kind === "legal_case" || artifact.kind === "sanctions_screen") {
    const qualifier = artifact.match === "exact_name" || artifact.match === "candidate"
      ? "This is a provider name-match lead only. It is not bound to the audited legal person or entity and is not an adverse finding."
      : "This is one bounded provider screen. A clear or empty result is not evidence that no legal or sanctions exposure exists.";
    return [original, qualifier].filter(Boolean).join(" ");
  }
  if (artifact.kind === "profile_photo") {
    return [original, "The classification is a provider-attributed visual screening opinion, not identity proof or a deception finding."].filter(Boolean).join(" ");
  }
  if (artifact.kind === "trust_graph") {
    return [original, "The graph record describes saved relationships only. A relationship does not establish participation, responsibility, or common control."].filter(Boolean).join(" ");
  }
  if (artifact.kind === "portfolio_relationship") {
    const binding = portfolioRelationshipBinding(artifact, evidence);
    const qualifier = binding === "audited_project"
      ? "The exact audited project handle is the object of this confirmed investment relationship. The relationship does not establish investor endorsement, current ownership, or project quality."
      : binding === "direct_subject"
        ? "The exact audited handle is the investor subject of this confirmed relationship. The relationship does not establish current ownership or investment outcome."
        : binding === "affiliated_fund"
          ? "The relationship is attributed to the separately named affiliated fund, not to the audited subject personally."
          : "The saved relationship is not exactly rebound to the audited handle in this derived layer.";
    return [original, qualifier].filter(Boolean).join(" ");
  }
  if (artifact.kind === "fund_scale") {
    const qualifier = isStrictFrozenFundScaleArtifact(artifact, evidence)
      ? "The amount passed the frozen fund-scale identity, source, metric, qualifier, and temporal gates. It describes the named fund or vehicle, not personal capital."
      : "The row does not pass the strict fund-scale gate and remains reported context only.";
    return [original, qualifier].filter(Boolean).join(" ");
  }
  return original;
}

function validTrustTie(tie: FrozenTrustConnection["ties"][number]): boolean {
  return tie.strength !== "weak"
    && Boolean(tie.key.trim() && tie.label.trim() && tie.type.trim())
    && tie.subjectEdgeTypes.length > 0
    && tie.otherEdgeTypes.length > 0
    && tie.subjectEdgeTypes.every((edge) => edge.trim().length > 0)
    && tie.otherEdgeTypes.every((edge) => edge.trim().length > 0);
}

function qualifiedAdverseTrustConnections(
  evidence: Readonly<CollectedEvidence>,
): Array<{ connection: FrozenTrustConnection; ties: FrozenTrustConnection["ties"] }> {
  const screen = evidence.trustGraphScreen;
  if (!screen || !SHA256_HEX.test(screen.sourceContentHash)) return [];
  return screen.connections.flatMap((connection) => {
    const adverseVerdict = connection.otherVerdict?.trim().toUpperCase();
    const ties = connection.ties.filter(validTrustTie);
    return connection.qualified === true
      && connection.otherAttestation === "server_collected"
      && connection.otherCompleteness === "complete"
      && (adverseVerdict === "FAIL" || adverseVerdict === "AVOID")
      && UUID.test(connection.otherReportVersionId ?? "")
      && ties.length > 0
      ? [{ connection, ties }]
      : [];
  });
}

function axisEvidenceIsVerifiedCounter(record: Readonly<FrozenAxisEvidence>, axis: string): boolean {
  return record.scope === "direct_subject"
    && record.verification === "verified"
    && SHA256_HEX.test(record.contentHash)
    && (record.counterEligibleAxes ?? []).includes(axis);
}

function projectAxisDomain(axis: string): IntelligenceDomain {
  if (axis.startsWith("P1_")) return "team";
  if (axis.startsWith("P2_")) return "product";
  if (axis.startsWith("P3_")) return "supply";
  if (axis.startsWith("P4_")) return "funding";
  if (axis.startsWith("P5_")) return "economics";
  if (axis.startsWith("P6_")) return "governance";
  return "identity";
}

const PUBLIC_STRENGTH_TIER: Record<string, string> = {
  none: "not enough evidence to assess",
  assessed_null: "checked, but no reliable supporting evidence was confirmed",
  adverse: "evidence raises concerns",
  emerging: "early or limited evidence",
  solid: "strong evidence",
  exceptional: "very strong evidence",
};

function publicStrengthBand(axis: string, tier: string, minimum: number, maximum: number): string {
  const range = minimum === maximum ? `${minimum} points` : `${minimum}–${maximum} points`;
  return `${axisLabel(axis)}: ${PUBLIC_STRENGTH_TIER[tier] ?? "evidence reviewed"} (${range})`;
}

function publicCalendarDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function buildSources(evidence: Readonly<CollectedEvidence>): IntelligenceSourceRef[] {
  const sources: IntelligenceSourceRef[] = [];
  const identityBindings = crossProducerIdentityBindings(evidence);
  const derivedLaunchWindow = recomputeLaunchWindow(
    evidence,
    identityBindings.domainRegistrationMatched,
    identityBindings.accountCreationReceiptComplete,
  );

  addSnapshotSource(sources, evidence.profile.profile_collection_state === "resolved" ? {
    id: "snapshot:profile",
    inputPath: "profile",
    provider: evidence.profile.profile_provider ?? "profile-provider",
    title: "Frozen subject profile",
    sourceClass: "first_party_profile",
    evidenceState: "reported_context",
    capturedAt: evidence.profile.profile_captured_at,
  } : null);

  addSnapshotSource(sources, evidence.profile.website && evidence.profile.site_substance_status ? {
    id: "snapshot:official-site-response",
    inputPath: "profile.site_substance_status",
    provider: "public-web-sitecheck",
    title: "Frozen official-site response classification",
    sourceClass: "official_subject",
    evidenceState: "bounded",
    sourceUrl: evidence.profile.website,
    excerpt: `ARGUS recorded site response state ${evidence.profile.site_substance_status}. This describes the bounded website response only and does not establish that a product is live, usable, solvent, or controlled by the audited operator.`,
  } : null);

  addSnapshotSource(sources, evidence.profile.x_account_status_source_url || evidence.profile.x_account_status_captured_at ? {
    id: "snapshot:x-account-status",
    inputPath: "profile.x_account_status",
    provider: evidence.profile.profile_provider ?? "public-x-profile",
    title: "Frozen official X account-state observation",
    sourceClass: "first_party_profile",
    evidenceState: "bounded",
    sourceUrl: evidence.profile.x_account_status_source_url,
    capturedAt: evidence.profile.x_account_status_captured_at,
  } : null);

  const tokenIdentitySource = evidence.projectToken?.producerSources?.identity;
  addSnapshotSource(sources, evidence.projectToken ? {
    id: "snapshot:project-token",
    inputPath: "projectToken",
    provider: tokenIdentitySource?.provider ?? evidence.projectToken.providers?.[0] ?? "canonical-market-registry",
    title: identityBindings.canonicalTokenVerified
      ? "Identity-bound canonical token record"
      : "Unverified canonical-token candidate receipt",
    sourceClass: "canonical_market_registry",
    evidenceState: identityBindings.canonicalTokenVerified ? "measured" : "bounded",
    sourceUrl: tokenIdentitySource?.sourceUrl ?? evidence.projectToken.sourceUrl,
    capturedAt: tokenIdentitySource?.capturedAt ?? evidence.projectToken.capturedAt,
    providerUpdatedAt: tokenIdentitySource?.providerUpdatedAt,
  } : null);
  addSnapshotSource(sources, evidence.projectToken?.producerSources?.market ? {
    id: "snapshot:project-token-market",
    inputPath: "projectToken.producerSources.market",
    provider: evidence.projectToken.producerSources.market.provider,
    title: identityBindings.canonicalTokenVerified
      ? "Canonical token market producer record"
      : "Market producer receipt for an unverified token candidate",
    sourceClass: "canonical_market_registry",
    evidenceState: identityBindings.canonicalTokenVerified ? "measured" : "bounded",
    sourceUrl: evidence.projectToken.producerSources.market.sourceUrl,
    capturedAt: evidence.projectToken.producerSources.market.capturedAt,
    providerUpdatedAt: evidence.projectToken.producerSources.market.providerUpdatedAt,
  } : null);
  addSnapshotSource(sources, evidence.projectToken?.producerSources?.liquidity ? {
    id: "snapshot:project-token-liquidity",
    inputPath: "projectToken.producerSources.liquidity",
    provider: evidence.projectToken.producerSources.liquidity.provider,
    title: identityBindings.canonicalTokenVerified
      ? "Canonical pair liquidity producer record"
      : "Liquidity producer receipt for an unverified token candidate",
    sourceClass: "onchain_data_provider",
    evidenceState: identityBindings.canonicalTokenVerified ? "measured" : "bounded",
    sourceUrl: evidence.projectToken.producerSources.liquidity.sourceUrl,
    capturedAt: evidence.projectToken.producerSources.liquidity.capturedAt,
  } : null);
  addSnapshotSource(sources, evidence.projectToken?.producerSources?.history ? {
    id: "snapshot:project-token-history",
    inputPath: "projectToken.producerSources.history",
    provider: evidence.projectToken.producerSources.history.provider,
    title: identityBindings.canonicalTokenVerified
      ? "Frozen canonical-pair OHLCV producer record"
      : "OHLCV producer receipt for an unverified token candidate",
    sourceClass: "onchain_data_provider",
    evidenceState: "bounded",
    sourceUrl: evidence.projectToken.producerSources.history.sourceUrl,
    capturedAt: evidence.projectToken.producerSources.history.capturedAt,
  } : null);

  const evmControl = evidence.evmControlReality;
  const evmChainIdentityVerified = evmControl?.chainIdentity?.state === "verified"
    && evmControl.chainIdentity.observedChainId === evmControl.chainIdentity.expectedChainId;
  addSnapshotSource(sources, evmControl ? {
    id: "snapshot:evm-control-reality",
    inputPath: "evmControlReality",
    provider: evidence.evmControlReality.capture?.providerHost
      ?? evidence.evmControlReality.chainIdentity?.providerHost
      ?? "public-evm-rpc",
    title: identityBindings.evmControlMatched
      ? "Fixed-block standard EVM control read"
      : "Unbound fixed-block EVM control-read receipt",
    sourceClass: "direct_chain_rpc",
    evidenceState: "bounded",
    capturedAt: evidence.evmControlReality.capture?.blockTimestamp,
    excerpt: !identityBindings.evmControlMatched
      ? `The saved control read targets ${evidence.evmControlReality.chain}:${evidence.evmControlReality.target}, which does not exactly rebind to the verified canonical token address and chain. The receipt is retained, but its control fields are withheld from subject-level intelligence.`
      : evidence.evmControlReality.state === "observed"
      ? `${evmChainIdentityVerified ? `The endpoint preflight verified ${evidence.evmControlReality.chainIdentity?.observedChainId} for ${evidence.evmControlReality.chain}.` : "No saved verified chain-identity receipt accompanies this read, so its network binding is unresolved."} At block ${evidence.evmControlReality.capture?.blockNumber ?? "unknown"}, the bounded standard-interface scan recorded ${evidence.evmControlReality.proxy?.implementationCandidates.length ?? 0} implementation candidate(s), ${evidence.evmControlReality.authorities.length} authority address(es), and ${evidence.evmControlReality.safeCompatibleMultisigs.filter((multisig) => multisig.state === "observed").length} observed Safe-compatible interface response(s). Custom roles and nonstandard paths remain outside this read.`
      : `${evidence.evmControlReality.note ?? "The fixed-block standard EVM control read did not produce an observed contract surface."}${evidence.evmControlReality.chainIdentity ? ` Chain identity preflight: expected ${evidence.evmControlReality.chainIdentity.expectedChainId}, observed ${evidence.evmControlReality.chainIdentity.observedChainId ?? "no decodable chain id"}, state ${evidence.evmControlReality.chainIdentity.state}.` : ""}`,
    ...(evidence.evmControlReality.capture?.blockHash
      ? { contentHashes: [evidence.evmControlReality.capture.blockHash] }
      : {}),
  } : null);

  addSnapshotSource(sources, evidence.protocolTvl ? {
    id: "snapshot:protocol-tvl",
    inputPath: "protocolTvl",
    provider: "defillama",
    title: identityBindings.protocolTvlMatched
      ? "Frozen identity-bound protocol TVL snapshot"
      : "Unbound protocol TVL receipt",
    sourceClass: "protocol_index",
    evidenceState: identityBindings.protocolTvlMatched ? "measured" : "bounded",
    sourceUrl: evidence.protocolTvl.sourceUrl,
    capturedAt: evidence.protocolTvl.capturedAt,
    excerpt: identityBindings.protocolTvlMatched
      ? `Protocol CoinGecko id ${evidence.protocolTvl.geckoId} exactly matches the verified canonical token.`
      : `Protocol CoinGecko id ${evidence.protocolTvl.geckoId ?? "missing"} does not exactly match the verified canonical token id ${identityBindings.canonicalGeckoId ?? "missing"}; protocol measurements are withheld.`,
  } : null);

  addSnapshotSource(sources, evidence.protocolFees ? {
    id: "snapshot:protocol-fees",
    inputPath: "protocolFees",
    provider: "defillama",
    title: identityBindings.protocolFeesMatched
      ? "Frozen fees snapshot for an identity-bound protocol record"
      : "Unbound protocol-fees receipt",
    sourceClass: "protocol_index",
    evidenceState: identityBindings.protocolFeesMatched ? "measured" : "bounded",
    sourceUrl: evidence.protocolFees.sourceUrl,
    capturedAt: evidence.protocolFees.capturedAt,
    excerpt: identityBindings.protocolFeesMatched
      ? `Fee slug ${evidence.protocolFees.slug} exactly matches an identity-bound protocol record.`
      : identityBindings.protocolFeesReceiptComplete
        ? `Fee slug ${evidence.protocolFees.slug} has no exact same-slug match among protocol records rebound to the verified canonical token; fee measurements are withheld.`
        : "The fee row lacks the complete matched-protocol CoinGecko identity receipt required for subject-level use; fee measurements are withheld.",
  } : null);

  addSnapshotSource(sources, evidence.holderProfile ? {
    id: "snapshot:holder-profile",
    inputPath: "holderProfile",
    provider: "goplus",
    title: identityBindings.holderProfileMatched
      ? "Frozen canonical token holder profile"
      : "Unbound token-holder profile receipt",
    sourceClass: "onchain_data_provider",
    evidenceState: "bounded",
    sourceUrl: evidence.holderProfile.sourceUrl,
    capturedAt: evidence.holderProfile.sourceCapturedAt ?? evidence.holderProfile.capturedAt,
    excerpt: !identityBindings.holderProfileMatched
      ? "The holder sidecar lacks an exact canonical_token_address_chain binding to the verified token. Holder, liquidity-lock, control-flag, and concentration fields are withheld."
      : evidence.holderProfile.distributionSource === "explorer"
        ? "GoPlus supplied the frozen holder-count, liquidity, and contract-control context. The wallet-concentration aggregate came from the separately cited explorer register."
        : holderDistributionExcerpt(evidence.holderProfile),
  } : null);
  addSnapshotSource(sources, evidence.holderProfile?.distributionSource === "explorer" && evidence.holderProfile.distributionSourceUrl ? {
    id: "snapshot:holder-distribution",
    inputPath: "holderProfile.distributionSourceUrl",
    provider: "blockscout",
    title: identityBindings.holderProfileMatched
      ? "Frozen ordered explorer holder register"
      : "Unbound ordered explorer holder-register receipt",
    sourceClass: "onchain_data_provider",
    evidenceState: "bounded",
    sourceUrl: evidence.holderProfile.distributionSourceUrl,
    capturedAt: evidence.holderProfile.distributionCapturedAt,
    excerpt: identityBindings.holderProfileMatched
      ? holderDistributionExcerpt(evidence.holderProfile)
      : "The ordered register is retained as a bounded receipt but is not admitted because its parent holder profile does not exactly rebind to the verified token.",
  } : null);

  for (const [findingIndex, finding] of evidence.findings.entries()) {
    if (!findingTargetsAuditedSubject(finding, evidence.profile.handle)) continue;
    sources.push({
      id: `finding:${String(findingIndex + 1).padStart(3, "0")}`,
      inputPath: `findings.${findingIndex}`,
      provider: finding.provider ?? "frozen-finding",
      title: `Frozen ${finding.finding_type.replaceAll("_", " ")} finding`,
      sourceClass: "other_public",
      evidenceState: finding.artifact_verified === true
        && finding.verification_status.toLowerCase() === "verified"
        && finding.independent_source_count >= 1
        && findingHasEligibleArtifact(finding)
        ? "verified"
        : "reported_context",
      sourceUrl: finding.source_url || undefined,
      publishedAt: finding.source_date || undefined,
      ...(/^[a-f0-9]{64}$/i.test(finding.content_hash ?? "") ? { contentHashes: [finding.content_hash!] } : {}),
    });
  }

  addSnapshotSource(sources, evidence.tokenUnlocks ? {
    id: "snapshot:token-unlocks",
    inputPath: "tokenUnlocks",
    provider: "cryptorank",
    title: identityBindings.tokenUnlocksMatched
      ? "Frozen identity-bound token unlock schedule"
      : "Unbound token-unlock schedule receipt",
    sourceClass: "vesting_data_provider",
    evidenceState: identityBindings.tokenUnlocksMatched ? "reported_context" : "bounded",
    sourceUrl: evidence.tokenUnlocks.sourceUrl,
    capturedAt: evidence.tokenUnlocks.capturedAt,
    excerpt: identityBindings.tokenUnlocksMatched
      ? `CryptoRank currency ${evidence.tokenUnlocks.currencyId} joined the canonical ${evidence.tokenUnlocks.chain} contract ${evidence.tokenUnlocks.canonicalAddress}.`
      : identityBindings.tokenUnlockReceiptComplete
        ? `The complete CryptoRank receipt maps to ${evidence.tokenUnlocks.chain}:${evidence.tokenUnlocks.canonicalAddress}, which does not exactly match the verified canonical token address and chain. Schedule measurements are withheld.`
        : "Legacy or incomplete unlock snapshot without currency id, both exact endpoint receipts, canonical address, and canonical chain. Schedule measurements are withheld.",
  } : null);
  addSnapshotSource(sources, evidence.tokenUnlocks?.contractSourceUrl ? {
    id: "snapshot:token-unlock-contract-map",
    inputPath: "tokenUnlocks.contractSourceUrl",
    provider: "cryptorank",
    title: identityBindings.tokenUnlocksMatched
      ? "Frozen CryptoRank canonical contract-map response"
      : "CryptoRank contract-map receipt pending identity revalidation",
    sourceClass: "vesting_data_provider",
    evidenceState: "bounded",
    sourceUrl: evidence.tokenUnlocks.contractSourceUrl,
    capturedAt: evidence.tokenUnlocks.capturedAt,
    excerpt: identityBindings.tokenUnlocksMatched
      ? `Currency ${evidence.tokenUnlocks.currencyId} mapped exactly once to ${evidence.tokenUnlocks.chain}:${evidence.tokenUnlocks.canonicalAddress}, matching the verified canonical token.`
      : "This contract-map receipt is retained as bounded provenance, but it does not complete an exact join to the verified canonical token.",
  } : null);
  addSnapshotSource(sources, evidence.tokenUnlocks?.eventsSourceUrl ? {
    id: "snapshot:token-unlock-events",
    inputPath: "tokenUnlocks.eventsSourceUrl",
    provider: "cryptorank",
    title: identityBindings.tokenUnlocksMatched
      ? "Frozen CryptoRank vesting-events response"
      : "CryptoRank vesting-events receipt pending identity revalidation",
    sourceClass: "vesting_data_provider",
    evidenceState: identityBindings.tokenUnlocksMatched ? "reported_context" : "bounded",
    sourceUrl: evidence.tokenUnlocks.eventsSourceUrl,
    capturedAt: evidence.tokenUnlocks.capturedAt,
    excerpt: identityBindings.tokenUnlocksMatched
      ? `The vesting-events response belongs to matched CryptoRank currency ${evidence.tokenUnlocks.currencyId}.`
      : "This events receipt is retained as bounded provenance, but it is not admitted as a subject-level unlock schedule.",
  } : null);

  addSnapshotSource(sources, evidence.securityAudits ? {
    id: "snapshot:security-audits",
    inputPath: "securityAudits",
    provider: "security-audit-corroboration",
    title: "Frozen bounded audit provenance check",
    sourceClass: "bounded_collection_record",
    evidenceState: "bounded",
    capturedAt: evidence.securityAudits.capturedAt,
  } : null);
  const auditAttestations = sortedAuditAttestations(evidence);
  auditAttestations.forEach(({ attestation, originalIndex }, index) => {
    sources.push({
      id: auditLeadSourceId(index),
      inputPath: `securityAudits.attestations.${originalIndex}`,
      provider: "security-audit-corroboration",
      title: attestation.origin === "subject_page"
        ? `Subject-published audit lead: ${attestation.auditor}`
        : `Curated audit-link lead: ${attestation.auditor}`,
      sourceClass: attestation.origin === "subject_page" ? "official_subject" : "other_public",
      evidenceState: "reported_context",
      sourceUrl: attestation.sourceUrl,
      capturedAt: evidence.securityAudits?.capturedAt,
    });
  });
  const auditorsWithExactRows = new Set([
    ...auditAttestations.map(({ attestation }) => attestation.auditor.trim().toLowerCase()),
    ...sortedCorroboratedAudits(evidence).map(({ audit }) => audit.auditor.trim().toLowerCase()),
  ]);
  const hasLegacyOnlyAuditLead = (evidence.securityAudits?.selfAttested ?? [])
    .some((auditor) => auditor.trim() && !auditorsWithExactRows.has(auditor.trim().toLowerCase()));
  if (evidence.securityAudits?.securityPageUrl && hasLegacyOnlyAuditLead) {
    sources.push({
      id: "audit:lead:legacy",
      inputPath: "securityAudits.securityPageUrl",
      provider: "security-audit-corroboration",
      title: "Legacy audit lead source, origin not preserved",
      sourceClass: "other_public",
      evidenceState: "reported_context",
      sourceUrl: evidence.securityAudits.securityPageUrl,
      capturedAt: evidence.securityAudits.capturedAt,
    });
  }
  sortedCorroboratedAudits(evidence).forEach(({ audit, originalIndex }, index) => {
    const anchorValidation = validatedAuditIdentityAnchor(audit, evidence);
    const identityAnchored = anchorValidation.state === "matched";
    const matchingFactSource = (evidence.basicFacts ?? [])
      .filter((fact) =>
        fact.predicate === "audit"
        && factTargetsAuditedSubject(fact, evidence.profile.handle),
      )
      .flatMap((fact) => fact.sources)
      .find((source) =>
        source.url === audit.auditorUrl
        && source.relation === "supports"
        && source.excerpt.trim() === audit.excerpt.trim(),
      );
    sources.push({
      id: corroboratedAuditSourceId(index),
      inputPath: `securityAudits.corroborated.${originalIndex}`,
      provider: "security-audit-corroboration",
      title: identityAnchored
        ? `${audit.auditor} identity-anchored engagement record`
        : anchorValidation.state === "missing"
          ? `Legacy auditor-domain audit lead: ${audit.auditor}`
          : `Identity-mismatched auditor-domain audit lead: ${audit.auditor}`,
      sourceClass: identityAnchored ? "official_counterparty" : "other_public",
      evidenceState: identityAnchored ? "bounded" : "reported_context",
      sourceUrl: audit.auditorUrl,
      capturedAt: evidence.securityAudits?.capturedAt,
      excerpt: identityAnchored
        ? `${audit.excerpt} Identity anchor: ${audit.matchedIdentityAnchor!.type.replaceAll("_", " ")} ${audit.matchedIdentityAnchor!.value}.`
        : anchorValidation.state === "missing"
          ? `${audit.excerpt} This legacy row preserves no canonical official-domain or contract identity anchor, so it remains a reported audit lead.`
          : `${audit.excerpt} Its saved ${audit.matchedIdentityAnchor!.type.replaceAll("_", " ")} anchor does not exactly match the verified canonical subject identity frozen in this scan, so it remains a reported audit lead.`,
      ...(identityAnchored && matchingFactSource ? { contentHashes: [matchingFactSource.contentHash] } : {}),
    });
  });

  addSnapshotSource(sources, evidence.protocolFunding ? {
    id: "snapshot:protocol-funding",
    inputPath: "protocolFunding",
    provider: "defillama",
    title: identityBindings.protocolFundingMatched
      ? "Frozen identity-bound public funding snapshot"
      : "Unbound protocol-funding receipt",
    sourceClass: "protocol_index",
    evidenceState: identityBindings.protocolFundingMatched ? "reported_context" : "bounded",
    sourceUrl: evidence.protocolFunding.sourceUrl,
    capturedAt: evidence.protocolFunding.capturedAt,
    excerpt: identityBindings.protocolFundingMatched
      ? `Protocol CoinGecko id ${evidence.protocolFunding.geckoId} exactly matches the verified canonical token.`
      : `Protocol CoinGecko id ${evidence.protocolFunding.geckoId ?? "missing"} does not exactly match the verified canonical token id ${identityBindings.canonicalGeckoId ?? "missing"}; funding measurements are withheld.`,
  } : null);

  addSnapshotSource(sources, evidence.companyEnrichment ? {
    id: "snapshot:company-enrichment",
    inputPath: "companyEnrichment",
    provider: "licensed-company-enrichment",
    title: identityBindings.companyEnrichmentMatched
      ? "Frozen official-domain-bound company enrichment"
      : "Unbound company-enrichment receipt",
    sourceClass: "licensed_enrichment",
    evidenceState: identityBindings.companyEnrichmentMatched ? "reported_context" : "bounded",
    sourceUrl: isCompleteHttpReceipt(evidence.companyEnrichment.sourceUrl)
      ? evidence.companyEnrichment.sourceUrl
      : undefined,
    capturedAt: evidence.companyEnrichment.capturedAt,
    excerpt: identityBindings.companyEnrichmentMatched
      ? `The licensed record requested ${identityBindings.companyRequestedHost}, matched ${identityBindings.companyMatchedHost}, and used ${evidence.companyEnrichment.matchMethod}; both hosts rebind to canonical official host ${identityBindings.canonicalCompanyHost}.`
      : `The licensed receipt reports identity state ${evidence.companyEnrichment.identityMatch ?? "missing"}, requested host ${identityBindings.companyRequestedHost ?? "missing"}, matched host ${identityBindings.companyMatchedHost ?? "missing"}, and method ${evidence.companyEnrichment.matchMethod ?? "missing"}. It does not carry a complete exact official-domain binding to canonical host ${identityBindings.canonicalCompanyHost ?? "missing"}, so every company field is withheld.`,
  } : null);

  addSnapshotSource(sources, evidence.domainRegistration ? {
    id: "snapshot:domain-registration",
    inputPath: "domainRegistration",
    provider: "rdap",
    title: identityBindings.domainRegistrationMatched
      ? "Frozen official-domain registration record"
      : "Unbound domain-registration receipt",
    sourceClass: "public_registry",
    evidenceState: "bounded",
    sourceUrl: isCompleteHttpReceipt(evidence.domainRegistration.source)
      ? evidence.domainRegistration.source
      : undefined,
    capturedAt: evidence.domainRegistration.capturedAt,
    excerpt: identityBindings.domainRegistrationMatched
      ? `RDAP registrable domain ${identityBindings.registeredDomain} exactly rebinds through saved queried hostname ${identityBindings.registeredHostname} to canonical official host ${identityBindings.canonicalDomainHost}.`
      : `The RDAP receipt names registrable domain ${identityBindings.registeredDomain ?? "missing"} and queried hostname ${identityBindings.registeredHostname ?? "missing"}, which do not form a complete exact binding to canonical official host ${identityBindings.canonicalDomainHost ?? "missing"}. Domain-age and launch-window fields are withheld.`,
  } : null);

  addSnapshotSource(sources, evidence.profile.account_created_at ? {
    id: "snapshot:account-created-at",
    inputPath: "profile.account_created_at",
    provider: evidence.profile.profile_provider ?? "profile-provider",
    title: identityBindings.accountCreationReceiptComplete
      ? "Frozen official account-creation timestamp"
      : "Unbound account-creation timestamp receipt",
    sourceClass: "first_party_profile",
    evidenceState: "bounded",
    sourceUrl: isCompleteHttpReceipt(evidence.profile.x_account_status_source_url)
      ? evidence.profile.x_account_status_source_url
      : undefined,
    capturedAt: evidence.profile.profile_captured_at,
    excerpt: identityBindings.accountCreationReceiptComplete
      ? `The resolved profile record reports account creation at ${new Date(evidence.profile.account_created_at).toISOString()}.`
      : "An account-creation value is saved, but the record lacks a resolved profile state, valid capture timestamp, or chronological consistency, so it is not admitted to launch-window arithmetic.",
  } : null);

  const launchCapturedAt = [evidence.domainRegistration?.capturedAt, evidence.profile.profile_captured_at]
    .filter(validFrozenTime)
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1);
  addSnapshotSource(sources, derivedLaunchWindow || evidence.launchWindow ? {
    id: "snapshot:launch-window",
    inputPath: derivedLaunchWindow
      ? "derived(domainRegistration,profile.account_created_at)"
      : "launchWindow",
    provider: "argus-chronology",
    title: derivedLaunchWindow
      ? "Deterministically recomputed account and domain public-footprint window"
      : "Unbound saved launch-window receipt",
    sourceClass: "bounded_collection_record",
    evidenceState: "bounded",
    capturedAt: launchCapturedAt,
    excerpt: derivedLaunchWindow?.summary
      ?? `${evidence.launchWindow!.summary} The saved comparison is retained as a receipt, but its canonical RDAP and resolved-account inputs cannot be reproduced, so none of its dates or gap values are admitted.`,
  } : null);

  addSnapshotSource(sources, evidence.leaderDepartures !== undefined ? {
    id: "snapshot:leader-departures",
    inputPath: "leaderDepartures",
    provider: "licensed-employment-enrichment",
    title: "Frozen named-leader employment check",
    sourceClass: "licensed_enrichment",
    evidenceState: "reported_context",
  } : null);

  for (const [factIndex, fact] of (evidence.basicFacts ?? []).entries()) {
    if (!factTargetsAuditedSubject(fact, evidence.profile.handle)) continue;
    supportingFactSources(fact).forEach(({ source, originalIndex }, sortedIndex) => {
      sources.push({
        id: factSupportSourceId(fact.factId, sortedIndex),
        inputPath: `basicFacts.${factIndex}.sources.${originalIndex}`,
        provider: source.provider,
        title: source.title ?? `${fact.predicate} source`,
        sourceClass: factSourceClass(source),
        evidenceState: isStrictSourceBackedFact(fact) && source.artifactVerified === true
          ? "verified"
          : "reported_context",
        relation: "supports",
        sourceUrl: source.url,
        capturedAt: source.capturedAt,
        factId: fact.factId,
        excerpt: source.excerpt,
        contentHashes: [source.contentHash],
      });
    });
    contradictingFactSources(fact).forEach(({ source, originalIndex }, sortedIndex) => {
      sources.push({
        id: factContradictionSourceId(fact.factId, sortedIndex),
        inputPath: `basicFacts.${factIndex}.sources.${originalIndex}`,
        provider: source.provider,
        title: source.title ?? `${fact.predicate} contradiction source`,
        sourceClass: factSourceClass(source),
        evidenceState: factSourceHasEligibleArtifact(source) ? "verified" : "reported_context",
        relation: "contradicts",
        sourceUrl: source.url,
        capturedAt: source.capturedAt,
        factId: fact.factId,
        excerpt: source.excerpt,
        contentHashes: [source.contentHash],
      });
    });
  }

  for (const [artifactIndex, artifact] of evidence.sourceArtifacts.entries()) {
    const hashes = uniqueSorted([
      ...(SHA256_HEX.test(artifact.contentHash) ? [artifact.contentHash.toLowerCase()] : []),
      ...(SHA256_HEX.test(artifact.sourceContentHash ?? "") ? [artifact.sourceContentHash!.toLowerCase()] : []),
    ]);
    sources.push({
      id: sourceArtifactId(artifactIndex),
      inputPath: `sourceArtifacts.${artifactIndex}`,
      provider: artifact.provider,
      title: artifact.title,
      sourceClass: sourceArtifactClass(artifact),
      evidenceState: sourceArtifactState(artifact, evidence),
      sourceUrl: isCompleteHttpReceipt(artifact.sourceUrl) ? artifact.sourceUrl : undefined,
      capturedAt: artifact.capturedAt,
      publishedAt: artifact.publishedAt,
      excerpt: sourceArtifactExcerpt(artifact, evidence),
      ...(hashes.length > 0 ? { contentHashes: hashes } : {}),
    });
  }

  addSnapshotSource(sources, evidence.profileAuthenticity ? {
    id: "snapshot:profile-authenticity",
    inputPath: "profileAuthenticity",
    provider: evidence.profileAuthenticity.provider,
    title: "Frozen provider-attributed profile-image screen",
    sourceClass: evidence.profileAuthenticity.provider === "twitterapi"
      ? "first_party_profile"
      : "bounded_collection_record",
    evidenceState: "reported_context",
    sourceUrl: isCompleteHttpReceipt(evidence.profileAuthenticity.imageUrl)
      ? evidence.profileAuthenticity.imageUrl
      : undefined,
    capturedAt: evidence.profileAuthenticity.capturedAt,
    excerpt: `${boundedText(evidence.profileAuthenticity.note, 420) ?? "A profile-image screening result was saved."} This is a ${evidence.profileAuthenticity.provider} visual-screening classification, not identity proof or an ARGUS deception finding.`,
    ...(SHA256_HEX.test(evidence.profileAuthenticity.imageContentHash ?? "")
      ? { contentHashes: [evidence.profileAuthenticity.imageContentHash!.toLowerCase()] }
      : {}),
  } : null);

  addSnapshotSource(sources, evidence.trustGraphScreen ? {
    id: "snapshot:trust-graph-screen",
    inputPath: "trustGraphScreen",
    provider: evidence.trustGraphScreen.provider,
    title: "Frozen organization-scoped relationship reconciliation",
    sourceClass: "bounded_collection_record",
    evidenceState: evidence.trustGraphScreen.status === "incomplete" ? "bounded" : "reported_context",
    capturedAt: evidence.trustGraphScreen.capturedAt,
    excerpt: `${boundedText(evidence.trustGraphScreen.line, 420) ?? "A trust-graph screen was saved."} Relationships do not establish participation, responsibility, or common control.`,
    ...(SHA256_HEX.test(evidence.trustGraphScreen.sourceContentHash)
      ? { contentHashes: [evidence.trustGraphScreen.sourceContentHash.toLowerCase()] }
      : {}),
  } : null);

  for (const [contradictionIndex, contradiction] of evidence.contradictions.entries()) {
    sources.push({
      id: contradictionLeadSourceId(contradictionIndex),
      inputPath: `contradictions.${contradictionIndex}`,
      provider: "analyst-contradiction-review",
      title: "Analyst-reported contradiction lead",
      sourceClass: "bounded_collection_record",
      evidenceState: "reported_context",
      excerpt: `Reported claim: ${boundedText(contradiction.claim, 220) ?? "missing"}. Reported conflict: ${boundedText(contradiction.conflict, 220) ?? "missing"}. This row carries no artifact references, so it remains a review lead and is not treated as a verified conflict.`,
    });
  }

  for (const [catalogIndex, artifact] of (evidence.axisEvidenceCatalog ?? []).entries()) {
    sources.push({
      id: axisEvidenceSourceId(artifact.artifactId),
      inputPath: `axisEvidenceCatalog.${catalogIndex}`,
      provider: artifact.provider,
      title: `Frozen scorer-packet record: ${artifact.title}`,
      sourceClass: "bounded_collection_record",
      evidenceState: artifact.verification === "verified"
        ? "verified"
        : artifact.verification === "reported"
          ? "reported_context"
          : "bounded",
      sourceUrl: isCompleteHttpReceipt(artifact.sourceUrl) ? artifact.sourceUrl : undefined,
      capturedAt: artifact.capturedAt,
      excerpt: boundedText(artifact.excerpt, 500),
      ...(SHA256_HEX.test(artifact.contentHash)
        ? { contentHashes: [artifact.contentHash.toLowerCase()] }
        : {}),
    });
  }

  for (const [axisIndex, assessment] of evidence.axes.entries()) {
    const gaps = (assessment.gaps ?? []).map((gap) => boundedText(gap, 180)).filter((gap): gap is string => Boolean(gap));
    sources.push({
      id: axisAssessmentSourceId(assessment.axis),
      inputPath: `axes.${axisIndex}`,
      provider: "analyst-scoring",
      title: `Frozen analyst assessment for ${assessment.axis}`,
      sourceClass: "bounded_collection_record",
      evidenceState: "reported_context",
      excerpt: `${boundedText(assessment.rationale, 260) ?? "No rationale was retained."}${gaps.length > 0 ? ` Open questions: ${gaps.join(" ")}` : ""}`,
    });
  }

  for (const [axis, band] of Object.entries(evidence.projectStrengthBands ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    const reasons = band.reasons.map((reason) => boundedText(reason, 180)).filter((reason): reason is string => Boolean(reason));
    sources.push({
      id: projectStrengthSourceId(axis),
      inputPath: `projectStrengthBands.${axis}`,
      provider: "argus-project-strength-band",
      title: `Frozen evidence-strength band for ${axis}`,
      sourceClass: "bounded_collection_record",
      evidenceState: "reported_context",
      excerpt: `The deterministic scorer-packet band is ${band.tier}, range ${band.minScore} to ${band.maxScore}${band.floorTier ? `, verified-record floor tier ${band.floorTier}` : ""}. ${reasons.join(" ")}`.trim(),
    });
  }

  return sources.sort((left, right) => left.id.localeCompare(right.id));
}

function buildMeasurements(evidence: Readonly<CollectedEvidence>): IntelligenceMeasurement[] {
  const measurements: IntelligenceMeasurement[] = [];
  const entityKey = evidence.profile.handle;
  const token = evidence.projectToken;
  const identityBindings = crossProducerIdentityBindings(evidence);
  const derivedLaunchWindow = recomputeLaunchWindow(
    evidence,
    identityBindings.domainRegistrationMatched,
    identityBindings.accountCreationReceiptComplete,
  );

  if (token && identityBindings.canonicalTokenVerified) {
    const identityRefs = ["snapshot:project-token"];
    const marketRefs = token.producerSources?.market ? ["snapshot:project-token-market"] : identityRefs;
    const liquidityRefs = token.producerSources?.liquidity ? ["snapshot:project-token-liquidity"] : identityRefs;
    const historyRefs = token.producerSources?.history ? ["snapshot:project-token-history"] : marketRefs;
    const marketCapturedAt = token.producerSources?.market?.capturedAt ?? token.capturedAt;
    const liquidityCapturedAt = token.producerSources?.liquidity?.capturedAt ?? token.capturedAt;
    addNumber(measurements, token.priceUsd, { id: "token_price_usd", domain: "market", label: "Canonical token price", unit: "usd", entityKey, evidenceState: "measured", sourceRefs: marketRefs });
    addNumber(measurements, token.marketCapUsd, { id: "market_cap_usd", domain: "market", label: "Market capitalization", unit: "usd", entityKey, window: { kind: "instant", asOf: marketCapturedAt }, evidenceState: "measured", sourceRefs: marketRefs });
    addNumber(measurements, token.fdvUsd, { id: "fdv_usd", domain: "market", label: "Fully diluted valuation", unit: "usd", entityKey, window: { kind: "instant", asOf: marketCapturedAt }, evidenceState: "measured", sourceRefs: marketRefs });
    addNumber(measurements, token.volume24hUsd, { id: "volume_24h_usd", domain: "liquidity", label: "Reported 24 hour trading volume", unit: "usd", entityKey, window: { kind: "trailing", days: 1, asOf: marketCapturedAt }, evidenceState: "measured", sourceRefs: marketRefs });
    addNumber(measurements, token.liquidityUsd, { id: "liquidity_usd", domain: "liquidity", label: "Observed pool liquidity", unit: "usd", entityKey, chain: token.chain, window: { kind: "instant", asOf: liquidityCapturedAt }, evidenceState: "measured", sourceRefs: liquidityRefs });
    addNumber(measurements, token.circulatingSupply, { id: "circulating_supply", domain: "supply", label: "Reported circulating supply", unit: "count", entityKey, window: { kind: "instant", asOf: marketCapturedAt }, evidenceState: "reported_context", sourceRefs: marketRefs });
    addNumber(measurements, token.totalSupply, { id: "total_supply", domain: "supply", label: "Reported total supply", unit: "count", entityKey, window: { kind: "instant", asOf: marketCapturedAt }, evidenceState: "reported_context", sourceRefs: marketRefs });
    addNumber(measurements, token.maxSupply, { id: "max_supply", domain: "supply", label: "Reported maximum supply", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: marketRefs });
    if (
      finite(token.circulatingSupply)
      && token.circulatingSupply >= 0
      && positive(token.totalSupply)
      && token.circulatingSupply <= token.totalSupply
    ) {
      addNumber(measurements, rounded((token.circulatingSupply / token.totalSupply) * 100), {
        id: "circulating_supply_pct",
        domain: "supply",
        label: "Reported circulating share of total supply",
        unit: "percent",
        entityKey,
        denominatorMeasurementId: "total_supply",
        window: { kind: "instant", asOf: marketCapturedAt },
        evidenceState: "reported_context",
        sourceRefs: marketRefs,
      });
    }
    if (token.ath) {
      addNumber(measurements, token.ath.priceUsd, { id: "reported_ath_price_usd", domain: "market", label: "Registry-reported lifetime high price", unit: "usd", entityKey, evidenceState: "reported_context", sourceRefs: marketRefs });
      addNumber(measurements, token.ath.drawdownPct, { id: "reported_ath_drawdown_pct", domain: "market", label: "Registry-reported drawdown from lifetime high", unit: "percent", entityKey, evidenceState: "reported_context", sourceRefs: marketRefs });
      if (token.ath.date) {
        measurements.push({ id: "reported_ath_date", domain: "chronology", label: "Registry-reported lifetime high date", unit: "date", valueType: "date", value: token.ath.date, entityKey, evidenceState: "reported_context", sourceRefs: marketRefs });
      }
    }
    if (token.history) {
      const historyAsOf = token.history.capturedAt ?? token.producerSources?.history?.capturedAt;
      addNumber(measurements, token.history.changePct, { id: "price_window_change_pct", domain: "market", label: `Frozen ${token.history.timeframe} candle-window price change`, unit: "percent", entityKey, chain: token.chain, window: { kind: "historical", asOf: historyAsOf }, evidenceState: "bounded", sourceRefs: historyRefs });
      addNumber(measurements, token.history.drawdownPct, { id: "price_window_close_drawdown_pct", domain: "market", label: `Latest close drawdown from peak close in the frozen ${token.history.timeframe} window`, unit: "percent", entityKey, chain: token.chain, window: { kind: "historical", asOf: historyAsOf }, evidenceState: "bounded", sourceRefs: historyRefs });
      addNumber(measurements, token.history.spanPeriods, { id: "price_window_span_periods", domain: "chronology", label: `Frozen OHLCV window span in ${token.history.timeframe} periods`, unit: "count", entityKey, chain: token.chain, evidenceState: "bounded", sourceRefs: historyRefs });
      const volume = token.history.volume;
      if (volume) {
        const recentIsFloor = volume.recent.measured < volume.recent.candles;
        const priorIsFloor = volume.prior.measured < volume.prior.candles;
        addNumber(measurements, volume.recent.usd, { id: "price_window_recent_volume_usd", domain: "liquidity", label: `Reported recent-subwindow volume sum${recentIsFloor ? " (floor)" : ""}`, unit: "usd", entityKey, chain: token.chain, window: { kind: "historical", asOf: historyAsOf }, evidenceState: "bounded", sourceRefs: historyRefs });
        addNumber(measurements, volume.prior.usd, { id: "price_window_prior_volume_usd", domain: "liquidity", label: `Reported prior-subwindow volume sum${priorIsFloor ? " (floor)" : ""}`, unit: "usd", entityKey, chain: token.chain, window: { kind: "historical", asOf: historyAsOf }, evidenceState: "bounded", sourceRefs: historyRefs });
        addNumber(measurements, volume.recent.measured, { id: "price_window_recent_volume_measured_candles", domain: "liquidity", label: "Recent volume subwindow measured candles", unit: "count", entityKey, chain: token.chain, evidenceState: "bounded", sourceRefs: historyRefs });
        addNumber(measurements, volume.recent.candles, { id: "price_window_recent_volume_total_candles", domain: "liquidity", label: "Recent volume subwindow total candles", unit: "count", entityKey, chain: token.chain, evidenceState: "bounded", sourceRefs: historyRefs });
        addNumber(measurements, volume.prior.measured, { id: "price_window_prior_volume_measured_candles", domain: "liquidity", label: "Prior volume subwindow measured candles", unit: "count", entityKey, chain: token.chain, evidenceState: "bounded", sourceRefs: historyRefs });
        addNumber(measurements, volume.prior.candles, { id: "price_window_prior_volume_total_candles", domain: "liquidity", label: "Prior volume subwindow total candles", unit: "count", entityKey, chain: token.chain, evidenceState: "bounded", sourceRefs: historyRefs });
        if (!token.history.windowIsPartial && !volume.isFloor && !recentIsFloor && !priorIsFloor) {
          addNumber(measurements, volume.changePct, { id: "price_window_volume_change_pct", domain: "liquidity", label: "Frozen OHLCV recent-volume change versus prior equal-width subwindow", unit: "percent", entityKey, chain: token.chain, window: { kind: "historical", asOf: historyAsOf }, evidenceState: "bounded", sourceRefs: historyRefs });
        }
      }
    }
  }

  if (evidence.evmControlReality && identityBindings.evmControlMatched) {
    const control = evidence.evmControlReality;
    const sourceRefs = ["snapshot:evm-control-reality"];
    if (control.chainIdentity) {
      measurements.push({
        id: "evm_rpc_chain_identity_state",
        domain: "identity",
        label: "Direct RPC chain-identity preflight state",
        unit: "text",
        valueType: "text",
        value: control.chainIdentity.state,
        entityKey,
        chain: control.chain,
        evidenceState: "bounded",
        sourceRefs,
      });
      if (control.chainIdentity.observedChainId) {
        measurements.push({
          id: "evm_rpc_observed_chain_id",
          domain: "identity",
          label: "Direct RPC observed chain id",
          unit: "text",
          valueType: "text",
          value: control.chainIdentity.observedChainId,
          entityKey,
          chain: control.chain,
          evidenceState: "bounded",
          sourceRefs,
        });
      }
    }
    measurements.push({
      id: "evm_control_target_state",
      domain: "control",
      label: "Fixed-block canonical-address control-read state",
      unit: "text",
      valueType: "text",
      value: control.state,
      entityKey,
      chain: control.chain,
      evidenceState: "bounded",
      sourceRefs,
    });
    if (control.state === "observed") {
      if (control.proxy) {
        measurements.push({
          id: "evm_standard_proxy_state",
          domain: "control",
          label: "Standard proxy assessment state",
          unit: "text",
          valueType: "text",
          value: control.proxy.state,
          entityKey,
          chain: control.chain,
          evidenceState: "bounded",
          sourceRefs,
        });
        addNumber(measurements, control.proxy.indicators.length, { id: "evm_standard_proxy_indicator_count", domain: "control", label: "Standard proxy indicators observed", unit: "count", entityKey, chain: control.chain, evidenceState: "bounded", sourceRefs });
        addNumber(measurements, control.proxy.implementationCandidates.length, { id: "evm_implementation_candidate_count", domain: "control", label: "Standard implementation candidates observed", unit: "count", entityKey, chain: control.chain, evidenceState: "bounded", sourceRefs });
      }
      addNumber(measurements, control.authorities.length, { id: "evm_standard_authority_count", domain: "control", label: "Unique standard-interface authority addresses observed", unit: "count", entityKey, chain: control.chain, evidenceState: "bounded", sourceRefs });
      addNumber(measurements, control.authorities.filter((authority) => authority.accountType === "no_code").length, { id: "evm_no_code_authority_count", domain: "control", label: "Observed standard authority addresses with no runtime bytecode", unit: "count", entityKey, chain: control.chain, evidenceState: "bounded", sourceRefs });
      addNumber(measurements, control.safeCompatibleMultisigs.filter((multisig) => multisig.state === "observed").length, { id: "evm_safe_compatible_interface_count", domain: "control", label: "Authority addresses returning a Safe-compatible interface", unit: "count", entityKey, chain: control.chain, evidenceState: "bounded", sourceRefs });
      addNumber(measurements, control.safeCompatibleMultisigs.filter((multisig) => multisig.state === "observed" && multisig.threshold === 1).length, { id: "evm_single_signer_safe_compatible_count", domain: "control", label: "Safe-compatible authority interfaces reporting threshold one", unit: "count", entityKey, chain: control.chain, evidenceState: "bounded", sourceRefs });
    }
  }

  if (evidence.protocolTvl && identityBindings.protocolTvlMatched) {
    const tvl = evidence.protocolTvl;
    const sourceRefs = ["snapshot:protocol-tvl"];
    addNumber(measurements, tvl.tvlUsd, { id: "tvl_usd", domain: "economics", label: "Protocol TVL", unit: "usd", entityKey, window: { kind: "instant", asOf: tvl.capturedAt }, evidenceState: "measured", sourceRefs });
    addNumber(measurements, tvl.change30dPct, { id: "tvl_change_30d_pct", domain: "economics", label: "TVL change over 30 days", unit: "percent", entityKey, window: { kind: "historical", days: 30, asOf: tvl.capturedAt }, evidenceState: "measured", sourceRefs });
    addNumber(measurements, tvl.chains.length, { id: "tvl_chain_count", domain: "economics", label: "Chains in the identity-bound protocol TVL record", unit: "count", entityKey, evidenceState: "bounded", sourceRefs });
    addNumber(measurements, tvl.trend?.length, { id: "tvl_trend_point_count", domain: "economics", label: "Frozen weekly TVL trend points", unit: "count", entityKey, evidenceState: "bounded", sourceRefs });
    if (tvl.firstRecordedAt) {
      measurements.push({ id: "tvl_first_recorded_date", domain: "chronology", label: "First date in the provider's TVL series", unit: "date", valueType: "date", value: tvl.firstRecordedAt, entityKey, evidenceState: "bounded", sourceRefs });
    }
    const positiveChains = tvl.chainBreakdown.filter((row) => positive(row.tvlUsd));
    const total = positiveChains.reduce((sum, row) => sum + row.tvlUsd, 0);
    if (positiveChains.length >= 2 && positive(total)) {
      const top = [...positiveChains].sort((left, right) => right.tvlUsd - left.tvlUsd || left.chain.localeCompare(right.chain))[0];
      measurements.push({ id: "top_chain", domain: "economics", label: "Largest TVL chain", unit: "text", valueType: "text", value: top.chain, entityKey, chain: top.chain, evidenceState: "measured", sourceRefs });
      addNumber(measurements, rounded((top.tvlUsd / total) * 100), { id: "top_chain_tvl_share_pct", domain: "economics", label: "Largest chain share of positive reported TVL", unit: "percent", entityKey, chain: top.chain, evidenceState: "measured", sourceRefs });
    }
  }

  if (evidence.protocolFees && identityBindings.protocolFeesMatched) {
    const fees = evidence.protocolFees;
    const sourceRefs = ["snapshot:protocol-fees"];
    addNumber(measurements, fees.total24hUsd, { id: "protocol_fees_24h_usd", domain: "economics", label: "Protocol fees over 24 hours", unit: "usd", entityKey, window: { kind: "trailing", days: 1, asOf: fees.capturedAt }, evidenceState: "measured", sourceRefs });
    addNumber(measurements, fees.total30dUsd, { id: "protocol_fees_30d_usd", domain: "economics", label: "Protocol fees over 30 days", unit: "usd", entityKey, window: { kind: "trailing", days: 30, asOf: fees.capturedAt }, evidenceState: "measured", sourceRefs });
    addNumber(measurements, fees.change30dOver30dPct, { id: "protocol_fees_change_30d_pct", domain: "economics", label: "Trailing fees change versus prior 30 days", unit: "percent", entityKey, window: { kind: "historical", days: 60, asOf: fees.capturedAt }, evidenceState: "measured", sourceRefs });
  }

  if (evidence.holderProfile && identityBindings.holderProfileMatched) {
    const holders = evidence.holderProfile;
    const sourceRefs = ["snapshot:holder-profile"];
    const holderCapturedAt = holders.sourceCapturedAt ?? holders.capturedAt;
    const distributionCapturedAt = holders.distributionSource === "explorer"
      ? holders.distributionCapturedAt ?? holderCapturedAt
      : holderCapturedAt;
    const distributionRefs = holders.distributionSource === "explorer" && holders.distributionSourceUrl
      ? ["snapshot:holder-distribution"]
      : sourceRefs;
    addNumber(measurements, holders.holderCount, { id: "holder_count", domain: "supply", label: "Reported holder count", unit: "count", entityKey, evidenceState: "bounded", sourceRefs });
    addNumber(measurements, holders.lpLockedOrBurnedPct, { id: "lp_locked_or_burned_pct", domain: "liquidity", label: "GoPlus-reported LP share locked or burned", unit: "percent", entityKey, evidenceState: "bounded", sourceRefs });
    addNumber(measurements, holders.creatorPct, { id: "provider_named_creator_or_authority_pct", domain: "supply", label: "GoPlus-reported creator or authority wallet share", unit: "percent", entityKey, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, holders.contractFlags?.length, { id: "goplus_fired_contract_flag_count", domain: "control", label: "GoPlus contract or deployer flags that fired", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    if (holders.holdersAssessed !== false) {
      addNumber(measurements, holders.topHolderPct, { id: "top_holder_pct", domain: "supply", label: "Largest assessed wallet share", unit: "percent", entityKey, window: { kind: "instant", asOf: distributionCapturedAt }, evidenceState: "bounded", sourceRefs: distributionRefs });
      const aggregate = holderAggregateBasis(holders);
      if (aggregate) {
        addNumber(measurements, aggregate.assessedWalletCount, { id: "assessed_wallet_count", domain: "supply", label: "Wallet rows included in the bounded concentration aggregate", unit: "count", entityKey, window: { kind: "instant", asOf: distributionCapturedAt }, evidenceState: "bounded", sourceRefs: distributionRefs });
        addNumber(measurements, aggregate.sharePct, aggregate.kind === "floor"
          ? { id: "assessed_wallet_share_floor_pct", domain: "supply", label: `Minimum combined share across ${aggregate.assessedWalletCount} assessed wallets`, unit: "percent", entityKey, window: { kind: "instant", asOf: distributionCapturedAt }, evidenceState: "bounded", sourceRefs: distributionRefs }
          : { id: "top_10_holder_pct", domain: "supply", label: "Top 10 assessed wallets combined share", unit: "percent", entityKey, window: { kind: "instant", asOf: distributionCapturedAt }, evidenceState: "bounded", sourceRefs: distributionRefs });
      }
    }
  }

  if (evidence.tokenUnlocks && identityBindings.tokenUnlocksMatched) {
    const unlocks = evidence.tokenUnlocks;
    const sourceRefs = [
      "snapshot:token-unlocks",
      ...(unlocks.contractSourceUrl ? ["snapshot:token-unlock-contract-map"] : []),
      ...(unlocks.eventsSourceUrl ? ["snapshot:token-unlock-events"] : []),
    ];
    measurements.push({ id: "next_unlock_date", domain: "supply", label: "Next reported unlock date", unit: "date", valueType: "date", value: unlocks.nextUnlockDate, entityKey, window: { kind: "scheduled", asOf: unlocks.capturedAt, end: unlocks.nextUnlockDate }, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, unlocks.unlockValueUsd, { id: "next_unlock_usd", domain: "supply", label: "Next reported unlock value", unit: "usd", entityKey, window: { kind: "scheduled", asOf: unlocks.capturedAt, end: unlocks.nextUnlockDate }, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, percentageInRange(unlocks.percentOfSupply) ? unlocks.percentOfSupply : null, { id: "next_unlock_supply_pct", domain: "supply", label: "Next reported unlock share of supply", unit: "percent", entityKey, window: { kind: "scheduled", asOf: unlocks.capturedAt, end: unlocks.nextUnlockDate }, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, percentageInRange(unlocks.next90dPercentOfSupply) ? unlocks.next90dPercentOfSupply : null, { id: "next_90d_unlock_supply_pct", domain: "supply", label: "Reported unlock share over the next 90 days", unit: "percent", entityKey, window: { kind: "scheduled", days: 90, asOf: unlocks.capturedAt }, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, percentageInRange(unlocks.percentOfMcap) ? unlocks.percentOfMcap : null, { id: "next_unlock_market_cap_pct", domain: "supply", label: "Provider-reported next unlock share of market capitalization", unit: "percent", entityKey, window: { kind: "scheduled", asOf: unlocks.capturedAt, end: unlocks.nextUnlockDate }, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, percentageInRange(unlocks.cumulativeUnlockedPercent) ? unlocks.cumulativeUnlockedPercent : null, { id: "cumulative_unlocked_pct", domain: "supply", label: "Provider-reported cumulative unlocked share", unit: "percent", entityKey, evidenceState: "reported_context", sourceRefs });
    if (unlocks.allocationName) {
      measurements.push({ id: "next_unlock_allocation", domain: "supply", label: "Provider-reported next unlock allocation", unit: "text", valueType: "text", value: unlocks.allocationName, entityKey, evidenceState: "reported_context", sourceRefs });
    }
  }

  if (evidence.securityAudits) {
    const checkRef = "snapshot:security-audits";
    const normalizedAuditor = (value: string) => value.trim().toLowerCase();
    const auditRows = sortedCorroboratedAudits(evidence)
      .map((record, index) => ({
        ...record,
        sourceRef: corroboratedAuditSourceId(index),
        anchorValidation: validatedAuditIdentityAnchor(record.audit, evidence),
      }));
    const identityAnchoredRows = auditRows
      .filter(({ anchorValidation }) => anchorValidation.state === "matched");
    const identityGapRows = auditRows
      .filter(({ anchorValidation }) => anchorValidation.state !== "matched");
    const invalidAnchorRows = auditRows
      .filter(({ anchorValidation }) => anchorValidation.state === "invalid");
    const promotedAuditorNames = new Set(auditRows.map(({ audit }) => normalizedAuditor(audit.auditor)));
    const standaloneLeadNames = new Set(
      evidence.securityAudits.selfAttested
        .map(normalizedAuditor)
        .filter((name) => name.length > 0 && !promotedAuditorNames.has(name)),
    );
    const reportedLeadAuditorNames = new Set([
      ...standaloneLeadNames,
      ...identityGapRows.map(({ audit }) => normalizedAuditor(audit.auditor)),
    ]);
    const attestationRefs = sortedAuditAttestations(evidence)
      .map(({ attestation }, index) => ({ attestation, sourceRef: auditLeadSourceId(index) }))
      .filter(({ attestation }) => reportedLeadAuditorNames.has(normalizedAuditor(attestation.auditor)))
      .map(({ sourceRef }) => sourceRef);
    const identityGapRefs = identityGapRows.map(({ sourceRef }) => sourceRef);
    const invalidAnchorRefs = invalidAnchorRows.map(({ sourceRef }) => sourceRef);
    const fallbackLeadRefs = attestationRefs.length === 0
      && evidence.securityAudits.securityPageUrl
      && standaloneLeadNames.size > 0
      ? ["audit:lead:legacy"]
      : [];
    const leadRefs = uniqueInOrder([checkRef, ...attestationRefs, ...fallbackLeadRefs, ...identityGapRefs]);
    const reportedLeadCount = standaloneLeadNames.size + identityGapRows.length;
    addNumber(measurements, reportedLeadCount, { id: "audit_lead_count", domain: "security", label: "Reported audit leads without subject-level corroboration", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: leadRefs });
    addNumber(measurements, identityAnchoredRows.length, { id: "corroborated_audit_count", domain: "security", label: "Identity-anchored auditor-domain engagements", unit: "count", entityKey, evidenceState: "bounded", sourceRefs: [checkRef, ...identityAnchoredRows.map(({ sourceRef }) => sourceRef)] });
    if (identityGapRows.length > 0) {
      addNumber(measurements, identityGapRows.length, { id: "audit_identity_anchor_gap_count", domain: "security", label: "Auditor-domain rows without a matching canonical subject identity anchor", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: [checkRef, ...identityGapRefs] });
    }
    if (invalidAnchorRows.length > 0) {
      addNumber(measurements, invalidAnchorRows.length, { id: "audit_identity_anchor_mismatch_count", domain: "security", label: "Auditor-domain rows carrying an anchor that fails the canonical identity match", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: [checkRef, ...invalidAnchorRefs] });
    }
  }

  if (evidence.protocolFunding && identityBindings.protocolFundingMatched) {
    const sourceRefs = ["snapshot:protocol-funding"];
    addNumber(measurements, evidence.protocolFunding.rounds.length, { id: "funding_round_count", domain: "funding", label: "Indexed funding rounds", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    if (positive(evidence.protocolFunding.totalRaisedUsd)) {
      addNumber(measurements, evidence.protocolFunding.totalRaisedUsd, { id: "total_raised_usd", domain: "funding", label: "Sum of disclosed indexed round amounts", unit: "usd", entityKey, evidenceState: "reported_context", sourceRefs });
    }
  } else if (identityBindings.companyEnrichmentMatched && evidence.companyEnrichment?.funding) {
    const sourceRefs = ["snapshot:company-enrichment"];
    addNumber(measurements, evidence.companyEnrichment.funding.rounds.length, { id: "funding_round_count", domain: "funding", label: "Licensed-provider indexed funding rounds", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    if (positive(evidence.companyEnrichment.funding.totalRaisedUsd)) {
      addNumber(measurements, evidence.companyEnrichment.funding.totalRaisedUsd, { id: "provider_reported_total_funding_usd", domain: "funding", label: "Licensed-provider reported total funding", unit: "usd", entityKey, evidenceState: "reported_context", sourceRefs });
    }
  }

  const fundingRecord = evidence.protocolFunding && identityBindings.protocolFundingMatched
    ? {
        rounds: evidence.protocolFunding.rounds,
        leadInvestors: evidence.protocolFunding.leadInvestors,
        capturedAt: evidence.protocolFunding.capturedAt,
        sourceRefs: ["snapshot:protocol-funding"],
      }
    : identityBindings.companyEnrichmentMatched && evidence.companyEnrichment?.funding
      ? {
          rounds: evidence.companyEnrichment.funding.rounds,
          leadInvestors: evidence.companyEnrichment.funding.leadInvestors,
          capturedAt: evidence.companyEnrichment.capturedAt,
          sourceRefs: ["snapshot:company-enrichment"],
        }
      : null;
  if (fundingRecord) {
    const disclosedRounds = fundingRecord.rounds.filter((round) => positive(round.amountUsd));
    const disclosedRoundSumUsd = disclosedRounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0);
    addNumber(measurements, disclosedRounds.length, { id: "funding_round_disclosed_amount_count", domain: "funding", label: "Indexed rounds with a positive disclosed amount", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
    if (positive(disclosedRoundSumUsd)) {
      addNumber(measurements, disclosedRoundSumUsd, { id: "indexed_disclosed_round_sum_usd", domain: "funding", label: "Arithmetic sum of positive disclosed indexed round amounts", unit: "usd", entityKey, window: { kind: "instant", asOf: fundingRecord.capturedAt }, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
    }
    addNumber(measurements, uniqueSorted(fundingRecord.leadInvestors).length, { id: "funding_lead_investor_count", domain: "funding", label: "Distinct indexed lead investors", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
    const datedRounds = fundingRecord.rounds
      .flatMap((round) => round.date && Number.isFinite(Date.parse(round.date))
        ? [{ round, time: Date.parse(round.date) }]
        : [])
      .sort((left, right) => right.time - left.time || left.round.round.localeCompare(right.round.round));
    const latest = datedRounds[0];
    if (latest) {
      const date = new Date(latest.time).toISOString();
      measurements.push({ id: "latest_funding_round_date", domain: "chronology", label: "Latest dated indexed funding round", unit: "date", valueType: "date", value: date, entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
      measurements.push({ id: "latest_funding_round_type", domain: "funding", label: "Latest dated indexed funding round type", unit: "text", valueType: "text", value: latest.round.round, entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
      addNumber(measurements, latest.round.amountUsd, { id: "latest_funding_round_amount_usd", domain: "funding", label: "Latest dated indexed round disclosed amount", unit: "usd", entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
      const latestValuation = "valuationUsd" in latest.round
        && typeof latest.round.valuationUsd === "number"
        ? latest.round.valuationUsd
        : null;
      addNumber(measurements, latestValuation, { id: "latest_funding_round_valuation_usd", domain: "funding", label: "Latest dated indexed round disclosed valuation", unit: "usd", entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
      const capturedTime = Date.parse(fundingRecord.capturedAt);
      if (Number.isFinite(capturedTime) && capturedTime >= latest.time) {
        addNumber(measurements, rounded((capturedTime - latest.time) / 86_400_000, 1), { id: "days_since_latest_funding_round", domain: "chronology", label: "Days from latest dated indexed round to capture", unit: "days", entityKey, evidenceState: "reported_context", sourceRefs: fundingRecord.sourceRefs });
      }
    }
  }

  if (identityBindings.companyEnrichmentMatched && evidence.companyEnrichment) {
    const sourceRefs = ["snapshot:company-enrichment"];
    addNumber(measurements, evidence.companyEnrichment.management?.length, { id: "licensed_management_record_count", domain: "team", label: "Licensed-provider management records", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    const firmographic = evidence.companyEnrichment.firmographic;
    if (firmographic?.foundedYear) measurements.push({ id: "licensed_company_founded_year", domain: "chronology", label: "Licensed-provider company founded year", unit: "text", valueType: "text", value: firmographic.foundedYear, entityKey, evidenceState: "reported_context", sourceRefs });
    if (firmographic?.headcountRange) measurements.push({ id: "licensed_company_headcount_range", domain: "team", label: "Licensed-provider headcount range", unit: "text", valueType: "text", value: firmographic.headcountRange, entityKey, evidenceState: "reported_context", sourceRefs });
    if (firmographic?.ownership) measurements.push({ id: "licensed_company_ownership", domain: "legal", label: "Licensed-provider ownership classification", unit: "text", valueType: "text", value: firmographic.ownership, entityKey, evidenceState: "reported_context", sourceRefs });
  }

  if (evidence.domainRegistration && identityBindings.domainRegistrationMatched) {
    const registeredAt = new Date(evidence.domainRegistration.registeredAt).toISOString();
    const recomputedAgeMonths = wholeUtcMonthsBetween(
      registeredAt,
      new Date(evidence.domainRegistration.capturedAt).toISOString(),
    );
    measurements.push({ id: "official_domain_registered_at", domain: "chronology", label: "Bound official domain registration date", unit: "date", valueType: "date", value: registeredAt, entityKey, window: { kind: "historical", asOf: evidence.domainRegistration.capturedAt }, evidenceState: "bounded", sourceRefs: ["snapshot:domain-registration"] });
    addNumber(measurements, recomputedAgeMonths, { id: "domain_age_months", domain: "chronology", label: "Official domain age at RDAP capture", unit: "months", entityKey, evidenceState: "bounded", sourceRefs: ["snapshot:domain-registration"] });
  }

  if (derivedLaunchWindow) {
    const sourceRefs = ["snapshot:account-created-at", "snapshot:domain-registration", "snapshot:launch-window"];
    measurements.push({ id: "launch_window_earliest_date", domain: "chronology", label: `Earliest ${derivedLaunchWindow.earliestSource} record found`, unit: "date", valueType: "date", value: derivedLaunchWindow.earliest, entityKey, evidenceState: "bounded", sourceRefs });
    measurements.push({ id: "launch_window_latest_date", domain: "chronology", label: `Latest ${derivedLaunchWindow.latestSource} record found`, unit: "date", valueType: "date", value: derivedLaunchWindow.latest, entityKey, evidenceState: "bounded", sourceRefs });
    addNumber(measurements, derivedLaunchWindow.gapMonths, { id: "launch_window_gap_months", domain: "chronology", label: "Time between the account and domain records", unit: "months", entityKey, evidenceState: "bounded", sourceRefs });
  }

  if (evidence.profile.profile_collection_state === "resolved") {
    if (validFrozenTime(evidence.profile.last_post_at)) {
      measurements.push({ id: "last_observed_post_at", domain: "chronology", label: "Latest provider-observed post timestamp", unit: "date", valueType: "date", value: new Date(evidence.profile.last_post_at).toISOString(), entityKey, window: { kind: "historical", asOf: evidence.profile.profile_captured_at }, evidenceState: "bounded", sourceRefs: ["snapshot:profile"] });
    }
    addNumber(measurements, evidence.profile.days_since_post, { id: "days_since_last_post", domain: "chronology", label: "Days from the latest observed post to profile capture", unit: "days", entityKey, window: validFrozenTime(evidence.profile.profile_captured_at) ? { kind: "historical", asOf: evidence.profile.profile_captured_at, end: evidence.profile.last_post_at } : undefined, evidenceState: "bounded", sourceRefs: ["snapshot:profile"] });
    if ((evidence.profile.prior_handles?.length ?? 0) > 0) {
      addNumber(measurements, evidence.profile.prior_handles!.length, { id: "provider_reported_prior_handle_count", domain: "identity", label: "Provider-recorded prior X handles", unit: "count", entityKey, window: validFrozenTime(evidence.profile.profile_captured_at) ? { kind: "instant", asOf: evidence.profile.profile_captured_at } : undefined, evidenceState: "reported_context", sourceRefs: ["snapshot:profile"] });
      measurements.push({ id: "provider_reported_prior_handles", domain: "identity", label: "Provider-recorded prior X handle list", unit: "text", valueType: "text", value: uniqueSorted(evidence.profile.prior_handles!.map((handle) => handle.trim()).filter(Boolean)).join(", "), entityKey, evidenceState: "reported_context", sourceRefs: ["snapshot:profile"] });
    }
  }

  if (evidence.profile.website && evidence.profile.site_substance_status) {
    measurements.push({ id: "official_site_response_state", domain: "product", label: "Bounded official-site response classification", unit: "text", valueType: "text", value: evidence.profile.site_substance_status, entityKey, evidenceState: "bounded", sourceRefs: ["snapshot:official-site-response"] });
  }

  if (token && identityBindings.canonicalTokenVerified && token.officialX?.trim()) {
    measurements.push({ id: "canonical_token_official_x", domain: "identity", label: "Canonical token registry official X handle", unit: "text", valueType: "text", value: token.officialX.trim(), entityKey, evidenceState: "measured", sourceRefs: ["snapshot:project-token"] });
  }

  if (evidence.leaderDepartures && evidence.leaderDepartures.length > 0) {
    const sourceRefs = ["snapshot:leader-departures"];
    addNumber(measurements, evidence.leaderDepartures.length, { id: "checked_leader_count", domain: "team", label: "Named leaders checked in licensed employment records", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, evidence.leaderDepartures.filter((leader) => leader.state === "current").length, { id: "current_leader_count", domain: "team", label: "Named leaders reporting a current role", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, evidence.leaderDepartures.filter((leader) => leader.state === "departed").length, { id: "departed_leader_count", domain: "team", label: "Named leaders reporting a departed role", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, evidence.leaderDepartures.filter((leader) => leader.state === "absent").length, { id: "absent_leader_count", domain: "team", label: "Named leaders not matched by the licensed employment check", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
  }

  if (evidence.profileAuthenticity) {
    const sourceRefs = ["snapshot:profile-authenticity"];
    measurements.push({
      id: "provider_profile_photo_classification",
      domain: "identity",
      label: `${evidence.profileAuthenticity.provider} profile-image screening classification`,
      unit: "text",
      valueType: "text",
      value: evidence.profileAuthenticity.classification,
      entityKey,
      evidenceState: "reported_context",
      sourceRefs,
    });
    if (finite(evidence.profileAuthenticity.confidence) && evidence.profileAuthenticity.confidence >= 0 && evidence.profileAuthenticity.confidence <= 1) {
      addNumber(measurements, rounded(evidence.profileAuthenticity.confidence * 100, 1), {
        id: "provider_profile_photo_confidence_pct",
        domain: "identity",
        label: `${evidence.profileAuthenticity.provider} profile-image screening confidence`,
        unit: "percent",
        entityKey,
        evidenceState: "reported_context",
        sourceRefs,
      });
    }
    if (typeof evidence.profileAuthenticity.isRealPerson === "boolean") {
      measurements.push({
        id: "provider_profile_photo_real_person_opinion",
        domain: "identity",
        label: `${evidence.profileAuthenticity.provider} reported real-person opinion`,
        unit: "text",
        valueType: "text",
        value: String(evidence.profileAuthenticity.isRealPerson),
        entityKey,
        evidenceState: "reported_context",
        sourceRefs,
      });
    }
  }

  if (evidence.trustGraphScreen) {
    const sourceRefs = ["snapshot:trust-graph-screen"];
    measurements.push({
      id: "trust_graph_screen_status",
      domain: "identity",
      label: "Frozen organization-scoped relationship-screen status",
      unit: "text",
      valueType: "text",
      value: evidence.trustGraphScreen.status,
      entityKey,
      evidenceState: "reported_context",
      sourceRefs,
    });
    if (Number.isInteger(evidence.trustGraphScreen.contributionCount) && evidence.trustGraphScreen.contributionCount >= 0) {
      addNumber(measurements, evidence.trustGraphScreen.contributionCount, { id: "trust_graph_contribution_count", domain: "identity", label: "Organization graph contributions assessed", unit: "count", entityKey, evidenceState: "bounded", sourceRefs });
    }
    if (Number.isInteger(evidence.trustGraphScreen.qualifiedContributionCount) && evidence.trustGraphScreen.qualifiedContributionCount >= 0) {
      addNumber(measurements, evidence.trustGraphScreen.qualifiedContributionCount, { id: "trust_graph_qualified_contribution_count", domain: "identity", label: "Coverage-qualified organization graph contributions", unit: "count", entityKey, evidenceState: "bounded", sourceRefs });
    }
    const adverseConnections = qualifiedAdverseTrustConnections(evidence);
    if (adverseConnections.length > 0) {
      addNumber(measurements, adverseConnections.length, { id: "qualified_adverse_trust_graph_connection_count", domain: "identity", label: "Exact qualified relationships to complete server-collected FAIL or AVOID reports", unit: "count", entityKey, evidenceState: "verified", sourceRefs });
    }
    const unresolvedConnections = evidence.trustGraphScreen.connections.filter((connection) =>
      !connection.qualified
      || connection.otherAttestation !== "server_collected"
      || connection.otherCompleteness !== "complete",
    );
    if (unresolvedConnections.length > 0) {
      addNumber(measurements, unresolvedConnections.length, { id: "unqualified_trust_graph_connection_count", domain: "identity", label: "Saved graph relationships withheld by attestation or completeness gates", unit: "count", entityKey, evidenceState: "bounded", sourceRefs });
    }
  }

  const legalNameLeads = evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => artifact.kind === "legal_case" && (artifact.match === "candidate" || artifact.match === "exact_name"));
  if (legalNameLeads.length > 0) {
    addNumber(measurements, legalNameLeads.length, { id: "legal_case_name_match_lead_count", domain: "legal", label: "Unresolved court-record name-match leads", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: legalNameLeads.map(({ index }) => sourceArtifactId(index)) });
  }
  const sanctionsNameLeads = evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => artifact.kind === "sanctions_screen" && (artifact.match === "candidate" || artifact.match === "exact_name"));
  if (sanctionsNameLeads.length > 0) {
    addNumber(measurements, sanctionsNameLeads.length, { id: "sanctions_name_match_lead_count", domain: "legal", label: "Unresolved sanctions-dataset name-match leads", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: sanctionsNameLeads.map(({ index }) => sourceArtifactId(index)) });
  }
  const pressRows = evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => artifact.kind === "press" && artifact.coverageState !== "unavailable");
  if (pressRows.length > 0) {
    addNumber(measurements, pressRows.length, { id: "frozen_press_record_count", domain: "product", label: "Frozen public-coverage records retained for narrative review", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: pressRows.map(({ index }) => sourceArtifactId(index)) });
  }

  const portfolioRelationships = evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index, binding: portfolioRelationshipBinding(artifact, evidence) }))
    .filter((row): row is typeof row & { binding: PortfolioRelationshipBinding } => row.binding !== null);
  if (portfolioRelationships.length > 0) {
    addNumber(measurements, portfolioRelationships.length, { id: "identity_bound_portfolio_relationship_count", domain: "funding", label: "Exact-handle confirmed investment relationships", unit: "count", entityKey, evidenceState: "verified", sourceRefs: portfolioRelationships.map(({ index }) => sourceArtifactId(index)) });
  }

  const strictFundScaleRows = evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => isStrictFrozenFundScaleArtifact(artifact, evidence));
  const strictFundScaleClaims = new Map<string, typeof strictFundScaleRows>();
  for (const row of strictFundScaleRows) {
    const claimId = row.artifact.fundScaleClaimId!;
    strictFundScaleClaims.set(claimId, [...(strictFundScaleClaims.get(claimId) ?? []), row]);
  }
  if (strictFundScaleClaims.size > 0) {
    // The count only reaches the verified tier when every claim behind it is
    // regulatory; one manager-reported claim keeps the aggregate attributed.
    const everyClaimRegulatory = strictFundScaleRows
      .every(({ artifact }) => fundScaleEvidenceState(artifact) === "verified");
    addNumber(measurements, strictFundScaleClaims.size, { id: "verified_fund_scale_claim_count", domain: "funding", label: "Strict identity-bound fund-scale claims", unit: "count", entityKey, evidenceState: everyClaimRegulatory ? "verified" : "reported_context", sourceRefs: strictFundScaleRows.map(({ index }) => sourceArtifactId(index)) });
  }
  [...strictFundScaleClaims.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([claimId, rows], claimIndex) => {
      const artifact = rows[0]!.artifact;
      addNumber(measurements, artifact.fundSizeUsd, {
        id: `verified_fund_scale_usd:${String(claimIndex + 1).padStart(2, "0")}`,
        domain: "funding",
        label: `${artifact.fundName} ${artifact.fundScaleMetric?.replaceAll("_", " ")} (${artifact.fundAmountQualifier}, claim ${claimId})`,
        unit: "usd",
        entityKey,
        window: artifact.fundScaleAsOf ? { kind: "historical", asOf: artifact.capturedAt, end: artifact.fundScaleAsOf } : undefined,
        evidenceState: fundScaleEvidenceState(artifact),
        sourceRefs: rows.map(({ index }) => sourceArtifactId(index)),
      });
    });

  if (evidence.contradictions.length > 0) {
    addNumber(measurements, evidence.contradictions.length, { id: "analyst_contradiction_lead_count", domain: "identity", label: "Analyst-reported conflict leads without artifact references", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: evidence.contradictions.map((_, index) => contradictionLeadSourceId(index)) });
  }

  const verifiedCounterArtifacts = (evidence.axisEvidenceCatalog ?? [])
    .filter((artifact) => (artifact.counterEligibleAxes ?? []).some((axis) => axisEvidenceIsVerifiedCounter(artifact, axis)));
  if (verifiedCounterArtifacts.length > 0) {
    addNumber(measurements, verifiedCounterArtifacts.length, { id: "verified_direct_axis_counter_evidence_count", domain: "governance", label: "Direct verified scorer-packet records marked score-limiting", unit: "count", entityKey, evidenceState: "verified", sourceRefs: verifiedCounterArtifacts.map((artifact) => axisEvidenceSourceId(artifact.artifactId)) });
  }
  const axisGaps = evidence.axes.flatMap((axis) => axis.gaps?.map((gap) => ({ axis: axis.axis, gap: gap.trim() })).filter(({ gap }) => gap.length > 0) ?? []);
  if (axisGaps.length > 0) {
    const gapSourceRefs = uniqueSorted([
      ...axisGaps.map(({ axis }) => axisAssessmentSourceId(axis)),
      ...(evidence.axisEvidenceCatalog ?? [])
        .filter((artifact) => artifact.verification === "unavailable" && axisGaps.some((gap) => artifact.eligibleAxes.includes(gap.axis)))
        .map((artifact) => axisEvidenceSourceId(artifact.artifactId)),
    ]);
    addNumber(measurements, axisGaps.length, { id: "analyst_material_axis_gap_count", domain: "governance", label: "Material unresolved questions recorded by the scoring analyst", unit: "count", entityKey, evidenceState: "reported_context", sourceRefs: gapSourceRefs });
  }

  const validBandTiers = new Set(["none", "assessed_null", "adverse", "emerging", "solid", "exceptional"]);
  for (const [axis, band] of Object.entries(evidence.projectStrengthBands ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (
      !validBandTiers.has(band.tier)
      || !finite(band.minScore)
      || !finite(band.maxScore)
      || band.minScore < 0
      || band.maxScore < band.minScore
    ) continue;
    const segment = encodeURIComponent(axis);
    const sourceRefs = [projectStrengthSourceId(axis)];
    measurements.push({ id: `project_strength_tier:${segment}`, domain: projectAxisDomain(axis), label: `${axis} deterministic scorer-packet evidence tier`, unit: "text", valueType: "text", value: band.tier, entityKey, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, band.minScore, { id: `project_strength_min_score:${segment}`, domain: projectAxisDomain(axis), label: `${axis} deterministic evidence-band minimum`, unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
    addNumber(measurements, band.maxScore, { id: `project_strength_max_score:${segment}`, domain: projectAxisDomain(axis), label: `${axis} deterministic evidence-band maximum`, unit: "count", entityKey, evidenceState: "reported_context", sourceRefs });
  }

  const hacks = identityBindings.protocolTvlMatched
    ? evidence.protocolTvl?.hacks?.filter((hack) => finite(hack.amountUsd)) ?? []
    : [];
  if (hacks.length > 0) {
    const largest = [...hacks].sort((left, right) => right.amountUsd! - left.amountUsd!)[0];
    addNumber(measurements, largest.amountUsd, { id: "largest_recorded_incident_usd", domain: "security", label: "Largest provider-recorded incident amount", unit: "usd", entityKey, window: largest.date ? { kind: "historical", end: largest.date, asOf: evidence.protocolTvl?.capturedAt } : undefined, evidenceState: "reported_context", sourceRefs: ["snapshot:protocol-tvl"] });
  }

  return measurements.sort((left, right) => left.id.localeCompare(right.id));
}

function domainForPredicate(predicate: BasicFactPredicate): IntelligenceDomain {
  switch (predicate) {
    case "official_identity": return "identity";
    case "current_role":
    case "prior_role":
    case "education":
    case "founder":
    case "executive":
    case "track_record": return "team";
    case "product":
    case "repository": return "product";
    case "founded":
    case "launched":
    case "exit": return "chronology";
    case "official_token":
    case "tokenomics":
    case "vesting": return "supply";
    case "public_security": return "market";
    case "legal_regulatory_event": return "legal";
    case "security_incident":
    case "audit": return "security";
    case "network":
    case "partnership":
    case "traction": return "economics";
    case "legal_entity": return "legal";
    case "funding":
    case "investor": return "funding";
    case "governance": return "governance";
    case "control":
    case "conflict_of_interest": return "control";
    case "treasury": return "treasury";
  }
}

function domainForFinding(finding: CollectedEvidence["findings"][number]): IntelligenceDomain {
  if (finding.protocol_incident || finding.finding_type === "ProtocolSecurityIncident") return "security";
  switch (finding.finding_type) {
    case "ProjectTokenDrawdown":
    case "TokenCollapse": return "market";
    case "SiteNotLive":
    case "CommunityFUD": return "product";
    case "OfficialXAccountSuspended":
    case "DeceptionFinding":
    case "TrustGraphConnection": return "identity";
    case "LegalCaseNameLead":
    case "SanctionsNameLead":
    case "PredatoryTerms": return "legal";
    case "ManipulationTooling":
    case "ManipulationToolingLead": return "control";
    case "CadenceDecay": return "chronology";
    case "OperatorLaunchHistory":
    case "RoleCandidate":
    case "AdvisoryRug":
    case "Exit":
    case "MeridianExit": return "team";
    default: return "product";
  }
}

function factConflictArtifacts(fact: BasicFact): {
  marked: boolean;
  complete: boolean;
  missing: "supporting" | "contradicting" | "both" | null;
} {
  const hasSupporting = factSupportSourceRefs(fact, true).length > 0;
  const hasContradicting = factContradictionSourceRefs(fact, true).length > 0;
  const marked = fact.status === "conflicted" || hasContradicting;
  if (!marked) return { marked: false, complete: false, missing: null };
  if (hasSupporting && hasContradicting) return { marked: true, complete: true, missing: null };
  return {
    marked: true,
    complete: false,
    missing: hasSupporting ? "contradicting" : hasContradicting ? "supporting" : "both",
  };
}

function malformedConflictBasis(facts: readonly BasicFact[]): string {
  const missing = new Set(facts.map((fact) => factConflictArtifacts(fact).missing).filter(Boolean));
  const missingLabel = missing.size === 1
    ? `${[...missing][0]} artifact`
    : "supporting or contradicting artifact";
  return `The frozen record marks this question as conflicted but is missing a saved ${missingLabel}. ARGUS keeps it open as an evidence-integrity gap and does not claim that saved sources disagree.`;
}

function questionState(
  entry: BasicFactQuestionLedgerEntry,
  facts: readonly BasicFact[],
  auditedHandle: string,
): { state: IntelligenceQuestionState; basis: string; matchingFacts: BasicFact[] } {
  const matchingFacts = facts.filter((fact) =>
    factTargetsAuditedSubject(fact, auditedHandle)
    && fact.predicate === entry.predicate
    && (
      fact.questionId === entry.questionId
      || entry.answerRefs.includes(fact.factId)
      || entry.answerRefs.includes(`fact:${fact.factId}`)
    ),
  );
  const conflictFacts = matchingFacts.filter((fact) => factConflictArtifacts(fact).marked);
  if (conflictFacts.some((fact) => factConflictArtifacts(fact).complete)) {
    return {
      state: "partial",
      basis: "Saved sources conflict on this question, so ARGUS does not resolve it in the derived lane.",
      matchingFacts,
    };
  }
  if (conflictFacts.length > 0) {
    return {
      state: "partial",
      basis: malformedConflictBasis(conflictFacts),
      matchingFacts,
    };
  }
  if (entry.status === "answered") {
    if (matchingFacts.length === 0) {
      return {
        state: "unresolved",
        basis: "The ledger is marked answered, but no bound direct-subject fact remains in the frozen evidence.",
        matchingFacts,
      };
    }
    const atomicResolutionPredicates = new Set<BasicFactPredicate>([
      "official_identity",
      "founded",
      "launched",
      "official_token",
    ]);
    if (matchingFacts.some(isStrictSourceBackedFact) && atomicResolutionPredicates.has(entry.predicate)) {
      return { state: "resolved", basis: "A strict source-backed fact answers this frozen research question.", matchingFacts };
    }
    if (matchingFacts.some(isStrictSourceBackedFact)) {
      return {
        state: "partial",
        basis: "Strict direct-subject evidence answers part of this multi-facet question, but the frozen ledger does not record facet-level completeness.",
        matchingFacts,
      };
    }
    return {
      state: "reported",
      basis: "The frozen ledger records an answer, but the answer is not a strict source-backed fact.",
      matchingFacts,
    };
  }

  const states = entry.providerRuns.map((run) => run.state);
  if (states.includes("partial")) {
    return { state: "partial", basis: "At least one frozen collection pass completed only partially.", matchingFacts };
  }
  if (states.some((state) => state === "succeeded" || state === "completed_empty")) {
    return { state: "unresolved", basis: "A bounded collection pass completed without a source-backed answer.", matchingFacts };
  }
  if (states.includes("failed")) {
    return { state: "unavailable", basis: "At least one attempted collection pass failed and no pass completed, so no negative claim is inferred.", matchingFacts };
  }
  return { state: "not_collected", basis: "No completed collection pass is recorded for this question.", matchingFacts };
}

interface ExpectedQuestion {
  id: string;
  domain: IntelligenceDomain;
  prompt: string;
  materiality: "critical" | "important" | "context";
  /** Measurements that partially answer this exact question, never the whole domain. */
  measurementIds?: readonly string[];
  /** Exact BasicFact predicates that can address this question. */
  factPredicates?: readonly BasicFactPredicate[];
}

const EVM_CONTROL_MEASUREMENT_IDS = [
  "evm_control_target_state",
  "evm_standard_proxy_state",
  "evm_standard_proxy_indicator_count",
  "evm_implementation_candidate_count",
  "evm_standard_authority_count",
  "evm_no_code_authority_count",
  "evm_safe_compatible_interface_count",
  "evm_single_signer_safe_compatible_count",
] as const;

const CORE_PROJECT_QUESTIONS: readonly ExpectedQuestion[] = [
  { id: "project.product", domain: "product", prompt: "What product is operating, and what evidence demonstrates it?", materiality: "critical", factPredicates: ["product"] },
  { id: "project.founder", domain: "team", prompt: "Who founded the project?", materiality: "critical", factPredicates: ["founder"] },
  { id: "project.executive", domain: "team", prompt: "Who currently operates the project?", materiality: "important", factPredicates: ["executive", "current_role"] },
  { id: "project.legal_entity", domain: "legal", prompt: "Which legal entity is responsible for the project?", materiality: "critical", factPredicates: ["legal_entity"] },
  { id: "project.legal_regulatory", domain: "legal", prompt: "Which legal, regulatory, litigation, or sanctions exposures are directly bound to the responsible entity?", materiality: "critical", factPredicates: ["legal_regulatory_event"] },
  { id: "project.funding", domain: "funding", prompt: "What financing rounds and disclosed amounts are recorded?", materiality: "important", measurementIds: ["funding_round_count", "total_raised_usd", "provider_reported_total_funding_usd", "indexed_disclosed_round_sum_usd"], factPredicates: ["funding"] },
  { id: "project.security_incident", domain: "security", prompt: "What material security incidents are recorded?", materiality: "critical", measurementIds: ["largest_recorded_incident_usd"], factPredicates: ["security_incident"] },
  { id: "project.governance", domain: "governance", prompt: "How are governance decisions made and executed?", materiality: "important", factPredicates: ["governance"] },
  { id: "project.control", domain: "control", prompt: "Who holds administrative, upgrade, pause, mint, or custody control?", materiality: "critical", factPredicates: ["control"], measurementIds: EVM_CONTROL_MEASUREMENT_IDS },
  { id: "project.tokenomics", domain: "supply", prompt: "How is token supply allocated and economically used?", materiality: "important", measurementIds: ["circulating_supply", "total_supply", "max_supply", "circulating_supply_pct"], factPredicates: ["tokenomics"] },
  { id: "project.vesting", domain: "supply", prompt: "What vesting and unlock obligations remain?", materiality: "critical", measurementIds: ["next_unlock_date", "next_unlock_usd", "next_unlock_supply_pct", "next_90d_unlock_supply_pct"], factPredicates: ["vesting"] },
  { id: "project.treasury", domain: "treasury", prompt: "What treasury assets, liabilities, and spending controls exist?", materiality: "critical", factPredicates: ["treasury"] },
  { id: "project.audit", domain: "security", prompt: "Which independent audit engagements can be corroborated?", materiality: "important", measurementIds: ["audit_lead_count", "corroborated_audit_count", "audit_identity_anchor_gap_count", "audit_identity_anchor_mismatch_count"], factPredicates: ["audit"] },
  { id: "project.repository", domain: "product", prompt: "What public implementation and development record exists?", materiality: "important", factPredicates: ["repository"] },
  { id: "project.traction", domain: "economics", prompt: "What measured usage and economic traction exist?", materiality: "important", measurementIds: ["tvl_usd", "tvl_change_30d_pct", "protocol_fees_24h_usd", "protocol_fees_30d_usd", "protocol_fees_change_30d_pct"], factPredicates: ["traction"] },
] as const;

const COMPANY_DILIGENCE_QUESTIONS: readonly ExpectedQuestion[] = [
  { id: "company.registry_status", domain: "legal", prompt: "Which exact legal entity, jurisdiction, registration number, directors, and current registry status operate this brand?", materiality: "critical", factPredicates: ["legal_entity"] },
  { id: "company.operating_reality", domain: "operations", prompt: "Which dated customer, revenue, usage, headcount, delivery, or retention evidence establishes operating reality?", materiality: "critical", measurementIds: ["licensed_company_headcount_range"], factPredicates: ["traction", "track_record"] },
  { id: "company.customer_relationships", domain: "relationships", prompt: "Which customers, suppliers, and strategic partners independently confirm a current relationship?", materiality: "important", factPredicates: ["partnership"] },
  { id: "company.capital_structure", domain: "funding", prompt: "Which equity, debt, grants, financing rounds, and outstanding obligations are dated and source-bound?", materiality: "important", measurementIds: ["funding_round_count", "total_raised_usd", "provider_reported_total_funding_usd", "indexed_disclosed_round_sum_usd"], factPredicates: ["funding", "treasury"] },
  { id: "company.ownership_control", domain: "governance", prompt: "What ownership, beneficial control, board structure, signing authority, and related-party relationships are documented?", materiality: "critical", measurementIds: ["licensed_management_record_count", "licensed_company_ownership"], factPredicates: ["governance", "control", "conflict_of_interest"] },
  { id: "company.security_dependencies", domain: "security", prompt: "Which incidents, audits, critical vendors, custody arrangements, and operational dependencies could impair delivery or customer assets?", materiality: "important", factPredicates: ["security_incident", "audit", "repository"] },
  { id: "company.accountability_chronology", domain: "chronology", prompt: "Which dated founding, financing, management, product, and material-event records establish the company's chronology?", materiality: "important", measurementIds: ["licensed_company_founded_year", "latest_funding_round_date"], factPredicates: ["founded", "launched", "current_role", "prior_role", "funding"] },
] as const;

const ARCHETYPE_QUESTIONS: Partial<Record<ProductArchetype, readonly ExpectedQuestion[]>> = {
  dex: [
    { id: "archetype.dex.executable_depth", domain: "liquidity", prompt: "What executable depth exists at decision-sized trade amounts?", materiality: "critical", measurementIds: ["liquidity_usd", "volume_24h_usd"] },
    { id: "archetype.dex.fee_capture", domain: "economics", prompt: "Who captures trading fees and under what rules?", materiality: "important" },
    { id: "archetype.dex.admin_controls", domain: "control", prompt: "Which contracts can be upgraded, paused, or redirected?", materiality: "critical" },
  ],
  lending: [
    { id: "archetype.lending.utilization_bad_debt", domain: "economics", prompt: "What utilization and bad debt are currently recorded?", materiality: "critical" },
    { id: "archetype.lending.collateral_oracle", domain: "control", prompt: "How concentrated are collateral and oracle dependencies?", materiality: "critical" },
  ],
  stablecoin: [
    { id: "archetype.stablecoin.reserves", domain: "treasury", prompt: "What reserves and liabilities back the circulating supply?", materiality: "critical" },
    { id: "archetype.stablecoin.redemption", domain: "liquidity", prompt: "Who can redeem, at what cost, and under what constraints?", materiality: "critical" },
    { id: "archetype.stablecoin.peg", domain: "market", prompt: "How has the asset traded around its target value?", materiality: "important" },
  ],
  bridge: [
    { id: "archetype.bridge.validator_control", domain: "control", prompt: "Who controls bridge validation, upgrades, and emergency actions?", materiality: "critical" },
    { id: "archetype.bridge.asset_reconciliation", domain: "security", prompt: "Do locked assets reconcile with minted representations?", materiality: "critical" },
  ],
  layer_1: [
    { id: "archetype.layer_1.validator_concentration", domain: "control", prompt: "How concentrated are validators, delegations, and block-production authority?", materiality: "critical" },
    { id: "archetype.layer_1.client_consensus", domain: "security", prompt: "What client-diversity, liveness, and consensus-failure evidence is current?", materiality: "critical" },
    { id: "archetype.layer_1.issuance_security_budget", domain: "economics", prompt: "What funds validator rewards, and how does issuance compare with the security budget?", materiality: "important" },
  ],
  layer_2: [
    { id: "archetype.layer_2.sequencer_control", domain: "control", prompt: "Who controls sequencing, proving, upgrades, and emergency actions?", materiality: "critical" },
    { id: "archetype.layer_2.finality_dependencies", domain: "security", prompt: "What proving, data-availability, bridge, and settlement assumptions determine finality?", materiality: "critical" },
    { id: "archetype.layer_2.escape_hatch", domain: "control", prompt: "Can users exit or force inclusion when the sequencer or operator fails?", materiality: "critical" },
  ],
  staking: [
    { id: "archetype.staking.withdrawal_liquidity", domain: "liquidity", prompt: "What withdrawal queue, secondary liquidity, and redemption constraints apply?", materiality: "critical" },
    { id: "archetype.staking.operator_concentration", domain: "control", prompt: "How concentrated are validator operators, keys, and slashing exposure?", materiality: "critical" },
    { id: "archetype.staking.reward_source", domain: "economics", prompt: "How much reward comes from issuance, fees, incentives, or rehypothecation?", materiality: "important" },
  ],
  derivatives: [
    { id: "archetype.derivatives.collateral_oracle", domain: "control", prompt: "Which collateral, oracle, and keeper dependencies govern solvency?", materiality: "critical" },
    { id: "archetype.derivatives.liquidation_bad_debt", domain: "economics", prompt: "What liquidation performance, bad debt, and open-interest concentration are recorded?", materiality: "critical" },
    { id: "archetype.derivatives.insurance_backstop", domain: "treasury", prompt: "What insurance fund or loss-allocation backstop exists, and who controls it?", materiality: "critical" },
  ],
  exchange_or_custody: [
    { id: "archetype.exchange.legal_operator", domain: "legal", prompt: "Which legal operator and jurisdictions govern customer assets and claims?", materiality: "critical" },
    { id: "archetype.exchange.asset_segregation", domain: "treasury", prompt: "How are customer assets segregated, reconciled, and protected from company liabilities?", materiality: "critical" },
    { id: "archetype.exchange.reserves_liabilities", domain: "treasury", prompt: "Do current reserve proofs reconcile with complete customer liabilities?", materiality: "critical" },
    { id: "archetype.exchange.withdrawals", domain: "liquidity", prompt: "What withdrawal constraints, settlement times, and suspension powers apply?", materiality: "critical" },
  ],
  oracle_or_data: [
    { id: "archetype.oracle.source_concentration", domain: "control", prompt: "How concentrated are data sources, nodes, signers, and update authority?", materiality: "critical" },
    { id: "archetype.oracle.failure_modes", domain: "security", prompt: "What stale-data, manipulation, fallback, and outage controls are evidenced?", materiality: "critical" },
    { id: "archetype.oracle.consumer_dependency", domain: "economics", prompt: "Which live consumers and value-at-risk depend on the feed or data service?", materiality: "important" },
  ],
  payments: [
    { id: "archetype.payments.settlement_custody", domain: "control", prompt: "Who controls settlement, custody, reversals, and transaction screening?", materiality: "critical" },
    { id: "archetype.payments.licensing", domain: "legal", prompt: "Which licensed entities and jurisdictions cover the offered payment activity?", materiality: "critical" },
    { id: "archetype.payments.reconciliation", domain: "treasury", prompt: "How are customer funds, settlement balances, chargebacks, and losses reconciled?", materiality: "critical" },
  ],
  launchpad: [
    { id: "archetype.launchpad.allocation_vesting", domain: "supply", prompt: "How are allocations, vesting, refunds, and insider participation structured?", materiality: "critical" },
    { id: "archetype.launchpad.selection_conflicts", domain: "control", prompt: "Who selects launches, values offerings, and manages conflicts of interest?", materiality: "critical" },
    { id: "archetype.launchpad.proceeds_custody", domain: "treasury", prompt: "Who controls subscription proceeds before, during, and after settlement?", materiality: "critical" },
  ],
  gaming_or_nft: [
    { id: "archetype.gaming.active_economy", domain: "economics", prompt: "What active-user, payer, retention, and in-game economy evidence is current?", materiality: "important" },
    { id: "archetype.gaming.asset_control", domain: "control", prompt: "Who can alter, freeze, custody, or migrate user assets and marketplace rules?", materiality: "critical" },
    { id: "archetype.gaming.content_dependency", domain: "product", prompt: "Which live game or marketplace surfaces depend on centrally operated content and servers?", materiality: "important" },
  ],
  generic_protocol: [
    { id: "archetype.generic.dependency_map", domain: "control", prompt: "Which contracts, operators, oracles, bridges, and offchain services can change outcomes?", materiality: "critical" },
    { id: "archetype.generic.value_capture", domain: "economics", prompt: "How do measured users and fees become sustainable protocol or token value, if at all?", materiality: "important", measurementIds: ["tvl_usd", "protocol_fees_30d_usd"] },
  ],
};

function buildQuestions(
  evidence: Readonly<CollectedEvidence>,
  measurements: readonly IntelligenceMeasurement[],
  archetypes: IntelligenceSpineSnapshot["subject"]["archetypes"],
  forms: IntelligenceSpineSnapshot["subject"]["forms"],
): IntelligenceQuestion[] {
  const questions: IntelligenceQuestion[] = [];
  const facts = evidence.basicFacts ?? [];
  const identityBindings = crossProducerIdentityBindings(evidence);
  const sourceIds = new Set(buildSources(evidence).map((source) => source.id));
  const factByAnswerRef = new Map(facts.flatMap((fact) => [
    [fact.factId, fact] as const,
    [`fact:${fact.factId}`, fact] as const,
  ]));

  for (const entry of evidence.basicFactQuestionLedger ?? []) {
    const assessment = questionState(entry, facts, evidence.profile.handle);
    const matchingFactIds = new Set(assessment.matchingFacts.map((fact) => fact.factId));
    const answerRefs = uniqueSorted(entry.answerRefs.filter((reference) => {
      const referencedFact = factByAnswerRef.get(reference);
      return !referencedFact || matchingFactIds.has(referencedFact.factId);
    }));
    const factRefs = assessment.matchingFacts
      .flatMap((fact) => factSupportSourceRefs(fact))
      .filter((sourceRef) => sourceIds.has(sourceRef));
    const contradictionRefs = assessment.matchingFacts
      .flatMap((fact) => factContradictionSourceRefs(fact))
      .filter((sourceRef) => sourceIds.has(sourceRef));
    questions.push({
      id: entry.questionId,
      domain: domainForPredicate(entry.predicate),
      prompt: entry.question,
      materiality: entry.critical ? "critical" : "important",
      state: assessment.state,
      basis: assessment.basis,
      answerRefs,
      sourceRefs: uniqueSorted([...factRefs, ...contradictionRefs]),
    });
  }

  const existing = new Map(questions.map((question, index) => [question.id, index]));
  const expected = [...CORE_PROJECT_QUESTIONS];
  if (forms.some((form) => form.form === "company")) expected.push(...COMPANY_DILIGENCE_QUESTIONS);
  for (const match of archetypes.matches) {
    expected.push(...(ARCHETYPE_QUESTIONS[match.archetype] ?? []));
  }

  for (const definition of expected) {
    const relevantIds = new Set(definition.measurementIds ?? []);
    const relatedMeasurements = measurements.filter((measurement) => relevantIds.has(measurement.id));
    const existingIndex = existing.get(definition.id);
    if (existingIndex !== undefined) {
      const question = questions[existingIndex];
      if (!question) continue;
      const controlReadUnavailable = definition.id === "project.control"
        && identityBindings.evmControlMatched
        && evidence.evmControlReality?.state === "unavailable";
      if (relatedMeasurements.length > 0) {
        const hadBoundAnswer = question.answerRefs.length > 0 || question.sourceRefs.length > 0;
        questions[existingIndex] = {
          ...question,
          state: question.state === "resolved"
            ? "resolved"
            : controlReadUnavailable && !hadBoundAnswer
              ? "unavailable"
              : "partial",
          basis: question.state === "resolved"
            ? question.basis
            : controlReadUnavailable
              ? hadBoundAnswer
                ? `${question.basis} The fixed-block standard EVM read was unavailable, so the full control question remains open.`
                : "The fixed-block standard EVM read was unavailable, so no negative or complete control claim is inferred."
              : `${question.basis} Exact frozen measurements address part of the question but do not establish facet-level completeness.`,
          answerRefs: uniqueSorted([
            ...question.answerRefs,
            ...relatedMeasurements.map((measurement) => measurement.id),
          ]),
          sourceRefs: uniqueSorted([
            ...question.sourceRefs,
            ...relatedMeasurements.flatMap((measurement) => measurement.sourceRefs),
          ]),
        };
      }
      continue;
    }
    const candidateFacts = facts.filter((fact) =>
      factTargetsAuditedSubject(fact, evidence.profile.handle)
      && (definition.factPredicates ?? []).includes(fact.predicate)
      && (fact.status === "verified" || fact.status === "corroborated" || fact.status === "conflicted")
    );
    const exactFacts = candidateFacts.filter((fact) => fact.sources.some((source) => source.relation === "supports"));
    const conflictFacts = candidateFacts.filter((fact) => factConflictArtifacts(fact).marked);
    const hasConflict = conflictFacts.some((fact) => factConflictArtifacts(fact).complete);
    const hasConflictIntegrityGap = conflictFacts.length > 0 && !hasConflict;
    const exactFactRefs = exactFacts.flatMap((fact) => factSupportSourceRefs(fact));
    const contradictionRefs = candidateFacts.flatMap((fact) => factContradictionSourceRefs(fact));
    const addressedByFact = exactFacts.length > 0 || conflictFacts.length > 0;
    const controlReadUnavailable = definition.id === "project.control"
      && identityBindings.evmControlMatched
      && evidence.evmControlReality?.state === "unavailable";
    const derivedState: IntelligenceQuestionState = controlReadUnavailable && !addressedByFact
      ? "unavailable"
      : addressedByFact || relatedMeasurements.length > 0
        ? "partial"
        : "not_collected";
    const derivedBasis = controlReadUnavailable
      ? addressedByFact
        ? "Direct-subject control evidence is saved, but the fixed-block standard EVM read was unavailable and the full control question remains open."
        : "The fixed-block standard EVM read was unavailable, so no negative or complete control claim is inferred."
      : hasConflict
        ? "Saved sources conflict on this question, so the derived lane keeps it open."
        : hasConflictIntegrityGap
          ? malformedConflictBasis(conflictFacts)
        : addressedByFact
          ? "One or more exact-predicate facts address this question, but no frozen question-ledger completion establishes that the full question was answered."
          : relatedMeasurements.length > 0
            ? "The scan contains related measurements, but they do not answer the full decision question."
            : "This decision question has no completed collection record in the frozen scan.";
    questions.push({
      id: definition.id,
      domain: definition.domain,
      prompt: definition.prompt,
      materiality: definition.materiality,
      state: derivedState,
      basis: derivedBasis,
      answerRefs: uniqueSorted([
        ...candidateFacts.map((fact) => fact.factId),
        ...relatedMeasurements.map((measurement) => measurement.id),
      ]),
      sourceRefs: uniqueSorted([
        ...exactFactRefs,
        ...contradictionRefs,
        ...relatedMeasurements.flatMap((measurement) => measurement.sourceRefs),
      ]),
    });
    existing.set(definition.id, questions.length - 1);
  }

  return questions.sort((left, right) => left.id.localeCompare(right.id));
}

function coverageState(questions: readonly IntelligenceQuestion[], measurementCount: number): IntelligenceCoverageState {
  const openQuestions = questions.filter((question) =>
    question.state === "reported"
    || question.state === "partial"
    || question.state === "unresolved"
    || question.state === "unavailable"
    || question.state === "not_collected",
  );
  const closedQuestions = questions.filter((question) => question.state === "resolved");
  if (measurementCount > 0) return openQuestions.length > 0 ? "partial" : "measured";
  if (closedQuestions.length > 0 && openQuestions.length > 0) return "partial";
  if (questions.some((question) => question.state === "partial")) return "partial";
  const distinctOpenStates = new Set(openQuestions.map((question) => question.state));
  if (distinctOpenStates.size > 1) return "partial";
  if (questions.some((question) => question.state === "unresolved")) return "unresolved";
  if (questions.some((question) => question.state === "unavailable")) return "unavailable";
  if (questions.some((question) => question.state === "reported")) return "reported";
  if (closedQuestions.length > 0) return "reported";
  if (questions.length > 0 && questions.every((question) => question.state === "not_applicable")) return "not_applicable";
  return "not_collected";
}

/**
 * The base domain order plus every domain the snapshot actually used.
 *
 * COMPANY_DILIGENCE_QUESTIONS put a CRITICAL question in `operations` and
 * another in `relationships`, neither of which is in the project base order.
 * Those questions were tracked and answerable but got no coverage row at all,
 * so the surface that exists to show what was and was not covered silently
 * omitted them. Extras are appended in sorted order to stay deterministic.
 */
function withReferencedDomains(
  base: readonly IntelligenceDomain[],
  questions: readonly IntelligenceQuestion[],
  measurements: readonly IntelligenceMeasurement[],
): readonly IntelligenceDomain[] {
  const present = new Set<IntelligenceDomain>(base);
  const extra = new Set<IntelligenceDomain>();
  for (const domain of [
    ...questions.map((question) => question.domain),
    ...measurements.map((measurement) => measurement.domain),
  ]) {
    if (!present.has(domain)) extra.add(domain);
  }
  return extra.size ? [...base, ...[...extra].sort()] : base;
}

function buildCoverage(
  measurements: readonly IntelligenceMeasurement[],
  questions: readonly IntelligenceQuestion[],
  domains: readonly IntelligenceDomain[] = DOMAIN_ORDER,
): IntelligenceDomainCoverage[] {
  return domains.map((domain) => {
    const domainMeasurements = measurements.filter((measurement) => measurement.domain === domain);
    const domainQuestions = questions.filter((question) => question.domain === domain);
    const openQuestionCount = domainQuestions.filter((question) =>
      question.state === "reported"
      || question.state === "partial"
      || question.state === "unresolved"
      || question.state === "unavailable"
      || question.state === "not_collected",
    ).length;
    const state = coverageState(domainQuestions, domainMeasurements.length);
    return {
      domain,
      state,
      measurementIds: domainMeasurements.map((measurement) => measurement.id).sort(),
      questionIds: domainQuestions.map((question) => question.id).sort(),
      detail: domainMeasurements.length > 0
        ? `${domainMeasurements.length} frozen measurement${domainMeasurements.length === 1 ? "" : "s"}; ${openQuestionCount > 0 ? `${openQuestionCount} decision question${openQuestionCount === 1 ? " remains" : "s remain"} open.` : "no tracked decision question remains open."}`
        : domainQuestions.length > 0
          ? `No quantitative measurement; ${domainQuestions.length} decision question${domainQuestions.length === 1 ? "" : "s"} tracked, ${openQuestionCount} open.`
          : "No measurement or explicit collection record is present.",
    };
  });
}

function buildSignals(
  evidence: Readonly<CollectedEvidence>,
  measurements: readonly IntelligenceMeasurement[],
  questions: readonly IntelligenceQuestion[],
): DerivedIntelligenceSignal[] {
  const signals: DerivedIntelligenceSignal[] = [];
  const identityBindings = crossProducerIdentityBindings(evidence);
  const derivedLaunchWindow = recomputeLaunchWindow(
    evidence,
    identityBindings.domainRegistrationMatched,
    identityBindings.accountCreationReceiptComplete,
  );
  const measurementMap = new Map(measurements.map((measurement) => [measurement.id, measurement]));
  const numberValue = (id: string): number | undefined => {
    const measurement = measurementMap.get(id);
    return measurement?.valueType === "number" ? measurement.value : undefined;
  };
  const textValue = (id: string): string | undefined => {
    const measurement = measurementMap.get(id);
    return measurement?.valueType === "text" ? measurement.value : undefined;
  };
  const addSignal = (signal: DerivedIntelligenceSignal): void => {
    signals.push({
      ...signal,
      measurementRefs: uniqueSorted(signal.measurementRefs),
      sourceRefs: uniqueSorted(signal.sourceRefs),
      lenses: uniqueSorted(signal.lenses) as DecisionLensId[],
    });
  };
  type ArithmeticTemporal = NonNullable<NonNullable<DerivedIntelligenceSignal["arithmetic"]>[number]["temporal"]>;
  const MAX_CROSS_SOURCE_SKEW_HOURS = 72;
  const emittedTemporalGapIds = new Set<string>();
  const temporalAlignment = (
    comparisonId: string,
    measurementIds: readonly string[],
    state: ArithmeticTemporal["state"] = "aligned",
  ): ArithmeticTemporal | null => {
    const inputAsOf = measurementIds.map((measurementId) => ({
      measurementId,
      asOf: measurementMap.get(measurementId)?.window?.asOf,
    }));
    const invalid = inputAsOf.filter((entry) =>
      typeof entry.asOf !== "string" || !Number.isFinite(Date.parse(entry.asOf)));
    const times = inputAsOf
      .flatMap((entry) => typeof entry.asOf === "string" && Number.isFinite(Date.parse(entry.asOf))
        ? [Date.parse(entry.asOf)]
        : []);
    const maxInputSkewHours = times.length > 0
      ? rounded((Math.max(...times) - Math.min(...times)) / 3_600_000, 4)
      : 0;
    if (invalid.length === 0 && maxInputSkewHours <= MAX_CROSS_SOURCE_SKEW_HOURS) {
      return {
        state,
        maxInputSkewHours,
        inputAsOf: inputAsOf.map((entry) => ({ measurementId: entry.measurementId, asOf: entry.asOf! })),
      };
    }

    const gapId = `temporal_alignment_gap:${comparisonId}`;
    if (!emittedTemporalGapIds.has(gapId)) {
      emittedTemporalGapIds.add(gapId);
      const exactBasis = inputAsOf
        .map((entry) => `${entry.measurementId}=${entry.asOf ?? "missing"}`)
        .join("; ");
      addSignal({
        id: gapId,
        ruleId: "temporal-alignment-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "chronology",
        severity: "medium",
        polarity: "unknown",
        headline: "Derived comparison is withheld for temporal misalignment",
        finding: invalid.length > 0
          ? `The ${comparisonId.replaceAll("_", " ")} comparison lacks a valid frozen as-of for ${invalid.map((entry) => entry.measurementId).join(", ")}. Exact input basis: ${exactBasis}.`
          : `The ${comparisonId.replaceAll("_", " ")} comparison spans ${maxInputSkewHours} hours, above the 72-hour maximum. Exact input basis: ${exactBasis}.`,
        whyItMatters: "A mathematically correct ratio can still be decision-misleading when its inputs describe materially different market states.",
        changeCondition: "Recollect every input with valid frozen as-of timestamps no more than 72 hours apart, then recompute.",
        evidenceState: "bounded",
        measurementRefs: [...measurementIds],
        sourceRefs: refsFromMeasurements(measurementMap, measurementIds),
        lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
      });
    }
    return null;
  };

  const canonicalTokenBinding = identityBindings.canonicalTokenVerified
    ? `${identityBindings.canonicalChain ?? "missing chain"}:${identityBindings.canonicalAddress ?? "missing address"}, CoinGecko id ${identityBindings.canonicalGeckoId ?? "missing"}`
    : "no verified canonical token record";
  if (evidence.projectToken && !identityBindings.canonicalTokenVerified) {
    addSignal({
      id: "canonical_token_identity_unverified",
      ruleId: "canonical-token-identity-unverified",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "The saved token candidate is not verified canonical identity",
      finding: "A project-token-shaped record is present, but its runtime verified field is not exactly true. ARGUS retains its producer receipts and withholds every token form, measurement, support signal, and derived arithmetic from this layer.",
      whyItMatters: "A plausible ticker, name, address, or market record can belong to a different asset and contaminate every downstream decision surface.",
      changeCondition: "Recollect the token through an official-X or official-domain identity join and freeze verified: true before using its fields.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: uniqueSorted([
        "snapshot:project-token",
        ...(evidence.projectToken.producerSources?.market ? ["snapshot:project-token-market"] : []),
        ...(evidence.projectToken.producerSources?.liquidity ? ["snapshot:project-token-liquidity"] : []),
        ...(evidence.projectToken.producerSources?.history ? ["snapshot:project-token-history"] : []),
      ]),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.protocolTvl && !identityBindings.protocolTvlMatched) {
    addSignal({
      id: "protocol_tvl_identity_mismatch",
      ruleId: "protocol-tvl-identity-mismatch",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "Protocol TVL does not rebind to the canonical token",
      finding: `The saved protocol TVL row carries CoinGecko id ${evidence.protocolTvl.geckoId ?? "missing"}, while the canonical binding is ${canonicalTokenBinding}. TVL, chain, incident, governance, and trend fields from this row are withheld.`,
      whyItMatters: "Protocol-name and slug collisions can attach another project's capital, incidents, or governance metadata to the audited subject.",
      changeCondition: "Recollect a protocol row whose normalized CoinGecko id exactly matches the verified canonical token id.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: ["snapshot:protocol-tvl"],
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.protocolFunding && !identityBindings.protocolFundingMatched) {
    addSignal({
      id: "protocol_funding_identity_mismatch",
      ruleId: "protocol-funding-identity-mismatch",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "Protocol funding does not rebind to the canonical token",
      finding: `The saved protocol funding row carries CoinGecko id ${evidence.protocolFunding.geckoId ?? "missing"}, while the canonical binding is ${canonicalTokenBinding}. Round, investor, valuation, and capital-scale fields from this row are withheld.`,
      whyItMatters: "A namesake funding record can create precise but false claims about investors, capital raised, and financing recency.",
      changeCondition: "Recollect a funding row whose normalized CoinGecko id exactly matches the verified canonical token id.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: ["snapshot:protocol-funding"],
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }
  if (evidence.protocolFees && !identityBindings.protocolFeesMatched) {
    const feeBindingFailure = identityBindings.protocolFeesReceiptComplete
      ? `The saved fee row uses slug ${evidence.protocolFees.slug}, but no same-slug TVL or funding record in this scan exactly rebinds to the verified canonical token.`
      : `The saved fee row uses slug ${evidence.protocolFees.slug} but lacks a complete binding with method matched_protocol_gecko_id, an exact canonical CoinGecko id, and an exact same-slug protocolSlug.`;
    addSignal({
      id: "protocol_fees_identity_unbound",
      ruleId: "protocol-fees-identity-unbound",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "Protocol fees lack an identity-bound protocol record",
      finding: `${feeBindingFailure} Fee totals, growth, and every fee-based ratio are withheld.`,
      whyItMatters: "A discovery slug is not identity, and another protocol's fees can fabricate traction or capital-efficiency conclusions.",
      changeCondition: "First bind a same-slug protocol TVL or funding record by exact CoinGecko id, then recollect the fee row.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: ["snapshot:protocol-fees"],
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.companyEnrichment && !identityBindings.companyEnrichmentMatched) {
    addSignal({
      id: "company_enrichment_identity_unbound",
      ruleId: "company-enrichment-identity-unbound",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "The licensed company record does not rebind to the official domain",
      finding: `The saved company receipt carries identity state ${evidence.companyEnrichment.identityMatch ?? "missing"}, requested host ${identityBindings.companyRequestedHost ?? "missing"}, matched host ${identityBindings.companyMatchedHost ?? "missing"}, method ${evidence.companyEnrichment.matchMethod ?? "missing"}, and canonical subject host ${identityBindings.canonicalCompanyHost ?? "missing"}. It does not complete an exact official-domain join, so funding, management, firmographic, legal-form, and every company-derived ratio are withheld.`,
      whyItMatters: "A name-alike or attacker-selected company record can fabricate precise investors, funding, leadership, headcount, and legal context for the audited subject.",
      changeCondition: "Recollect the company record from the canonical official host and freeze coherent requested host, matched host, match method, company website, and capture timestamp fields.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: ["snapshot:company-enrichment"],
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }
  if (evidence.domainRegistration && !identityBindings.domainRegistrationMatched) {
    addSignal({
      id: "domain_registration_identity_unbound",
      ruleId: "domain-registration-identity-unbound",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "The RDAP row does not rebind to the frozen official hostname",
      finding: `The saved RDAP receipt names registrable domain ${identityBindings.registeredDomain ?? "missing"} and queried hostname ${identityBindings.registeredHostname ?? "missing"}; the canonical official host is ${identityBindings.canonicalDomainHost ?? "missing"}. The receipt, its age field, and any dependent launch comparison are retained only as unbound context and withheld from subject-level intelligence.`,
      whyItMatters: "A valid registry date for the wrong domain can manufacture project age and an apparently precise public-launch chronology.",
      changeCondition: "Repeat RDAP collection from the frozen canonical official hostname and preserve the exact queried hostname, registrable domain, endpoint, dates, and capture timestamp.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: uniqueSorted([
        "snapshot:domain-registration",
        ...(evidence.launchWindow ? ["snapshot:launch-window"] : []),
      ]),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.launchWindow && !derivedLaunchWindow) {
    addSignal({
      id: "launch_window_inputs_unbound",
      ruleId: "launch-window-inputs-unbound",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "chronology",
      severity: identityBindings.domainRegistrationMatched ? "medium" : "high",
      polarity: "unknown",
      headline: "The saved launch-window comparison cannot be reproduced from bound inputs",
      finding: "A launch-window-shaped record is saved, but ARGUS cannot reproduce it from both an exact official-domain RDAP receipt and a chronologically valid resolved-profile account-creation receipt. Its dates, labels, summary, and gap are not published as measurements.",
      whyItMatters: "A precomputed comparison is not self-authenticating; one unbound or malformed input can create a false project-age narrative.",
      changeCondition: "Freeze a bound RDAP record and a resolved provider-captured account creation timestamp, then recompute the window deterministically.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: uniqueSorted([
        "snapshot:launch-window",
        ...(evidence.domainRegistration ? ["snapshot:domain-registration"] : []),
        ...(evidence.profile.account_created_at ? ["snapshot:account-created-at"] : []),
      ]),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.holderProfile && !identityBindings.holderProfileMatched) {
    addSignal({
      id: "holder_profile_identity_unbound",
      ruleId: "holder-profile-identity-unbound",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "The holder profile is not exactly bound to the canonical token",
      finding: `The holder sidecar lacks a complete canonical_token_address_chain receipt matching ${canonicalTokenBinding}. Holder counts, concentration, liquidity-lock fields, provider flags, and every holder-based risk calculation are withheld.`,
      whyItMatters: "A valid holder register for another contract can fabricate concentration, control, and exit-liquidity conclusions for the audited token.",
      changeCondition: "Recollect the holder sidecar with method canonical_token_address_chain and an exact normalized address and chain match to the verified token.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: uniqueSorted([
        "snapshot:holder-profile",
        ...(evidence.holderProfile.distributionSource === "explorer" && evidence.holderProfile.distributionSourceUrl
          ? ["snapshot:holder-distribution"]
          : []),
      ]),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.tokenUnlocks && !identityBindings.tokenUnlocksMatched) {
    const receiptState = identityBindings.tokenUnlockReceiptComplete
      ? `The complete receipt maps to ${evidence.tokenUnlocks.chain}:${evidence.tokenUnlocks.canonicalAddress}, while the canonical binding is ${canonicalTokenBinding}.`
      : "The row lacks a complete currency id, contract-map URL, events URL, canonical address, and canonical chain receipt.";
    addSignal({
      id: "token_unlock_identity_unbound",
      ruleId: "token-unlock-identity-unbound",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "The unlock schedule is not exactly bound to the canonical token",
      finding: `${receiptState} Unlock dates, values, supply shares, and liquidity comparisons are withheld.`,
      whyItMatters: "An attacker-chosen ticker or a stale currency lookup can attach another asset's scheduled supply to the audited project.",
      changeCondition: "Freeze both exact CryptoRank endpoint receipts and require their currency's normalized contract address and chain to match the verified canonical token.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: uniqueSorted([
        "snapshot:token-unlocks",
        ...(evidence.tokenUnlocks.contractSourceUrl ? ["snapshot:token-unlock-contract-map"] : []),
        ...(evidence.tokenUnlocks.eventsSourceUrl ? ["snapshot:token-unlock-events"] : []),
      ]),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }
  if (evidence.evmControlReality && !identityBindings.evmControlMatched) {
    addSignal({
      id: "evm_control_identity_mismatch",
      ruleId: "evm-control-identity-mismatch",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: "high",
      polarity: "unknown",
      headline: "The EVM control read targets a different canonical identity",
      finding: `The fixed-block receipt targets ${evidence.evmControlReality.chain}:${evidence.evmControlReality.target}, while the canonical binding is ${canonicalTokenBinding}. Proxy, authority, signer, code-state, and audit-to-deployment interpretations are withheld.`,
      whyItMatters: "A valid RPC read of the wrong address or network can look technically precise while describing an unrelated contract.",
      changeCondition: "Repeat the fixed-block read only after its normalized target address and chain exactly match the verified canonical token.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: ["snapshot:evm-control-reality"],
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }
  if (evidence.projectToken && identityBindings.canonicalTokenVerified) {
    const circulating = evidence.projectToken.circulatingSupply;
    const total = evidence.projectToken.totalSupply;
    const bothSupplyInputsPresent = circulating !== undefined
      && circulating !== null
      && total !== undefined
      && total !== null;
    const supplyInputsCoherent = finite(circulating)
      && circulating >= 0
      && positive(total)
      && circulating <= total;
    if (bothSupplyInputsPresent && !supplyInputsCoherent) {
      addSignal({
        id: "circulating_supply_reconciliation_gap",
        ruleId: "circulating-supply-reconciliation-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "supply",
        severity: "high",
        polarity: "unknown",
        headline: "Reported circulating and total supply do not reconcile",
        finding: `The canonical market record reports circulating supply ${String(circulating)} and total supply ${String(total)}. A circulating-share percentage is withheld because the numerator must be nonnegative, the denominator must be positive, and circulating supply cannot exceed total supply.`,
        whyItMatters: "An impossible supply ratio can create false float, dilution, and valuation conclusions even when both provider fields look precise.",
        changeCondition: "Reconcile the provider's circulating and total supply values, then recompute only when the bounded ratio lies within 0% to 100%.",
        evidenceState: "bounded",
        measurementRefs: [],
        sourceRefs: [evidence.projectToken.producerSources?.market ? "snapshot:project-token-market" : "snapshot:project-token"],
        lenses: ["investment", "alpha_research", "general_diligence"],
      });
    }
  }
  if (evidence.tokenUnlocks && identityBindings.tokenUnlocksMatched) {
    const allowedFields = new Set([
      "percentOfSupply",
      "percentOfMcap",
      "cumulativeUnlockedPercent",
      "next90dPercentOfSupply",
    ]);
    const invalidFields = new Set<string>(
      (evidence.tokenUnlocks.percentageValidation?.invalidFields ?? [])
        .filter((field) => allowedFields.has(field)),
    );
    for (const [field, value] of [
      ["percentOfSupply", evidence.tokenUnlocks.percentOfSupply],
      ["percentOfMcap", evidence.tokenUnlocks.percentOfMcap],
      ["cumulativeUnlockedPercent", evidence.tokenUnlocks.cumulativeUnlockedPercent],
      ["next90dPercentOfSupply", evidence.tokenUnlocks.next90dPercentOfSupply],
    ] as const) {
      if (value !== undefined && value !== null && !percentageInRange(value)) invalidFields.add(field);
    }
    if (invalidFields.size > 0) {
      addSignal({
        id: "token_unlock_percentage_reconciliation_gap",
        ruleId: "token-unlock-percentage-reconciliation-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "supply",
        severity: "high",
        polarity: "unknown",
        headline: "Provider unlock percentages failed bounded-value reconciliation",
        finding: `The identity-bound unlock receipt contains or records invalid percentage fields: ${[...invalidFields].sort().join(", ")}. Values outside 0% to 100%, including a 90-day aggregate above 100%, are withheld from measurements and arithmetic while the source receipts remain available.`,
        whyItMatters: "Impossible schedule percentages can turn a valid token identity join into false dilution and liquidity-pressure conclusions.",
        changeCondition: "Reconcile the CryptoRank event payload and recollect percentage values that are finite and bounded within 0% to 100%.",
        evidenceState: "bounded",
        measurementRefs: [],
        sourceRefs: uniqueSorted([
          "snapshot:token-unlocks",
          ...(evidence.tokenUnlocks.contractSourceUrl ? ["snapshot:token-unlock-contract-map"] : []),
          ...(evidence.tokenUnlocks.eventsSourceUrl ? ["snapshot:token-unlock-events"] : []),
        ]),
        lenses: ["investment", "alpha_research", "general_diligence"],
      });
    }
  }

  for (const fact of evidence.basicFacts ?? []) {
    if (!factTargetsAuditedSubject(fact, evidence.profile.handle)) continue;
    const contradictionRefs = factContradictionSourceRefs(fact);
    const supportRefs = factSupportSourceRefs(fact);
    const artifactState = factConflictArtifacts(fact);
    if (!artifactState.marked) continue;
    const domain = domainForPredicate(fact.predicate);
    const boundedValue = fact.value.length > 180 ? `${fact.value.slice(0, 177)}...` : fact.value;
    if (!artifactState.complete) {
      const missing = artifactState.missing === "both"
        ? "supporting and contradicting artifacts"
        : `${artifactState.missing} artifact`;
      addSignal({
        id: `basic_fact_conflict_integrity_gap:${fact.factId}`,
        ruleId: "basic-fact-conflict-artifact-integrity",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain,
        severity: fact.critical ? "high" : "medium",
        polarity: "unknown",
        headline: `Frozen conflict record is missing ${missing}`,
        finding: `The frozen claim "${boundedValue}" is marked as conflicted, but its saved record does not contain both sides of that conflict. ARGUS does not claim that saved sources disagree.`,
        whyItMatters: "A conflict label without both checkable artifacts cannot establish either disagreement or the underlying claim.",
        changeCondition: "Recheck when both the supporting and contradicting artifacts are frozen, or the conflict marker is corrected.",
        evidenceState: "bounded",
        measurementRefs: [],
        sourceRefs: [...supportRefs, ...contradictionRefs],
        lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
      });
      continue;
    }
    addSignal({
      id: `basic_fact_conflict:${fact.factId}`,
      ruleId: "basic-fact-source-conflict",
      ruleVersion: 1,
      kind: "observation",
      domain,
      severity: fact.critical ? "high" : "medium",
      polarity: "mixed",
      headline: `Saved sources conflict on a ${fact.predicate.replaceAll("_", " ")} claim`,
      finding: `Saved sources both support and contradict the frozen claim "${boundedValue}". ARGUS does not choose a side in this derived layer.`,
      whyItMatters: "A decision that relies on this claim needs the conflicting artifacts reconciled before the claim is treated as established.",
      changeCondition: "Recheck when the underlying artifacts are reconciled or a controlling primary record supersedes them.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: [...supportRefs, ...contradictionRefs],
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  for (const [findingIndex, finding] of evidence.findings.entries()) {
    const directSubject = findingTargetsAuditedSubject(finding, evidence.profile.handle);
    const verified = finding.artifact_verified === true
      && finding.evidence_origin !== "model_lead"
      && finding.verification_status.toLowerCase() === "verified"
      && finding.independent_source_count >= 1
      && findingHasEligibleArtifact(finding);
    if (!directSubject || !verified || finding.polarity >= 0 || !finding.claim.trim()) continue;
    const boundedClaim = finding.claim.length > 260 ? `${finding.claim.slice(0, 257)}...` : finding.claim;
    addSignal({
      id: `verified_adverse_finding:${String(findingIndex + 1).padStart(3, "0")}`,
      ruleId: "verified-direct-subject-adverse-finding",
      ruleVersion: 1,
      kind: "observation",
      domain: domainForFinding(finding),
      severity: finding.independent_source_count >= 2 ? "high" : "medium",
      polarity: "risk",
      headline: `Verified adverse record: ${finding.finding_type.replaceAll("_", " ")}`,
      finding: boundedClaim,
      whyItMatters: "This is a verified direct-subject finding from the governing evidence bag. The derived decision lens cannot omit or override it.",
      changeCondition: "Recheck only when the underlying artifact, subject attribution, or verified disposition changes.",
      evidenceState: "verified",
      measurementRefs: [],
      sourceRefs: [`finding:${String(findingIndex + 1).padStart(3, "0")}`],
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const strictSignalDefinitions: Array<{
    id: string;
    predicates: BasicFactPredicate[];
    domain: IntelligenceDomain;
    headline: string;
    whyItMatters: string;
    lenses: DecisionLensId[];
  }> = [{
    id: "strict_product_description",
    predicates: ["product"],
    domain: "product",
    headline: "Product description has strict direct-subject sourcing",
    whyItMatters: "The diligence case can distinguish a sourced product description from a name, ticker, biography, or provider projection.",
    lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
  }, {
    id: "strict_legal_entity_identity",
    predicates: ["legal_entity"],
    domain: "legal",
    headline: "A responsible legal entity is source-backed",
    whyItMatters: "A bound legal entity gives contract, regulatory, and accountability work a concrete subject without establishing solvency or compliance by itself.",
    lenses: ["investment", "counterparty", "general_diligence"],
  }, {
    id: "strict_operator_identity",
    predicates: ["founder", "executive", "current_role"],
    domain: "team",
    headline: "Named founders or current operators have strict source backing",
    whyItMatters: "Direct-subject founder or current-role records improve accountability while making no claim that every named founder still operates the project, or that the roster is complete.",
    lenses: ["investment", "counterparty", "general_diligence"],
  }];
  for (const definition of strictSignalDefinitions) {
    const strictFacts = (evidence.basicFacts ?? []).filter((fact) =>
      definition.predicates.includes(fact.predicate)
      && factTargetsAuditedSubject(fact, evidence.profile.handle)
      && isStrictSourceBackedFact(fact),
    );
    if (strictFacts.length === 0) continue;
    const values = uniqueSorted(strictFacts.map((fact) => fact.value)).slice(0, 3);
    addSignal({
      id: definition.id,
      ruleId: definition.id.replaceAll("_", "-"),
      ruleVersion: 1,
      kind: "observation",
      domain: definition.domain,
      severity: "low",
      polarity: "support",
      headline: definition.headline,
      finding: `${strictFacts.length} strict direct-subject fact${strictFacts.length === 1 ? " is" : "s are"} saved: ${values.join("; ")}${strictFacts.length > values.length ? "; additional records are retained in the question ledger" : ""}. This supports the evidence base, not a quality or safety conclusion.`,
      whyItMatters: definition.whyItMatters,
      changeCondition: "Recheck if the direct-subject source, attribution, or current status changes.",
      evidenceState: "verified",
      measurementRefs: [],
      sourceRefs: strictFacts.flatMap((fact) => factSupportSourceRefs(fact, true)),
      lenses: definition.lenses,
    });
  }

  const unresolvedNameLeadDefinitions = [{
    kind: "legal_case" as const,
    measurementId: "legal_case_name_match_lead_count",
    headline: "Court-record name matches remain identity-unresolved leads",
    noun: "court-record",
  }, {
    kind: "sanctions_screen" as const,
    measurementId: "sanctions_name_match_lead_count",
    headline: "Sanctions-dataset name matches remain identity-unresolved leads",
    noun: "sanctions-dataset",
  }];
  for (const definition of unresolvedNameLeadDefinitions) {
    const leadCount = numberValue(definition.measurementId);
    if (!positive(leadCount)) continue;
    const measurementRefs = [definition.measurementId];
    addSignal({
      id: `${definition.kind}_identity_resolution_gap`,
      ruleId: `${definition.kind.replaceAll("_", "-")}-identity-resolution-gap`,
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "legal",
      severity: "medium",
      polarity: "unknown",
      headline: definition.headline,
      finding: `${leadCount} ${definition.noun} name-match lead${leadCount === 1 ? " is" : "s are"} retained. A matching name does not bind any row to the audited legal person or entity, so ARGUS makes no allegation and does not treat the row as adverse evidence.`,
      whyItMatters: "Name collisions are common enough that publishing a legal or sanctions claim before entity resolution can create a precise false allegation.",
      changeCondition: "Resolve each lead through exact legal-entity identifiers, jurisdiction, dates, addresses, and controlling primary records before changing the subject-level conclusion.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  if (evidence.profileAuthenticity) {
    const expectedFlag = PROFILE_PHOTO_REVIEW_LEADS.has(evidence.profileAuthenticity.classification);
    const measurementRefs = uniqueSorted([
      "provider_profile_photo_classification",
      ...(numberValue("provider_profile_photo_confidence_pct") !== undefined
        ? ["provider_profile_photo_confidence_pct"]
        : []),
      ...(textValue("provider_profile_photo_real_person_opinion") !== undefined
        ? ["provider_profile_photo_real_person_opinion"]
        : []),
    ]);
    if (evidence.profileAuthenticity.flag !== expectedFlag) {
      addSignal({
        id: "profile_photo_screen_integrity_gap",
        ruleId: "profile-photo-screen-integrity-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "identity",
        severity: "medium",
        polarity: "unknown",
        headline: "The frozen profile-image flag conflicts with its classification",
        finding: `${evidence.profileAuthenticity.provider} saved classification ${evidence.profileAuthenticity.classification} with flag ${String(evidence.profileAuthenticity.flag)}. ARGUS withholds the review lead because those provider fields do not satisfy the deterministic classification-to-flag contract.`,
        whyItMatters: "A contradictory provider payload must not silently clear or manufacture an identity concern.",
        changeCondition: "Repeat the image screen and freeze a validated classification whose derived review flag agrees with the classification contract.",
        evidenceState: "reported_context",
        measurementRefs,
        sourceRefs: ["snapshot:profile-authenticity"],
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    } else if (expectedFlag) {
      const tells = evidence.profileAuthenticity.tells.map((tell) => boundedText(tell, 100)).filter((tell): tell is string => Boolean(tell));
      addSignal({
        id: "provider_profile_photo_review_lead",
        ruleId: "provider-profile-photo-review-lead",
        ruleVersion: 1,
        kind: "screening_heuristic",
        domain: "identity",
        severity: "context",
        polarity: "unknown",
        headline: `${evidence.profileAuthenticity.provider} profile-image screen warrants human review`,
        finding: `${evidence.profileAuthenticity.provider} classified the inspected image as ${evidence.profileAuthenticity.classification}${finite(evidence.profileAuthenticity.confidence) ? ` at ${rounded(evidence.profileAuthenticity.confidence * 100, 1)}% reported confidence` : ""}${tells.length > 0 ? ` and reported: ${tells.slice(0, 3).join("; ")}` : ""}. This is the provider's visual-screening opinion, not identity proof, impersonation proof, or an ARGUS deception finding.`,
        whyItMatters: "The result identifies a concrete image-provenance question to verify without substituting visual inference for public identity evidence.",
        changeCondition: "Resolve through the original image provenance and public account or operator identity records, or repeat the screen when the exact image bytes change.",
        evidenceState: "reported_context",
        measurementRefs,
        sourceRefs: ["snapshot:profile-authenticity"],
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    }
  }

  if (evidence.trustGraphScreen) {
    const sourceRefs = ["snapshot:trust-graph-screen"];
    const adverseConnections = qualifiedAdverseTrustConnections(evidence);
    if (adverseConnections.length > 0) {
      const hardConnection = adverseConnections.some(({ ties }) => ties.some((tie) => tie.strength === "hard"));
      const summaries = adverseConnections.slice(0, 4).map(({ connection, ties }) => {
        const labels = uniqueSorted(ties.map((tie) => `${tie.label} (${tie.strength})`)).slice(0, 3);
        return `${connection.other} (${connection.otherVerdict}) through ${labels.join(", ")}`;
      });
      addSignal({
        id: "qualified_adverse_trust_graph_relationship",
        ruleId: "qualified-adverse-trust-graph-relationship",
        ruleVersion: 1,
        kind: "observation",
        domain: "identity",
        severity: hardConnection ? "high" : "medium",
        polarity: "risk",
        headline: "Exact organization-graph relationships reach complete adverse reports",
        finding: `${adverseConnections.length} relationship${adverseConnections.length === 1 ? " is" : "s are"} bound to exact complete server-collected FAIL or AVOID report versions: ${summaries.join("; ")}. This establishes saved graph relationships only. It does not establish participation, responsibility, common control, or shared conduct.`,
        whyItMatters: "Hard infrastructure or medium team and domain overlaps can identify operational dependencies or shared actors that deserve direct case-by-case verification.",
        changeCondition: "Reconcile the exact tie against current primary records, or update when the linked immutable report, attestation, completeness, verdict, or relationship evidence changes.",
        evidenceState: "verified",
        measurementRefs: ["qualified_adverse_trust_graph_connection_count"],
        sourceRefs,
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    }
    const unresolvedCount = numberValue("unqualified_trust_graph_connection_count");
    if (evidence.trustGraphScreen.status === "incomplete" || positive(unresolvedCount)) {
      addSignal({
        id: "trust_graph_qualification_gap",
        ruleId: "trust-graph-qualification-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "identity",
        severity: "medium",
        polarity: "unknown",
        headline: "Part of the saved relationship graph failed qualification",
        finding: `${positive(unresolvedCount) ? `${unresolvedCount} saved relationship${unresolvedCount === 1 ? " is" : "s are"}` : "The saved screen is"} incomplete because an exact active report, complete server attestation, or complete coverage state could not be established. ARGUS does not infer a clear or adverse result from those rows.`,
        whyItMatters: "A relationship becomes decision evidence only after both the tie and the linked report version survive identity, attestation, completeness, and freshness gates.",
        changeCondition: "Re-run the organization graph after every linked case has an exact active immutable version, complete server attestation, and current required checks.",
        evidenceState: "bounded",
        measurementRefs: positive(unresolvedCount) ? ["unqualified_trust_graph_connection_count"] : [],
        sourceRefs,
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    }
    if (
      !SHA256_HEX.test(evidence.trustGraphScreen.sourceContentHash)
      || (evidence.trustGraphScreen.status === "risk" && adverseConnections.length === 0)
    ) {
      addSignal({
        id: "trust_graph_receipt_integrity_gap",
        ruleId: "trust-graph-receipt-integrity-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "identity",
        severity: "high",
        polarity: "unknown",
        headline: "The trust-graph risk state lacks an admissible exact receipt",
        finding: "The saved graph screen lacks a valid source-content hash or reports risk without any relationship that passes the qualified, complete, server-collected, adverse-verdict, exact-report-version, and non-weak-tie gates. No graph risk claim is admitted from this screen.",
        whyItMatters: "A mutable graph label or weak relationship must not become a subject-level adverse claim.",
        changeCondition: "Recollect a content-addressed graph screen whose individual relationships pass every immutable report and tie qualification gate.",
        evidenceState: "bounded",
        measurementRefs: [],
        sourceRefs,
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    }
  }

  if (evidence.contradictions.length > 0) {
    const measurementRefs = ["analyst_contradiction_lead_count"];
    const examples = evidence.contradictions.slice(0, 3).map((row) => `${boundedText(row.claim, 100) ?? "missing claim"} versus ${boundedText(row.conflict, 100) ?? "missing conflict"}`);
    addSignal({
      id: "analyst_contradiction_artifact_gap",
      ruleId: "analyst-contradiction-artifact-gap",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "identity",
      severity: evidence.contradictions.some((row) => row.severity === "high") ? "medium" : "context",
      polarity: "unknown",
      headline: "Analyst-reported conflict leads lack artifact-level binding",
      finding: `${evidence.contradictions.length} analyst-reported lead${evidence.contradictions.length === 1 ? " is" : "s are"} retained for review: ${examples.join("; ")}. These rows carry no source references, so ARGUS does not claim that saved artifacts actually conflict.`,
      whyItMatters: "A plausible contradiction can be a scope mismatch, stale statement, or analysis error unless both sides are preserved as checkable artifacts.",
      changeCondition: "Promote a lead only after saving exact supporting and contradicting artifacts bound to the audited subject and the same claim scope.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  for (const { artifact, index, binding } of evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index, binding: portfolioRelationshipBinding(artifact, evidence) }))
    .filter((row): row is { artifact: FrozenSourceArtifact; index: number; binding: PortfolioRelationshipBinding } => row.binding !== null)) {
    const relationshipText = binding === "audited_project"
      ? `${artifact.investorEntityName ?? artifact.subjectName ?? "A separately named investor"} is recorded as investing in the exact-handle audited project ${artifact.projectName}.`
      : binding === "direct_subject"
        ? `The exact audited handle is recorded as investing in ${artifact.projectName}.`
        : `${artifact.investorEntityName} is recorded as investing in ${artifact.projectName}; the investment belongs to that affiliated fund, not to the audited subject personally.`;
    addSignal({
      id: `confirmed_portfolio_relationship:${String(index + 1).padStart(3, "0")}`,
      ruleId: "confirmed-portfolio-relationship",
      ruleVersion: 1,
      kind: "observation",
      domain: "funding",
      severity: "context",
      polarity: "neutral",
      headline: "An exact-handle investment relationship is source-confirmed",
      finding: `${relationshipText} The record does not establish endorsement, current ownership, investment size, outcome, or project quality.`,
      whyItMatters: "A confirmed relationship expands the backing or portfolio map while keeping investment exposure separate from performance and reputation conclusions.",
      changeCondition: "Update when the primary relationship source, exact handle binding, attribution, or ownership status changes.",
      evidenceState: "verified",
      measurementRefs: ["identity_bound_portfolio_relationship_count"],
      sourceRefs: [sourceArtifactId(index)],
      lenses: ["investment", "alpha_research", "general_diligence"],
    });
  }

  const strictFundClaims = new Map<string, Array<{ artifact: FrozenSourceArtifact; index: number }>>();
  for (const [index, artifact] of evidence.sourceArtifacts.entries()) {
    if (!isStrictFrozenFundScaleArtifact(artifact, evidence)) continue;
    strictFundClaims.set(artifact.fundScaleClaimId!, [...(strictFundClaims.get(artifact.fundScaleClaimId!) ?? []), { artifact, index }]);
  }
  [...strictFundClaims.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([claimId, rows], claimIndex) => {
      const artifact = rows[0]!.artifact;
      const qualifier = artifact.fundAmountQualifier === "at_least"
        ? "at least"
        : artifact.fundAmountQualifier === "approximate"
          ? "approximately"
          : "exactly";
      const temporal = artifact.fundScaleTemporalState === "current"
        ? `current as of ${artifact.fundScaleAsOf}`
        : `a fixed historical ${artifact.fundScaleMetric?.replaceAll("_", " ")}`;
      addSignal({
        id: `verified_fund_scale:${String(claimIndex + 1).padStart(2, "0")}`,
        ruleId: "verified-fund-scale-context",
        ruleVersion: 1,
        kind: "observation",
        domain: "funding",
        severity: "context",
        polarity: "neutral",
        headline: "A strict identity-bound fund-scale claim is retained",
        finding: `${artifact.fundName} is reported at ${qualifier} $${artifact.fundSizeUsd!.toLocaleString("en-US")} for ${temporal}. ${artifact.fundScaleBasis === "regulatory" ? "The figure comes from a regulatory filing." : artifact.fundScaleBasis === "press_corroborated" ? "The figure is press reported, not taken from a regulatory filing." : "The figure is reported by the manager, not taken from a regulatory filing."} Claim ${claimId} describes the named fund or vehicle and is not the audited person's personal capital. Multiple vehicle claims are not summed.`,
        whyItMatters: "Separating firm-wide AUM, vehicle closes, qualifiers, and time state makes capital-scale context comparable without inflating deployable capital.",
        changeCondition: "Update when the controlling fund, regulatory, manager, or independently corroborated source publishes a newer metric with the same identity and temporal gates.",
        evidenceState: fundScaleEvidenceState(artifact),
        measurementRefs: [`verified_fund_scale_usd:${String(claimIndex + 1).padStart(2, "0")}`],
        sourceRefs: rows.map(({ index }) => sourceArtifactId(index)),
        lenses: ["investment", "general_diligence"],
      });
    });

  const counterRecordsByAxis = new Map<string, FrozenAxisEvidence[]>();
  for (const record of evidence.axisEvidenceCatalog ?? []) {
    for (const axis of record.counterEligibleAxes ?? []) {
      if (!axis.startsWith("P") || !axisEvidenceIsVerifiedCounter(record, axis)) continue;
      counterRecordsByAxis.set(axis, [...(counterRecordsByAxis.get(axis) ?? []), record]);
    }
  }
  for (const [axis, records] of [...counterRecordsByAxis.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const excerpts = records.map((record) => boundedText(record.excerpt ?? record.title, 180)).filter((excerpt): excerpt is string => Boolean(excerpt));
    addSignal({
      id: `verified_axis_counter_evidence:${encodeURIComponent(axis)}`,
      ruleId: "verified-direct-axis-counter-evidence",
      ruleVersion: 1,
      kind: "observation",
      domain: projectAxisDomain(axis),
      severity: "medium",
      polarity: "mixed",
      headline: `Verified direct evidence limits ${axis}`,
      finding: `${records.length} direct-subject scorer-packet record${records.length === 1 ? " is" : "s are"} deterministically marked score-limiting for ${axis}: ${excerpts.slice(0, 3).join("; ")}. Related-context, reported, unavailable, and checked-empty rows are excluded from this conclusion.`,
      whyItMatters: "A diligence view should surface verified counter-evidence with the same prominence as favorable evidence instead of burying it inside a composite score.",
      changeCondition: "Re-evaluate when the exact underlying record changes, is superseded, or no longer satisfies direct-subject verification and counter-eligibility gates.",
      evidenceState: "verified",
      measurementRefs: [],
      sourceRefs: records.map((record) => axisEvidenceSourceId(record.artifactId)),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const catalogById = new Map((evidence.axisEvidenceCatalog ?? []).map((artifact) => [artifact.artifactId, artifact]));
  for (const axis of evidence.axes.filter((row) => row.axis.startsWith("P"))) {
    const invalidCounterRefs = uniqueSorted((axis.counterEvidenceRefs ?? []).filter((reference) => {
      const record = catalogById.get(reference);
      return !record || !axisEvidenceIsVerifiedCounter(record, axis.axis);
    }));
    if (invalidCounterRefs.length > 0) {
      addSignal({
        id: `axis_counter_evidence_integrity_gap:${encodeURIComponent(axis.axis)}`,
        ruleId: "axis-counter-evidence-integrity-gap",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: projectAxisDomain(axis.axis),
        severity: "high",
        polarity: "unknown",
        headline: `Saved counter-evidence references for ${axis.axis} fail admission`,
        finding: `${invalidCounterRefs.length} saved counter-evidence reference${invalidCounterRefs.length === 1 ? " does" : "s do"} not resolve to a direct-subject, verified, content-addressed record explicitly counter-eligible for ${axis.axis}. ARGUS withholds those references from the decision signal.`,
        whyItMatters: "A reported, related-context, checked-empty, unavailable, or missing record must not silently lower a project score or become an adverse claim.",
        changeCondition: "Repair the frozen lineage so every counter reference resolves to a direct verified record explicitly eligible to limit this axis.",
        evidenceState: "bounded",
        measurementRefs: [],
        sourceRefs: [
          axisAssessmentSourceId(axis.axis),
          ...invalidCounterRefs.flatMap((reference) => catalogById.has(reference) ? [axisEvidenceSourceId(reference)] : []),
        ],
        lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
      });
    }

    const gaps = uniqueSorted((axis.gaps ?? []).map((gap) => gap.trim()).filter(Boolean));
    if (gaps.length === 0) continue;
    const unavailableSources = (evidence.axisEvidenceCatalog ?? [])
      .filter((artifact) => artifact.verification === "unavailable" && artifact.eligibleAxes.includes(axis.axis))
      .map((artifact) => axisEvidenceSourceId(artifact.artifactId));
    addSignal({
      id: `analyst_axis_gap:${encodeURIComponent(axis.axis)}`,
      ruleId: "analyst-material-axis-gap",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: projectAxisDomain(axis.axis),
      severity: "medium",
      polarity: "unknown",
      headline: `Material diligence questions remain open for ${axis.axis}`,
      finding: `The frozen scoring analyst recorded ${gaps.length} unresolved question${gaps.length === 1 ? "" : "s"}: ${gaps.slice(0, 4).join(" ")} This is an analyst-attributed gap list, not evidence that the missing condition is adverse.`,
      whyItMatters: "Explicit gaps show what could still change the score and prevent missing evidence from being mistaken for a clean result.",
      changeCondition: "Resolve the listed questions with exact subject-bound primary or independently verified evidence and freeze the updated axis lineage.",
      evidenceState: "reported_context",
      measurementRefs: [],
      sourceRefs: [axisAssessmentSourceId(axis.axis), ...unavailableSources],
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const validBands = Object.entries(evidence.projectStrengthBands ?? {})
    .filter(([, band]) => finite(band.minScore) && finite(band.maxScore) && band.minScore >= 0 && band.maxScore >= band.minScore)
    .sort(([left], [right]) => left.localeCompare(right));
  if (validBands.length > 0) {
    const measurementRefs = validBands.flatMap(([axis]) => {
      const segment = encodeURIComponent(axis);
      return [`project_strength_tier:${segment}`, `project_strength_min_score:${segment}`, `project_strength_max_score:${segment}`];
    }).filter((id) => measurementMap.has(id));
    addSignal({
      id: "project_strength_band_summary",
      ruleId: "project-strength-band-summary",
      ruleVersion: 1,
      kind: "observation",
      domain: "governance",
      severity: "context",
      polarity: "neutral",
      headline: "How strong the evidence is in each area",
      finding: `${validBands.map(([axis, band]) => publicStrengthBand(axis, band.tier, band.minScore, band.maxScore)).join(". ")}. These ranges summarize the saved evidence; they do not add points or make an investment recommendation.`,
      whyItMatters: "This shows which parts of the report rest on stronger evidence and which parts still need confirmation.",
      changeCondition: "Run the report again when new reliable evidence becomes available.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: validBands.map(([axis]) => projectStrengthSourceId(axis)),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const controlReality = evidence.evmControlReality;
  if (controlReality && identityBindings.evmControlMatched) {
    const sourceRefs = ["snapshot:evm-control-reality"];
    const chainIdentityVerified = controlReality.chainIdentity?.state === "verified"
      && controlReality.chainIdentity.observedChainId === controlReality.chainIdentity.expectedChainId;
    const blockText = controlReality.capture
      ? ` at block ${controlReality.capture.blockNumber.toLocaleString("en-US")} (${controlReality.capture.blockHash})`
      : "";
    const receiptText = (receiptIds: readonly string[]): string => receiptIds.length > 0
      ? ` Receipt${receiptIds.length === 1 ? "" : "s"}: ${uniqueSorted(receiptIds).slice(0, 8).join(", ")}.`
      : "";
    if (controlReality.state !== "unavailable" && !chainIdentityVerified) {
      addSignal({
        id: "evm_chain_identity_receipt_unverified",
        ruleId: "evm-chain-identity-receipt-unverified",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "identity",
        severity: "high",
        polarity: "unknown",
        headline: "The saved EVM read lacks a verified chain-identity receipt",
        finding: "The snapshot contains contract-read fields but no saved receipt proving that the RPC endpoint returned the expected chain id before those reads. ARGUS withholds chain-specific control interpretation from this derived layer.",
        whyItMatters: "A correct address queried on the wrong network can return plausible but unrelated code, owners, and proxy slots.",
        changeCondition: "Repeat the read with a saved eth_chainId receipt that exactly matches the requested network before any block or contract call.",
        evidenceState: "bounded",
        measurementRefs: ["evm_control_target_state"],
        sourceRefs,
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    } else if (controlReality.state === "unavailable") {
      addSignal({
        id: "evm_control_read_unavailable",
        ruleId: "evm-control-read-unavailable",
        ruleVersion: 1,
        kind: "coverage_gap",
        domain: "control",
        severity: "medium",
        polarity: "unknown",
        headline: "The fixed-block standard control read was unavailable",
        finding: `${controlReality.note ?? "The direct RPC lane did not complete."} No negative or complete control claim is inferred.`,
        whyItMatters: "Proxy, owner, admin, beacon, and signer questions remain decision-critical until a fixed-block read succeeds.",
        changeCondition: "Repeat the fixed-block RPC read against a supported healthy endpoint.",
        evidenceState: "bounded",
        measurementRefs: ["evm_control_target_state"],
        sourceRefs,
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    } else if (controlReality.state === "not_contract") {
      addSignal({
        id: "evm_target_not_contract",
        ruleId: "evm-target-not-contract",
        ruleVersion: 1,
        kind: "observation",
        domain: "control",
        severity: "context",
        polarity: "neutral",
        headline: "The canonical address had no bytecode at the captured block",
        finding: `The fixed-block eth_getCode read${blockText} found no runtime bytecode at ${controlReality.target}. That does not prove the address is an EOA, unused, controlled by one key, or free of counterfactual behavior, and it does not resolve project-wide control.${receiptText(controlReality.targetCode ? [controlReality.targetCode.receiptId] : [])}`,
        whyItMatters: "The address may represent a native asset or an unexpected identity binding, both of which change the next control questions.",
        changeCondition: "Recheck if the canonical address, chain, or identity binding changes.",
        evidenceState: "bounded",
        measurementRefs: ["evm_control_target_state"],
        sourceRefs,
        lenses: ["investment", "counterparty", "general_diligence"],
      });
    } else {
      const proxy = controlReality.proxy;
      if (proxy?.state === "conflicting_implementation_candidates") {
        addSignal({
          id: "evm_conflicting_implementation_candidates",
          ruleId: "evm-conflicting-implementation-candidates",
          ruleVersion: 1,
          kind: "observation",
          domain: "control",
          severity: "high",
          polarity: "mixed",
          headline: "Standard reads produced conflicting implementation candidates",
          finding: `${proxy.implementationCandidates.length} implementation candidates were derived${blockText} from ${proxy.indicators.join(", ")}. Layered or nonstandard proxy structure must be reconciled before naming the active implementation.${receiptText(proxy.implementationCandidates.flatMap((candidate) => candidate.receiptIds))}`,
          whyItMatters: "Audit scope, upgrade authority, and current code lineage depend on the implementation that actually executes.",
          changeCondition: "Resolve the active implementation and proxy layering with verified source or additional fixed-block receipts.",
          evidenceState: "bounded",
          measurementRefs: ["evm_standard_proxy_state", "evm_implementation_candidate_count"],
          sourceRefs,
          lenses: ["investment", "counterparty", "general_diligence"],
        });
      } else if (proxy?.state === "standard_proxy_observed") {
        addSignal({
          id: "evm_standard_proxy_observed",
          ruleId: "evm-standard-proxy-observed",
          ruleVersion: 1,
          kind: "observation",
          domain: "control",
          severity: "medium",
          polarity: "neutral",
          headline: "A standard proxy or implementation surface is observed",
          finding: `${proxy.implementationCandidates.length} implementation candidate${proxy.implementationCandidates.length === 1 ? " is" : "s are"} recorded${blockText} from ${proxy.indicators.join(", ")}. Upgradeability is a capability to map, not evidence of misuse.${receiptText(proxy.implementationCandidates.flatMap((candidate) => candidate.receiptIds))}`,
          whyItMatters: "The current implementation, its administrator, and any timelock must be reconciled with audit scope and governance claims.",
          changeCondition: "Recheck when the implementation, admin, beacon, or canonical contract changes.",
          evidenceState: "bounded",
          measurementRefs: ["evm_standard_proxy_state", "evm_standard_proxy_indicator_count", "evm_implementation_candidate_count"],
          sourceRefs,
          lenses: ["investment", "counterparty", "general_diligence"],
        });
      } else if (proxy?.state === "standard_proxy_assessment_incomplete") {
        addSignal({
          id: "evm_standard_proxy_assessment_incomplete",
          ruleId: "evm-standard-proxy-assessment-incomplete",
          ruleVersion: 1,
          kind: "coverage_gap",
          domain: "control",
          severity: "medium",
          polarity: "unknown",
          headline: "The standard proxy assessment is incomplete",
          finding: `At least one bounded storage or interface read failed${blockText}, so ARGUS withholds any claim that standard proxy indicators are absent.${receiptText(controlReality.receipts.filter((receipt) => receipt.state === "rpc_error").map((receipt) => receipt.id))}`,
          whyItMatters: "Implementation, beacon, and admin paths remain unresolved when even one required standard read is unavailable.",
          changeCondition: "Repeat the fixed-block read against a healthy, correctly bound endpoint.",
          evidenceState: "bounded",
          measurementRefs: ["evm_standard_proxy_state"],
          sourceRefs,
          lenses: ["investment", "counterparty", "general_diligence"],
        });
      } else if (proxy?.state === "no_standard_proxy_indicator") {
        addSignal({
          id: "evm_no_standard_proxy_indicator",
          ruleId: "evm-no-standard-proxy-indicator",
          ruleVersion: 1,
          kind: "coverage_gap",
          domain: "control",
          severity: "context",
          polarity: "unknown",
          headline: "No supported standard proxy indicator was observed",
          finding: `The fixed-block read${blockText} found no canonical EIP-1167 runtime or nonzero ERC-1967 implementation, beacon, or admin slot. Custom upgrade and permission paths remain unmeasured.`,
          whyItMatters: "Absence from a bounded standards scan is not proof of immutability or absent privileged control.",
          changeCondition: "Resolve with verified ABI, source code, role events, and project-specific permission analysis.",
          evidenceState: "bounded",
          measurementRefs: ["evm_standard_proxy_state", "evm_standard_proxy_indicator_count"],
          sourceRefs,
          lenses: ["investment", "counterparty", "general_diligence"],
        });
      }

      const noCodeAuthorities = controlReality.authorities.filter((authority) => authority.accountType === "no_code");
      if (noCodeAuthorities.length > 0) {
        addSignal({
          id: "evm_no_code_control_address",
          ruleId: "evm-no-code-control-address",
          ruleVersion: 1,
          kind: "screening_heuristic",
          domain: "control",
          severity: "medium",
          polarity: "unknown",
          headline: "A standard control address has no runtime bytecode",
          finding: `${noCodeAuthorities.length} standard-interface authority address${noCodeAuthorities.length === 1 ? " has" : "es have"} no runtime bytecode${blockText}: ${noCodeAuthorities.map((authority) => `${authority.address} (${authority.relations.join(", ")})`).join("; ")}. This does not prove EOA status, one key, or one human.${receiptText(noCodeAuthorities.flatMap((authority) => authority.receiptIds))}`,
          whyItMatters: "Custody, counterfactual deployment, and authorization mechanics must be established before inferring who can exercise the observed role.",
          changeCondition: "Recheck when the authority address, account code, signer arrangement, or role assignment changes.",
          evidenceState: "bounded",
          measurementRefs: ["evm_standard_authority_count", "evm_no_code_authority_count"],
          sourceRefs,
          lenses: ["investment", "counterparty", "general_diligence"],
        });
      }

      const singleSignerInterfaces = controlReality.safeCompatibleMultisigs.filter((multisig) =>
        multisig.state === "observed" && multisig.threshold === 1,
      );
      if (singleSignerInterfaces.length > 0) {
        addSignal({
          id: "evm_single_signer_safe_compatible_authority",
          ruleId: "evm-single-signer-safe-compatible-authority",
          ruleVersion: 1,
          kind: "screening_heuristic",
          domain: "control",
          severity: "medium",
          polarity: "unknown",
          headline: "A control authority reports a one-signer threshold",
          finding: `${singleSignerInterfaces.length} authority address${singleSignerInterfaces.length === 1 ? " returns" : "es return"} a Safe-compatible owner interface with threshold 1${blockText}. Interface compatibility does not authenticate an official Safe or prove these methods govern execution.${receiptText(singleSignerInterfaces.flatMap((multisig) => multisig.receiptIds))}`,
          whyItMatters: "If the interface and authorization semantics are authenticated, a threshold of one would permit one listed signer to satisfy that interface's threshold.",
          changeCondition: "Verify the multisig implementation and recheck after any owner or threshold change.",
          evidenceState: "bounded",
          measurementRefs: ["evm_safe_compatible_interface_count", "evm_single_signer_safe_compatible_count"],
          sourceRefs,
          lenses: ["investment", "counterparty", "general_diligence"],
        });
      }
    }
  }

  const boundHolderFlags = identityBindings.holderProfileMatched
    ? evidence.holderProfile?.contractFlags ?? []
    : [];
  for (const [flagIndex, flag] of boundHolderFlags.entries()) {
    addSignal({
      id: `goplus_contract_flag:${flag.key}:${String(flagIndex + 1).padStart(2, "0")}`,
      ruleId: "goplus-fired-contract-flag",
      ruleVersion: 1,
      kind: "screening_heuristic",
      domain: "control",
      severity: flag.tone === "bad" ? "high" : "medium",
      polarity: "risk",
      headline: "GoPlus reports a fired contract or deployer flag",
      finding: `GoPlus reports: ${flag.claim} ARGUS preserves the provider's sentence and does not independently authenticate the label, controller, intent, or present exploitability.`,
      whyItMatters: "A live contract capability or provider-labeled deployer history can change control and supply diligence, but the exact onchain role still needs direct verification.",
      changeCondition: "Recheck when the canonical contract, provider flag, verified controller, or relevant onchain state changes.",
      evidenceState: "reported_context",
      measurementRefs: ["goplus_fired_contract_flag_count"],
      sourceRefs: ["snapshot:holder-profile"],
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const creatorOrAuthorityPct = numberValue("provider_named_creator_or_authority_pct");
  const creatorFlagAlreadyCarried = (evidence.holderProfile?.contractFlags ?? [])
    .some((flag) => flag.key === "creator_holds_supply");
  if (finite(creatorOrAuthorityPct) && creatorOrAuthorityPct >= 5 && !creatorFlagAlreadyCarried) {
    const measurementRefs = ["provider_named_creator_or_authority_pct"];
    addSignal({
      id: "provider_named_creator_or_authority_concentration",
      ruleId: "provider-named-creator-or-authority-concentration",
      ruleVersion: 1,
      kind: "screening_heuristic",
      domain: "supply",
      severity: creatorOrAuthorityPct >= 15 ? "high" : "medium",
      polarity: "risk",
      headline: "A provider-labeled creator or authority wallet holds a material supply share",
      finding: `GoPlus assigns ${creatorOrAuthorityPct}% of supply to an address it labels as the creator or authority wallet. ARGUS has not independently proved that role or the beneficial owner.`,
      whyItMatters: "If the role is authenticated, the holding can matter to float, governance, incentives, and sale-capacity analysis.",
      changeCondition: "Recheck when the provider record, verified wallet attribution, or supply distribution changes.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const athDrawdown = numberValue("reported_ath_drawdown_pct");
  if (finite(athDrawdown) && athDrawdown <= -25) {
    const measurementRefs = ["reported_ath_drawdown_pct"];
    const athDate = measurementMap.get("reported_ath_date");
    const marketCapturedAt = evidence.projectToken?.producerSources?.market?.capturedAt
      ?? evidence.projectToken?.capturedAt;
    addSignal({
      id: "reported_lifetime_high_distance",
      ruleId: "reported-lifetime-high-distance",
      ruleVersion: 1,
      kind: "observation",
      domain: "market",
      severity: athDrawdown <= -70 ? "medium" : "low",
      polarity: "mixed",
      headline: "The token remains materially below its registry-reported lifetime high",
      finding: `At the ${marketCapturedAt ? `${marketCapturedAt} ` : ""}capture, the canonical market registry placed the token price ${Math.abs(athDrawdown)}% below its reported lifetime high${athDate?.valueType === "date" ? ` dated ${athDate.value}` : ""}. This is market-regime context, not evidence of undervaluation, recovery potential, or project failure.`,
      whyItMatters: "Distance from a prior high frames holder breakevens and reflexive narrative risk, while leaving entry attractiveness to current fundamentals and liquidity.",
      changeCondition: "Recompute when the canonical market price or registry-reported lifetime high changes.",
      evidenceState: "reported_context",
      measurementRefs: athDate ? [...measurementRefs, "reported_ath_date"] : measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, athDate ? [...measurementRefs, "reported_ath_date"] : measurementRefs),
      lenses: ["investment", "alpha_research", "general_diligence"],
    });
  }

  const priceWindowChange = numberValue("price_window_change_pct");
  const volumeWindowChange = numberValue("price_window_volume_change_pct");
  if (
    finite(priceWindowChange)
    && finite(volumeWindowChange)
    && Math.abs(priceWindowChange) >= 10
    && Math.abs(volumeWindowChange) >= 25
    && priceWindowChange * volumeWindowChange < 0
  ) {
    const measurementRefs = ["price_window_change_pct", "price_window_volume_change_pct"];
    const history = evidence.projectToken?.history;
    const boundaryNote = history?.windowIsPartial
      ? " The candle series is partial inside its requested span."
      : "";
    addSignal({
      id: "price_volume_regime_divergence",
      ruleId: "price-volume-regime-divergence",
      ruleVersion: 1,
      kind: "screening_heuristic",
      domain: "market",
      severity: "medium",
      polarity: "mixed",
      headline: "Price and aggregate volume moved in opposite directions",
      finding: `Across the frozen ${history?.timeframe ?? "candle"} series, price changed ${priceWindowChange}%, while recent aggregate volume changed ${volumeWindowChange}% versus the preceding equal-width subwindow.${boundaryNote} Aggregate volume is not directional order flow.`,
      whyItMatters: "The divergence is a timing lead for liquidity, catalyst, and positioning work, not a standalone buy or sell signal.",
      changeCondition: "Recompute when the frozen canonical-pair OHLCV window advances or its identity binding changes.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "alpha_research", "general_diligence"],
    });
  }

  const unlockUsd = numberValue("next_unlock_usd");
  const liquidityUsd = numberValue("liquidity_usd");
  const volume24hUsd = numberValue("volume_24h_usd");
  if (positive(unlockUsd) && (positive(liquidityUsd) || positive(volume24hUsd))) {
    const measurementRefs = ["next_unlock_usd"];
    const arithmetic: NonNullable<DerivedIntelligenceSignal["arithmetic"]> = [];
    const comparisons: string[] = [];
    let highestRatio = 0;
    if (positive(liquidityUsd)) {
      const inputMeasurementIds = ["next_unlock_usd", "liquidity_usd"];
      const temporal = temporalAlignment("unlock_to_liquidity", inputMeasurementIds);
      if (temporal) {
        const ratio = rounded((unlockUsd / liquidityUsd) * 100);
        measurementRefs.push("liquidity_usd");
        highestRatio = Math.max(highestRatio, ratio);
        comparisons.push(`${ratio}% of observed pool liquidity`);
        arithmetic.push({ expression: "next_unlock_usd / liquidity_usd * 100", value: ratio, unit: "percent", inputMeasurementIds, temporal });
      }
    }
    if (positive(volume24hUsd)) {
      const inputMeasurementIds = ["next_unlock_usd", "volume_24h_usd"];
      const temporal = temporalAlignment("unlock_to_volume", inputMeasurementIds);
      if (temporal) {
        const ratio = rounded((unlockUsd / volume24hUsd) * 100);
        measurementRefs.push("volume_24h_usd");
        highestRatio = Math.max(highestRatio, ratio);
        comparisons.push(`${ratio}% of reported 24 hour volume`);
        arithmetic.push({ expression: "next_unlock_usd / volume_24h_usd * 100", value: ratio, unit: "percent", inputMeasurementIds, temporal });
      }
    }
    if (arithmetic.length > 0) {
      const materialToObservedCapacity = highestRatio >= 25;
      const allocation = textValue("next_unlock_allocation");
      const unlockMcapPct = numberValue("next_unlock_market_cap_pct");
      const cumulativeUnlockedPct = numberValue("cumulative_unlocked_pct");
      const scheduleContext = [
        allocation ? `The provider labels the allocation ${allocation}.` : "",
        finite(unlockMcapPct) ? `It reports the event as ${unlockMcapPct}% of market capitalization.` : "",
        finite(cumulativeUnlockedPct) ? `It reports ${cumulativeUnlockedPct}% cumulatively unlocked after the event.` : "",
      ].filter(Boolean).join(" ");
      const contextualMeasurementRefs = [
        ...(allocation ? ["next_unlock_allocation"] : []),
        ...(finite(unlockMcapPct) ? ["next_unlock_market_cap_pct"] : []),
        ...(finite(cumulativeUnlockedPct) ? ["cumulative_unlocked_pct"] : []),
      ];
      measurementRefs.push(...contextualMeasurementRefs);
      addSignal({
        id: "unlock_absorption_surface",
        ruleId: "unlock-absorption-surface",
        ruleVersion: 1,
        kind: "screening_heuristic",
        domain: "supply",
        severity: highestRatio >= 100 ? "high" : highestRatio >= 25 ? "medium" : "context",
        polarity: materialToObservedCapacity ? "risk" : "neutral",
        headline: materialToObservedCapacity
          ? "Scheduled unlock is material to observed trading capacity"
          : "Scheduled unlock scale is quantified against observed trading capacity",
        finding: `The next provider-reported unlock value equals ${comparisons.join(" and ")}. ${scheduleContext ? `${scheduleContext} ` : ""}This is a scale comparison, not a prediction that unlocked tokens will be sold.`,
        whyItMatters: "A decision-maker can test the unlock against executable depth, recipients, and expected demand instead of viewing the schedule in isolation.",
        changeCondition: "Recompute when the unlock schedule, executable liquidity, or reported trading volume changes.",
        evidenceState: "bounded",
        measurementRefs,
        sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
        arithmetic,
        lenses: ["investment", "alpha_research", "general_diligence"],
      });
    }
  }

  const top10Pct = numberValue("top_10_holder_pct");
  const assessedWalletFloorPct = numberValue("assessed_wallet_share_floor_pct");
  const assessedWalletCount = numberValue("assessed_wallet_count");
  const concentrationPct = finite(top10Pct) ? top10Pct : assessedWalletFloorPct;
  const concentrationMeasurementId = finite(top10Pct)
    ? "top_10_holder_pct"
    : finite(assessedWalletFloorPct)
      ? "assessed_wallet_share_floor_pct"
      : null;
  const concentrationIsFloor = concentrationMeasurementId === "assessed_wallet_share_floor_pct";
  const marketCapUsd = numberValue("market_cap_usd");
  if (concentrationMeasurementId && finite(concentrationPct) && concentrationPct >= 50 && positive(liquidityUsd) && positive(marketCapUsd)) {
    const liquidityToMarket = rounded((liquidityUsd / marketCapUsd) * 100);
    if (liquidityToMarket <= 10) {
      const measurementRefs = [
        concentrationMeasurementId,
        ...(concentrationIsFloor && finite(assessedWalletCount) ? ["assessed_wallet_count"] : []),
        "liquidity_usd",
        "market_cap_usd",
      ];
      const temporal = temporalAlignment("holder_concentration_to_liquidity_market_cap", measurementRefs);
      if (temporal) {
        addSignal({
          id: "concentrated_exit_surface",
          ruleId: "concentrated-exit-surface",
          ruleVersion: 1,
          kind: "screening_heuristic",
          domain: "liquidity",
          severity: concentrationPct >= 70 && liquidityToMarket <= 5 ? "high" : "medium",
          polarity: "risk",
          headline: "Assessed wallet concentration is large relative to observed liquidity",
          finding: concentrationIsFloor && finite(assessedWalletCount)
            ? `The bounded holder register assigns at least ${concentrationPct}% of supply across ${assessedWalletCount} assessed wallet${assessedWalletCount === 1 ? "" : "s"}, while observed pool liquidity equals ${liquidityToMarket}% of market capitalization. The wallet share is a floor from fewer than 10 usable rows. This screen does not identify wallet owners or predict selling.`
            : `The bounded holder register assigns ${concentrationPct}% of supply to the top 10 assessed wallets, while observed pool liquidity equals ${liquidityToMarket}% of market capitalization. This screen does not identify wallet owners or predict selling.`,
          whyItMatters: "Concentrated holdings and limited observed liquidity make wallet attribution and executable-depth checks more decision-relevant.",
          changeCondition: "Recompute after holder-register, liquidity, or market-capitalization updates.",
          evidenceState: "bounded",
          measurementRefs,
          sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
          arithmetic: [{ expression: "liquidity_usd / market_cap_usd * 100", value: liquidityToMarket, unit: "percent", inputMeasurementIds: ["liquidity_usd", "market_cap_usd"], temporal }],
          lenses: ["investment", "alpha_research", "general_diligence"],
        });
      }
    }
  }

  const tvlChange = numberValue("tvl_change_30d_pct");
  const feeChange = numberValue("protocol_fees_change_30d_pct");
  if (finite(tvlChange) && finite(feeChange) && Math.abs(tvlChange) >= 10 && Math.abs(feeChange) >= 10 && tvlChange * feeChange < 0) {
    const measurementRefs = ["tvl_change_30d_pct", "protocol_fees_change_30d_pct"];
    const temporal = temporalAlignment("tvl_fee_trend_divergence", measurementRefs);
    if (temporal) {
      addSignal({
        id: "usage_capital_divergence",
        ruleId: "usage-capital-divergence",
        ruleVersion: 1,
        kind: "screening_heuristic",
        domain: "economics",
        severity: "medium",
        polarity: "mixed",
        headline: "Fee and TVL trends moved in opposite directions",
        finding: `Reported TVL changed ${tvlChange}% over 30 days while trailing fees changed ${feeChange}% versus the prior 30-day period.`,
        whyItMatters: "The divergence can distinguish changing capital commitment from changing paid activity, but it needs product-specific explanation.",
        changeCondition: "Recompute when either frozen 30-day change series advances.",
        evidenceState: "measured",
        measurementRefs,
        sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
        arithmetic: [{ expression: "tvl_change_30d_pct - protocol_fees_change_30d_pct", value: rounded(tvlChange - feeChange), unit: "percent", inputMeasurementIds: measurementRefs, temporal }],
        lenses: ["investment", "alpha_research", "general_diligence"],
      });
    }
  }

  const fees30d = numberValue("protocol_fees_30d_usd");
  const tvlUsd = numberValue("tvl_usd");
  if (positive(fees30d)) {
    const measurementRefs = ["protocol_fees_30d_usd"];
    addSignal({
      id: "positive_trailing_protocol_fees",
      ruleId: "positive-trailing-protocol-fees",
      ruleVersion: 1,
      kind: "observation",
      domain: "economics",
      severity: "low",
      polarity: "support",
      headline: "The identity-bound protocol record reports positive trailing fees",
      finding: `The frozen protocol index reports $${fees30d.toLocaleString("en-US")} in trailing 30-day fees. Fees show paid activity, but they are not automatically protocol revenue, tokenholder value capture, or durable demand.`,
      whyItMatters: "A positive paid-activity measure grounds product-use diligence in more than follower, narrative, or token-price signals.",
      changeCondition: "Recheck when the trailing fee window advances or the protocol identity binding changes.",
      evidenceState: "measured",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "alpha_research", "general_diligence"],
    });
  }
  if (finite(fees30d) && positive(tvlUsd)) {
    const intensity = rounded((fees30d / tvlUsd) * 100);
    const measurementRefs = ["protocol_fees_30d_usd", "tvl_usd"];
    const temporal = temporalAlignment("protocol_fee_intensity", measurementRefs);
    if (temporal) {
      addSignal({
        id: "protocol_fee_intensity",
        ruleId: "protocol-fee-intensity",
        ruleVersion: 1,
        kind: "arithmetic",
        domain: "economics",
        severity: "context",
        polarity: "neutral",
        headline: "Trailing fee intensity is quantified against TVL",
        finding: `Trailing 30-day protocol fees equal ${intensity}% of reported TVL in this capture. Fees are not automatically protocol revenue or tokenholder value capture.`,
        whyItMatters: "The common denominator makes activity comparable over time while preserving the distinction between user fees, revenue, and value capture.",
        changeCondition: "Recompute when the fee window or TVL snapshot changes.",
        evidenceState: "measured",
        measurementRefs,
        sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
        arithmetic: [{ expression: "protocol_fees_30d_usd / tvl_usd * 100", value: intensity, unit: "percent", inputMeasurementIds: measurementRefs, temporal }],
        lenses: ["investment", "alpha_research", "general_diligence"],
      });
    }
  }

  const disclosedRoundSumUsd = numberValue("indexed_disclosed_round_sum_usd");
  const strictFundingFacts = (evidence.basicFacts ?? []).filter((fact) =>
    fact.predicate === "funding"
    && factTargetsAuditedSubject(fact, evidence.profile.handle)
    && isStrictSourceBackedFact(fact),
  );
  if (positive(disclosedRoundSumUsd) && positive(fees30d) && strictFundingFacts.length === 0) {
    const annualizedFeeRunRate = rounded(fees30d * 12, 2);
    const annualizedFeesToDisclosedRoundSum = rounded(annualizedFeeRunRate / disclosedRoundSumUsd);
    const measurementRefs = ["protocol_fees_30d_usd", "indexed_disclosed_round_sum_usd"];
    const temporal = temporalAlignment("fees_to_disclosed_funding", measurementRefs);
    if (temporal) {
      addSignal({
        id: "disclosed_capital_to_fee_scale",
        ruleId: "disclosed-capital-to-fee-scale",
        ruleVersion: 1,
        kind: "arithmetic",
        domain: "economics",
        severity: "context",
        polarity: "neutral",
        headline: "Disclosed capital and the captured user-fee run rate are put on one scale",
        finding: `A simple twelve-times annualization of the trailing 30-day fee window is $${annualizedFeeRunRate.toLocaleString("en-US")}, equal to ${annualizedFeesToDisclosedRoundSum} times the arithmetic sum of positive disclosed indexed round amounts. User fees are not protocol revenue, profit, treasury cash, valuation, or investor return, and the funding index may be incomplete.`,
        whyItMatters: "The arithmetic exposes the scale relationship without collapsing company financing, protocol activity, and token value into one claim.",
        changeCondition: "Recompute when the trailing fee window or indexed disclosed funding record changes.",
        evidenceState: "reported_context",
        measurementRefs,
        sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
        arithmetic: [{ expression: "protocol_fees_30d_usd * 12 / indexed_disclosed_round_sum_usd", value: annualizedFeesToDisclosedRoundSum, unit: "ratio", inputMeasurementIds: measurementRefs, temporal }],
        lenses: ["investment", "alpha_research", "general_diligence"],
      });
    }
  } else if (positive(disclosedRoundSumUsd) && strictFundingFacts.length > 0) {
    const measurementRefs = ["indexed_disclosed_round_sum_usd"];
    addSignal({
      id: "funding_record_reconciliation_required",
      ruleId: "funding-record-reconciliation-required",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "funding",
      severity: "medium",
      polarity: "unknown",
      headline: "Structured funding arithmetic is withheld pending cross-source reconciliation",
      finding: `The frozen scan contains ${strictFundingFacts.length} strict direct-subject funding fact${strictFundingFacts.length === 1 ? "" : "s"} alongside an indexed disclosed-round sum of $${disclosedRoundSumUsd.toLocaleString("en-US")}. Those records have not been normalized into one complete round set, so ARGUS does not derive capital-efficiency or funding-recency conclusions from the index alone.`,
      whyItMatters: "An older or partial structured index can produce precise but decision-misleading ratios when stronger funding artifacts already exist in the same dossier.",
      changeCondition: "Normalize every strict funding artifact and indexed round into a deduplicated dated round ledger, then recompute.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: uniqueSorted([
        ...refsFromMeasurements(measurementMap, measurementRefs),
        ...strictFundingFacts.flatMap((fact) => factSupportSourceRefs(fact, true)),
      ]),
      lenses: ["investment", "general_diligence"],
    });
  }

  const topChainShare = numberValue("top_chain_tvl_share_pct");
  const topChain = measurementMap.get("top_chain");
  if (finite(topChainShare) && topChainShare >= 80 && topChain?.valueType === "text") {
    const measurementRefs = ["top_chain", "top_chain_tvl_share_pct"];
    addSignal({
      id: "chain_dependency",
      ruleId: "chain-dependency",
      ruleVersion: 1,
      kind: "screening_heuristic",
      domain: "economics",
      severity: "medium",
      polarity: "risk",
      headline: "Reported TVL is concentrated on one chain",
      finding: `${topChain.value} represents ${topChainShare}% of positive TVL in the provider's multi-chain breakdown.`,
      whyItMatters: "Chain-specific outages, incentives, bridge dependencies, or liquidity changes can dominate the protocol-level result.",
      changeCondition: "Recompute when the per-chain TVL breakdown changes.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const auditLeadCount = numberValue("audit_lead_count");
  const corroboratedAudits = numberValue("corroborated_audit_count");
  const auditIdentityAnchorGapCount = numberValue("audit_identity_anchor_gap_count");
  const auditIdentityAnchorMismatchCount = numberValue("audit_identity_anchor_mismatch_count");
  if (positive(auditIdentityAnchorGapCount)) {
    const hasMismatchedAnchors = positive(auditIdentityAnchorMismatchCount);
    const measurementRefs = [
      "audit_identity_anchor_gap_count",
      ...(hasMismatchedAnchors ? ["audit_identity_anchor_mismatch_count"] : []),
    ];
    const rowClaim = hasMismatchedAnchors
      ? `${auditIdentityAnchorGapCount} auditor-domain row${auditIdentityAnchorGapCount === 1 ? "" : "s"} do not carry a canonical identity anchor that validates against this frozen subject. ${auditIdentityAnchorMismatchCount} carr${auditIdentityAnchorMismatchCount === 1 ? "ies" : "y"} a saved anchor value that fails the exact canonical token-address or official-site-host match. ${auditIdentityAnchorGapCount === 1 ? "It remains" : "They remain"} reported audit lead${auditIdentityAnchorGapCount === 1 ? "" : "s"} and do not count as subject-level corroboration.`
      : auditIdentityAnchorGapCount === 1
        ? "1 legacy auditor-domain row names an audit engagement but preserves no canonical official-domain or contract identity anchor for this subject. It remains a reported audit lead and does not count as subject-level corroboration."
        : `${auditIdentityAnchorGapCount} legacy auditor-domain rows name audit engagements but preserve no canonical official-domain or contract identity anchors for this subject. They remain reported audit leads and do not count as subject-level corroboration.`;
    addSignal({
      id: "audit_identity_anchor_gap",
      ruleId: "audit-identity-anchor-gap",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "security",
      severity: hasMismatchedAnchors ? "high" : "medium",
      polarity: "unknown",
      headline: hasMismatchedAnchors
        ? "Saved audit anchors fail the frozen canonical identity match"
        : "Legacy auditor-domain rows lack a saved subject identity anchor",
      finding: rowClaim,
      whyItMatters: "An auditor-owned page can describe a namesake or different deployment unless the saved evidence binds the engagement to this subject through a non-name identity anchor. A provider-supplied anchor value is not self-authenticating.",
      changeCondition: "Resolve by recollecting the auditor record with a matching official domain or canonical contract anchor.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }
  if (positive(auditLeadCount) && corroboratedAudits === 0) {
    const measurementRefs = ["audit_lead_count", "corroborated_audit_count"];
    addSignal({
      id: "audit_provenance_gap",
      ruleId: "audit-provenance-gap",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "security",
      severity: "medium",
      polarity: "unknown",
      headline: "Audit leads lack identity-bound auditor corroboration in this capture",
      finding: `${auditLeadCount} reported audit lead${auditLeadCount === 1 ? " is" : "s are"} preserved, but this capture contains zero auditor-domain engagements carrying a canonical subject identity anchor that validates against the frozen canonical token or official-site host. That is an evidence gap, not proof that no audit occurred.`,
      whyItMatters: "Auditor-owned records are stronger than subject disclosures only when the saved evidence also binds the named engagement to this subject, and even then they do not establish current deployed-code coverage by themselves.",
      changeCondition: "Resolve with identity-anchored auditor engagement pages and scope-to-deployment reconciliation.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  } else if (finite(corroboratedAudits) && corroboratedAudits >= 2) {
    const measurementRefs = ["corroborated_audit_count"];
    addSignal({
      id: "audit_corroboration_support",
      ruleId: "audit-corroboration-support",
      ruleVersion: 1,
      kind: "observation",
      domain: "security",
      severity: "context",
      polarity: "support",
      headline: "Multiple identity-anchored audit engagements are corroborated",
      finding: `${corroboratedAudits} engagements were corroborated on auditor-owned domains with saved canonical subject identity anchors. Engagement pages do not by themselves prove that the current deployed implementation is in scope.`,
      whyItMatters: "Identity-bound independent provenance improves the diligence base before code version, scope, findings, and remediation are reconciled.",
      changeCondition: "Update when auditor records or deployed implementation scope changes.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const standardProxyState = textValue("evm_standard_proxy_state");
  if (
    positive(corroboratedAudits)
    && (standardProxyState === "standard_proxy_observed"
      || standardProxyState === "conflicting_implementation_candidates"
      || standardProxyState === "standard_proxy_assessment_incomplete")
  ) {
    const implementationCount = numberValue("evm_implementation_candidate_count");
    const measurementRefs = [
      "corroborated_audit_count",
      "evm_standard_proxy_state",
      ...(finite(implementationCount) ? ["evm_implementation_candidate_count"] : []),
    ];
    addSignal({
      id: "audit_to_deployment_scope_gap",
      ruleId: "audit-to-deployment-scope-gap",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "security",
      severity: standardProxyState === "conflicting_implementation_candidates" ? "high" : "medium",
      polarity: "unknown",
      headline: "Audit engagement provenance is not yet reconciled to the executing implementation",
      finding: `${corroboratedAudits} identity-anchored audit engagement${corroboratedAudits === 1 ? " is" : "s are"} corroborated on auditor-owned domains, while the fixed-block EVM read records ${standardProxyState.replaceAll("_", " ")}${finite(implementationCount) ? ` with ${implementationCount} implementation candidate${implementationCount === 1 ? "" : "s"}` : ""}. The saved evidence does not establish that the code executing at the captured block was in scope or remediated.`,
      whyItMatters: "An authentic audit engagement can still cover an older, different, or partial implementation.",
      changeCondition: "Resolve with the auditor's scope, commit or bytecode identifiers, remediation status, and the current fixed-block implementation fingerprint.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const largestIncidentUsd = numberValue("largest_recorded_incident_usd");
  if (finite(largestIncidentUsd)) {
    const largestHack = [...(evidence.protocolTvl?.hacks ?? [])]
      .filter((hack) => finite(hack.amountUsd))
      .sort((left, right) => right.amountUsd! - left.amountUsd!)[0];
    const measurementRefs = ["largest_recorded_incident_usd"];
    const arithmetic: NonNullable<DerivedIntelligenceSignal["arithmetic"]> = [];
    let ratio: number | undefined;
    if (positive(tvlUsd)) {
      const inputMeasurementIds = ["largest_recorded_incident_usd", "tvl_usd"];
      const temporal = temporalAlignment(
        "historical_incident_to_current_tvl",
        inputMeasurementIds,
        "historical_amount_to_current_scale",
      );
      if (temporal) {
        ratio = rounded((largestIncidentUsd / tvlUsd) * 100);
        measurementRefs.push("tvl_usd");
        arithmetic.push({
          expression: "largest_recorded_incident_usd / tvl_usd * 100",
          value: ratio,
          unit: "percent",
          inputMeasurementIds,
          temporal,
        });
      }
    }
    const returnText = largestHack?.returnedFunds === false
      ? " The provider does not mark returned funds."
      : largestHack?.returnedFunds === true
        ? " The provider marks funds as returned, without establishing full recovery unless the returned amount is reconciled."
        : "";
    addSignal({
      id: "recorded_incident_scale",
      ruleId: "recorded-incident-scale",
      ruleVersion: 1,
      kind: ratio === undefined ? "observation" : "arithmetic",
      domain: "security",
      severity: ratio !== undefined && ratio >= 10 ? "high" : ratio !== undefined && ratio >= 1 ? "medium" : "context",
      polarity: "risk",
      headline: "Provider-recorded security incident is material diligence context",
      finding: `The largest provider-recorded incident amount is $${largestIncidentUsd.toLocaleString("en-US")}${ratio === undefined ? "" : `, equal to ${ratio}% of reported TVL in this capture`}.${returnText}`,
      whyItMatters: "Incident mechanics, remediation, captured code lineage, and any recovery need direct verification before drawing a present-tense security conclusion.",
      changeCondition: "Update when incident records, recovery status, remediation evidence, or TVL changes.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      arithmetic: arithmetic.length > 0 ? arithmetic : undefined,
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const openStates = new Set<IntelligenceQuestionState>(["reported", "partial", "unresolved", "unavailable", "not_collected"]);
  const governanceIds = identityBindings.protocolTvlMatched
    ? evidence.protocolTvl?.governanceIds ?? []
    : [];
  const controlQuestions = questions.filter((question) => question.domain === "control");
  if (governanceIds.length > 0 && controlQuestions.some((question) => openStates.has(question.state))) {
    addSignal({
      id: "governance_control_gap",
      ruleId: "governance-control-gap",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "control",
      severity: "medium",
      polarity: "unknown",
      headline: "Governance listing exists while execution control remains unresolved",
      finding: `The protocol index lists governance identifier${governanceIds.length === 1 ? "" : "s"} ${governanceIds.join(", ")}, but the frozen scan does not resolve who can execute upgrades, pauses, or other privileged actions.`,
      whyItMatters: "A governance forum or identifier does not establish where enforceable control resides.",
      changeCondition: "Resolve with current contracts, signer sets, timelocks, and documented emergency powers.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: ["snapshot:protocol-tvl"],
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const scaleValues = [
    marketCapUsd,
    tvlUsd,
    numberValue("total_raised_usd"),
    numberValue("provider_reported_total_funding_usd"),
    numberValue("indexed_disclosed_round_sum_usd"),
  ].filter(finite);
  const scaleUsd = scaleValues.length > 0 ? Math.max(...scaleValues) : undefined;
  const treasuryQuestions = questions.filter((question) => question.domain === "treasury");
  if (finite(scaleUsd) && scaleUsd >= 10_000_000 && treasuryQuestions.some((question) => openStates.has(question.state))) {
    const scaleMeasurement = ["market_cap_usd", "tvl_usd", "total_raised_usd", "provider_reported_total_funding_usd", "indexed_disclosed_round_sum_usd"]
      .find((id) => numberValue(id) === scaleUsd);
    const measurementRefs = scaleMeasurement ? [scaleMeasurement] : [];
    const treasuryEvidenceRefs = uniqueSorted(treasuryQuestions.flatMap((question) => question.sourceRefs));
    const treasuryAddressed = treasuryQuestions.some((question) => question.answerRefs.length > 0);
    addSignal({
      id: "treasury_gap_at_scale",
      ruleId: "treasury-gap-at-scale",
      ruleVersion: 1,
      kind: "coverage_gap",
      domain: "treasury",
      severity: "medium",
      polarity: "unknown",
      headline: "The full treasury question remains open at material project scale",
      finding: treasuryAddressed
        ? `At least one frozen scale measure is $${scaleUsd.toLocaleString("en-US")}. The frozen record contains treasury evidence, but no completed question record establishes the full assets, liabilities, and spending-control picture.`
        : `At least one frozen scale measure is $${scaleUsd.toLocaleString("en-US")}, while no completed collection record establishes treasury assets, liabilities, and spending controls.`,
      whyItMatters: "Market capitalization, TVL, or funding does not reveal runway, obligations, custody, or spending authority.",
      changeCondition: "Resolve with dated treasury wallets or statements, liabilities, custody arrangements, and authorization rules.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: uniqueSorted([
        ...refsFromMeasurements(measurementMap, measurementRefs),
        ...treasuryEvidenceRefs,
      ]),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const checkedLeaders = evidence.leaderDepartures ?? [];
  const departedLeaders = checkedLeaders.filter((leader) => leader.state === "departed");
  if (departedLeaders.length > 0) {
    const measurementRefs = ["checked_leader_count", "departed_leader_count", "absent_leader_count"];
    addSignal({
      id: "leadership_departure_record",
      ruleId: "leadership-departure-record",
      ruleVersion: 1,
      kind: "observation",
      domain: "team",
      severity: "context",
      polarity: "neutral",
      headline: "Frozen employment checks record named leadership departures",
      finding: `Among ${checkedLeaders.length} named leader${checkedLeaders.length === 1 ? "" : "s"} checked in licensed employment records, ${departedLeaders.length} ${departedLeaders.length === 1 ? "is" : "are"} recorded as departed: ${departedLeaders.map((leader) => `${leader.name} (${leader.role})`).join(", ")}. Licensed records can lag public profiles, and no reason for departure is inferred.`,
      whyItMatters: "The bounded record identifies which current roster and transition claims need direct confirmation; it does not establish the full leadership team.",
      changeCondition: "Update when named leaders change their current-role records or the project publishes a sourced roster change.",
      evidenceState: "reported_context",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "counterparty", "general_diligence"],
    });
  }

  const launchGapMonths = numberValue("launch_window_gap_months");
  const launchEarliest = measurementMap.get("launch_window_earliest_date");
  const launchLatest = measurementMap.get("launch_window_latest_date");
  if (
    finite(launchGapMonths)
    && launchGapMonths >= 3
    && launchEarliest?.valueType === "date"
    && launchLatest?.valueType === "date"
  ) {
    const measurementRefs = ["launch_window_earliest_date", "launch_window_latest_date", "launch_window_gap_months"];
    addSignal({
      id: "launch_boundary_gap",
      ruleId: "launch-boundary-gap",
      ruleVersion: 1,
      kind: "observation",
      domain: "chronology",
      severity: "context",
      polarity: "neutral",
      headline: "The project's online footprint appeared in two stages",
      finding: `The earliest account or domain record we found dates to ${publicCalendarDate(launchEarliest.value)}. The other appeared on ${publicCalendarDate(launchLatest.value)}, about ${launchGapMonths} months later. This may reflect a later website or account launch, a rebrand, or earlier community activity. It does not prove when the project began or indicate wrongdoing.`,
      whyItMatters: "The date gap is a useful prompt to compare the project's website, accounts, and stated launch history.",
      changeCondition: "Run the report again if an older official account, website record, or launch announcement is found.",
      evidenceState: "bounded",
      measurementRefs,
      sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
      lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
    });
  }

  const circulatingPct = numberValue("circulating_supply_pct");
  const fdvUsd = numberValue("fdv_usd");
  if (finite(circulatingPct) && circulatingPct <= 50 && positive(fdvUsd) && positive(marketCapUsd)) {
    const fdvToMarket = rounded(fdvUsd / marketCapUsd);
    if (fdvToMarket >= 1.5) {
      const measurementRefs = ["circulating_supply_pct", "fdv_usd", "market_cap_usd"];
      const temporal = temporalAlignment("fdv_to_market_cap", measurementRefs);
      if (temporal) {
        addSignal({
          id: "reported_supply_overhang",
          ruleId: "reported-supply-overhang",
          ruleVersion: 1,
          kind: "screening_heuristic",
          domain: "supply",
          severity: fdvToMarket >= 3 ? "medium" : "low",
          polarity: "risk",
          headline: "Reported float and diluted valuation warrant unlock reconciliation",
          finding: `The registry reports ${circulatingPct}% of total supply circulating and an FDV-to-market-cap ratio of ${fdvToMarket}. These provider fields do not establish vesting terms or sale intent.`,
          whyItMatters: "The gap identifies where allocation, vesting, emissions, and recipient-level unlock work can materially change the investment view.",
          changeCondition: "Recompute when supply reports, market capitalization, or fully diluted valuation changes.",
          evidenceState: "reported_context",
          measurementRefs,
          sourceRefs: refsFromMeasurements(measurementMap, measurementRefs),
          arithmetic: [{ expression: "fdv_usd / market_cap_usd", value: fdvToMarket, unit: "ratio", inputMeasurementIds: ["fdv_usd", "market_cap_usd"], temporal }],
          lenses: ["investment", "alpha_research", "general_diligence"],
        });
      }
    }
  }

  return signals.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.id.localeCompare(right.id));
}

export interface IntelligenceLensDefinition {
  id: DecisionLensId;
  label: string;
  question: string;
  domainPriority: readonly IntelligenceDomain[];
}

const LENS_DEFINITIONS: readonly IntelligenceLensDefinition[] = [
  {
    id: "investment",
    label: "Investment decision",
    question: "What could change the underwriting, sizing, entry, or decision to pass?",
    domainPriority: ["control", "security", "treasury", "supply", "economics", "liquidity", "team", "legal", "market"],
  },
  {
    id: "alpha_research",
    label: "Alpha research",
    question: "Which measurable changes, divergences, and scheduled events deserve deeper timing work?",
    domainPriority: ["supply", "liquidity", "market", "economics", "chronology", "product"],
  },
  {
    id: "counterparty",
    label: "Counterparty diligence",
    question: "Can this entity be identified, controlled, secured, and held accountable for an exposure?",
    domainPriority: ["identity", "legal", "control", "security", "team", "treasury", "product"],
  },
  {
    id: "general_diligence",
    label: "General diligence",
    question: "What does this derived evidence subset establish, report, or leave unresolved?",
    domainPriority: DOMAIN_ORDER,
  },
] as const;

function domainRank(
  domain: IntelligenceDomain,
  priorities: readonly IntelligenceDomain[],
  domains: readonly IntelligenceDomain[] = DOMAIN_ORDER,
): number {
  const index = priorities.indexOf(domain);
  return index === -1 ? priorities.length + domains.indexOf(domain) : index;
}

function buildLenses(
  signals: readonly DerivedIntelligenceSignal[],
  questions: readonly IntelligenceQuestion[],
  definitions: readonly IntelligenceLensDefinition[] = LENS_DEFINITIONS,
  domains: readonly IntelligenceDomain[] = DOMAIN_ORDER,
): DecisionLens[] {
  const openStates = new Set<IntelligenceQuestionState>(["reported", "partial", "unresolved", "unavailable", "not_collected"]);
  const materialityRank: Record<IntelligenceQuestion["materiality"], number> = { critical: 0, important: 1, context: 2 };

  return LENS_ORDER.map((lensId) => {
    const definition = definitions.find((candidate) => candidate.id === lensId);
    if (!definition) throw new Error(`Missing intelligence lens definition: ${lensId}`);
    const rankedSignals = signals
      .filter((signal) => signal.lenses.includes(lensId))
      .sort((left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
        || domainRank(left.domain, definition.domainPriority, domains) - domainRank(right.domain, definition.domainPriority, domains)
        || left.id.localeCompare(right.id),
      );
    const unresolvedQuestions = questions
      .filter((question) => openStates.has(question.state))
      .sort((left, right) =>
        materialityRank[left.materiality] - materialityRank[right.materiality]
        || domainRank(left.domain, definition.domainPriority, domains) - domainRank(right.domain, definition.domainPriority, domains)
        || left.id.localeCompare(right.id),
      );
    return {
      id: definition.id,
      label: definition.label,
      question: definition.question,
      domainPriority: [...definition.domainPriority],
      signalIds: rankedSignals.map((signal) => signal.id),
      unresolvedQuestionIds: unresolvedQuestions.map((question) => question.id),
      changeConditions: uniqueInOrder(rankedSignals.map((signal) => signal.changeCondition)),
    };
  });
}

function buildCaptureWindow(sources: readonly IntelligenceSourceRef[]): IntelligenceSpineSnapshot["captureWindow"] {
  const dated = sources
    .flatMap((source) => source.capturedAt ? [{ value: source.capturedAt, time: Date.parse(source.capturedAt) }] : [])
    .filter((record) => Number.isFinite(record.time))
    .sort((left, right) => left.time - right.time || left.value.localeCompare(right.value));
  return {
    earliest: dated[0]?.value ?? null,
    latest: dated.at(-1)?.value ?? null,
  };
}

function duplicateIds(items: readonly { id: string }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

export function sanitizeIntelligenceSnapshot(
  snapshot: IntelligenceSpineSnapshot,
  evidence: Readonly<CollectedEvidence>,
  options: {
    domains?: readonly IntelligenceDomain[];
    lensDefinitions?: readonly IntelligenceLensDefinition[];
  } = {},
): IntelligenceSpineSnapshot {
  const duplicateSourceIds = duplicateIds(snapshot.sources);
  const sources = snapshot.sources.filter((source) => !duplicateSourceIds.has(source.id));
  const sourceIds = new Set(sources.map((source) => source.id));

  const duplicateMeasurementIds = duplicateIds(snapshot.measurements);
  const sourceValidMeasurements = snapshot.measurements.filter((measurement) =>
    !duplicateMeasurementIds.has(measurement.id)
    && measurement.sourceRefs.length > 0
    && measurement.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)));
  let measurements = sourceValidMeasurements;
  while (true) {
    const retainedIds = new Set(measurements.map((measurement) => measurement.id));
    const next = measurements.filter((measurement) =>
      !measurement.denominatorMeasurementId
      || (measurement.denominatorMeasurementId !== measurement.id
        && retainedIds.has(measurement.denominatorMeasurementId)));
    if (next.length === measurements.length) break;
    measurements = next;
  }
  const measurementIds = new Set(measurements.map((measurement) => measurement.id));
  const measurementMap = new Map(measurements.map((measurement) => [measurement.id, measurement]));
  const droppedMeasurementCount = snapshot.measurements.length - measurements.length;

  const forms = snapshot.subject.forms.filter((form) =>
    form.sourceRefs.length > 0 && form.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)));
  const matches = snapshot.subject.archetypes.matches.filter((match) =>
    match.sourceRefs.length > 0 && match.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)));
  const archetypePrimary = snapshot.subject.archetypes.primary
    && matches.some((match) => match.archetype === snapshot.subject.archetypes.primary)
    ? snapshot.subject.archetypes.primary
    : matches[0]?.archetype ?? null;
  const archetypeState = matches.length === 0
    ? "insufficient" as const
    : matches.length > 1
      ? "hybrid" as const
      : matches[0]?.confidence === "structural_generic"
        ? "generic" as const
        : "resolved" as const;
  const validArchetypeQuestionIds = new Set(matches.flatMap((match) =>
    (ARCHETYPE_QUESTIONS[match.archetype] ?? []).map((question) => question.id)));
  const subjectLineageDropCount = (snapshot.subject.forms.length - forms.length)
    + (snapshot.subject.archetypes.matches.length - matches.length);

  const factIdCounts = new Map<string, number>();
  for (const fact of evidence.basicFacts ?? []) {
    factIdCounts.set(fact.factId, (factIdCounts.get(fact.factId) ?? 0) + 1);
  }
  const validFactIds = new Set([...factIdCounts]
    .filter(([, count]) => count === 1)
    .map(([factId]) => factId));
  const duplicateQuestionIds = duplicateIds(snapshot.questions);
  let downgradedQuestionCount = 0;
  let droppedArchetypeQuestionCount = 0;
  const questions = snapshot.questions
    .filter((question) => !duplicateQuestionIds.has(question.id))
    .filter((question) => {
      const retained = !question.id.startsWith("archetype.") || validArchetypeQuestionIds.has(question.id);
      if (!retained) droppedArchetypeQuestionCount += 1;
      return retained;
    })
    .map((question) => {
      const sourceRefs = question.sourceRefs.filter((sourceRef) => sourceIds.has(sourceRef));
      const answerRefs = question.answerRefs.filter((answerRef) =>
        measurementIds.has(answerRef)
        || validFactIds.has(answerRef)
        || (answerRef.startsWith("fact:") && validFactIds.has(answerRef.slice("fact:".length))));
      const lostLineage = sourceRefs.length !== question.sourceRefs.length
        || answerRefs.length !== question.answerRefs.length;
      if (!lostLineage) return question;
      downgradedQuestionCount += 1;
      const hasRemainingBasis = sourceRefs.length > 0 || answerRefs.length > 0;
      const state = question.state === "resolved" || question.state === "reported" || question.state === "partial"
        ? hasRemainingBasis ? "partial" as const : "unresolved" as const
        : question.state;
      return {
        ...question,
        state,
        basis: `${question.basis} One or more saved answer or source references failed the Intelligence Spine integrity gate. Surviving fragments cannot upgrade this question's prior evidence state.`,
        answerRefs,
        sourceRefs,
      };
    });
  const duplicateSignalIds = duplicateIds(snapshot.signals);
  const validArithmeticReceipt = (
    receipt: IntelligenceArithmeticReceipt,
    signal: DerivedIntelligenceSignal,
  ): boolean => {
    const inputIds = receipt.inputMeasurementIds;
    if (
      !receipt.expression.trim()
      || !Number.isFinite(receipt.value)
      || inputIds.length === 0
      || new Set(inputIds).size !== inputIds.length
      || !inputIds.every((measurementId) => measurementIds.has(measurementId))
      || !inputIds.every((measurementId) => signal.measurementRefs.includes(measurementId))
      || !receipt.temporal
    ) return false;
    const temporalIds = receipt.temporal.inputAsOf.map((input) => input.measurementId);
    if (
      temporalIds.length < inputIds.length
      || new Set(temporalIds).size !== temporalIds.length
      || !inputIds.every((measurementId) => temporalIds.includes(measurementId))
      || !temporalIds.every((measurementId) => measurementIds.has(measurementId))
      || !temporalIds.every((measurementId) => signal.measurementRefs.includes(measurementId))
    ) return false;
    const inputTimes = receipt.temporal.inputAsOf.flatMap((input) => {
      const measurementAsOf = measurementMap.get(input.measurementId)?.window?.asOf;
      if (
        typeof measurementAsOf !== "string"
        || input.asOf !== measurementAsOf
        || !Number.isFinite(Date.parse(input.asOf))
      ) return [];
      return [Date.parse(input.asOf)];
    });
    if (inputTimes.length !== temporalIds.length) return false;
    const computedSkewHours = rounded(
      (Math.max(...inputTimes) - Math.min(...inputTimes)) / 3_600_000,
      4,
    );
    return Number.isFinite(receipt.temporal.maxInputSkewHours)
      && receipt.temporal.maxInputSkewHours >= 0
      && receipt.temporal.maxInputSkewHours <= 72
      && Math.abs(receipt.temporal.maxInputSkewHours - computedSkewHours) < 0.0001;
  };
  const signals = snapshot.signals.filter((signal) => {
    if (duplicateSignalIds.has(signal.id)) return false;
    if (new Set(signal.sourceRefs).size !== signal.sourceRefs.length) return false;
    if (new Set(signal.measurementRefs).size !== signal.measurementRefs.length) return false;
    if (!signal.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef))) return false;
    if (!signal.measurementRefs.every((measurementRef) => measurementIds.has(measurementRef))) return false;
    if (signal.kind !== "coverage_gap" && signal.sourceRefs.length === 0) return false;
    const measurementSourceRefs = signal.measurementRefs.flatMap((measurementRef) =>
      measurementMap.get(measurementRef)?.sourceRefs ?? []);
    if (!measurementSourceRefs.every((sourceRef) => signal.sourceRefs.includes(sourceRef))) return false;
    if (signal.kind === "arithmetic" && (signal.arithmetic?.length ?? 0) === 0) return false;
    return (signal.arithmetic ?? []).every((receipt) => validArithmeticReceipt(receipt, signal));
  });
  const droppedSignalCount = snapshot.signals.length - signals.length;

  const issueCount = duplicateSourceIds.size
    + duplicateMeasurementIds.size
    + duplicateQuestionIds.size
    + duplicateSignalIds.size
    + droppedMeasurementCount
    + downgradedQuestionCount
    + droppedArchetypeQuestionCount
    + droppedSignalCount
    + subjectLineageDropCount;
  const integritySignal: DerivedIntelligenceSignal | null = issueCount > 0 ? {
    id: "intelligence_integrity_gap",
    ruleId: "intelligence-integrity-gate",
    ruleVersion: 1,
    kind: "coverage_gap",
    domain: "identity",
    severity: "high",
    polarity: "unknown",
    headline: "Part of the derived intelligence failed its lineage contract",
    finding: `The final integrity gate recorded ${issueCount} fail-closed integrity events. Counts include ${duplicateSourceIds.size} duplicate source IDs, ${duplicateMeasurementIds.size} duplicate measurement IDs, ${duplicateQuestionIds.size} duplicate question IDs, ${duplicateSignalIds.size} duplicate signal IDs, ${droppedMeasurementCount} invalid measurements, ${downgradedQuestionCount} questions with invalid lineage, ${droppedArchetypeQuestionCount} questions routed by rejected archetype evidence, ${droppedSignalCount} invalid signals, and ${subjectLineageDropCount} subject-classification rows with invalid sources. No affected record is treated as evidence.`,
    whyItMatters: "A polished conclusion is not auditable when its source, denominator, arithmetic input, or decision-map reference cannot be resolved exactly.",
    changeCondition: "Repair the frozen IDs and lineage references, then rebuild the intelligence snapshot from the same immutable evidence.",
    evidenceState: "bounded",
    measurementRefs: [],
    sourceRefs: [],
    lenses: ["investment", "alpha_research", "counterparty", "general_diligence"],
  } : null;
  const finalSignals = integritySignal
    ? [integritySignal, ...signals].sort((left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
        || left.id.localeCompare(right.id))
    : signals;
  const domains = withReferencedDomains(options.domains ?? DOMAIN_ORDER, questions, measurements);
  const coverage = buildCoverage(measurements, questions, domains);
  const lenses = buildLenses(finalSignals, questions, options.lensDefinitions ?? LENS_DEFINITIONS, domains);

  return {
    ...snapshot,
    subject: {
      ...snapshot.subject,
      forms,
      archetypes: {
        state: archetypeState,
        primary: archetypePrimary,
        matches,
      },
    },
    captureWindow: buildCaptureWindow(sources),
    sources,
    measurements,
    questions,
    coverage,
    signals: finalSignals,
    lenses,
  };
}

/**
 * Builds a deterministic, score-neutral intelligence snapshot from one frozen
 * PROJECT evidence bag. Missing inputs remain missing or explicitly tracked;
 * they never become zeroes, negatives, or exonerating claims.
 */
export function buildPointInTimeIntelligence(
  evidence: Readonly<CollectedEvidence>,
): IntelligenceSpineSnapshot | null {
  if (!evidence.roles.includes(SubjectClass.PROJECT)) return null;

  const identityBindings = crossProducerIdentityBindings(evidence);
  const classification = classifyProjectArchetypes({
    ...evidence,
    projectToken: identityBindings.canonicalTokenVerified ? evidence.projectToken : undefined,
    protocolTvl: identityBindings.protocolTvlMatched ? evidence.protocolTvl : undefined,
    companyEnrichment: identityBindings.companyEnrichmentMatched ? evidence.companyEnrichment : undefined,
  });
  const sources = buildSources(evidence);
  const measurements = buildMeasurements(evidence);
  const questions = buildQuestions(evidence, measurements, classification.archetypes, classification.forms);
  const coverage = buildCoverage(measurements, questions, withReferencedDomains(DOMAIN_ORDER, questions, measurements));
  const signals = buildSignals(evidence, measurements, questions);
  const lenses = buildLenses(signals, questions);

  return sanitizeIntelligenceSnapshot({
    schemaVersion: 1,
    rulesetVersion: "argus-point-in-time-v1",
    mode: "point_in_time",
    scoringImpact: "none",
    subject: {
      key: evidence.profile.handle,
      label: evidence.profile.resolved_name ?? evidence.profile.display_name ?? evidence.profile.handle,
      forms: classification.forms,
      archetypes: classification.archetypes,
    },
    captureWindow: buildCaptureWindow(sources),
    sources,
    measurements,
    questions,
    coverage,
    signals,
    lenses,
  }, evidence);
}
