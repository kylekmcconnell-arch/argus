import { ArrowSquareOut } from "@phosphor-icons/react";
import { usdCompact } from "../lib/format";
import type { ProtocolTvlSnapshot } from "../data/evidence";

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

export function UsageVisuals({ tvl }: { tvl?: ProtocolTvlSnapshot & { capturedAt?: string } }) {
  if (!tvl) return null;
  const trend = (tvl.trend ?? []).filter((point) => point.tvlUsd > 0);
  const breakdown = (tvl.chainBreakdown ?? []).filter((entry) => entry.tvlUsd > 0);
  const hasTrend = trend.length >= 2;
  const hasBreakdown = breakdown.length >= 2;
  if (!hasTrend && !hasBreakdown) return null;
  return (
    <section className="panel scroll-mt-28 px-4 py-4 sm:px-5" aria-labelledby="usage-visuals-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-visuals-title" className="text-[13.5px] font-semibold tracking-tight text-ink">Capital footprint</h2>
        <a
          href={tvl.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mono inline-flex items-center gap-1 text-[10.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
        >
          DeFiLlama{tvl.capturedAt ? ` · ${String(tvl.capturedAt).slice(0, 10)}` : ""}
          <ArrowSquareOut aria-hidden="true" size={11} weight="bold" />
        </a>
      </div>
      <div className={`mt-3 grid gap-x-8 gap-y-4 ${hasTrend && hasBreakdown ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        {hasTrend && <TrendChart trend={trend} change30dPct={tvl.change30dPct} />}
        {hasBreakdown && (
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
    </section>
  );
}
