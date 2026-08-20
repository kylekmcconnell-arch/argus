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

function contentKeys(source: EvidenceLike): string[] {
  return [
    ...(source.contentHashes ?? []),
    ...(source.contentHash ? [source.contentHash] : []),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
}

const COUNTRY_CODE_SECOND_LEVEL = new Set([
  "ac", "co", "com", "edu", "gov", "net", "org",
]);

const MULTI_TENANT_SUFFIXES = [
  "blogspot.com",
  "gitbook.io",
  "github.io",
  "netlify.app",
  "notion.site",
  "pages.dev",
  "readthedocs.io",
  "vercel.app",
  "web.app",
  "wordpress.com",
];

/**
 * Collapse pages and controlled subdomains to one publisher origin. Multi-
 * tenant hosts retain the tenant label so unrelated projects never become one
 * source merely because they share a hosting platform.
 */
function publisherDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  for (const suffix of MULTI_TENANT_SUFFIXES) {
    if (host === suffix) return host;
    if (host.endsWith("." + suffix)) {
      const keep = suffix.split(".").length + 1;
      return labels.slice(-keep).join(".");
    }
  }
  if (labels.length <= 2) return host;
  const topLevel = labels.at(-1) ?? "";
  const secondLevel = labels.at(-2) ?? "";
  const keep = topLevel.length === 2 && COUNTRY_CODE_SECOND_LEVEL.has(secondLevel) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function publisherKey(source: EvidenceLike): string {
  const host = canonicalHost(source.sourceUrl);
  if (host) return "host:" + publisherDomain(host);
  const provider = normalizedProvider(source.provider);
  if (provider) return "provider:" + provider;
  return "ref:" + (source.id ?? "unknown");
}

function citationKey(source: EvidenceLike): string {
  if (source.id) return "id:" + source.id;
  const url = typeof source.sourceUrl === "string" ? source.sourceUrl.trim().toLowerCase() : "";
  if (url) return "url:" + url;
  const hashes = contentKeys(source);
  const provider = normalizedProvider(source.provider);
  if (hashes.length || provider) return `provider:${provider}|content:${hashes.join(",")}`;
  return "unknown";
}

function uniqueById<T extends EvidenceLike>(sources: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const source of sources) {
    const key = citationKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function conservativeOriginRole(roles: readonly EvidenceOriginRole[]): EvidenceOriginRole {
  const values = new Set(roles);
  // If identical material appears on the subject's own channel and elsewhere,
  // it is still one first-party origin, not independent corroboration.
  if (values.has("first_party")) return "first_party";
  if (values.has("collection_receipt")) return "collection_receipt";
  if (values.has("data_aggregator")) return "data_aggregator";
  if (values.has("unknown")) return "unknown";
  // Direct observation is claimed only when every record in the collapsed
  // origin is itself a direct observation.
  if (values.size === 1 && values.has("direct_observation")) return "direct_observation";
  if (values.has("authoritative_record")) return "authoritative_record";
  if (values.has("counterparty")) return "counterparty";
  return "independent_reporting";
}

function groupedOriginRoles(sources: readonly EvidenceLike[]): EvidenceOriginRole[] {
  if (sources.length === 0) return [];

  const parent = sources.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const publisherOwners = new Map<string, number>();
  const contentOwners = new Map<string, number>();
  sources.forEach((source, index) => {
    const publisher = publisherKey(source);
    const publisherOwner = publisherOwners.get(publisher);
    if (publisherOwner == null) publisherOwners.set(publisher, index);
    else union(index, publisherOwner);

    for (const content of contentKeys(source)) {
      const contentOwner = contentOwners.get(content);
      if (contentOwner == null) contentOwners.set(content, index);
      else union(index, contentOwner);
    }
  });

  const grouped = new Map<number, EvidenceOriginRole[]>();
  sources.forEach((source, index) => {
    const root = find(index);
    const roles = grouped.get(root) ?? [];
    roles.push(evidenceOriginRole(source));
    grouped.set(root, roles);
  });
  return [...grouped.values()].map(conservativeOriginRole);
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
  const originRoles = groupedOriginRoles(sources);
  const roles = [...new Set(originRoles)];
  const independentOriginCount = originRoles.filter((role) => INDEPENDENT_ROLES.has(role)).length;
  const originCount = originRoles.length;
  const firstPartyOnly = originCount > 0 && roles.every((role) => role === "first_party");
  const direct = roles.includes("direct_observation");
  const externalAggregators = originRoles.filter((role) => role === "data_aggregator").length;
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
