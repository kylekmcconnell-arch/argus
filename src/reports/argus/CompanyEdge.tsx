import type { DossierBasicFactQuestion } from "../../data/dossier";
import type { BasicFactView } from "../../components/BasicFactsPanel";
import type { DiligenceBrief } from "../../lib/diligenceBrief";
import { COMPANY_DILIGENCE_TOPICS } from "../../lib/diligenceTopics";
import { DiligenceFacts } from "./PersonDiligence";
import { DiligenceHypotheses } from "./DiligenceHypotheses";
import { Badge, Panel } from "./primitives";

export function CompanyEdge({ facts, brief, questions }: { facts: BasicFactView[]; brief?: DiligenceBrief; questions?: DossierBasicFactQuestion[] }) {
  const relevant = facts.filter(fact => (fact.sources?.length ?? 0) > 0);
  const hasFocused = relevant.some(fact => fact.questionId?.includes(".diligence_"));
  return <Panel className="space-top company-edge" >
    <div className="eyebrow">Product, mechanism and defensibility</div>
    <h2>What's their edge?</h2>
    <p>Understand how it works, what is distinctive and how much of the advantage is demonstrated.</p>
    <div className="diligence-grid">
      {COMPANY_DILIGENCE_TOPICS.filter(topic => !["relationship_scope", "team_delivery"].includes(topic.id)).map(topic => {
        const rows = relevant.filter(fact => fact.questionId?.endsWith(`.diligence_${topic.id}`));
        const research = questions?.find(row => row.questionId.endsWith(`.diligence_${topic.id}`));
        const attempted = research?.providerRuns.some(run => ["succeeded", "partial", "completed_empty"].includes(run.state));
        return <section className="diligence-card" key={topic.id}>
          <h3>{topic.title}</h3>
          {rows.length ? <><Badge>{rows.some(row => row.status === "conflicted") ? "Conflicting evidence" : topic.id === "claimed_edge" ? "Attributed claim" : "Evidence recorded"}</Badge>
            <p>{rows.map(row => String(row.value ?? "")).join(" · ")}</p>
            <details className="disclosure"><summary>Read the evidence and its limits</summary><DiligenceFacts facts={rows} /></details>
          </> : <p className="subtle-note">Not established in this saved report. {attempted ? "Research ran but did not establish an answer." : "A completed research pass is not recorded."}</p>}
        </section>;
      })}
    </div>
    {!hasFocused && relevant.some(fact => fact.predicate === "product") && <details className="disclosure"><summary>Previously recorded product evidence</summary><DiligenceFacts facts={relevant.filter(fact => fact.predicate === "product")} /></details>}
    <p className="subtle-note">A feature or company claim does not establish a durable moat. Mixer or pool design can combine with ZK, FHE, MPC or other techniques; the source must establish what each does and what remains visible.</p>
    <h3>Our assessment of the advantage</h3>
    <DiligenceHypotheses brief={brief ? { ...brief, hypotheses: brief.hypotheses.filter(h => h.topic !== "team_fit") } : undefined} />
  </Panel>;
}
