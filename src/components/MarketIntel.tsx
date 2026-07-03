import { useEffect, useRef, useState } from "react";

// Market intelligence (CryptoRank): rank, drawdown from all-time high, dilution,
// and cap-table flags (VC-backed, vesting, upcoming unlock). The two headline
// signals a DEX scan misses: how far a token has fallen from its peak, and
// whether a supply unlock is coming. Auto-runs on token/investigation reports.
type Intel = {
  available: boolean;
  matched?: boolean;
  matchedBy?: "contract" | "ticker";
  name?: string;
  rank?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  circulatingSupply?: number | null;
  maxSupply?: number | null;
  dilutionPct?: number | null;
  ath?: { value: number | null; date: number; drawdownPct: number | null } | null;
  flags?: { hasTeam: boolean; hasFundingRounds: boolean; hasCrowdsales: boolean; hasVesting: boolean; hasNextUnlock: boolean };
  url?: string | null;
  note?: string;
};

const money = (n?: number | null) => (n == null ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n));
const monthYear = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "");

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
        if (j?.available === false || !j?.matched) { setState("none"); return; }
        setD(j);
        setState("ok");
      })
      .catch(() => setState("none"));
  }, [symbol, contract, chain]);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">pulling market fundamentals…</div>;
  if (state === "none" || !d) return null;

  const dd = d.ath?.drawdownPct ?? null;
  const deep = dd != null && dd <= -80;
  const fdvGap = d.fdv && d.marketCap && d.fdv > d.marketCap * 1.5;
  const f = d.flags;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Market intelligence</span>
        {d.rank && <span className="mono rounded px-1.5 py-0.5 text-[10px] text-ink-dim" style={{ background: "var(--color-panel-2)" }}>rank #{d.rank}</span>}
        {d.matchedBy === "ticker" && <span className="text-[9.5px] text-ink-faint">matched by ticker</span>}
        {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="mono ml-auto text-[10px] text-signal-dim hover:underline">CryptoRank ↗</a>}
      </div>

      {/* ATH drawdown — the headline */}
      {dd != null && (
        <div className="mt-2.5">
          <span className="mono text-[20px] font-semibold tabular" style={{ color: deep ? "var(--color-avoid)" : dd <= -40 ? "var(--color-caution)" : "var(--color-pass)" }}>
            {dd.toFixed(1)}%
          </span>
          <span className="ml-2 text-[12px] text-ink-dim">from all-time high{d.ath?.value ? ` of $${d.ath.value < 1 ? d.ath.value.toPrecision(3) : d.ath.value.toLocaleString()}` : ""}{d.ath?.date ? ` (${monthYear(d.ath.date)})` : ""}</span>
        </div>
      )}

      <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-ink-faint">
        <span>mcap <span className="text-ink-dim">{money(d.marketCap)}</span></span>
        <span>FDV <span className={fdvGap ? "text-caution" : "text-ink-dim"}>{money(d.fdv)}</span></span>
        {d.dilutionPct != null && <span>{d.dilutionPct}% of supply circulating</span>}
      </div>

      {/* cap-table flags */}
      {f && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {f.hasNextUnlock && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(220,38,38,.14)", color: "var(--color-avoid)" }} title="A scheduled token unlock is coming — new supply hitting the market is a dump-risk signal">⚠ upcoming unlock</span>}
          {f.hasVesting && <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">vesting schedule</span>}
          {f.hasFundingRounds && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(22,163,74,.12)", color: "var(--color-pass)" }} title="Has disclosed funding rounds — VC-backed">VC-backed</span>}
          {f.hasCrowdsales && <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">public sale</span>}
          {f.hasTeam && <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">team listed</span>}
        </div>
      )}
      {(fdvGap || (d.dilutionPct != null && d.dilutionPct < 50)) && (
        <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--color-caution)" }}>
          {d.dilutionPct != null && d.dilutionPct < 50 ? `Only ${d.dilutionPct}% of max supply circulates` : "FDV far above market cap"} — significant locked supply still to hit the market{f?.hasNextUnlock ? ", with an unlock scheduled" : ""}.
        </p>
      )}
    </div>
  );
}
