import { useEffect, useState } from "react";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// Market intelligence (CryptoRank): impersonation check, drawdown from ATH,
// dilution + unlock flags, sector rank placement, cross-chain footprint, and
// macro context. Auto-runs on token / investigation reports.
type Contract = { chain: string; address: string };
type Intel = {
  available: boolean;
  matched?: boolean;
  matchedBy?: "contract" | "ticker";
  impersonation?: { realName: string; realRank: number | null; realContract: string | null; realChain: string | null; url: string | null } | null;
  name?: string;
  rank?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  volMcapRatio?: number | null;
  circulatingSupply?: number | null;
  maxSupply?: number | null;
  dilutionPct?: number | null;
  ath?: { value: number | null; date: number; drawdownPct: number | null } | null;
  atl?: { value: number | null; date: number; recoveryPct: number | null } | null;
  flags?: { hasTeam: boolean; hasFundingRounds: boolean; hasCrowdsales: boolean; hasVesting: boolean; hasNextUnlock: boolean };
  category?: { name: string; position: number | null; peersRanked: number | null } | null;
  contracts?: Contract[];
  macro?: { investmentActivity: number | null; btcDominance: number | null; mcapChange: number | null } | null;
  url?: string | null;
  note?: string;
};

const money = (n?: number | null) => (n == null ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n));
const monthYear = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "");
const shortAddr = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "");
const px = (v?: number | null) => (v == null ? "" : v < 1 ? v.toPrecision(3) : v.toLocaleString());

