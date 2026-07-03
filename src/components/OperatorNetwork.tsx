import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { traceOperator, type OperatorCluster } from "../lib/operatorTrace";

// The recursive collector's face. Where FunderSweep does a single forward hop off
// one wallet, this traces the whole operator: up from the deployer to the topmost
// anonymous hub, forward from that hub to the sibling launches, recursing when a
// hub is itself funded by another anon wallet. Expensive (2-5 chained on-chain
// calls), so it runs on click with a live, streaming scan state. Every token and
// wallet it finds is one click from its own full audit.
type Step = { label: string; detail?: string; tone?: "neutral" | "good" | "warn" | "bad" };
const TONE: Record<string, string> = { good: "var(--color-pass)", warn: "var(--color-caution)", bad: "var(--color-avoid)", neutral: "var(--color-ink-faint)" };

function NetIcon({ live }: { live?: boolean }) {
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/40" />}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2.4" />
        <path d="M7 6.6 10.4 16M17 6.6 13.6 16M6.6 7.4l10.8 0" />
      </svg>
    </span>
  );
}

export function OperatorNetwork({ deployer, chain, label, onAudit }: { deployer?: string | null; chain?: string; label?: string; onAudit?: (q: string) => void }) {
  const [cluster, setCluster] = useState<OperatorCluster | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const running = useRef(false);

  useEffect(() => () => { running.current = false; }, []);

  // Serial-operator tracing runs on Solana (Helius) and EVM (Etherscan) alike, and
  // needs a deployer wallet to root the trace. Gate to chains we have endpoints for.
  const SUPPORTED = new Set(["solana", "ethereum", "base", "bsc", "polygon", "arbitrum", "optimism", "avalanche"]);
  if (!deployer || (chain && !SUPPORTED.has(chain))) return null;

  const run = async () => {
    if (running.current || loading || done) return;
    running.current = true;
    setLoading(true);
    setSteps([]);
    const c = await traceOperator(deployer, {
      rootLabel: label,
      checkLiveness: true,
      chain,
    }, (s) => setSteps((prev) => [...prev, s]));
    if (!running.current) return; // unmounted mid-run
    setCluster(c);
    setLoading(false);
    setDone(true);
  };

  // ── CTA (not run yet) ──
  if (!cluster && !loading) {
    return (
      <div className="rounded-xl border border-line bg-panel p-4">
        <button
          onClick={run}
          className="group flex w-full items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/[0.08] px-3.5 py-2.5 text-left transition hover:border-signal hover:bg-signal/[0.14]"
        >
          <span className="flex items-center gap-2.5">
            <NetIcon />
            <span>
              <span className="block text-[13px] font-semibold text-signal-lift">Trace the operator</span>
              <span className="block text-[10.5px] text-ink-dim">follow the money past the deployer to every launch behind the same hand</span>
            </span>
          </span>
          <span className="mono shrink-0 rounded-md border border-signal/50 px-2 py-1 text-[11px] text-signal transition group-hover:bg-signal group-hover:text-white">trace →</span>
        </button>
      </div>
    );
  }

  // ── live scanning state ──
  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-signal/35 bg-signal/[0.06] p-4">
        <style>{`
          @keyframes op-scan { 0%{transform:translateX(-120%)} 100%{transform:translateX(360%)} }
          .op-scan-bar{ animation: op-scan 1.3s cubic-bezier(.4,0,.2,1) infinite }
          @media (prefers-reduced-motion: reduce){ .op-scan-bar{ animation:none } }
        `}</style>
        <div className="flex items-center gap-2.5">
          <NetIcon live />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-signal-lift">Tracing the operator network</div>
            <div className="mono mt-0.5 text-[10px] text-ink-faint">chaining the funding graph · reading the chain · up to ~90s</div>
          </div>
        </div>
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-line/60">
          <div className="op-scan-bar h-full w-1/3 rounded-full" style={{ background: "linear-gradient(90deg, transparent, var(--color-signal), transparent)" }} />
        </div>
        {steps.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-signal/20 pt-2.5">
            {steps.slice(-5).map((s, i) => (
              <div key={i} className="flex gap-2 text-[11px]">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ background: TONE[s.tone ?? "neutral"] }} />
                <span className="min-w-0"><span className="text-ink-dim">{s.label}</span>{s.detail && <span className="text-ink-faint"> — {s.detail}</span>}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!cluster) return null;

  // ── result ──
  const { verdict, stats, origin, hub, tokens } = cluster;
  const tone = TONE[verdict.tone];
  // Chain-aware explorer for wallet links (Solana vs the EVM chain in question).
  const EXPLORER: Record<string, string> = { ethereum: "etherscan.io", base: "basescan.org", bsc: "bscscan.com", polygon: "polygonscan.com", arbitrum: "arbiscan.io", optimism: "optimistic.etherscan.io", avalanche: "snowtrace.io" };
  const acct = (addr: string) => (chain && chain !== "solana" ? `https://${EXPLORER[chain] ?? "etherscan.io"}/address/${addr}` : `https://solscan.io/account/${addr}`);
  // Group discovered tokens under the wallet that launched them, so the cluster
  // reads as "this hand -> these deployers -> these dead tokens".
  const byDeployer = new Map<string, typeof tokens>();
  for (const t of tokens) { const a = byDeployer.get(t.deployer) ?? []; a.push(t); byDeployer.set(t.deployer, a); }
  const deployers = cluster.wallets
    .filter((w) => w.role === "deployer")
    .sort((a, b) => (b.tokensCreated ?? 0) - (a.tokensCreated ?? 0));
  const noCluster = stats.deployers <= 1 && stats.tokens === 0;

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: verdict.tone === "good" ? "var(--color-line)" : `${tone}55`, background: verdict.tone === "good" ? "var(--color-panel)" : `${tone}0d` }}>
      <div className="flex items-center gap-2">
        <NetIcon />
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Operator trace</span>
        <span className="mono ml-auto rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${tone}1a`, color: tone }}>
          {stats.deployers} deployer{stats.deployers === 1 ? "" : "s"} · {stats.tokens} token{stats.tokens === 1 ? "" : "s"}{stats.deadTokens ? ` · ${stats.deadTokens} dead` : ""}
        </span>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: verdict.tone === "good" ? "var(--color-ink-dim)" : tone }}>{verdict.line}</p>

      {/* Funding spine: where the root deployer's money ultimately came from. */}
      <div className="mono mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-dim">
        <span className="rounded border border-line px-1.5 py-0.5 text-ink">{label || "deployer"} {shortAddr(cluster.rootDeployer)}</span>
        {hub && hub !== cluster.rootDeployer && (<><span className="text-ink-faint">← funded via</span><a href={`${acct(hub)}`} target="_blank" rel="noreferrer" className="rounded border px-1.5 py-0.5 hover:underline" style={{ borderColor: `${tone}55`, color: tone }}>hub {shortAddr(hub)}</a></>)}
        {origin && (<><span className="text-ink-faint">←</span><span className="rounded border border-line px-1.5 py-0.5" style={{ color: origin.kind === "cex" ? "var(--color-pass)" : "var(--color-ink-dim)" }}>{origin.kind === "cex" ? origin.label ?? "CEX" : `anon ${shortAddr(origin.address)}`}</span></>)}
      </div>

      {noCluster ? null : (
        <div className="mt-3 space-y-2 border-t border-line pt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Launch wallets in this cluster</div>
          {deployers.map((w) => {
            const toks = (byDeployer.get(w.address) ?? []);
            return (
              <div key={w.address} className="flex flex-wrap items-center gap-1.5">
                <a href={acct(w.address)} target="_blank" rel="noreferrer" className="mono text-[11px] hover:underline" style={{ color: w.isRoot ? "var(--color-ink)" : "var(--color-signal)" }}>
                  {shortAddr(w.address)}{w.isRoot ? " (this token)" : ""}
                </a>
                {typeof w.tokensCreated === "number" && w.tokensCreated > 0 && <span className="text-[10px] text-ink-faint">{w.tokensCreated} minted</span>}
                {toks.slice(0, 6).map((t) => (
                  <button
                    key={t.mint}
                    onClick={() => onAudit?.(t.mint)}
                    title={t.mint}
                    className="mono rounded border px-1 py-0.5 text-[9.5px] transition hover:border-signal hover:text-signal"
                    style={t.dead ? { borderColor: "var(--color-avoid)44", color: "var(--color-avoid)" } : { borderColor: "var(--color-line)", color: "var(--color-ink)" }}
                  >
                    {t.name || shortAddr(t.mint)}{t.dead ? " ✝" : ""}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {cluster.budgetExhausted && (
        <p className="mt-2 text-[10px] text-ink-faint">Trace hit its depth budget — more of the network may extend beyond what was walked here.</p>
      )}
    </div>
  );
}
