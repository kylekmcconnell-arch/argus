import { useEffect, useState } from "react";
import { labelAddress } from "../lib/addressLabels";
import { useArkhamLabels } from "../lib/useArkhamLabels";
import { ArkhamName } from "./ArkhamName";

// Holder / distribution forensics — is the ownership a healthy base or a rug
// wearing a costume? Solana pulls the rich RugCheck view (total holders, top-10
// concentration with DEX/CEX/LP separated out, connected insider clusters, creator
// holdings, LP-lock). EVM falls back to the on-chain audit's own holder fields.
type RcTop = { addr: string; owner?: string; pct: number; insider: boolean; label: string | null; market: boolean };
interface Holders {
  available: boolean;
  totalHolders: number;
  top: RcTop[];
  concentration: { top1: number; top5: number; top10: number; top10NonMarket: number; marketPct: number };
  insiders: { detected: number; networks: number; clusteredPct: number };
  creatorPct: number;
  lpLockedPct: number;
  rugged: boolean;
  verdict: { tone: "good" | "warn" | "bad"; line: string };
}

const TONE: Record<string, string> = { good: "var(--color-pass)", warn: "var(--color-caution)", bad: "var(--color-avoid)" };
const money = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="mono text-[15px] font-semibold tabular" style={{ color: tone ?? "var(--color-ink)" }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}

