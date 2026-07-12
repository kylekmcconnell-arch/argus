import { useEffect, useState, useCallback } from "react";
import { getWatchlist, removeWatch, rebaseline, hydrateSharedWatchlist, type WatchItem, type WatchSnapshot } from "../lib/watchlist";
import { auditToken } from "../token/audit";
import { fetchReportState, reportCompleteness, type ReportLookup } from "../lib/reports";
import { coverageQualifiedCompleteness, presentPublicReport, type PublicReportPresentation } from "../lib/reportPresentation";
import { verdictMeta } from "../lib/verdict";

const RANK: Record<string, number> = { PASS: 0, CAUTION: 1, FAIL: 2, AVOID: 3, UNVERIFIABLE_IDENTITY: 3 };

// Older watch snapshots predate frozen coverage metadata. Keep reading those
// records, but treat absent completeness as partial through the shared policy.
type Row = { item: WatchItem; current?: WatchSnapshot; loading: boolean; error?: boolean; caseStatus?: ReportLookup["status"] };

function presentationFor(snapshot: WatchSnapshot): PublicReportPresentation {
  return presentPublicReport({
    verdict: snapshot.verdict,
    score: snapshot.score,
    completeness: snapshot.completenessState,
  });
}

function presentationLabel(presentation: PublicReportPresentation): string {
  const label = presentation.resultLabel === "RISK SIGNAL"
    ? `RISK · ${presentation.displayVerdict}`
    : presentation.displayVerdict;
  return presentation.readinessLabel === "INVESTIGATION FAILED" ? `${label} · FAILED` : label;
}

function presentationMeta(presentation: PublicReportPresentation) {
  return verdictMeta(
    presentation.rawVerdict === "UNVERIFIABLE_IDENTITY"
      ? "UNVERIFIABLE_IDENTITY"
      : presentation.displayVerdict,
  );
}

function presentationRank(presentation: PublicReportPresentation): number {
  const verdictRank = RANK[presentation.rawVerdict] ?? RANK[presentation.displayVerdict] ?? 0;
  // Losing decision readiness is meaningful drift even when the underlying
  // model signal remains PASS. Existing adverse evidence stays more severe.
  const coverageRank = presentation.final
    ? 0
    : presentation.readinessLabel === "INVESTIGATION FAILED"
      ? 2
      : 1;
  return verdictRank * 3 + coverageRank;
}

function completenessState(value: unknown): WatchSnapshot["completenessState"] {
  return value === "complete" || value === "partial" || value === "failed" ? value : undefined;
}

async function check(item: WatchItem): Promise<{ current: WatchSnapshot | null; caseStatus: ReportLookup["status"] }> {
  const stored = await fetchReportState(item.id, item.kind);
  if (stored.status !== "open") return { current: null, caseStatus: stored.status };
  if (item.kind === "token") {
    const d = await auditToken({ kind: "token", ref: item.id, via: item.via ?? "evm" });
    return {
      current: d ? {
        verdict: d.verdict,
        score: d.score,
        liquidityUsd: d.liquidityUsd,
        mcap: d.mcap,
        completenessState: reportCompleteness("token", d),
      } : null,
      caseStatus: stored.status,
    };
  }
  // Person watches read the latest PERSISTED report (a rescan updates it);
  // there is no cheap live re-check for a person, so stored-latest is the truth.
  const payload = stored.report?.payload as {
    completeness_state?: unknown;
    report?: { composite_verdict?: string; governing_score?: number | null };
  } | undefined;
  const report = payload?.report;
  const versionContext = stored.report?.versionContext;
  const completeness = coverageQualifiedCompleteness({
    completeness: completenessState(versionContext?.completenessState ?? payload?.completeness_state),
    attestation: versionContext?.attestationState,
    checks: versionContext?.checks ?? [],
  });
  return {
    current: report?.composite_verdict ? {
      verdict: report.composite_verdict,
      score: report.governing_score ?? null,
      completenessState: completeness,
    } : null,
    caseStatus: stored.status,
  };
}

