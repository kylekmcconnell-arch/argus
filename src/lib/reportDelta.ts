import type { BasicFact } from "../data/evidence";
import type { Dossier } from "../data/dossier";
import type { Investigation } from "./investigation";
import type { TokenDossier } from "../token/audit";
import type { DecisionDiscovery } from "./reportInsights";

export type MaterialDeltaCategory =
  | "contract_control"
  | "liquidity_protection"
  | "holder_concentration"
  | "verified_fact";

export interface MaterialReportDelta {
  schemaVersion: 1;
  id: string;
  category: MaterialDeltaCategory;
  headline: string;
  consequence: string;
  reversalCondition: string;
  evidenceHref: `#${string}`;
  previous: {
    reportVersionId: string;
    version: number;
    capturedAt: string | null;
    value: string;
  };
  current: { value: string };
}

export interface PriorReportSnapshot {
  reportVersionId: string;
  version: number;
  capturedAt: string | null;
  payload: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function tokenPayload(kind: "token" | "investigation", payload: unknown): TokenDossier | null {
  const root = record(payload);
  const candidate = kind === "investigation" ? root.token : payload;
  const token = record(candidate);
  return typeof token.address === "string" && token.address ? candidate as TokenDossier : null;
}

function basicFacts(kind: "person" | "token" | "investigation", payload: unknown): BasicFact[] {
  if (kind === "token") return [];
  const root = record(payload);
  const subject = kind === "investigation" ? record(root.projectAccount) : root;
  return Array.isArray(subject.basicFacts) ? subject.basicFacts as BasicFact[] : [];
}

function eligibleFact(fact: BasicFact): boolean {
  return fact.status === "verified"
    && fact.artifact_verified === true
    && fact.attributionScope === "direct_subject"
    && !fact.providerProjection
    && fact.sources.some((source) => source.artifactVerified === true && /^https?:\/\//i.test(source.url));
}

function makeDelta(
  prior: PriorReportSnapshot,
  fields: Omit<MaterialReportDelta, "schemaVersion" | "previous" | "current">,
  previousValue: string,
  currentValue: string,
): MaterialReportDelta {
  return {
    schemaVersion: 1,
    ...fields,
    previous: {
      reportVersionId: prior.reportVersionId,
      version: prior.version,
      capturedAt: prior.capturedAt,
      value: previousValue,
    },
    current: { value: currentValue },
  };
}

function contractDelta(
  kind: "token" | "investigation",
  previousPayload: unknown,
  currentPayload: unknown,
  prior: PriorReportSnapshot,
): MaterialReportDelta | null {
  const previous = tokenPayload(kind, previousPayload);
  const current = tokenPayload(kind, currentPayload);
  if (!previous || !current) return null;
  if (previous.safety.contractPropertiesAssessed !== true || current.safety.contractPropertiesAssessed !== true) return null;
  const anchor = kind === "investigation" ? "#investigation-evidence" : "#token-methodology";
  const fields: Array<{
    key: "ownerRenounced" | "mintable" | "freezable";
    label: string;
    safer: boolean;
    consequence: string;
    reversal: string;
  }> = [
    {
      key: "ownerRenounced",
      label: "owner control",
      safer: true,
      consequence: "The contract's recorded authority changed, which can materially change who may alter the token after launch.",
      reversal: "A fresh contract-authority receipt showing the prior control state would reverse this change.",
    },
    {
      key: "mintable",
      label: "mint authority",
      safer: false,
      consequence: "The ability to create additional supply changed, altering dilution and control risk.",
      reversal: "A fresh chain receipt showing the mint authority did not change would reverse this change.",
    },
    {
      key: "freezable",
      label: "freeze authority",
      safer: false,
      consequence: "The recorded ability to freeze balances changed, altering holder-control risk.",
      reversal: "A fresh chain receipt showing the freeze authority did not change would reverse this change.",
    },
  ];
  for (const field of fields) {
    if (previous.safety[field.key] === current.safety[field.key]) continue;
    const before = previous.safety[field.key] ? "present" : "absent";
    const after = current.safety[field.key] ? "present" : "absent";
    const improved = current.safety[field.key] === field.safer;
    return makeDelta(prior, {
      id: `delta-contract-${field.key}`,
      category: "contract_control",
      headline: `${field.label[0].toUpperCase()}${field.label.slice(1)} changed since the last scan`,
      consequence: `${field.consequence} ARGUS recorded it as ${before} before and ${after} now${improved ? ", reducing this specific control risk" : ", increasing this specific control risk"}.`,
      reversalCondition: field.reversal,
      evidenceHref: anchor,
    }, before, after);
  }
  return null;
}

function liquidityDelta(
  kind: "token" | "investigation",
  previousPayload: unknown,
  currentPayload: unknown,
  prior: PriorReportSnapshot,
): MaterialReportDelta | null {
  const previous = tokenPayload(kind, previousPayload);
  const current = tokenPayload(kind, currentPayload);
  if (!previous || !current || previous.safety.lpAssessed !== true || current.safety.lpAssessed !== true) return null;
  const before = (finite(previous.safety.lpLockedPct) ?? 0) + (finite(previous.safety.lpBurnedPct) ?? 0);
  const after = (finite(current.safety.lpLockedPct) ?? 0) + (finite(current.safety.lpBurnedPct) ?? 0);
  const crossedMaterialBoundary = (before < 50 && after >= 50) || (before >= 50 && after < 50);
  if (!crossedMaterialBoundary && Math.abs(after - before) < 25) return null;
  return makeDelta(prior, {
    id: "delta-liquidity-protection",
    category: "liquidity_protection",
    headline: "Liquidity protection changed materially since the last scan",
    consequence: `Locked or burned liquidity moved from ${before.toFixed(0)}% to ${after.toFixed(0)}%. That changes how much of the trading pool can be withdrawn by an unlocked holder.`,
    reversalCondition: "Comparable LP-holder receipts showing the same protected share in both scans would reverse this change.",
    evidenceHref: kind === "investigation" ? "#investigation-visuals" : "#token-market",
  }, `${before.toFixed(1)}% protected`, `${after.toFixed(1)}% protected`);
}

function holderDelta(
  kind: "token" | "investigation",
  previousPayload: unknown,
  currentPayload: unknown,
  prior: PriorReportSnapshot,
): MaterialReportDelta | null {
  const previous = tokenPayload(kind, previousPayload);
  const current = tokenPayload(kind, currentPayload);
  if (!previous || !current || previous.holdersAssessed !== true || current.holdersAssessed !== true) return null;
  const before = finite(previous.safety.topHolderPct);
  const after = finite(current.safety.topHolderPct);
  if (before === null || after === null || Math.abs(after - before) < 10) return null;
  return makeDelta(prior, {
    id: "delta-holder-concentration",
    category: "holder_concentration",
    headline: "Largest-holder concentration changed materially",
    consequence: `The largest assessed wallet moved from ${before.toFixed(1)}% to ${after.toFixed(1)}% of supply. That changes the amount one wallet may be able to sell or influence.`,
    reversalCondition: "Comparable holder receipts showing the same wallet share in both scans would reverse this change.",
    evidenceHref: kind === "investigation" ? "#investigation-evidence" : "#composition",
  }, `${before.toFixed(2)}%`, `${after.toFixed(2)}%`);
}

function verifiedFactDelta(
  kind: "person" | "token" | "investigation",
  previousPayload: unknown,
  currentPayload: unknown,
  prior: PriorReportSnapshot,
): MaterialReportDelta | null {
  const previous = basicFacts(kind, previousPayload).filter(eligibleFact);
  const current = basicFacts(kind, currentPayload).filter(eligibleFact);
  const priorByPredicate = new Map(previous.map((fact) => [fact.predicate, fact]));
  for (const fact of current) {
    const old = priorByPredicate.get(fact.predicate);
    if (!old || old.normalizedValue === fact.normalizedValue) continue;
    const label = String(fact.predicate).replaceAll("_", " ");
    return makeDelta(prior, {
      id: `delta-fact-${fact.predicate}`,
      category: "verified_fact",
      headline: `A verified ${label} record changed since the last scan`,
      consequence: `The prior report recorded “${old.value}”; this scan records “${fact.value}”. ARGUS treats the two saved source-backed records as a material change, not as a score movement.`,
      reversalCondition: "Opening both cited records and confirming they describe the same unchanged fact would reverse this change.",
      evidenceHref: kind === "investigation" ? "#investigation-basic-facts" : "#basic-facts",
    }, old.value, fact.value);
  }
  return null;
}

/** Highest-priority material change between two comparable immutable reports. */
export function buildMaterialReportDelta(
  kind: "person" | "token" | "investigation",
  prior: PriorReportSnapshot,
  currentPayload: unknown,
): MaterialReportDelta | null {
  if (!prior.reportVersionId || prior.version < 1 || !prior.payload || !currentPayload) return null;
  if (kind === "token" || kind === "investigation") {
    return contractDelta(kind, prior.payload, currentPayload, prior)
      ?? liquidityDelta(kind, prior.payload, currentPayload, prior)
      ?? holderDelta(kind, prior.payload, currentPayload, prior)
      ?? verifiedFactDelta(kind, prior.payload, currentPayload, prior);
  }
  return verifiedFactDelta(kind, prior.payload, currentPayload, prior);
}

export function materialDeltaDiscovery(
  delta: MaterialReportDelta | null | undefined,
  currentReportVersionId?: string | null,
): DecisionDiscovery | null {
  if (!delta) return null;
  return {
    id: delta.id,
    headline: delta.headline,
    consequence: delta.consequence,
    reversalCondition: delta.reversalCondition,
    evidenceHref: delta.evidenceHref,
    receipts: [
      {
        label: `Open previous report v${delta.previous.version}`,
        href: `/?version=${encodeURIComponent(delta.previous.reportVersionId)}`,
      },
      ...(currentReportVersionId ? [{
        label: "Open current saved report",
        href: `/?version=${encodeURIComponent(currentReportVersionId)}`,
      }] : []),
    ],
  };
}

export type ReportWithMaterialDelta = (Dossier | TokenDossier | Investigation) & {
  reportDelta?: MaterialReportDelta;
};
