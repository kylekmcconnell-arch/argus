import type {
  BasicFact,
  BasicFactPredicate,
  BasicFactQuestionLedgerEntry,
  CollectedEvidence,
  SourceArtifact,
} from "../data/evidence";
import { findingHasEligibleArtifact, findingTargetsAuditedSubject } from "../engine/audit";
import { SubjectClass } from "../engine/taxonomy";
import { isExactDomainBoundCompanyEnrichment } from "../lib/diligenceEvidenceBinding";
import { isStrictFundScaleArtifact } from "../lib/fundScaleEvidence";
import { isInstitutionalInvestorAccount, isOrganizationAccount } from "../lib/investorSubject";
import { portfolioRelationshipBinding } from "../lib/portfolioRelationshipBinding";
import {
  sanitizeIntelligenceSnapshot,
  type IntelligenceLensDefinition,
} from "./buildPointInTimeIntelligence";
import type {
  DecisionLensId,
  DerivedIntelligenceSignal,
  IntelligenceDomain,
  IntelligenceEvidenceState,
  IntelligenceMeasurement,
  IntelligenceQuestion,
  IntelligenceQuestionState,
  IntelligenceSourceClass,
  IntelligenceSourceRef,
  IntelligenceSpineSnapshot,
  IntelligenceSubjectForm,
  SubjectFormAssessment,
} from "./types";
import { buildEntityScorecards } from "./entityScorecards";

export type EntityIntelligenceKind =
  | "person"
  | "individual_investor"
  | "investment_firm"
  | "operating_company";

const ALL_LENSES: DecisionLensId[] = [
  "investment",
  "alpha_research",
  "counterparty",
  "general_diligence",
];

const ENTITY_DOMAIN_ORDER: IntelligenceDomain[] = [
  "identity",
  "career",
  "team",
  "product",
  "operations",
  "track_record",
  "portfolio",
  "fund_scale",
  "funding",
  "relationships",
  "reputation",
  "governance",
  "control",
  "security",
  "legal",
  "chronology",
];

const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

function safePublicUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !url.hostname
      || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))
    ) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function bounded(value: string, maximum = 280): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maximum ? clean : `${clean.slice(0, maximum - 3)}...`;
}

function entityKind(evidence: Readonly<CollectedEvidence>): EntityIntelligenceKind | null {
  if (evidence.roles.includes(SubjectClass.PROJECT)) return null;
  if (isInstitutionalInvestorAccount(evidence)) return "investment_firm";
  if (isOrganizationAccount(evidence)) return "operating_company";
  if (evidence.roles.includes(SubjectClass.INVESTOR)) return "individual_investor";
  return "person";
}

function predicateDomain(predicate: BasicFactPredicate, kind: EntityIntelligenceKind): IntelligenceDomain {
  switch (predicate) {
    case "official_identity": return "identity";
    case "current_role":
    case "prior_role":
    case "education": return kind === "investment_firm" || kind === "operating_company" ? "team" : "career";
    case "founder":
    case "executive": return "team";
    case "founded":
    case "launched": return "chronology";
    case "exit":
    case "track_record": return "track_record";
    case "investor": return "portfolio";
    case "funding": return kind === "investment_firm" ? "fund_scale" : "funding";
    case "partnership": return "relationships";
    case "product":
    case "traction": return kind === "operating_company" ? "operations" : "product";
    case "repository": return "operations";
    case "governance": return "governance";
    case "control": return "control";
    case "conflict_of_interest": return "reputation";
    case "legal_entity":
    case "legal_regulatory_event":
    case "public_security": return "legal";
    case "security_incident":
    case "audit": return "security";
    case "treasury": return "funding";
    case "official_token":
    case "network":
    case "tokenomics":
    case "vesting": return "product";
  }
}

function factSourceClass(sourceClass: string): IntelligenceSourceClass {
  if (sourceClass === "official_subject") return "official_subject";
  if (sourceClass === "official_counterparty") return "official_counterparty";
  if (sourceClass === "regulatory_or_onchain") return "public_registry";
  if (sourceClass === "independent_press") return "independent_publication";
  return "other_public";
}

/**
 * A fact is in conflict when it is MARKED conflicted or when it still retains
 * a contradicting source.
 *
 * Keying only on status split this file against itself: the question builder
 * already treated a retained contradicting source as a conflict, while the
 * evidence state and the conflict signal did not. A legacy fact carrying
 * status "verified" plus a contradicting source could therefore headline as
 * verified support and emit no conflict signal, while its own question was
 * simultaneously marked conflict-partial. The project builder anticipates
 * exactly this input shape.
 */
function factIsConflicted(fact: BasicFact): boolean {
  return fact.status === "conflicted"
    || fact.sources.some((source) => source.relation === "contradicts");
}

function factEvidenceState(
  fact: BasicFact,
  evidence: Readonly<CollectedEvidence>,
): IntelligenceEvidenceState {
  if (factIsConflicted(fact)) return "bounded";
  if (fact.floorEligible === false || fact.providerProjection === true) return "reported_context";
  if (!isOrganizationAccount(evidence) && !evidence.profile.identity_binding) return "reported_context";
  if (fact.sources.length > 0 && fact.sources.every((source) => source.sourceClass === "official_subject")) {
    return "reported_context";
  }
  return fact.status === "verified" || fact.status === "corroborated" ? "verified" : "reported_context";
}

function directSubjectFact(fact: BasicFact, evidence: Readonly<CollectedEvidence>): boolean {
  if (fact.subjectKey.trim().toLowerCase() !== evidence.profile.handle.trim().toLowerCase()) return false;
  return fact.attributionScope !== "related_entity" && fact.attributionScope !== "identity_unresolved";
}

function sourceArtifactClass(artifact: SourceArtifact): IntelligenceSourceClass {
  if (artifact.kind === "legal_case") return "public_registry";
  if (artifact.kind === "sanctions_screen" || artifact.kind === "trust_graph") return "bounded_collection_record";
  if (artifact.sourceClass === "first_party_subject" || artifact.sourceClass === "first_party_investor") return "official_subject";
  if (artifact.sourceClass === "first_party_project") return "official_counterparty";
  if (artifact.sourceClass === "public_primary") return "public_registry";
  if (artifact.sourceClass === "independent_press") return "independent_publication";
  return "other_public";
}

function sourceArtifactState(
  artifact: SourceArtifact,
  evidence: Readonly<CollectedEvidence>,
): IntelligenceEvidenceState {
  if (artifact.coverageState === "unavailable") return "bounded";
  if (artifact.kind === "fund_scale") {
    const capturedAt = new Date(artifact.capturedAt);
    const strict = Number.isFinite(capturedAt.getTime()) && isStrictFundScaleArtifact(
      artifact,
      evidence.sourceArtifacts,
      { now: capturedAt, subjectHandle: evidence.profile.handle, profile: evidence.profile },
    );
    if (!strict) return "reported_context";
    return artifact.fundScaleBasis === "regulatory" ? "verified" : "reported_context";
  }
  if (artifact.kind === "portfolio_relationship") {
    return portfolioRelationshipBinding(artifact, evidence) ? "verified" : "reported_context";
  }
  if (artifact.match === "screened_clear" || artifact.match === "no_match") return "bounded";
  return "reported_context";
}

