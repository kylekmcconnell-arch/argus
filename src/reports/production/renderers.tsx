import { kyleReportRenderers } from "../kyle/renderers";
import type { ReportLaneRenderers } from "../shared/reportLaneRendererTypes";

/** One common report presentation, reused by Production and Developer.
 * Component filenames retain their original ownership; they are not user views.
 */
export const productionReportRenderers: ReportLaneRenderers = { ...kyleReportRenderers };
