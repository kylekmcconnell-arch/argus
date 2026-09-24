import { EvidenceAvailability } from "../EvidenceAvailability";
import { useEffect, useState, type ReactNode } from "react";
import { DisclosureButton, InlinePanel } from "../disclosure";
import { useArgusReport } from "../context";
import { AuditList } from "../ArgusReportShell";
import { Badge, ChallengeButton, ChallengePanel, CopyContract, ExtLink, ReviewBanner, XLogo, type ChallengeTarget } from "../primitives";
import { bannerSummary, chainLabel, dexscreenerUrl, exactPercent, findingId, initials, tokenExplorer, xHandleUrl } from "../model";
import type { LensView, ReportView, ScoreView, SourceCard } from "../view";
import { ScoreTable } from "./ScoresChapter";
import { QuestionRows } from "./EvidenceChapter";

export type DecisionView = Partial<Pick<ReportView, "people" | "market">> & Pick<ReportView, "subjectName" | "avatarUrl" | "eyebrow" | "category" | "productLabel" | "summary" | "website" | "xHandle" | "token" | "primary" | "tokenScore" | "issues" | "lenses" | "researchStatus" | "checkRail" | "leadBanner" | "metrics"> & { evidence: Pick<ReportView["evidence"], "collection" | "questions">; methodologyHref?: string | undefined; additionalLinks?: Array<{ label: string; url: string }> | undefined };

