import { ProviderDiscovery } from "./InvestigationEvidence";
import { exactReportPath } from "../../lib/reportPresentation";
import { useState } from "react";
import type { PersonResearchResult } from "../../lib/personResearch";
import { ExtLink } from "./primitives";
export function PersonBackgroundResearch({ reportVersionId, name, role }: { reportVersionId: string; name: string; role: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<PersonResearchResult | null>(null);
  const [related, setRelated] = useState<Array<{ id: string; report_version_id: string; created_at: string }>>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [personReportUrl, setPersonReportUrl] = useState("");
  async function run(fresh: boolean, attach = false) {
    if (busy) return;
    setBusy(true); setMessage("");
    let sourceVersionId = personReportUrl.trim();
    if (attach) {
      try { sourceVersionId = new URL(sourceVersionId, window.location.origin).searchParams.get("version") ?? sourceVersionId; } catch { /* raw version ID */ }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceVersionId)) { setMessage("Paste a saved person report link containing its exact version."); setBusy(false); return; }
    }
    const id = runId ?? crypto.randomUUID();
    if (fresh) setRunId(id);
    try {
      const query = new URLSearchParams({ reportVersionId, name, role });
      const response = await fetch(fresh ? "/api/person-research" : `/api/person-research?${query}`, fresh ? {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportVersionId, name, role, runId: id, ...(attach ? { action: "attach_report", sourceVersionId } : {}) }),
      } : {});
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Background research is unavailable. No absence finding can be drawn.");
      if (fresh) { setResult(body.result); setRunId(null); }
      else {
        setRelated(body.related ?? []);
        const latest = body.runs?.[0];
        if (latest && latest.status !== "running") setRunId(null);
        setResult(latest?.payload ?? null);
        setMessage(latest ? latest.status === "running" ? "The most recent request has no completion receipt yet. Do not treat it as an empty history." : latest.status === "failed" ? "The most recent research request failed." : "Loaded the latest saved background research." : "No background research has been saved for this person and report version.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Background research unavailable."); }
    finally { setBusy(false); }
  }
  return <div className="dialog-section">
    <h3>Investigate this person's background</h3>
    <p>Research prior companies, project outcomes and collaborators using this saved name and company context. No X account is required. This bounded search uses the workspace's supplemental allowance; it does not produce a scored person audit.</p>
    <button type="button" className="btn" disabled={busy} onClick={() => void run(true)}>{busy ? "Working…" : "Research background"}</button>{" "}
    <button type="button" className="textbtn" disabled={busy} onClick={() => void run(false)}>Read saved background</button>
    <details className="disclosure"><summary>Use an existing person report</summary>
      <p>Attach an exact saved person report from this workspace. It must match this member's first-party account link. No research charge or score change; its historical evidence can inform a future company report.</p>
      <label>Saved person report link <input type="text" value={personReportUrl} onChange={event => setPersonReportUrl(event.target.value)} placeholder="Paste the saved report link" /></label>{" "}
      <button type="button" className="btn" disabled={busy || !personReportUrl.trim()} onClick={() => void run(true, true)}>Attach saved evidence</button>
    </details>
    {message && <p role="status">{message}</p>}
    {related.length > 0 && <div className="dialog-section"><h3>Earlier workspace research on the same bound X account</h3><p>Account continuity does not prove unchanged ownership or that earlier claims remain current. Up to ten completed records.</p>{related.map(row => <p key={row.id}><a href={exactReportPath(row.report_version_id)}>Source report · {row.created_at}</a></p>)}</div>}
    {result && <>
      <p className="subtle-note">Separate research captured {result.capturedAt}. The original report is unchanged. {result.note}</p>
      {result.linkedReport && <div className="dialog-section"><h3>Attached person evidence</h3><a href={exactReportPath(result.linkedReport.reportVersionId)}>Open exact source person report</a><p>{result.linkedReport.note}</p><p>Source saved {result.linkedReport.capturedAt}</p>{result.linkedReport.investigation.timeline.map(entry => <p key={entry.factId}>{entry.claim} · {entry.period}</p>)}</div>}
      {result.plannedQuestions && <details className="disclosure"><summary>Research plan and reasons</summary>{result.plannedQuestions.map(item => <p key={item.question}><strong>{item.question}:</strong> {item.reason}</p>)}<p>{result.stopReason === "provider_failure" ? "Stopped after provider failure; coverage is incomplete." : "Bounded research allowance completed; this is not an exhaustive investigation."}</p></details>}
      <ProviderDiscovery receipts={result.providerReceipts} />
      {result.searches.map(search => <p key={search.question}><strong>{search.question}:</strong> {search.status === "failed" ? "Provider failed" : `${search.count} source leads returned`}</p>)}
      {!result.linkedReport && result.searches.length < 4 && <p className="status-box">Some planned searches did not run after a provider failure.</p>}
      {result.sources.map(source => <article className="dialog-section" key={source.url}>
        <h3><ExtLink href={source.url}>{source.title}</ExtLink></h3>
        <p>{source.excerpt}</p><p className="subtle-note">{source.access === "page_read" ? "Page read; claims and identity remain unverified" : source.access === "unavailable" ? "Page unavailable; showing search snippet only" : "Search snippet only; profile not read"} · {source.capturedAt}</p>
      </article>)}
    </>}
  </div>;
}
