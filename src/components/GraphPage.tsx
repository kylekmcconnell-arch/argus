import { useEffect, useMemo, useState } from "react";
import { SUBJECTS, buildReport } from "../data/subjects";
import { TrustGraph } from "./TrustGraph";
import { NetworkGraph } from "./NetworkGraph";
import { buildNetwork, canonical } from "../graph/network";
import { getContributions, clearContributions, subscribeGraph } from "../graph/store";
import { verdictMeta } from "../lib/verdict";
import { mergedLog, subscribeLog, type LogEntry } from "../lib/auditlog";

// Role categories for the graph, derived from the audit log's role flags: the
// same taxonomy as the sidebar directories (Founders / Projects / KOLs / VCs).
const CATEGORIES = [
  { key: "FOUNDER", label: "Founders" },
  { key: "PROJECT", label: "Projects" },
  { key: "KOL", label: "KOLs" },
  { key: "INVESTOR", label: "VCs" },
] as const;

function roleBuckets(): Map<string, LogEntry[]> {
  const buckets = new Map<string, LogEntry[]>();
  const seen = new Set<string>();
  for (const e of mergedLog()) {
    if (e.kind !== "person") continue;
    const id = canonical(e.ref ?? e.query);
    if (!id || seen.has(id)) continue; // newest audit of a subject wins
    seen.add(id);
    for (const f of e.flags ?? []) {
      const m = f.match(/^role:(\w+)$/i);
      if (!m) continue;
      const role = m[1].toUpperCase();
      (buckets.get(role) ?? buckets.set(role, []).get(role)!).push(e);
    }
  }
  return buckets;
}

