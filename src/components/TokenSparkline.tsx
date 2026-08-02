import { useEffect, useRef, useState } from "react";
import { fetchPriceHistory, type PriceHistory } from "../lib/priceHistory";

// Price-performance chart from GeckoTerminal OHLCV. Two sizes: `compact` is an
// inline sparkline for a KOL's promoted-token rows ("did this call go to zero?"),
// full is the price chart on a token audit. Colour follows direction.
//
// The full chart shades each period's reported high and low behind the close
// line. A token that ran 40x inside one day and closed flat is the diligence
// question, and a close-only line cannot tell it apart from one that never
// moved. The band is drawn only from a window where EVERY candle reported both
// columns, so it never traces a price no source published.
const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(1)}%`;

const priceLabel = (n: number) => n < 0.01
  ? `$${n.toPrecision(3)}`
  : `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

interface Scale {
  x: (index: number) => number;
  y: (value: number) => number;
}

function scale(count: number, min: number, max: number, w: number, h: number, pad: number): Scale {
  const span = max - min || 1;
  const step = count > 1 ? (w - pad * 2) / (count - 1) : 0;
  return {
    x: (index) => pad + index * step,
    y: (value) => pad + (h - pad * 2) * (1 - (value - min) / span),
  };
}

function line(values: number[], s: Scale): string {
  return values.map((value, index) => `${s.x(index).toFixed(1)},${s.y(value).toFixed(1)}`).join(" ");
}

/** Highs and lows only when both run the full length of the close series. */
function bandOf(hist: PriceHistory): { highs: number[]; lows: number[] } | null {
  const { highs, lows } = hist.range ?? {};
  return highs?.length === hist.points.length && lows?.length === hist.points.length
    ? { highs, lows }
    : null;
}

export function TokenSparkline({ address, chain, pairAddress, compact, hidePct, history }: { address: string; chain: string; pairAddress?: string; compact?: boolean; hidePct?: boolean; history?: PriceHistory }) {
  const [liveHistory, setLiveHistory] = useState<PriceHistory | null>(null);
  const [liveState, setLiveState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (history) return;
    if (ran.current) return;
    ran.current = true;
    let active = true;
    fetchPriceHistory(address, chain, pairAddress)
      .then((h) => {
        if (!active) return;
        setLiveHistory(h);
        setLiveState(h ? "ok" : "none");
      })
      .catch(() => { if (active) setLiveState("none"); });
    return () => { active = false; };
  }, [address, chain, history, pairAddress]);

  const hist = history ?? liveHistory;
  const state = history ? "ok" : liveState;

  if (state === "none") return compact ? <span className="text-[11px] text-ink-faint">no chart</span> : <div className="text-[12.5px] text-ink-faint">No historical price data indexed for this pool.</div>;
  if (state === "loading" || !hist) {
    return compact ? <span className="text-[11px] text-ink-faint">…</span> : <div className="h-24 animate-pulse rounded-lg bg-line/40" />;
  }

  const up = hist.changePct >= 0;
  const color = up ? "var(--color-pass)" : "var(--color-avoid)";
  const gid = `spk-${address.slice(0, 8)}${compact ? "c" : "f"}`;

  if (compact) {
    const w = 66, h = 20;
    const s = scale(hist.points.length, Math.min(...hist.points), Math.max(...hist.points), w, h, 1);
    return (
      <span className="inline-flex items-center gap-1.5">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" role="img" aria-label="price shape">
          <polyline points={line(hist.points, s)} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {!hidePct && <span className="mono text-[11px]" style={{ color }}>{pct(hist.changePct)}</span>}
      </span>
    );
  }

  const w = 560, h = 120, pad = 3;
  const band = bandOf(hist);
  // The band sets the vertical scale when it exists, so an intraday spike is
  // drawn at its real height instead of being clipped by a close-only range.
  const s = scale(
    hist.points.length,
    band ? Math.min(...band.lows) : Math.min(...hist.points),
    band ? Math.max(...band.highs) : Math.max(...hist.points),
    w, h, pad,
  );
  const poly = line(hist.points, s);
  const bandPoly = band
    ? `${line(band.highs, s)} ${band.lows.map((value, index) => `${s.x(index).toFixed(1)},${s.y(value).toFixed(1)}`).reverse().join(" ")}`
    : null;

  const unit = hist.timeframe === "day" ? "day" : "hour";
  // A window with holes covers fewer periods than its span, and must say so
  // rather than presenting a shorter series as the whole stretch.
  const observed = hist.windowIsPartial && hist.spanPeriods
    ? `${hist.points.length} of ${hist.spanPeriods} ${unit}s observed`
    : `${hist.points.length} ${unit === "day" ? "days" : "hrs"}`;
  // Prefer the fall from the reported intraday high; a peak measured on closes
  // is blind to the day that ran and gave it all back, so label which one this
  // is either way.
  const fall = hist.range ? hist.range.drawdownFromHighPct : hist.drawdownPct;
  const fallLabel = hist.range ? "from the window high" : "from the highest close";

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 120 }} role="img" aria-label={`${hist.timeframe} token price history${band ? ` with reported ${unit} high and low range` : ""}`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {bandPoly
          ? <polygon data-testid="range-band" points={bandPoly} fill={color} fillOpacity="0.17" />
          : <polygon points={`${pad},${h - pad} ${poly} ${w - pad},${h - pad}`} fill={`url(#${gid})`} />}
        <polyline points={poly} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span style={{ color }}>{pct(hist.changePct)} <span className="text-ink-faint">over {observed}</span></span>
        {fall < -1 && <span className="text-avoid">{pct(fall)} <span className="text-ink-faint">{fallLabel}</span></span>}
        {hist.range && (
          <span className="text-ink-dim">
            {priceLabel(hist.range.low)} to {priceLabel(hist.range.high)}{" "}
            <span className="text-ink-faint">
              reported range{hist.range.measuredPoints < hist.points.length ? ` over ${hist.range.measuredPoints} of ${hist.points.length} ${unit}s` : ""}
            </span>
          </span>
        )}
        {hist.volume && (
          <span style={{ color: hist.volume.changePct <= -50 ? "var(--color-caution)" : "var(--color-ink-dim)" }}>
            volume {pct(hist.volume.changePct)}{" "}
            <span className="text-ink-faint">
              vs the prior {hist.volume.prior.candles} {unit}s{hist.volume.isFloor ? ", a floor: not every candle reported volume" : ""}
            </span>
          </span>
        )}
      </div>
      {hist.range && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-ink-faint">
          The shaded band is each {unit}'s reported high and low; the line is its close. A high is the highest price this
          source recorded inside that one {unit}, not a proven all-time high.
        </p>
      )}
    </div>
  );
}
