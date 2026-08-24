import type { TokenAxis } from "../token/audit";

export type DecisionBoundaryArea = "contract" | "holders" | "liquidity" | "market" | "method";

export interface TokenDecisionBoundary {
  schemaVersion: 1;
  kind: "cap" | "threshold" | "buffer" | "unknown_cap";
  controllingFact: string;
  boundary: string;
  willNotChange: string;
  unlockCondition: string;
  evidenceArea: DecisionBoundaryArea;
}

interface CapBoundaryRule {
  ceiling: number;
  controllingFact: string;
  unlockCondition: string;
  evidenceArea: DecisionBoundaryArea;
}

const CAP_BOUNDARIES: Record<string, CapBoundaryRule> = {
  honeypot_confirmed: {
    ceiling: 10,
    controllingFact: "The saved tradeability evidence shows that holders may not be able to sell.",
    unlockCondition: "A fresh successful buy-and-sell receipt, together with contract evidence showing the restriction is gone, must replace the failed result.",
    evidenceArea: "contract",
  },
  cannot_sell_all: {
    ceiling: 15,
    controllingFact: "The contract does not allow a holder to sell their full balance.",
    unlockCondition: "A fresh trade receipt must show a full-balance sell succeeds and the contract restriction no longer applies.",
    evidenceArea: "contract",
  },
  owner_can_modify_balance: {
    ceiling: 20,
    controllingFact: "An active controller can directly change holder balances.",
    unlockCondition: "A current chain receipt must show that the balance-changing authority was permanently removed or cannot be exercised.",
    evidenceArea: "contract",
  },
  balance_mutable_authority: {
    ceiling: 20,
    controllingFact: "An active authority can rewrite token balances.",
    unlockCondition: "A current chain receipt must show that the balance-mutating authority was permanently revoked.",
    evidenceArea: "contract",
  },
  serial_scammer_creator: {
    ceiling: 25,
    controllingFact: "The attributed creator wallet has previously created tokens recorded as honeypots.",
    unlockCondition: "Primary creation records must reattribute this token to a different wallet, or the source record behind the prior honeypot link must be corrected.",
    evidenceArea: "contract",
  },
  mint_authority_active: {
    ceiling: 35,
    controllingFact: "More tokens can still be created by an active mint authority.",
    unlockCondition: "A current chain receipt must show that the mint authority was permanently revoked.",
    evidenceArea: "contract",
  },
  freeze_authority_active: {
    ceiling: 35,
    controllingFact: "An active freeze authority can stop token accounts from moving funds.",
    unlockCondition: "A current chain receipt must show that the freeze authority was permanently revoked.",
    evidenceArea: "contract",
  },
  reclaimable_ownership: {
    ceiling: 35,
    controllingFact: "The saved contract record shows hidden or reclaimable ownership control.",
    unlockCondition: "A current contract-authority receipt must show that ownership cannot be hidden, reclaimed, or exercised.",
    evidenceArea: "contract",
  },
  single_wallet_majority_supply: {
    ceiling: 39,
    controllingFact: "One assessed non-market wallet controls at least half of the token supply.",
    unlockCondition: "A comparable current holder register must show that no non-market wallet holds a majority of supply.",
    evidenceArea: "holders",
  },
  documented_scanner_concealment: {
    ceiling: 55,
    controllingFact: "The verified contract source documents behavior intended to conceal activity from scanners.",
    unlockCondition: "New verified source code and matching deployed-bytecode receipts must show that the concealment behavior was removed.",
    evidenceArea: "contract",
  },
  single_wallet_concentration: {
    ceiling: 69,
    controllingFact: "One assessed non-market wallet holds at least a quarter of the token supply.",
    unlockCondition: "A comparable current holder register must show the largest non-market wallet below the concentration threshold.",
    evidenceArea: "holders",
  },
  few_wallet_concentration: {
    ceiling: 69,
    controllingFact: "The three largest assessed material wallets hold at least 60% of supply between them.",
    unlockCondition: "A comparable current holder register must show those wallets below the concentration threshold.",
    evidenceArea: "holders",
  },
  ofac_sanctioned_address: {
    ceiling: 5,
    controllingFact: "A wallet bound to this report matched a current sanctions record.",
    unlockCondition: "A current official sanctions record must show the address is no longer designated, or primary attribution evidence must correct the address binding.",
    evidenceArea: "contract",
  },
};

const MARKET_CANNOT_OVERRIDE = "Higher price, volume, liquidity, followers, or social activity cannot override this safety limit.";

function largestHeadroom(axes: readonly TokenAxis[]): { axis: TokenAxis; points: number } | null {
  const ranked = axes
    .filter((axis) => Number.isFinite(axis.score) && Number.isFinite(axis.weight) && axis.weight > 0)
    .map((axis) => ({ axis, points: Math.max(0, axis.weight - axis.score) }))
    .sort((a, b) => b.points - a.points || a.axis.key.localeCompare(b.axis.key));
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}

