import type { BasicFact, CollectedEvidence } from "../data/evidence";
import { normalizeHandle } from "../engine/audit";
import type {
  ArchetypeAssessment,
  ProductArchetype,
  ProductArchetypeMatch,
  SubjectFormAssessment,
} from "./types";

interface IndexedSupportingFactSource {
  source: BasicFact["sources"][number];
  originalIndex: number;
}

export function factSourceHasEligibleArtifact(source: BasicFact["sources"][number]): boolean {
  if (source.artifactVerified !== true) return false;
  const hasPublicUrl = /^https?:\/\/[^\s]+$/i.test(source.url ?? "");
  const hasFrozenHash = /^[a-f0-9]{64}$/i.test(source.contentHash ?? "");
  return hasPublicUrl || hasFrozenHash;
}

/**
 * Returns every supporting source in a deterministic order while retaining
 * the source's exact position in the frozen evidence bag.
 */
export function supportingFactSources(fact: BasicFact): IndexedSupportingFactSource[] {
  return fact.sources
    .map((source, originalIndex) => ({ source, originalIndex }))
    .filter(({ source }) => source.relation === "supports")
    .sort((left, right) =>
      left.source.url.localeCompare(right.source.url)
      || (left.source.capturedAt ?? "").localeCompare(right.source.capturedAt ?? "")
      || left.source.provider.localeCompare(right.source.provider)
      || left.source.contentHash.localeCompare(right.source.contentHash)
      || left.originalIndex - right.originalIndex,
    );
}

export function factSupportSourceId(factId: string, sortedIndex: number): string {
  return `fact:${factId}:support:${String(sortedIndex + 1).padStart(2, "0")}`;
}

export function factSupportSourceRefs(fact: BasicFact, verifiedOnly = false): string[] {
  return supportingFactSources(fact)
    .map(({ source }, sortedIndex) => ({ source, id: factSupportSourceId(fact.factId, sortedIndex) }))
    .filter(({ source }) => !verifiedOnly || factSourceHasEligibleArtifact(source))
    .map(({ id }) => id);
}

export function contradictingFactSources(fact: BasicFact): IndexedSupportingFactSource[] {
  return fact.sources
    .map((source, originalIndex) => ({ source, originalIndex }))
    .filter(({ source }) => source.relation === "contradicts")
    .sort((left, right) =>
      left.source.url.localeCompare(right.source.url)
      || (left.source.capturedAt ?? "").localeCompare(right.source.capturedAt ?? "")
      || left.source.provider.localeCompare(right.source.provider)
      || left.source.contentHash.localeCompare(right.source.contentHash)
      || left.originalIndex - right.originalIndex,
    );
}

export function factContradictionSourceId(factId: string, sortedIndex: number): string {
  return `fact:${factId}:contradiction:${String(sortedIndex + 1).padStart(2, "0")}`;
}

export function factContradictionSourceRefs(fact: BasicFact, verifiedOnly = false): string[] {
  return contradictingFactSources(fact)
    .map(({ source }, sortedIndex) => ({ source, id: factContradictionSourceId(fact.factId, sortedIndex) }))
    .filter(({ source }) => !verifiedOnly || factSourceHasEligibleArtifact(source))
    .map(({ id }) => id);
}

interface ArchetypeRule {
  archetype: Exclude<ProductArchetype, "generic_protocol">;
  patterns: readonly RegExp[];
}

