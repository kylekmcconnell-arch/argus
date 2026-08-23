// Wallet threat triage view: an address in → portfolio joined against the
// scanner's verdicts, an at-risk-USD headline, and per-token rows with
// dead-market flags. Run console while it works, then the report.

import { useEffect, useRef, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import type { TraceStep } from "../data/evidence";
import type { ThreatVerdict } from "../threat/types";
import { scanWallet, type WalletScan, type WalletPosition } from "../threat/wallet";

const VERDICT_COLOR: Record<ThreatVerdict, string> = {
  SAFE: "var(--color-pass)",
  CAUTION: "var(--color-caution)",
  DANGER: "var(--color-avoid)",
  RUG: "var(--color-avoid)",
  UNKNOWN: "var(--color-ink-faint)",
};

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const money = (n?: number | null) =>
  n == null ? "-" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(2);

function Row({ p }: { p: WalletPosition }) {
  const vc = p.verdict ? VERDICT_COLOR[p.verdict] : "var(--color-ink-faint)";
  return (
    <div className="flex items-center gap-3 border-b border-line/60 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">${p.symbol}</span>
          {p.deadMarket && <span className="mono rounded px-1 py-0.5 text-[9px] uppercase tracking-wider text-avoid" style={{ border: "1px solid currentColor" }}>no market</span>}
          {p.fresh && <span className="mono text-[9px] text-ink-faint">fresh</span>}
        </div>
        <div className="mono text-[10.5px] text-ink-faint">{p.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} · {shortAddr(p.address)}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="mono text-[12px] text-ink-dim">{money(p.valueUsd)}</div>
        <div className="mono text-[10px] text-ink-faint">liq {money(p.liquidityUsd)}</div>
      </div>
      <div className="w-16 shrink-0 text-right">
        {p.verdict
          ? <span className="mono text-[11px] font-semibold" style={{ color: vc }}>{p.verdict}</span>
          : <span className="mono text-[10px] text-ink-faint">unrated</span>}
      </div>
    </div>
  );
}

function Report({ scan }: { scan: WalletScan }) {
  const t = scan.totals;
  const atRiskPct = t.valueUsd > 0 ? (t.atRiskUsd / t.valueUsd) * 100 : 0;
  return (
    <div className="report-frame pb-16">
      <div className="py-6">
        <div className="mono text-[11px] text-ink-faint">{scan.chain} · {shortAddr(scan.address)}</div>
        <h1 className="mt-1 text-[22px] font-semibold text-ink">Wallet triage</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Portfolio value" value={money(t.valueUsd)} />
          <Stat label="At risk" value={money(t.atRiskUsd)} tone={t.atRiskUsd > 0 ? "bad" : "good"} sub={t.valueUsd > 0 ? `${atRiskPct.toFixed(0)}% of value` : undefined} />
          <Stat label="Dead markets" value={String(t.deadMarkets)} tone={t.deadMarkets > 0 ? "warn" : "good"} />
          <Stat label="Positions" value={String(scan.positions.length)} />
        </div>
        {t.atRiskUsd > 0 && (
          <p className="mt-4 rounded-lg border border-avoid/40 bg-avoid/5 px-3 py-2 text-[13px] text-ink-dim">
            {money(t.atRiskUsd)} of this wallet sits in tokens flagged DANGER or RUG. Positions with "no market" may have nowhere left to sell.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Holdings</h2>
          <span className="mono text-[10.5px] text-ink-faint">
            {(["RUG", "DANGER", "CAUTION", "SAFE", "UNKNOWN"] as ThreatVerdict[]).filter((v) => t.counts[v]).map((v) => `${t.counts[v]} ${v.toLowerCase()}`).join(" · ")}
            {t.counts.UNSCANNED ? ` · ${t.counts.UNSCANNED} unrated` : ""}
          </span>
        </div>
        <div className="mt-2">
          {scan.positions.map((p) => <Row key={p.address} p={p} />)}
        </div>
      </div>
      <p className="mono mt-4 text-center text-[10.5px] text-ink-faint">
        cached verdicts join instantly; the largest unrated positions are scanned live and added to the shared ledger
      </p>
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "good" | "warn" | "bad"; sub?: string }) {
  const color = tone === "bad" ? "var(--color-avoid)" : tone === "warn" ? "var(--color-caution)" : tone === "good" ? "var(--color-pass)" : "var(--color-ink)";
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <div className="mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tabular" style={{ color }}>{value}</div>
      {sub && <div className="mono text-[10px] text-ink-faint">{sub}</div>}
    </div>
  );
}

export function WalletScanPage({ address, onError }: { address: string; onError?: () => void }) {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [scan, setScan] = useState<WalletScan | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    scanWallet(address, (s) => setSteps((prev) => [...prev, s]))
      .then((r) => { if (r) setScan(r); else { setFailed(true); onError?.(); } })
      .catch(() => { setFailed(true); onError?.(); });
  }, [address, onError]);

  if (scan) return <Report scan={scan} />;
  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-[14px] text-ink-dim">Couldn't read this wallet's holdings.</p>
        <p className="mt-1 text-[12px] text-ink-faint">EVM wallets are read keyless; Solana wallet holdings need a Helius key on the backend.</p>
      </div>
    );
  }
  const label = address.length > 20 ? address.slice(0, 8) + "…" + address.slice(-4) : address;
  return (
    <AuditConsole
      handle={label}
      subtitle="wallet triage · every position joined against the scanner's verdicts · at-risk USD + dead markets"
      steps={steps}
      working
      mode="live"
    />
  );
}