function buildSources(evidence: Readonly<CollectedEvidence>): IntelligenceSourceRef[] {
  const sources: IntelligenceSourceRef[] = [];
  const handle = evidence.profile.handle.replace(/^@/, "");
  if (
    evidence.profile.profile_collection_state === "resolved"
    && evidence.profile.profile_provider
    && validTime(evidence.profile.profile_captured_at)
  ) {
    sources.push({
      id: "entity:profile",
      inputPath: "profile",
      provider: evidence.profile.profile_provider,
      title: `Official X profile for @${handle}`,
      sourceClass: "first_party_profile",
      evidenceState: "reported_context",
      sourceUrl: `https://x.com/${encodeURIComponent(handle)}`,
      capturedAt: evidence.profile.profile_captured_at,
      excerpt: bounded([evidence.profile.display_name, evidence.profile.bio].filter(Boolean).join(". ")),
    });
  }

  for (const [factIndex, fact] of (evidence.basicFacts ?? []).entries()) {
    for (const [sourceIndex, source] of fact.sources.entries()) {
      sources.push({
        id: `fact:${fact.factId}:source:${String(sourceIndex + 1).padStart(2, "0")}`,
        inputPath: `basicFacts.${factIndex}.sources.${sourceIndex}`,
        provider: source.provider,
        title: source.title?.trim() || `${fact.predicate.replaceAll("_", " ")} source`,
        sourceClass: factSourceClass(source.sourceClass),
        // A receipt describing SOMEONE ELSE cannot carry the audited subject's
        // evidence tier. Measurements and questions already exclude non-direct
        // facts, but the register still rendered a related-entity or
        // different-subject row as "verified" with no scope qualifier, which
        // reads as a verified statement about this subject.
        evidenceState: directSubjectFact(fact, evidence)
          ? factEvidenceState(fact, evidence)
          : "reported_context",
        relation: source.relation,
        sourceUrl: safePublicUrl(source.url),
        capturedAt: validTime(source.capturedAt) ? source.capturedAt : undefined,
        factId: fact.factId,
        excerpt: bounded(source.excerpt),
        contentHashes: source.contentHash ? [source.contentHash] : undefined,
      });
    }
  }

  for (const [index, artifact] of evidence.sourceArtifacts.entries()) {
    sources.push({
      id: `entity:artifact:${String(index + 1).padStart(3, "0")}`,
      inputPath: `sourceArtifacts.${index}`,
      provider: artifact.provider,
      title: artifact.title,
      sourceClass: sourceArtifactClass(artifact),
      evidenceState: sourceArtifactState(artifact, evidence),
      sourceUrl: safePublicUrl(artifact.sourceUrl),
      capturedAt: validTime(artifact.capturedAt) ? artifact.capturedAt : undefined,
      publishedAt: validTime(artifact.publishedAt) ? artifact.publishedAt : undefined,
      excerpt: artifact.excerpt ? bounded(artifact.excerpt) : undefined,
      contentHashes: unique([artifact.contentHash, artifact.sourceContentHash].filter((value): value is string => Boolean(value))),
    });
  }

  for (const [index, lead] of (evidence.portfolioLeads ?? []).entries()) {
    for (const [sourceIndex, candidate] of lead.sources.entries()) {
      const sourceUrl = safePublicUrl(candidate.url);
      if (!sourceUrl) continue;
      sources.push({
        id: `entity:portfolio-lead:${String(index + 1).padStart(3, "0")}:source:${String(sourceIndex + 1).padStart(2, "0")}`,
        inputPath: `portfolioLeads.${index}.sources.${sourceIndex}`,
        provider: lead.provider,
        title: candidate.title?.trim() || `Candidate source for ${lead.projectName}`,
        sourceClass: "other_public",
        evidenceState: "reported_context",
        sourceUrl,
        excerpt: `Discovery candidate only. It has not established that ${lead.investorEntityName ?? evidence.profile.display_name} invested in ${lead.projectName}.`,
      });
    }
  }

  for (const [index, venture] of evidence.ventures.entries()) {
    if (venture.artifact_verified !== true || venture.evidence_origin === "model_lead") continue;
    const sourceUrl = safePublicUrl(venture.evidence_url);
    if (!sourceUrl) continue;
    const licensed = venture.provider === "peopledatalabs";
    sources.push({
      id: `entity:venture:${String(index + 1).padStart(3, "0")}`,
      inputPath: `ventures.${index}`,
      provider: venture.provider ?? "unknown",
      title: `${venture.project_name} role record`,
      sourceClass: licensed ? "licensed_enrichment" : "other_public",
      evidenceState: licensed ? "reported_context" : "verified",
      sourceUrl,
      excerpt: bounded(`${venture.role}${venture.period ? `, ${venture.period}` : ""}; saved outcome: ${venture.outcome}.`),
    });
  }

  for (const [index, departure] of (evidence.employmentDepartures ?? []).entries()) {
    sources.push({
      id: `entity:employment-departure:${String(index + 1).padStart(3, "0")}`,
      inputPath: `employmentDepartures.${index}`,
      provider: "peopledatalabs",
      title: `${departure.company} employment record`,
      sourceClass: "licensed_enrichment",
      evidenceState: "reported_context",
      excerpt: bounded(departure.summary),
    });
  }

  const companyBound = isExactDomainBoundCompanyEnrichment(evidence.companyEnrichment, evidence.profile.website);
  if (companyBound && evidence.companyEnrichment) {
    sources.push({
      id: "entity:company-enrichment",
      inputPath: "companyEnrichment",
      provider: "monid",
      title: `${evidence.companyEnrichment.name} licensed company record`,
      sourceClass: "licensed_enrichment",
      evidenceState: "reported_context",
      sourceUrl: safePublicUrl(evidence.companyEnrichment.sourceUrl),
      capturedAt: validTime(evidence.companyEnrichment.capturedAt) ? evidence.companyEnrichment.capturedAt : undefined,
      excerpt: `Identity-bound licensed record for ${evidence.companyEnrichment.name}. Provider fields remain attributed and do not independently establish company quality or solvency.`,
    });
  }

  for (const [index, finding] of evidence.findings.entries()) {
    if (
      finding.artifact_verified !== true
      || finding.evidence_origin === "model_lead"
      || !findingHasEligibleArtifact(finding)
      || !findingTargetsAuditedSubject(finding, evidence.profile.handle)
    ) continue;
    sources.push({
      id: `entity:finding:${String(index + 1).padStart(3, "0")}`,
      inputPath: `findings.${index}`,
      provider: finding.provider ?? "argus",
      title: finding.finding_type.replaceAll("_", " "),
      sourceClass: "other_public",
      evidenceState: "verified",
      sourceUrl: safePublicUrl(finding.source_url),
      excerpt: bounded(finding.claim),
      contentHashes: finding.content_hash ? [finding.content_hash] : undefined,
    });
  }

  return sources;
}

function factSourceRefs(fact: BasicFact, sources: readonly IntelligenceSourceRef[]): string[] {
  const prefix = `fact:${fact.factId}:source:`;
  return sources.filter((source) => source.id.startsWith(prefix)).map((source) => source.id);
}

function artifactSourceRef(index: number): string {
  return `entity:artifact:${String(index + 1).padStart(3, "0")}`;
}

