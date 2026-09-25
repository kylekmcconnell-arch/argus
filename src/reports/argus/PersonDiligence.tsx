import { PERSON_DILIGENCE_TOPICS } from "../../lib/diligenceTopics";
import { personLenses, PERSON_LENSES, personRelationshipGraph, personIdentityStatus } from "../../lib/personDiligence";
import { DiligenceHypotheses } from "./DiligenceHypotheses";
import type { BasicFactView } from "../../components/BasicFactsPanel";
import type { ReportView } from "./view";
import type { Dossier } from "../../data/dossier";
import { Badge, ChapterHead, ExtLink, Panel } from "./primitives";

export const PERSON_DILIGENCE_SECTIONS: ReadonlyArray<{ title: string; predicates: string[]; gap: string }> = [
  { title: "Current role and responsibility", predicates: ["current_role", "executive"], gap: "Current employer, role scope and dates are not established in this report." },
  { title: "Ventures and outcomes", predicates: ["founder", "founded", "exit", "track_record", "investor"], gap: "Prior ventures, personal contribution and outcomes need source-backed research." },
  { title: "Co-founders and collaborators", predicates: ["partnership"], gap: "No sourced collaboration history is recorded. Follows and co-mentions do not establish a working relationship." },
  { title: "Engineering and shipped work", predicates: ["repository", "product"], gap: "No attributable code or shipped-work evidence is recorded. Private code is not evidence of poor engineering." },
  { title: "Experience and credentials", predicates: ["prior_role", "education"], gap: "Education, prior work, relevant public military service and accolades have not been established. Prestige alone does not establish role fit." },
  { title: "Legal and regulatory record", predicates: ["legal_regulatory_event"], gap: "No attributable finding is recorded here. This is not a completed background check or an all-clear." },
  { title: "Disclosed wallets, control and conflicts", predicates: ["treasury", "control", "governance", "conflict_of_interest"], gap: "Wallet ownership and control are not established here. Transfers and third-party labels alone do not prove ownership or wrongdoing." },
];

export function DiligenceFacts({ facts }: { facts: BasicFactView[] }) {
  return <>{facts.map(fact => <div className="product-claim" key={fact.factId}>
    <strong>{String(fact.value ?? "Unresolved")}</strong>{" "}<Badge>{fact.status === "verified" ? "Source-backed" : fact.status}</Badge>
    {fact.qualifier && <p>{fact.qualifier}</p>}
    {fact.eventStatus && <p>Recorded event status: {fact.eventStatus}</p>}
    {fact.attributedEntity && <p>Attributed to: {fact.attributedEntity}</p>}
    {(fact.sources ?? []).map((source, index) => <p key={`${source.url}:${index}`}>
      {source.excerpt}{" "}<ExtLink href={source.url ?? "#"}>{source.relation === "contradicts" ? "Contradicting source" : "Source"}</ExtLink>
      {source.capturedAt && <small> · Captured {source.capturedAt.slice(0, 10)}</small>}
    </p>)}
  </div>)}</>;
}

export function PersonDiligence({ dossier, facts, websiteClaims = [] }: { dossier: Dossier; facts: BasicFactView[]; websiteClaims?: ReportView["product"]["claims"] }) {
  const lenses = personLenses(dossier);
  const relationships = personRelationshipGraph(dossier);
  const identities = facts.filter(fact => fact.predicate === "official_identity");
  const identity = personIdentityStatus(dossier);
  return <>
    <ChapterHead eyebrow={lenses.map(lens => PERSON_LENSES[lens].title).join(" · ")} title="Identity, contribution and track record."
      description="Assess responsibility and evidence in the person's actual role: founder, executive, engineer, employee or investor. Company outcomes are context; personal contribution requires its own evidence." />
    <div className="diligence-grid">{lenses.map(lens => <Panel key={lens}><div className="eyebrow">{PERSON_LENSES[lens].title} assessment</div><h2>{PERSON_LENSES[lens].question}</h2><p>{PERSON_LENSES[lens].evidence}</p></Panel>)}</div>
    <Panel className="space-top"><h2>Public identity</h2><Badge>{identity.label}</Badge>
      <p>{identity.detail}</p>
      <p>{dossier.identity_note}</p><DiligenceFacts facts={identities} />
    </Panel>
    {websiteClaims.length > 0 && <Panel className="space-top"><h2>Public professional footprint</h2>
      {websiteClaims.map(claim => <div className="product-claim" key={claim.key}><strong>{claim.title}</strong><p>{claim.text}</p><Badge tone={claim.badge.tone}>{claim.badge.label}</Badge>{claim.sourceUrl && <ExtLink href={claim.sourceUrl}>Source</ExtLink>}</div>)}
    </Panel>}
    <Panel className="space-top"><h2>Evidence-based role fit</h2><DiligenceHypotheses brief={dossier.diligenceBrief} /></Panel>
    {relationships.length > 0 && <Panel className="space-top"><h2>Relationship history</h2><p>Each connection retains its role, period and source. Unresolved counterparty names are not merged across reports.</p>
      <div className="diligence-table-wrap"><table className="diligence-table"><thead><tr><th>Venture or collaborator</th><th>Relationship</th><th>Period and outcome</th><th>Evidence</th></tr></thead><tbody>
        {relationships.map(edge => <tr key={edge.id}><td>{edge.target}</td><td>{edge.relation}</td><td>{edge.period || "Dates not established"}<small>{edge.status}</small></td><td>{edge.sources.map((source, index) => <p key={index}><ExtLink href={source.url}>Source {index + 1}</ExtLink>{source.capturedAt && <small>{source.capturedAt.slice(0, 10)}</small>}</p>)}</td></tr>)}
      </tbody></table></div></Panel>}
    {dossier.githubAssessment?.confidence === "gold" && <Panel className="space-top"><h2>Attributed GitHub work</h2><ExtLink href={`https://github.com/${dossier.githubAssessment.login}`}>{dossier.githubAssessment.login}</ExtLink>
      <p>{dossier.githubAssessment.summary}</p><p>Coverage: {dossier.githubAssessment.repoSampleState ?? "Scope not recorded"}. Repository visibility and stars do not establish individual engineering ability.</p>
      {dossier.githubAssessment.notableRepos.map(repo => <p key={repo.name}><ExtLink href={repo.url}>{repo.name}</ExtLink></p>)}
    </Panel>}
    <Panel className="space-top"><h2>Research coverage</h2><details className="disclosure"><summary>What was investigated, and what remains open</summary>
      {PERSON_DILIGENCE_TOPICS.map(topic => {
        const entry = dossier.basicFactQuestionLedger?.find(row => row.questionId.endsWith(`.diligence_${topic.id}`));
        const attempted = entry?.providerRuns.some(run => !["skipped", "failed"].includes(run.state));
        return <div className="coverage-row" key={topic.id}><span>{topic.title}</span><strong>{entry?.status === "answered" ? "Source-backed answer" : attempted ? "Researched, still unresolved" : entry?.providerRuns.some(run => run.state === "failed") ? "Research unavailable" : "Not recorded as researched"}</strong></div>;
      })}
    </details></Panel>
    {PERSON_DILIGENCE_SECTIONS.map(section => {
      const rows = facts.filter(fact => section.predicates.includes(fact.predicate));
      return <Panel className="space-top" key={section.title}><h2>{section.title}</h2>
        {rows.length ? <DiligenceFacts facts={rows} /> : <p className="status-box">{section.gap}</p>}
      </Panel>;
    })}
  </>;
}
