import { useEffect, useState } from "react";
import { mergedLog, subscribeLog, type LogEntry } from "../lib/auditlog";
import { verdictMeta } from "../lib/verdict";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";

// The Founders & projects directory: individuals who build (FOUNDER) and the
// project/protocol brand accounts themselves (PROJECT), newest first — the
// "who's building" counterpart to the KOLs "who's promoting" page.
const BUILDER = new Set(["role:founder", "role:project"]);
function builderAudits(): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of mergedLog()) {
    if (e.kind !== "person") continue;
    if (!(e.flags ?? []).some((f) => BUILDER.has(f.toLowerCase()))) continue;
    const k = (e.ref ?? e.query).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
const isProject = (e: LogEntry) => (e.flags ?? []).some((f) => f.toLowerCase() === "role:project");

function BuilderCard({ e, onOpen }: { e: LogEntry; onOpen: (ref: string) => void }) {
  const m = e.verdict ? verdictMeta(e.verdict) : null;
  const color = m?.color ?? "var(--color-ink-faint)";
  const img = auditImage(e);
  const me = getAnalyst();
  const letter = (e.query.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
  return (
    <button
      onClick={() => onOpen(e.ref ?? e.query)}
      title="Open the report"
      className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 hover:bg-panel/80 soft-shadow"
    >
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[14px] text-signal">{letter}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="mono flex items-center gap-1.5 truncate text-[13px] text-ink">
          {e.query}
          <span className="rounded border border-line px-1 py-0.5 text-[8.5px] uppercase tracking-wide text-ink-faint">{isProject(e) ? "project" : "founder"}</span>
        </span>
        <span className="block truncate text-[10.5px] text-ink-faint">
          {e.summary || (isProject(e) ? "project / protocol" : "founder")}{e.contributor && e.contributor !== me && e.contributor !== "anonymous" ? ` · ${e.contributor}` : ""}
        </span>
      </span>
      <span className="mono shrink-0 text-right leading-none" style={{ color }}>
        <span className="block text-[18px] font-semibold tabular">{e.score ?? "—"}</span>
        <span className="block text-[8px] tracking-wider">{e.verdict ?? ""}</span>
      </span>
    </button>
  );
}

export function FoundersPage({ onAudit, onOpenRecent }: { onAudit: (h: string) => void; onOpenRecent?: (ref: string) => void }) {
  const [value, setValue] = useState("");
  const [, setTick] = useState(0);
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const builders = builderAudits();
  const open = onOpenRecent ?? onAudit;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.01em] text-ink">Founders &amp; projects</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
        The people who build and the project accounts they build under, graded on track record, product substance,
        backing, and how their ventures actually ended. Audit a handle or a project to add it.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onAudit(value.trim()); }}
        className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-panel p-2.5 soft-shadow transition focus-within:border-line-2"
      >
        <span className="mono pl-2 text-[14px] text-ink-faint select-none">@</span>
        <input
          value={value}
          onChange={(ev) => setValue(ev.target.value.replace(/^@/, ""))}
          placeholder="audit a founder or project by handle (e.g. VulcanForged)"
          className="mono min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button type="submit" className="btn-primary px-3.5 py-1.5 text-[13px] font-medium">Run audit</button>
      </form>

      <div className="mt-7 mb-2.5 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
        {builders.length ? `${builders.length} founder${builders.length === 1 ? "" : "s"} & project${builders.length === 1 ? "" : "s"}` : "None audited yet"}
      </div>
      {builders.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {builders.map((e) => <BuilderCard key={e.id} e={e} onOpen={open} />)}
        </div>
      ) : (
        <p className="text-[13px] text-ink-faint">
          Audit a founder or a project above. Anyone whose audit lands with Founder or Project as the governing role
          shows up here automatically.
        </p>
      )}
    </div>
  );
}
