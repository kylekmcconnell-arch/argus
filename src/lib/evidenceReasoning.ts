import type {
  DerivedIntelligenceSignal,
  IntelligenceEvidenceState,
  IntelligenceSourceClass,
  IntelligenceSourceRef,
  IntelligenceSpineSnapshot,
} from "../intelligence/types";
import type { AxisEvidenceRecord } from "../data/evidence";

export type EvidenceOriginRole =
  | "first_party"
  | "counterparty"
  | "authoritative_record"
  | "direct_observation"
  | "independent_reporting"
  | "data_aggregator"
  | "collection_receipt"
  | "unknown";

export type EvidencePostureKind =
  | "direct_observation"
  | "independently_corroborated"
  | "externally_supported"
  | "multi_provider_context"
  | "first_party_only"
  | "bounded_coverage"
  | "single_source_context"
  | "unanchored";

export interface EvidencePosture {
  kind: EvidencePostureKind;
  label: string;
  sourceRefCount: number;
  originCount: number;
  independentOriginCount: number;
  roles: EvidenceOriginRole[];
  firstPartyOnly: boolean;
}

interface EvidenceLike {
  id?: string;
  provider?: string;
  sourceClass?: IntelligenceSourceClass;
  evidenceState?: IntelligenceEvidenceState;
  verification?: AxisEvidenceRecord["verification"];
  sourceUrl?: string;
  contentHashes?: string[];
  contentHash?: string;
}

const SOURCE_CLASS_ROLE: Record<IntelligenceSourceClass, EvidenceOriginRole> = {
  canonical_market_registry: "data_aggregator",
  protocol_index: "data_aggregator",
  onchain_data_provider: "data_aggregator",
  vesting_data_provider: "data_aggregator",
  official_subject: "first_party",
  official_counterparty: "counterparty",
  public_registry: "authoritative_record",
  independent_publication: "independent_reporting",
  other_public: "independent_reporting",
  bounded_collection_record: "collection_receipt",
  direct_chain_rpc: "direct_observation",
  licensed_enrichment: "data_aggregator",
  first_party_profile: "first_party",
};

const INDEPENDENT_ROLES = new Set<EvidenceOriginRole>([
  "counterparty",
  "authoritative_record",
  "direct_observation",
  "independent_reporting",
]);

function normalizedProvider(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "";
}

function providerRole(provider: string): EvidenceOriginRole {
  if (!provider) return "unknown";
  if (/(?:^|-)official(?:-|$)|first-party|subject-profile|project-site|project-x/.test(provider)) return "first_party";
  if (/counterparty|auditor|partner-site|portfolio-company/.test(provider)) return "counterparty";
  if (/sec|courtlistener|opensanctions|ofac|rdap|registry|companies-house/.test(provider)) return "authoritative_record";
  if (/direct-chain|chain-rpc|evm-rpc|solana-rpc/.test(provider)) return "direct_observation";
  if (/independent|publication|journal|news|press/.test(provider)) return "independent_reporting";
  if (/coingecko|defillama|dexscreener|geckoterminal|goplus|cryptorank|peopledata|peopledatalabs|github|monid|twitterapi/.test(provider)) return "data_aggregator";
  if (/argus|check|cache|collector|bounded/.test(provider)) return "collection_receipt";
  return "unknown";
}

export function evidenceOriginRole(source: EvidenceLike): EvidenceOriginRole {
  if (source.sourceClass) return SOURCE_CLASS_ROLE[source.sourceClass];
  return providerRole(normalizedProvider(source.provider));
}

