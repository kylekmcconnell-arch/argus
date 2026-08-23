import type {
  IntelligenceDomain,
  IntelligenceEvidenceState,
  IntelligenceMeasurement,
  IntelligenceQuestionState,
  IntelligenceSpineSnapshot,
} from "./types";

export type EntityScorecardRole =
  | "founder_operator"
  | "individual_investor"
  | "investment_firm"
  | "operating_company"
  | "agency"
  | "person";

export type EntityLedgerKind =
  | "career"
  | "portfolio"
  | "fund_scale"
  | "governance_control"
  | "legal_adverse"
  | "relationship"
  | "outcome";

export interface EntityLedgerRow {
  id: string;
  kind: EntityLedgerKind;
  entityKey: string;
  role: EntityScorecardRole;
  label: string;
  value: string | number;
  state: IntelligenceEvidenceState;
  sourceRefs: string[];
  measurementRefs: string[];
  asOf: string | null;
  changeCondition: string;
}

export interface EntityScorecardAxis {
  id: string;
  label: string;
  state: "established" | "partial" | "open" | "not_collected";
  ledgerRowIds: string[];
  measurementRefs: string[];
  sourceRefs: string[];
}

export interface EntityScorecard {
  id: string;
  entityKey: string;
  role: EntityScorecardRole;
  label: string;
  governingScoreImpact: "none";
  axes: EntityScorecardAxis[];
}

const ROLE_AXES: Record<EntityScorecardRole, Array<{ id: string; label: string; domains: IntelligenceDomain[] }>> = {
  founder_operator: [
    { id: "identity", label: "Identity and current role", domains: ["identity", "career", "team"] },
    { id: "track_record", label: "Operating track record", domains: ["track_record", "chronology"] },
    { id: "relationships", label: "Backers and relationships", domains: ["relationships", "portfolio"] },
    { id: "accountability", label: "Governance and adverse record", domains: ["governance", "control", "legal", "reputation"] },
  ],
  individual_investor: [
    { id: "identity", label: "Identity and current role", domains: ["identity", "career"] },
    { id: "portfolio", label: "Confirmed portfolio", domains: ["portfolio"] },
    { id: "outcomes", label: "Investment outcomes", domains: ["track_record", "chronology"] },
    { id: "accountability", label: "Conflicts and adverse record", domains: ["reputation", "legal"] },
  ],
  investment_firm: [
    { id: "identity", label: "Firm identity and operators", domains: ["identity", "team"] },
    { id: "portfolio", label: "Confirmed portfolio", domains: ["portfolio"] },
    { id: "fund_scale", label: "Fund scale", domains: ["fund_scale", "funding"] },
    { id: "governance", label: "Governance and adverse record", domains: ["governance", "control", "legal"] },
  ],
  operating_company: [
    { id: "identity", label: "Company identity", domains: ["identity"] },
    { id: "operators", label: "Leadership and operators", domains: ["team", "career"] },
    { id: "operations", label: "Products and operations", domains: ["operations", "product"] },
    { id: "governance", label: "Governance and adverse record", domains: ["governance", "control", "legal", "security"] },
  ],
  agency: [
    { id: "identity", label: "Agency identity", domains: ["identity"] },
    { id: "operators", label: "Operators and services", domains: ["team", "career", "operations", "product"] },
    { id: "relationships", label: "Clients and relationships", domains: ["relationships", "portfolio"] },
    { id: "accountability", label: "Conflicts and adverse record", domains: ["reputation", "legal", "security"] },
  ],
  person: [
    { id: "identity", label: "Identity and current role", domains: ["identity", "career"] },
    { id: "work", label: "Work and track record", domains: ["team", "operations", "product", "track_record"] },
    { id: "relationships", label: "Relationships", domains: ["relationships", "portfolio"] },
    { id: "accountability", label: "Adverse record", domains: ["reputation", "legal", "security"] },
  ],
};

const ROLE_LABEL: Record<EntityScorecardRole, string> = {
  founder_operator: "Founder / operator scorecard",
  individual_investor: "Individual investor scorecard",
  investment_firm: "Investment firm scorecard",
  operating_company: "Operating company scorecard",
  agency: "Agency scorecard",
  person: "Person scorecard",
};

