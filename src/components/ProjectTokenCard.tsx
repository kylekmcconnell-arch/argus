import { ArrowSquareOut, ChartLineUp, ShieldCheck } from "@phosphor-icons/react";
import type { ProjectTokenSnapshot } from "../data/evidence";
import type { ThreatScan } from "../threat/types";
import { MarketPerformancePanel } from "./MarketPerformancePanel";
import { ProjectMarketIntelligence } from "./ThreatScanPage";

export function ProjectTokenCard({
  token,
  chains,
  showCurrentIntelligence,
  refreshCurrentMarket,
  onOpenReport,
  onLoadCurrentIntelligence,
  threat,
  threatNote,
}: {
  token: ProjectTokenSnapshot;
  /**
   * Protocol chain footprint from DeFiLlama TVL data. The caller must only
   * pass this when the DeFiLlama protocol record joins the verified token by
   * CoinGecko id, so a name-alike protocol can never lend its footprint.
   */
  chains?: string[];
  showCurrentIntelligence: boolean;
  refreshCurrentMarket?: boolean;
  /** Opens the token dossier already collected with the parent report. Never starts a scan. */
  onOpenReport?: () => void;
  onLoadCurrentIntelligence?: () => void;
  /** Deep token evidence saved within the same project investigation. */
  threat?: ThreatScan;
  /** Why the deep token leg was unavailable in this saved investigation. */
  threatNote?: string;
}) {
  const verifiedBy = token.verification === "official_x" ? "official X account" : "official project domain";
  const marketSource = token.providers?.includes("coingecko") || token.coingeckoId
    ? "CoinGecko"
    : "DexScreener";
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
            <span className="mono font-medium text-ink">${token.symbol}</span> is the official token linked to {token.name}. ARGUS matched it through the project’s {verifiedBy} and official {token.chain} contract, not just the name or ticker.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {token.homepage && (
            <a href={token.homepage} target="_blank" rel="noreferrer" className="btn-chip min-h-9 gap-1.5">
              Official site <ArrowSquareOut size={13} aria-hidden="true" />
            </a>
          )}
          <a href={token.sourceUrl} target="_blank" rel="noreferrer" className="btn-chip min-h-9 gap-1.5">
            {marketSource} <ArrowSquareOut size={13} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="px-3 py-3 sm:px-4 sm:py-4">
        {threat && (
          <div className="mb-3 px-1">
            <div className="eyebrow">01 · Market overview</div>
            <h3 className="mt-1 text-[22px] font-semibold tracking-tight text-ink">Price, size, liquidity, and market position.</h3>
            <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">The saved market snapshot and price history captured with this report.</p>
          </div>
        )}
        <MarketPerformancePanel
          projectToken={token}
          showCurrentIntelligence={showCurrentIntelligence}
          refreshCurrentMarket={refreshCurrentMarket}
          onLoadCurrentIntelligence={onLoadCurrentIntelligence}
          embedded
        />
      </div>

      {threat && <ProjectMarketIntelligence scan={threat} />}
      {!threat && threatNote && (
        <div className="border-t border-line/70 px-5 py-4">
          <div className="eyebrow text-caution">Deep token analysis unavailable</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{threatNote}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line/70 bg-panel-2/30 px-5 py-3">
        <span className="chip normal-case tracking-normal">{chainDisplay}</span>
        <span className="mono break-all text-[11px] text-ink-faint">{token.address}</span>
        {onOpenReport && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className="mono text-[10px] text-ink-faint">Included in this scan · no credits</span>
            <button
              type="button"
              onClick={onOpenReport}
              title="Open the token analysis already collected with this report. No new scan or credits."
              className="btn-chip tint-signal min-h-10 gap-1.5 font-medium"
            >
              Open included token report <ArrowSquareOut size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