function canonicalHost(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function originKey(source: EvidenceLike): string {
  const hashes = [
    ...(source.contentHashes ?? []),
    ...(source.contentHash ? [source.contentHash] : []),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
  // Identical saved content is one origin even when several URLs or provider
  // rows repeat it. This is the minimum safe defense against syndicated copy.
  if (hashes.length) return "content:" + hashes.join(",");
  const provider = normalizedProvider(source.provider);
  if (provider) return "provider:" + provider;
  const host = canonicalHost(source.sourceUrl);
  if (host) return "host:" + host;
  return "ref:" + (source.id ?? "unknown");
}

function uniqueById<T extends EvidenceLike>(sources: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const source of sources) {
    const key = source.id || originKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function postureLabel(kind: EvidencePostureKind, independent: number, origins: number): string {
  if (kind === "direct_observation") return "Directly observed";
  if (kind === "independently_corroborated") return independent + " independent origins";
  if (kind === "externally_supported") return "Externally supported";
  if (kind === "multi_provider_context") return origins + " external data origins";
  if (kind === "first_party_only") return "First-party evidence only";
  if (kind === "bounded_coverage") return "Bounded collection only";
  if (kind === "single_source_context") return "Single-source context";
  return "No complete source lineage";
}

export function summarizeEvidencePosture(
  input: readonly EvidenceLike[],
  evidenceState?: IntelligenceEvidenceState,
): EvidencePosture {
  const sources = uniqueById(input);
  const originRows = new Map<string, EvidenceOriginRole>();
  for (const source of sources) {
    const key = originKey(source);
    const role = evidenceOriginRole(source);
    const prior = originRows.get(key);
    if (!prior || prior === "unknown" || prior === "collection_receipt") originRows.set(key, role);
  }
  const roles = [...new Set(originRows.values())];
  const independentOriginCount = [...originRows.values()].filter((role) => INDEPENDENT_ROLES.has(role)).length;
  const originCount = originRows.size;
  const firstPartyOnly = originCount > 0 && roles.every((role) => role === "first_party");
  const direct = roles.includes("direct_observation");
  const externalAggregators = [...originRows.values()].filter((role) => role === "data_aggregator").length;
  const boundedOnly = originCount > 0 && roles.every((role) => role === "collection_receipt");
  const reported = evidenceState === "reported_context"
    || sources.every((source) => source.verification === "reported");

  const kind: EvidencePostureKind = originCount === 0
    ? "unanchored"
    : direct && !reported
      ? "direct_observation"
      : independentOriginCount >= 2 && !reported
        ? "independently_corroborated"
        : independentOriginCount === 1 && !reported
          ? "externally_supported"
          : firstPartyOnly
            ? "first_party_only"
            : boundedOnly || evidenceState === "bounded"
              ? "bounded_coverage"
              : externalAggregators >= 2 && !reported
                ? "multi_provider_context"
                : "single_source_context";

  return {
    kind,
    label: postureLabel(kind, independentOriginCount, originCount),
    sourceRefCount: sources.length,
    originCount,
    independentOriginCount,
    roles,
    firstPartyOnly,
  };
}

export function sourcesForSignal(
  snapshot: IntelligenceSpineSnapshot,
  signal: DerivedIntelligenceSignal,
): IntelligenceSourceRef[] {
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));
  const measurementIndex = new Map(snapshot.measurements.map((measurement) => [measurement.id, measurement]));
  const sourceIds = new Set(signal.sourceRefs);
  for (const measurementRef of signal.measurementRefs) {
    for (const sourceRef of measurementIndex.get(measurementRef)?.sourceRefs ?? []) sourceIds.add(sourceRef);
  }
  return [...sourceIds]
    .map((sourceRef) => sourceIndex.get(sourceRef))
    .filter((source): source is IntelligenceSourceRef => Boolean(source));
}

export function evidencePostureForSignal(
  snapshot: IntelligenceSpineSnapshot,
  signal: DerivedIntelligenceSignal,
): EvidencePosture {
  return summarizeEvidencePosture(sourcesForSignal(snapshot, signal), signal.evidenceState);
}

export function evidencePostureForAxisArtifacts(
  artifacts: readonly AxisEvidenceRecord[],
): EvidencePosture {
  const state: IntelligenceEvidenceState = artifacts.some((artifact) => artifact.verification === "observed")
    ? "measured"
    : artifacts.every((artifact) => artifact.verification === "reported")
      ? "reported_context"
      : artifacts.length
        ? "verified"
        : "bounded";
  return summarizeEvidencePosture(artifacts, state);
}

export const EVIDENCE_POSTURE_RANK: Record<EvidencePostureKind, number> = {
  direct_observation: 0,
  independently_corroborated: 1,
  externally_supported: 2,
  multi_provider_context: 3,
  first_party_only: 4,
  single_source_context: 5,
  bounded_coverage: 6,
  unanchored: 7,
};
