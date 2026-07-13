import {
  decisionCriticalChecks,
  summarizeChecks,
  type CheckStatus,
  type ScanCheck,
} from "../src/lib/scanChecklist";
import type { CheckObservation, PersonCheckId } from "./adapters/types";

export type ProviderRunState = "executed" | "partial" | "failed" | "unavailable" | "skipped";

export interface ProviderRun {
  id: string;
  label: string;
  state: ProviderRunState;
  observedAt: string;
  detail?: string;
}

export interface ProviderSnapshot {
  capturedAt: string;
  runs: ProviderRun[];
}

interface CheckDefinition {
  id: PersonCheckId;
  label: string;
  defaultNote: string;
  role?: "FOUNDER" | "KOL" | "INVESTOR" | "PROJECT";
  /** Roles for which this row answers a decision question, not just provider coverage. */
  criticalFor?: readonly string[];
  requiresResolvedRealName?: boolean;
  requiresPersonRole?: boolean;
}

export interface PersonCheckScope {
  resolvedRealName?: boolean;
}

const CHECKS: readonly CheckDefinition[] = [
  {
    id: "identity-resolution",
    label: "Identity resolution",
    defaultNote: "no completed server-side identity resolution was recorded",
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"],
  },
  { id: "profile-photo-authenticity", label: "Profile-photo integrity", defaultNote: "server collector did not run a profile-photo integrity screen", requiresPersonRole: true },
  { id: "code-footprint-github", label: "Code footprint (GitHub)", defaultNote: "no completed GitHub resolution was recorded" },
  { id: "identity-continuity", label: "Identity continuity", defaultNote: "no completed handle-history result was recorded" },
  {
    id: "affiliations-associates",
    label: "Affiliations & associates",
    defaultNote: "no corroborated affiliation collection outcome was recorded",
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"],
  },
  { id: "promoted-token-performance", label: "Promoted-token performance", defaultNote: "no completed promoted-token market result was recorded", role: "KOL", criticalFor: ["KOL"] },
  { id: "project-token-identity", label: "Canonical project token", defaultNote: "no official token identity was bound to this project account", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-product-substance", label: "Product and website substance", defaultNote: "no frozen first-party product or website outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-team-identity", label: "Project team identity", defaultNote: "no first-party team identity outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-backing-partners", label: "Backing and partners", defaultNote: "no source-backed project backing or partnership outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-traction-liveness", label: "Traction and liveness", defaultNote: "no frozen product, market, or activity-liveness outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-transparency", label: "Transparency and disclosures", defaultNote: "no frozen token, audit, docs, or disclosure outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "founder-identity-authority", label: "Verified identity and current authority", defaultNote: "the founder's identity and current decision-making role were not both verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-company-relationships", label: "Companies, co-founders, and current roles", defaultNote: "the founder's material company and co-founder relationships were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-track-record", label: "Track record and outcomes", defaultNote: "prior roles, exits, and venture outcomes were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-control-conflicts", label: "Control and conflicts", defaultNote: "governance control, ownership, and material conflicts were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-legal-regulatory", label: "Legal and regulatory history", defaultNote: "material legal or regulatory events and their attribution were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-asset-distinction", label: "Related assets and security/token distinction", defaultNote: "related public securities, native tokens, and other assets were not clearly distinguished", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "vc-portfolio-track-record", label: "Portfolio track record", defaultNote: "no completed source-backed portfolio verification was recorded", role: "INVESTOR", criticalFor: ["INVESTOR"] },
  { id: "news-press", label: "News & press", defaultNote: "server collector did not run a news/press check" },
  // Sanctions, legal history, and flagged-subject graph reconciliation are
  // legal-grade decision gates, not provider diagnostics. A report must never
  // present as decision-ready clearance while they are unresolved.
  //  - us-legal-history gates every person role EXCEPT founders, whose
  //    founder-legal-regulatory question is the stronger, attribution-verified
  //    form of the same gate (a raw CourtListener name screen stays visible as
  //    a diagnostic for them).
  //  - ofac-sanctions-name gates EVERY person role including founders: no
  //    research check substitutes for an SDN screen.
  //  - trust-graph-connections gates every role: a subject tied to a flagged
  //    operation is the exact signal this product exists to surface.
  // All three stay conditional on scope (requiresResolvedRealName marks the
  // name screens not-applicable, never silently complete).
  {
    id: "us-legal-history",
    label: "US legal history",
    defaultNote: "server collector did not run a legal-history check",
    requiresResolvedRealName: true,
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"],
  },
  {
    id: "ofac-sanctions-name",
    label: "OFAC sanctions (name)",
    defaultNote: "server collector did not run a name-sanctions check",
    requiresResolvedRealName: true,
    criticalFor: ["FOUNDER", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"],
  },
  {
    id: "trust-graph-connections",
    label: "Trust-graph connections",
    defaultNote: "server collector did not run flagged-subject graph reconciliation",
    criticalFor: ["FOUNDER", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER", "PROJECT"],
  },
] as const;

/** Stable persisted checklist contract used to qualify immutable reports. */
export const PERSON_CHECK_IDS: readonly PersonCheckId[] = Object.freeze(CHECKS.map((check) => check.id));

/**
 * The checklist contract that was frozen into reports before project-specific
 * diligence was added. Trust-graph qualification accepts this exact historical
 * shape or the exact current shape, never a partially populated hybrid.
 */
export const LEGACY_PERSON_CHECK_IDS: readonly PersonCheckId[] = Object.freeze([
  "identity-resolution",
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "affiliations-associates",
  "promoted-token-performance",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
]);

/** Exact checklist frozen after project diligence shipped and before founder questions. */
export const PROJECT_DILIGENCE_PERSON_CHECK_IDS: readonly PersonCheckId[] = Object.freeze([
  "identity-resolution",
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "affiliations-associates",
  "promoted-token-performance",
  "project-token-identity",
  "project-product-substance",
  "project-team-identity",
  "project-backing-partners",
  "project-traction-liveness",
  "project-transparency",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
]);

const STATUS_PRIORITY: Record<CheckStatus, number> = {
  "not-applicable": 0,
  unknown: 1,
  unavailable: 2,
  stale: 3,
  "checked-empty": 4,
  confirmed: 5,
  finding: 6,
};

const SUCCESS = new Set<CheckStatus>(["confirmed", "finding", "checked-empty"]);

function iso(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function uniqueObservations(values: readonly CheckObservation[]): CheckObservation[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.id}\n${value.provider}\n${value.status}\n${value.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Records observable collector outcomes, then emits a stable checklist snapshot.
 * Merely invoking an adapter is tracked separately and never completes a check.
 */
export class PersonCheckTracker {
  private readonly observations = new Map<PersonCheckId, CheckObservation[]>();
  private readonly providerRuns = new Map<string, ProviderRun>();

  record(observation: CheckObservation): void {
    const normalized: CheckObservation = {
      ...observation,
      note: observation.note.trim(),
      provider: observation.provider.trim(),
      sourceCount: observation.sourceCount == null
        ? undefined
        : Math.max(0, Math.floor(observation.sourceCount)),
      completedAt: iso(observation.completedAt),
    };
    if (!normalized.note || !normalized.provider) return;
    const current = this.observations.get(normalized.id) ?? [];
    this.observations.set(normalized.id, uniqueObservations([...current, normalized]));
  }

  provider(id: string, label: string, state: ProviderRunState, detail?: string): void {
    this.providerRuns.set(id, {
      id,
      label,
      state,
      observedAt: new Date().toISOString(),
      ...(detail?.trim() ? { detail: detail.trim().slice(0, 500) } : {}),
    });
  }

  snapshot(roles: readonly string[], scope: PersonCheckScope = {}): ScanCheck[] {
    const heldRoles = new Set(roles);
    const projectOnly = heldRoles.size === 1 && heldRoles.has("PROJECT");
    return CHECKS.map((definition) => {
      const decisionCritical = Boolean(
        definition.criticalFor?.some((criticalRole) => heldRoles.has(criticalRole)),
      );
      if (definition.role && !heldRoles.has(definition.role)) {
        const roleNote: Record<NonNullable<CheckDefinition["role"]>, string> = {
          FOUNDER: "not a founder",
          KOL: "not a KOL",
          INVESTOR: "not a fund/investor",
          PROJECT: "not a project account",
        };
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: roleNote[definition.role],
          decisionCritical: false,
        });
      }
      if (definition.requiresResolvedRealName && scope.resolvedRealName === false) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: "requires a resolved real-person name",
          decisionCritical,
        });
      }
      if (definition.requiresPersonRole && projectOnly) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: "not applicable to a project-only brand account",
          decisionCritical: false,
        });
      }

      const observations = this.observations.get(definition.id) ?? [];
      if (!observations.length) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "unknown" as const,
          note: definition.defaultNote,
          decisionCritical,
        });
      }

      const strongest = observations.reduce((best, candidate) =>
        STATUS_PRIORITY[candidate.status] > STATUS_PRIORITY[best.status] ? candidate : best,
      );
      const providers = [...new Set(observations.map((item) => item.provider))];
      const notes = [...new Set(observations
        .filter((item) => item.status === strongest.status || SUCCESS.has(item.status))
        .map((item) => item.note))];
      const sourceCount = observations.reduce((total, item) => total + (item.sourceCount ?? 0), 0);
      const completedAt = observations
        .map((item) => item.completedAt)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1);
      return Object.freeze({
        checkId: definition.id,
        label: definition.label,
        status: strongest.status,
        note: notes.slice(0, 3).join(" · ") || strongest.note,
        decisionCritical,
        provider: providers.join(","),
        ...(sourceCount > 0 ? { sourceCount } : {}),
        ...(completedAt ? { completedAt } : {}),
      });
    });
  }

  completeness(roles: readonly string[], scope: PersonCheckScope = {}): "complete" | "partial" {
    const summary = summarizeChecks(decisionCriticalChecks(this.snapshot(roles, scope)));
    return summary.inScope > 0 && summary.successful === summary.inScope
      ? "complete"
      : "partial";
  }

  providers(): ProviderSnapshot {
    return Object.freeze({
      capturedAt: new Date().toISOString(),
      runs: [...this.providerRuns.values()].map((run) => Object.freeze({ ...run })),
    }) as ProviderSnapshot;
  }
}
