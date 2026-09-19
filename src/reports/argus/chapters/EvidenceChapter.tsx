import { useMemo, useState, type ReactNode } from "react";
import { DisclosureButton, InlinePanel } from "../disclosure";
import { useArgusReport } from "../context";
import { Badge, ChallengeButton, ChallengePanel, ChapterHead, ExtLink, Panel } from "../primitives";
import { exactPercent, findingId, questionIsOpen, questionStatusLabel, questionStatusTone, utcStamp } from "../model";
import type { QuestionView, ReportView, SourceCard } from "../view";

export function QuestionRows({ questions, filter }: { questions: QuestionView[]; filter: string }) {
  const rows = questions.filter((question) => filter === "All"
    || (filter === "Open" ? questionIsOpen(question.state) : questionStatusLabel(question.state) === filter));
  if (!rows.length) return <p className="empty">No questions match this status.</p>;
  return (
    <>
      {rows.map((question) => (
        <div className="question" key={question.id}>
          <div>
            <Badge tone={questionStatusTone(question.state)}>{questionStatusLabel(question.state)}</Badge>
            <small>{question.domain.replace(/_/g, " ")}{question.materiality === "critical" ? " · decision-critical" : ""}</small>
          </div>
          {question.prompt}
        </div>
      ))}
    </>
  );
}

function SourceCardView({ source }: { source: SourceCard }) {
  const report = useArgusReport();
  const panelId = `source:${source.id}`;
  const challenge = { id: findingId("evidence", `source-${source.id}`), title: source.title, claim: `${source.id} · ${source.tier}. ${source.excerpt}` };
  return (
    <>
      <article className="source">
        <div className="eyebrow">{source.id} · {source.tier}</div>
        <h3>{source.title}</h3>
        {source.excerpt && <p>{source.excerpt.length > 320 ? `${source.excerpt.slice(0, 319)}…` : source.excerpt}</p>}
        <DisclosureButton id={panelId} className="textbtn">Read source scope ↗</DisclosureButton>
        <ChallengeButton target={challenge} />
      </article>
      <InlinePanel id={panelId} label={source.title}>
        {() => (
          <>
            <Badge tone={source.tone ?? "amber"}>{source.tier}</Badge>
            <h2 className="dialog-title">{source.title}</h2>
            {source.excerpt && <p className="dialog-body">{source.excerpt}</p>}
            <div className="dialog-section">
              <h3>Source handling</h3>
              <p>
                Recorded {source.provider ? `by ${source.provider} ` : ""}in this saved report{source.evidenceState ? ` as ${source.evidenceState.toLowerCase()}` : ""}
                {source.capturedAt ? `, captured ${utcStamp(source.capturedAt)}` : ", with no capture time recorded"}. The tier describes the source's scope and limits; a verified artifact does not make every claim in it independently verified.
              </p>
            </div>
            {source.url
              ? <ExtLink href={source.url}>Open recorded source</ExtLink>
              : <p className="status-box">This record has no direct public artifact link. Its receipt stays in the saved report payload.</p>}
            <div className="dialog-section">
              <h3>Saved context</h3>
              <p>
                {report.version ? `Report v${report.version}` : "Saved report"}{report.savedAt ? ` · ${utcStamp(report.savedAt)}` : ""}
                {report.caseLabel ? <><br />Case {report.caseLabel}</> : null}
                <br />Report {report.auditId}
              </p>
            </div>
            <p className="subtle-note">Original links may now show newer content; they are not substitutes for the frozen artifact.</p>
          </>
        )}
      </InlinePanel>
      <ChallengePanel target={challenge} />
    </>
  );
}

const QUESTION_FILTERS = ["All", "Partly answered", "Not established", "Not checked", "Source unavailable", "Reported", "Answered"] as const;

