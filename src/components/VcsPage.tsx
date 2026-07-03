import { useEffect, useState } from "react";
import { ScoreTicker } from "./ScoreTicker";
import { PrivateToggle } from "./PrivateToggle";
import { ScanChip } from "./ScanChip";
import { mergedLog, subscribeLog, type LogEntry } from "../lib/auditlog";
import { verdictMeta } from "../lib/verdict";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";

// The VC / investor directory: every fund or angel audited (governing role
// INVESTOR), newest first, click to open the portfolio + on-chain track record.
function vcAudits(): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of mergedLog()) {
    if (e.kind !== "person") continue;
    if (!(e.flags ?? []).some((f) => f.toLowerCase() === "role:investor")) continue;
    const k = (e.ref ?? e.query).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function VcCard({ e, onOpen }: { e: LogEntry; onOpen: (ref: string) => void }) {
  const m = e.verdict ? verdictMeta(e.verdict) : null;
  const color = m?.color ?? "var(--color-ink-faint)";
  const img = auditImage(e);
  const me = getAnalyst();
  const letter = (e.query.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
  return (
    <button
      onClick={() => onOpen(e.ref ?? e.query)}
      title="Open the portfolio + track record"
      className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 hover:bg-panel/80 soft-shadow"
    >
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[14px] text-signal">{letter}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[13px] text-ink">{e.query}</span>
        <span className="block truncate text-[10.5px] text-ink-faint">
          {e.summary || "investor / fund"}{e.contributor && e.contributor !== me && e.contributor !== "anonymous" ? ` · ${e.contributor}` : ""}
        </span>
      </span>
      <ScanChip kind={e.kind} refId={e.ref ?? e.query} className="mr-1" />
      <span className="mono shrink-0 text-right leading-none" style={{ color }}>
        <span className="block text-[18px] font-semibold tabular">{e.score ?? "—"}</span>
        <span className="block text-[8px] tracking-wider">{e.verdict ?? ""}</span>
      </span>
    </button>
  );
}

export function VcsPage({ onAudit, onOpenRecent }: { onAudit: (h: string, priv?: boolean) => void; onOpenRecent?: (ref: string) => void }) {
  const [value, setValue] = useState("");
  const [priv, setPriv] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const vcs = vcAudits();
  const open = onOpenRecent ?? onAudit;

  return (
    <>
      <ScoreTicker onOpen={open} label="Recent VCs · click to open the report" filter={(e) => (e.flags ?? []).some((f) => f.toLowerCase() === "role:investor")} />
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.01em] text-ink">VCs &amp; investors</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
        Funds and angels graded on their scoreboard: the portfolio they actually backed, and how each bet ended.
        Every token investment is priced on-chain, so a prolific fund with a graveyard of dead bets has nowhere to hide.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onAudit(value.trim(), priv); }}
        className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-panel p-2.5 soft-shadow transition focus-within:border-line-2"
      >
        <span className="mono pl-2 text-[14px] text-ink-faint select-none">@</span>
        <input
          value={value}
          onChange={(ev) => setValue(ev.target.value.replace(/^@/, ""))}
          placeholder="audit a VC or fund by handle (e.g. paradigm)"
          className="mono min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <PrivateToggle on={priv} onToggle={setPriv} />
        <button type="submit" className="btn-primary px-3.5 py-1.5 text-[13px] font-medium">Grade the fund</button>
      </form>

      <div className="mt-7 mb-2.5 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
        {vcs.length ? `${vcs.length} investor${vcs.length === 1 ? "" : "s"} audited` : "No investors audited yet"}
      </div>
      {vcs.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {vcs.map((e) => <VcCard key={e.id} e={e} onOpen={open} />)}
        </div>
      ) : (
        <p className="text-[13px] text-ink-faint">
          Audit a fund or investor above. Anyone whose audit lands with Investor as the governing role shows up here,
          with their portfolio and on-chain track record on the report.
        </p>
      )}
    </div>
    </>
  );
}