function money(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

export function WatchlistPage({ onAudit }: { onAudit: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>(() => getWatchlist().map((item) => ({ item, loading: true })));

  const recheck = useCallback(async () => {
    const items = getWatchlist();
    setRows(items.map((item) => ({ item, loading: true })));
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const result = await check(item);
          return {
            item,
            current: result.current ?? undefined,
            loading: false,
            error: result.caseStatus === "open" && !result.current,
            caseStatus: result.caseStatus,
          } as Row;
        } catch {
          return { item, loading: false, error: true } as Row;
        }
      }),
    );
    setRows(results);
  }, []);

  useEffect(() => {
    // shared watchlist first (co-analyst watches merge in), then re-check
    void hydrateSharedWatchlist().then(recheck);
  }, [recheck]);

  // Manual sweep — server-side drift + ring check, writes the Alerts feed.
  // Deliberately on-demand only: nothing runs in the background.
  const [sweep, setSweep] = useState<"idle" | "running" | string>("idle");
  const onSweep = async () => {
    setSweep("running");
    try {
      const r = await fetch("/api/sweep", { signal: AbortSignal.timeout(115000) });
      const d = await r.json();
      setSweep(d?.error ? `failed: ${String(d.error).slice(0, 80)}` : `checked ${d.checked} · ${d.alerts?.length ?? 0} new alert${(d.alerts?.length ?? 0) === 1 ? "" : "s"}`);
      recheck();
    } catch {
      setSweep("failed: network");
    }
  };

  const drop = (id: string) => {
    removeWatch(id);
    setRows((r) => r.filter((x) => x.item.id !== id));
  };
  const seen = (r: Row) => {
    if (r.current) rebaseline(r.item.id, r.current);
    setRows((rs) => rs.map((x) => (x.item.id === r.item.id ? { ...x, item: { ...x.item, snapshot: r.current! } } : x)));
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="display-sm text-[24px] text-ink">Watchlist</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-dim">Saved audits, re-checked live. Drift since you last looked is flagged.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sweep !== "idle" && sweep !== "running" && <span className="text-[11px] text-ink-faint">{sweep}</span>}
          <button
            onClick={onSweep}
            disabled={sweep === "running"}
            title="Run a one-off server sweep of the shared watchlist: on-chain drift + ring check against the trust graph. Writes the Alerts feed. Manual only — nothing runs in the background."
            className="btn-chip tint-signal disabled:opacity-60"
          >
            {sweep === "running" ? "sweeping…" : "Sweep now"}
          </button>
          <button onClick={recheck} className="btn-chip">Re-check all</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state mt-10">
          Nothing watched yet. Open any audit and hit <span className="text-ink-dim">Watch</span> to track it here.
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((r) => {
            const baseline = r.item.snapshot;
            const basePresentation = presentationFor(baseline);
            const currentPresentation = r.current ? presentationFor(r.current) : basePresentation;
            const baseM = presentationMeta(basePresentation);
            const curM = presentationMeta(currentPresentation);
            const baseLabel = presentationLabel(basePresentation);
            const currentLabel = presentationLabel(currentPresentation);
            const verdictChanged = r.current && currentLabel !== baseLabel;
            const worsened = r.current && presentationRank(currentPresentation) > presentationRank(basePresentation);
            const liqDrop =
              r.current?.liquidityUsd != null && r.item.snapshot.liquidityUsd
                ? (r.current.liquidityUsd - r.item.snapshot.liquidityUsd) / r.item.snapshot.liquidityUsd
                : null;
            const alert = worsened || (liqDrop != null && liqDrop < -0.25);
            const statusLabel = r.loading
              ? "…"
              : r.caseStatus === "archived"
                ? "ARCHIVED"
                : r.caseStatus === "missing"
                  ? "NO CASE"
                  : r.caseStatus === "unavailable"
                    ? "STATUS ERR"
                    : r.error
                      ? "ERR"
                      : currentLabel;
            const statusAria = r.loading
              ? "Current assessment: checking."
              : r.caseStatus === "archived"
                ? "Current assessment unavailable: case archived."
                : r.caseStatus === "missing"
                  ? "Current assessment unavailable: no case."
                  : r.caseStatus === "unavailable" || r.error
                    ? "Current assessment unavailable: status error."
                    : `Current assessment: ${currentPresentation.resultLabel}, ${currentPresentation.displayVerdict}. ${currentPresentation.readinessLabel}.`;
            const statusTitle = !r.loading && r.caseStatus === "open" && !r.error
              ? `${currentPresentation.coverageLabel}. ${currentPresentation.note}`
              : undefined;
            return (
              <div key={r.item.id} className={`panel flex items-center gap-3 px-4 py-3 ${alert ? "border-avoid/60" : ""}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[12.5px] text-signal">
                  {r.item.kind === "token" ? r.item.label.replace("$", "").slice(0, 3) : r.item.label.replace("@", "").slice(0, 1).toUpperCase()}
                </span>
                <button onClick={() => onAudit(r.item.id)} className="mono min-w-0 flex-1 truncate text-left text-[13.5px] text-ink hover:text-signal-dim">
                  {r.item.label}
                  <span className="ml-2 text-[11px] text-ink-faint capitalize">{r.item.kind === "token" ? r.item.chain : "person"}</span>
                </button>

                {/* verdict, baseline -> current */}
                <div className="flex items-center gap-1.5 text-[11px]">
                  {verdictChanged && (
                    <>
                      <span className="mono font-medium" style={{ color: baseM.color }}>{baseLabel}</span>
                      <span className="text-ink-faint">→</span>
                    </>
                  )}
                  <span
                    aria-label={statusAria}
                    title={statusTitle}
                    className={`verdict-pill ${currentPresentation.rawVerdict === "FAIL" ? "tint-fail" : "tint-var"}`}
                    style={currentPresentation.rawVerdict === "FAIL" ? undefined : ({ "--tint": curM.color } as React.CSSProperties)}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* liquidity drift for tokens */}
                {r.item.kind === "token" && (
                  <div className="hidden w-28 text-right sm:block">
                    <div className="mono text-[12.5px] text-ink-dim">{money(r.current?.liquidityUsd ?? r.item.snapshot.liquidityUsd)}</div>
                    {liqDrop != null && Math.abs(liqDrop) >= 0.05 && (
                      <div className={`mono text-[11px] font-medium ${liqDrop < 0 ? "text-avoid" : "text-pass"}`}>
                        {liqDrop > 0 ? "+" : ""}{(liqDrop * 100).toFixed(0)}% liq
                      </div>
                    )}
                  </div>
                )}

                {alert && <span className="chip tint-avoid">⚠ changed</span>}
                {alert && r.current && (
                  <button onClick={() => seen(r)} title="Mark current as the new baseline" className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:border-line-2 hover:text-ink">seen</button>
                )}
                <button onClick={() => drop(r.item.id)} title="Remove" aria-label="Remove from watchlist" className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:border-avoid hover:text-avoid">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
