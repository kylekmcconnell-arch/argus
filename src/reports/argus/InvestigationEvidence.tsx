import type { PersonInvestigation } from "../../lib/personInvestigation";
import type { DiligenceProviderReceipt } from "../../lib/diligenceProviders";
import { Badge, ExtLink, Panel } from "./primitives";

export function ProviderDiscovery({ receipts }: { receipts?: DiligenceProviderReceipt[] }) {
  if (!receipts?.length) return <p className="subtle-note">Specialist database research is not recorded in this version.</p>;
  return <>{receipts.map(receipt => <section className="diligence-card" key={receipt.provider}><h3>{receipt.provider === "openalex" ? "Research and publications" : "Public case records"}</h3>
    <Badge>{({ not_configured: "Access not configured", not_applicable: "Context insufficient or not applicable", completed: "Unverified source leads", empty: "No hits in this bounded search", unavailable: "Source unavailable" })[receipt.status]}</Badge>
    <p>{receipt.note}</p><small>Captured {receipt.capturedAt.slice(0, 10)}</small>
    {receipt.candidates.map(candidate => <div key={candidate.id}><h4><ExtLink href={candidate.url}>{candidate.title}</ExtLink></h4><p>{candidate.excerpt}</p><Badge>Identity attribution unresolved</Badge></div>)}
  </section>)}</>;
}
export function InvestigationEvidence({ investigation, receipts }: { investigation?: PersonInvestigation; receipts?: DiligenceProviderReceipt[] }) {
  return <>
    <Panel className="space-top"><h2>Career evidence and unresolved questions</h2>
      {!investigation ? <p>A structured career investigation is not saved in this version. Existing evidence remains available below.</p> : <>
        <p>{investigation.note}</p>
        {investigation.timeline.length === 0 && <p>No account-bound career records were established. This is not a finding of no experience.</p>}
        {investigation.timeline.map(entry => <article className="diligence-card" key={entry.factId}><h3>{entry.claim}</h3><Badge>{entry.status === "conflicted" ? "Conflicting evidence" : "Sourced claim"}</Badge>
          <p>Period or qualification: {entry.period}</p><small>Evidence captured: {entry.recordedAt?.slice(0, 10) ?? "Not recorded"}; this is not the event date.</small>
          <details className="disclosure"><summary>Evidence and competing accounts</summary>{entry.sources.map((source, i) => <p key={i}>{source.excerpt}{" "}<ExtLink href={source.url}>{source.relation === "contradicts" ? "Contradicting source" : "Source"}</ExtLink></p>)}</details>
        </article>)}
        <h3>Highest-value follow-up questions</h3><ul>{investigation.questions.map(question => <li key={question.id}><strong>{question.question}</strong> {question.reason}</li>)}</ul>
        <details className="disclosure"><summary>Reference-check preparation</summary><p>Questions for an explicitly authorized reference stage. No person has been contacted and no interview response is inferred.</p><ul>{investigation.referenceQuestions.map(question => <li key={question}>{question}</li>)}</ul></details>
      </>}
    </Panel>
    <Panel className="space-top"><h2>Specialist source discovery</h2><p>These sources can guide follow-up work. Their search results do not establish identity, accomplishments or adverse findings and do not affect the score.</p><ProviderDiscovery receipts={receipts} /></Panel>
  </>;
}
