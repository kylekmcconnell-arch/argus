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
  async function run(fresh: boolean) {
    if (busy) return;
    setBusy(true); setMessage("");
    const id = runId ?? crypto.randomUUID();
    if (fresh) setRunId(id);
    try {
      const query = new URLSearchParams({ reportVersionId, name, role });
      const response = await fetch(fresh ? "/api/person-research" : `/api/person-research?${query}`, fresh ? {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportVersionId, name, role, runId: id }),
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
    {message && <p role="status">{message}</p>}
    {related.length > 0 && <div className="dialog-section"><h3>Earlier workspace research on the same bound X account</h3><p>Account continuity does not prove unchanged ownership or that earlier claims remain current. Up to ten completed records.</p>{related.map(row => <p key={row.id}><a href={exactReportPath(row.report_version_id)}>Source report · {row.created_at}</a></p>)}</div>}
    {result && <>
      <p className="subtle-note">Separate research captured {result.capturedAt}. The original report is unchanged. {result.note}</p>
      {result.searches.map(search => <p key={search.question}><strong>{search.question}:</strong> {search.status === "failed" ? "Provider failed" : `${search.count} source leads returned`}</p>)}
      {result.searches.length < 4 && <p className="status-box">Some planned searches did not run after a provider failure.</p>}
      {result.sources.map(source => <article className="dialog-section" key={source.url}>
        <h3><ExtLink href={source.url}>{source.title}</ExtLink></h3>
        <p>{source.excerpt}</p><p className="subtle-note">{source.access === "page_read" ? "Page read; claims and identity remain unverified" : source.access === "unavailable" ? "Page unavailable; showing search snippet only" : "Search snippet only; profile not read"} · {source.capturedAt}</p>
      </article>)}
    </>}
  </div>;
}
