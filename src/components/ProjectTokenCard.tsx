import { ArrowSquareOut, ChartLineUp, ShieldCheck } from "@phosphor-icons/react";
import type { ProjectTokenSnapshot } from "../data/evidence";
import { TokenSparkline } from "./TokenSparkline";

const money = (value?: number) => {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value).toLocaleString()}`;
};

const price = (value?: number) => {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (value < 0.01) return `$${value.toPrecision(3)}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
};

export function ProjectTokenCard({
  token,
  chains,
  showCurrentIntelligence,
  onAudit,
}: {
  token: ProjectTokenSnapshot;
  /**
   * Protocol chain footprint from DeFiLlama TVL data. The caller must only
   * pass this when the DeFiLlama protocol record joins the verified token by
   * CoinGecko id, so a name-alike protocol can never lend its footprint.
   */
  chains?: string[];
  showCurrentIntelligence: boolean;
  onAudit?: (query: string) => void;
}) {
  const verifiedBy = token.verification === "official_x" ? "official X account" : "official project domain";
  const captured = new Date(token.capturedAt);
  const chainList = chains?.length
    ? [token.chain, ...chains]
      .filter(Boolean)
      .filter((chain, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === chain.toLowerCase()) === index)
    : null;
  const chainDisplay = chainList
    ? chainList.length > 3
      ? `${chainList.slice(0, 3).join(", ")} +${chainList.length - 3} more`
      : chainList.join(", ")
    : token.chain;

  return (
    <section id="project-token" className="panel scroll-mt-28 overflow-hidden" aria-label="Verified token and market fundamentals">
      <div className="flex flex-wrap items-start gap-3 border-b border-line/70 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-signal-lift ring-1 ring-signal/20">
          <ChartLineUp size={22} weight="duotone" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Token and market</h2>
            <span className="chip tint-pass gap-1 normal-case tracking-normal">
              <ShieldCheck size={12} weight="fill" aria-hidden="true" /> verified via {verifiedBy}
            </span>
            {token.rank != null && <span className="chip">CoinGecko #{token.rank}</span>}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
            <span className="mono font-medium text-ink">${token.symbol}</span> is the canonical token linked to {token.name}. The identity binding is frozen into this report even when the overall verdict is withheld.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {token.homepage && (
            <a href={token.homepage} target="_blank" rel="noreferrer" className="btn-chip min-h-9 gap-1.5">
              Official site <ArrowSquareOut size={13} aria-hidden="true" />
            </a>
          )}
          <a href={token.sourceUrl} target="_blank" rel="noreferrer" className="btn-chip min-h-9 gap-1.5">
            CoinGecko <ArrowSquareOut size={13} aria-hidden="true" />
          </a>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Price", price(token.priceUsd)],
          ["Market cap", money(token.marketCapUsd)],
          ["Fully diluted", money(token.fdvUsd)],
          ["24h volume", money(token.volume24hUsd)],
          ["DEX liquidity", money(token.liquidityUsd)],
          [chainList ? `Chains (${chainList.length})` : "Chain", chainDisplay],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel px-4 py-3">
            <dt className="stat-label">{label}</dt>
            <dd className="stat-value mt-1 font-semibold capitalize" title={chainList && label.startsWith("Chains") ? `${chainList.join(", ")} · protocol footprint per DeFiLlama TVL` : undefined}>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="eyebrow">Price history</div>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {token.history ? "Frozen with this investigation" : "Current supplemental market overlay"}
            </p>
          </div>
          <span className="mono text-[10px] text-ink-faint">
            {Number.isFinite(captured.getTime()) ? `captured ${captured.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "capture time unavailable"}
          </span>
        </div>
        {token.history ? (
          <TokenSparkline address={token.address} chain={token.chain} pairAddress={token.pairAddress} history={token.history} />
        ) : showCurrentIntelligence ? (
          <TokenSparkline address={token.address} chain={token.chain} pairAddress={token.pairAddress} />
        ) : (
          <p className="text-[12.5px] text-ink-faint">No price history was frozen in this snapshot. Load current intelligence to request the live market overlay.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line/70 bg-panel-2/30 px-5 py-3">
        <span className="mono break-all text-[11px] text-ink-faint">{token.address}</span>
        {onAudit && (
          <button type="button" onClick={() => onAudit(token.address)} className="btn-chip tint-signal ml-auto min-h-10 gap-1.5 font-medium">
            Open full on-chain investigation <ArrowSquareOut size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