// Panoptes: the same audits, two ways. "Network" merges every audit into one
// graph so shared entities, serial actors and cabals surface. "By subject" is
// the per-subject star map.
export function GraphPage({ onOpen }: { onOpen: (handle: string) => void }) {
  const dossiers = useMemo(() => SUBJECTS.map((s) => ({ s, d: buildReport(s) })), []);
  const [includeMine, setIncludeMine] = useState(true);
  const [mine, setMine] = useState(() => getContributions());
  // Refresh when the community graph hydrates or a new audit is recorded.
  useEffect(() => subscribeGraph(() => setMine(getContributions())), []);
  const net = useMemo(
    () => buildNetwork(dossiers.map(({ s, d }) => ({ handle: s.handle, d })), includeMine ? mine : []),
    [dossiers, includeMine, mine],
  );
  const [mode, setMode] = useState<"network" | "subject">("network");
  // Role categories (Founders / Projects / KOLs / VCs) from the audit log.
  const [logTick, setLogTick] = useState(0);
  useEffect(() => subscribeLog(() => setLogTick((t) => t + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buckets = useMemo(() => roleBuckets(), [logTick]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const highlight = useMemo(() => {
    if (!activeCat) return null;
    const ids = new Set<string>();
    for (const e of buckets.get(activeCat) ?? []) ids.add(canonical(e.ref ?? e.query));
    return ids;
  }, [activeCat, buckets]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Trust graph</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-ink-dim">
            Every audit is a star map on its own. Merged, they compound: an entity in two investigations
            becomes a bridge, a wallet tied to several rugs becomes a serial actor, and a cluster of flagged
            subjects sharing one hidden hub becomes a cabal. None of that shows in a single report.
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-line bg-panel p-0.5 text-[12px]">
          {(["network", "subject"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`mono rounded-md px-2.5 py-1 transition ${mode === m ? "bg-panel-2 text-ink soft-shadow" : "text-ink-dim hover:text-ink"}`}
            >
              {m === "network" ? "Network" : "By subject"}
            </button>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-faint">
        {[
          ["var(--color-signal)", "subject"],
          ["var(--color-pass)", "exit / acknowledged"],
          ["var(--color-avoid)", "rug / contradicted"],
          ["var(--color-unverifiable)", "bridge (shared across audits)"],
          ["var(--color-caution)", "serial actor"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>

      {mode === "network" ? (
        <>
          {/* role-category filter: spotlight one slice of the taxonomy in the graph */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCat(null)}
              className={`mono rounded-full border px-2.5 py-1 text-[11.5px] transition ${!activeCat ? "border-signal text-signal" : "border-line text-ink-dim hover:text-ink"}`}
            >
              All
            </button>
            {CATEGORIES.map((c) => {
              const n = (buckets.get(c.key) ?? []).length;
              if (!n) return null;
              const active = activeCat === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setActiveCat(active ? null : c.key)}
                  className={`mono rounded-full border px-2.5 py-1 text-[11.5px] transition ${active ? "border-signal text-signal" : "border-line text-ink-dim hover:text-ink"}`}
                >
                  {c.label} <span className="text-ink-faint">{n}</span>
                </button>
              );
            })}
          </div>

          {mine.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5 text-ink-dim">
                <input type="checkbox" checked={includeMine} onChange={(e) => setIncludeMine(e.target.checked)} className="accent-[var(--color-signal)]" />
                include your audits
              </label>
              <span className="mono text-ink-faint">{mine.length} recorded from token & site audits</span>
              <button
                onClick={() => { clearContributions(); setMine([]); }}
                className="mono ml-auto rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-faint transition hover:text-ink"
              >
                clear your audits
              </button>
            </div>
          )}
          <div className="mt-3">
            <NetworkGraph net={net} onOpenSubject={onOpen} highlight={highlight} />
          </div>

          {/* the taxonomy, as sections: who's building / shipping / promoting / funding */}
          {CATEGORIES.some((c) => (buckets.get(c.key) ?? []).length > 0) && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {CATEGORIES.map((c) => {
                const list = buckets.get(c.key) ?? [];
                return (
                  <div key={c.key} className="rounded-xl border border-line bg-panel p-3.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] font-semibold text-ink">{c.label}</span>
                      <span className="mono text-[10.5px] text-ink-faint">{list.length}</span>
                    </div>
                    {list.length ? (
                      <div className="mt-2 space-y-1">
                        {list.slice(0, 8).map((e) => {
                          const m = e.verdict ? verdictMeta(e.verdict) : null;
                          return (
                            <button
                              key={e.id}
                              onClick={() => onOpen(e.ref ?? e.query)}
                              className="group flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-panel-2"
                            >
                              <span className="mono truncate text-[11.5px] text-ink-dim group-hover:text-ink">{e.query}</span>
                              <span className="mono shrink-0 text-[11px] tabular" style={{ color: m?.color ?? "var(--color-ink-faint)" }}>{e.score ?? "—"}</span>
                            </button>
                          );
                        })}
                        {list.length > 8 && <div className="mono px-1.5 text-[10px] text-ink-faint">+{list.length - 8} more</div>}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-ink-faint">None audited yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* cross-audit intelligence */}
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <Cabals net={net} />
            <Intel
              title="Bridge entities"
              subtitle="Appear in more than one audit"
              items={net.bridges.map((b) => ({ key: b.key, detail: `${b.subjects.length} audits` }))}
              empty="No shared entities across audits yet."
              tone="var(--color-unverifiable)"
            />
            <Intel
              title="Serial actors"
              subtitle="Wired into multiple failed subjects or rugs"
              items={net.serialActors.map((s) => ({ key: s.key, detail: `${s.rugLinks} bad links` }))}
              empty="No serial actors detected."
              tone="var(--color-caution)"
            />
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
            This demo unifies four worked audits. In production the graph is persistent: every new audit writes
            its entities back, so the next investigation inherits everything already known. The graph gets
            sharper with use, the cost of a clean front does not.
          </p>
        </>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {dossiers.map(({ s, d }) => {
            const m = verdictMeta(d.report.composite_verdict);
            return (
              <button
                key={s.handle}
                onClick={() => onOpen(s.handle)}
                className="group rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 hover:shadow-sm"
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
      )}
    </div>
  );
}

function Cabals({ net }: { net: ReturnType<typeof buildNetwork> }) {
  const cabal = net.cabals[0];
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-avoid)", background: "rgba(220,38,38,0.04)" }}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: "var(--color-avoid)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-avoid)" }} />
        Cabal detected
      </div>
      {cabal ? (
        <>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            {cabal.subjects.join(", ")} are independently flagged, but they are not independent: they share{" "}
            {cabal.via.length} connecting {cabal.via.length === 1 ? "entity" : "entities"}.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cabal.via.map((v) => (
              <span key={v.id} className="mono rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] text-ink-dim">
                {v.key}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-[12.5px] text-ink-faint">No connected cluster across the audited subjects.</p>
      )}
    </div>
  );
}

function Intel({
  title, subtitle, items, empty, tone,
}: {
  title: string; subtitle: string; items: { key: string; detail: string }[]; empty: string; tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
        {title}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</div>
      {items.length ? (
        <div className="mt-2.5 space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between gap-2">
              <span className="mono truncate text-[12px] text-ink-dim">{it.key}</span>
              <span className="mono shrink-0 text-[10.5px] text-ink-faint">{it.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-ink-faint">{empty}</p>
      )}
    </div>
  );
}
