import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { recordForensicEntities } from "../graph/store";

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

export function WalletClusters({ mint, chain, symbol }: { mint: string; chain: string; symbol?: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Runs on Solana (RugCheck+Helius) and EVM (GoPlus+Etherscan) via matching
  // endpoints that return the same shape. Needs a token address + a supported chain.
  const SUPPORTED = new Set(["solana", "ethereum", "base", "bsc", "polygon", "arbitrum", "optimism", "avalanche"]);
  if (!mint || !SUPPORTED.has(chain)) return null;

  // Bubblemaps holder-connection map (visual) for the chains it supports.
  const BM: Record<string, string> = { solana: "sol", ethereum: "eth", base: "base", bsc: "bsc", polygon: "poly", arbitrum: "arbi", avalanche: "avax", fantom: "ftm" };
  const bubbleUrl = BM[chain] ? `https://app.bubblemaps.io/${BM[chain]}/token/${mint}` : null;
  const bubbleLink = bubbleUrl ? (
    <a href={bubbleUrl} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-ink-dim transition hover:border-signal hover:text-signal" title="Open the interactive holder bubble map on Bubblemaps">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="8" r="3.5" /><circle cx="17" cy="15" r="2.5" /><circle cx="16" cy="6" r="1.6" /></svg>
      bubble map ↗
    </a>
  ) : null;

  const run = async () => {
    if (loading || data) return;
    setLoading(true);
    setStage(0);
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 6000);
    try {
      const url = chain === "solana"
        ? `/api/cluster?mint=${encodeURIComponent(mint)}&chain=solana`
        : `/api/evm-cluster?address=${encodeURIComponent(mint)}&chain=${encodeURIComponent(chain)}`;
      const r = await fetch(url);
      const d = await r.json();
      setData(d?.available === false ? { note: d.note ?? "Clustering unavailable (provider not configured)." } : d);
      // Feed the graph: attach every clustered wallet to the token, keyed the same
      // way the audit graphs key wallets, so a wallet that reappears as a deployer
      // or holder in another audit collapses to one node and bridges the two.
      const clusters: Cluster[] = d?.clusters ?? [];
      const subjectKey = symbol ? `$${symbol}` : `token:${mint}`;
      const ents = clusters.flatMap((c) => c.wallets.map((w) => ({
        key: `wallet:${w.address.slice(0, 8)}`, type: "Identity", subtype: "Wallet",
        edgeType: "CLUSTER_HOLDER", label: shortAddr(w.address),
      })));
      if (ents.length) recordForensicEntities(subjectKey, ents);
    } catch {
      setData({ note: "Clustering failed." });
    } finally {
      if (timer.current) clearInterval(timer.current);
      setLoading(false);
    }
  };

  // ── loading ──
  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-signal/35 bg-signal/[0.06] p-4">
        <style>{`
          @keyframes wc-scan { 0%{transform:translateX(-120%)} 100%{transform:translateX(360%)} }
          .wc-scan-bar{ animation: wc-scan 1.3s cubic-bezier(.4,0,.2,1) infinite }
          @media (prefers-reduced-motion: reduce){ .wc-scan-bar{ animation:none } }
        `}</style>
        <div className="flex items-center gap-2.5">
          <LinkIcon live />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-signal-lift">{STAGES[stage]}</div>
            <div className="mono mt-0.5 text-[10px] text-ink-faint">clustering the top holders · reading the chain · up to ~50s</div>
          </div>
        </div>
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-line/60">
          <div className="wc-scan-bar h-full w-1/3 rounded-full" style={{ background: "linear-gradient(90deg, transparent, var(--color-signal), transparent)" }} />
        </div>
      </div>
    );
  }

  // ── CTA ──
  if (!data) {
    return (
      <div className="rounded-xl border border-line bg-panel p-4">
        <button onClick={run} className="group flex w-full items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/[0.08] px-3.5 py-2.5 text-left transition hover:border-signal hover:bg-signal/[0.14]">
          <span className="flex items-center gap-2.5">
            <LinkIcon />
            <span>
              <span className="block text-[13px] font-semibold text-signal-lift">Cluster the holders</span>
              <span className="block text-[10.5px] text-ink-dim">how many of the top wallets are secretly one hand?</span>
            </span>
          </span>
          <span className="mono shrink-0 rounded-md border border-signal/50 px-2 py-1 text-[11px] text-signal transition group-hover:bg-signal group-hover:text-white">cluster →</span>
        </button>
        {bubbleLink && <div className="mt-2 flex justify-end">{bubbleLink}</div>}
      </div>
    );
  }

  // ── result ──
  const clusters: Cluster[] = data.clusters ?? [];
  const top = clusters[0];
  const tone = !clusters.length ? "good" : top.combinedPct >= 25 || top.size >= 4 ? "bad" : "warn";
  const color = TONE[tone as keyof typeof TONE];

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: tone === "good" ? "var(--color-line)" : `${color}55`, background: tone === "good" ? "var(--color-panel)" : `${color}0d` }}>
      <div className="flex items-center gap-2">
        <LinkIcon />
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Wallet clustering</span>
        {data.walletsAnalyzed != null && <span className="mono text-[10px] text-ink-faint">{data.walletsAnalyzed} wallets analyzed</span>}
        <span className="ml-auto">{bubbleLink}</span>
      </div>

      {data.note && <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: tone === "good" ? "var(--color-ink-dim)" : color }}>{data.note}</p>}

      {clusters.length > 0 && (
        <div className="mt-3 space-y-2.5 border-t border-line pt-2.5">
          {clusters.map((c, i) => (
            <div key={i} className="rounded-lg border px-2.5 py-2" style={{ borderColor: `${color}44`, background: `${color}0a` }}>
              <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="mono font-semibold" style={{ color }}>{c.size} wallets = 1 operator</span>
                <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${color}1a`, color }}>{c.combinedPct.toFixed(1)}% of supply combined</span>
                {c.includesCreator && <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "var(--color-avoid)1a", color: "var(--color-avoid)" }}>incl. creator</span>}
                {c.sharedFunders.length > 0 && (
                  <span className="text-[10px] text-ink-faint">seeded by <a href={`https://solscan.io/account/${c.sharedFunders[0]}`} target="_blank" rel="noreferrer" className="mono text-signal hover:underline">{shortAddr(c.sharedFunders[0])}</a></span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.wallets.map((w) => (
                  <a key={w.address} href={`https://solscan.io/account/${w.address}`} target="_blank" rel="noreferrer" title={`${w.address} · ${w.pct.toFixed(2)}%`} className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink transition hover:border-signal hover:text-signal">
                    {w.isCreator ? "★ " : ""}{shortAddr(w.address)} <span className="text-ink-faint">{w.pct.toFixed(1)}%</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-ink-faint">Linked by a shared funder or a direct SOL transfer — the two signals that mean one hand controls wallets a holder chart shows as separate.</p>
        </div>
      )}
    </div>
  );
}
