import { useState } from "react";
import type { HolderIntelligence } from "../../lib/holderIntelligence";
import { explorerAddr } from "../../lib/addressLabels";

/** Only frozen observations are rendered. Opening a report never enriches wallets. */
export function HolderIntelligencePanel({ snapshot, allowHistory = false }: { snapshot?: HolderIntelligence | undefined; allowHistory?: boolean }) {
  const [history, setHistory] = useState<{ key: string; note: string; rows?: Array<{ report_version_id: string; saved_at: string; captured_at: string; provider: string; wallet_address: string; observation: { percent?: number } }> } | null>(null);
  const identity = snapshot ? `${snapshot.chain}:${snapshot.tokenAddress}` : "";
  const visibleHistory = history?.key === identity ? history : null;
  const loadHistory = async () => {
    if (!snapshot || !allowHistory) return;
    const key = identity;
    setHistory({ key, note: "Reading saved workspace observations…" });
    try {
      const query = new URLSearchParams({ chain: snapshot.chain, token: snapshot.tokenAddress });
      const response = await fetch(`/api/holder-history?${query}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json();
      setHistory({ key, note: typeof body.note === "string" ? body.note : "History unavailable.", ...(body.available && Array.isArray(body.rows) ? { rows: body.rows } : {}) });
    } catch { setHistory({ key, note: "Workspace history could not be read. This does not mean there are no earlier observations." }); }
  };
  return <section className="panel space-top" aria-label="Top 25 holder intelligence">
    <div className="section-top"><h2>Top 25 holder intelligence</h2></div>
    {!snapshot ? <p className="subtle-note">This saved report did not record the top-25 index check. Earlier holder rows are not evidence that all 25 were examined.</p> : <>
      <p><strong>{snapshot.examined}/25 examined · collection {snapshot.status}</strong>. {snapshot.matched} addresses matched a curated registry record.</p>
      <p className="subtle-note">{snapshot.source} · {snapshot.capturedAt} · {snapshot.block ? `block ${snapshot.block}` : "block not supplied"}. Registry {snapshot.registryVersion}.</p>
      <p className="subtle-note">An exact address match links to a recorded observation, not proof that the current project's team controls the wallet. Unmatched does not mean safe. Exchange custody does not identify its customers.</p>
      {snapshot.notes.map(note => <p className="subtle-note" key={note}>{note}</p>)}
      <p className="subtle-note">Arkham and Fomo identity enrichment was not run for this snapshot.</p>
      <div className="holder-intelligence-rows">
        {snapshot.rows.map(row => {
          const explorer = explorerAddr(row.address, snapshot.chain);
          return <article key={row.address} className="holder-intelligence-row">
            <div><strong>{row.rank}. </strong>{explorer ? <a href={explorer} target="_blank" rel="noreferrer">{row.address}</a> : <span>{row.address}</span>}</div>
            <p>{snapshot.supplyCoveredPct == null ? "Share unmeasured" : `${row.percent.toFixed(2)}% of supply`} · {row.role.replace(/-/g, " ")}{row.roleEvidence ? ` (${row.roleEvidence})` : ""}</p>
            {row.matches.map(match => <details key={`${match.registryId}:${match.role}`}>
              <summary>Curated record: {match.name} · {match.role}</summary>
              <p>{match.label}</p><p>{match.evidence}</p>
              <p className="subtle-note">Last observed {match.lastSeen}. Recorded group assessment: {match.intent}. This is historical attribution, not a finding of current coordination.</p>
            </details>)}
          </article>;
        })}
      </div>
      {allowHistory && <details>
        <summary>Compare saved workspace observations</summary>
        <p className="subtle-note">Separate from this frozen report. Reads saved evidence only; does not rescan wallets or contact enrichment providers.</p>
        <button type="button" className="textbtn" onClick={() => void loadHistory()}>Read workspace history</button>
        {visibleHistory && <p className="subtle-note">{visibleHistory.note}</p>}
        {visibleHistory?.rows && <p>{visibleHistory.rows.length} saved observations returned (up to 1,000). {new Set(visibleHistory.rows.map(row => row.report_version_id)).size} report versions.</p>}
        {visibleHistory?.rows && <div className="plain-table"><table><thead><tr><th>Observed</th><th>Wallet</th><th>Supply share</th><th>Source</th></tr></thead><tbody>
          {visibleHistory.rows.slice(0, 100).map((row, i) => <tr key={`${row.report_version_id}:${row.wallet_address}:${i}`}><td>{row.captured_at || row.saved_at}</td><td>{row.wallet_address}</td><td>{typeof row.observation?.percent === "number" ? `${row.observation.percent.toFixed(2)}%` : "Unmeasured"}</td><td>{row.provider}</td></tr>)}
        </tbody></table>{visibleHistory.rows.length > 100 && <p className="subtle-note">Showing the first 100 returned observations.</p>}</div>}
      </details>}
      {snapshot.sourceUrl && <a className="textbtn" href={snapshot.sourceUrl} target="_blank" rel="noreferrer">Inspect holder source ↗</a>}
    </>}
  </section>;
}
