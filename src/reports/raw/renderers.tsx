import { RawEvidenceDecisionCanvas } from "./RawEvidenceDecisionCanvas";
import type { ReportLaneRenderers } from "../shared/reportLaneRendererTypes";

export const rawEvidenceReportRenderers: ReportLaneRenderers = {
  decisionCanvas: (props) => <RawEvidenceDecisionCanvas {...props} />,
};
