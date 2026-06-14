import { SUBJECTS, buildReport } from "../data/subjects";
import { TrustGraph } from "./TrustGraph";
import { verdictMeta } from "../lib/verdict";

// Panoptes overview: each audited subject's trust graph, side by side. The graph
// is where credibility either holds together or falls apart on inspection.
export function GraphPage({ onOpen }: { onOpen: (handle: string) => void }) {
  const dossiers = SUBJECTS.map((s) => ({ s, d: buildReport(s) }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Trust graph</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] text-ink-dim">
        The Panoptes graph for every audited subject: who vouches for them, what they founded,
        promoted, or advised, and which of those went to zero. Endorsements nobody acknowledges show
        as faint dangling edges; a rug shows red.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-faint">
        {[
          ["var(--color-signal)", "subject"],
          ["var(--color-pass)", "exit / acknowledged"],
          ["var(--color-avoid)", "rug / contradicted"],
          ["var(--color-line-2)", "unconfirmed"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {dossiers.map(({ s, d }) => {
          const m = verdictMeta(d.report.composite_verdict);
          return (
            <button
              key={s.handle}
              onClick={() => onOpen(s.handle)}
              className="group rounded-xl border border-line bg-white p-3 text-left transition hover:border-line-2 hover:shadow-sm"
            >
              <div className="mb-1 flex items-center gap-2 px-1">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-panel-2 text-[12px] text-signal">
                  {s.avatar}
                </span>
                <span className="mono text-[12.5px] text-ink">{s.handle}</span>
                <span
                  className="mono ml-auto rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tracking-wider"
                  style={{ borderColor: m.color, color: m.color, background: m.glow }}
                >
                  {m.label}
                </span>
              </div>
              <TrustGraph nodes={d.graph.nodes} edges={d.graph.edges} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