export function IdentityShortcuts({ view }: { view: Pick<DecisionView, "xHandle" | "website" | "token" | "additionalLinks"> }) {
  const xUrl = xHandleUrl(view.xHandle);
  const token = view.token;
  const pool = token ? dexscreenerUrl(token.chain, token.pairAddress ?? token.address) : null;
  const explorer = token ? tokenExplorer(token.chain, token.address) : null;
  const linkKey = (value: string) => {
    const url = new URL(value);
    return /^(www\.)?(x|twitter)\.com$/.test(url.hostname)
      ? `x:${url.pathname.replace(/\/$/, "").toLowerCase()}`
      : url.href.replace(/\/$/, "");
  };
  const seen = new Set([xUrl, view.website, pool, explorer?.url].filter(Boolean).flatMap(url => {
    try { return [linkKey(url!)]; } catch { return []; }
  }));
  const extra = (view.additionalLinks ?? []).filter(link => {
    try {
      const url = new URL(link.url);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      const key = linkKey(url.href);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch { return false; }
  });
  if (!xUrl && !view.website && !token && !extra.length) return null;
  return (
    <div className="token-access">
      <div className="quick-links">
        {xUrl && <ExtLink href={xUrl}><XLogo /> @{String(view.xHandle).replace(/^@/, "")}</ExtLink>}
        {view.website && <ExtLink href={view.website}>Website</ExtLink>}
        {pool && <ExtLink href={pool}>DexScreener</ExtLink>}
        {explorer && <ExtLink href={explorer.url}>{explorer.name}</ExtLink>}
        {extra.map(link => <ExtLink key={link.url} href={link.url}>{link.label === "site" ? new URL(link.url).hostname.startsWith("docs.") ? "Docs" : new URL(link.url).hostname : link.label}</ExtLink>)}
      </div>
      {token && (
        <div className="contract-access">
          <span className="chain-label">{chainLabel(token.chain)} · ${token.symbol}</span>
          <code className="contract-address" aria-label={`${chainLabel(token.chain)} contract address`}>{token.address}</code>
          <CopyContract address={token.address} label={`${chainLabel(token.chain)} contract address`} />
        </div>
      )}
    </div>
  );
}

function ScoreCard({ score }: { score: ScoreView }) {
  const challenge: ChallengeTarget = {
    id: findingId("decision", `score-${score.id}`),
    title: `${score.eyebrow} ${score.score ?? "withheld"}${score.score != null ? "/100" : ""}`,
    claim: `${score.eyebrow}: ${score.score != null ? `${score.score}/100` : "score withheld"} · ${score.verdictWord}. ${score.foot}`,
  };
  const shown = score.score != null && !score.withheldReason && !score.deferredReason;
  return (
    <article className={`score-card ${score.id === "token" ? "token" : "company"} tone-${score.tone}`}>
      <span className="eyebrow">{score.eyebrow}</span>
      <div className="score-number">{shown ? score.score : "–"}<span>{shown ? "/100" : ""}</span></div>
      <Badge tone={score.tone}>{score.deferredReason || score.score == null ? score.verdictWord : `${score.verdictWord} · saved verdict`}</Badge>
      <div className="score-line"><i style={{ width: `${shown ? Math.max(0, Math.min(100, score.score ?? 0)) : 0}%` }} /></div>
      {score.status && <p className="score-status">{score.status}</p>}
      <p className="score-foot">{score.deferredReason ?? score.withheldReason ?? score.foot}</p>
      {score.rows.length > 0 && (
        <DisclosureButton id={`score:${score.id}`} className="textbtn" data-score={score.id}>Explore score →</DisclosureButton>
      )}
      <ChallengeButton target={challenge} />
    </article>
  );
}

function ScorePanels({ scores }: { scores: ScoreView[] }) {
  return (
    <>
      {scores.map((score) => (
        <InlinePanel key={score.id} id={`score:${score.id}`} label={score.eyebrow}>
          {() => (
            <>
              <h2 className="dialog-title">{score.eyebrow}</h2>
              <ScoreTable score={score} scope="breakdown" />
              <p className="subtle-note">Preserved saved score. Open a scoring area to inspect its rationale and evidence conflict.</p>
            </>
          )}
        </InlinePanel>
      ))}
      {scores.map((score) => (
        <ChallengePanel
          key={`challenge-${score.id}`}
          target={{
            id: findingId("decision", `score-${score.id}`),
            title: `${score.eyebrow} ${score.score ?? "withheld"}${score.score != null ? "/100" : ""}`,
            claim: `${score.eyebrow}: ${score.score != null ? `${score.score}/100` : "score withheld"} · ${score.verdictWord}. ${score.foot}`,
          }}
        />
      ))}
    </>
  );
}

function SourceList({ sources }: { sources: SourceCard[] }) {
  if (!sources.length) return <p className="status-box">No source record is attached to these findings in the saved report.</p>;
  return (
    <>
      {sources.map((source) => (
        <div className="dialog-section" key={source.id}>
          <Badge tone={source.tone ?? "amber"}>{source.tier}</Badge>
          <h3 style={{ marginTop: 8 }}>{source.title}</h3>
          {source.excerpt && <p>{source.excerpt}</p>}
          {source.url && <p style={{ marginTop: 8 }}><ExtLink href={source.url}>Open recorded source</ExtLink></p>}
        </div>
      ))}
    </>
  );
}

function SignalRow({
  id,
  dot,
  tone,
  title,
  text,
  buttonLabel,
  panel,
}: {
  id: string;
  dot: string;
  tone: "green" | "amber";
  title: string;
  text: string;
  buttonLabel: string;
  panel: () => ReactNode;
}) {
  const challenge: ChallengeTarget = { id: findingId("decision", id), title, claim: `${title}. ${text}` };
  return (
    <>
      <div className="signal-row">
        <span className={`signal-dot${tone === "amber" ? " amber" : ""}`} aria-hidden="true">{dot}</span>
        <div>
          <strong>{title}</strong>
          <p>{text}</p>
        </div>
        <DisclosureButton id={`signal:${id}`} className="textbtn">{buttonLabel}</DisclosureButton>
        <ChallengeButton target={challenge} />
      </div>
      <InlinePanel id={`signal:${id}`} label={title}>{panel}</InlinePanel>
      <ChallengePanel target={challenge} />
    </>
  );
}

function useChecklist(storageKey: string) {
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...checked]));
    } catch {
      // Private browsing: the checklist still works for this visit.
    }
  }, [checked, storageKey]);
  const toggle = (id: string, value: boolean) => setChecked((current) => {
    const next = new Set(current);
    if (value) next.add(id);
    else next.delete(id);
    return next;
  });
  return { checked, toggle };
}