export function HolderForensics({ address, chain, holderCount, evmTop, insiderPct }: {
  address: string;
  chain: string;
  holderCount: number;
  evmTop: { pct: number; tag?: string; address?: string; isContract?: boolean }[];
  insiderPct: number;
}) {
  const [d, setD] = useState<Holders | null>(null);
  const [state, setState] = useState<"loading" | "sol" | "evm">(chain === "solana" ? "loading" : "evm");
  // Arkham entity labels for every holder wallet shown — names the anonymous ones.
  const arkham = useArkhamLabels([...evmTop.map((h) => h.address), ...(d?.top ?? []).map((h) => h.owner)]);

  useEffect(() => {
    if (chain !== "solana") { setState("evm"); return; }
    let live = true;
    setState("loading");
    fetch(`/api/holders?mint=${encodeURIComponent(address)}&chain=${chain}`)
      .then((r) => r.json())
      .then((j) => { if (!live) return; if (j?.available) { setD(j); setState("sol"); } else setState("evm"); })
      .catch(() => { if (live) setState("evm"); });
    return () => { live = false; };
  }, [address, chain]);

  if (state === "loading") {
    return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">reading the holder base + distribution…</div>;
  }

  // ---- Solana: rich RugCheck view ----
  if (state === "sol" && d) {
    const c = d.concentration;
    const barMarket = Math.min(100, c.marketPct);
    const barRisk = Math.min(100 - barMarket, c.top10NonMarket);
    return (
      <div className="rounded-xl border bg-panel p-4" style={{ borderColor: TONE[d.verdict.tone] + "55" }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Holder forensics</span>
          <span className="mono text-[10px] text-ink-faint">RugCheck</span>
          {d.rugged && <span className="mono rounded border border-avoid/40 px-1.5 py-0.5 text-[9.5px] text-avoid">rugged</span>}
        </div>

        <p className="mt-2 text-[13px] font-medium leading-relaxed" style={{ color: TONE[d.verdict.tone] }}>{d.verdict.line}</p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="holders" value={d.totalHolders ? money(d.totalHolders) : "—"} />
          <Metric label="top-10 hold" value={`${c.top10.toFixed(0)}%`} tone={c.top10NonMarket >= 40 ? TONE.bad : c.top10NonMarket >= 20 ? TONE.warn : undefined} />
          <Metric label="insider-clustered" value={`${d.insiders.clusteredPct.toFixed(0)}%`} tone={d.insiders.clusteredPct >= 15 ? TONE.warn : undefined} />
          <Metric label="creator holds" value={`${d.creatorPct.toFixed(d.creatorPct < 1 ? 1 : 0)}%`} tone={d.creatorPct >= 10 ? TONE.warn : undefined} />
        </div>

        {/* concentration bar: market/exchange liquidity vs private-wallet concentration */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-ink-faint">
            <span>top-10 distribution</span>
            <span className="mono">{c.marketPct > 1 ? `${c.marketPct.toFixed(0)}% DEX/CEX/LP · ` : ""}{c.top10NonMarket.toFixed(0)}% private wallets</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
            <span className="h-full" style={{ width: `${barMarket}%`, background: "var(--color-pass)" }} title="DEX / CEX / LP (market liquidity)" />
            <span className="h-full" style={{ width: `${barRisk}%`, background: c.top10NonMarket >= 40 ? "var(--color-avoid)" : "var(--color-caution)" }} title="private-wallet concentration" />
          </div>
        </div>

        {/* top holders, labeled */}
        {d.top.length > 0 && (
          <div className="mt-3 divide-y divide-line/60 rounded-lg border border-line">
            {d.top.slice(0, 8).map((h, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                <span className="mono w-4 shrink-0 text-ink-faint">{i + 1}</span>
                <ArkhamName address={h.owner} chain="solana" labels={arkham} fallback={h.addr} className="text-ink-dim" />
                {h.label && <span className="mono shrink-0 rounded px-1.5 py-0.5 text-[9px]" style={{ background: h.market ? "var(--color-pass)1a" : "var(--color-caution)1a", color: h.market ? "var(--color-pass)" : "var(--color-caution)" }}>{h.label}</span>}
                {h.insider && !h.label && <span className="mono shrink-0 rounded px-1.5 py-0.5 text-[9px]" style={{ background: "var(--color-avoid)1a", color: "var(--color-avoid)" }}>insider</span>}
                <span className="mono ml-auto shrink-0 tabular text-ink">{h.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}

        <div className="mono mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-faint">
          {d.insiders.detected > 0 && <span>{d.insiders.detected.toLocaleString()} linked insider wallets across {d.insiders.networks} cluster{d.insiders.networks === 1 ? "" : "s"}</span>}
          {d.lpLockedPct > 0 && <span>LP {d.lpLockedPct.toFixed(0)}% locked</span>}
        </div>
      </div>
    );
  }

  // ---- EVM / fallback: the on-chain audit's own holder fields ----
  const top = [...evmTop].sort((a, b) => b.pct - a.pct).slice(0, 8);
  const topSum = top.reduce((a, h) => a + h.pct, 0);
  const concentrated = topSum >= 50;
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Holder forensics</span>
        <span className="mono text-[10px] text-ink-faint">on-chain</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Metric label="holders" value={holderCount ? holderCount.toLocaleString() : "—"} />
        <Metric label={`top ${top.length} hold`} value={top.length ? `${topSum.toFixed(0)}%` : "—"} tone={concentrated ? TONE.bad : undefined} />
        <Metric label="insider est." value={insiderPct ? `${insiderPct}%` : "—"} tone={insiderPct >= 20 ? TONE.warn : undefined} />
      </div>
      {top.length > 0 && (
        <div className="mt-3 divide-y divide-line/60 rounded-lg border border-line">
          {top.map((h, i) => {
            const lab = labelAddress(h.address, { tag: h.tag, isContract: h.isContract });
            const color = lab.kind === "burn" || lab.market ? "var(--color-pass)" : "var(--color-ink-dim)";
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                <span className="mono w-4 shrink-0 text-ink-faint">{i + 1}</span>
                <ArkhamName address={h.address} chain={chain} labels={arkham} fallback={lab.text} className={color === "var(--color-pass)" ? "" : "text-ink-dim"} />
                {lab.market && <span className="mono shrink-0 rounded px-1.5 py-0.5 text-[9px]" style={{ background: "var(--color-pass)1a", color: "var(--color-pass)" }}>{lab.kind === "burn" ? "burned" : "market/custody"}</span>}
                <span className="mono ml-auto shrink-0 tabular text-ink">{h.pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
        {top.length ? (concentrated ? `Concentrated: the top ${top.length} wallets hold ${topSum.toFixed(0)}% of supply.` : `Top ${top.length} wallets hold ${topSum.toFixed(0)}%.`) : "Holder-level data not available for this token."}
        {chain !== "solana" && " Deep cluster/insider forensics are Solana-only for now."}
      </p>
    </div>
  );
}