function profileFollowerCount(value: string): number | null {
  const match = value.trim().replaceAll(",", "").match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmb])?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000
    : match[2]?.toLowerCase() === "m" ? 1_000_000
      : match[2]?.toLowerCase() === "b" ? 1_000_000_000
        : 1;
  const count = base * multiplier;
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function buildMeasurements(
  evidence: Readonly<CollectedEvidence>,
  kind: EntityIntelligenceKind,
  sources: readonly IntelligenceSourceRef[],
): IntelligenceMeasurement[] {
  const measurements: IntelligenceMeasurement[] = [];
  const profileSource = sources.some((source) => source.id === "entity:profile") ? ["entity:profile"] : [];
  const profileAsOf = validTime(evidence.profile.profile_captured_at) ? evidence.profile.profile_captured_at : undefined;
  const followers = profileFollowerCount(evidence.profile.followers);
  if (followers != null && profileSource.length) {
    measurements.push({
      id: "entity_profile_followers",
      domain: "reputation",
      label: "Reported X followers",
      unit: "count",
      valueType: "number",
      value: followers,
      entityKey: evidence.profile.handle,
      window: { kind: "instant", asOf: profileAsOf },
      evidenceState: "reported_context",
      sourceRefs: profileSource,
    });
  }
  if (validTime(evidence.profile.account_created_at) && profileSource.length) {
    measurements.push({
      id: "entity_account_created_at",
      domain: "chronology",
      label: "Official account created",
      unit: "date",
      valueType: "date",
      value: evidence.profile.account_created_at,
      entityKey: evidence.profile.handle,
      window: { kind: "historical", asOf: profileAsOf },
      evidenceState: "measured",
      sourceRefs: profileSource,
    });
  }
  if (validTime(evidence.profile.last_post_at) && profileSource.length) {
    measurements.push({
      id: "entity_last_observed_post_at",
      domain: "chronology",
      label: "Latest observed post",
      unit: "date",
      valueType: "date",
      value: evidence.profile.last_post_at,
      entityKey: evidence.profile.handle,
      window: { kind: "instant", asOf: profileAsOf },
      evidenceState: "bounded",
      sourceRefs: profileSource,
    });
  }

  for (const fact of (evidence.basicFacts ?? []).filter((candidate) => directSubjectFact(candidate, evidence))) {
    const sourceRefs = factSourceRefs(fact, sources);
    if (!sourceRefs.length) continue;
    measurements.push({
      id: `entity_fact:${fact.factId}`,
      domain: predicateDomain(fact.predicate, kind),
      label: fact.predicate.replaceAll("_", " "),
      unit: "text",
      valueType: "text",
      value: fact.value,
      entityKey: evidence.profile.handle,
      evidenceState: factEvidenceState(fact, evidence),
      sourceRefs,
    });
  }

  for (const [index, venture] of evidence.ventures.entries()) {
    const sourceRef = `entity:venture:${String(index + 1).padStart(3, "0")}`;
    const ventureSource = sources.find((source) => source.id === sourceRef);
    if (!ventureSource) continue;
    measurements.push({
      id: `entity_venture:${String(index + 1).padStart(3, "0")}`,
      domain: "track_record",
      label: `${venture.project_name} role and outcome record`,
      unit: "text",
      valueType: "text",
      value: `${venture.project_name} | ${venture.role} | ${venture.period || "period not recorded"} | ${venture.outcome}`,
      entityKey: evidence.profile.handle,
      evidenceState: ventureSource.evidenceState,
      sourceRefs: [sourceRef],
    });
  }

  const portfolioGroups = new Map<string, Array<{ artifact: SourceArtifact; index: number }>>();
  for (const row of evidence.sourceArtifacts.map((artifact, index) => ({ artifact, index }))) {
    const binding = portfolioRelationshipBinding(row.artifact, evidence);
    if (!binding) continue;
    const key = [
      binding,
      row.artifact.attribution ?? "",
      row.artifact.investorEntityDomain ?? row.artifact.investorEntityHandle ?? row.artifact.investorEntityName ?? "",
      row.artifact.projectDomain ?? row.artifact.projectHandle ?? row.artifact.projectName ?? "",
    ].map((value) => value.trim().toLowerCase()).join("::");
    portfolioGroups.set(key, [...(portfolioGroups.get(key) ?? []), row]);
  }
  const confirmedPortfolio = [...portfolioGroups.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (confirmedPortfolio.length) {
    const sourceRefs = unique(confirmedPortfolio.flatMap(([, rows]) => rows.map(({ index }) => artifactSourceRef(index))));
    measurements.push({
      id: "entity_confirmed_portfolio_relationship_count",
      domain: "portfolio",
      label: "Confirmed portfolio relationships in saved evidence",
      unit: "count",
      valueType: "number",
      value: confirmedPortfolio.length,
      entityKey: evidence.profile.handle,
      evidenceState: "measured",
      sourceRefs,
    });
    for (const [groupIndex, [, rows]] of confirmedPortfolio.entries()) {
      const artifact = rows[0].artifact;
      measurements.push({
        id: `entity_portfolio_relationship:${String(groupIndex + 1).padStart(3, "0")}`,
        domain: "portfolio",
        label: artifact.projectName ? `${artifact.projectName} investment relationship` : "Investment relationship",
        unit: "text",
        valueType: "text",
        value: `${artifact.investorEntityName ?? evidence.profile.display_name} invested in ${artifact.projectName ?? "an unnamed project"}${artifact.attribution === "affiliated_fund" ? " through an affiliated fund attribution" : ""}`,
        entityKey: evidence.profile.handle,
        evidenceState: "verified",
        sourceRefs: rows.map(({ index }) => artifactSourceRef(index)),
      });
    }
  }

  const confirmedProjectNames = new Set(confirmedPortfolio.flatMap(([, rows]) => rows.map(({ artifact }) => artifact.projectName?.trim().toLowerCase())).filter(Boolean));
  const unresolvedLeadIndexes = (evidence.portfolioLeads ?? []).flatMap((lead, index) =>
    confirmedProjectNames.has(lead.projectName.trim().toLowerCase()) ? [] : [index]);
  const unresolvedLeadPrefixes = unresolvedLeadIndexes.map((index) => `entity:portfolio-lead:${String(index + 1).padStart(3, "0")}:`);
  const leadSourceRefs = sources
    .filter((source) => unresolvedLeadPrefixes.some((prefix) => source.id.startsWith(prefix)))
    .map((source) => source.id);
  if (unresolvedLeadIndexes.length > 0 && leadSourceRefs.length) {
    measurements.push({
      id: "entity_unverified_portfolio_candidate_count",
      domain: "portfolio",
      label: "Unverified portfolio candidates",
      unit: "count",
      valueType: "number",
      value: unresolvedLeadIndexes.length,
      entityKey: evidence.profile.handle,
      evidenceState: "reported_context",
      sourceRefs: leadSourceRefs,
    });
  }

  const scaleGroups = new Map<string, Array<{ artifact: SourceArtifact; index: number }>>();
  for (const [index, artifact] of evidence.sourceArtifacts.entries()) {
    const capturedAt = new Date(artifact.capturedAt);
    if (
      artifact.kind !== "fund_scale"
      || !Number.isFinite(capturedAt.getTime())
      || !isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts, {
        now: capturedAt,
        subjectHandle: evidence.profile.handle,
        profile: evidence.profile,
      })
    ) continue;
    const key = artifact.fundScaleClaimId ?? [
      artifact.fundName,
      artifact.fundVehicle,
      artifact.fundScaleMetric,
      artifact.fundSizeUsd,
      artifact.fundScaleAsOf,
    ].join("::").toLowerCase();
    scaleGroups.set(key, [...(scaleGroups.get(key) ?? []), { artifact, index }]);
  }
  for (const [groupIndex, [, rows]] of [...scaleGroups.entries()].sort(([left], [right]) => left.localeCompare(right)).entries()) {
    const artifact = rows[0].artifact;
    if (typeof artifact.fundSizeUsd !== "number") continue;
    const asOf = validTime(artifact.fundScaleAsOf) ? artifact.fundScaleAsOf : undefined;
    measurements.push({
      id: `entity_fund_scale:${String(groupIndex + 1).padStart(3, "0")}`,
      domain: "fund_scale",
      label: `${artifact.fundName ?? "Fund"} ${artifact.fundScaleMetric?.replaceAll("_", " ") ?? "scale claim"}`,
      unit: "usd",
      valueType: "number",
      value: artifact.fundSizeUsd,
      entityKey: artifact.fundName ?? evidence.profile.handle,
      window: { kind: artifact.fundScaleTemporalState === "current" ? "instant" : "historical", asOf },
      evidenceState: artifact.fundScaleBasis === "regulatory" ? "verified" : "reported_context",
      sourceRefs: rows.map(({ index }) => artifactSourceRef(index)),
    });
  }

  const company = evidence.companyEnrichment;
  if (company && sources.some((source) => source.id === "entity:company-enrichment")) {
    const sourceRefs = ["entity:company-enrichment"];
    const asOf = validTime(company.capturedAt) ? company.capturedAt : undefined;
    if (typeof company.funding?.totalRaisedUsd === "number" && Number.isFinite(company.funding.totalRaisedUsd) && company.funding.totalRaisedUsd >= 0) {
      measurements.push({
        id: "entity_company_total_raised_usd",
        domain: "funding",
        label: "Licensed-provider total funding",
        unit: "usd",
        valueType: "number",
        value: company.funding.totalRaisedUsd,
        entityKey: evidence.profile.handle,
        window: { kind: "historical", asOf },
        evidenceState: "reported_context",
        sourceRefs,
      });
    }
    if (company.funding) {
      measurements.push({
        id: "entity_company_funding_round_count",
        domain: "funding",
        label: "Licensed-provider funding rounds",
        unit: "count",
        valueType: "number",
        value: company.funding.rounds.length,
        entityKey: evidence.profile.handle,
        window: { kind: "historical", asOf },
        evidenceState: "reported_context",
        sourceRefs,
      });
    }
    if (company.management) {
      measurements.push({
        id: "entity_company_management_count",
        domain: "team",
        label: "Licensed-provider management rows",
        unit: "count",
        valueType: "number",
        value: company.management.length,
        entityKey: evidence.profile.handle,
        window: { kind: "instant", asOf },
        evidenceState: "reported_context",
        sourceRefs,
      });
    }
    const firmographicRows: Array<[string, string | null | undefined, IntelligenceDomain]> = [
      ["Legal name reported by licensed provider", company.firmographic?.legalName, "identity"],
      ["Founded year reported by licensed provider", company.firmographic?.foundedYear, "chronology"],
      ["Headcount range reported by licensed provider", company.firmographic?.headcountRange, "operations"],
      ["Ownership type reported by licensed provider", company.firmographic?.ownership, "governance"],
    ];
    for (const [label, value, domain] of firmographicRows) {
      if (!value?.trim()) continue;
      measurements.push({
        id: `entity_company_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        domain,
        label,
        unit: "text",
        valueType: "text",
        value,
        entityKey: evidence.profile.handle,
        window: { kind: "instant", asOf },
        evidenceState: "reported_context",
        sourceRefs,
      });
    }
  }

  for (const [index, departure] of (evidence.employmentDepartures ?? []).entries()) {
    const sourceRef = `entity:employment-departure:${String(index + 1).padStart(3, "0")}`;
    if (!sources.some((source) => source.id === sourceRef)) continue;
    measurements.push({
      id: `entity_employment_departure:${String(index + 1).padStart(3, "0")}`,
      domain: "career",
      label: `${departure.company} employment record ended`,
      unit: departure.ended && validTime(departure.ended) ? "date" : "text",
      valueType: departure.ended && validTime(departure.ended) ? "date" : "text",
      value: departure.ended && validTime(departure.ended) ? departure.ended : departure.summary,
      entityKey: evidence.profile.handle,
      window: departure.ended && validTime(departure.ended) ? { kind: "historical", asOf: departure.ended } : undefined,
      evidenceState: "reported_context",
      sourceRefs: [sourceRef],
    } as IntelligenceMeasurement);
  }

  return measurements;
}

type EntityQuestionEvidence =
  | "facts"
  | "portfolio"
  | "portfolio_attribution"
  | "fund_scale"
  | "ventures"
  | "relationships"
  | "screen_coverage"
  | "company_enrichment"
  | "none";

interface EntityQuestionDefinition {
  id: string;
  domain: IntelligenceDomain;
  prompt: string;
  materiality: IntelligenceQuestion["materiality"];
  predicates?: BasicFactPredicate[];
  evidence?: EntityQuestionEvidence;
  atomic?: boolean;
}

const COMMON_QUESTIONS: EntityQuestionDefinition[] = [
  { id: "entity.identity.exact_subject", domain: "identity", prompt: "What exact person or organization is being investigated, and which independent artifact binds that identity?", materiality: "critical", predicates: ["official_identity"], atomic: true },
  { id: "entity.legal.screen_coverage", domain: "legal", prompt: "Which exact-name sanctions and legal screens completed, what datasets were searched, and what remained unavailable?", materiality: "critical", evidence: "screen_coverage" },
  { id: "entity.legal.material_events", domain: "legal", prompt: "Which material regulatory, litigation, insolvency, criminal, or disciplinary events are attributable to this exact subject, and what is their current recorded status?", materiality: "critical", predicates: ["legal_regulatory_event"] },
  { id: "entity.reputation.conflicts", domain: "reputation", prompt: "Which conflicts of interest, related-party arrangements, undisclosed incentives, or contradictory public claims are source-backed?", materiality: "important", predicates: ["conflict_of_interest"] },
  { id: "entity.chronology.public_footprint", domain: "chronology", prompt: "What dated chronology connects the subject's public identity, roles, organizations, launches, financing, exits, and material events?", materiality: "important", predicates: ["founded", "launched", "current_role", "prior_role", "funding", "exit"] },
];

const PERSON_QUESTIONS: EntityQuestionDefinition[] = [
  { id: "person.career.current_role", domain: "career", prompt: "What role and organization does this person hold now, and which current source confirms it?", materiality: "critical", predicates: ["current_role"], atomic: true },
  { id: "person.career.history", domain: "career", prompt: "What source-backed employment and operating chronology precedes the current role, including dated departures?", materiality: "important", predicates: ["prior_role"], evidence: "ventures" },
  { id: "person.career.credentials", domain: "career", prompt: "Which education, professional registrations, licenses, and material credentials are independently checkable?", materiality: "context", predicates: ["education"] },
  { id: "person.track_record.ventures", domain: "track_record", prompt: "Which ventures or products did this person actually build, operate, advise, or fund, and what happened to each?", materiality: "critical", predicates: ["founder", "executive", "track_record", "exit"], evidence: "ventures" },
  { id: "person.relationships.claims", domain: "relationships", prompt: "Which claimed employer, founder, adviser, client, or investor relationships are confirmed by the named counterparty?", materiality: "critical", predicates: ["partnership"], evidence: "relationships" },
  { id: "person.reputation.claim_reality", domain: "reputation", prompt: "Where do the person's public claims conflict with direct records, counterparties, dated history, or measurable outcomes?", materiality: "important", predicates: ["track_record", "legal_regulatory_event"] },
];

const INDIVIDUAL_INVESTOR_QUESTIONS: EntityQuestionDefinition[] = [
  { id: "investor.career.current_affiliation", domain: "career", prompt: "Which investment firm or vehicle is this person currently affiliated with, in what role, and from what date?", materiality: "critical", predicates: ["current_role"], atomic: true },
  { id: "investor.portfolio.confirmed", domain: "portfolio", prompt: "Which investments are confirmed by the portfolio company or another identity-bound counterparty source?", materiality: "critical", predicates: ["investor"], evidence: "portfolio" },
  { id: "investor.portfolio.attribution", domain: "portfolio", prompt: "For each investment, was it made personally, through an affiliated fund, or merely discovered as an unattributed lead?", materiality: "critical", evidence: "portfolio_attribution" },
  { id: "investor.track_record.outcomes", domain: "track_record", prompt: "Which realized exits, write-offs, operating contributions, or dated outcomes establish the investor's track record?", materiality: "critical", predicates: ["exit", "track_record"] },
  { id: "investor.fund_scale.context", domain: "fund_scale", prompt: "Which regulatory AUM, fund vehicles, closes, or manager-reported scale claims apply to the affiliated firm rather than to the person's wealth?", materiality: "important", predicates: ["funding"], evidence: "fund_scale" },
  { id: "investor.relationships.counterparties", domain: "relationships", prompt: "Which founders or companies publicly confirm the investor's role, and what contribution do they attribute?", materiality: "important", predicates: ["partnership"], evidence: "relationships" },
];

const INVESTMENT_FIRM_QUESTIONS: EntityQuestionDefinition[] = [
  { id: "fund.identity.legal_manager", domain: "identity", prompt: "Which exact legal adviser, manager, general partner, and branded fund are in scope, and how are they related?", materiality: "critical", predicates: ["legal_entity"] },
  { id: "fund.team.decision_makers", domain: "team", prompt: "Who currently controls investment decisions, ownership, and operations, with current counterparty or registry corroboration?", materiality: "critical", predicates: ["founder", "executive", "control"] },
  { id: "fund.product.strategy", domain: "product", prompt: "What stages, sectors, geographies, check sizes, reserve policy, and founder services does the firm explicitly operate?", materiality: "important", predicates: ["product"] },
  { id: "fund.portfolio.confirmed", domain: "portfolio", prompt: "Which portfolio relationships are confirmed by the portfolio company or another identity-bound counterparty artifact?", materiality: "critical", predicates: ["investor"], evidence: "portfolio" },
  { id: "fund.portfolio.attribution", domain: "portfolio", prompt: "Which claimed investments name this exact firm or vehicle, and which candidates remain unattributed or namesake-prone?", materiality: "critical", evidence: "portfolio_attribution" },
  { id: "fund.scale.vehicles", domain: "fund_scale", prompt: "Which named vehicles, first or final closes, regulatory AUM, and as-of dates establish fund scale without implying dry powder or current deployable capital?", materiality: "critical", predicates: ["funding"], evidence: "fund_scale" },
  { id: "fund.track_record.outcomes", domain: "track_record", prompt: "Which exits, write-offs, follow-on rounds, or other dated portfolio outcomes are directly attributable to this firm?", materiality: "critical", predicates: ["exit", "track_record"] },
  { id: "fund.governance.ownership", domain: "governance", prompt: "What ownership, management, investment-committee, key-person, and succession structure is documented?", materiality: "critical", predicates: ["governance", "control"] },
  { id: "fund.relationships.counterparties", domain: "relationships", prompt: "Which founders, co-investors, or portfolio companies independently confirm the firm's claimed role?", materiality: "important", predicates: ["partnership"], evidence: "relationships" },
  { id: "fund.legal.registration", domain: "legal", prompt: "Which regulatory registrations or exemptions apply to the exact manager, and which jurisdictions or entity records were checked?", materiality: "critical", evidence: "none" },
];

const COMPANY_QUESTIONS: EntityQuestionDefinition[] = [
  { id: "company.identity.legal_entity", domain: "identity", prompt: "Which exact legal entity operates the brand, in which jurisdiction, under what registration number and current registry status?", materiality: "critical", predicates: ["legal_entity"], evidence: "company_enrichment" },
  { id: "company.team.accountability", domain: "team", prompt: "Who founded, currently leads, and practically controls the company, and which current sources confirm each role?", materiality: "critical", predicates: ["founder", "executive", "control"] },
  { id: "company.product.live_reality", domain: "product", prompt: "What products or services are live now, who can use or buy them, and what is merely announced or first-party claimed?", materiality: "critical", predicates: ["product"] },
  { id: "company.operations.traction", domain: "operations", prompt: "Which dated customer, revenue, usage, headcount, delivery, or product-retention evidence establishes operating reality?", materiality: "critical", predicates: ["traction", "track_record"], evidence: "company_enrichment" },
  { id: "company.relationships.customers", domain: "relationships", prompt: "Which customers, clients, suppliers, and strategic partners independently confirm a current relationship?", materiality: "important", predicates: ["partnership"], evidence: "relationships" },
  { id: "company.funding.capital", domain: "funding", prompt: "What equity, debt, grants, or other financing has been raised, on what dates, and which investors or filings corroborate it?", materiality: "important", predicates: ["funding"], evidence: "company_enrichment" },
  { id: "company.governance.ownership", domain: "governance", prompt: "What ownership, directors, beneficial control, board structure, and related-party relationships are documented?", materiality: "critical", predicates: ["governance", "control", "conflict_of_interest"], evidence: "company_enrichment" },
  { id: "company.security.dependencies", domain: "security", prompt: "Which security incidents, audits, critical vendors, custody arrangements, and operational dependencies could impair delivery or customer assets?", materiality: "important", predicates: ["security_incident", "audit", "repository"] },
  { id: "company.legal.registry", domain: "legal", prompt: "Which official company registry, licenses, insolvency records, and enforcement databases were checked for this exact legal entity?", materiality: "critical", evidence: "none" },
];

function questionDefinitions(kind: EntityIntelligenceKind): EntityQuestionDefinition[] {
  const specific = kind === "investment_firm" ? INVESTMENT_FIRM_QUESTIONS
    : kind === "individual_investor" ? INDIVIDUAL_INVESTOR_QUESTIONS
      : kind === "operating_company" ? COMPANY_QUESTIONS
        : PERSON_QUESTIONS;
  return [...COMMON_QUESTIONS, ...specific];
}

function providerRunsForPredicates(
  ledger: readonly BasicFactQuestionLedgerEntry[],
  predicates: readonly BasicFactPredicate[],
): BasicFactQuestionLedgerEntry["providerRuns"] {
  return ledger.filter((entry) => predicates.includes(entry.predicate)).flatMap((entry) => entry.providerRuns);
}

function stateFromRuns(runs: readonly BasicFactQuestionLedgerEntry["providerRuns"][number][]): IntelligenceQuestionState {
  if (!runs.length) return "not_collected";
  if (runs.some((run) => run.state === "succeeded" || run.state === "completed_empty" || run.state === "partial")) return "unresolved";
  if (runs.some((run) => run.state === "failed")) return "unavailable";
  return "not_collected";
}

function extraEvidence(
  definition: EntityQuestionDefinition,
  evidence: Readonly<CollectedEvidence>,
  measurements: readonly IntelligenceMeasurement[],
): { state: IntelligenceQuestionState; basis: string; answerRefs: string[]; sourceRefs: string[] } | null {
  const measurementByPrefix = (prefix: string) => measurements.filter((measurement) => measurement.id.startsWith(prefix));
  if (definition.evidence === "portfolio" || definition.evidence === "portfolio_attribution") {
    const confirmed = measurementByPrefix("entity_portfolio_relationship:");
    const candidates = measurements.filter((measurement) => measurement.id === "entity_unverified_portfolio_candidate_count");
    if (!confirmed.length && !candidates.length) return null;
    return {
      state: confirmed.length ? "partial" : "reported",
      basis: confirmed.length
        ? `${confirmed.length} counterparty-bound relationship${confirmed.length === 1 ? " is" : "s are"} retained, but the saved set is bounded and cannot establish a complete portfolio.`
        : "Discovery returned candidates, but none became a verified investor-to-company relationship.",
      answerRefs: [...confirmed, ...candidates].map((measurement) => measurement.id),
      sourceRefs: unique([...confirmed, ...candidates].flatMap((measurement) => measurement.sourceRefs)),
    };
  }
  if (definition.evidence === "fund_scale") {
    const rows = measurementByPrefix("entity_fund_scale:");
    if (!rows.length) return null;
    return {
      state: "partial",
      basis: `${rows.length} source-bound scale claim${rows.length === 1 ? " is" : "s are"} retained with amount, metric, qualifier, and as-of context. This does not establish current dry powder, deployable capital, or personal wealth.`,
      answerRefs: rows.map((row) => row.id),
      sourceRefs: unique(rows.flatMap((row) => row.sourceRefs)),
    };
  }
  if (definition.evidence === "ventures") {
    const rows = measurementByPrefix("entity_venture:");
    if (!rows.length) return null;
    return {
      state: "partial",
      basis: `${rows.length} verified venture-role record${rows.length === 1 ? " is" : "s are"} retained. A bounded discovered history cannot establish a complete career or every outcome.`,
      answerRefs: rows.map((row) => row.id),
      sourceRefs: unique(rows.flatMap((row) => row.sourceRefs)),
    };
  }
  if (definition.evidence === "relationships") {
    const relationshipArtifacts = evidence.sourceArtifacts
      .map((artifact, index) => ({ artifact, index }))
      .filter(({ artifact }) => Boolean(portfolioRelationshipBinding(artifact, evidence)));
    if (!relationshipArtifacts.length) return null;
    return {
      state: "partial",
      basis: `${relationshipArtifacts.length} relationship artifact${relationshipArtifacts.length === 1 ? " is" : "s are"} confirmed in this bounded scan. That does not establish every claimed relationship or the quality of the relationship.`,
      answerRefs: [],
      sourceRefs: relationshipArtifacts.map(({ index }) => artifactSourceRef(index)),
    };
  }
  if (definition.evidence === "screen_coverage") {
    const screens = evidence.sourceArtifacts
      .map((artifact, index) => ({ artifact, index }))
      .filter(({ artifact }) => artifact.kind === "sanctions_screen" || artifact.kind === "legal_case");
    if (!screens.length) return null;
    const unavailable = screens.filter(({ artifact }) => artifact.coverageState === "unavailable");
    const completed = screens.filter(({ artifact }) => artifact.coverageState !== "unavailable");
    return {
      state: "partial",
      basis: unavailable.length
        ? `${completed.length} saved screen artifact${completed.length === 1 ? " completed" : "s completed"}; ${unavailable.length} remained unavailable. A completed no-match is limited to the named dataset and exact identity searched, not legal clearance.`
        : `${completed.length} saved screen artifact${completed.length === 1 ? " records" : "s record"} bounded search coverage. The frozen evidence bag does not encode a complete required-regime set, so this broader question remains partial. A no-match is limited to the named dataset and exact identity searched, not legal clearance.`,
      answerRefs: [],
      sourceRefs: screens.map(({ index }) => artifactSourceRef(index)),
    };
  }
  if (definition.evidence === "company_enrichment") {
    const rows = measurements.filter((measurement) => measurement.id.startsWith("entity_company_"));
    if (!rows.length) return null;
    return {
      state: "reported",
      basis: "An exact-domain-bound licensed company record supplies attributable context. Licensed fields do not independently establish registry status, solvency, ownership completeness, or operating quality.",
      answerRefs: rows.map((row) => row.id),
      sourceRefs: unique(rows.flatMap((row) => row.sourceRefs)),
    };
  }
  return null;
}

function buildQuestions(
  evidence: Readonly<CollectedEvidence>,
  kind: EntityIntelligenceKind,
  measurements: readonly IntelligenceMeasurement[],
  sources: readonly IntelligenceSourceRef[],
): IntelligenceQuestion[] {
  const ledger = evidence.basicFactQuestionLedger ?? [];
  const directFacts = (evidence.basicFacts ?? []).filter((fact) => directSubjectFact(fact, evidence));
  return questionDefinitions(kind).map((definition) => {
    const facts = directFacts.filter((fact) => (definition.predicates ?? []).includes(fact.predicate));
    const factAnswerRefs = facts.map((fact) => fact.factId);
    const factSourceRefList = unique(facts.flatMap((fact) => factSourceRefs(fact, sources)));
    const hasConflict = facts.some(factIsConflicted);
    const strictFacts = facts.filter((fact) => factEvidenceState(fact, evidence) === "verified");
    const reportedFacts = facts.filter((fact) => factEvidenceState(fact, evidence) === "reported_context");
    const extra = extraEvidence(definition, evidence, measurements);
    if (hasConflict) {
      return {
        id: definition.id,
        domain: definition.domain,
        prompt: definition.prompt,
        materiality: definition.materiality,
        state: "partial",
        basis: "The saved evidence contains both supporting and contradicting artifacts. ARGUS does not resolve the conflict in the derived layer.",
        answerRefs: factAnswerRefs,
        sourceRefs: factSourceRefList,
      };
    }
    if (strictFacts.length) {
      return {
        id: definition.id,
        domain: definition.domain,
        prompt: definition.prompt,
        materiality: definition.materiality,
        state: definition.atomic && strictFacts.length === 1 ? "resolved" : "partial",
        basis: definition.atomic && strictFacts.length === 1
          ? "One strict direct-subject fact answers this atomic question."
          : `${strictFacts.length} strict direct-subject fact${strictFacts.length === 1 ? " answers" : "s answer"} part of this broader decision question; the saved set is not treated as complete.`,
        answerRefs: factAnswerRefs,
        sourceRefs: factSourceRefList,
      };
    }
    if (extra) {
      return {
        id: definition.id,
        domain: definition.domain,
        prompt: definition.prompt,
        materiality: definition.materiality,
        ...extra,
      };
    }
    if (reportedFacts.length) {
      return {
        id: definition.id,
        domain: definition.domain,
        prompt: definition.prompt,
        materiality: definition.materiality,
        state: "reported",
        basis: "The scan retained source-attributed or first-party context, but it did not reach strict decision-grade verification.",
        answerRefs: factAnswerRefs,
        sourceRefs: factSourceRefList,
      };
    }
    const runs = providerRunsForPredicates(ledger, definition.predicates ?? []);
    const state = definition.evidence === "none" ? "not_collected" : stateFromRuns(runs);
    return {
      id: definition.id,
      domain: definition.domain,
      prompt: definition.prompt,
      materiality: definition.materiality,
      state,
      basis: state === "unavailable"
        ? "The applicable saved collection attempts failed. Failure is not converted into a negative answer."
        : state === "unresolved"
          ? "The applicable search completed or returned partial output without establishing a decision-grade answer."
          : "No explicit saved collection record answers this question.",
      answerRefs: [],
      sourceRefs: [],
    };
  });
}

function signal(
  value: Omit<DerivedIntelligenceSignal, "ruleVersion">,
): DerivedIntelligenceSignal {
  return { ...value, ruleVersion: 1 };
}

function buildSignals(
  evidence: Readonly<CollectedEvidence>,
  kind: EntityIntelligenceKind,
  measurements: readonly IntelligenceMeasurement[],
  questions: readonly IntelligenceQuestion[],
  sources: readonly IntelligenceSourceRef[],
): DerivedIntelligenceSignal[] {
  const signals: DerivedIntelligenceSignal[] = [];
  const measurementMap = new Map(measurements.map((measurement) => [measurement.id, measurement]));
  const add = (candidate: DerivedIntelligenceSignal) => signals.push({
    ...candidate,
    measurementRefs: unique(candidate.measurementRefs),
    sourceRefs: unique(candidate.sourceRefs),
    lenses: unique(candidate.lenses),
  });

  for (const question of questions.filter((candidate) =>
    candidate.materiality === "critical"
    && ["unresolved", "unavailable", "not_collected"].includes(candidate.state))) {
    add(signal({
      id: `entity_gap:${question.id}`,
      ruleId: "entity-critical-question-gap",
      kind: "coverage_gap",
      domain: question.domain,
      severity: question.domain === "identity" || question.domain === "legal" ? "high" : "medium",
      polarity: "unknown",
      headline: `${question.domain.replaceAll("_", " ")} decision question remains ${question.state.replaceAll("_", " ")}`,
      finding: question.basis,
      whyItMatters: question.prompt,
      changeCondition: "Recompute when a source-bound answer or a completed applicable collection record is frozen into a new report version.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: [],
      lenses: ALL_LENSES,
    }));
  }

  const strictIdentity = measurements.find((measurement) =>
    measurement.id.startsWith("entity_fact:")
    && measurement.domain === "identity"
    && measurement.evidenceState === "verified");
  if (strictIdentity) {
    add(signal({
      id: "entity_strict_identity",
      ruleId: "entity-strict-identity",
      kind: "observation",
      domain: "identity",
      severity: "medium",
      polarity: "support",
      headline: "The audited subject has a strict source-backed identity",
      finding: `The saved identity fact is "${bounded(String(strictIdentity.value), 180)}". This identifies the subject but does not establish the truth of its track record, solvency, or claims.`,
      whyItMatters: "Every career, portfolio, legal, and counterparty conclusion needs an exact subject before the rest of the evidence can be safely joined.",
      changeCondition: "Recompute if the identity artifact, handle binding, legal entity, or attributed subject changes.",
      evidenceState: "verified",
      measurementRefs: [strictIdentity.id],
      sourceRefs: strictIdentity.sourceRefs,
      lenses: ALL_LENSES,
    }));
  }

  const strictRoles = measurements.filter((measurement) =>
    measurement.id.startsWith("entity_fact:")
    && (measurement.domain === "career" || measurement.domain === "team")
    && measurement.evidenceState === "verified");
  if (strictRoles.length) {
    add(signal({
      id: "entity_current_accountability",
      ruleId: "entity-current-accountability",
      kind: "observation",
      domain: kind === "person" || kind === "individual_investor" ? "career" : "team",
      severity: "medium",
      polarity: "support",
      headline: kind === "person" || kind === "individual_investor"
        ? "Current role evidence is source-backed"
        : "Named operator evidence is source-backed",
      finding: `${strictRoles.length} strict role or operator fact${strictRoles.length === 1 ? " is" : "s are"} retained. This is not a claim that the roster, authority map, or career history is complete.`,
      whyItMatters: "Current accountability is more useful than a biography when evaluating claims, authority, conflicts, and continuity.",
      changeCondition: "Recompute when role dates, counterparties, leadership, or authority records change.",
      evidenceState: "verified",
      measurementRefs: strictRoles.map((measurement) => measurement.id),
      sourceRefs: unique(strictRoles.flatMap((measurement) => measurement.sourceRefs)),
      lenses: ["investment", "counterparty", "general_diligence"],
    }));
  }

  const portfolioCount = measurementMap.get("entity_confirmed_portfolio_relationship_count");
  if (portfolioCount?.valueType === "number") {
    const relationshipRows = measurements.filter((measurement) => measurement.id.startsWith("entity_portfolio_relationship:"));
    add(signal({
      id: "entity_confirmed_portfolio_set",
      ruleId: "entity-confirmed-portfolio-set",
      kind: "observation",
      domain: "portfolio",
      severity: "medium",
      polarity: "support",
      headline: `${portfolioCount.value} portfolio relationship${portfolioCount.value === 1 ? " is" : "s are"} counterparty-bound`,
      finding: `The saved scan confirms ${portfolioCount.value} investor-to-company relationship${portfolioCount.value === 1 ? "" : "s"}. This is a bounded confirmed set, not a complete portfolio, quality ranking, ownership claim, or endorsement.`,
      whyItMatters: "Counterparty-bound deal attribution separates real investment relationships from website logos, namesakes, and model-discovered candidates.",
      changeCondition: "Recompute when another exact investor-to-company relationship is verified, contradicted, or removed.",
      evidenceState: "bounded",
      measurementRefs: [portfolioCount.id, ...relationshipRows.map((row) => row.id)],
      sourceRefs: unique([portfolioCount, ...relationshipRows].flatMap((row) => row.sourceRefs)),
      lenses: ALL_LENSES,
    }));
  }

  const portfolioLeads = measurementMap.get("entity_unverified_portfolio_candidate_count");
  if (portfolioLeads?.valueType === "number") {
    add(signal({
      id: "entity_unverified_portfolio_candidates",
      ruleId: "entity-unverified-portfolio-candidates",
      kind: "coverage_gap",
      domain: "portfolio",
      severity: portfolioLeads.value >= 4 ? "medium" : "low",
      polarity: "unknown",
      headline: `${portfolioLeads.value} portfolio candidate${portfolioLeads.value === 1 ? " remains" : "s remain"} unverified`,
      finding: "The discovery output retained candidate projects and inspectable URLs, but deterministic verification did not establish the investor relationship. Candidates remain outside the score and graph.",
      whyItMatters: "A hidden candidate set makes an incomplete scan look empty; publishing it as confirmed would create cross-subject contamination.",
      changeCondition: "Recompute when a fetched counterparty or identity-bound primary source explicitly attributes the investment to the exact subject or affiliated vehicle.",
      evidenceState: "reported_context",
      measurementRefs: [portfolioLeads.id],
      sourceRefs: portfolioLeads.sourceRefs,
      lenses: ALL_LENSES,
    }));
  }

  const fundScaleRows = measurements.filter((measurement) => measurement.id.startsWith("entity_fund_scale:"));
  if (fundScaleRows.length) {
    add(signal({
      id: "entity_fund_scale_context",
      ruleId: "entity-fund-scale-context",
      kind: "observation",
      domain: "fund_scale",
      severity: "context",
      polarity: "neutral",
      headline: "Fund scale claims retain metric and time context",
      finding: `${fundScaleRows.length} scale claim${fundScaleRows.length === 1 ? " is" : "s are"} retained. AUM, a named vehicle, or a close amount is not personal wealth, current dry powder, deployable capital, or proof of investment quality.`,
      whyItMatters: "Fund-size language is routinely overread. Metric, vehicle, qualifier, source basis, and as-of date must remain attached.",
      changeCondition: "Recompute when a newer regulatory filing, fund close, or manager disclosure supersedes a saved claim.",
      evidenceState: fundScaleRows.every((row) => row.evidenceState === "verified") ? "verified" : "reported_context",
      measurementRefs: fundScaleRows.map((row) => row.id),
      sourceRefs: unique(fundScaleRows.flatMap((row) => row.sourceRefs)),
      lenses: ALL_LENSES,
    }));
  }

  const companyRows = measurements.filter((measurement) => measurement.id.startsWith("entity_company_"));
  if (companyRows.length) {
    add(signal({
      id: "entity_licensed_company_context",
      ruleId: "entity-licensed-company-context",
      kind: "observation",
      domain: "operations",
      severity: "context",
      polarity: "neutral",
      headline: "Identity-bound licensed company context is preserved",
      finding: `${companyRows.length} licensed-provider measurement${companyRows.length === 1 ? " is" : "s are"} retained with the exact official-domain binding receipt. Provider firmographics, management, and financing remain attributed context rather than ARGUS verification.`,
      whyItMatters: "The rows can fill important diligence gaps without letting a provider enum or namesake company become the audited subject's truth.",
      changeCondition: "Recompute when the official domain, selected company record, provider capture, or independently corroborated company facts change.",
      evidenceState: "reported_context",
      measurementRefs: companyRows.map((row) => row.id),
      sourceRefs: unique(companyRows.flatMap((row) => row.sourceRefs)),
      lenses: ["investment", "counterparty", "general_diligence"],
    }));
  }

  const departures = measurements.filter((measurement) => measurement.id.startsWith("entity_employment_departure:"));
  if (departures.length) {
    add(signal({
      id: "entity_employment_departures",
      ruleId: "entity-employment-departures",
      kind: "observation",
      domain: "career",
      severity: "medium",
      polarity: "mixed",
      headline: "Saved employment records contain dated role endings",
      finding: `${departures.length} provider-frozen employment record${departures.length === 1 ? " ends" : "s end"} a role. An end date does not establish why the person left, whether the departure was adverse, or their present relationship to the organization.`,
      whyItMatters: "Role currency can materially change accountability, key-person, and track-record analysis while remaining distinct from speculation about motive.",
      changeCondition: "Recompute when a newer employment, company, or person-controlled primary record changes the dated role state.",
      evidenceState: "reported_context",
      measurementRefs: departures.map((row) => row.id),
      sourceRefs: unique(departures.flatMap((row) => row.sourceRefs)),
      lenses: ["investment", "counterparty", "general_diligence"],
    }));
  }

  for (const [index, fact] of (evidence.basicFacts ?? []).entries()) {
    if (!directSubjectFact(fact, evidence) || !factIsConflicted(fact)) continue;
    const sourceRefs = factSourceRefs(fact, sources);
    if (!sourceRefs.length) continue;
    add(signal({
      id: `entity_fact_conflict:${fact.factId}`,
      ruleId: "entity-basic-fact-conflict",
      kind: "observation",
      domain: predicateDomain(fact.predicate, kind),
      severity: fact.critical ? "high" : "medium",
      polarity: "mixed",
      headline: `Saved sources conflict on a ${fact.predicate.replaceAll("_", " ")} claim`,
      finding: `The frozen claim "${bounded(fact.value, 180)}" has supporting and contradicting artifacts. ARGUS does not choose a side in this derived layer.`,
      whyItMatters: "Contradictory evidence must remain visible before a reader relies on the claim.",
      changeCondition: "Recompute when a controlling primary record resolves the conflict or one artifact is shown to target a different subject.",
      evidenceState: "bounded",
      measurementRefs: measurements.some((measurement) => measurement.id === `entity_fact:${fact.factId}`) ? [`entity_fact:${fact.factId}`] : [],
      sourceRefs,
      lenses: ALL_LENSES,
    }));
    void index;
  }

  for (const [index, finding] of evidence.findings.entries()) {
    const sourceRef = `entity:finding:${String(index + 1).padStart(3, "0")}`;
    if (
      finding.polarity >= 0
      || !sources.some((source) => source.id === sourceRef)
      || finding.verification_status.toLowerCase() !== "verified"
    ) continue;
    add(signal({
      id: `entity_verified_adverse:${String(index + 1).padStart(3, "0")}`,
      ruleId: "entity-verified-direct-adverse",
      kind: "observation",
      domain: finding.finding_type.includes("legal") || finding.finding_type.includes("sanction") ? "legal" : "reputation",
      severity: finding.independent_source_count >= 2 ? "high" : "medium",
      polarity: "risk",
      headline: `Verified adverse record: ${finding.finding_type.replaceAll("_", " ")}`,
      finding: bounded(finding.claim),
      whyItMatters: "This is a verified direct-subject finding from the governing evidence bag. A decision lens cannot omit or reinterpret it.",
      changeCondition: "Recompute only when the underlying artifact, exact-subject attribution, or recorded disposition changes.",
      evidenceState: "verified",
      measurementRefs: [],
      sourceRefs: [sourceRef],
      lenses: ALL_LENSES,
    }));
  }

  const strictFacts = (evidence.basicFacts ?? []).filter((fact) =>
    directSubjectFact(fact, evidence) && factEvidenceState(fact, evidence) === "verified");
  const strictSourceRefs = unique(strictFacts.flatMap((fact) => factSourceRefs(fact, sources)));
  const strictSources = strictSourceRefs.map((ref) => sources.find((source) => source.id === ref)).filter((source): source is IntelligenceSourceRef => Boolean(source));
  if (strictSources.length >= 2 && strictSources.every((source) => source.sourceClass === "official_subject" || source.sourceClass === "first_party_profile")) {
    add(signal({
      id: "entity_first_party_evidence_concentration",
      ruleId: "entity-first-party-evidence-concentration",
      kind: "screening_heuristic",
      domain: "reputation",
      severity: "medium",
      polarity: "unknown",
      headline: "Strict fact support is concentrated in subject-controlled sources",
      finding: `${strictSources.length} retained strict-source artifacts are first-party. This does not make the claims false, but independent or counterparty corroboration is absent from the strict set.`,
      whyItMatters: "A polished official site can accurately describe a subject or repeat unsupported claims. Decision-critical relationships and outcomes deserve independent binding.",
      changeCondition: "Recompute when a public registry, named counterparty, or independent primary artifact corroborates a decision-critical claim.",
      evidenceState: "bounded",
      measurementRefs: strictFacts.map((fact) => `entity_fact:${fact.factId}`).filter((id) => measurementMap.has(id)),
      sourceRefs: strictSourceRefs,
      lenses: ALL_LENSES,
    }));
  }

  const completedScreens = evidence.sourceArtifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) =>
      (artifact.kind === "sanctions_screen" || artifact.kind === "legal_case")
      && artifact.coverageState !== "unavailable"
      && (artifact.match === "screened_clear" || artifact.match === "no_match"));
  if (completedScreens.length) {
    add(signal({
      id: "entity_completed_bounded_screens",
      ruleId: "entity-completed-bounded-screens",
      kind: "observation",
      domain: "legal",
      severity: "context",
      polarity: "neutral",
      headline: `${completedScreens.length} named legal or sanctions screen${completedScreens.length === 1 ? " completed" : "s completed"}`,
      finding: "Each no-match is limited to the named dataset, exact searched identity, and saved capture. It is not a universal no-adverse finding, legal clearance, or proof that unsearched aliases are clean.",
      whyItMatters: "A completed bounded negative is useful only when its scope stays attached and unavailable constituents remain visible.",
      changeCondition: "Recompute when the resolved identity, aliases, dataset version, or screen result changes.",
      evidenceState: "bounded",
      measurementRefs: [],
      sourceRefs: completedScreens.map(({ index }) => artifactSourceRef(index)),
      lenses: ["investment", "counterparty", "general_diligence"],
    }));
  }

  return signals.sort((left, right) => {
    const rank = { high: 0, medium: 1, low: 2, context: 3 } as const;
    return rank[left.severity] - rank[right.severity] || left.id.localeCompare(right.id);
  });
}

function lensDefinitions(kind: EntityIntelligenceKind): IntelligenceLensDefinition[] {
  const investment = kind === "investment_firm" || kind === "individual_investor"
    ? ["identity", "portfolio", "track_record", "fund_scale", "relationships", "reputation", "legal", "career", "team"] as IntelligenceDomain[]
    : kind === "operating_company"
      ? ["identity", "operations", "product", "track_record", "team", "funding", "governance", "legal", "reputation", "security"] as IntelligenceDomain[]
      : ["identity", "career", "track_record", "relationships", "reputation", "legal", "chronology"] as IntelligenceDomain[];
  const alpha = kind === "investment_firm" || kind === "individual_investor"
    ? ["portfolio", "track_record", "relationships", "chronology", "reputation", "fund_scale"] as IntelligenceDomain[]
    : kind === "operating_company"
      ? ["operations", "product", "funding", "relationships", "chronology", "reputation"] as IntelligenceDomain[]
      : ["track_record", "relationships", "chronology", "reputation", "career"] as IntelligenceDomain[];
  return [
    {
      id: "investment",
      label: "Investment decision",
      question: kind === "investment_firm" || kind === "individual_investor"
        ? "Does the verified portfolio, decision-making record, fund context, and accountability support relying on this investor?"
        : kind === "operating_company"
          ? "What operating, capital, team, legal, and governance evidence could change an investment or partnership decision?"
          : "What identity, career, outcome, conflict, and relationship evidence could change a decision to back or rely on this person?",
      domainPriority: investment,
    },
    {
      id: "alpha_research",
      label: "Alpha research",
      question: "Which dated actions, relationships, outcomes, narrative gaps, and unresolved claims deserve deeper timing or network research?",
      domainPriority: alpha,
    },
    {
      id: "counterparty",
      label: "Counterparty diligence",
      question: "Can the exact subject, accountable operators, legal exposure, authority, conflicts, and claimed relationships be independently verified?",
      domainPriority: ["identity", "legal", "reputation", "relationships", "control", "governance", "team", "career", "operations"],
    },
    {
      id: "general_diligence",
      label: "General diligence",
      question: "What does the frozen evidence establish, report, contradict, or leave uncollected about this exact subject?",
      domainPriority: ENTITY_DOMAIN_ORDER,
    },
  ];
}

function buildCaptureWindow(sources: readonly IntelligenceSourceRef[]): IntelligenceSpineSnapshot["captureWindow"] {
  const dated = sources
    .flatMap((source) => validTime(source.capturedAt) ? [{ value: source.capturedAt, time: Date.parse(source.capturedAt) }] : [])
    .sort((left, right) => left.time - right.time || left.value.localeCompare(right.value));
  return { earliest: dated[0]?.value ?? null, latest: dated.at(-1)?.value ?? null };
}

function buildForms(
  evidence: Readonly<CollectedEvidence>,
  kind: EntityIntelligenceKind,
  sources: readonly IntelligenceSourceRef[],
): SubjectFormAssessment[] {
  const identityFact = (evidence.basicFacts ?? []).find((fact) =>
    directSubjectFact(fact, evidence)
    && fact.predicate === "official_identity"
    && factEvidenceState(fact, evidence) === "verified");
  const strictRefs = identityFact ? factSourceRefs(identityFact, sources) : [];
  const fallbackRefs = sources.some((source) => source.id === "entity:profile") ? ["entity:profile"] : [];
  const sourceRefs = strictRefs.length ? strictRefs : fallbackRefs;
  if (!sourceRefs.length) return [];
  const form: IntelligenceSubjectForm = kind;
  return [{
    form,
    evidenceState: strictRefs.length ? "verified" : "reported_context",
    sourceRefs,
  }];
}

/**
 * Builds the non-project counterpart to the PROJECT Intelligence Spine.
 * It derives only from the frozen evidence bag and makes no provider/model call.
 */
export function buildEntityPointInTimeIntelligence(
  evidence: Readonly<CollectedEvidence>,
): IntelligenceSpineSnapshot | null {
  const kind = entityKind(evidence);
  if (!kind) return null;
  const sources = buildSources(evidence);
  const measurements = buildMeasurements(evidence, kind, sources);
  const questions = buildQuestions(evidence, kind, measurements, sources);
  const signals = buildSignals(evidence, kind, measurements, questions, sources);
  const definitions = lensDefinitions(kind);
  const snapshot: IntelligenceSpineSnapshot = {
    schemaVersion: 1,
    rulesetVersion: "argus-entity-point-in-time-v1",
    mode: "point_in_time",
    scoringImpact: "none",
    subject: {
      key: evidence.profile.handle,
      label: evidence.profile.resolved_name?.trim() || evidence.profile.display_name.trim() || evidence.profile.handle,
      entityKind: kind,
      forms: buildForms(evidence, kind, sources),
      archetypes: { state: "insufficient", primary: null, matches: [] },
    },
    captureWindow: buildCaptureWindow(sources),
    sources,
    measurements,
    questions,
    coverage: [],
    signals,
    lenses: [],
  };
  const sanitized = sanitizeIntelligenceSnapshot(snapshot, evidence, {
    domains: ENTITY_DOMAIN_ORDER,
    lensDefinitions: definitions,
  });
  const roleViews = buildEntityScorecards(sanitized, evidence.roles);
  return {
    ...sanitized,
    entityScorecards: roleViews.scorecards,
    entityLedger: roleViews.ledger,
  };
}
