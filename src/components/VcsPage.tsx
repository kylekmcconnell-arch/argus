import { useEffect, useState } from "react";
import type { ReportKind } from "../lib/reports";
import { ScanChip } from "./ScanChip";
import { auditReadinessLabel, mergedLog, presentedAuditVerdict, subscribeLog, type LogEntry } from "../lib/auditlog";
import { verdictMeta } from "../lib/verdict";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { DirectoryInvestigationForm } from "./DirectoryInvestigationForm";

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
      title="Open the portfolio + track record"
      className="panel group flex items-center gap-3 p-3 text-left transition hover:border-line-2 hover:bg-panel/80 soft-shadow"
    >
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-md border border-line object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[13.5px] text-signal-lift">{letter}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[13.5px] text-ink">{e.query}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {e.summary || "investor / fund"}{e.contributor && e.contributor !== me && e.contributor !== "anonymous" ? ` · ${e.contributor}` : ""}
        </span>
      </span>
      <ScanChip kind={e.kind} refId={e.ref ?? e.query} className="mr-1" />
      <span className="flex shrink-0 flex-col items-end gap-1 leading-none">
        <span className="mono text-[18px] font-semibold tabular" style={{ color }}>{e.score ?? "N/A"}</span>
        {readiness && <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}>{readiness}</span>}
      </span>
    </button>
  );
}

export function VcsPage({ onAudit, onOpenRecent }: { onAudit: (h: string, priv?: boolean) => void; onOpenRecent?: (ref: string, kind?: ReportKind) => void }) {
  const [value, setValue] = useState("");
  const [priv, setPriv] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const vcs = vcAudits();
  const open = (ref: string, kind?: ReportKind) => onOpenRecent ? onOpenRecent(ref, kind) : onAudit(ref);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <WorkspacePageHeader
        eyebrow="Capital intelligence"
        title="VCs &amp; investors"
        description={<>Investigate funds and angels by the portfolio they actually backed, how those bets ended, and whether claimed scale and attribution survive evidence review.</>}
        meta={<span className="chip tint-neutral">{vcs.length} investigated</span>}
      />

      <DirectoryInvestigationForm
        value={value}
        onValueChange={setValue}
        privateMode={priv}
        onPrivateModeChange={setPriv}
        label="Investigate a fund or investor"
        placeholder="X handle, e.g. paradigm"
        actionLabel="Analyze track record"
        onSubmit={() => onAudit(value.trim(), priv)}
      />

      <div className="eyebrow mt-7 mb-2.5">
        {vcs.length ? `${vcs.length} investor${vcs.length === 1 ? "" : "s"} audited` : "No investors audited yet"}
      </div>
      {vcs.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {vcs.map((e) => <VcCard key={e.id} e={e} onOpen={open} />)}
        </div>
      ) : (
        <p className="empty-state">
          Audit a fund or investor above. Anyone whose audit lands with Investor as the governing role shows up here,
          with their portfolio and on-chain track record on the report.
        </p>
      )}
    </div>
  );
}
