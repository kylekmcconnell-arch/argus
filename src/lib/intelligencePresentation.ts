import type {
  DerivedIntelligenceSignal,
  IntelligenceEvidenceState,
  IntelligenceMeasurement,
  IntelligenceQuestionState,
  IntelligenceSignalPolarity,
  IntelligenceSignalSeverity,
} from "../intelligence/types";
import { plainLanguageSummary } from "./plainLanguage";

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

const PUBLIC_SIGNAL_HEADLINES: Record<string, string> = {
  "strict-product-description": "Direct sources describe what the product does",
  "goplus-fired-contract-flag": "GoPlus reported a contract or deployer warning",
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
  changeCondition: string;
  tone: string;
}

const STRENGTH_LABELS: Record<string, string> = {
  none: "not enough evidence to assess",
  assessed_null: "checked, but no reliable supporting evidence was confirmed",
  adverse: "evidence raises concerns",
  emerging: "early or limited evidence",
  solid: "strong evidence",
  exceptional: "very strong evidence",
};

function sentenceCase(value: string): string {
  const cleaned = value.trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}

function publicDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function strengthBandSummary(value: string): string | null {
  const matches = [...value.matchAll(/(?:^|;\s*)([^:;]+):\s*(none|assessed_null|adverse|emerging|solid|exceptional)\s*\((-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\)/gi)];
  if (matches.length === 0) return null;
  return matches.map((match) => {
    const area = sentenceCase(plainLanguageSummary(match[1] ?? "Area"));
    const tier = STRENGTH_LABELS[(match[2] ?? "").toLowerCase()] ?? "evidence reviewed";
    const minimum = Number(match[3]);
    const maximum = Number(match[4]);
    const range = minimum === maximum ? `${minimum} points` : `${minimum}–${maximum} points`;
    return `${area}: ${tier} (${range}).`;
  }).join(" ");
}

/**
 * Reader-facing copy for saved intelligence. This deliberately runs at the
 * presentation boundary so older immutable reports benefit without rewriting
 * their stored evidence or rule receipts.
 */
export function publicIntelligenceText(value: string): string {
  const bands = strengthBandSummary(value);
  if (bands) return bands;
  return plainLanguageSummary(value)
    .replace(/\bscorer[- ]packet\b/gi, "saved evidence review")
    .replace(/\baxis-level evidence ranges\b/gi, "evidence strength in each area")
    .replace(/\bassessed[-_ ]null\b/gi, "checked, but not confirmed")
    .replace(/\blineage contract\b/gi, "source-link check")
    .replace(/\blineage\b/gi, "source trail")
    .replace(/\bfail-closed integrity events?\b/gi, "items withheld by the source-link check")
    .replace(/\bdeterministic\b/gi, "rule-based")
    .replace(/\bfrozen\b/gi, "saved")
    .replace(/\bbounded subset\b/gi, "limited set of evidence")
    .replace(/\bbounded\b/gi, "limited")
    .replace(/\bpublic-surface boundar(?:y|ies)\b/gi, "online record dates")
    .replace(/\blaunch boundar(?:y|ies)\b/gi, "online record dates")
    .replace(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\b/g, (date) => publicDate(date))
    .replace(/\s+/g, " ")
    .trim();
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
      changeCondition: "Run the report again after the affected sources are linked correctly.",
      tone: "tint-avoid",
    };
  }

  if (signal.ruleId === "project-strength-band-summary") {
    return {
      status: "Context",
      priority: "Context",
      headline: "How strong the evidence is in each area",
      finding: strengthBandSummary(signal.finding)
        ?? publicIntelligenceText(signal.finding),
      whyItMatters: "This shows which parts of the report rest on stronger evidence and which parts still need confirmation. It does not add points or make an investment recommendation.",
      changeCondition: "Run the report again when new reliable evidence becomes available.",
      tone: "tint-neutral",
    };
  }

  if (signal.ruleId === "launch-boundary-gap") {
    const dates = [...signal.finding.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g)].map((match) => match[0]);
    const months = signal.finding.match(/(?:a|about)\s+(\d[\d,]*)-month gap/i)?.[1];
    const finding = dates.length >= 2
      ? `The earliest account or domain record we found dates to ${publicDate(dates[0] ?? "")}. The other appeared on ${publicDate(dates[1] ?? "")}${months ? `, about ${months} months later` : ""}. This may reflect a later website or account launch, a rebrand, or earlier community activity. It does not prove when the project began or indicate wrongdoing.`
      : publicIntelligenceText(signal.finding);
    return {
      status: "Context",
      priority: "Context",
      headline: "The project's online footprint appeared in two stages",
      finding,
      whyItMatters: "The date gap is a useful prompt to compare the project's website, accounts, and stated launch history.",
      changeCondition: "Run the report again if an older official account, website record, or launch announcement is found.",
      tone: "tint-neutral",
    };
  }

  return {
    status: POLARITY_LABELS[signal.polarity],
    priority: SEVERITY_LABELS[signal.severity],
    headline: PUBLIC_SIGNAL_HEADLINES[signal.ruleId]
      ?? publicIntelligenceText(signal.headline),
    finding: publicIntelligenceText(signal.finding),
    whyItMatters: publicIntelligenceText(signal.whyItMatters),
    changeCondition: publicIntelligenceText(signal.changeCondition),
    tone: signal.polarity === "risk"
      ? "tint-avoid"
      : signal.polarity === "support"
        ? "tint-pass"
        : signal.polarity === "mixed" || signal.polarity === "unknown"
          ? "tint-caution"
          : "tint-neutral",
  };
}
