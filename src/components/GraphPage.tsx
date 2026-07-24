import { useEffect, useMemo, useState } from "react";
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
  const [mine, setMine] = useState(() => getContributions());
  // Refresh when the community graph hydrates or a new audit is recorded.
  useEffect(() => subscribeGraph(() => setMine(getContributions())), []);
  // Built entirely from REAL audits (yours + the shared community graph).
  const net = useMemo(() => buildNetwork([], mine), [mine]);
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
          <h1 className="display-sm text-[24px] text-ink">Connections</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
            See people, projects, and wallets that appear in more than one report. Repeated links can reveal
            the same operator or funding source behind several projects. A connection is a lead to review,
            not proof that two subjects are controlled by the same person.
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-line bg-panel p-1" role="group" aria-label="Connections view">
          {(["network", "subject"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`mono rounded-md px-3 py-1.5 text-[11px] transition ${mode === m ? "tint-signal" : "text-ink-faint hover:text-ink-dim"}`}
            >
              {m === "network" ? "Network" : "By subject"}
            </button>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-faint">
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
              aria-pressed={!activeCat}
              className={`mono rounded-md border px-2.5 py-1 text-[11px] transition ${!activeCat ? "tint-signal" : "border-line text-ink-dim hover:text-ink"}`}
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
                  aria-pressed={active}
                  className={`mono rounded-md border px-2.5 py-1 text-[11px] transition ${active ? "tint-signal" : "border-line text-ink-dim hover:text-ink"}`}
                >
                  {c.label} <span className="text-ink-faint">{n}</span>
                </button>
              );
            })}
          </div>

          {mine.length > 0 && (
            <div className="panel mt-3 flex flex-wrap items-center gap-3 px-3 py-2 text-[12.5px]">
              <span className="mono text-ink-faint">{mine.length} audited subject{mine.length === 1 ? "" : "s"} in the graph (yours + shared)</span>
              <button
                onClick={() => { clearContributions(); setMine([]); }}
                className="btn-chip ml-auto"
              >
                clear local cache
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
                  <div key={c.key} className="panel p-3.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] font-semibold text-ink">{c.label}</span>
                      <span className="mono text-[11px] text-ink-faint">{list.length}</span>
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
                              <span className="mono truncate text-[11px] text-ink-dim group-hover:text-ink">{e.query}</span>
                              <span className="mono shrink-0 text-[11px] tabular" style={{ color: m?.color ?? "var(--color-ink-faint)" }}>{e.score ?? "N/A"}</span>
                            </button>
                          );
                        })}
                        {list.length > 8 && <div className="mono px-1.5 text-[11px] text-ink-faint">+{list.length - 8} more</div>}
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
              subtitle="The same real entity surfacing in more than one audit"
              items={net.bridges.slice(0, 12).map((b) => ({ key: b.key, detail: `${b.subjects.length} audits · ${/^holder:/i.test(b.key) ? "top holder" : b.type.toLowerCase()}` }))}
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

          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-faint">
            The graph is persistent and shared: every audit (yours and your co-analysts') writes its entities
            back, so the next investigation inherits everything already known. The graph gets sharper with use,
            the cost of a clean front does not.
          </p>
        </>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {mine.length === 0 && (
            <p className="empty-state lg:col-span-2">No audited subjects yet. Run an audit and its star map lands here.</p>
          )}
          {mine.map((c) => {
            const m = verdictMeta(c.verdict ?? "INCOMPLETE");
            return (
              <div
                key={c.handle}
                className="panel p-3 soft-shadow"
              >
                <div className="mb-1 flex items-center gap-2 px-1">
                  <button
                    onClick={() => onOpen(c.handle)}
                    className="mono text-[12.5px] text-ink underline-offset-2 hover:text-signal-lift hover:underline"
                  >
                    {c.handle}
                  </button>
                  <span
                    className={`verdict-pill ml-auto ${c.verdict === "FAIL" ? "tint-fail" : "tint-var"}`}
                    style={c.verdict === "FAIL" ? undefined : ({ "--tint": m.color } as React.CSSProperties)}
                  >
                    {m.label}
                  </span>
                </div>
                <TrustGraph nodes={c.nodes} edges={c.edges} onAudit={onOpen} onOpenProject={onOpen} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cabals({ net }: { net: ReturnType<typeof buildNetwork> }) {
  const cabals = net.cabals.slice(0, 2);
  const strong = cabals.some((c) => !c.holderOnly);
  const color = strong ? "var(--color-avoid)" : "var(--color-caution)";
  return (
    <div className={`panel p-4 ${cabals.length ? "tint-var" : ""}`} style={cabals.length ? ({ "--tint": color } as React.CSSProperties) : undefined}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: cabals.length ? color : "var(--color-ink)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: cabals.length ? color : "var(--color-line-2)" }} />
        {cabals.length ? `Linked cluster${cabals.length > 1 ? "s" : ""} detected` : "Cabal detection"}
      </div>
      {cabals.length ? (
        cabals.map((cabal, ci) => (
          <div key={ci} className={ci > 0 ? "mt-3 border-t border-line/60 pt-3" : ""}>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
              <span className="text-ink">{cabal.subjects.join(", ")}</span> share{" "}
              {cabal.via.length} real connecting {cabal.via.length === 1 ? "entity" : "entities"}
              {cabal.holderOnly ? ". All top-holder overlap can reflect exchanges or market makers rather than coordination" : ". Shared people, companies, or wallets are hard to explain innocently"}.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cabal.via.slice(0, 10).map((v) => (
                <span key={v.id} className="mono rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] text-ink-dim" title={v.type}>
                  {v.key}
                </span>
              ))}
              {cabal.via.length > 10 && <span className="text-[11px] text-ink-faint">+{cabal.via.length - 10} more</span>}
            </div>
          </div>
        ))
      ) : (
        <p className="mt-2 text-[12.5px] text-ink-faint">
          No coordinated cluster across the audited subjects. A cabal call requires shared named people, companies, or
          wallets, not just overlapping top-holders.
        </p>
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
    <div className="panel p-4">
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
        {title}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</div>
      {items.length ? (
        <div className="mt-2.5 space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between gap-2">
              <span className="mono truncate text-[12.5px] text-ink-dim">{it.key}</span>
              <span className="mono shrink-0 text-[11px] text-ink-faint">{it.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-ink-faint">{empty}</p>
      )}
    </div>
  );
}
