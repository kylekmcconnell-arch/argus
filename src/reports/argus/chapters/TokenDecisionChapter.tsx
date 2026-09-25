import type { ReactNode } from "react";
import type { TokenDossier } from "../../../token/audit";
import type { InvestigationDecisionCanvasProps, DecisionCanvasCompositionRow } from "../../shared/reportLaneRendererTypes";
import { DecisionChapter, type DecisionView } from "./DecisionChapter";
import { DisclosureButton, InlinePanel } from "../disclosure";
import { plainDecisionText } from "../../../lib/plainDecisionText";
import { ReviewBanner, ChallengeButton, ChallengePanel } from "../primitives";
import type { LensView, ScoreView } from "../view";

interface Props extends InvestigationDecisionCanvasProps {
  token: TokenDossier;
  website?: string | null | undefined;
  xHandle?: string | null | undefined;
  additionalLinks?: Array<{ label: string; url: string }> | undefined;
  openChecks: Array<{ label: string; note?: string | undefined }>;
  snapshot?: { version: number; createdAt: string } | null | undefined;
  currentDataEnabled: boolean;
  onCheckCurrentData: () => void;
  privateReport: boolean;
  saving: boolean;
  persistenceFailed: boolean;
  /** Sanitized server-side cause of a failed save, shown under the not-saved notice. */
  persistenceFailedReason?: string | undefined;
  /** A live overlay on the saved verdict (the community-graph RingAlert).
   * Rendered at chapter level beside the score cards, never inside a
   * disclosure: a verdict-changing warning must be visible without a click. */
  verdictOverlay?: ReactNode;
  /** Case detail the chapters do not carry. Omit it when there is nothing to
   * show; any node here, even an empty fragment, renders the "full case"
   * disclosure. */
  legacy?: ReactNode;
  notices?: import("../../../lib/reportInsights").NoticedSignal[];
  error?: string | null | undefined;
  liveNotice?: boolean;
  identityNote?: string;
}

function rows(items: DecisionCanvasCompositionRow[] = []): ScoreView["rows"] {
  return items.map(row => ({
    key: row.axis, label: row.label, awarded: row.score, max: row.weight,
    rationale: row.rationale, review: [],
    ...(row.supportCount != null ? { supportCount: row.supportCount } : {}),
    ...(row.applicability ? { applicability: row.applicability } : {}),
    chapter: "scores",
  }));
}

function arithmetic(items: ScoreView["rows"]): string {
  const assessed = items.filter(row => !row.applicability);
  const awarded = assessed.reduce((sum, row) => sum + row.awarded, 0);
  const max = assessed.reduce((sum, row) => sum + row.max, 0);
  return max > 0
    ? `${awarded} of ${max} available points in assessed areas, before normalization and any saved safety limit. The displayed score remains the saved result.`
    : "No scored dimensions were saved. No replacement score has been calculated.";
}

/** Presentation adapter only. Both contract-entry paths use the approved
 * project-report chapter, never a second interpretation of its design. */
