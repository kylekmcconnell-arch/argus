import { Database, FileMagnifyingGlass, ShieldCheck } from "@phosphor-icons/react";
import type { InvestigationDecisionCanvasProps } from "../../components/InvestigationDecisionCanvas";

function ScoreRecord({ label, score, verdict }: { label: string; score: number | null; verdict: string }) {
  return (
    <div className="raw-evidence-score">
      <span className="mono">{label}</span>
      <strong>{score == null ? "Not measured" : `${score} / 100`}</strong>
      <small>{score == null ? "No completed score exists in this saved report." : verdict}</small>
    </div>
  );
}

/** A verification header for the forensic record, not a fourth editorial story. */
export function RawEvidenceDecisionCanvas(props: InvestigationDecisionCanvasProps) {
  const {
    subjectName,
    verdictLabel,
    score,
    scoreLabel = "ARGUS risk score",
    secondaryScore,
    successful,
    applicable,
    coveragePercent,
    capturedAt,
    verified,
    supports,
    concerns,
    evidenceHref = "#token-evidence",
    methodologyHref = "#token-methodology",
    checkScopeLabel = "Required report checks",
  } = props;
  const complete = applicable > 0 && successful >= applicable;

  return (
    <section id="report-summary" className="raw-evidence-opening report-section scroll-mt-28" data-raw-evidence-record="true">
      <header>
        <div>
          <p className="eyebrow text-signal-lift">Verification view</p>
          <h1>{subjectName?.replace(/[.\s]+$/, "") || "Saved ARGUS report"}</h1>
          <p>
            This view exposes the saved scan record without adding a lane-specific narrative.
            Production, Kyle, and Enigma interpret these same frozen inputs.
          </p>
        </div>
        <span className="raw-evidence-badge mono"><Database size={16} weight="duotone" />Raw evidence</span>
      </header>

      <div className="raw-evidence-score-grid">
        <ScoreRecord label={scoreLabel} score={score} verdict={verdictLabel} />
        {secondaryScore && (
          <ScoreRecord label={secondaryScore.label} score={secondaryScore.score} verdict={secondaryScore.verdictLabel} />
        )}
      </div>

      <dl className="raw-evidence-ledger">
        <div><dt><ShieldCheck size={17} weight="duotone" />Check coverage</dt><dd>{successful}/{applicable} {checkScopeLabel.toLowerCase()} · {coveragePercent}%</dd></div>
        <div><dt><FileMagnifyingGlass size={17} weight="duotone" />Saved evidence</dt><dd>{verified.length} verified · {supports.length} supportive · {concerns.length} adverse</dd></div>
        <div><dt>Record state</dt><dd>{complete ? "Required checks complete" : "Required checks incomplete"}{capturedAt ? ` · captured ${capturedAt}` : ""}</dd></div>
      </dl>

      <nav aria-label="Raw evidence shortcuts">
        <a href={evidenceHref}>Open evidence ledger</a>
        <a href={methodologyHref}>Open method and sources</a>
      </nav>
    </section>
  );
}
