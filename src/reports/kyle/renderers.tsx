import { KyleGithubSynthesis } from "./KyleGithubSynthesis";
import { KyleIntelligenceDecisionCanvas } from "./KyleIntelligenceDecisionCanvas";
import { KyleSocialSynthesis } from "./KyleSocialSynthesis";
import type { ReportLaneRenderers } from "../shared/reportLaneRendererTypes";

export const kyleReportRenderers: ReportLaneRenderers = {
  decisionCanvas: (props) => (
    <KyleIntelligenceDecisionCanvas
      {...props}
      scoreLabel={props.scoreLabel ?? "ARGUS risk score"}
      context={props.context ?? []}
      evidenceHref={props.evidenceHref ?? "#token-evidence"}
      methodologyHref={props.methodologyHref ?? "#token-methodology"}
      checkScopeLabel={props.checkScopeLabel ?? "Required report checks"}
    />
  ),
  socialSynthesis: (snapshot) => <KyleSocialSynthesis snapshot={snapshot} />,
  githubSynthesis: (assessment) => <KyleGithubSynthesis assessment={assessment} />,
};
