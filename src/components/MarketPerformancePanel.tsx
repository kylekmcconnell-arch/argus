import { useEffect, useState } from "react";
import { ArrowClockwise, ChartLineUp, ShieldCheck } from "@phosphor-icons/react";
import type { ProjectTokenSnapshot } from "../data/evidence";
import { coingeckoToken, type CgInfo } from "../token/sources";
import type { TokenDossier } from "../token/audit";
import type { PriceHistory } from "../lib/priceHistory";
import { TokenSparkline } from "./TokenSparkline";

interface MarketPerformancePanelProps {
  token?: TokenDossier;
  projectToken?: ProjectTokenSnapshot;
  showCurrentIntelligence: boolean;
  refreshCurrentMarket?: boolean;
  onLoadCurrentIntelligence?: () => void;
  embedded?: boolean;
}

interface ScaleMetric {
  label: string;
  value: number;
  detail: string;
  color: string;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function money(value?: number | null): string {
  if (!finite(value)) return "Not captured";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function price(value?: number | null): string {
  if (!finite(value)) return "Not captured";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toPrecision(3)}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function percent(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : 1;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function displayDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function displayCaptureDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function sameContract(chain: string, left: string, right: string): boolean {
  return chain.toLowerCase() === "solana"
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

function exactProjectToken(
  token: TokenDossier | undefined,
  projectToken: ProjectTokenSnapshot | undefined,
): ProjectTokenSnapshot | undefined {
  if (!projectToken || !token) return projectToken;
  return sameContract(token.chain, token.address, projectToken.address) ? projectToken : undefined;
}

function projectHistory(projectToken?: ProjectTokenSnapshot): PriceHistory | undefined {
  if (!projectToken?.history) return undefined;
  return {
    ...projectToken.history,
    capturedAt: projectToken.capturedAt,
  };
}

function metricDetail(value: number, marketCap?: number): string {
  if (!finite(marketCap) || marketCap <= 0) return "captured value";
  const ratio = value / marketCap;
  if (ratio >= 1) return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x market cap`;
  return `${(ratio * 100).toFixed(ratio < 0.01 ? 1 : 0)}% of market cap`;
}

export function MarketPerformancePanel({
  token,
  projectToken: candidateProjectToken,
  showCurrentIntelligence,
  refreshCurrentMarket = false,
  onLoadCurrentIntelligence,
  embedded = false,
}: MarketPerformancePanelProps) {
  const projectToken = exactProjectToken(token, candidateProjectToken);
  const address = projectToken?.address ?? token?.address ?? "";
  const chain = projectToken?.chain ?? token?.chain ?? "";
  const symbol = projectToken?.symbol ?? token?.symbol ?? "TOKEN";
  const hasCoinGeckoRankContext = Boolean(projectToken?.coingeckoId || token?.cg);
  const headingId = `market-performance-${address.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "token"}`;
  const pairAddress = projectToken?.pairAddress ?? projectToken?.history?.poolAddress ?? token?.pairAddress;
  const history = projectHistory(projectToken) ?? token?.priceHistory;
  const frozenAth = projectToken?.ath ?? token?.cg?.ath ?? null;
  const frozenMarketCap = projectToken?.marketCapUsd ?? token?.cg?.mcapUsd;
  const requestKey = `${chain}\u0000${address}`;
  const needsLiveMarket = refreshCurrentMarket
    && Boolean(address && chain)
    && (!finite(frozenAth?.drawdownPct) || !finite(frozenMarketCap));
  const [liveResult, setLiveResult] = useState<{
    key: string;
    state: "ok" | "none";
    data: CgInfo | null;
  } | null>(null);

  useEffect(() => {
    if (!needsLiveMarket) return;
    let active = true;
    void coingeckoToken(chain, address).then((data) => {
      if (!active) return;
      setLiveResult({
        key: requestKey,
        state: data?.listed ? "ok" : "none",
        data: data?.listed ? data : null,
      });
    });
    return () => {
      active = false;
    };
  }, [address, chain, needsLiveMarket, requestKey]);

  if (!address || !chain) return null;

  const currentLive = liveResult?.key === requestKey ? liveResult : null;
  const liveLoading = needsLiveMarket && currentLive === null;
  const liveMarket = currentLive?.state === "ok" ? currentLive.data : null;
  const ath = finite(frozenAth?.drawdownPct) ? frozenAth : liveMarket?.ath ?? frozenAth;
  const marketCap = frozenMarketCap
    ?? (finite(liveMarket?.mcapUsd) ? liveMarket.mcapUsd : undefined)
    ?? token?.mcap;
  const marketCapIsDexValuation = !finite(frozenMarketCap)
    && !finite(liveMarket?.mcapUsd)
    && finite(token?.mcap);
  const fdv = projectToken?.fdvUsd
    ?? (finite(token?.mcap) && finite(marketCap) && token.mcap > marketCap * 1.02 ? token.mcap : undefined);
  const volume = projectToken?.volume24hUsd ?? token?.vol24;
  const liquidity = projectToken?.liquidityUsd ?? token?.liquidityUsd;
  const currentPrice = projectToken?.priceUsd ?? token?.priceUsd;
  const rank = projectToken?.rank ?? token?.cg?.rank ?? liveMarket?.rank;
  const observedDrawdown = history && finite(history.drawdownPct) ? history.drawdownPct : null;
  const hasTrueAth = finite(ath?.drawdownPct);
  const performanceValue = hasTrueAth ? ath.drawdownPct : observedDrawdown;
  const performanceLabel = hasTrueAth ? "From all-time high" : "From captured peak";
  const performanceDetail = hasTrueAth
    ? [
        finite(ath?.priceUsd) ? `ATH ${price(ath.priceUsd)}` : null,
        displayDate(ath?.date),
      ].filter(Boolean).join(" · ")
    : history
      ? `${history.points.length} ${history.timeframe === "day" ? "day" : "hour"} observations`
      : "Refresh the lifetime market record";
  const liveAth = hasTrueAth && !finite(frozenAth?.drawdownPct);
  const liveMarketCap = finite(marketCap)
    && !finite(frozenMarketCap)
    && finite(liveMarket?.mcapUsd);
  const captureDate = displayCaptureDate(projectToken?.capturedAt ?? token?.priceHistory?.capturedAt);
  const supplyDenominator = finite(projectToken?.maxSupply) && projectToken.maxSupply > 0
    ? projectToken.maxSupply
    : finite(projectToken?.totalSupply) && projectToken.totalSupply > 0
      ? projectToken.totalSupply
      : null;
  const circulatingPct = supplyDenominator !== null
    && finite(projectToken?.circulatingSupply)
    && projectToken.circulatingSupply > 0
    ? Math.min(100, Math.round((projectToken.circulatingSupply / supplyDenominator) * 100))
    : null;
  const momentum = [
    { label: "5m", value: token?.priceChange?.m5 },
    { label: "1h", value: token?.priceChange?.h1 },
    { label: "6h", value: token?.priceChange?.h6 },
    { label: "24h", value: token?.priceChange?.h24 },
  ];
  const hasMomentum = momentum.some((reading) => finite(reading.value));

  const scaleMetrics: ScaleMetric[] = [
    ...(finite(marketCap) ? [{
      label: marketCapIsDexValuation ? "DEX valuation" : "Market cap",
      value: marketCap,
      detail: marketCapIsDexValuation ? "pool-reported valuation" : "circulating value",
      color: "var(--color-signal)",
    }] : []),
    ...(finite(fdv) ? [{
      label: "Fully diluted",
      value: fdv,
      detail: [
        metricDetail(fdv, marketCap),
        circulatingPct !== null ? `${circulatingPct}% supply circulating` : null,
      ].filter(Boolean).join(" · "),
      color: "var(--color-caution)",
    }] : []),
    ...(finite(volume) ? [{
      label: "24h volume",
      value: volume,
      detail: metricDetail(volume, marketCap),
      color: "var(--color-pass)",
    }] : []),
    ...(finite(liquidity) ? [{
      label: "DEX liquidity",
      value: liquidity,
      detail: metricDetail(liquidity, marketCap),
      color: "var(--color-ink-dim)",
    }] : []),
  ];
  const scaleMax = Math.max(1, ...scaleMetrics.map((metric) => metric.value));
  const outerClass = embedded
    ? "panel-inset overflow-hidden"
    : "panel overflow-hidden";

  return (
    <section className={outerClass} aria-labelledby={headingId}>
      <header className="flex flex-wrap items-start gap-3 border-b border-line/70 px-4 py-4 sm:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-signal-lift ring-1 ring-signal/20">
          <ChartLineUp size={22} weight="duotone" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-signal-lift">Market record</p>
          <h3 id={headingId} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
            ${symbol} market scale and performance
          </h3>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-faint">
            Point-in-time valuation and the captured price path are separated from lifetime ATH performance so the report never substitutes a recent peak for the real high.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {projectToken && (
            <span className="chip tint-pass gap-1">
              <ShieldCheck size={12} weight="fill" aria-hidden="true" /> CANONICAL TOKEN
            </span>
          )}
          <span className="chip tint-pass">{captureDate ? `CAPTURED ${captureDate.toUpperCase()}` : "FROZEN RECORD"}</span>
          {(liveAth || liveMarketCap) && <span className="chip tint-caution">LIVE SUPPLEMENT</span>}
        </div>
      </header>

      <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-panel px-4 py-3.5">
          <dt className="stat-label">{marketCapIsDexValuation ? "DEX valuation" : "Market cap"}</dt>
          <dd className="mono mt-1 text-[22px] font-semibold leading-none text-ink tabular-nums">{money(marketCap)}</dd>
          <dd className="mt-1 text-[10.5px] text-ink-faint">
            {liveMarketCap
              ? "current CoinGecko supplement"
              : finite(marketCap)
                ? "stored with the report"
                : "legacy record; refresh for current value"}
          </dd>
        </div>
        <div className="bg-panel px-4 py-3.5">
          <dt className="stat-label">{performanceLabel}</dt>
          <dd
            className="mono mt-1 text-[22px] font-semibold leading-none tabular-nums"
            style={{
              color: performanceValue == null
                ? "var(--color-ink-faint)"
                : performanceValue <= -60
                  ? "var(--color-avoid)"
                  : performanceValue <= -25
                    ? "var(--color-caution)"
                    : "var(--color-pass)",
            }}
          >
            {performanceValue == null ? "Refresh required" : percent(performanceValue)}
          </dd>
          <dd className="mt-1 text-[10.5px] text-ink-faint">{performanceDetail}</dd>
        </div>
        <div className="bg-panel px-4 py-3.5">
          <dt className="stat-label">Price at capture</dt>
          <dd className="mono mt-1 text-[22px] font-semibold leading-none text-ink tabular-nums">{price(currentPrice)}</dd>
          <dd className="mt-1 text-[10.5px] text-ink-faint">
            {history ? `${history.timeframe} series preserved` : "point-in-time quote"}
          </dd>
        </div>
        <div className="bg-panel px-4 py-3.5">
          <dt className="stat-label">Market rank</dt>
          <dd className="mono mt-1 text-[22px] font-semibold leading-none text-ink tabular-nums">
            {finite(rank)
              ? `#${rank.toLocaleString()}`
              : hasCoinGeckoRankContext && token?.cg?.listed === false
                ? "Not listed"
                : "Not captured"}
          </dd>
          <dd className="mt-1 text-[10.5px] text-ink-faint">
            {hasCoinGeckoRankContext ? "CoinGecko global rank" : "No global registry rank captured"}
          </dd>
        </div>
      </dl>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.35fr)]">
        <figure className="border-b border-line/70 px-4 py-4 sm:px-5 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <figcaption className="eyebrow">Captured market scale</figcaption>
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">point in time</span>
          </div>
          {scaleMetrics.length ? (
            <div className="mt-3 space-y-3">
              {scaleMetrics.map((metric) => (
                <div key={metric.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11.5px] text-ink-dim">{metric.label}</span>
                    <span className="mono text-[11px] text-ink tabular-nums">{money(metric.value)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (metric.value / scaleMax) * 100)}%`,
                        background: metric.color,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-ink-faint">{metric.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
              No valuation fields were stored in this legacy record.
            </p>
          )}
          <p className="mt-4 border-t border-line/60 pt-3 text-[10.5px] leading-relaxed text-ink-faint">
            These bars compare captured values. They are not presented as a historical market-cap series.
          </p>
        </figure>

        <figure className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <figcaption className="eyebrow">Price path</figcaption>
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">
              {history ? `${history.points.length} ${history.timeframe === "day" ? "days" : "hours"} frozen` : showCurrentIntelligence ? "live supplement" : "refresh paused"}
            </span>
          </div>
          <div className="mt-3">
            {history || showCurrentIntelligence ? (
              <TokenSparkline
                address={address}
                chain={chain}
                pairAddress={pairAddress}
                history={history}
              />
            ) : (
              <div className="panel-inset flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xl text-[11.5px] leading-relaxed text-ink-dim">
                  Refresh the current market overlay to recover price history and the lifetime ATH for this legacy snapshot. The supplement remains outside the stored verdict.
                </p>
                {onLoadCurrentIntelligence && (
                  <button
                    type="button"
                    onClick={onLoadCurrentIntelligence}
                    className="btn-chip tint-signal min-h-10 shrink-0 gap-1.5"
                  >
                    <ArrowClockwise size={13} aria-hidden="true" /> Refresh market data
                  </button>
                )}
              </div>
            )}
          </div>
          {history && !hasTrueAth && !showCurrentIntelligence && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
              <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-ink-faint">
                The chart reports loss from the captured window peak. Refresh once to compare it with the token's true lifetime ATH.
              </p>
              {onLoadCurrentIntelligence && (
                <button type="button" onClick={onLoadCurrentIntelligence} className="btn-chip min-h-9 shrink-0 gap-1.5">
                  <ArrowClockwise size={13} aria-hidden="true" /> Refresh true ATH
                </button>
              )}
            </div>
          )}
          {hasMomentum && (
            <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-line bg-line" aria-label="Captured interval momentum">
              {momentum.map((reading) => (
                <div key={reading.label} className="bg-panel-2/40 px-2 py-2 text-center">
                  <div className="stat-label">{reading.label}</div>
                  <div
                    className="mono mt-0.5 text-[11px] tabular-nums"
                    style={{
                      color: !finite(reading.value)
                        ? "var(--color-ink-faint)"
                        : reading.value >= 0
                          ? "var(--color-pass)"
                          : "var(--color-avoid)",
                    }}
                  >
                    {finite(reading.value) ? percent(reading.value) : "No data"}
                  </div>
                </div>
              ))}
            </div>
          )}
          {liveLoading && (
            <p className="mt-2 text-[10.5px] text-ink-faint" role="status">Refreshing the CoinGecko lifetime record...</p>
          )}
          {currentLive?.state === "none" && !hasTrueAth && (
            <p className="mt-2 text-[10.5px] leading-relaxed text-caution" role="status">
              CoinGecko did not return a lifetime ATH for this contract. ARGUS is keeping the captured-window peak label instead of overstating the data.
            </p>
          )}
        </figure>
      </div>
    </section>
  );
}
