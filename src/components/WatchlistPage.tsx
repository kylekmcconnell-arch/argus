import { useEffect, useState, useCallback } from "react";
import { getWatchlist, removeWatch, rebaseline, hydrateSharedWatchlist, type WatchItem, type WatchSnapshot } from "../lib/watchlist";
import { auditToken } from "../token/audit";
import { fetchReport } from "../lib/reports";
import { verdictMeta } from "../lib/verdict";

const RANK: Record<string, number> = { PASS: 0, CAUTION: 1, FAIL: 2, AVOID: 3, UNVERIFIABLE_IDENTITY: 3 };

type Row = { item: WatchItem; current?: WatchSnapshot; loading: boolean; error?: boolean };

async function check(item: WatchItem): Promise<WatchSnapshot | null> {
  if (item.kind === "token") {
    const d = await auditToken({ kind: "token", ref: item.id, via: item.via ?? "evm" });
    return d ? { verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, mcap: d.mcap } : null;
  }
  // Person watches read the latest PERSISTED report (a rescan updates it);
  // there is no cheap live re-check for a person, so stored-latest is the truth.
  const rep = await fetchReport(item.id, "person");
  const r = (rep?.payload as { report?: { composite_verdict?: string; governing_score?: number | null } } | undefined)?.report;
  return r?.composite_verdict ? { verdict: r.composite_verdict, score: r.governing_score ?? null } : null;
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
          const current = await check(item);
          return { item, current: current ?? undefined, loading: false, error: !current } as Row;
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
          <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Watchlist</h1>
          <p className="mt-1.5 text-[14px] text-ink-dim">Saved audits, re-checked live. Drift since you last looked is flagged.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sweep !== "idle" && sweep !== "running" && <span className="text-[11px] text-ink-faint">{sweep}</span>}
          <button
            onClick={onSweep}
            disabled={sweep === "running"}
            title="Run a one-off server sweep of the shared watchlist: on-chain drift + ring check against the trust graph. Writes the Alerts feed. Manual only — nothing runs in the background."
            className="mono rounded-lg border px-3 py-1.5 text-[12.5px] transition disabled:opacity-60"
            style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}
          >
            {sweep === "running" ? "sweeping…" : "Sweep now"}
          </button>
          <button onClick={recheck} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink">Re-check all</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line-2 bg-panel/50 p-10 text-center text-[13.5px] text-ink-faint">
          Nothing watched yet. Open any audit and hit <span className="text-ink-dim">Watch</span> to track it here.
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((r) => {
            const baseM = verdictMeta(r.item.snapshot.verdict);
            const curM = r.current ? verdictMeta(r.current.verdict) : baseM;
            const verdictChanged = r.current && r.current.verdict !== r.item.snapshot.verdict;
            const worsened = r.current && (RANK[r.current.verdict] ?? 0) > (RANK[r.item.snapshot.verdict] ?? 0);
            const liqDrop =
              r.current?.liquidityUsd != null && r.item.snapshot.liquidityUsd
                ? (r.current.liquidityUsd - r.item.snapshot.liquidityUsd) / r.item.snapshot.liquidityUsd
                : null;
            const alert = worsened || (liqDrop != null && liqDrop < -0.25);
            return (
              <div key={r.item.id} className="flex items-center gap-3 rounded-xl border bg-panel px-4 py-3" style={alert ? { borderColor: "var(--color-avoid)" } : {}}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-[12px] text-signal">
                  {r.item.kind === "token" ? r.item.label.replace("$", "").slice(0, 3) : r.item.label.replace("@", "").slice(0, 1).toUpperCase()}
                </span>
                <button onClick={() => onAudit(r.item.id)} className="mono min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:text-signal-dim">
                  {r.item.label}
                  <span className="ml-2 text-[11px] text-ink-faint capitalize">{r.item.kind === "token" ? r.item.chain : "person"}</span>
                </button>

                {/* verdict, baseline -> current */}
                <div className="flex items-center gap-1.5 text-[11px]">
                  {verdictChanged && (
                    <>
                      <span className="mono" style={{ color: baseM.color }}>{baseM.label}</span>
                      <span className="text-ink-faint">→</span>
                    </>
                  )}
                  <span className="mono rounded-full border px-2 py-0.5 font-semibold tracking-wider" style={{ borderColor: curM.color, color: curM.color }}>
                    {r.loading ? "…" : r.error ? "ERR" : curM.label}
                  </span>
                </div>

                {/* liquidity drift for tokens */}
                {r.item.kind === "token" && (
                  <div className="hidden w-28 text-right sm:block">
                    <div className="mono text-[12px] text-ink-dim">{money(r.current?.liquidityUsd ?? r.item.snapshot.liquidityUsd)}</div>
                    {liqDrop != null && Math.abs(liqDrop) >= 0.05 && (
                      <div className="mono text-[10.5px]" style={{ color: liqDrop < 0 ? "var(--color-avoid)" : "var(--color-pass)" }}>
                        {liqDrop > 0 ? "+" : ""}{(liqDrop * 100).toFixed(0)}% liq
                      </div>
                    )}
                  </div>
                )}

                {alert && <span className="mono text-[10px] font-semibold" style={{ color: "var(--color-avoid)" }}>⚠ changed</span>}
                {alert && r.current && (
                  <button onClick={() => seen(r)} title="Mark current as the new baseline" className="text-[11px] text-ink-faint hover:text-ink">seen</button>
                )}
                <button onClick={() => drop(r.item.id)} title="Remove" className="text-ink-faint hover:text-avoid">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
