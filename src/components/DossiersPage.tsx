import { SUBJECTS, buildReport } from "../data/subjects";
import { ROLE_META, verdictMeta, capLabel } from "../lib/verdict";
import type { SubjectClass } from "../engine";

// Gallery of every audited subject. Each card is computed by the real engine.
export function DossiersPage({ onOpen }: { onOpen: (handle: string) => void }) {
  const dossiers = SUBJECTS.map((s) => ({ s, d: buildReport(s) }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Dossiers</h1>
      <p className="mt-1.5 text-[14px] text-ink-dim">
        Every finalized audit. Each verdict is computed live by the engine, governed by the most severe role.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {dossiers.map(({ s, d }) => {
          const m = verdictMeta(d.report.composite_verdict);
          return (
            <button
              key={s.handle}
              onClick={() => onOpen(s.handle)}
              className="group flex flex-col rounded-xl border border-line bg-panel p-4 text-left transition hover:border-line-2 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-2 text-[17px] text-signal">
                  {s.avatar}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-ink">{s.display_name}</span>
                    <span className="mono text-[12px] text-ink-faint">{s.handle}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                    {(d.report.roles as SubjectClass[]).map((r) => ROLE_META[r].label).join(" · ")}
                  </div>
                </div>
                <span
                  className="mono shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wider"
                  style={{ borderColor: m.color, color: m.color, background: m.glow }}
                >
                  {m.label}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-[12.5px] leading-snug text-ink-dim">{s.headline}</p>

              <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[11.5px] text-ink-faint">
                <span>
                  governed by{" "}
                  <span className="text-ink-dim">
                    {d.report.governing_role ? ROLE_META[d.report.governing_role as SubjectClass].label : "—"}
                  </span>
                </span>
                {d.report.cap_applied ? (
                  <span style={{ color: "var(--color-avoid)" }}>▲ {capLabel(d.report.cap_applied)}</span>
                ) : (
                  <span className="mono">
                    score <span className="text-ink-dim">{d.report.governing_score ?? "—"}</span>/100
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
