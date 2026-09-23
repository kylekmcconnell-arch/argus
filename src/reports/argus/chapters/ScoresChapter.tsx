import { Fragment, useState, type ReactNode } from "react";
import { DisclosureButton, InlinePanel, InlineRow } from "../disclosure";
import { AuditList } from "../ArgusReportShell";
import { useArgusReport } from "../context";
import { Badge, ChallengeButton, ChallengePanel, ChallengeRow, ChapterHead, Panel } from "../primitives";
import { findingId, floorTo } from "../model";
import type { ReportView, ScoreRowView, ScoreView } from "../view";

function AxisDetail({ score, row }: { score: ScoreView; row: ScoreRowView }) {
  const report = useArgusReport();
  const challenge = {
    id: findingId("scores", `${score.id}-${row.key}`),
    title: `${row.label} · ${row.awarded}/${row.max}`,
    claim: `${score.eyebrow} · ${row.label}: ${row.awarded} of ${row.max} points. ${row.rationale}`,
  };
  return (
    <>
      <div className="eyebrow">{score.eyebrow} · Saved composition</div>
      <h2 className="dialog-title">{row.label}</h2>
      {row.applicability ? (
        <div className="score-number" style={{ fontSize: 26 }}>{row.note ?? "Not scored"}</div>
      ) : (
        <div className="score-number">{row.awarded}<span>/ {row.max} available points</span></div>
      )}
      <div className="dialog-section">
        <h3>Original saved explanation</h3>
        <p>{row.rationale || "The saved report records no explanation for this area."}</p>
      </div>
      <div className="dialog-section">
        <h3>What needs review</h3>
        {row.review.length ? (
          <ul className="compact-list">{row.review.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : (
          <p>No counter-evidence or open question is recorded for this area in the saved report.</p>
        )}
      </div>
      {row.band && (
        <p className="subtle-note">
          Evidence band: {row.band.min}–{row.band.max} of {row.max} points{row.band.tier ? ` (${row.band.tier.replace(/_/g, " ")})` : ""}. A band describes the range the evidence supports; it is not the awarded score.
        </p>
      )}
      {row.supportCount != null && (
        <p className="subtle-note">
          {row.supportCount} supporting reference{row.supportCount === 1 ? "" : "s"} recorded. This is not a count of independent confirmations.
        </p>
      )}
      {row.chapter && (
        <p style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => report.goTo(row.chapter!)}>Explore related evidence →</button>
        </p>
      )}
      <p className="subtle-note">Awarded points are shown exactly as saved. A review note never replaces a disputed score input.</p>
      <ChallengeButton target={challenge} />
      <ChallengePanel target={challenge} />
    </>
  );
}

/** Awarded / available points from the saved composition, never band ceilings. */
export function ScoreTable({ score, scope }: { score: ScoreView; scope: "breakdown" | "chapter" }) {
  const scored = score.rows.filter((row) => !row.applicability);
  const awarded = scored.reduce((sum, row) => sum + row.awarded, 0);
  const max = scored.reduce((sum, row) => sum + row.max, 0);
  return (
    <table className="score-table">
      <thead>
        <tr><th>Scoring area</th><th>Earned / available</th><th>Review</th></tr>
      </thead>
      <tbody>
        {score.rows.map((row) => {
          const axisId = `axis:${scope}:${score.id}:${row.key}`;
          const challenge = {
            id: findingId("scores", `${score.id}-${row.key}`),
            title: `${row.label} · ${row.awarded}/${row.max}`,
            claim: `${score.eyebrow} · ${row.label}: ${row.awarded} of ${row.max} points. ${row.rationale}`,
          };
          return (
            <Fragment key={row.key}>
              <tr>
                <td>
                  <DisclosureButton id={axisId} className="score-row-btn">{row.label}</DisclosureButton>
                  {row.applicability ? (
                    <span className="score-row-note">{row.note ?? "Not scored in this report"}</span>
                  ) : (
                    <div className="mini-bar" aria-hidden="true"><i style={{ width: `${row.max > 0 ? Math.min(100, (row.awarded / row.max) * 100) : 0}%` }} /></div>
                  )}
                </td>
                <td className="num">{row.applicability ? <small>n/a</small> : <>{row.awarded} <small>/ {row.max}</small></>}</td>
                <td>
                  <DisclosureButton id={axisId} className="textbtn" aria-label={`Explain ${row.label}`}>↗</DisclosureButton>
                  {scope === "chapter" && <ChallengeButton target={challenge} />}
                </td>
              </tr>
              <InlineRow id={axisId} label={row.label} colSpan={3}>{() => <AxisDetail score={score} row={row} />}</InlineRow>
              {scope === "chapter" && <ChallengeRow target={challenge} colSpan={3} />}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td>Saved total</td>
          <td className="num">{score.score != null && !score.withheldReason ? `${score.score} / 100` : `${awarded} / ${max}`}</td>
          <td><Badge tone={score.tone}>{score.verdictWord}</Badge></td>
        </tr>
      </tfoot>
    </table>
  );
}

const ILLUSTRATIONS = [
  { value: "live", label: "Live-token company: all scored areas" },
  { value: "tokenless", label: "Tokenless company: omit token conduct" },
  { value: "unavailable", label: "Decision-critical collection unavailable" },
  { value: "person", label: "Person investigation" },
] as const;

function Applicability({ view }: { view: ReportView }) {
  const [mode, setMode] = useState<(typeof ILLUSTRATIONS)[number]["value"]>("live");
  const app = view.applicability;
  let result: ReactNode;
  if (mode === "live") {
    result = app
      ? <>{app.total} / {app.max} = <strong>{(app.max > 0 ? (app.total / app.max) * 100 : 0).toFixed(2)}</strong>. {view.subjectName}'s saved model includes every scored area.</>
      : <>This saved report does not expose an applicable company composition.</>;
  } else if (mode === "tokenless") {
    if (app?.excluded) {
      result = <>{app.excluded}</>;
    } else if (app && app.tokenMax > 0) {
      const value = ((app.total - app.tokenAwarded) / (app.max - app.tokenMax)) * 100;
      result = <>Illustration: ({app.total} − {app.tokenAwarded}) / ({app.max} − {app.tokenMax}) × 100 = <strong>{floorTo(value, 2).toFixed(2)}</strong>, or {Math.round(value)} if rounded to the nearest integer. A real tokenless company must be assessed on its own evidence.</>;
    } else {
      result = <>This report has no token-conduct area to omit.</>;
    }
  } else if (mode === "unavailable") {
    result = <><strong>INCOMPLETE · score withheld</strong> where a required decision review cannot finish. An unavailable dimension is not automatically removed from the denominator.</>;
  } else {
    result = <><strong>Use the PERSON methodology.</strong> Do not reuse company weights or attach a venture's token as the person's canonical asset.</>;
  }
  return (
    <Panel challenge={{ id: findingId("scores", "applicability"), title: "Applicability changes the denominator", claim: "Applicability rules for the saved composition and the tokenless, incomplete and person illustrations." }}>
      <div className="eyebrow">Model rules</div>
      <h3 style={{ marginTop: 10 }}>Applicability changes the denominator</h3>
      <p>For a genuinely tokenless company, exclude the inapplicable token dimension. Do not award zero points and do not treat an unavailable check as inapplicable.</p>
      <div className="formula">100 × Σ earned applicable points<br />÷ Σ applicable maximum points</div>
      <label className="eyebrow" htmlFor="rd-applicability">Illustration only, not a rescore of {view.subjectName}</label>
      <select className="search" style={{ marginTop: 10, width: "100%" }} id="rd-applicability" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
        {ILLUSTRATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <div className="status-box" aria-live="polite">{result}</div>
      <p className="subtle-note">A person needs the person methodology. Listed companies need applicable equity evidence. Coming-token and deferred states need explicit rules. The weakest applicable lens and safety caps are recorded by the scoring engine, not inferred from this display.</p>
    </Panel>
  );
}

export function ScoresChapter({ view, legacy }: { view: ReportView; legacy?: ReactNode }) {
  const scores = [view.primary, view.tokenScore].filter((score): score is ScoreView => Boolean(score));
  return (
    <>
      <ChapterHead
        eyebrow="Score transparency"
        title="One score. One calculation."
        description="The saved scores are preserved. Every row below uses the awarded points and maximum from the saved score composition, not evidence-band ceilings."
        action={view.issues.length > 0 ? <DisclosureButton id="scores-audit" className="btn">Open scoring audit ↗</DisclosureButton> : undefined}
      />
      <InlinePanel id="scores-audit" label="Scoring audit">{() => <AuditList issues={view.issues} critical={false} />}</InlinePanel>
      <div className="chapter-grid">
        {scores.map((score) => (
          <section className="panel" key={score.id}>
            <div className="section-top">
              <h2>{score.eyebrow}</h2>
              <Badge tone={score.tone}>
                {score.score != null && !score.withheldReason && !score.deferredReason
                  ? `${score.score} / 100 · ${score.provisional ? "provisional" : "saved"}`
                  : score.deferredReason ? score.verdictWord : "Score withheld"}
              </Badge>
            </div>
            {score.rows.length > 0
              ? <ScoreTable score={score} scope="chapter" />
              : <p className="status-box">{score.deferredReason ?? score.withheldReason ?? "No scoring composition is saved for this score."}</p>}
            <p className="subtle-note">{score.arithmetic}</p>
            {score.scaleNote && <p className="subtle-note">{score.scaleNote}</p>}
          </section>
        ))}
        {scores.length === 0 && <p className="status-box">This saved report does not contain a published score.</p>}
      </div>
      <div className="chapter-grid space-top">
        {view.bands.length > 0 ? (
          <Panel challenge={{ id: findingId("scores", "evidence-bands"), title: "Evidence ranges are not awarded points", claim: view.bands.map((band) => `${band.label}: awarded ${band.awarded}/${band.max}, evidence band ${band.band}`).join("; ") }}>
            <div className="eyebrow">Evidence bands</div>
            <h3 style={{ marginTop: 10 }}>Evidence ranges are not awarded points</h3>
            <div className="table-wrap">
              <table className="plain-table">
                <thead><tr><th>Area</th><th>Awarded</th><th>Evidence band</th></tr></thead>
                <tbody>
                  {view.bands.map((band) => (
                    <tr key={band.label}><td>{band.label}</td><td>{band.awarded}/{band.max}</td><td>{band.band}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle-note">A band is the range the collected evidence supports for an area. The awarded points come from the saved composition. Scores, weights and evidence confidence stay separate, and a band ceiling is never used as the score or the denominator.</p>
          </Panel>
        ) : null}
        {view.subjectKind !== "token" && <Applicability view={view} />}
      </div>
      {legacy}
    </>
  );
}
