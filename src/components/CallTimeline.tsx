import { useEffect, useRef, useState } from "react";

// The shill-timing strip for one token a KOL called: the price at their call,
// then 1h / 12h / 24h / 1w / 1m / 2m / 3m later, and now. Reads /api/call-performance
// (finds the call tweet, prices it on-chain). Falls back to "since launch" when
// the call predates the ~6 months of price history GeckoTerminal retains.
type Period = { label: string; pct: number | null; elapsed: boolean };
type CallPerf = {
  available: boolean; anchor?: "call" | "launch"; callTime?: number | null;
  callPredatesHistory?: boolean; tweetUrl?: string | null; periods?: Period[];
  current?: { pct: number }; peakPct?: number;
};

const enc = encodeURIComponent;
const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(n >= 10 || n <= -10 ? 0 : 1)}%`;

function Chip({ label, pct, elapsed, strong }: { label: string; pct: number | null; elapsed: boolean; strong?: boolean }) {
  const color = pct == null ? "var(--color-ink-faint)" : pct >= 0 ? "var(--color-pass)" : "var(--color-avoid)";
  return (
    <div className={`flex min-w-[42px] flex-col items-center rounded-md border px-1.5 py-1 ${strong ? "border-line-2 bg-panel-2" : "border-line"}`}>
      <span className="text-[8.5px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="mono text-[11px] tabular" style={{ color }}>{pct == null ? (elapsed ? "—" : "·") : fmtPct(pct)}</span>
    </div>
  );
}

export function CallTimeline({ handle, ticker, address, chain, panelCostToken }: { handle: string; ticker: string; address: string; chain: string; panelCostToken?: string }) {
  const [d, setD] = useState<CallPerf | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fetch(
      `/api/call-performance?handle=${enc(handle.replace(/^@/, ""))}&ticker=${enc(ticker)}&address=${enc(address)}&chain=${enc(chain)}`,
      panelCostToken ? { headers: { "x-argus-panel-token": panelCostToken } } : undefined,
    )
      .then((r) => r.json())
      .then((j: CallPerf) => { if (j?.available && j.periods?.length) { setD(j); setState("ok"); } else setState("none"); })
      .catch(() => setState("none"));
  }, [handle, ticker, address, chain, panelCostToken]);

  if (state === "loading") return <div className="mt-1 text-[10px] text-ink-faint">timing the call…</div>;
  if (state === "none" || !d) return null;

  const anchorIsCall = d.anchor === "call";
  const callDate = d.callTime ? fmtDate(d.callTime) : null;
  const daysAgo = d.callTime ? Math.floor((Date.now() / 1000 - d.callTime) / 86400) : null;
  const recent = daysAgo != null && daysAgo <= 30;

  return (
    <div className="mt-1.5">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-faint">
        {/* What actually matters for a KOL: how far the call RAN after they called
            it — not whether the token is alive now (most memecoins die regardless). */}
        {d.peakPct != null && d.peakPct > 5 ? (
          <span className="mono rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(52,211,153,.14)", color: "var(--color-pass)" }}>
            peaked {fmtPct(d.peakPct)} {anchorIsCall ? "after the call" : "post-launch"}
          </span>
        ) : anchorIsCall && d.current && d.current.pct <= 0 ? (
          <span className="mono rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(244,63,94,.12)", color: "var(--color-avoid)" }}>never ran</span>
        ) : null}
        {recent && (
          <span className="mono rounded px-1.5 py-0.5 text-[9px] font-medium" style={{ background: "rgba(232,177,42,.14)", color: "var(--color-caution)" }}>
            {daysAgo === 0 ? "today" : `${daysAgo}d ago`}
          </span>
        )}
        {anchorIsCall && callDate ? (
          <span>called {callDate}, priced from that post</span>
        ) : (
          <span>since launch{callDate ? ` (called ${callDate}, before indexed price history)` : ""}</span>
        )}
        {d.tweetUrl && <a href={d.tweetUrl} target="_blank" rel="noreferrer" className="text-signal-dim hover:underline">the call ↗</a>}
      </div>
      <div className="flex flex-wrap gap-1">
        {d.periods!.map((p) => <Chip key={p.label} label={p.label} pct={p.pct} elapsed={p.elapsed} />)}
        {d.current && <Chip label="now" pct={d.current.pct} elapsed strong />}
      </div>
    </div>
  );
}