export function MarketIntel({ symbol, contract, chain, panelCostToken }: { symbol: string; contract?: string; chain?: string; panelCostToken?: string }) {
  const requestKey = [symbol, contract ?? "", chain ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; state: "ok" | "none" | PanelRequestFailure; data: Intel | null } | null>(null);

  useEffect(() => {
    if (!panelCostToken) return;
    const controller = new AbortController();
    const qs = new URLSearchParams({ symbol, contract: contract ?? "", chain: chain ?? "" });
    fetchPanelJson<Intel>(`/api/cryptorank?${qs}`, { headers: requiredPanelHeaders(panelCostToken), signal: controller.signal })
      .then((j) => {
        if (controller.signal.aborted) return;
        // Show if we matched a token OR detected impersonation (both are signal).
        if (j?.available === false || (!j?.matched && !j?.impersonation)) {
          setResult({ key: requestKey, state: "none", data: null });
          return;
        }
        setResult({ key: requestKey, state: "ok", data: j });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, state: panelRequestFailure(error), data: null });
      });
    return () => controller.abort();
  }, [symbol, contract, chain, panelCostToken, requestKey]);

  if (!panelCostToken) return null;
  const current = result?.key === requestKey ? result : null;
  if (!current) return <div className="panel p-4 text-[12.5px] text-ink-faint">pulling market fundamentals…</div>;
  if (current.state === "rescan_required" || current.state === "unavailable") {
    return <PanelRequestNotice failure={current.state} label="Market intelligence" />;
  }
  if (current.state === "none" || !current.data) return null;
  const d = current.data;

  const imp = d.impersonation;
  const dd = d.ath?.drawdownPct ?? null;
  const deep = dd != null && dd <= -80;
  const fdvGap = d.fdv && d.marketCap && d.fdv > d.marketCap * 1.5;
  const f = d.flags;
  const lowCirc = d.dilutionPct != null && d.dilutionPct < 50;
  const inv = d.macro?.investmentActivity ?? null;

  const ddColor = dd == null ? "var(--color-ink)" : deep ? "var(--color-avoid)" : dd <= -40 ? "var(--color-caution)" : "var(--color-pass)";
  const recovery = d.atl?.recoveryPct != null && d.atl.recoveryPct > 30 ? (d.atl.recoveryPct >= 1000 ? Math.round(d.atl.recoveryPct / 100) / 10 + "k" : String(d.atl.recoveryPct)) : null;

  return (
    <div className={`panel p-4 ${imp ? "border-avoid" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Market intelligence</span>
        {d.matched && d.rank && <span className="chip">#{d.rank}</span>}
        {d.matched && d.category?.position && d.category.peersRanked && (
          <span className="chip normal-case tracking-normal">#{d.category.position}/{d.category.peersRanked} {d.category.name}</span>
        )}
        {(d.url || imp?.url) && <a href={d.url ?? imp?.url ?? "#"} target="_blank" rel="noreferrer" className="link-ext mono ml-auto text-[11px]">CryptoRank</a>}
      </div>

      {/* IMPERSONATION — the loudest signal */}
      {imp && (
        <div className="finding tint-avoid mt-2.5 px-3 py-2">
          <div className="text-[13.5px] font-semibold text-avoid">⚠ Ticker impersonation risk</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
            The real <span className="text-ink">${symbol}</span> is <span className="text-ink">{imp.realName}</span>
            {imp.realRank ? ` (rank #${imp.realRank})` : ""}, deployed at <span className="mono">{shortAddr(imp.realContract)}</span>
            {imp.realChain ? ` on ${imp.realChain}` : ""}. This token uses that ticker at a different contract — a classic name-squat.
          </p>
        </div>
      )}

      {d.matched && (
        <>
          {/* ATH drawdown — the hero stat */}
          {dd != null && (
            <div className="mt-3 flex items-baseline gap-2.5">
              <span className="mono text-[32px] font-bold leading-none tabular" style={{ color: ddColor }}>{dd.toFixed(0)}%</span>
              <div className="min-w-0 text-[12.5px] leading-tight text-ink-faint">
                <div>from all-time high{d.ath?.date ? <> <span className="text-ink-dim">{monthYear(d.ath.date)}</span></> : null}</div>
                {d.ath?.value != null && <div className="mono">ATH ${px(d.ath.value)}{recovery ? <span className="text-pass"> · +{recovery}% off bottom</span> : null}</div>}
              </div>
            </div>
          )}

          {/* metric grid — scannable fundamentals */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="stat-tile"><div className="stat-label">market cap</div><div className="stat-value mt-0.5 font-semibold">{money(d.marketCap)}</div></div>
            <div className="stat-tile"><div className="stat-label">fully diluted</div><div className="stat-value mt-0.5 font-semibold" style={fdvGap ? { color: "var(--color-caution)" } : undefined}>{money(d.fdv)}</div></div>
            {d.dilutionPct != null && <div className="stat-tile"><div className="stat-label">circulating</div><div className="stat-value mt-0.5 font-semibold" style={lowCirc ? { color: "var(--color-caution)" } : undefined}>{d.dilutionPct}%</div></div>}
            {d.volMcapRatio != null && <div className="stat-tile" title="24h volume / market cap"><div className="stat-label">vol / mcap</div><div className="stat-value mt-0.5 font-semibold">{d.volMcapRatio}</div></div>}
          </div>

          {/* cap-table + cross-chain chips */}
          {(f || (d.contracts?.length ?? 0) > 1) && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/60 pt-2.5">
              {f?.hasNextUnlock && <span className="chip tint-avoid" title="A scheduled token unlock is coming — new supply hitting the market is a dump-risk signal">⚠ upcoming unlock</span>}
              {f?.hasFundingRounds && <span className="chip tint-pass" title="Has disclosed funding rounds — VC-backed">VC-backed</span>}
              {f?.hasVesting && <span className="chip">vesting</span>}
              {f?.hasCrowdsales && <span className="chip">public sale</span>}
              {f?.hasTeam && <span className="chip">team listed</span>}
              {(d.contracts?.length ?? 0) > 1 && <span className="chip" title={d.contracts!.map((c) => c.chain).join(", ")}>{d.contracts!.length} chains</span>}
            </div>
          )}

          {(fdvGap || lowCirc) && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-caution">
              {lowCirc ? `Only ${d.dilutionPct}% of max supply circulates` : "FDV far above market cap"} — significant locked supply still to hit the market{f?.hasNextUnlock ? ", with an unlock scheduled" : ""}.
            </p>
          )}

          {inv != null && (
            <p className="mt-2 text-[11px] text-ink-faint">Macro: crypto funding {inv >= 0 ? "up" : "down"} {Math.abs(inv)}%{d.macro?.btcDominance != null ? ` · BTC dominance ${d.macro.btcDominance.toFixed(0)}%` : ""}.</p>
          )}
        </>
      )}
    </div>
  );
}
