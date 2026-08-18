// Provenance: where a displayed value came from, orthogonal to the verdict
// palette (DESIGN.md 2.1). A value can be fully sourced AND RUG-flagged.

export type ProvenanceTier = "sourced" | "derived" | "unestablished";

export interface ProvenanceState {
  tier: ProvenanceTier;
  /** Sourced only: two fetched sources disagree, rendered with a hollow mark. */
  contested?: boolean;
}

const TIER_META: Record<ProvenanceTier, { tint: string; label: string }> = {
  sourced: { tint: "tint-sourced", label: "Sourced" },
  derived: { tint: "tint-derived", label: "Derived" },
  unestablished: { tint: "tint-unverifiable", label: "Unestablished" },
};

export function provenanceTint(state: ProvenanceState): string {
  return TIER_META[state.tier].tint;
}

export function provenanceLabel(state: ProvenanceState): string {
  return state.contested ? "Sources disagree" : TIER_META[state.tier].label;
}

/**
 * Maps a `BasicFactStatus` (src/components/BasicFactsPanel.tsx) onto a
 * provenance tier. `not_applicable` has no provenance and returns null —
 * it is out of scope for this subject, not a claim about grounding.
 */
export type BasicFactProvenanceStatus =
  | "verified" | "corroborated" | "conflicted" | "lead" | "unresolved" | "checked_empty" | "not_applicable";

export function provenanceForBasicFactStatus(status: BasicFactProvenanceStatus): ProvenanceState | null {
  if (status === "conflicted") return { tier: "sourced", contested: true };
  if (status === "verified" || status === "corroborated") return { tier: "sourced" };
  if (status === "lead" || status === "unresolved" || status === "checked_empty") return { tier: "unestablished" };
  return null;
}

/**
 * Maps a `CheckStatus` (src/lib/scanChecklist.ts) onto a provenance tier.
 * `not-applicable` returns null for the same reason as above.
 */
export function provenanceForCheckStatus(
  status: "confirmed" | "reported" | "finding" | "checked-empty" | "not-applicable" | "unknown" | "unavailable" | "stale",
): ProvenanceState | null {
  if (status === "confirmed" || status === "finding") return { tier: "sourced" };
  if (status === "reported" || status === "stale") return { tier: "derived" };
  if (status === "checked-empty" || status === "unknown" || status === "unavailable") return { tier: "unestablished" };
  return null;
}