function largestContribution(axes: readonly TokenAxis[]): { axis: TokenAxis; points: number } | null {
  const ranked = axes
    .filter((axis) => Number.isFinite(axis.score) && Number.isFinite(axis.weight) && axis.weight > 0)
    .map((axis) => ({ axis, points: Math.max(0, axis.score) }))
    .sort((a, b) => b.points - a.points || a.axis.key.localeCompare(b.axis.key));
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}

function areaForAxis(axis: TokenAxis | undefined): DecisionBoundaryArea {
  if (!axis) return "method";
  if (axis.key === "T1") return "liquidity";
  if (axis.key === "T2" || axis.key === "T3") return "contract";
  if (axis.key === "T4") return "holders";
  if (axis.key === "T5" || axis.key === "T6") return "market";
  return "method";
}

/**
 * Freeze the score's decision boundary at scan time. Saved reports render this
 * object verbatim; older reports never reconstruct it using newer rules.
 */
export function deriveTokenDecisionBoundary(input: {
  score: number | null;
  capApplied: string | null;
  axes: readonly TokenAxis[];
}): TokenDecisionBoundary | null {
  if (input.score === null || !Number.isFinite(input.score)) return null;
  const score = Math.max(0, Math.min(100, Math.round(input.score)));

  if (input.capApplied) {
    const rule = CAP_BOUNDARIES[input.capApplied.toLowerCase()];
    if (!rule) {
      return {
        schemaVersion: 1,
        kind: "unknown_cap",
        controllingFact: "A saved safety limit controls this result, but this report does not contain a public explanation for that limit.",
        boundary: `The saved score is ${score}/100. ARGUS will not infer the missing ceiling.`,
        willNotChange: MARKET_CANNOT_OVERRIDE,
        unlockCondition: "Open the methodology receipt for the saved limit before treating this result as movable.",
        evidenceArea: "method",
      };
    }
    return {
      schemaVersion: 1,
      kind: "cap",
      controllingFact: rule.controllingFact,
      boundary: `This finding caps the score at ${rule.ceiling}/100, even if every other scored area improves.`,
      willNotChange: MARKET_CANNOT_OVERRIDE,
      unlockCondition: rule.unlockCondition,
      evidenceArea: rule.evidenceArea,
    };
  }

  if (score < 70) {
    const threshold = score < 40 ? 40 : 70;
    const nextVerdict = score < 40 ? "CAUTION" : "PASS";
    const gap = threshold - score;
    const headroom = largestHeadroom(input.axes);
    const headroomCopy = !headroom
      ? "The saved axes contain no unused scoring headroom."
      : headroom.points >= gap
        ? `${headroom.axis.label} has ${headroom.points} points of unused headroom on paper, enough to cross the boundary only if new evidence earns those points.`
        : `${headroom.axis.label} has the most unused headroom at ${headroom.points} points, so no single scored area can cross the boundary by itself.`;
    return {
      schemaVersion: 1,
      kind: "threshold",
      controllingFact: `${gap} evidence-backed point${gap === 1 ? "" : "s"} separate this score from ${nextVerdict}.`,
      boundary: headroomCopy,
      willNotChange: "Price movement, volume, or social attention alone does not add points to this saved report.",
      unlockCondition: `A new scan must verify enough changed evidence to add ${gap} point${gap === 1 ? "" : "s"}; arithmetic headroom is not a prediction.`,
      evidenceArea: areaForAxis(headroom?.axis),
    };
  }

  const buffer = score - 69;
  const contribution = largestContribution(input.axes);
  const pressure = contribution && contribution.points >= buffer
    ? `${contribution.axis.label} contributes ${contribution.points} points and is large enough by itself to erase that buffer if its evidence materially deteriorates.`
    : "No single scored area is large enough by itself to erase the current buffer.";
  return {
    schemaVersion: 1,
    kind: "buffer",
    controllingFact: `${buffer} point${buffer === 1 ? "" : "s"} separate this score from falling below PASS.`,
    boundary: pressure,
    willNotChange: "Short-term price or social movement does not change the saved PASS result.",
    unlockCondition: "Only a new scan with materially different verified evidence can move this boundary.",
    evidenceArea: areaForAxis(contribution?.axis),
  };
}

export function decisionBoundaryHref(
  boundary: TokenDecisionBoundary,
  reportKind: "token" | "investigation",
): `#${string}` {
  if (reportKind === "investigation") {
    if (boundary.evidenceArea === "market" || boundary.evidenceArea === "liquidity") return "#investigation-visuals";
    if (boundary.evidenceArea === "holders" || boundary.evidenceArea === "contract") return "#investigation-evidence";
    return "#investigation-methodology";
  }
  if (boundary.evidenceArea === "market" || boundary.evidenceArea === "liquidity") return "#token-market";
  if (boundary.evidenceArea === "holders") return "#composition";
  return "#token-methodology";
}
