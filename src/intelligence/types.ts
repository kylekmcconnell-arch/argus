/**
 * Immutable, score-neutral intelligence derived from one frozen ARGUS scan.
 *
 * This contract deliberately separates observations, arithmetic, screening
 * heuristics, and coverage gaps. None of these records changes an ARGUS score
 * in schema version 1.
 */

export type IntelligenceDomain =
  | "identity"
  | "career"
  | "product"
  | "team"
  | "operations"
  | "track_record"
  | "portfolio"
  | "fund_scale"
  | "relationships"
  | "reputation"
  | "market"
  | "liquidity"
  | "supply"
  | "economics"
  | "funding"
  | "treasury"
  | "governance"
  | "control"
  | "security"
  | "legal"
  | "chronology";

export type IntelligenceEvidenceState =
  | "verified"
  | "measured"
  | "bounded"
  | "reported_context";

export type IntelligenceSourceClass =
  | "canonical_market_registry"
  | "protocol_index"
  | "onchain_data_provider"
  | "vesting_data_provider"
  | "official_subject"
  | "official_counterparty"
  | "public_registry"
  | "independent_publication"
  | "other_public"
  | "bounded_collection_record"
  | "direct_chain_rpc"
  | "licensed_enrichment"
  | "first_party_profile";

export interface IntelligenceSourceRef {
  /** Stable within the immutable dossier, for example snapshot:protocol-tvl. */
  id: string;
  inputPath: string;
  provider: string;
  title: string;
  sourceClass: IntelligenceSourceClass;
  evidenceState: IntelligenceEvidenceState;
  /** Exact role this source plays for a BasicFact when applicable. */
  relation?: "supports" | "contradicts";
  sourceUrl?: string;
  capturedAt?: string;
  /** Timestamp declared by the provider for its underlying data, kept separate from ARGUS observation time. */
  providerUpdatedAt?: string;
  publishedAt?: string;
  factId?: string;
  /** Bounded saved passage when the exact proof would otherwise be lost. */
  excerpt?: string;
  contentHashes?: string[];
}

export type IntelligenceMeasurementUnit =
  | "usd"
  | "percent"
  | "ratio"
  | "count"
  | "days"
  | "months"
  | "date"
  | "text";

export interface IntelligenceMeasurementWindow {
  kind: "instant" | "trailing" | "scheduled" | "historical";
  start?: string;
  end?: string;
  days?: number;
  asOf?: string;
}

export interface IntelligenceMeasurementBase {
  id: string;
  domain: IntelligenceDomain;
  label: string;
  unit: IntelligenceMeasurementUnit;
  entityKey: string;
  chain?: string;
  denominatorMeasurementId?: string;
  window?: IntelligenceMeasurementWindow;
  evidenceState: IntelligenceEvidenceState;
  sourceRefs: string[];
}

export interface NumberIntelligenceMeasurement extends IntelligenceMeasurementBase {
  valueType: "number";
  value: number;
}

export interface DateIntelligenceMeasurement extends IntelligenceMeasurementBase {
  valueType: "date";
  value: string;
  unit: "date";
}

export interface TextIntelligenceMeasurement extends IntelligenceMeasurementBase {
  valueType: "text";
  value: string;
  unit: "text";
}

export type IntelligenceMeasurement =
  | NumberIntelligenceMeasurement
  | DateIntelligenceMeasurement
  | TextIntelligenceMeasurement;

export type IntelligenceQuestionState =
  | "resolved"
  | "reported"
  | "partial"
  | "unresolved"
  | "unavailable"
  | "not_collected"
  | "not_applicable";

export interface IntelligenceQuestion {
  id: string;
  domain: IntelligenceDomain;
  prompt: string;
  materiality: "critical" | "important" | "context";
  state: IntelligenceQuestionState;
  basis: string;
  answerRefs: string[];
  sourceRefs: string[];
}

export type IntelligenceCoverageState =
  | "measured"
  | "reported"
  | "partial"
  | "unresolved"
  | "unavailable"
  | "not_collected"
  | "not_applicable";

export interface IntelligenceDomainCoverage {
  domain: IntelligenceDomain;
  state: IntelligenceCoverageState;
  measurementIds: string[];
  questionIds: string[];
  detail: string;
}

