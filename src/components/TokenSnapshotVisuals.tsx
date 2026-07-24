import type { TokenDossier } from "../token/audit";

const SEGMENT_OPACITY = [1, 0.74, 0.52, 0.36, 0.24, 0.16];

function finitePercent(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
}

function PriceMomentum({ priceChange }: { priceChange: NonNullable<TokenDossier["priceChange"]> }) {
  const readings = [
    { label: "5m", value: priceChange.m5 },
    { label: "1h", value: priceChange.h1 },
    { label: "6h", value: priceChange.h6 },
    { label: "24h", value: priceChange.h24 },
  ];
  const available = readings.filter((reading): reading is { label: string; value: number } =>
    typeof reading.value === "number" && Number.isFinite(reading.value));
  if (!available.length) return null;
  const extent = Math.max(1, ...available.map((reading) => Math.abs(reading.value)));

  return (
    <figure className="panel-inset px-3.5 py-3" aria-labelledby="snapshot-price-momentum">
      <figcaption id="snapshot-price-momentum" className="eyebrow">Price momentum at capture</figcaption>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {readings.map((reading) => {
          const value = typeof reading.value === "number" && Number.isFinite(reading.value)
            ? reading.value
            : null;
          const width = value == null ? 0 : (Math.abs(value) / extent) * 48;
          return (
            <div key={reading.label} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="stat-label">{reading.label}</span>
                <span
                  className="mono text-[11.5px] tabular-nums"
                  style={{ color: value == null ? "var(--color-ink-faint)" : value >= 0 ? "var(--color-pass)" : "var(--color-avoid)" }}
                >
                  {value == null ? "N/A" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}
                </span>
              </div>
              <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px bg-ink-faint/40" />
                {value != null && (
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: value >= 0 ? "50%" : `${50 - width}%`,
                      width: `${width}%`,
                      background: value >= 0 ? "var(--color-pass)" : "var(--color-avoid)",
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-faint">
        DexScreener interval changes saved with this scan.
      </p>
    </figure>
  );
}

function HolderDistribution({ token }: { token: TokenDossier }) {
  const holders = token.topHolders
    .filter((holder) => holder.address && Number.isFinite(holder.percent) && holder.percent > 0)
    .sort((left, right) => right.percent - left.percent);
  if (!holders.length) return null;
  const trackedPct = holders.reduce((sum, holder) => sum + holder.percent, 0);
  const reliable = trackedPct <= 101;
  const visible = holders.slice(0, 5);
  const otherTrackedPct = holders.slice(5).reduce((sum, holder) => sum + holder.percent, 0);
  const segments = reliable ? [
    ...visible.map((holder) => ({
      label: holder.tag || shortAddress(holder.address),
      pct: holder.percent,
    })),
    ...(otherTrackedPct > 0 ? [{ label: `${holders.length - visible.length} more tracked`, pct: otherTrackedPct }] : []),
    ...(trackedPct < 100 ? [{ label: "remaining supply", pct: 100 - trackedPct }] : []),
  ] : [];

  return (
    <figure className="panel-inset px-3.5 py-3" aria-labelledby="snapshot-holder-distribution">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption id="snapshot-holder-distribution" className="eyebrow">Holder distribution</figcaption>
        <span className="mono text-[10.5px] text-ink-faint">
          {token.safety.holderCount ? `${token.safety.holderCount.toLocaleString()} holders` : `${holders.length} tracked wallets`}
        </span>
      </div>
      {reliable ? (
        <>
          <div
            className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-line/60"
            role="img"
            aria-label={`Supply distribution at capture: ${segments.map((segment) => `${segment.label} ${segment.pct.toFixed(1)}%`).join(", ")}`}
          >
            {segments.map((segment, index) => (
              <span
                key={segment.label}
                className="h-full bg-signal-lift"
                style={{ width: `${segment.pct}%`, opacity: SEGMENT_OPACITY[index] ?? 0.14 }}
              />
            ))}
          </div>
          <div className="mt-2.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {segments.slice(0, 6).map((segment, index) => (
              <span key={segment.label} className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-dim">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm bg-signal-lift"
                  style={{ opacity: SEGMENT_OPACITY[index] ?? 0.14 }}
                  aria-hidden="true"
                />
                <span className="truncate">{segment.label}</span>
                <span className="mono ml-auto shrink-0 text-ink-faint tabular-nums">{segment.pct.toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-caution">
          The provider returned an internally inconsistent holder total, so ARGUS preserved the rows but suppressed a misleading chart.
        </p>
      )}
    </figure>
  );
}

function LiquidityControl({ safety }: { safety: TokenDossier["safety"] }) {
  const burned = finitePercent(safety.lpBurnedPct);
  const locked = finitePercent(safety.lpLockedPct);
  const unlocked = finitePercent(safety.lpTopUnlockedEoaPct);
  const observed = Math.min(100, burned + locked + unlocked);
  if (observed <= 0) return null;
  const segments = [
    { label: "burned", pct: burned, color: "var(--color-pass)" },
    { label: "locked", pct: locked, color: "var(--color-signal)" },
    { label: "largest unlocked wallet", pct: unlocked, color: "var(--color-caution)" },
    { label: "other or unclassified", pct: Math.max(0, 100 - observed), color: "var(--color-line-2)" },
  ].filter((segment) => segment.pct > 0);

  return (
    <figure className="panel-inset px-3.5 py-3" aria-labelledby="snapshot-liquidity-control">
      <figcaption id="snapshot-liquidity-control" className="eyebrow">Liquidity control</figcaption>
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-line/60"
        role="img"
        aria-label={`Liquidity position at capture: ${segments.map((segment) => `${segment.label} ${segment.pct.toFixed(1)}%`).join(", ")}`}
      >
        {segments.map((segment) => (
          <span key={segment.label} className="h-full" style={{ width: `${segment.pct}%`, background: segment.color }} />
        ))}
      </div>
      <div className="mt-2.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: segment.color }} aria-hidden="true" />
            {segment.label}
            <span className="mono ml-auto text-ink-faint tabular-nums">{segment.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function ForensicAxes({ token }: { token: TokenDossier }) {
  if (!token.axes.length) return null;
  return (
    <figure className="panel-inset px-3.5 py-3" aria-labelledby="snapshot-forensic-axes">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption id="snapshot-forensic-axes" className="eyebrow">Forensic score profile</figcaption>
        <span className="mono text-[10.5px] text-ink-faint">{token.score ?? "N/A"}/100 stored result</span>
      </div>
      <div className="mt-2.5 grid gap-x-6 gap-y-2 lg:grid-cols-2">
        {token.axes.map((axis) => {
          const ratio = axis.weight > 0 ? Math.max(0, Math.min(1, axis.score / axis.weight)) : 0;
          const color = ratio < 0.45
            ? "var(--color-caution)"
            : ratio >= 0.75
              ? "var(--color-pass)"
              : "var(--color-signal)";
          return (
            <div key={axis.key} className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[11.5px] text-ink-dim">{axis.label}</span>
                <span className="mono shrink-0 text-[10.5px] text-ink-faint tabular-nums">{axis.score}/{axis.weight}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/60">
                <span className="block h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function TokenSnapshotVisuals({
  token,
  showPriceMomentum = true,
}: {
  token: TokenDossier;
  showPriceMomentum?: boolean;
}) {
  const hasPriceMomentum = token.priceChange && Object.values(token.priceChange)
    .some((value) => typeof value === "number" && Number.isFinite(value));
  return (
    <section className="panel px-4 py-4 sm:px-5" aria-labelledby="token-snapshot-visuals-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-signal-lift">Frozen token record</p>
          <h3 id="token-snapshot-visuals-title" className="mt-1 text-[16px] font-semibold tracking-tight text-ink">
            Market and ownership structure
          </h3>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-faint">
            Every chart in this panel is reconstructed from values saved inside this report.
          </p>
        </div>
        <span className="chip tint-pass">CAPTURED WITH SCAN</span>
      </header>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {showPriceMomentum && hasPriceMomentum && token.priceChange && <PriceMomentum priceChange={token.priceChange} />}
        <HolderDistribution token={token} />
        <LiquidityControl safety={token.safety} />
        <ForensicAxes token={token} />
      </div>
    </section>
  );
}
