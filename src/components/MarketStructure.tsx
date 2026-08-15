// Market structure panel for the threat report: the price/volume chart with the
// analysis drawn on top of it - detected trading ranges shaded and classified
// (accumulation / distribution / consolidation), the volume profile along the
// right edge showing where trade has concentrated, fib retracement levels from
// the window's swing, and the volume pane showing whether interest is building
// or drying up. All math lives in src/threat/marketstructure.ts; this file only
// fetches candles and renders.

import { useEffect, useRef, useState } from "react";
import { fetchOhlcv, type Candle, type OhlcvWindow } from "../lib/priceHistory";
import { analyzeMarketStructure, type MarketStructure, type RangeZone } from "../threat/marketstructure";

const ZONE_COLOR: Record<RangeZone["kind"], string> = {
  accumulation: "var(--color-pass)",
  distribution: "var(--color-avoid)",
  consolidation: "var(--color-ink-faint)",
};

const px = (n: number) =>
  n >= 1000 ? "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  : n >= 1 ? "$" + n.toFixed(2)
  : n >= 0.01 ? "$" + n.toFixed(4)
  : "$" + n.toPrecision(3);

const money = (n: number) =>
  n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(0);

const dateLabel = (ts: number, timeframe: "day" | "hour") => {
  const d = new Date(ts * 1000);
  return timeframe === "day"
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

/* chart geometry (viewBox units) */
const W = 640, PL = 6, PR = 6;
const PRICE_TOP = 8, PRICE_H = 172;                 // price pane
const VOL_TOP = 192, VOL_H = 52;                    // volume pane
const H = 258;                                       // + date labels row
const PROFILE_MAX_W = 90;                            // volume-profile bar reach

function Chart({ candles, timeframe, ms }: { candles: Candle[]; timeframe: "day" | "hour"; ms: MarketStructure }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = candles.length;

  const pad = (ms.priceHigh - ms.priceLow) * 0.03;
  const pLo = ms.priceLow - pad, pHi = ms.priceHigh + pad;
  const x = (i: number) => PL + (n > 1 ? (i / (n - 1)) * (W - PL - PR) : 0);
  const yP = (p: number) => PRICE_TOP + (1 - (p - pLo) / (pHi - pLo)) * PRICE_H;
  const vols = candles.map((k) => k.volumeUsd ?? 0);
  const maxV = Math.max(...vols, 1);
  const yV = (v: number) => VOL_TOP + VOL_H - (v / maxV) * VOL_H;

  const line = candles.map((k, i) => `${x(i).toFixed(1)},${yP(k.close).toFixed(1)}`).join(" ");
  const maxBin = Math.max(...ms.bins.map((b) => b.volume), 1);
  const pocBin = ms.bins.reduce((best, b, i) => (b.volume > ms.bins[best].volume ? i : best), 0);
  // 7-period volume average, drawn over the bars so the trend is visible.
  const volMa = vols.map((_, i) => {
    const from = Math.max(0, i - 6);
    const slice = vols.slice(from, i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
  const volMaLine = volMa.map((v, i) => `${x(i).toFixed(1)},${yV(v).toFixed(1)}`).join(" ");
  const barW = Math.max(1, ((W - PL - PR) / n) * 0.65);
  const ticks = n > 3 ? [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1] : [0, n - 1];
  const retrace = ms.fib.levels.filter((l) => l.ratio > 0 && l.ratio < 1);

  const onMove = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const cx = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((cx - PL) / (W - PL - PR)) * (n - 1)))));
  };
  const hk = hover != null ? candles[hover] : null;
  const prevC = hover != null && hover > 0 ? candles[hover - 1].close : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="price and volume chart with trading ranges, volume profile and fib levels"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* volume profile: where trade has concentrated, drawn from the right edge */}
        {ms.bins.map((b, i) => {
          const w = (b.volume / maxBin) * PROFILE_MAX_W;
          if (w < 0.5) return null;
          const yTop = yP(b.high);
          return (
            <rect key={i} x={W - PR - w} y={yTop} width={w} height={Math.max(1, yP(b.low) - yTop - 0.5)} fill="var(--color-signal)" opacity={i === pocBin ? 0.26 : 0.1} />
          );
        })}

        {/* trading-range bands, classified */}
        {ms.ranges.map((r, i) => {
          const yTop = yP(r.high), yBot = yP(r.low);
          const c = ZONE_COLOR[r.kind];
          return (
            <g key={i}>
              <rect x={PL} y={yTop} width={W - PL - PR} height={yBot - yTop} fill={c} opacity={0.07} />
              <line x1={PL} x2={W - PR} y1={yTop} y2={yTop} stroke={c} opacity={0.3} strokeWidth={0.75} />
              <line x1={PL} x2={W - PR} y1={yBot} y2={yBot} stroke={c} opacity={0.3} strokeWidth={0.75} />
              <text x={PL + 4} y={Math.min(yBot - 3, yTop + 10)} fontSize={8.5} fill={c} opacity={0.95} className="mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {r.kind}{r.active ? " · price here" : ""}
              </text>
            </g>
          );
        })}

        {/* fib retracement levels */}
        {retrace.map((l) => (
          <g key={l.ratio}>
            <line x1={PL} x2={W - PR} y1={yP(l.price)} y2={yP(l.price)} stroke="var(--color-ink-faint)" opacity={0.3} strokeWidth={0.75} strokeDasharray="3 3" />
            <text x={W - PR - 2} y={yP(l.price) - 2.5} fontSize={8.5} fill="var(--color-ink-faint)" textAnchor="end" className="mono">
              {l.ratio} · {px(l.price)}
            </text>
          </g>
        ))}

        {/* point of control: the single heaviest-traded price of the window */}
        <line x1={PL} x2={W - PR} y1={yP(ms.pocPrice)} y2={yP(ms.pocPrice)} stroke="var(--color-caution)" opacity={0.55} strokeWidth={1}>
          <title>point of control (heaviest-traded price)</title>
        </line>

        {/* price */}
        <defs>
          <linearGradient id="mkstr-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-signal)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-signal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${PL},${PRICE_TOP + PRICE_H} ${line} ${x(n - 1)},${PRICE_TOP + PRICE_H}`} fill="url(#mkstr-fill)" />
        <polyline points={line} fill="none" stroke="var(--color-signal)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />

        {/* price scale */}
        <text x={PL + 2} y={PRICE_TOP + 8} fontSize={8.5} fill="var(--color-ink-faint)" className="mono">{px(pHi)}</text>
        <text x={PL + 2} y={PRICE_TOP + PRICE_H - 2} fontSize={8.5} fill="var(--color-ink-faint)" className="mono">{px(pLo)}</text>

        {/* volume pane: bars only for candles whose volume was reported */}
        {candles.map((k, i) => {
          if (k.volumeUsd === undefined) return null;
          const up = i > 0 ? k.close >= candles[i - 1].close : true;
          return (
            <rect key={i} x={x(i) - barW / 2} y={yV(k.volumeUsd)} width={barW} height={VOL_TOP + VOL_H - yV(k.volumeUsd)} fill={up ? "var(--color-pass)" : "var(--color-avoid)"} opacity={0.5} />
          );
        })}
        <polyline points={volMaLine} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.1} opacity={0.8} strokeLinejoin="round" />
        <text x={PL + 2} y={VOL_TOP + 8} fontSize={8.5} fill="var(--color-ink-faint)" className="mono">volume · 7-bar avg</text>

        {/* date ticks */}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 2} fontSize={8.5} fill="var(--color-ink-faint)" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="mono">
            {dateLabel(candles[i].ts, timeframe)}
          </text>
        ))}

        {/* crosshair */}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PRICE_TOP} y2={VOL_TOP + VOL_H} stroke="var(--color-ink-dim)" strokeWidth={0.75} opacity={0.6} />
            <circle cx={x(hover)} cy={yP(candles[hover].close)} r={2.5} fill="var(--color-signal)" />
          </g>
        )}
      </svg>

      {hk && hover != null && (
        <div
          className="mono pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[10.5px] leading-relaxed text-ink-dim soft-shadow"
          style={hover < n / 2 ? { left: `${(x(hover) / W) * 100}%`, marginLeft: 10 } : { right: `${100 - (x(hover) / W) * 100}%`, marginRight: 10 }}
        >
          <div className="text-ink">{dateLabel(hk.ts, timeframe)}</div>
          <div>close {px(hk.close)}{prevC != null && prevC > 0 ? <span style={{ color: hk.close >= prevC ? "var(--color-pass)" : "var(--color-avoid)" }}> {hk.close >= prevC ? "+" : ""}{(((hk.close - prevC) / prevC) * 100).toFixed(1)}%</span> : null}</div>
          {hk.high !== undefined && hk.low !== undefined && <div className="text-ink-faint">range {px(hk.low)} - {px(hk.high)}</div>}
          <div className="text-ink-faint">{hk.volumeUsd !== undefined ? `vol ${money(hk.volumeUsd)}` : "vol not reported"}</div>
        </div>
      )}
    </div>
  );
}