export function tokenDecisionView(p: Props): DecisionView {
  const tokenRows = rows(p.composition);
  const tokenScore: ScoreView = {
    id: "token", eyebrow: "Token safety", score: p.score, verdict: p.verdictLabel,
    verdictWord: p.verdictLabel,
    tone: p.scoreIsProvisional ? "amber" : p.favorable ? "green" : p.verdictTone === "avoid" ? "red" : "amber",
    foot: p.scoreContext ?? "Token mechanics and market evidence. This does not assess the quality of the project.",
    rows: tokenRows, arithmetic: arithmetic(tokenRows), provisional: Boolean(p.scoreIsProvisional),
    status: p.applicable > 0 ? `${p.successful}/${p.applicable} required checks complete${p.scoreIsProvisional ? " · provisional" : ""}` : "Check coverage was not recorded.",
  };
  const project = p.secondaryScore;
  const projectRows = rows(project?.composition);
  const projectScore: ScoreView = {
    id: "company", eyebrow: "Project diligence", score: project?.score ?? null,
    verdict: project?.verdictLabel ?? null,
    verdictWord: project?.score == null ? "Not assessed" : project.scoreIsProvisional ? "Review with gaps" : project.verdictLabel,
    tone: project?.score == null || project.scoreIsProvisional ? "amber" : project.verdictLabel === "PASS" ? "green" : ["FAIL", "AVOID", "BLOCKED"].includes(project.verdictLabel) ? "red" : "amber",
    foot: project?.context ?? "What the project does, who operates it, and the evidence supporting its claims.",
    rows: projectRows, arithmetic: arithmetic(projectRows), provisional: project?.scoreIsProvisional ?? true,
    ...(project?.score == null ? { withheldReason: project?.unavailableCopy ?? "No project assessment was saved. The token score does not establish product quality or team identity." } : {}),
  };
  const concerns = p.concerns.map(item => [item.label, item.detail].filter(Boolean).join(" "));
  const support = p.supports[0];
  const taskRows = p.nextSteps.slice(0, 3).map((item, i) => ({ id: `token-follow-up-${i}`, title: item.label, ...(item.detail ? { detail: item.detail } : {}), chapter: "evidence" as const }));
  const lenses: LensView[] = (["Investor", "Trader", "Founder"] as const).map(key => ({
    key, eyebrow: `${key} perspective`,
    title: p.scoreIsProvisional ? "Required evidence remains open." : `${p.verdictLabel}: the saved token assessment`,
    body: p.reportSummary || p.argument?.againstLine || concerns[0] || "Read the saved findings alongside their evidence coverage.",
    foundation: support ? { text: [support.label, support.detail].filter(Boolean).join(" "), sources: [] } : null,
    uncertainty: concerns.length ? { title: "The material uncertainty", text: concerns[0]!, detail: <ul>{concerns.map((text, i) => <li key={i}>{text}</li>)}</ul>, chapter: "evidence" } : null,
    change: p.nextSteps[0] ? { text: p.nextSteps[0].label } : null,
    nextHeading: key === "Founder" ? "Evidence to make available" : key === "Trader" ? "Checks before relying on this token assessment" : "Evidence needed for a project decision",
    tasks: taskRows,
  }));
  return {
    subjectName: p.subjectName || p.token.name || p.token.symbol,
    avatarUrl: p.token.imageUrl, eyebrow: "Token investigation",
    summary: p.subjectSummary ? (p.subjectSummary.match(/[^.!?]+[.!?](?:\s|$)/g)?.slice(0, 2).join(" ").trim() || p.subjectSummary) : "No source-backed product description was saved. Project purpose and token mechanics remain separate questions.",
    website: p.website, xHandle: p.xHandle ?? p.token.projectX ?? p.token.cg?.twitter,
    additionalLinks: p.additionalLinks ?? p.token.socials,
    token: { symbol: p.token.symbol, address: p.token.address, chain: p.token.chain, pairAddress: p.token.pairAddress },
    primary: projectScore, tokenScore, issues: [], lenses, methodologyHref: p.methodologyHref ?? "#token-methodology",
    researchStatus: p.verified.slice(0, 3).map(item => ({ lead: plainDecisionText(item.label), text: plainDecisionText(item.detail ?? "") })),
    checkRail: { successful: p.successful, applicable: p.applicable, open: p.openChecks.map(check => ({ label: check.label, ...(check.note ? { note: check.note } : {}) })) },
    leadBanner: null,
    metrics: [{ label: "Checks finished", value: p.applicable > 0 ? `${p.successful}/${p.applicable}` : "Not recorded", note: "Completion is separate from evidence quality." }],
    evidence: { collection: { successful: p.successful, applicable: p.applicable }, questions: p.nextSteps.map((item, i) => ({ id: `token-question-${i}`, domain: "Token investigation", prompt: item.label, state: "unresolved" })) },
  };
}

