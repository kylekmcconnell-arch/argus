import type { TokenAxis } from "../token/audit";
import type { CompositionRow } from "./scoreComposition";
import { plainAxisLabel } from "./dimensionChapters";
import { explainCompositionScore } from "./verdictNarrative";

export { tokenMarketPresentation } from "./tokenMarketPresentation";

export function tokenCompositionRow(a: TokenAxis): CompositionRow {
  return {
    axis: a.key, label: plainAxisLabel(a.key, a.label), score: a.score, weight: a.weight,
    rationale: explainCompositionScore(a.rationale, a.score, a.weight, a.assessed === false ? "unassessed" : undefined), evidenceHref: `#dimension-${a.key}`,
    ...(a.assessed === false ? { applicability: "unassessed" as const } : {}),
    ...(a.evidenceRefs ? { supportCount: a.evidenceRefs.length, evidenceStrength: "measured" as const } : {}),
  };
}
