import { kyleReportRenderers } from "../kyle/renderers";
import type { ReportLaneRenderers } from "../shared/reportLaneRendererTypes";

/**
 * The jointly promoted public presentation slots.
 *
 * Promoted 2026-09-04: the Kyle interpretation (decision canvas, connection
 * workspace, social and GitHub syntheses) is the public report. The Kyle lane
 * keeps evolving in src/reports/kyle; Production follows it by reference, so a
 * later divergence is an explicit edit here, never a silent drift. Evidence,
 * scores and scan behaviour are untouched by this promotion.
 */
export const productionReportRenderers: ReportLaneRenderers = { ...kyleReportRenderers };
