import type {
  DerivedIntelligenceSignal,
  IntelligenceEvidenceState,
  IntelligenceMeasurement,
  IntelligenceQuestionState,
  IntelligenceSignalPolarity,
  IntelligenceSignalSeverity,
} from "../intelligence/types";

const INTERNAL_MEASUREMENT_PREFIXES = ["project_strength_"];

const INTERNAL_MEASUREMENT_IDS = new Set([
  "evm_rpc_chain_identity_state",
  "evm_control_target_state",
  "evm_standard_proxy_state",
  "official_site_response_state",
  "provider_profile_photo_classification",
  "provider_profile_photo_real_person_opinion",
  "trust_graph_screen_status",
]);

const MEASUREMENT_TITLES: Record<string, string> = {
  circulating_supply: "Circulating supply",
  total_supply: "Total supply",
  max_supply: "Maximum supply",
  circulating_share_of_total_supply_pct: "Share of supply in circulation",
  holder_count: "Token holders reported by the provider",
  provider_named_creator_or_authority_pct: "Creator or authority wallet share",
  goplus_fired_contract_flag_count: "Contract or deployer warnings",
  top_holder_pct: "Largest assessed wallet share",
  assessed_wallet_count: "Wallets included in the concentration check",
  assessed_wallet_share_floor_pct: "Minimum share held by assessed wallets",
  top_10_holder_pct: "Share held by the top 10 assessed wallets",
};

const EVIDENCE_LABELS: Record<IntelligenceEvidenceState, string> = {
  verified: "Verified",
  measured: "Measured",
  bounded: "Limited sample",
  reported_context: "Source reported",
};

const QUESTION_STATE_LABELS: Record<IntelligenceQuestionState, string> = {
  resolved: "Answered",
  reported: "Source reported",
  partial: "Partly answered",
  unresolved: "Not established",
  unavailable: "Check unavailable",
  not_collected: "Not checked",
  not_applicable: "Not applicable",
};

const SEVERITY_LABELS: Record<IntelligenceSignalSeverity, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Lower priority",
  context: "Context",
};

const POLARITY_LABELS: Record<IntelligenceSignalPolarity, string> = {
  risk: "Risk",
  support: "Support",
  mixed: "Mixed evidence",
  neutral: "Context",
  unknown: "Needs review",
};

export function publicMeasurementTitle(measurement: IntelligenceMeasurement): string {
  return MEASUREMENT_TITLES[measurement.id] ?? measurement.label;
}
export function isPublicMeasurement(measurement: IntelligenceMeasurement): boolean {
  return !INTERNAL_MEASUREMENT_IDS.has(measurement.id)
    && !INTERNAL_MEASUREMENT_PREFIXES.some((prefix) => measurement.id.startsWith(prefix));
}

export function publicEvidenceLabel(state: IntelligenceEvidenceState): string {
  return EVIDENCE_LABELS[state];
}

export function publicQuestionStateLabel(state: IntelligenceQuestionState): string {
  return QUESTION_STATE_LABELS[state];
}

export interface PublicSignalCopy {
  status: string;
  priority: string;
  headline: string;
  finding: string;
  whyItMatters: string;
  tone: string;
}

export function publicSignalCopy(signal: DerivedIntelligenceSignal): PublicSignalCopy {
  if (signal.ruleId === "intelligence-integrity-gate") {
    const eventCount = signal.finding.match(/recorded\s+(\d+)\s+fail-closed/i)?.[1];
    return {
      status: "Report issue",
      priority: "High priority",
      headline: "Some conclusions were withheld because their sources could not be traced completely",
      finding: eventCount
        ? `${eventCount} report item${eventCount === "1" ? "" : "s"} failed the source-link check. ARGUS excluded those items instead of treating them as evidence.`
        : "Some report items failed the source-link check. ARGUS excluded them instead of treating them as evidence.",
      whyItMatters: "A conclusion should not influence a decision unless its sources and calculations can be checked.",
      tone: "tint-avoid",
    };
  }

  return {
    status: POLARITY_LABELS[signal.polarity],
    priority: SEVERITY_LABELS[signal.severity],
    headline: signal.headline,
    finding: signal.finding,
    whyItMatters: signal.whyItMatters,
    tone: signal.polarity === "risk"
      ? "tint-avoid"
      : signal.polarity === "support"
        ? "tint-pass"
        : signal.polarity === "mixed" || signal.polarity === "unknown"
          ? "tint-caution"
          : "tint-neutral",
  };
}
