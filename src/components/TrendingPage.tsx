import { useEffect, useState } from "react";
import { subscribeLog, refreshSharedLog } from "../lib/auditlog";
import { scanStats, totalScans, type ScanStat, type ScanCategory } from "../lib/scanstats";
import { verdictMeta } from "../lib/verdict";
import { auditImage } from "../lib/avatars";

const KIND_LABEL: Record<string, string> = { person: "handle", token: "token", site: "site" };

const RANGES: { label: string; ms: number | null }[] = [
  { label: "All time", ms: null },
  { label: "1h", ms: 3_600_000 },
  { label: "24h", ms: 86_400_000 },
  { label: "7d", ms: 604_800_000 },
  { label: "30d", ms: 2_592_000_000 },
];
const CATS: { label: string; cat: ScanCategory | null }[] = [
  { label: "All", cat: null },
  { label: "Founders", cat: "founder" },
  { label: "VCs", cat: "vc" },
  { label: "KOLs", cat: "kol" },
  { label: "Projects", cat: "project" },
  { label: "Sites", cat: "site" },
];

function TrendArrow({ trend }: { trend: ScanStat["trend"] }) {
  if (trend === "up") return <span className="inline-flex text-pass" title="Scan activity accelerating"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 5l7 9H5z" /></svg></span>;
  if (trend === "down") return <span className="inline-flex text-avoid" title="Scan activity cooling"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 19l-7-9h14z" /></svg></span>;
  return <span className="text-ink-faint" title="Holding steady">–</span>;
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`mono rounded-md border px-2.5 py-1 text-[11px] transition ${on ? "tint-signal" : "border-line text-ink-dim hover:text-ink"}`}
    >
      {label}
    </button>
  );
}

export function TrendingPage({ onOpen }: { onOpen: (ref: string) => void }) {
  const [, setTick] = useState(0);
  const [rangeMs, setRangeMs] = useState<number | null>(null);
  const [cat, setCat] = useState<ScanCategory | null>(null);
  useEffect(() => {
    const unsub = subscribeLog(() => setTick((t) => t + 1));
    void refreshSharedLog();
    const iv = setInterval(() => { void refreshSharedLog(); }, 45000);
    return () => { unsub(); clearInterval(iv); };
  }, []);

  const stats = scanStats(Date.now(), { rangeMs, category: cat }).slice(0, 40);
  const total = totalScans(rangeMs);
  const rangeLabel = (RANGES.find((r) => r.ms === rangeMs)?.label ?? "All time").toLowerCase();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 display-sm text-[24px] text-ink">
            Market trends
            <span className="mono inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] uppercase tracking-wider text-signal-lift">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" /> live
            </span>
          </h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
            The most-scanned subjects across ARGUS. The ranking updates as scans come in and positions shift with them.
          </p>
        </div>
        <div className="text-right">
          <div className="mono text-[18px] font-semibold tabular text-ink">{total.toLocaleString()}</div>
          <div className="stat-label">scans · {rangeLabel}</div>
        </div>
      </div>

      {/* filters */}
      <div className="mt-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1">window</span>
          {RANGES.map((r) => <Chip key={r.label} label={r.label} on={rangeMs === r.ms} onClick={() => setRangeMs(r.ms)} />)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1">category</span>
          {CATS.map((c) => <Chip key={c.label} label={c.label} on={cat === c.cat} onClick={() => setCat(c.cat)} />)}
        </div>
      </div>

      <div className="mt-5 space-y-1.5">
        {stats.length === 0 ? (
          <p className="empty-state">No scans in this window{cat ? ` for ${CATS.find((c) => c.cat === cat)?.label.toLowerCase()}` : ""}. Widen the range or run an audit.</p>
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
                className="panel group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:border-line-2 hover:bg-panel/80"
              >
                <span className={`mono w-7 shrink-0 text-center text-[15px] font-semibold tabular ${top ? "text-signal-lift" : "text-ink-faint"}`}>{s.rank}</span>
                {img ? (
                  <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-md border border-line object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[12.5px] text-signal-lift">{letter}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[13.5px] text-ink">{s.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <span className="block truncate text-[11px] text-ink-faint">{KIND_LABEL[s.kind] ?? s.kind}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[12.5px]">
                  <TrendArrow trend={s.trend} />
                  <span className="mono tabular text-ink-dim">{s.count}</span>
                  <span className="text-[11px] text-ink-faint">{s.count === 1 ? "scan" : "scans"}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 leading-none">
                  <span className="mono text-[18px] font-semibold tabular" style={{ color }}>{s.score ?? "N/A"}</span>
                  {s.verdict && <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}>{s.verdict}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