function ledgerKind(domain: IntelligenceDomain): EntityLedgerKind | null {
  if (domain === "career" || domain === "team") return "career";
  if (domain === "portfolio") return "portfolio";
  if (domain === "fund_scale" || domain === "funding") return "fund_scale";
  if (domain === "governance" || domain === "control") return "governance_control";
  if (domain === "legal" || domain === "security" || domain === "reputation") return "legal_adverse";
  if (domain === "relationships") return "relationship";
  if (domain === "track_record" || domain === "chronology" || domain === "operations" || domain === "product") return "outcome";
  return null;
}

function roleFor(snapshot: IntelligenceSpineSnapshot, roles: readonly unknown[]): EntityScorecardRole {
  const normalized = new Set(roles.map((role) => String(role).toUpperCase()));
  if (normalized.has("AGENCY")) return "agency";
  if (snapshot.subject.entityKind === "investment_firm") return "investment_firm";
  if (snapshot.subject.entityKind === "operating_company") return "operating_company";
  if (snapshot.subject.entityKind === "individual_investor") return "individual_investor";
  if (normalized.has("FOUNDER")) return "founder_operator";
  return "person";
}

function rowFor(measurement: IntelligenceMeasurement, entityKey: string, role: EntityScorecardRole): EntityLedgerRow | null {
  const kind = ledgerKind(measurement.domain);
  if (!kind) return null;
  return {
    id: `entity_ledger:${kind}:${measurement.id}`,
    kind,
    entityKey,
    role,
    label: measurement.label,
    value: measurement.value,
    state: measurement.evidenceState,
    sourceRefs: [...measurement.sourceRefs],
    measurementRefs: [measurement.id],
    asOf: measurement.window?.asOf ?? null,
    changeCondition: `Recompute when the source-bound ${measurement.label.toLowerCase()} record changes in a new report version.`,
  };
}

function axisState(
  measurements: readonly IntelligenceMeasurement[],
  questionStates: readonly IntelligenceQuestionState[],
): EntityScorecardAxis["state"] {
  if (measurements.some((measurement) => measurement.evidenceState === "verified")) return "established";
  if (measurements.length > 0) return "partial";
  if (questionStates.some((state) => state !== "not_collected")) return "open";
  return "not_collected";
}

/**
 * Derive role-specific, score-neutral views from the already-sanitized frozen
 * Intelligence Spine. These structures never invent a second governing score.
 */
export function buildEntityScorecards(
  snapshot: IntelligenceSpineSnapshot,
  roles: readonly unknown[],
): { scorecards: EntityScorecard[]; ledger: EntityLedgerRow[] } {
  if (!snapshot.subject.entityKind || snapshot.subject.entityKind === "project") {
    return { scorecards: [], ledger: [] };
  }
  const role = roleFor(snapshot, roles);
  const entityKey = snapshot.subject.key;
  const ledger = snapshot.measurements
    .map((measurement) => rowFor(measurement, entityKey, role))
    .filter((row): row is EntityLedgerRow => row !== null);
  const axes = ROLE_AXES[role].map((definition): EntityScorecardAxis => {
    const measurements = snapshot.measurements.filter((measurement) => definition.domains.includes(measurement.domain));
    const questions = snapshot.questions.filter((question) => definition.domains.includes(question.domain));
    const rows = ledger.filter((row) => row.measurementRefs.some((id) => measurements.some((measurement) => measurement.id === id)));
    return {
      id: definition.id,
      label: definition.label,
      state: axisState(measurements, questions.map((question) => question.state)),
      ledgerRowIds: rows.map((row) => row.id),
      measurementRefs: measurements.map((measurement) => measurement.id),
      sourceRefs: [...new Set(measurements.flatMap((measurement) => measurement.sourceRefs))],
    };
  });
  return {
    scorecards: [{
      id: `entity_scorecard:${role}:${entityKey}`,
      entityKey,
      role,
      label: ROLE_LABEL[role],
      governingScoreImpact: "none",
      axes,
    }],
    ledger,
  };
}
