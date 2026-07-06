import { useEffect, useState } from "react";
import { verdictMeta } from "../lib/verdict";
import { mergedLog, subscribeLog, type LogEntry } from "../lib/auditlog";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";

// Most recent audits that carry a score/verdict, one per subject, newest first.
// An optional filter scopes it to a directory (e.g. only Founder-role audits).
export function recentScored(max: number, filter?: (e: LogEntry) => boolean): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of mergedLog()) {
    if (e.score == null && !e.verdict) continue;
    if (filter && !filter(e)) continue;
    const k = `${e.kind}:${(e.ref ?? e.query).toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

// A clickable score card → opens the full report (persisted, no re-run).
function ScoreCard({ e, onOpen }: { e: LogEntry; onOpen: (ref: string) => void }) {
  const m = e.verdict ? verdictMeta(e.verdict) : null;
  const color = m?.color ?? "var(--color-ink-faint)";
  const letter = (e.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
  const img = auditImage(e);
  const me = getAnalyst();
  return (
    <button
      onClick={() => onOpen(e.ref ?? e.query)}
      title="Open the full report"
      className="group flex w-[180px] shrink-0 items-center gap-2.5 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 hover:bg-panel/80 soft-shadow"
    >
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-lg border border-line object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[13px] text-signal">{letter}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[12px] text-ink">{e.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
        <span className="block truncate text-[9.5px] text-ink-faint">
          {e.kind}{e.contributor && e.contributor !== me && e.contributor !== "anonymous" ? ` · ${e.contributor}` : ""}
        </span>
      </span>
      <span className="mono shrink-0 text-right leading-none" style={{ color }}>
        <span className="block text-[19px] font-semibold tabular">{e.score ?? "—"}</span>
        <span className="block text-[8px] tracking-wider">{e.verdict ?? ""}</span>
      </span>
    </button>
  );
}

// The recent-scores strip: a full-width top bar with an auto-rotating marquee
// (pauses on hover) once there are enough cards, else a plain scroll row. Renders
// nothing when there's nothing scored to show. Shared by Home and every directory.
export function ScoreTicker({
  onOpen,
  filter,
  label = "Recent scores · click to open the report",
  max = 12,
}: {
  onOpen: (ref: string) => void;
  filter?: (e: LogEntry) => boolean;
  label?: string;
  max?: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const scores = recentScored(max, filter);
  if (scores.length === 0) return null;

  return (
    <div className="relative z-10 border-b border-line/60 px-6 py-3.5">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">{label}</div>
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
    </div>
  );
}