function Brief({ view, lens, setLens, onRescan, supplement }: { view: DecisionView; lens: LensView; setLens: (key: LensView["key"]) => void; onRescan?: () => void; supplement?: ReactNode }) {
  const report = useArgusReport();
  const { checked, toggle } = useChecklist(`argus-report-checklist:${report.reportVersionId ?? report.auditId}`);
  const reviewed = lens.tasks.filter((task) => checked.has(`${lens.key}:${task.id}`)).length;
  return (
    <section data-canonical-decision-brief="true" id="report-summary">
      <div className="section-top">
        <h2>The decision brief</h2>
        <div className="segmented" aria-label="Decision perspective" role="group">
          {view.lenses.map((item) => (
            <button key={item.key} type="button" aria-pressed={item.key === lens.key} onClick={() => setLens(item.key)}>{item.key}</button>
          ))}
        </div>
      </div>
      <div className="brief-grid">
        <div className="panel">
          <div className="eyebrow">{lens.eyebrow}</div>
          <div className="decision-title">{lens.title}</div>
          <p>{lens.body}</p>
          <div className="space-top">
            {lens.foundation && (
              <SignalRow
                id={`${lens.key}-foundation`}
                dot="✓"
                tone="green"
                title="Useful foundation"
                text={lens.foundation.text}
                buttonLabel="Sources"
                panel={() => (
                  <>
                    <div className="eyebrow">Recorded source scope</div>
                    <h2 className="dialog-title">Useful foundation</h2>
                    <p className="dialog-body">{lens.foundation!.text}</p>
                    <SourceList sources={lens.foundation!.sources} />
                  </>
                )}
              />
            )}
            {lens.uncertainty && (
              <SignalRow
                id={`${lens.key}-uncertainty`}
                dot="△"
                tone="amber"
                title="The material uncertainty"
                text={lens.uncertainty.text}
                buttonLabel="Compare"
                panel={() => (
                  <>
                    {lens.uncertainty!.detail}
                    <p style={{ marginTop: 16 }}>
                      <button type="button" className="btn" onClick={() => report.goTo(lens.uncertainty!.chapter)}>Explore the related chapter →</button>
                    </p>
                  </>
                )}
              />
            )}
            {lens.change && (
              <SignalRow
                id={`${lens.key}-change`}
                dot="○"
                tone="amber"
                title="What would change this read"
                text={lens.change.text}
                buttonLabel="Open gaps"
                panel={() => (
                  <>
                    <div className="eyebrow">Open diligence questions</div>
                    <h2 className="dialog-title">What would change this read</h2>
                    <p className="dialog-body">These saved questions remain wholly or partly open. Use them to request evidence before relying on the assessment.</p>
                    <QuestionRows questions={view.evidence.questions} filter="Open" />
                    <p style={{ marginTop: 16 }}>
                      <button type="button" className="btn" onClick={() => report.goTo("evidence")}>Explore evidence &amp; methodology →</button>
                    </p>
                  </>
                )}
              />
            )}
          </div>
        </div>
        <div className="panel soft">
          <div className="eyebrow">Your next diligence steps</div>
          <h3 style={{ marginTop: 10 }}>{lens.nextHeading}</h3>
          <p>Concrete follow-ups, ordered for {lens.key.toLowerCase()} review.</p>
          <div className="next-list">
            {lens.tasks.map((task) => {
              const key = `${lens.key}:${task.id}`;
              const inputId = `rd-task-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              return (
                <div className="task" key={key}>
                  <input type="checkbox" id={inputId} checked={checked.has(key)} onChange={(event) => toggle(key, event.target.checked)} />
                  <label htmlFor={inputId}>{task.title}{task.detail && <small>{task.detail}</small>}</label>
                  <button type="button" className="textbtn" aria-label={`Review ${task.title}`} onClick={() => report.goTo(task.chapter)}>↗</button>
                </div>
              );
            })}
            {lens.tasks.length === 0 && <p className="subtle-note">No open follow-up is recorded for this perspective.</p>}
          </div>
          {lens.tasks.length > 0 && (
            <p className="task-progress" role="status">{reviewed} of {lens.tasks.length} marked reviewed · saved only in this browser</p>
          )}
          {(view.researchStatus.length > 0 || view.checkRail) && (
            <aside className="disclosure" aria-label="Required report checks">
              <div className="disclosure-title">Research status</div>
              {view.checkRail?.legacyNote && (
                <>
                  <p><strong>Check details unavailable.</strong> {view.checkRail.legacyNote}</p>
                  {onRescan && !report.readOnly && (
                    <p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={onRescan}>Rescan to record every check</button></p>
                  )}
                </>
              )}
              {view.researchStatus.length > 0 && (
                <p>
                  {view.researchStatus.map((line, index) => (
                    <span key={line.lead}>{index > 0 && <br />}<strong>{line.lead}</strong> {line.text}</span>
                  ))}
                </p>
              )}
              {view.checkRail && view.checkRail.applicable > 0 && (
                <p><a href={view.methodologyHref ?? "#scan-methodology"}>See finished checks and data gaps</a></p>
              )}
              {view.checkRail && view.checkRail.open.length > 0 && (
                <>
                  <p><strong>Still open</strong></p>
                  <ul className="compact-list">
                    {view.checkRail.open.map((check) => (
                      <li key={check.label}><strong>{check.label}</strong>{check.note ? `: ${check.note}` : ""}</li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          )}
        </div>
      </div>
      {supplement}
    </section>
  );
}

export function DecisionChapter({ view, before, after, onRescan, briefSupplement, afterScores, onLensChange }: { view: DecisionView; briefSupplement?: ReactNode; onLensChange?: (key: LensView["key"]) => void; afterScores?: ReactNode; before?: ReactNode; after?: ReactNode; onRescan?: () => void }) {
  const report = useArgusReport();
  const [lensKey, setLensKey] = useState<LensView["key"]>("Investor");
  const lens = view.lenses.find((item) => item.key === lensKey) ?? view.lenses[0];
  const scores = [view.primary, view.tokenScore].filter((score): score is ScoreView => Boolean(score));
  const critical = view.issues.filter((issue) => issue.kind === "reconciliation" && issue.severity === "Critical");
  const reviewable = view.issues.filter((issue) => issue.kind === "reconciliation" && issue.severity !== "Medium");
  const collection = view.evidence.collection;

  return (
    <>
      {before}
      <section className="hero" aria-label="Decision and saved scores" data-canonical-report-header="true" id="report-overview">
        <div>
          <span className="eyebrow" title={view.category?.basis}>{view.eyebrow}{view.category ? ` · ${view.category.label}` : ""}</span>
          <div className="title-row">
            <span className="subject-icon" aria-hidden="true">
              {view.avatarUrl ? <img src={view.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(view.subjectName).slice(0, 1)}
            </span>
            <h1>{view.subjectName}</h1>
          </div>
          <IdentityShortcuts view={view} />
          <p className="hero-desc">
            {view.productLabel && <strong>{view.productLabel}. </strong>}
            {view.summary}
          </p>
        </div>
        <div className={`scores-pair${scores.length === 1 ? " single" : ""}`} data-report-score={scores.length > 1 ? "dual" : "prominent"}>
          {scores.map((score) => <ScoreCard key={score.id} score={score} />)}
        </div>
      </section>
      <ScorePanels scores={scores} />
      {afterScores}
      <EvidenceAvailability view={view} />

      {reviewable.length > 0 && (
        <>
          <ReviewBanner
            title="These scores need reconciliation before they can support a decision."
            body={bannerSummary(view.issues)}
            action={critical.length > 0 ? (
              <DisclosureButton id="critical-issues" className="textbtn">
                See {critical.length} critical issue{critical.length === 1 ? "" : "s"} →
              </DisclosureButton>
            ) : (
              <DisclosureButton id="critical-issues" className="textbtn">
                See {reviewable.length} issue{reviewable.length === 1 ? "" : "s"} →
              </DisclosureButton>
            )}
            challenge={{
              id: findingId("decision", "reconciliation-banner"),
              title: "Scores need reconciliation",
              claim: `These scores need reconciliation before they can support a decision. ${bannerSummary(view.issues)}`,
            }}
          />
          <InlinePanel id="critical-issues" label="Critical issues">
            {() => <AuditList issues={critical.length ? critical : reviewable} critical={critical.length > 0} />}
          </InlinePanel>
        </>
      )}

      {view.leadBanner && (
        <ReviewBanner
          title={view.leadBanner.title}
          body={view.leadBanner.body}
          action={<button type="button" className="textbtn" onClick={() => report.goTo("social")}>Read the leads →</button>}
        />
      )}

      {lens && <Brief view={view} lens={lens} setLens={key => { setLensKey(key); onLensChange?.(key); }} onRescan={onRescan} supplement={briefSupplement} />}

      {view.metrics.length > 0 && (
        <div className="metric-strip" style={{ "--metric-count": Math.min(4, view.metrics.length) } as React.CSSProperties}>
          {view.metrics.slice(0, 4).map((metric) => (
            <div className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.note && <small>{metric.note}</small>}
            </div>
          ))}
        </div>
      )}
      {collection && collection.applicable > 0 && view.metrics.length === 0 && (
        <p className="subtle-note">{collection.successful}/{collection.applicable} collection checks completed ({exactPercent(collection.successful, collection.applicable)}).</p>
      )}
      {after}
    </>
  );
}
