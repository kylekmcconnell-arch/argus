import { useId } from "react";
import type { TokenizedStockPairingSnapshot } from "../data/evidence";

// Tokenized-stock pairing: the token under audit carries stock exposure — it
// either IS a tokenized stock or its pool quotes in one — so the report shows
// how the underlying listed stock is trading. Frozen, score-neutral context;
// nothing is refetched on open.

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

export function TokenizedStockPairingPanel({
  snapshot,
  id = "tokenized-stock-pairing",
}: {
  snapshot: TokenizedStockPairingSnapshot;
  id?: string;
}) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `${generatedId}-title`;
  const underlying = snapshot.underlying;
  const exposureLine = snapshot.exposure === "token_is_tokenized_stock"
    ? `${snapshot.tokenizedSymbol} is a tokenized stock, so its floor is set by the listed equity underneath it`
    : `the price-corroborated pool quotes in ${snapshot.tokenizedSymbol}, a tokenized stock, so the pool's denomination moves with the listed equity underneath it`;

  return (
    <section id={id} className="report-section mt-6 scroll-mt-28" aria-labelledby={titleId} data-testid="tokenized-stock-pairing">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Tokenized-stock pairing</p>
          <h2 id={titleId} className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
            The stock behind the token
          </h2>
          <p className="story-chapter-description mt-2 max-w-3xl leading-relaxed text-ink-dim">
            In this market, {exposureLine}. ARGUS reads the underlying stock&apos;s own health
            ({underlying.ticker}
            {underlying.feedLongName ? `, ${underlying.feedLongName}` : ""}
            {underlying.exchange ? `, ${underlying.exchange}` : ""}). Saved snapshot only; context, not a score input.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          {underlying.pennyStock && <span className="chip tint-caution">Penny-stock underlying</span>}
          <span className="chip tint-neutral">Point in time</span>
          <span className="chip tint-pass">Score-neutral</span>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="flex flex-wrap gap-x-8 gap-y-4 border-b border-line/70 px-4 py-4 sm:px-5">
          <Stat label="Underlying price" value={`${underlying.price} ${underlying.currency ?? ""}`.trim()} />
          <Stat
            label="Range position"
            value={underlying.fiftyTwoWeekPositionPct !== null ? `${underlying.fiftyTwoWeekPositionPct}% of 52-week range` : "no reading"}
          />
          <Stat label="30 days" value={signed(underlying.change30dPct)} tone={trendTone(underlying.change30dPct)} />
          <Stat label="90 days" value={signed(underlying.change90dPct)} tone={trendTone(underlying.change90dPct)} />
          <Stat label="One year" value={signed(underlying.change1yPct)} tone={trendTone(underlying.change1yPct)} />
          <Stat
            label="Deepest drawdown (1y)"
            value={underlying.maxDrawdown1yPct !== null ? `${underlying.maxDrawdown1yPct}%` : "no reading"}
            tone={underlying.maxDrawdown1yPct !== null && underlying.maxDrawdown1yPct <= -50 ? "tint-caution" : undefined}
          />
          <Stat
            label="Volatility (annualized)"
            value={underlying.annualizedVolatilityPct !== null ? `${underlying.annualizedVolatilityPct}%` : "no reading"}
          />
        </div>
        <div className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-dim sm:px-5">
          {underlying.pennyStock
            ? "The underlying trades in penny-stock range (under $5): thin listings move violently, and pairing a token to one imports that behavior. "
            : ""}
          {snapshot.basis.join(" ")} Captured {snapshot.capturedAt.slice(0, 10)}. This is a market observation, not investment advice.
        </div>
      </div>
    </section>
  );
}
