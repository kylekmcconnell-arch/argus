import type { ReportPersistenceContext } from "./reportVersion";

export interface ReconResultPolicyInput {
  hasRecon: boolean;
  /** Privacy captured when the displayed run started. */
  resultPrivate: boolean | null;
  /** Mutable form choice for the next run only. */
  nextRunPrivate: boolean;
  snapshot: boolean;
  persistence?: ReportPersistenceContext | null;
}

export interface ReconResultPolicy {
  displayedPrivate: boolean;
  canRecord: boolean;
  canMutate: boolean;
  panelCostToken?: string;
}

/**
 * Derive all result-side privacy decisions from the run that produced the
 * evidence. The search toggle is intentionally consulted only before a result
 * exists, so changing the next-run choice cannot rewrite the meaning or side
 * effects of evidence already on screen.
 */
export function reconResultPolicy({
  hasRecon,
  resultPrivate,
  nextRunPrivate,
  snapshot,
  persistence,
}: ReconResultPolicyInput): ReconResultPolicy {
  const displayedPrivate = hasRecon && resultPrivate !== null
    ? resultPrivate
    : nextRunPrivate;
  const canWrite = hasRecon
    && resultPrivate === false
    && !snapshot
    && persistence?.state === "persisted";
  const panelCostToken = canWrite
    && persistence?.state === "persisted"
    && typeof persistence.panelCostToken === "string"
    && persistence.panelCostToken
      ? persistence.panelCostToken
      : undefined;

  return {
    displayedPrivate,
    canRecord: canWrite,
    canMutate: canWrite,
    panelCostToken,
  };
}
