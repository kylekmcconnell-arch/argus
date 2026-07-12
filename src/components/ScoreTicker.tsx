import { useEffect, useState, type CSSProperties } from "react";
import { verdictMeta } from "../lib/verdict";
import { auditReadinessLabel, presentedAuditVerdict, subscribeLog, type LogEntry } from "../lib/auditlog";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";
import { recentScored } from "../lib/recentScored";
import type { ReportKind } from "../lib/reports";
import { recentReportHref } from "../lib/recentReportRoute";

// A clickable score card → opens the full report (persisted, no re-run).
function ScoreCard({ e, onOpen }: { e: LogEntry; onOpen: (ref: string, kind?: ReportKind) => void }) {
  const presentedVerdict = presentedAuditVerdict(e);
  const presentedLabel = auditReadinessLabel(e);
  const m = presentedVerdict ? verdictMeta(presentedVerdict) : null;
  const color = m?.color ?? "var(--color-ink-faint)";
  const letter = (e.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
  const img = auditImage(e);
  const me = getAnalyst();
  const ref = e.ref ?? e.query;
  const kind = e.flags?.some((flag) => flag.toLowerCase() === "investigation")
    ? "investigation"
    : e.kind;
  return (
    <a
      href={recentReportHref(ref, kind)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(ref, kind);
      }}
      title={presentedVerdict === "INCOMPLETE" ? "Open the report — positive score is not cleared because evidence coverage is incomplete" : "Open the full report"}
      aria-label={`Open stored ${e.kind} case for ${e.query}${typeof e.score === "number" ? `, score ${e.score}` : ""}`}
      className="group panel flex w-[240px] shrink-0 items-center gap-2.5 p-2.5 text-left transition hover:border-line-2 hover:bg-panel/80"
    >
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-md border border-line bg-panel-2 object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[13.5px] text-signal">{letter}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[12.5px] text-ink">{e.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {e.kind}{e.contributor && e.contributor !== me && e.contributor !== "anonymous" ? ` · ${e.contributor}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 leading-none">
        <span className="mono tint-var rounded px-1.5 py-1 text-[15px] font-semibold tabular" style={{ "--tint": color } as CSSProperties}>{e.score ?? "—"}</span>
        {presentedLabel && <span className="chip tint-var" style={{ ["--tint" as string]: color }}>{presentedLabel}</span>}
      </span>
    </a>
  );
}

// A contextual stored-case strip for directory pages. Home relies on the
// persistent Recent cases rail so this secondary path never competes with the
// primary investigation input.
export function ScoreTicker({
  onOpen,
  filter,
  label = "Recent cases · open a frozen snapshot",
  max = 12,
}: {
  onOpen: (ref: string, kind?: ReportKind) => void;
  filter?: (e: LogEntry) => boolean;
  label?: string;
  max?: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const scores = recentScored(max, filter);
  if (scores.length === 0) return null;

  return (
    <section aria-label={label} className="relative z-10 border-b border-line/60 bg-sidebar/30 px-5 py-3">
      <div className="mx-auto max-w-5xl">
        <div className="eyebrow mb-2">{label}</div>
        {scores.length >= 5 ? (
          // Two identical copies, each with a trailing gap, make the -50% loop seamless.
          <div className="overflow-hidden pb-1" style={{ maskImage: "linear-gradient(90deg, transparent, black 3%, black 97%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 3%, black 97%, transparent)" }}>
            <div className="scores-marquee flex w-max" style={{ ["--marquee-dur" as string]: `${scores.length * 7}s` }}>
              <div className="flex gap-2.5 pr-2.5">
                {scores.map((e) => <ScoreCard key={e.id} e={e} onOpen={onOpen} />)}
              </div>
              <div className="flex gap-2.5 pr-2.5" aria-hidden inert>
                {scores.map((e) => <ScoreCard key={`dup-${e.id}`} e={e} onOpen={onOpen} />)}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto thin-scroll pb-1">
            {scores.map((e) => <ScoreCard key={e.id} e={e} onOpen={onOpen} />)}
          </div>
        )}
      </div>
    </section>
  );
}
