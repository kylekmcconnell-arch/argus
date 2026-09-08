import { productionReportRenderers } from "../production/renderers";
import { RawEvidenceDecisionCanvas } from "../raw/RawEvidenceDecisionCanvas";
import "../raw/report-lane.css";
import type { ReportLaneId } from "./reportLaneTypes";
import type { ReportLaneRenderers } from "./reportLaneRendererTypes";

const developerReportRenderers: ReportLaneRenderers = {
  ...productionReportRenderers,
  decisionCanvas: (props) => <>
    {productionReportRenderers.decisionCanvas?.(props)}
    <details className="report-developer-tools my-4 rounded-xl border border-line bg-panel p-4">
      <summary className="cursor-pointer font-medium">Developer evidence and verification</summary>
      <RawEvidenceDecisionCanvas {...props} />
    </details>
  </>,
};

const REPORT_LANE_RENDERERS: Readonly<Record<ReportLaneId, ReportLaneRenderers>> = Object.freeze({
  production: productionReportRenderers,
  developer: developerReportRenderers,
});

export function reportLaneRenderers(id: ReportLaneId): ReportLaneRenderers {
  return REPORT_LANE_RENDERERS[id];
}
