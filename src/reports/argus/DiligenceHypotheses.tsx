import type { DiligenceBrief } from "../../lib/diligenceBrief";
import { Badge, ExtLink } from "./primitives";

export function DiligenceHypotheses({ brief }: { brief?: DiligenceBrief }) {
  if (!brief?.hypotheses.length) return <p className="subtle-note">No source-cited analytical thesis is saved yet. Missing evidence is not a positive or negative judgment.</p>;
  return <div className="diligence-grid">{brief.hypotheses.map((hypothesis, index) => {
    const sources = brief.sources.filter(source => hypothesis.sourceIds.includes(source.id));
    return <article className="diligence-card" key={index}>
      <Badge>Analytical hypothesis</Badge>
      <h3>{({ role_fit: "Fit for the role", team_fit: "Team ability and dependencies", advantage: "Potential advantage", defensibility: "Defensibility", risk_to_thesis: "What could weaken the thesis" })[hypothesis.topic]}</h3>
      <p>{hypothesis.text}</p>
      <p><strong>Limits:</strong> {hypothesis.limitations}</p>
      <p><strong>What would change this:</strong> {hypothesis.whatWouldChange}</p>
      <details className="disclosure"><summary>Evidence behind this analysis ({sources.length})</summary>
        {sources.map(source => <div className="product-claim" key={source.id}><Badge>{source.relation === "contradicts" ? "Counter-evidence" : source.sourceClass === "official_subject" ? "Company or person claim" : "Supporting source"}</Badge><p>{source.excerpt}</p><ExtLink href={source.url}>Read source</ExtLink><small> · Captured {source.capturedAt.slice(0, 10)}</small></div>)}
      </details>
    </article>;
  })}</div>;
}
