import { ArrowSquareOut } from "@phosphor-icons/react";
import { usdCompact } from "../lib/format";
import type { HolderProfileSnapshot, ProtocolFeesSnapshot, ProtocolTvlSnapshot } from "../data/evidence";

/**
 * The capital footprint as pictures instead of prose: a 180-day TVL trend
 * line (frozen weekly points from the scan) and a per-chain breakdown bar.
 * Every pixel derives from the immutable snapshot; the panel renders nothing
 * when the snapshot has nothing to draw.
 */

const SEGMENT_OPACITY = [1, 0.72, 0.5, 0.34, 0.2];

function TrendChart({ trend, change30dPct }: {
  trend: NonNullable<ProtocolTvlSnapshot["trend"]>;
  change30dPct?: number | null;
}) {
  const w = 560, h = 92, pad = 4;
  const values = trend.map((point) => point.tvlUsd);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  const points = trend.map((point, index) => ({
    x: pad + (index * (w - pad * 2)) / Math.max(1, trend.length - 1),
    y: h - pad - ((point.tvlUsd - lo) * (h - pad * 2)) / span,
  }));
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${points[points.length - 1].x.toFixed(1)},${h - pad}`;
  const last = points[points.length - 1];
  const first = trend[0];
  const latest = trend[trend.length - 1];
  const deltaTone = change30dPct == null ? "" : change30dPct >= 0 ? "text-pass" : "text-caution";
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15.5px] font-semibold tracking-tight text-ink tabular-nums">{usdCompact(latest.tvlUsd)}</span>
        <span className="text-[10px] uppercase tracking-[0.09em] text-ink-faint">value locked</span>
        {change30dPct != null && (
          <span className={`mono text-[11px] ${deltaTone}`}>
            {change30dPct >= 0 ? "+" : ""}{change30dPct}% vs 30 days ago
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-2 block w-full text-signal-lift"
        role="img"
        aria-label={`Total value locked over ${trend.length} weekly readings, from ${usdCompact(first.tvlUsd)} on ${first.date} to ${usdCompact(latest.tvlUsd)} on ${latest.date}`}
      >
        <polygon points={area} fill="currentColor" opacity="0.12" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx={last.x} cy={last.y} r="2.6" fill="currentColor" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span className="mono">{first.date}</span>
        <span className="mono">{latest.date}</span>
      </div>
    </div>
  );
}

function ChainBar({ breakdown, totalUsd }: {
  breakdown: NonNullable<ProtocolTvlSnapshot["chainBreakdown"]>;
  totalUsd: number;
}) {
  const total = breakdown.reduce((sum, entry) => sum + entry.tvlUsd, 0) || totalUsd;
  const top = breakdown.slice(0, 4);
  const restUsd = breakdown.slice(4).reduce((sum, entry) => sum + entry.tvlUsd, 0);
  const segments = [
    ...top.map((entry) => ({ label: entry.chain, tvlUsd: entry.tvlUsd })),
    ...(restUsd > 0 ? [{ label: `${breakdown.length - top.length} more chains`, tvlUsd: restUsd }] : []),
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" role="img" aria-label={`Value locked by chain: ${segments.map((segment) => `${segment.label} ${usdCompact(segment.tvlUsd)}`).join(", ")}`}>
        {segments.map((segment, index) => (
          <div
            key={segment.label}
            className="h-full bg-signal-lift"
            style={{ width: `${Math.max(1.5, (segment.tvlUsd / total) * 100)}%`, opacity: SEGMENT_OPACITY[index] ?? 0.2 }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment, index) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-signal-lift" style={{ opacity: SEGMENT_OPACITY[index] ?? 0.2 }} aria-hidden="true" />
            {segment.label}
            <span className="mono text-ink-faint tabular-nums">{usdCompact(segment.tvlUsd)} · {Math.round((segment.tvlUsd / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FeeStat({ fees }: { fees: ProtocolFeesSnapshot & { capturedAt?: string } }) {
  if (fees.total30dUsd == null || fees.total30dUsd <= 0) return null;
  const delta = fees.change30dOver30dPct;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15.5px] font-semibold tracking-tight text-ink tabular-nums">{usdCompact(fees.total30dUsd)}</span>
        <span className="text-[10px] uppercase tracking-[0.09em] text-ink-faint">fees earned · 30 days</span>
        {delta != null && (
          <span className={`mono text-[11px] ${delta >= 0 ? "text-pass" : "text-caution"}`}>
            {delta >= 0 ? "+" : ""}{delta}% vs prior 30 days
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        Real fees are usage no marketing can fake: someone paid to use this protocol.
      </p>
    </div>
  );
}

/**
 * Float control as one bar: the largest holder, the rest of the top 10, and
 * everyone else. The judgment stays with the reader; the bar just makes the
 * split visible at a glance.
 */
function HolderBar({ holders }: { holders: HolderProfileSnapshot }) {
  const top1 = holders.topHolderPct;
  const top10 = holders.top10Pct;
  if (top1 == null || top10 == null || top10 <= 0 || top10 > 100 || top1 < 0 || top1 > top10) return null;
  const nextNine = Math.max(0, top10 - top1);
  const rest = Math.max(0, 100 - top10);
  const segments = [
    { label: "largest holder", pct: top1 },
    { label: "next 9 holders", pct: nextNine },
    { label: "everyone else", pct: rest },
  ].filter((segment) => segment.pct > 0);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15.5px] font-semibold tracking-tight text-ink tabular-nums">{Math.round(top10)}%</span>
        <span className="text-[10px] uppercase tracking-[0.09em] text-ink-faint">of supply sits with the top 10</span>
        {holders.holderCount != null && holders.holderCount > 0 && (
          <span className="mono text-[11px] text-ink-faint">{holders.holderCount.toLocaleString()} holders</span>
        )}
      </div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full" role="img" aria-label={`Supply split: ${segments.map((segment) => `${segment.label} ${Math.round(segment.pct)}%`).join(", ")}`}>
        {segments.map((segment, index) => (
          <div key={segment.label} className="h-full bg-signal-lift" style={{ width: `${Math.max(1.5, segment.pct)}%`, opacity: SEGMENT_OPACITY[index] ?? 0.2 }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment, index) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <span className="h-2 w-2 shrink-0 rounded-sm bg-signal-lift" style={{ opacity: SEGMENT_OPACITY[index] ?? 0.2 }} aria-hidden="true" />
            {segment.label}
            <span className="mono text-ink-faint tabular-nums">{Math.round(segment.pct)}%</span>
          </span>
        ))}
        {holders.lpLockedOrBurnedPct != null && holders.lpLockedOrBurnedPct > 0 && (
          <span className="text-[11px] text-ink-faint">LP {Math.round(holders.lpLockedOrBurnedPct)}% locked or burned</span>
        )}
      </div>
    </div>
  );
}

export function UsageVisuals({ tvl, fees, holders }: {
  tvl?: ProtocolTvlSnapshot & { capturedAt?: string };
  fees?: ProtocolFeesSnapshot & { capturedAt?: string };
  holders?: HolderProfileSnapshot;
}) {
  const trend = (tvl?.trend ?? []).filter((point) => point.tvlUsd > 0);
  const breakdown = (tvl?.chainBreakdown ?? []).filter((entry) => entry.tvlUsd > 0);
  const hasTrend = trend.length >= 2;
  const hasBreakdown = breakdown.length >= 2;
  const hasFees = fees != null && fees.total30dUsd != null && fees.total30dUsd > 0;
  const hasHolders = holders != null && holders.topHolderPct != null && holders.top10Pct != null;
  if (!hasTrend && !hasBreakdown && !hasFees && !hasHolders) return null;
  const capturedAt = tvl?.capturedAt ?? fees?.capturedAt;
  const sourceUrl = tvl?.sourceUrl ?? fees?.sourceUrl;
  return (
    <section className="panel scroll-mt-28 px-4 py-4 sm:px-5" aria-labelledby="usage-visuals-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-visuals-title" className="text-[13.5px] font-semibold tracking-tight text-ink">Capital footprint</h2>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mono inline-flex items-center gap-1 text-[10.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
          >
            DeFiLlama{capturedAt ? ` · ${String(capturedAt).slice(0, 10)}` : ""}
            <ArrowSquareOut aria-hidden="true" size={11} weight="bold" />
          </a>
        )}
      </div>
      <div className={`mt-3 grid gap-x-8 gap-y-5 ${hasTrend && hasBreakdown ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        {hasTrend && tvl && <TrendChart trend={trend} change30dPct={tvl.change30dPct} />}
        {hasBreakdown && tvl && (
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-[15.5px] font-semibold tracking-tight text-ink tabular-nums">{breakdown.length}</span>
              <span className="text-[10px] uppercase tracking-[0.09em] text-ink-faint">chains hold the value</span>
            </div>
            <div className="mt-2">
              <ChainBar breakdown={breakdown} totalUsd={tvl.tvlUsd} />
            </div>
          </div>
        )}
      </div>
      {(hasFees || hasHolders) && (
        <div className={`mt-5 grid gap-x-8 gap-y-5 border-t border-line/60 pt-4 ${hasFees && hasHolders ? "lg:grid-cols-2" : ""}`}>
          {hasFees && fees && <FeeStat fees={fees} />}
          {hasHolders && holders && <HolderBar holders={holders} />}
        </div>
      )}
    </section>
  );
}
