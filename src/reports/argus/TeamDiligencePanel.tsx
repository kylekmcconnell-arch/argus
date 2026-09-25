import type { TeamDiligence } from "../../lib/relationshipDiligence";
import { RELATIONSHIPS } from "../../lib/relationshipDiligence";
import type { DiligenceBrief } from "../../lib/diligenceBrief";
import { DiligenceHypotheses } from "./DiligenceHypotheses";
import { Badge, ExtLink, Panel } from "./primitives";

export function TeamDiligencePanel({ team, brief, compact = false }: { team?: TeamDiligence; brief?: DiligenceBrief; compact?: boolean }) {
  if (!team) return <Panel className="space-top"><h2>Team ability and relationships</h2><p>This saved version predates structured relationship research or has no completed collection. A new investigation is required; missing roles are not evidence of an absent team.</p></Panel>;
  const concerns = team.relationships.filter(row => row.concern || row.support === "conflicted");
  return <Panel className="space-top team-diligence"><div className="eyebrow">People, responsibility and dependencies</div><h2>Can this team deliver?</h2>
    <p>{team.note}</p>
    <DiligenceHypotheses brief={brief ? { ...brief, hypotheses: brief.hypotheses.filter(h => h.topic === "team_fit") } : undefined} />
    {(team.linkedPeople?.length ?? 0) > 0 && <details className="disclosure"><summary>Prior person evidence informing this team ({team.linkedPeople!.length})</summary>{team.linkedPeople!.map(person => <article key={person.reportVersionId}><h3>@{person.handle.replace(/^@/, "")}</h3><p>{person.note} Source version {person.reportVersionId}, saved {person.capturedAt}.</p>{person.investigation.timeline.map(entry => <p key={entry.factId}>{entry.claim} · {entry.period}{entry.sources.map((source, i) => <span key={i}>{" "}<ExtLink href={source.url}>Source</ExtLink></span>)}</p>)}</article>)}</details>}
    {team.linkedPeopleStatus === "unavailable" && <p className="status-box">Earlier workspace person evidence could not be read. This is not an empty track record.</p>}
    {concerns.length > 0 && <p className="status-box">{concerns.length} relationship claim{concerns.length === 1 ? " needs" : "s need"} reconciliation. A claim/evidence mismatch is not by itself proof of deceptive intent.</p>}
    {compact ? <><p>{team.relationships.length} relationship records, including sourced claims and discovery leads. See People for scope, source details and unresolved responsibilities.</p>
      <ul>{team.questions.slice(0, 3).map(question => <li key={question}>{question}</li>)}</ul></> : <>
      <h3>Responsibility and demonstrated work</h3><p>These are diligence lenses, not a required headcount checklist. Relevance depends on the company's product and stage. A founder, advisor and contractor may cover different parts of the same function.</p>
      <div className="diligence-grid">{team.capabilities.map(capability => <section className="diligence-card" key={capability.function}><h4>{capability.function}</h4><p>{capability.assessment}</p>
        {capability.roleRefs.map(id => { const row = team.relationships.find(r => r.id === id); return row ? <p key={id}>{row.party} · {row.claim}</p> : null; })}
      </section>)}</div>
      <details className="disclosure" open><summary>Relationship evidence ({team.relationships.length})</summary>
      {team.relationships.length === 0 && <p>No eligible relationship evidence was captured.</p>}
      {team.relationships.map(row => <article className="diligence-card" key={row.id}><h3>{row.party}</h3><p>{row.claim}</p>
        <Badge>{row.support === "source_backed_claim" ? "Sourced claim" : row.support === "conflicted" ? "Conflicting sources" : "Discovery lead"}</Badge>
        <p>{row.classification.relationships.map(kind => RELATIONSHIPS[kind]).join(" · ")}</p>
        <p>Function: {row.classification.functions.join(", ") || "Unresolved"}. Capacity: {row.classification.capacity.replace(/_/g, " ")}. Timing: {row.classification.temporal.replace(/_/g, " ")}.</p>
        <p className="subtle-note">{row.classification.boundary === "internal_claim" ? "Internal role claimed" : row.classification.boundary === "external_claim" ? "External relationship claimed" : "Internal/external scope needs clarification"}. A role label does not establish investment, authority, payment, endorsement or present availability.</p>
        {row.concern && <p className="status-box">{row.concern.detail}</p>}
        <details className="disclosure"><summary>Sources and attribution limits</summary>{row.sources.length ? row.sources.map((source, index) => <p key={index}>{source.excerpt}{" "}<ExtLink href={source.url}>{source.relation === "contradicts" ? "Contradicting source" : "Source"}</ExtLink>{source.capturedAt && <small> · Captured {source.capturedAt.slice(0, 10)}</small>}</p>) : <p>No fetched role source is attached to this lead.</p>}
          <p>Counterparty: {row.partyKey.startsWith("local:") ? "Local record; not joined to other people or organizations by name." : "First-party account link; ongoing account ownership still requires evidence."}</p>
        </details>
      </article>)}</details>
      <h3>What would change the assessment?</h3><ul>{team.questions.map(question => <li key={question}>{question}</li>)}</ul>
    </>}
  </Panel>;
}
