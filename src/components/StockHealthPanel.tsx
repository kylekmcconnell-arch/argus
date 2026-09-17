import { useId } from "react";
import type { StockHealthSnapshot } from "../data/evidence";

// Listed-security health: the stock leg of the assessment doctrine. When the
// subject's applicable market instrument is a stock (a registry-verified
// public listing), the report shows how the stock itself is trading — penny
// stocks through mega-caps — as frozen, score-neutral context. Everything here
// renders from the saved snapshot; nothing is refetched on open.

const signed = (value: number | null): string =>
  value === null ? "no reading" : `${value > 0 ? "+" : ""}${value}%`;

const trendTone = (value: number | null): string =>
  value === null ? "tint-neutral" : value >= 0 ? "tint-pass" : "tint-caution";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[8rem]">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-dim">{label}</div>
      <div className={`mono mt-0.5 text-[13px] ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

export function StockHealthPanel({
  snapshot,
  id = "stock-health",
}: {
  snapshot: StockHealthSnapshot;
  id?: string;
}) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `${generatedId}-title`;
  const priceLine = `${snapshot.price} ${snapshot.currency ?? ""}`.trim();
  const rangeLine = snapshot.fiftyTwoWeekLow !== null && snapshot.fiftyTwoWeekHigh !== null
    ? `${snapshot.fiftyTwoWeekLow} to ${snapshot.fiftyTwoWeekHigh}`
    : "not on record";

  return (
    <section id={id} className="report-section mt-6 scroll-mt-28" aria-labelledby={titleId} data-testid="stock-health">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Listed-security health</p>
          <h2 id={titleId} className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
            How the stock itself is trading
          </h2>
          <p className="story-chapter-description mt-2 max-w-3xl leading-relaxed text-ink-dim">
            {snapshot.issuer} has a verified public listing ({snapshot.ticker}
            {snapshot.exchange ? ` on ${snapshot.exchange}` : ""}), so ARGUS reads the stock&apos;s own health instead of
            token metrics. Saved snapshot only; this panel is context and does not move the score.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          {snapshot.pennyStock && <span className="chip tint-caution">Penny-stock range</span>}
          <span className="chip tint-neutral">Point in time</span>
          <span className="chip tint-pass">Score-neutral</span>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="flex flex-wrap gap-x-8 gap-y-4 border-b border-line/70 px-4 py-4 sm:px-5">
          <Stat label="Last price" value={priceLine} />
          <Stat label="52-week range" value={rangeLine} />
          <Stat
            label="Range position"
            value={snapshot.fiftyTwoWeekPositionPct !== null ? `${snapshot.fiftyTwoWeekPositionPct}% of range` : "no reading"}
          />
          <Stat label="30 days" value={signed(snapshot.change30dPct)} tone={trendTone(snapshot.change30dPct)} />
          <Stat label="90 days" value={signed(snapshot.change90dPct)} tone={trendTone(snapshot.change90dPct)} />
          <Stat label="One year" value={signed(snapshot.change1yPct)} tone={trendTone(snapshot.change1yPct)} />
          <Stat
            label="Deepest drawdown (1y)"
            value={snapshot.maxDrawdown1yPct !== null ? `${snapshot.maxDrawdown1yPct}%` : "no reading"}
            tone={snapshot.maxDrawdown1yPct !== null && snapshot.maxDrawdown1yPct <= -50 ? "tint-caution" : undefined}
          />
          <Stat
            label="Volatility (annualized)"
            value={snapshot.annualizedVolatilityPct !== null ? `${snapshot.annualizedVolatilityPct}%` : "no reading"}
          />
        </div>
        <div className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-dim sm:px-5">
          {snapshot.pennyStock
            ? "This security trades in penny-stock range (under $5). Thin, low-priced listings move violently and are a common pairing target for tokenized-stock venues; treat the price action accordingly. "
            : ""}
          Identity: the ticker comes from the verified SEC-registry listing
          {snapshot.binding.feedLongName ? `, and the market feed's own record (${snapshot.binding.feedLongName}) agrees` : ""}.
          Captured {snapshot.capturedAt.slice(0, 10)}. This is a market observation, not investment advice.
        </div>
      </div>
    </section>
  );
}
