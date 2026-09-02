import {
  clearanceCoverage,
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

/**
 * Check ids this checklist contract owns beyond the adapter-facing
 * `PersonCheckId` union in server/adapters/types.ts.
 *
 * That union is shared adapter surface; the two local-only rows were added here first,
 * so the widening lives with the contract that defines them. Observations for
 * them are recorded straight onto the tracker rather than through
 * `ctx.recordCheck`, whose parameter is still typed by the narrower union.
 * Fold them into `PersonCheckId` and delete this alias when that file is next
 * touched.
 */
export type ChecklistCheckId =
  | PersonCheckId
  | "adverse-screen"
  | "project-leadership-currency";

/** A `CheckObservation` that may also carry one of the ids above. */
export interface ChecklistObservation extends Omit<CheckObservation, "id"> {
  id: ChecklistCheckId;
}

interface CheckDefinition {
  id: ChecklistCheckId;
  label: string;
  defaultNote: string;
  role?: "FOUNDER" | "KOL" | "INVESTOR" | "PROJECT";
  /** Roles for which this row answers a decision question, not just provider coverage. */
  criticalFor?: readonly string[];
  requiresResolvedRealName?: boolean;
  requiresPersonRole?: boolean;
  requiresPersonSubject?: boolean;
  requiresOrganizationSubject?: boolean;
}

// Roles that necessarily describe a natural person. INVESTOR and AGENCY are
// deliberately absent: both can also describe a firm, which is why their
// callers pass an evidence-derived organizationSubject flag instead.
const PERSON_ROLES = ["FOUNDER", "KOL", "ADVISOR", "MEMBER"] as const;

export interface PersonCheckScope {
  resolvedRealName?: boolean;
  /**
   * True when the frozen subject record identifies the audited account as an
   * organization rather than a person. PROJECT is always organization-scoped;
   * INVESTOR and AGENCY require this explicit evidence-derived flag because
   * those methodologies can also describe individuals.
   */
  organizationSubject?: boolean;
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
    id: "entity-continuity",
    label: "Project and token continuity",
    defaultNote: "no completed predecessor, rebrand, migration, or contract-continuity search was recorded",
    role: "PROJECT",
    criticalFor: ["PROJECT"],
  },
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
  // Does the leadership this project claims still claim the project back? The
  // answer comes from a paid, bounded employment lookup (founders and C-level,
  // three people at most), and it used to be recorded against
  // founder-company-relationships, whose FOUNDER role gate then published
  // "not a founder" on the very run that paid for the answer. This row is the
  // PROJECT-scoped home for it.
  //
  // Not a decision gate: a project with no named leaders, or a scan with no
  // licensed employment provider, cannot be asked this question at all, and a
  // question that cannot be asked must not withhold clearance.
  // project-team-identity remains the gating team row.
  { id: "project-leadership-currency", label: "Named leadership still current", defaultNote: "no employment-record currency outcome was recorded for the named leadership", role: "PROJECT" },
  { id: "project-backing-partners", label: "Backing and partners", defaultNote: "no source-backed project backing or partnership outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-traction-liveness", label: "Traction and liveness", defaultNote: "no frozen product, market, or activity-liveness outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-transparency", label: "Transparency and disclosures", defaultNote: "no frozen token, audit, docs, or disclosure outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "founder-identity-authority", label: "Verified identity and current authority", defaultNote: "the founder's identity and current decision-making role were not both verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-company-relationships", label: "Companies, co-founders, and current roles", defaultNote: "the founder's material company and co-founder relationships were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-track-record", label: "Track record and outcomes", defaultNote: "prior roles, exits, and venture outcomes were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-control-conflicts", label: "Control and conflicts", defaultNote: "governance control, ownership, and material conflicts were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-legal-regulatory", label: "Legal and regulatory history", defaultNote: "material legal or regulatory events and their attribution were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-asset-distinction", label: "Related assets and security/token distinction", defaultNote: "related public securities, native tokens, and other assets were not clearly distinguished", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  // Repeat backing is the only FOUNDER axis (F3) with no fallback producer once
  // the `ventures` section is empty (its `testimonials` feeder is dead), so a
  // richly-evidenced founder with no resolved venture row was withheld entirely.
  // This check runs a deterministic assessment over the founder's known
  // ventures/companies and records an observable outcome (a positive repeat
  // backer/re-backed exit, or an affirmative "none in the collected record"),
  // which is the substantive artifact F3 needs. It never runs when there is no
  // venture or company to assess, so a genuinely unassessable subject still abstains.
  // Not a decision gate: a founder without demonstrated repeat backing is still
  // decision-ready (repeat backing is a positive signal, not a safety must-have).
  // This row is a scoring input for F3 only; it never gates report completeness.
  { id: "founder-repeat-backing", label: "Repeat backing and re-investment", defaultNote: "repeat financing, re-backing, or re-investment across ventures was not assessed", role: "FOUNDER" },
  { id: "vc-portfolio-track-record", label: "Portfolio track record", defaultNote: "no completed source-backed portfolio verification was recorded", role: "INVESTOR", criticalFor: ["INVESTOR"] },
  // A completed fund-scale assessment is a scoring input for I3 only; like
  // founder-repeat-backing it never gates report completeness (a fund whose AUM
  // is not publicly source-backed is scored low on scale, not abstained).
  { id: "investor-fund-scale", label: "Fund scale", defaultNote: "fund AUM or close amount was not assessed against source-backed evidence", role: "INVESTOR" },
  { id: "news-press", label: "News & press", defaultNote: "server collector did not run a news/press check" },
  // The rug / scam / drain / FUD sweep is the only screen a PSEUDONYMOUS
  // subject gets: with no resolved real name, both name-based screens below go
  // not-applicable and nothing else asks whether people are accusing this
  // subject of taking their money. It previously reported only as a provider
  // run, which snapshot() and completeness() never read, so skipping it on the
  // collection-budget path cost zero coverage and the report still published
  // full clearance. It is a decision question for every person role.
  //
  // A sweep that RAN and surfaced nothing records checked-empty and is a
  // completed answer; only an unprovisioned, skipped, or failed sweep records
  // unavailable and reads as an open gate.
  {
    id: "adverse-screen",
    label: "Adverse, scam, and rug sweep",
    defaultNote: "server collector did not run an adverse, scam, or rug sweep",
    criticalFor: ["FOUNDER", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"],
  },
  // Person-name legal and sanctions screens cannot clear an organization. An
  // institutional investment firm or agency needs its own exact legal-entity
  // binding and entity sanctions outcome. These rows are deliberately open by
  // default: a website name, a person's clean screen, or provider silence is
  // not registration evidence and is not an entity sanctions result. Generic
  // PROJECT accounts retain the rows as visible follow-ups, but they are not
  // gates until their recorded route has an entity-screen replacement.
  {
    id: "organization-registration",
    label: "Organization legal-entity binding",
    defaultNote: "no strict frozen legal_entity fact binds the audited organization to an exact legal entity",
    // Generic protocol/project accounts do not yet have an entity sanctions
    // producer in the recorded route, so this gate applies only to explicit
    // institutional/company methodologies with the replacement pass wired.
    criticalFor: ["INVESTOR", "AGENCY"],
    requiresOrganizationSubject: true,
  },
  {
    id: "organization-sanctions",
    label: "Organization OFAC sanctions screen",
    defaultNote: "no completed OFAC sanctions screen was frozen for the audited organization's exact legal entity",
    criticalFor: ["INVESTOR", "AGENCY"],
    requiresOrganizationSubject: true,
  },
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
    requiresPersonSubject: true,
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"],
  },
  {
    id: "ofac-sanctions-name",
    label: "OFAC sanctions (name)",
    defaultNote: "server collector did not run a name-sanctions check",
    requiresResolvedRealName: true,
    requiresPersonSubject: true,
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
export const PERSON_CHECK_IDS: readonly ChecklistCheckId[] = Object.freeze(CHECKS.map((check) => check.id));

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

/**
 * Exact checklist frozen after founder diligence shipped and before the
 * founder repeat-backing (F3) assessment was added. Reports persisted under this
 * shape must still qualify for the trust-graph KB after the new check lands.
 */
export const FOUNDER_DILIGENCE_PERSON_CHECK_IDS: readonly PersonCheckId[] = Object.freeze([
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
  "founder-identity-authority",
  "founder-company-relationships",
  "founder-track-record",
  "founder-control-conflicts",
  "founder-legal-regulatory",
  "founder-asset-distinction",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
]);

/**
 * Exact checklist frozen after founder repeat-backing (F3) shipped and before
 * the investor fund-scale (I3) assessment was added. Reports persisted under
 * this shape must still qualify for the trust-graph KB after the new check
 * lands (contract matching is exact-set).
 */
export const REPEAT_BACKING_ERA_PERSON_CHECK_IDS: readonly PersonCheckId[] = Object.freeze([
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
  "founder-identity-authority",
  "founder-company-relationships",
  "founder-track-record",
  "founder-control-conflicts",
  "founder-legal-regulatory",
  "founder-asset-distinction",
  "founder-repeat-backing",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
]);

/**
 * Exact checklist frozen after investor fund-scale (I3) shipped and before the
 * adverse sweep and project leadership-currency rows were added. Reports
 * persisted under this shape must still qualify for the trust-graph KB after
 * the new checks land (contract matching is exact-set).
 */
export const FUND_SCALE_ERA_PERSON_CHECK_IDS: readonly ChecklistCheckId[] = Object.freeze([
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
  "founder-identity-authority",
  "founder-company-relationships",
  "founder-track-record",
  "founder-control-conflicts",
  "founder-legal-regulatory",
  "founder-asset-distinction",
  "founder-repeat-backing",
  "vc-portfolio-track-record",
  "investor-fund-scale",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
]);

/**
 * Exact checklist frozen after adverse-screen and project leadership currency
 * shipped, and before organization-specific registration and sanctions gates.
 * Trust-graph qualification is exact-set, so persisted 27-row reports need
 * this immutable era after the current contract grows.
 */
export const PRE_ORGANIZATION_SAFETY_PERSON_CHECK_IDS: readonly ChecklistCheckId[] = Object.freeze([
  ...FUND_SCALE_ERA_PERSON_CHECK_IDS,
  "adverse-screen",
  "project-leadership-currency",
]);

const STATUS_PRIORITY: Record<CheckStatus, number> = {
  "not-applicable": 0,
  unknown: 1,
  unavailable: 2,
  stale: 3,
  "checked-empty": 4,
  reported: 5,
  confirmed: 6,
  finding: 7,
};

const SUCCESS = new Set<CheckStatus>(["confirmed", "reported", "finding", "checked-empty"]);

function iso(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function uniqueObservations(values: readonly ChecklistObservation[]): ChecklistObservation[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.id}\n${value.provider}\n${value.status}\n${value.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Rows whose "finding" status is an assessed null ("searched, nothing bound"),
 * never adverse evidence. The token-identity collector can run twice in one
 * scan: once before intake, and again after orientation or source verification
 * has recovered a launched-product ticker or the official site. When the second
 * pass binds the token, the earlier null is answered, not contradicted, and
 * must not outrank the bind (STATUS_PRIORITY otherwise keeps "finding" above
 * "confirmed" so that a real adverse finding survives a later clean read).
 */
const NULL_FINDING_SUPERSEDED_BY_CONFIRMED = new Set<ChecklistCheckId>(["project-token-identity"]);

function supersededObservations(
  id: ChecklistCheckId,
  observations: readonly ChecklistObservation[],
): ChecklistObservation[] {
  if (!NULL_FINDING_SUPERSEDED_BY_CONFIRMED.has(id)) return [...observations];
  if (!observations.some((item) => item.status === "confirmed")) return [...observations];
  return observations.filter((item) => item.status !== "finding");
}

/**
 * Records observable collector outcomes, then emits a stable checklist snapshot.
 * Merely invoking an adapter is tracked separately and never completes a check.
 */
export class PersonCheckTracker {
  private readonly observations = new Map<ChecklistCheckId, ChecklistObservation[]>();
  private readonly providerRuns = new Map<string, ProviderRun>();

  record(observation: ChecklistObservation): void {
    const normalized: ChecklistObservation = {
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

  provider(id: string, label: string, state: ProviderRunState, detail?: string, observedAt?: string): void {
    this.providerRuns.set(id, {
      id,
      label,
      state,
      // Buffered rows (concurrent adapter lanes flush in canonical order)
      // keep their completion-time timestamps.
      observedAt: observedAt ?? new Date().toISOString(),
      ...(detail?.trim() ? { detail: detail.trim().slice(0, 500) } : {}),
    });
  }

  snapshot(roles: readonly string[], scope: PersonCheckScope = {}): ScanCheck[] {
    const heldRoles = new Set(roles);
    const projectOnly = heldRoles.size === 1 && heldRoles.has("PROJECT");
    // A PROJECT account is necessarily the project/operating organization.
    // INVESTOR and AGENCY remain ambiguous methodologies, so their callers
    // must pass the organization classification derived from frozen evidence.
    const organizationSubject = heldRoles.has("PROJECT") || scope.organizationSubject === true;
    // An organization-scoped account can still carry a natural person: a
    // founder's personal brand account routes PROJECT and FOUNDER together.
    // The person-name screens are inapplicable only when there is nobody
    // behind the subject to screen, so a held person role keeps them armed.
    // Without this the OFAC name gate silently leaves the applicable set for
    // exactly the mixed accounts that most need it, and the organization
    // replacement gate does not arm outside INVESTOR/AGENCY.
    const carriesPersonRole = PERSON_ROLES.some((role) => heldRoles.has(role));
    return CHECKS.map((definition) => {
      // Founder diligence already owns the stricter, attribution-verified
      // legal/regulatory question. A secondary MEMBER classification must not
      // re-arm the raw CourtListener name-screen diagnostic for the same person.
      const founderLegalSupersedesNameScreen = definition.id === "us-legal-history"
        && heldRoles.has("FOUNDER");
      const decisionCritical = !founderLegalSupersedesNameScreen && Boolean(
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
      if (definition.requiresOrganizationSubject && !organizationSubject) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: "not an organization subject",
          decisionCritical: false,
        });
      }
      if (definition.requiresPersonSubject && organizationSubject && !carriesPersonRole) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable" as const,
          note: "person-name screen does not clear an organization subject",
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

      const observations = supersededObservations(definition.id, this.observations.get(definition.id) ?? []);
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
    // Full-clearance coverage policy (clearanceCoverage): every never-waive
    // safety screen recorded plus recorded coverage at the clearance floor.
    // An enrichment path a provider cannot serve no longer withholds
    // completeness indefinitely; an unrecorded sanctions / identity /
    // trust-graph screen always does.
    return clearanceCoverage(this.snapshot(roles, scope)).sufficient ? "complete" : "partial";
  }

  providers(): ProviderSnapshot {
    return Object.freeze({
      capturedAt: new Date().toISOString(),
      runs: [...this.providerRuns.values()].map((run) => Object.freeze({ ...run })),
    }) as ProviderSnapshot;
  }
}
