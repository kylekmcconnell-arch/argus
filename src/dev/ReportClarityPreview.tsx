// Development-only visual regression harness for public report copy and the
// narrow content column beside the sticky report guide.
import { BasicFactsPanel } from "../components/BasicFactsPanel";
import { MarketPerformancePanel } from "../components/MarketPerformancePanel";
import type { ProjectTokenSnapshot } from "../data/evidence";

const token: ProjectTokenSnapshot = {
  verified: true,
  verification: "official_x",
  name: "EARN",
  symbol: "EARN",
  rank: null,
  address: "0xa3b6aee90017b72c0812dc1e013de70eb2917ba3",
  chain: "robinhood",
  sourceUrl: "https://dexscreener.com/robinhood/earn",
  capturedAt: "2026-08-24T14:07:00.000Z",
  priceUsd: 0.0000153,
  marketCapUsd: 1_530_000,
  fdvUsd: 1_530_000,
  volume24hUsd: 600_800,
  liquidityUsd: 211_600,
  pairAddress: "earn-pool",
  history: {
    points: [1.2, 1.1, 1.15, 1.3, 1.25, 1.4],
    first: 1.2,
    last: 1.4,
    peak: 1.4,
    changePct: 16.7,
    drawdownPct: 0,
    timeframe: "day",
    poolAddress: "earn-pool",
  },
};

export function ReportClarityPreview() {
  return (
    <main className="min-h-screen bg-void px-6 py-8 text-ink">
      <div className="mx-auto grid max-w-[1180px] gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-6">
          <MarketPerformancePanel projectToken={token} showCurrentIntelligence={false} />
          <BasicFactsPanel
            facts={[
              {
                factId: "earn-account",
                predicate: "official_identity",
                value: "EARN · @earnonhood",
                status: "verified",
                floorEligible: false,
                critical: true,
                question: "What exact project or company does this account represent?",
                sources: [{ url: "https://x.com/earnonhood", relation: "supports", title: "Official X profile" }],
              },
              {
                factId: "earn-creator",
                predicate: "founder",
                value: "Tharmas · creator",
                status: "verified",
                floorEligible: false,
                critical: true,
                question: "Who created the project?",
                sources: [{ url: "https://x.com/0xTharmas", relation: "supports", title: "Creator profile" }],
              },
              {
                factId: "earn-product",
                predicate: "product",
                value: "Live vaults and an Omnipool on Robinhood Chain",
                status: "verified",
                floorEligible: false,
                critical: true,
                question: "What working product does the project describe?",
                sources: [{ url: "https://earnonhood.com", relation: "supports", title: "Official product site" }],
              },
              {
                factId: "earn-token",
                predicate: "official_token",
                value: "$EARN",
                status: "verified",
                floorEligible: false,
                critical: true,
                question: "What is the project's official token?",
                sources: [{ url: token.sourceUrl, relation: "supports", title: "DexScreener token record" }],
              },
            ]}
          />
        </div>
        <aside className="panel-card h-fit p-4 lg:sticky lg:top-6">
          <p className="eyebrow">Report guide</p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
            This rail deliberately constrains the report column to reproduce the production layout.
          </p>
        </aside>
      </div>
    </main>
  );
}