const ARCHETYPE_RULES: readonly ArchetypeRule[] = [
  {
    archetype: "dex",
    patterns: [/\bdecentralized exchange\b/i, /\bdex\b/i, /\bautomated market maker\b/i, /\bamm\b/i],
  },
  {
    archetype: "lending",
    patterns: [/\blending protocol\b/i, /\bborrowing protocol\b/i, /\bmoney market\b/i],
  },
  {
    archetype: "stablecoin",
    patterns: [
      /^\s*(?:an?\s+)?(?:[a-z0-9-]+\s+){0,3}stablecoin\b(?!\s+(?:lending|exchange|trading|payments?|bridge|dex)\b)/i,
      /\b(?:is|issues?|mints?)\s+(?:an?\s+)?(?:[a-z0-9-]+\s+){0,4}stablecoin\b/i,
      /\bstablecoin\s+(?:issuer|asset|token|protocol)\b/i,
    ],
  },
  {
    archetype: "bridge",
    patterns: [/\bcross[ -]chain bridge\b/i, /\btoken bridge\b/i, /\bbridge protocol\b/i],
  },
  { archetype: "layer_1", patterns: [/\blayer[ -]?1\b/i, /\bl1 blockchain\b/i] },
  { archetype: "layer_2", patterns: [/\blayer[ -]?2\b/i, /\bl2 network\b/i, /\brollup\b/i] },
  { archetype: "staking", patterns: [/\brestaking\b/i, /\bliquid staking\b/i, /\bstaking protocol\b/i] },
  {
    archetype: "derivatives",
    patterns: [/\bderivatives?\b/i, /\bperpetuals?\b/i, /\boptions protocol\b/i, /\bfutures exchange\b/i],
  },
  {
    archetype: "exchange_or_custody",
    patterns: [
      /\bcentralized exchange\b/i,
      /\bdigital asset exchange\b/i,
      /\bcrypto(?:currency)? exchange\b/i,
      /\bcustod(?:y|ian)\b/i,
    ],
  },
  {
    archetype: "oracle_or_data",
    patterns: [/\boracle network\b/i, /\bdata availability\b/i, /\bblockchain indexer\b/i, /\brpc provider\b/i],
  },
  { archetype: "payments", patterns: [/\bpayments? protocol\b/i, /\bpayments? network\b/i, /\bpayment processor\b/i] },
  { archetype: "launchpad", patterns: [/\blaunchpad\b/i, /\btoken launch platform\b/i] },
  { archetype: "gaming_or_nft", patterns: [/\bweb3 gaming\b/i, /\bblockchain game\b/i, /\bnft marketplace\b/i] },
] as const;

/**
 * True only for a strict fetched fact whose supporting passage is preserved.
 * Provider projections and relaxed recall facts cannot route an archetype.
 */
export function isDirectSubjectFact(fact: BasicFact): boolean {
  return fact.attributionScope === undefined || fact.attributionScope === "direct_subject";
}

/** Exact identity binding for facts admitted to a subject-level derived read. */
export function factTargetsAuditedSubject(fact: BasicFact, auditedHandle: string): boolean {
  if (!isDirectSubjectFact(fact)) return false;
  try {
    return normalizeHandle(fact.subjectKey) === normalizeHandle(auditedHandle);
  } catch {
    return false;
  }
}

export function isStrictSourceBackedFact(fact: BasicFact): boolean {
  return (fact.status === "verified" || fact.status === "corroborated")
    && isDirectSubjectFact(fact)
    && fact.evidence_origin === "deterministic"
    && fact.artifact_verified === true
    && fact.floorEligible !== false
    && fact.providerProjection !== true
    && !fact.sources.some((source) => source.relation === "contradicts")
    && fact.sources.some((source) => source.relation === "supports" && factSourceHasEligibleArtifact(source));
}

const RELATIONAL_CONTEXT = /\b(?:for|with|using|via|through|integrates?|supports?|depends\s+on|secured\s+by|powered\s+by)\b/i;
const IDENTITY_VERB = /\b(?:is|are|operates?|runs?|provides?|offers?|builds?|issues?|serves\s+as)\b/gi;
const IDENTITY_CLAUSE_BOUNDARY = /^(?:\s*$|\s*[,.;:()]|\s+\b(?:and|for|with|using|via|through|that|which|where|built|deployed|operating|running|serving|supporting|secured|powered)\b)/i;
const PRODUCT_HEAD_CONTINUATION = /^\s+(?:(?:protocol|network|platform|exchange|marketplace|asset|token|coin|blockchain|application|app|system|scaling\s+solution|trading\s+venue)\b\s*){1,2}/i;

function hasProductHeadBoundary(suffix: string): boolean {
  if (IDENTITY_CLAUSE_BOUNDARY.test(suffix)) return true;
  const continuation = suffix.match(PRODUCT_HEAD_CONTINUATION);
  return continuation ? IDENTITY_CLAUSE_BOUNDARY.test(suffix.slice(continuation[0].length)) : false;
}

/**
 * A product word routes only when it appears in the subject-defining clause.
 * This prevents a DEX "for stablecoin trading" from becoming a stablecoin,
 * or a rollup "using data availability" from becoming a data provider.
 */
