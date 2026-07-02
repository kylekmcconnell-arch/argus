import { useEffect, useRef, useState } from "react";
import { fetchPriceHistory, type PriceHistory } from "../lib/priceHistory";

// Price-performance chart from GeckoTerminal OHLCV. Two sizes: `compact` is an
// inline sparkline for a KOL's promoted-token rows ("did this call go to zero?"),
// full is the price chart on a token audit. Colour follows direction.
const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(1)}%`;

function line(points: number[], w: number, h: number, pad = 1): string {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  return points
    .map((p, i) => `${(pad + i * step).toFixed(1)},${(pad + (h - pad * 2) * (1 - (p - min) / span)).toFixed(1)}`)
    .join(" ");
}

export function TokenSparkline({ address, chain, pairAddress, compact }: { address: string; chain: string; pairAddress?: string; compact?: boolean }) {
  const [hist, setHist] = useState<PriceHistory | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fetchPriceHistory(address, chain, pairAddress)
      .then((h) => { setHist(h); setState(h ? "ok" : "none"); })
      .catch(() => setState("none"));
  }, [address, chain, pairAddress]);

  if (state === "none") return compact ? <span className="text-[10px] text-ink-faint">no chart</span> : <div className="text-[11.5px] text-ink-faint">No historical price data indexed for this pool.</div>;
  if (state === "loading" || !hist) {
    return compact ? <span className="text-[10px] text-ink-faint">…</span> : <div className="h-24 animate-pulse rounded-lg bg-line/40" />;
  }

  const up = hist.changePct >= 0;
  const color = up ? "var(--color-pass)" : "var(--color-avoid)";
  const gid = `spk-${address.slice(0, 8)}${compact ? "c" : "f"}`;

  if (compact) {
    const w = 66, h = 20;
    return (
      <span className="inline-flex items-center gap-1.5">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
          <polyline points={line(hist.points, w, h)} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <span className="mono text-[10.5px]" style={{ color }}>{pct(hist.changePct)}</span>
      </span>
    );
  }

  const w = 560, h = 120;
  const poly = line(hist.points, w, h, 3);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 120 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`3,${h - 3} ${poly} ${w - 3},${h - 3}`} fill={`url(#${gid})`} />
        <polyline points={poly} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span style={{ color }}>{pct(hist.changePct)} <span className="text-ink-faint">over {hist.points.length} {hist.timeframe === "day" ? "days" : "hrs"}</span></span>
        {hist.drawdownPct < -1 && <span className="text-avoid">{pct(hist.drawdownPct)} <span className="text-ink-faint">from peak</span></span>}
      </div>
    </div>
  );
}
