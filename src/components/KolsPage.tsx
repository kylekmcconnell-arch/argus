import { useEffect, useState } from "react";
import { ScoreTicker } from "./ScoreTicker";
import type { ReportKind } from "../lib/reports";
import { PrivateToggle } from "./PrivateToggle";
import { ScanChip } from "./ScanChip";
import { auditReadinessLabel, mergedLog, presentedAuditVerdict, subscribeLog, type LogEntry } from "../lib/auditlog";
import { verdictMeta } from "../lib/verdict";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";

// The KOL directory: every promoter/caller that's been audited (governing role
// KOL), newest first, click to open their report — where the shill-timing
// timelines and reach-authenticity live. Plus a box to grade a new handle.
function kolAudits(): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of mergedLog()) {
    if (e.kind !== "person") continue;
    if (!(e.flags ?? []).some((f) => f.toLowerCase() === "role:kol")) continue;
    const k = (e.ref ?? e.query).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function KolCard({ e, onOpen }: { e: LogEntry; onOpen: (ref: string) => void }) {
  const displayedVerdict = presentedAuditVerdict(e);
  const m = displayedVerdict ? verdictMeta(displayedVerdict) : null;
  const color = m?.color ?? "var(--color-ink-faint)";
  const readiness = auditReadinessLabel(e);
  const img = auditImage(e);
  const me = getAnalyst();
  const letter = (e.query.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
  return (
    <button
      onClick={() => onOpen(e.ref ?? e.query)}
      title="Open the KOL report"
      className="panel group flex items-center gap-3 p-3 text-left transition hover:border-line-2 hover:bg-panel/80 soft-shadow"
    >
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-md border border-line object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[13.5px] text-signal">{letter}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[13.5px] text-ink">{e.query}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {e.summary || "KOL / promoter"}{e.contributor && e.contributor !== me && e.contributor !== "anonymous" ? ` · ${e.contributor}` : ""}
        </span>
      </span>
      <ScanChip kind={e.kind} refId={e.ref ?? e.query} className="mr-1" />
      <span className="flex shrink-0 flex-col items-end gap-1 leading-none">
        <span className="mono text-[18px] font-semibold tabular" style={{ color }}>{e.score ?? "—"}</span>
        {readiness && <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}>{readiness}</span>}
      </span>
    </button>
  );
}

export function KolsPage({ onAudit, onOpenRecent }: { onAudit: (h: string, priv?: boolean) => void; onOpenRecent?: (ref: string, kind?: ReportKind) => void }) {
  const [value, setValue] = useState("");
  const [priv, setPriv] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const kols = kolAudits();
  const open = (ref: string, kind?: ReportKind) => onOpenRecent ? onOpenRecent(ref, kind) : onAudit(ref);

  return (
    <>
      <ScoreTicker onOpen={open} label="Recent KOLs · click to open the report" filter={(e) => (e.flags ?? []).some((f) => f.toLowerCase() === "role:kol")} />
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="display-sm text-[24px] text-ink">KOLs</h1>
      <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
        Promoters and callers graded on the only things that matter for a KOL: how the tokens they shilled actually
        performed after the call, and whether their reach is real or bought. Audit a handle to build its call record.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onAudit(value.trim(), priv); }}
        className="panel mt-5 flex items-center gap-2 p-2.5 soft-shadow transition focus-within:border-line-2"
      >
        <span className="mono pl-2 text-[13.5px] text-ink-faint select-none">@</span>
        <input
          value={value}
          onChange={(ev) => setValue(ev.target.value.replace(/^@/, ""))}
          placeholder="grade a KOL by handle (e.g. CryptoGemsCom)"
          className="mono min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <PrivateToggle on={priv} onToggle={setPriv} />
        <button type="submit" className="btn-primary px-3.5 py-1.5 text-[13.5px] font-medium">Grade calls</button>
      </form>

      <div className="eyebrow mt-7 mb-2.5">
        {kols.length ? `${kols.length} KOL${kols.length === 1 ? "" : "s"} audited` : "No KOLs audited yet"}
      </div>
      {kols.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {kols.map((e) => <KolCard key={e.id} e={e} onOpen={open} />)}
        </div>
      ) : (
        <p className="empty-state">
          Audit a promoter above. Anyone whose audit lands with KOL as the governing role shows up here automatically,
          with their shilled-token performance and reach authenticity on the report.
        </p>
      )}
    </div>
    </>
  );
}
