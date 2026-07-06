import { useState } from "react";
import type { ScanCheck, CheckStatus } from "../lib/scanChecklist";

// Transparent scan methodology: every check ARGUS runs for this subject, with its
// real outcome — ran / flagged / nothing-found / skipped-and-why / couldn't-verify.
// Collapsed by default so it reads as a trust footer, not clutter.
const META: Record<CheckStatus, { color: string; glyph: string; label: string }> = {
  pass: { color: "var(--color-pass)", glyph: "✓", label: "checked" },
  flag: { color: "var(--color-caution)", glyph: "▲", label: "flagged" },
  empty: { color: "var(--color-ink-faint)", glyph: "○", label: "nothing found" },
  skip: { color: "var(--color-ink-faint)", glyph: "⊘", label: "not applicable" },
  na: { color: "var(--color-caution)", glyph: "⚠", label: "couldn't verify" },
  run: { color: "var(--color-signal)", glyph: "•", label: "performed" },
};

export function MethodologyChecklist({ checks }: { checks: ScanCheck[] }) {
  const [open, setOpen] = useState(false);
  if (!checks.length) return null;
  const ran = checks.filter((c) => c.status !== "skip" && c.status !== "na").length;
  const flagged = checks.filter((c) => c.status === "flag").length;
  const skipped = checks.filter((c) => c.status === "skip").length;
  const na = checks.filter((c) => c.status === "na").length;

  return (
    <div className="rounded-xl border border-line bg-panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Scan methodology</span>
        <span className="text-[11.5px] text-ink-dim">{ran} checks run{flagged ? ` · ${flagged} flagged` : ""}{skipped ? ` · ${skipped} n/a` : ""}{na ? ` · ${na} unverified` : ""}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="border-t border-line/60 px-2 py-1.5">
          {checks.map((c, i) => {
            const m = META[c.status];
            return (
              <div key={i} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                <span className="mono mt-0.5 w-3.5 shrink-0 text-center text-[12px]" style={{ color: m.color }} title={m.label}>{m.glyph}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-[12.5px] text-ink">{c.label}</span>
                  {c.note && <span className="ml-2 text-[11px] text-ink-faint">{c.note}</span>}
                </span>
                <span className="mono shrink-0 text-[9.5px] uppercase tracking-wide" style={{ color: m.color }}>{m.label}</span>
              </div>
            );
          })}
          <p className="px-2 py-1.5 text-[10.5px] leading-snug text-ink-faint">
            Every scan runs this same set. <span style={{ color: "var(--color-ink-faint)" }}>⊘ not applicable</span> means the check doesn't fit this subject (an EVM-only test on a Solana token, a KOL check on a fund); <span style={{ color: "var(--color-caution)" }}>⚠ couldn't verify</span> means it needs a key or the data wasn't reachable.
          </p>
        </div>
      )}
    </div>
  );
}
