import { useEffect, useRef, useState } from "react";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// What a wallet actually holds right now — net worth, 24h move, token breakdown.
// The forensic bite lives in the shape of the bag, not the total: an operator whose
// net worth IS the coin they launched (selfToken) has nothing realized and every
// reason to defend the price; one parked in stables has already taken money off the
// table. Self-hides when the wallet holds nothing meaningful.
type Holding = { name: string; symbol: string; usd: number; balance: number; change24h: number; chain: string };
type Data = {
  available: boolean;
  totalUsd: number; totalUsd24hAgo: number; deltaPct: number; chains: number;
  holdings: Holding[]; concentrationPct: number; stablePct: number;
  selfToken?: { symbol: string; usd: number; pct: number };
};

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function Holdings({ address, symbol, panelCostToken }: { address?: string | null; symbol?: string; panelCostToken?: string }) {
  const requestKey = [address ?? "", symbol ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; data: Data | null; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === requestKey || !address || !panelCostToken) return;
    ran.current = requestKey;
    let live = true;
    (async () => {
      try {
        const q = `/api/arkham-holdings?address=${encodeURIComponent(address)}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`;
        const j = await fetchPanelJson<Data>(q, { headers: requiredPanelHeaders(panelCostToken) });
        if (live) setResult({ key: requestKey, data: j?.available ? j : null });
      } catch (error) {
        if (live) setResult({ key: requestKey, data: null, failure: panelRequestFailure(error) });
      }
    })();
    return () => { live = false; };
  }, [address, panelCostToken, requestKey, symbol]);

  const current = result?.key === requestKey ? result : null;
  if (current?.failure) return <PanelRequestNotice failure={current.failure} label="Wallet holdings intelligence" />;
  const d = current?.data;
  if (!d || !d.available || d.totalUsd < 1 || d.holdings.length === 0) return null;
  const up = d.deltaPct >= 0;

  // The read: what the shape of the bag says about the operator.
  let bite: { text: string; tone: "avoid" | "caution" | "dim" } | null = null;
  if (d.selfToken && d.selfToken.pct >= 60) bite = { text: `${d.selfToken.pct.toFixed(0)}% of net worth is its own $${d.selfToken.symbol} — nothing realized, every reason to defend the price`, tone: "avoid" };
  else if (d.selfToken && d.selfToken.pct >= 25) bite = { text: `${d.selfToken.pct.toFixed(0)}% held in its own $${d.selfToken.symbol}`, tone: "caution" };
  else if (d.stablePct >= 60) bite = { text: `${d.stablePct.toFixed(0)}% parked in stablecoins — money already off the table`, tone: "dim" };
  else if (d.concentrationPct >= 80) bite = { text: `${d.concentrationPct.toFixed(0)}% concentrated in a single token`, tone: "caution" };

  const toneColor = bite?.tone === "avoid" ? "var(--color-avoid)" : bite?.tone === "caution" ? "var(--color-caution)" : "var(--color-ink-faint)";

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Holdings</span>
        <span className="text-[11.5px] text-ink-dim">what the wallet holds now (Arkham)</span>
        <div className="ml-auto flex items-baseline gap-2">
          <span className="mono text-[15px] font-semibold text-ink tabular">{usd(d.totalUsd)}</span>
          <span className="mono text-[11px] tabular" style={{ color: up ? "var(--color-pass)" : "var(--color-avoid)" }}>{pct(d.deltaPct)} 24h</span>
        </div>
      </div>

      {bite && (
        <div className="mt-2.5 rounded-lg px-3 py-2 text-[11.5px]" style={{ background: `${toneColor}12`, color: toneColor }}>
          {bite.text}
        </div>
      )}

      <div className="mt-2.5 divide-y divide-line/60 rounded-lg border border-line/60">
        {d.holdings.map((h, i) => {
          const share = d.totalUsd > 0 ? (h.usd / d.totalUsd) * 100 : 0;
          const self = d.selfToken && h.symbol === d.selfToken.symbol;
          return (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11.5px]">
              <span className="mono font-medium text-ink">{h.symbol}</span>
              {self && <span className="mono shrink-0 rounded px-1 py-0.5 text-[9px]" style={{ background: "var(--color-caution)1a", color: "var(--color-caution)" }}>own token</span>}
              <span className="truncate text-ink-faint">{h.name}</span>
              {h.change24h !== 0 && (
                <span className="mono text-[10px] tabular" style={{ color: h.change24h >= 0 ? "var(--color-pass)" : "var(--color-avoid)" }}>{pct(h.change24h)}</span>
              )}
              <span className="mono ml-auto tabular text-ink-dim">{share.toFixed(0)}%</span>
              <span className="mono w-[68px] shrink-0 text-right tabular text-ink">{usd(h.usd)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-ink-faint">across {d.chains} chain{d.chains === 1 ? "" : "s"}</div>
    </div>
  );
}
