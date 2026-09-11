import { useEffect, useState } from 'react';
import { useArgusAuth } from '../auth-context';
import type { LaunchResearchRun } from '../lib/deepLaunch';
import { launchFindingDetail, launchFindingSources } from '../lib/launchEvidencePresentation';

export function DeepLaunchPanel({ chain, reportVersionId }: { chain: string; reportVersionId?: string }) {
  if (chain !== 'robinhood') return null;
  if (!reportVersionId) return <section className="panel mt-4 px-5 py-5"><h3>Deep launch analysis</h3><p className="mt-2 text-sm text-ink-dim">Available after this report is saved.</p></section>;
  return <SavedLaunchPanel key={reportVersionId} reportVersionId={reportVersionId} />;
}

function SavedLaunchPanel({ reportVersionId }: { reportVersionId: string }) {
  const { role } = useArgusAuth();
  const [run, setRun] = useState<LaunchResearchRun | null>(null);
  const [previousRun, setPreviousRun] = useState<LaunchResearchRun | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError('');
    fetch(`/api/deep-launch?reportVersionId=${encodeURIComponent(reportVersionId)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
      .then(async response => { if (!response.ok) throw new Error('Saved analysis could not be loaded.'); return response.json(); })
      .then(data => { if (!controller.signal.aborted) { setRun(data.run); setPreviousRun(data.previousRun ?? null); setLoaded(true); setNotice(''); } })
      .catch(() => { if (!controller.signal.aborted) { setLoaded(false); setError('Saved analysis could not be loaded. Retry before starting a new run.'); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [reportVersionId, reload]);
  async function start(retryMissing = false) {
    if (busy || !loaded) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/deep-launch', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportVersionId, ...(retryMissing ? { retryMissing: true } : {}) }), signal: AbortSignal.timeout(60_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 429 ? 'The workspace daily supplemental limit has been reached.'
        : response.status === 403 ? 'An analyst or owner can run this analysis.'
        : response.status === 409 ? 'This case is archived. Restore it before running new research.'
        : 'Analysis could not finish or save. Check saved analysis before retrying.');
      setPreviousRun(data.previousRun ?? (run?.state === 'completed' ? run : previousRun));
      setRun(data.run);
      if (data.reused) setNotice(data.run?.state === 'running'
        ? 'An existing analysis is still running. No new collection started.'
        : 'No new collection started. The saved analysis was reused during the refresh cooldown. Try again after two minutes.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Analysis could not finish.'); setLoaded(false); }
    finally { setBusy(false); }
  }
  const showingPrevious = run?.state !== 'completed' && Boolean(previousRun?.result);
  const result = showingPrevious ? previousRun?.result : run?.result;
  const canRun = role === 'owner' || role === 'analyst';
  return <section className="panel mt-4 px-5 py-5" aria-label="Deep launch analysis">
    <h3 className="text-base font-semibold">Deep launch analysis</h3>
    <p className="mt-2 text-sm text-ink-dim">How this token launched, evidence of trading, and who holds its liquidity position. This is supplemental research; it does not change the ARGUS score.</p>
    <p className="mt-1 text-xs text-ink-faint">Up to 32 provider requests, usually under a minute. A run uses one request from the workspace’s daily supplemental allowance. Provider charges depend on configured access.</p>
    {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {showingPrevious && <p className="mt-3 text-sm text-ink-dim">Showing the last successful analysis below. The latest attempt has not replaced it; its collection date still applies.</p>}
    {busy && <p role="status" className="mt-3 text-sm">{loaded ? 'Collecting and saving launch evidence…' : 'Loading saved analysis…'}</p>}
    {run?.state === 'running' && !busy && <p role="status" className="mt-3 text-sm">An analysis is running. Check saved analysis shortly; no second collection will start while it is active.</p>}
    {run?.state === 'failed' && <p className="mt-3 text-sm">The previous attempt could not establish usable results. Available observations remain below.</p>}
    {!busy && <div className="mt-3 flex flex-wrap gap-2 print:hidden">
      <button className="btn-chip" onClick={() => setReload(n => n + 1)}>Check saved analysis</button>
      {canRun && loaded && (!run || run.state === 'failed' || (run.state === 'running' && Date.now() - Date.parse(run.started_at) > 120_000)) &&
        <button className="btn-chip tint-signal" onClick={() => void start()}>{run ? 'Retry deep launch analysis' : 'Run deep launch analysis'}</button>}
      {canRun && loaded && run?.state === 'completed' && result?.gaps.length ?
        <button className="btn-chip tint-signal" onClick={() => void start(true)}>Refresh launch analysis</button> : null}
    </div>}
    {run?.state === 'completed' && Boolean(result?.gaps.length) && <p className="mt-2 text-xs text-ink-dim">Refresh reruns the full bounded launch analysis, not just missing checks, and uses another supplemental request. Provider limitations may remain.</p>}
    {result && <div className="mt-4">
      <p className="text-sm">Collected {new Date(result.completedAt).toLocaleString()} · {result.usage.requests} requests · {result.findings.length} evidence-backed observations</p>
      <p className="mt-1 break-all font-mono text-xs text-ink-faint">Chain {result.target.chainId} · {result.target.address}{result.target.block ? ` · block ${BigInt(result.target.block).toString()}` : ''}</p>
      {result.status === 'unavailable' && <p className="mt-2 text-sm">The run did not establish consistent chain evidence. Do not treat these observations as a completed analysis.</p>}
      <ul className="mt-3 space-y-3">{result.findings.map((f, i) => <li key={i}>
        <strong className="text-sm">{f.label}</strong><span className="ml-2 text-xs text-ink-faint">{f.strength === 'measured' ? 'On-chain observation' : 'Provider-reported evidence'}</span>
        <p className="mt-1 break-words text-sm text-ink-dim">{launchFindingDetail(f.detail)}</p><p className="text-xs text-ink-faint">Sources: {launchFindingSources(result, f.evidence)} · Evidence: {f.evidence.join(', ')}</p>
      </li>)}</ul>
      <details className="mt-4"><summary className="cursor-pointer text-sm">Coverage gaps ({result.gaps.length})</summary>
        <ul className="mt-2 space-y-2 text-sm text-ink-dim">{result.gaps.map((g, i) => <li key={i}><strong>{g.area}:</strong> {g.reason}</li>)}</ul>
      </details>
      <details className="mt-3"><summary className="cursor-pointer text-sm">Reproducible evidence ({result.observations.length} records)</summary>
        <p className="my-2 text-xs text-ink-faint">Normalized observations and full-response hashes. Traces and transfer lists are bounded. Configured endpoint credentials are omitted.</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>}
  </section>;
}
