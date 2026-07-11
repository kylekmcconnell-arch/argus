import { summarizeChecks, type CheckStatus, type ScanCheck } from "../src/lib/scanChecklist";
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
  role?: "KOL" | "INVESTOR";
  requiresResolvedRealName?: boolean;
}

export interface PersonCheckScope {
  resolvedRealName?: boolean;
}

const CHECKS: readonly CheckDefinition[] = [
  { id: "identity-resolution", label: "Identity resolution", defaultNote: "no completed server-side identity resolution was recorded" },
  { id: "profile-photo-authenticity", label: "Profile-photo integrity", defaultNote: "server collector did not run a profile-photo integrity screen" },
  { id: "code-footprint-github", label: "Code footprint (GitHub)", defaultNote: "no completed GitHub resolution was recorded" },
  { id: "identity-continuity", label: "Identity continuity", defaultNote: "no completed handle-history result was recorded" },
  { id: "affiliations-associates", label: "Affiliations & associates", defaultNote: "no corroborated affiliation collection outcome was recorded" },
  { id: "promoted-token-performance", label: "Promoted-token performance", defaultNote: "no completed promoted-token market result was recorded", role: "KOL" },
  { id: "vc-portfolio-track-record", label: "VC portfolio track record", defaultNote: "no completed portfolio-provider result was recorded", role: "INVESTOR" },
  { id: "news-press", label: "News & press", defaultNote: "server collector did not run a news/press check" },
  { id: "us-legal-history", label: "US legal history", defaultNote: "server collector did not run a legal-history check", requiresResolvedRealName: true },
  { id: "ofac-sanctions-name", label: "OFAC sanctions (name)", defaultNote: "server collector did not run a name-sanctions check", requiresResolvedRealName: true },
  { id: "trust-graph-connections", label: "Trust-graph connections", defaultNote: "server collector did not run flagged-subject graph reconciliation" },
] as const;

/** Stable persisted checklist contract used to qualify immutable reports. */
export const PERSON_CHECK_IDS: readonly PersonCheckId[] = Object.freeze(CHECKS.map((check) => check.id));

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
    return CHECKS.map((definition) => {
      if (definition.role && !heldRoles.has(definition.role)) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: definition.role === "KOL" ? "not a KOL" : "not a fund/investor",
        });
      }
      if (definition.requiresResolvedRealName && scope.resolvedRealName === false) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: "requires a resolved real-person name",
        });
      }

      const observations = this.observations.get(definition.id) ?? [];
      if (!observations.length) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "unknown" as const,
          note: definition.defaultNote,
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
        provider: providers.join(","),
        ...(sourceCount > 0 ? { sourceCount } : {}),
        ...(completedAt ? { completedAt } : {}),
      });
    });
  }

  completeness(roles: readonly string[], scope: PersonCheckScope = {}): "complete" | "partial" {
    const summary = summarizeChecks(this.snapshot(roles, scope));
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
