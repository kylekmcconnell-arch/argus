// The track record — the scanner's "we called it" surface. Reads the shared
// receipts ledger (every analyst's flags) and shows, for each flagged token, the
// liquidity AT flag time versus now: a token flagged DANGER at $32K that then
// went to $0 is a receipt. Honest both ways — recovered tokens (our misses) are
// shown just the same, because a track record only means something with the
// misses left in.

import { useEffect, useState } from "react";
import type { Receipt, ThreatVerdict } from "../threat/types";
import { sharedReceiptStats } from "../threat/receipts";

const VERDICT_COLOR: Record<ThreatVerdict, string> = {
  SAFE: "var(--color-pass)",
  CAUTION: "var(--color-caution)",
  DANGER: "var(--color-avoid)",
  RUG: "var(--color-avoid)",
  UNKNOWN: "var(--color-ink-faint)",
};

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const money = (n?: number) =>
  n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Math.round(n);

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function StatusPill({ r }: { r: Receipt }) {
  if (r.checkedAt == null) return <span className="mono text-[10px] text-ink-faint">not re-checked</span>;
  const map = {
    dead: { c: "var(--color-avoid)", t: "DEAD" },
    bleeding: { c: "var(--color-caution)", t: "BLEEDING" },
    alive: { c: "var(--color-ink-faint)", t: "still alive" },
  } as const;
  const m = map[r.status ?? "alive"];
  return (
    <span className="mono text-[10.5px]" style={{ color: m.c }}>
      {m.t}{r.priceDropPct != null && r.status !== "alive" ? ` · −${r.priceDropPct}% liq` : ""}
    </span>
  );
}

function ReceiptRow({ r, onOpen }: { r: Receipt; onOpen: (addr: string) => void }) {
  const vc = VERDICT_COLOR[r.verdict];
  return (
    <button
      onClick={() => onOpen(r.address)}
      className="flex w-full items-center gap-3 border-b border-line/60 py-2.5 text-left transition hover:bg-panel/50"
    >
      <span className="mono w-16 shrink-0 text-[12px] font-semibold" style={{ color: vc }}>{r.verdict}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">${r.symbol}</div>
        <div className="mono text-[10.5px] text-ink-faint">{r.chain} · {shortAddr(r.address)} · flagged {ago(r.flaggedAt)}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="mono text-[11.5px] text-ink-dim">{money(r.liqThen)}{r.liqNow != null ? ` → ${money(r.liqNow)}` : ""}</div>
        <StatusPill r={r} />
      </div>
    </button>
  );
}

export function ThreatReceipts({ onOpen }: { onOpen: (addr: string) => void }) {
  const [stats, setStats] = useState<{ flagged: number; confirmedDead: number; checked: number; recent: Receipt[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sharedReceiptStats().then((s) => { setStats(s); setLoading(false); });
  }, []);

  const hitRate = stats && stats.checked > 0 ? Math.round((stats.confirmedDead / stats.checked) * 100) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">Track record</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-dim">
        Every token the scanner has flagged, tracked against what happened next. A token flagged while it still had real
        liquidity that then went to zero is a receipt. Misses are shown too — a track record only means something with
        them left in.
      </p>

      {loading && <p className="mt-8 animate-pulse text-[13px] text-ink-faint">Loading the ledger…</p>}

      {stats && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line px-3 py-2.5">
              <div className="mono text-[10px] uppercase tracking-wider text-ink-faint">Flagged</div>
              <div className="mt-1 text-[20px] font-semibold tabular text-ink">{stats.flagged.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-line px-3 py-2.5">
              <div className="mono text-[10px] uppercase tracking-wider text-ink-faint">Confirmed dead</div>
              <div className="mt-1 text-[20px] font-semibold tabular text-avoid">{stats.confirmedDead.toLocaleString()}</div>
              <div className="mono text-[10px] text-ink-faint">of {stats.checked} re-checked</div>
            </div>
            {hitRate != null && (
              <div className="rounded-lg border border-line px-3 py-2.5">
                <div className="mono text-[10px] uppercase tracking-wider text-ink-faint">Went to zero</div>
                <div className="mt-1 text-[20px] font-semibold tabular text-avoid">{hitRate}%</div>
                <div className="mono text-[10px] text-ink-faint">of re-checked flags</div>
              </div>
            )}
          </div>

          {stats.recent.length === 0 ? (
            <p className="mt-8 text-[13px] text-ink-faint">
              No flagged tokens in the ledger yet. As scans accumulate, flagged tokens land here and the nightly re-check
              tracks which ones die.
            </p>
          ) : (
            <div className="mt-6 rounded-xl border border-line p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-ink">Flagged tokens</h2>
                <span className="mono text-[10.5px] text-ink-faint">newest first · click to re-scan</span>
              </div>
              <div className="mt-2">
                {stats.recent.map((r) => <ReceiptRow key={`${r.chain}:${r.address}`} r={r} onOpen={onOpen} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