export function TokenDecisionChapter(p: Props) {
  const view = tokenDecisionView(p);
  return <DecisionChapter view={view} onLensChange={key => p.onDecisionLensChange?.(key === "Investor" ? "investment" : key === "Trader" ? "alpha_research" : "general_diligence")} briefSupplement={<>
    {p.discovery && <section className="panel space-top"><div className="section-top"><h2>{plainDecisionText(p.discovery.headline)}</h2></div><p>{plainDecisionText(p.discovery.consequence)}</p><p className="subtle-note">{p.discovery.reversalCondition}</p><a className="textbtn" href={p.discovery.evidenceHref}>Open both records →</a>{p.discovery.receipts?.map(receipt => <p key={receipt.href}><a href={receipt.href} target="_blank" rel="noreferrer">{receipt.label}</a></p>)}</section>}
    <section id="report-risks" aria-label="Saved findings" className="space-top">
      <div className="brief-grid">
        {([{ title: "Main concerns", items: p.concerns }, { title: "What looks credible", items: p.supports }] as const).map(group => <div className="panel" key={group.title} aria-label={group.title}>
          <div className="section-top"><h2>{group.title}</h2></div>
          {group.items.length ? <ul className="compact-list" aria-label={group.title}>{group.items.map((item, i) => <li key={i}><strong>{plainDecisionText(item.label)}</strong>{item.detail && <p>{plainDecisionText(item.detail)}</p>}<ChallengeButton target={{ id: `token-finding-${group.title}-${i}`, title: item.label, claim: [item.label, item.detail].filter(Boolean).join(" ") }} /><ChallengePanel target={{ id: `token-finding-${group.title}-${i}`, title: item.label, claim: [item.label, item.detail].filter(Boolean).join(" ") }} /></li>)}</ul> : <p className="subtle-note">No finding was saved in this group. Check coverage before drawing a conclusion.</p>}
        </div>)}
      </div>
    </section>
    <section aria-label="Finished checks" className="panel space-top"><div className="section-top"><h2>Finished checks</h2></div><p>{p.successful}/{p.applicable} {(p.checkScopeLabel ?? "required checks").toLowerCase()} complete{p.scoreIsProvisional ? " · provisional" : ""}</p><ul className="compact-list">{p.verified.map((item, i) => <li key={i}><strong>{plainDecisionText(item.label)}</strong> {plainDecisionText(item.detail ?? "")}</li>)}</ul></section>
    {p.identityNote && <section className="panel space-top"><div className="section-top"><h2>Team evidence</h2></div><p>{p.identityNote}</p></section>}
    {p.openItemsLabel && <p className="subtle-note">{p.openItemsLabel}</p>}
    {p.context?.length ? <section className="panel space-top"><div className="section-top"><h2>Other useful context</h2></div>{p.context.map((item, i) => <p key={i}><strong>{plainDecisionText(item.label)}</strong> {plainDecisionText(item.detail ?? "")}</p>)}</section> : null}
    {p.notices?.map(signal => <ReviewBanner key={signal.id} title={signal.headline} body={signal.detail} />)}
  </>} afterScores={<>
    {p.verdictOverlay}
    {p.scoreIsProvisional && <ReviewBanner title="Before you use this report" body={`The score is provisional. ${p.openChecks.map(check => plainDecisionText([check.label, check.note].filter(Boolean).join(": "))).join(" ") || "Required evidence remains open."}`} />}
    {p.error && <p className="status-box" role="alert">{p.error}</p>}
    {p.privateReport && <ReviewBanner title="Private report" body="Extra live checks are off, and nothing is added to shared cases, watchlists, or activity." />}
    {p.saving && <p className="status-box" role="status">Saving this report before running extra checks…</p>}
    {p.persistenceFailed && <ReviewBanner title="This report is visible now, but it was not saved." body={["It will disappear when you leave this page. Run the scan again to create a saved version before opening extra research.", p.persistenceFailedReason].filter(Boolean).join(" ")} />}
    {p.snapshot && <ReviewBanner title={`Saved report v${p.snapshot.version}`} body={`This report uses data saved on ${new Date(p.snapshot.createdAt).toUTCString()}. ${p.currentDataEnabled ? "Current data is shown separately and does not change the saved score." : "New checks do not change the saved score or the shared report."}`} action={!p.currentDataEnabled && !p.privateReport ? <button type="button" className="textbtn" onClick={p.onCheckCurrentData}>Check current data</button> : undefined} />}
    {p.liveNotice && !p.snapshot && !p.privateReport && !p.saving && !p.persistenceFailed && <p className="subtle-note">Extra checks below run live. They do not change the saved score or the shared report.</p>}
  </>} after={<>
    {!p.scoreIsProvisional && p.decisionBoundary && <section className="panel space-top" data-testid="decision-boundary">
      <div className="section-top"><h2>What controls this result</h2></div>
      <p>{p.decisionBoundary.controllingFact}</p><dl className="reading-line"><dt>Current boundary</dt><dd>{p.decisionBoundary.boundary}</dd><dt>What will not change it</dt><dd>{p.decisionBoundary.willNotChange}</dd><dt>What would change it</dt><dd>{p.decisionBoundary.unlockCondition}</dd></dl>
      {p.decisionBoundaryEvidenceHref && <a className="textbtn" href={p.decisionBoundaryEvidenceHref}>Open governing evidence →</a>}
    </section>}
    {p.subjectSummary && p.subjectSummary !== view.summary && <><DisclosureButton id="token-product-description" className="textbtn">Read the full saved project description →</DisclosureButton><InlinePanel id="token-product-description" label="Saved project description">{() => <p>{p.subjectSummary}</p>}</InlinePanel></>}
    {p.legacy && <>
    <div className="section-top"><h2>The full case behind this decision</h2><DisclosureButton id="token-full-case" className="textbtn">Explore saved details →</DisclosureButton></div>
    <InlinePanel id="token-full-case" label="The full case behind this decision">{() => <div className="rd-legacy">{p.legacy}</div>}</InlinePanel>
  </> }
  </>} />;
}
