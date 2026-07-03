import { useEffect, useState } from "react";
import { subscribeLog, refreshSharedLog } from "../lib/auditlog";
import { scanStats, totalScans, type ScanStat } from "../lib/scanstats";
import { verdictMeta } from "../lib/verdict";
import { auditImage } from "../lib/avatars";

const KIND_LABEL: Record<string, string> = { person: "handle", token: "token", site: "site" };

function TrendArrow({ trend }: { trend: ScanStat["trend"] }) {
  if (trend === "up") {
    return (
      <span className="inline-flex items-center gap-0.5" style={{ color: "var(--color-pass)" }} title="Scan activity accelerating">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 5l7 9H5z" /></svg>
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="inline-flex items-center gap-0.5" style={{ color: "var(--color-avoid)" }} title="Scan activity cooling">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 19l-7-9h14z" /></svg>
      </span>
    );
  }
  return <span className="text-ink-faint" title="Holding steady">–</span>;
}

export function TrendingPage({ onOpen }: { onOpen: (ref: string) => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribeLog(() => setTick((t) => t + 1));
    // keep the community ranking live as other analysts' scans land
    void refreshSharedLog();
    const iv = setInterval(() => { void refreshSharedLog(); }, 45000);
    return () => { unsub(); clearInterval(iv); };
  }, []);

  const stats = scanStats().slice(0, 40);
  const total = totalScans();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[26px] font-medium tracking-[-0.02em] text-ink">
            Trending
            <span className="mono inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-signal-dim">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-signal)" }} /> live
            </span>
          </h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
            The most-scanned subjects across ARGUS. The ranking updates as scans come in and positions shift with them.
          </p>
        </div>
        <div className="text-right">
          <div className="mono text-[22px] font-semibold tabular text-ink">{total.toLocaleString()}</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">total scans</div>
        </div>
      </div>

      <div className="mt-6 space-y-1.5">
        {stats.length === 0 ? (
          <p className="text-[13px] text-ink-faint">No scans yet. Audit a handle, token, or site and it starts climbing here.</p>
        ) : (
          stats.map((s) => {
            const vm = s.verdict ? verdictMeta(s.verdict) : null;
            const color = vm?.color ?? "var(--color-ink-faint)";
            const img = auditImage({ kind: s.kind, query: s.query, ref: s.ref, image: s.image });
            const letter = (s.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
            const top = s.rank <= 3;
            return (
              <button
                key={s.key}
                onClick={() => onOpen(s.ref)}
                title="Open the report"
                className="group flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition hover:border-line-2 hover:bg-panel/80"
              >
                <span
                  className="mono w-7 shrink-0 text-center text-[15px] font-semibold tabular"
                  style={{ color: top ? "var(--color-signal)" : "var(--color-ink-faint)" }}
                >
                  {s.rank}
                </span>
                {img ? (
                  <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-lg border border-line object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[13px] text-signal">{letter}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[13px] text-ink">{s.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <span className="block truncate text-[10.5px] text-ink-faint">{KIND_LABEL[s.kind] ?? s.kind}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[12px]">
                  <TrendArrow trend={s.trend} />
                  <span className="mono tabular text-ink-dim">{s.count}</span>
                  <span className="text-[10px] text-ink-faint">{s.count === 1 ? "scan" : "scans"}</span>
                </span>
                <span className="mono shrink-0 text-right leading-none" style={{ color }}>
                  <span className="block text-[16px] font-semibold tabular">{s.score ?? "—"}</span>
                  <span className="block text-[7.5px] tracking-wider">{s.verdict ?? ""}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
