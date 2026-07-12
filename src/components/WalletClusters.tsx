import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { recordForensicEntities } from "../graph/store";
import { HolderBubbleMap, type BubbleEdge, type BubbleWallet } from "./HolderBubbleMap";
import { useArkhamLabels } from "../lib/useArkhamLabels";
import { ArkhamName } from "./ArkhamName";
import { ArkhamGraphBridge } from "./ArkhamGraphBridge";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// Wallet identity clustering (/api/cluster). "Top 10 hold 40%" is only alarming
// once you know how many of those ten are the same hand — a team that splits its
// float across fresh wallets looks decentralised and isn't. This proves the
// linkage: wallets tied by a shared funder or a direct transfer are unioned into
// one operator, and the combined supply each group controls is the concentration
// a holder chart hides. Expensive (per-wallet on-chain trace), so click-to-run.
const STAGES = [
  "Pulling the top holders…",
  "Tracing who funded each wallet…",
  "Checking for transfers between them…",
  "Unioning the linked wallets…",
  "Almost there…",
];
const TONE = { bad: "var(--color-avoid)", warn: "var(--color-caution)", good: "var(--color-pass)" };

type ClusterWallet = { address: string; pct: number; insider: boolean; isCreator: boolean };
type Cluster = { wallets: ClusterWallet[]; size: number; combinedPct: number; sharedFunders: string[]; includesCreator: boolean; links: { a: string; b: string; type: string; via?: string }[] };
type ClusterData = {
  available?: boolean;
  note?: string;
  clusters?: Cluster[];
  walletsAnalyzed?: number;
  allWallets?: BubbleWallet[];
  edges?: BubbleEdge[];
};

function LinkIcon({ live }: { live?: boolean }) {
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/40" />}
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12h6" /><path d="M9 12a3 3 0 0 0-3-3H5a3 3 0 0 0 0 6h1a3 3 0 0 0 3-3Z" /><path d="M15 12a3 3 0 0 1 3-3h1a3 3 0 0 1 0 6h-1a3 3 0 0 1-3-3Z" />
      </svg>
    </span>
  );
}