type PanelEntry = { hist: OhlcvWindow; ms: MarketStructure } | "thin" | "none";

export function MarketStructurePanel({ address, chain, pairAddress }: { address: string; chain: string; pairAddress?: string }) {
  const [tf, setTf] = useState<"auto" | "day" | "hour">("auto");
  const [view, setView] = useState<{ hist: OhlcvWindow; ms: MarketStructure } | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "thin" | "none">("loading");
  // One fetch per timeframe per token; switching back is instant.
  const cache = useRef(new Map<string, PanelEntry>());

  useEffect(() => {
    let stale = false;
    const apply = (e: PanelEntry) => {
      if (stale) return;
      if (e === "none" || e === "thin") { setView(null); setState(e); }
      else { setView(e); setState("ok"); }
    };
    const cached = cache.current.get(tf);
    if (cached) { apply(cached); return; }
    setState("loading");
    fetchOhlcv(address, chain, pairAddress, tf === "auto" ? undefined : tf)
      .then((h) => {
        let e: PanelEntry = "none";
        if (h) {
          const a = analyzeMarketStructure(h.candles);
          e = a ? { hist: h, ms: a } : "thin";
        }
        cache.current.set(tf, e);
        // auto resolves to a concrete timeframe: seed that key too so clicking
        // the already-active toggle doesn't refetch.
        if (tf === "auto" && typeof e === "object") cache.current.set(e.hist.timeframe, e);
        apply(e);
      })
      .catch(() => apply("none"));
    return () => { stale = true; };
  }, [tf, address, chain, pairAddress]);

  const hist = view?.hist ?? null;
  const ms = view?.ms ?? null;
  const resolved = tf === "auto" ? hist?.timeframe : tf;
  const vol = ms?.volume;
  const volColor = vol?.direction === "rising" ? "var(--color-pass)" : vol?.direction === "falling" ? "var(--color-avoid)" : "var(--color-ink-dim)";

  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-ink">Market structure</h2>
        <div className="flex items-center gap-2">
          {state === "ok" && hist && (
            <span className="mono text-[10.5px] text-ink-faint">{hist.candles.length} {hist.timeframe === "day" ? "daily" : "hourly"} candles · GeckoTerminal</span>
          )}
          <div className="flex gap-1">
            {(["day", "hour"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setTf(o)}
                disabled={state === "loading"}
                className="mono rounded border px-1.5 py-0.5 text-[10px] transition"
                style={resolved === o ? { borderColor: "var(--color-signal)", color: "var(--color-signal)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-faint)" }}
                title={o === "day" ? "daily candles" : "hourly candles (recent structure)"}
              >
                {o === "day" ? "1D" : "1H"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-0.5 text-[11.5px] text-ink-faint">Trading ranges read from the volume profile and classified by money flow: accumulation (buyers absorbing), distribution (sellers unloading). Fib levels from the window's swing; the right-edge bars show where volume has concentrated.</p>

      {state === "loading" && <div className="mt-3 h-40 animate-pulse rounded-lg bg-line/40" />}
      {state === "none" && <p className="mt-3 text-[12.5px] text-ink-dim">No indexed {tf === "auto" ? "" : tf === "day" ? "daily " : "hourly "}OHLCV history for this pool - the chart and range analysis need candle data.</p>}
      {state === "thin" && <p className="mt-3 text-[12.5px] text-ink-dim">Not enough {tf === "hour" ? "hourly " : ""}trading history to map ranges yet (needs 12+ candles with volume).</p>}

      {state === "ok" && hist && ms && (
        <>
          <div className="mt-3"><Chart candles={hist.candles} timeframe={hist.timeframe} ms={ms} /></div>

          {/* the three reads: volume trend, concentration, current position */}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line/70 bg-line/10 px-3 py-2.5">
              <div className="mono text-[9.5px] uppercase tracking-widest text-ink-faint">volume trend</div>
              <div className="mono mt-1 text-[15px] font-semibold" style={{ color: volColor }}>
                {vol!.direction}{vol!.direction !== "flat" ? ` ${vol!.changePct >= 0 ? "+" : ""}${vol!.changePct.toFixed(0)}%` : ""}
              </div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">
                last {vol!.recentCount} bars avg {money(vol!.recentAvg)} vs {money(vol!.priorAvg)} before · {(vol!.recentUpShare * 100).toFixed(0)}% of recent volume on up bars
              </div>
            </div>
            <div className="rounded-lg border border-line/70 bg-line/10 px-3 py-2.5">
              <div className="mono text-[9.5px] uppercase tracking-widest text-ink-faint">concentration</div>
              <div className="mono mt-1 text-[15px] font-semibold text-ink">{px(ms.pocPrice)}</div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">
                point of control · 70% of volume traded {px(ms.valueArea.low)} - {px(ms.valueArea.high)}
              </div>
            </div>
            <div className="rounded-lg border border-line/70 bg-line/10 px-3 py-2.5">
              <div className="mono text-[9.5px] uppercase tracking-widest text-ink-faint">price position</div>
              <div className="mono mt-1 text-[15px] font-semibold text-ink">{px(ms.lastClose)}</div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">
                {ms.support != null ? `support ${px(ms.support)}` : "no volume shelf below"} · {ms.resistance != null ? `resistance ${px(ms.resistance)}` : "no volume shelf above"}
              </div>
            </div>
          </div>

          {/* range table: the data behind the shaded bands */}
          {ms.ranges.length > 0 && (
            <div className="mt-3 divide-y divide-line/60">
              {ms.ranges.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: ZONE_COLOR[r.kind] }} />
                  <span className="mono w-24 text-[11px] font-medium" style={{ color: ZONE_COLOR[r.kind] }}>{r.kind}</span>
                  <span className="mono text-[11.5px] text-ink">{px(r.low)} - {px(r.high)}</span>
                  {r.active && (
                    <span className="mono shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider" style={{ color: "var(--color-signal)", borderColor: "var(--color-signal)" }}>price here</span>
                  )}
                  <span className="mono text-[10.5px] text-ink-faint">
                    {(r.volumeShare * 100).toFixed(0)}% of volume · {(r.timeShare * 100).toFixed(0)}% of time · flow {r.flowRatio >= 0 ? "+" : ""}{r.flowRatio.toFixed(2)}
                  </span>
                  {r.fibHits.length > 0 && (
                    <span className="mono rounded border border-line px-1.5 py-0.5 text-[9.5px] text-ink-dim">fib {r.fibHits.join(" / ")}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="mono mt-2 text-[10px] text-ink-faint">
            fib {ms.fib.direction === "up" ? "retracement of the up-leg" : "retracement of the down-leg"} · swing {px(ms.fib.swingLow)} to {px(ms.fib.swingHigh)} · ranges = contiguous above-average volume bins · flow = close-position money flow, +1 all buying / -1 all selling
          </p>
        </>
      )}
    </div>
  );
}
