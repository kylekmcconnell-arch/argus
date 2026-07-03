import { useEffect, useRef, useState } from "react";

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

export function MarketIntel({ symbol, contract, chain }: { symbol: string; contract?: string; chain?: string }) {
  const [d, setD] = useState<Intel | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const qs = new URLSearchParams({ symbol, contract: contract ?? "", chain: chain ?? "" });
    fetch(`/api/cryptorank?${qs}`)
      .then((r) => r.json())
      .then((j: Intel) => {
        // Show if we matched a token OR detected impersonation (both are signal).
        if (j?.available === false || (!j?.matched && !j?.impersonation)) { setState("none"); return; }
        setD(j);
        setState("ok");
      })
      .catch(() => setState("none"));
  }, [symbol, contract, chain]);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">pulling market fundamentals…</div>;
  if (state === "none" || !d) return null;

  const imp = d.impersonation;
  const dd = d.ath?.drawdownPct ?? null;
  const deep = dd != null && dd <= -80;
  const fdvGap = d.fdv && d.marketCap && d.fdv > d.marketCap * 1.5;
  const f = d.flags;
  const lowCirc = d.dilutionPct != null && d.dilutionPct < 50;
  const inv = d.macro?.investmentActivity ?? null;

  return (
    <div className="rounded-xl border bg-panel p-4" style={{ borderColor: imp ? "var(--color-avoid)" : "var(--color-line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Market intelligence</span>
        {d.matched && d.rank && <span className="mono rounded px-1.5 py-0.5 text-[10px] text-ink-dim" style={{ background: "var(--color-panel-2)" }}>rank #{d.rank}</span>}
        {d.matched && d.matchedBy === "ticker" && !imp && <span className="text-[9.5px] text-ink-faint">matched by ticker</span>}
        {(d.url || imp?.url) && <a href={d.url ?? imp?.url ?? "#"} target="_blank" rel="noreferrer" className="mono ml-auto text-[10px] text-signal-dim hover:underline">CryptoRank ↗</a>}
      </div>

      {/* IMPERSONATION — the loudest signal */}
      {imp && (
        <div className="mt-2.5 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-avoid)", background: "rgba(220,38,38,.08)" }}>
          <div className="text-[13px] font-semibold" style={{ color: "var(--color-avoid)" }}>⚠ Ticker impersonation risk</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
            The real <span className="text-ink">${symbol}</span> is <span className="text-ink">{imp.realName}</span>
            {imp.realRank ? ` (rank #${imp.realRank})` : ""}, deployed at <span className="mono">{shortAddr(imp.realContract)}</span>
            {imp.realChain ? ` on ${imp.realChain}` : ""}. This token uses that ticker at a different contract — a classic name-squat.
          </p>
        </div>
      )}

      {d.matched && (
        <>
          {/* ATH drawdown */}
          {dd != null && (
            <div className="mt-2.5">
              <span className="mono text-[20px] font-semibold tabular" style={{ color: deep ? "var(--color-avoid)" : dd <= -40 ? "var(--color-caution)" : "var(--color-pass)" }}>{dd.toFixed(1)}%</span>
              <span className="ml-2 text-[12px] text-ink-dim">from all-time high{d.ath?.value ? ` of $${px(d.ath.value)}` : ""}{d.ath?.date ? ` (${monthYear(d.ath.date)})` : ""}</span>
              {d.atl?.recoveryPct != null && d.atl.recoveryPct > 30 && <span className="ml-2 text-[11px] text-ink-faint">· +{d.atl.recoveryPct >= 1000 ? Math.round(d.atl.recoveryPct / 100) / 10 + "k" : d.atl.recoveryPct}% off the bottom</span>}
            </div>
          )}

          <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-ink-faint">
            <span>mcap <span className="text-ink-dim">{money(d.marketCap)}</span></span>
            <span>FDV <span className={fdvGap ? "text-caution" : "text-ink-dim"}>{money(d.fdv)}</span></span>
            {d.dilutionPct != null && <span>{d.dilutionPct}% circulating</span>}
            {d.volMcapRatio != null && <span title="24h volume / market cap">vol/mcap {d.volMcapRatio}</span>}
            {d.category?.position && d.category.peersRanked && <span>#{d.category.position} of {d.category.peersRanked} ranked {d.category.name}</span>}
          </div>

          {/* cap-table flags */}
          {f && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {f.hasNextUnlock && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(220,38,38,.14)", color: "var(--color-avoid)" }} title="A scheduled token unlock is coming — new supply hitting the market is a dump-risk signal">⚠ upcoming unlock</span>}
              {f.hasVesting && <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">vesting</span>}
              {f.hasFundingRounds && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(22,163,74,.12)", color: "var(--color-pass)" }} title="Has disclosed funding rounds — VC-backed">VC-backed</span>}
              {f.hasCrowdsales && <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">public sale</span>}
              {f.hasTeam && <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">team listed</span>}
            </div>
          )}

          {/* cross-chain footprint */}
          {(d.contracts?.length ?? 0) > 1 && (
            <div className="mt-2.5 border-t border-line/60 pt-2 text-[11px] text-ink-faint">
              Deployed on {d.contracts!.length} chains:{" "}
              {d.contracts!.slice(0, 6).map((c, i) => <span key={i} className="mono text-ink-dim">{c.chain}{i < Math.min(d.contracts!.length, 6) - 1 ? " · " : ""}</span>)}
            </div>
          )}

          {(fdvGap || lowCirc) && (
            <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--color-caution)" }}>
              {lowCirc ? `Only ${d.dilutionPct}% of max supply circulates` : "FDV far above market cap"} — significant locked supply still to hit the market{f?.hasNextUnlock ? ", with an unlock scheduled" : ""}.
            </p>
          )}

          {inv != null && (
            <p className="mt-1.5 text-[10.5px] text-ink-faint">Market context: crypto funding activity is {inv >= 0 ? "up" : "down"} {Math.abs(inv)}% right now{d.macro?.btcDominance != null ? ` · BTC dominance ${d.macro.btcDominance.toFixed(0)}%` : ""}.</p>
          )}
        </>
      )}
    </div>
  );
}