export type IntelligenceSubjectForm =
  | "token"
  | "protocol"
  | "company"
  | "person"
  | "individual_investor"
  | "investment_firm"
  | "operating_company"
  | "agency";

/** Backward-compatible name retained for older imports and frozen v1 reports. */
export type ProjectSubjectForm = IntelligenceSubjectForm;

export interface SubjectFormAssessment {
  form: IntelligenceSubjectForm;
  evidenceState: IntelligenceEvidenceState;
  sourceRefs: string[];
}

export type ProductArchetype =
  | "dex"
  | "lending"
  | "stablecoin"
  | "bridge"
  | "layer_1"
  | "layer_2"
  | "staking"
  | "derivatives"
  | "exchange_or_custody"
  | "oracle_or_data"
  | "payments"
  | "launchpad"
  | "gaming_or_nft"
  | "generic_protocol";

export interface ProductArchetypeMatch {
  archetype: ProductArchetype;
  confidence: "strict_source_backed" | "structural_generic";
  sourceRefs: string[];
  matchedText?: string;
}

export interface ArchetypeAssessment {
  state: "resolved" | "hybrid" | "generic" | "insufficient";
  primary: ProductArchetype | null;
  matches: ProductArchetypeMatch[];
}

export type IntelligenceSignalKind =
  | "observation"
  | "arithmetic"
  | "screening_heuristic"
  | "coverage_gap";

export type IntelligenceSignalSeverity = "high" | "medium" | "low" | "context";
export type IntelligenceSignalPolarity = "risk" | "support" | "mixed" | "neutral" | "unknown";

export type DecisionLensId =
  | "investment"
  | "alpha_research"
  | "counterparty"
  | "general_diligence";

export interface IntelligenceArithmeticReceipt {
  expression: string;
  value: number;
  unit: "percent" | "ratio" | "days";
  inputMeasurementIds: string[];
  /** Exact capture basis used to permit a cross-source comparison. */
  temporal?: {
    state: "aligned" | "historical_amount_to_current_scale";
    maxInputSkewHours: number;
    inputAsOf: Array<{
      measurementId: string;
      asOf: string;
    }>;
  };
}

export interface DerivedIntelligenceSignal {
  id: string;
  ruleId: string;
  ruleVersion: 1;
  kind: IntelligenceSignalKind;
  domain: IntelligenceDomain;
  severity: IntelligenceSignalSeverity;
  polarity: IntelligenceSignalPolarity;
  headline: string;
  finding: string;
  whyItMatters: string;
  changeCondition: string;
  evidenceState: IntelligenceEvidenceState;
  measurementRefs: string[];
  sourceRefs: string[];
  arithmetic?: IntelligenceArithmeticReceipt[];
  lenses: DecisionLensId[];
}

export interface DecisionLens {
  id: DecisionLensId;
  label: string;
  question: string;
  /** Frozen order used by every renderer for this lens. */
  domainPriority: IntelligenceDomain[];
  signalIds: string[];
  unresolvedQuestionIds: string[];
  changeConditions: string[];
}

export interface IntelligenceSpineSnapshot {
  schemaVersion: 1;
  rulesetVersion: "argus-point-in-time-v1" | "argus-entity-point-in-time-v1";
  mode: "point_in_time";
  scoringImpact: "none";
  subject: {
    key: string;
    label: string;
    entityKind?: "project" | "person" | "individual_investor" | "investment_firm" | "operating_company";
    forms: SubjectFormAssessment[];
    archetypes: ArchetypeAssessment;
  };
  captureWindow: {
    earliest: string | null;
    latest: string | null;
  };
  sources: IntelligenceSourceRef[];
  measurements: IntelligenceMeasurement[];
  questions: IntelligenceQuestion[];
  coverage: IntelligenceDomainCoverage[];
  signals: DerivedIntelligenceSignal[];
  lenses: DecisionLens[];
  /** Score-neutral role views derived from this frozen entity spine. */
  entityScorecards?: import("./entityScorecards").EntityScorecard[];
  /** Typed rows used by entity reports and ARGUS Eye from the same lineage. */
  entityLedger?: import("./entityScorecards").EntityLedgerRow[];
}