export function WalletClusters({ mint, chain, symbol, panelCostToken, record = true }: { mint: string; chain: string; symbol?: string; panelCostToken?: string; record?: boolean }) {
  const [data, setData] = useState<ClusterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [failure, setFailure] = useState<{ key: string; failure: PanelRequestFailure } | null>(null);
  const requestKey = [mint, chain, panelCostToken ?? ""].join("\u0000");
  const currentFailure = failure?.key === requestKey ? failure.failure : null;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Arkham entity labels + risk for the cluster wallets and their shared funders.
  const { labels: arkham, state: arkhamState } = useArkhamLabels(
    data ? [...(data.clusters ?? []).flatMap((cluster) => [...cluster.wallets.map((wallet) => wallet.address), ...cluster.sharedFunders])] : [],
    panelCostToken,
  );

  // Runs on Solana (RugCheck+Helius) and EVM (GoPlus+Etherscan) via matching
  // endpoints that return the same shape. Needs a token address + a supported chain.
  const SUPPORTED = new Set(["solana", "ethereum", "base", "bsc", "polygon", "arbitrum", "optimism", "avalanche"]);
  if (!mint || !SUPPORTED.has(chain)) return null;

  // Bubblemaps holder-connection map (visual) for the chains it supports.
  const BM: Record<string, string> = { solana: "sol", ethereum: "eth", base: "base", bsc: "bsc", polygon: "poly", arbitrum: "arbi", avalanche: "avax", fantom: "ftm" };
  const bubbleUrl = BM[chain] ? `https://app.bubblemaps.io/${BM[chain]}/token/${mint}` : null;
  const bubbleLink = bubbleUrl ? (
    <a href={bubbleUrl} target="_blank" rel="noreferrer" className="link-ext mono inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px]" title="Open the interactive holder bubble map on Bubblemaps">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="8" r="3.5" /><circle cx="17" cy="15" r="2.5" /><circle cx="16" cy="6" r="1.6" /></svg>
      bubble map
    </a>
  ) : null;

  const run = async () => {
    if (loading || data || currentFailure || !panelCostToken) return;
    setLoading(true);
    setStage(0);
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 6000);
    try {
      const url = chain === "solana"
        ? `/api/cluster?mint=${encodeURIComponent(mint)}&chain=solana`
        : `/api/evm-cluster?address=${encodeURIComponent(mint)}&chain=${encodeURIComponent(chain)}`;
      const d = await fetchPanelJson<ClusterData>(url, { headers: requiredPanelHeaders(panelCostToken) });
      if (d.available === false) {
        setFailure({ key: requestKey, failure: "unavailable" });
        return;
      }
      setData(d);
      // Feed the graph: attach every clustered wallet to the token, keyed the same
      // way the audit graphs key wallets, so a wallet that reappears as a deployer
      // or holder in another audit collapses to one node and bridges the two.
      const clusters: Cluster[] = d?.clusters ?? [];
      const subjectKey = symbol ? `$${symbol}` : `token:${mint}`;
      const ents = clusters.flatMap((c) => c.wallets.map((w) => ({
        key: `wallet:${w.address.slice(0, 8)}`, type: "Identity", subtype: "Wallet",
        edgeType: "CLUSTER_HOLDER", label: shortAddr(w.address),
      })));
      if (record && ents.length) recordForensicEntities(subjectKey, ents);
    } catch (error) {
      setFailure({ key: requestKey, failure: panelRequestFailure(error) });
    } finally {
      if (timer.current) clearInterval(timer.current);
      setLoading(false);
    }
  };

  if (currentFailure) return <PanelRequestNotice failure={currentFailure} label="Wallet clustering" />;

  // ── loading ──
  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-signal/35 bg-signal/[0.06] p-4">
        <div className="flex items-center gap-2.5">
          <LinkIcon live />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-signal-lift">{STAGES[stage]}</div>
            <div className="mono mt-0.5 text-[11px] text-ink-faint">clustering the top holders · reading the chain · up to ~50s</div>
          </div>
        </div>
        <div className="scan-bar mt-2.5" />
      </div>
    );
  }

  // ── CTA ──
  if (!data && panelCostToken) {
    return (
      <div className="panel p-4">
        <button onClick={run} className="group flex w-full items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/[0.08] px-3.5 py-2.5 text-left transition hover:border-signal hover:bg-signal/[0.14]">
          <span className="flex items-center gap-2.5">
            <LinkIcon />
            <span>
              <span className="block text-[13px] font-semibold text-signal-lift">Cluster the holders</span>
              <span className="block text-[11px] text-ink-dim">how many of the top wallets are secretly one hand?</span>
            </span>
          </span>
          <span className="mono shrink-0 rounded-md border border-signal/50 px-2 py-1 text-[11px] text-signal transition group-hover:bg-signal group-hover:text-white">cluster →</span>
        </button>
        {bubbleLink && <div className="mt-2 flex justify-end">{bubbleLink}</div>}
      </div>
    );
  }

  if (!data) return null;

  // ── result ──
  const clusters: Cluster[] = data.clusters ?? [];
  const top = clusters[0];
  const tone = !clusters.length ? "good" : top.combinedPct >= 25 || top.size >= 4 ? "bad" : "warn";
  const color = TONE[tone as keyof typeof TONE];

  return (
    <div className={`panel p-4 ${tone === "good" ? "" : "tint-var"}`} style={tone === "good" ? undefined : ({ "--tint": color } as React.CSSProperties)}>
      <div className="flex items-center gap-2">
        <LinkIcon />
        <span className="eyebrow">Wallet clustering</span>
        {data.walletsAnalyzed != null && <span className="mono text-[11px] text-ink-faint">{data.walletsAnalyzed} wallets analyzed</span>}
        <span className="ml-auto">{bubbleLink}</span>
      </div>

      {data.note && <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: tone === "good" ? "var(--color-ink-dim)" : color }}>{data.note}</p>}

      {(arkhamState === "rescan_required" || arkhamState === "unavailable") && (
        <PanelRequestNotice failure={arkhamState} label="Wallet identity labels" className="mt-3" />
      )}

      {Array.isArray(data.allWallets) && data.allWallets.length >= 2 && (
        <HolderBubbleMap wallets={data.allWallets} edges={data.edges ?? []} chain={chain} />
      )}

      {record && symbol && <ArkhamGraphBridge subject={`$${symbol}`} labels={arkham} />}

      {clusters.length > 0 && (
        <div className="mt-3 space-y-2.5 border-t border-line pt-2.5">
          {clusters.map((c, i) => (
            <div key={i} className="tint-var rounded-md border px-2.5 py-2" style={{ "--tint": color } as React.CSSProperties}>
              <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="mono font-semibold" style={{ color }}>{c.size} wallets = 1 operator</span>
                <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}><span>{c.combinedPct.toFixed(1)}% of supply combined</span></span>
                {c.includesCreator && <span className="chip tint-avoid">incl. creator</span>}
                {c.sharedFunders.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">seeded by <ArkhamName address={c.sharedFunders[0]} chain={chain} labels={arkham} fallback={shortAddr(c.sharedFunders[0])} className="text-[11px]" /></span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.wallets.map((w) => (
                  <span key={w.address} title={`${w.address} · ${w.pct.toFixed(2)}%`} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px]">
                    {w.isCreator ? "★" : ""}<ArkhamName address={w.address} chain={chain} labels={arkham} fallback={shortAddr(w.address)} className="text-[11px] text-ink" /><span className="text-ink-faint">{w.pct.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-ink-faint">Linked by a shared funder or a direct SOL transfer — the two signals that mean one hand controls wallets a holder chart shows as separate.</p>
        </div>
      )}
    </div>
  );
}