export function EvidenceChapter({ view, legacy, current }: { view: ReportView; legacy?: ReactNode; current?: ReactNode }) {
  const evidence = view.evidence;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("All");
  const sources = useMemo(() => evidence.sources.filter((source) =>
    `${source.id} ${source.title} ${source.tier} ${source.excerpt} ${source.provider ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())), [evidence.sources, query]);
  const openQuestions = evidence.questions.filter((question) => questionIsOpen(question.state)).length;
  const presentFilters = QUESTION_FILTERS.filter((value) => value === "All" || evidence.questions.some((question) => questionStatusLabel(question.state) === value));
  const collection = evidence.collection;
  return (
    <>
      <ChapterHead
        eyebrow="Evidence & methodology"
        title="Know what is known. Keep the gaps visible."
        description="Collection completion, verified answers and investment readiness are separate measures. No missing fact is converted into zero or a clean result."
      />
      <div className="chapter-grid">
        <Panel challenge={{ id: findingId("evidence", "coverage"), title: "Coverage", claim: `${collection ? `${collection.successful}/${collection.applicable} collection checks` : "no collection checks"}; ${openQuestions}/${evidence.questions.length} questions open.` }}>
          <h2>Coverage, honestly labeled</h2>
          {collection && (
            <>
              <div className="coverage-row"><span>Collection checks finished</span><strong>{collection.successful} / {collection.applicable}</strong></div>
              <div className="coverage-row"><span>Exact completion arithmetic</span><strong>{exactPercent(collection.successful, collection.applicable) ?? "n/a"}</strong></div>
            </>
          )}
          {evidence.questions.length > 0 && (
            <div className="coverage-row"><span>Diligence questions wholly or partly open</span><strong>{openQuestions} / {evidence.questions.length}</strong></div>
          )}
          {evidence.referenceCount > 0 && (
            <div className="coverage-row"><span>Source references / unique artifacts</span><strong>{evidence.referenceCount} / {evidence.uniqueArtifacts}</strong></div>
          )}
          {evidence.referenceCount > 0 && (
            <div className="coverage-row"><span>References without recorded capture time</span><strong>{evidence.missingCaptureTime}</strong></div>
          )}
          <p className="subtle-note">These are different ledgers, not interchangeable denominators. A completed collection can still produce a partial answer.</p>
        </Panel>
        <Panel challenge={{ id: findingId("evidence", "critical-gaps"), title: "Decision-critical gaps", claim: evidence.criticalGaps.join("; ") }}>
          <h2>Decision-critical gaps</h2>
          {evidence.criticalGaps.length
            ? <ul className="compact-list" style={{ marginTop: 12 }}>{evidence.criticalGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
            : <p style={{ marginTop: 12 }}>No decision-critical gap is recorded in the saved question ledger.</p>}
          {evidence.providerIssues.length > 0 && (
            <div className="status-box">
              <strong>Provider issues:</strong> {evidence.providerIssues.join(" ")} These are report limitations, not adverse findings about the subject.
            </div>
          )}
        </Panel>
      </div>

      <section className="space-top">
        <div className="toolbar">
          <h2>The source room</h2>
          <input className="search" aria-label="Search sources" placeholder="Search sources and evidence…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <p className="subtle-note" style={{ margin: "0 0 18px" }}>
          {evidence.sources.length} source record{evidence.sources.length === 1 ? "" : "s"} from the saved report. Original links may now show newer content; they are not substitutes for the frozen artifacts.
        </p>
        <div className="source-list">
          {sources.map((source) => <SourceCardView key={source.id} source={source} />)}
        </div>
        {sources.length === 0 && <p className="empty">No evidence records match your search.</p>}
      </section>

      {evidence.questions.length > 0 && (
        <section className="panel space-top">
          <div className="toolbar" style={{ marginTop: 0 }}>
            <div>
              <h2>All {evidence.questions.length} diligence questions</h2>
              <p style={{ marginTop: 7 }}>Status preserved from the saved question ledger.</p>
            </div>
            <select className="search" aria-label="Filter question status" value={filter} onChange={(event) => setFilter(event.target.value)}>
              {presentFilters.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <QuestionRows questions={evidence.questions} filter={filter} />
        </section>
      )}

      <Panel className="space-top">
        <h2>How this report handles uncertainty</h2>
        <div className="chapter-grid" style={{ marginTop: 18 }}>
          <div>
            <h3>Scores remain immutable</h3>
            <p>{[view.totals.company, view.totals.token].filter(Boolean).join(" and ") || "The saved results"} {[view.totals.company, view.totals.token].filter(Boolean).length > 1 ? "are" : "is"} the saved result. Review warnings do not silently change them. A corrected assessment needs reconciled evidence and a new version.</p>
            <h3 style={{ marginTop: 20 }}>Claims retain their source tier</h3>
            <p>First-party statements, provider attribution, direct measurements and uncorroborated leads have distinct labels. A verified artifact is not automatically a verified claim.</p>
          </div>
          <div>
            <h3>Applicability comes before scoring</h3>
            <p>Tokenless, token-coming, listed, private-company and person reports use the dimensions that apply to them. Truly inapplicable weights are excluded; unavailable evidence is disclosed.</p>
            <h3 style={{ marginTop: 20 }}>No universal investment grade</h3>
            <p>Token mechanics and company quality answer different questions. A passing score is not a return forecast, and serious conflicts are disclosed before a decision.</p>
          </div>
        </div>
      </Panel>
      {current}
      {legacy}
    </>
  );
}