function matchesSubjectIdentity(value: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (const match of value.matchAll(matcher)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const suffix = value.slice(index + match[0].length);
    // The archetype phrase must finish the asserted product head. In
    // "exchange data analytics" the exchange is an object, not the subject.
    if (!hasProductHeadBoundary(suffix)) continue;
    const prefix = value.slice(0, index);
    if (index <= 24 && !RELATIONAL_CONTEXT.test(prefix)) return true;

    const verbs = [...prefix.matchAll(IDENTITY_VERB)];
    const verb = verbs.at(-1);
    if (!verb || verb.index == null) continue;
    const between = prefix.slice(verb.index + verb[0].length);
    if (between.length <= 80 && !RELATIONAL_CONTEXT.test(between)) return true;
  }
  return false;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function classifyProductFacts(facts: readonly BasicFact[], auditedHandle: string): ProductArchetypeMatch[] {
  const matches = new Map<ProductArchetype, ProductArchetypeMatch>();

  for (const fact of facts) {
    if (
      fact.predicate !== "product"
      || !factTargetsAuditedSubject(fact, auditedHandle)
      || !isStrictSourceBackedFact(fact)
    ) continue;

    for (const rule of ARCHETYPE_RULES) {
      if (!rule.patterns.some((pattern) => matchesSubjectIdentity(fact.value, pattern))) continue;

      const sourceRefs = factSupportSourceRefs(fact, true);
      const existing = matches.get(rule.archetype);
      if (existing) {
        existing.sourceRefs = uniqueSorted([...existing.sourceRefs, ...sourceRefs]);
      } else {
        matches.set(rule.archetype, {
          archetype: rule.archetype,
          confidence: "strict_source_backed",
          sourceRefs,
          matchedText: fact.value,
        });
      }
    }
  }

  return [...matches.values()].sort((left, right) => left.archetype.localeCompare(right.archetype));
}

export interface ProjectClassification {
  forms: SubjectFormAssessment[];
  archetypes: ArchetypeAssessment;
}

/** Classifies only from frozen structural records and strict product facts. */
export function classifyProjectArchetypes(evidence: Readonly<CollectedEvidence>): ProjectClassification {
  const forms: SubjectFormAssessment[] = [];

  if (evidence.projectToken) {
    forms.push({
      form: "token",
      evidenceState: "verified",
      sourceRefs: ["snapshot:project-token"],
    });
  }
  if (evidence.protocolTvl) {
    forms.push({
      form: "protocol",
      evidenceState: typeof evidence.protocolTvl.tvlUsd === "number" && evidence.protocolTvl.tvlUsd > 0
        ? "measured"
        : "reported_context",
      sourceRefs: ["snapshot:protocol-tvl"],
    });
  }

  const strictLegalFacts = (evidence.basicFacts ?? []).filter(
    (fact) => fact.predicate === "legal_entity"
      && factTargetsAuditedSubject(fact, evidence.profile.handle)
      && isStrictSourceBackedFact(fact),
  );
  if (evidence.companyEnrichment?.identityMatch === "official_domain" || strictLegalFacts.length > 0) {
    forms.push({
      form: "company",
      evidenceState: strictLegalFacts.length > 0 ? "verified" : "reported_context",
      sourceRefs: uniqueSorted([
        ...(evidence.companyEnrichment?.identityMatch === "official_domain" ? ["snapshot:company-enrichment"] : []),
        ...strictLegalFacts.flatMap((fact) => factSupportSourceRefs(fact, true)),
      ]),
    });
  }

  forms.sort((left, right) => left.form.localeCompare(right.form));
  const matches = classifyProductFacts(evidence.basicFacts ?? [], evidence.profile.handle);
  if (matches.length === 1) {
    return { forms, archetypes: { state: "resolved", primary: matches[0].archetype, matches } };
  }
  if (matches.length > 1) {
    return { forms, archetypes: { state: "hybrid", primary: null, matches } };
  }
  if (evidence.protocolTvl) {
    return {
      forms,
      archetypes: {
        state: "generic",
        primary: "generic_protocol",
        matches: [{
          archetype: "generic_protocol",
          confidence: "structural_generic",
          sourceRefs: ["snapshot:protocol-tvl"],
        }],
      },
    };
  }

  return { forms, archetypes: { state: "insufficient", primary: null, matches: [] } };
}
