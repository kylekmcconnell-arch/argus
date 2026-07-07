import { useState } from "react";
import { getLog, clearLog, logStats, mergedLog, applyRoles, type LogEntry } from "../lib/auditlog";
import { purgeSubject } from "../lib/purge";
import { verdictMeta } from "../lib/verdict";
import { PendingEdits } from "./PendingEdits";

// Re-file every audited person under the CURRENT role taxonomy without
// rerunning a single audit: batch the stored summaries through /api/reclassify
// (one fast LLM call), then rewrite the role flags locally + in the shared log.
async function recategorizeAll(): Promise<{ updated: number; total: number } | { error: string }> {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^[@$]/, "");
  const seen = new Set<string>();
  const subjects: { ref: string; query: string; summary: string; roles: string[] }[] = [];
  for (const e of mergedLog()) {
    if (e.kind !== "person") continue;
    const ref = e.ref ?? e.query;
    const k = norm(ref);
    if (!k || seen.has(k)) continue; // newest audit of each subject speaks for it
    seen.add(k);
    subjects.push({
      ref,
      query: e.query,
      summary: e.summary ?? "",
      roles: (e.flags ?? []).filter((f) => /^role:/i.test(f)).map((f) => f.slice(5)),
    });
  }
  if (!subjects.length) return { updated: 0, total: 0 };
  try {
    const r = await fetch("/api/reclassify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjects }),
    });
    const d = await r.json();
    const results: { ref: string; roles: string[] }[] = d?.results ?? [];
    if (!results.length) return { error: d?.error ?? "no results" };
    for (const res of results) applyRoles(res.ref, res.roles);
    return { updated: results.length, total: subjects.length };
  } catch (e) {
    return { error: String(e) };
  }
}

const KIND_META: Record<string, { label: string; color: string }> = {
  site: { label: "site", color: "var(--color-unverifiable)" },
  token: { label: "token", color: "var(--color-signal)" },
  person: { label: "person", color: "var(--color-caution)" },
};

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function verdictColor(e: LogEntry): string {
  if (e.kind === "site" && (e.coverage === "gap" || !e.verdict)) return "var(--color-unverifiable)";
  return verdictMeta(e.verdict ?? "INCOMPLETE").color;
}

export function AdminPage({ onAudit }: { onAudit?: (q: string) => void }) {
  const [log, setLog] = useState<LogEntry[]>(() => getLog());
  const [filter, setFilter] = useState<"all" | "site" | "token" | "person" | "gaps">("all");
  const [recat, setRecat] = useState<"idle" | "running" | string>("idle");
  const stats = logStats(log);

  const onRecategorize = async () => {
    setRecat("running");
    const r = await recategorizeAll();
    setRecat("error" in r ? `failed: ${r.error}` : `re-filed ${r.updated}/${r.total} subjects`);
    setLog(getLog());
  };

  const shown = log.filter((e) =>
    filter === "all" ? true : filter === "gaps" ? (e.coverage === "gap" || e.flags?.some((f) => /gap/i.test(f))) : e.kind === filter,
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] text-ink">Audit log</h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-dim">
            Every query that runs through ARGUS, with the verdict it returned and where coverage fell short. Your
            own record to check the engine against — and the seed of the data asset: a growing, queryable history
            of who and what has been audited.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onRecategorize}
            disabled={recat === "running"}
            title="Re-file every audited person under the current role taxonomy (Founder / Project / KOL / VC) from their stored summaries — no audits are rerun, scores stay"
            className="mono shrink-0 rounded-lg border px-3 py-1.5 text-[12px] transition disabled:opacity-60"
            style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}
          >
            {recat === "running" ? "recategorizing…" : "recategorize roles"}
          </button>
          {recat !== "idle" && recat !== "running" && <span className="text-[11px] text-ink-faint">{recat}</span>}
          {log.length > 0 && (
            <button
              onClick={() => { clearLog(); setLog([]); }}
              className="mono shrink-0 rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-dim transition hover:border-line-2 hover:text-ink"
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* analyst edits awaiting approval */}
      <div className="mt-5"><PendingEdits /></div>

      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total audits" value={stats.total} />
        <Stat label="Tokens" value={stats.byKind.token} />
        <Stat label="People / sites" value={stats.byKind.person + stats.byKind.site} />
        <Stat label="Coverage gaps" value={stats.gaps} tone="var(--color-unverifiable)" />
      </div>

      {/* filters */}
      <div className="mt-5 flex flex-wrap gap-1.5 text-[12px]">
        {(["all", "token", "site", "person", "gaps"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`mono rounded-md border px-2.5 py-1 transition ${filter === f ? "border-line-2 bg-panel-2 text-ink" : "border-line bg-panel text-ink-dim hover:text-ink"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* log */}
      {shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-panel/50 p-10 text-center text-[13px] text-ink-faint">
          {log.length === 0 ? "No audits yet. Run a token, a handle, or a site recon and it will appear here." : "Nothing matches this filter."}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          {shown.map((e) => {
            const currentRole = (e.flags ?? []).find((f) => /^role:/i.test(f))?.slice(5).toUpperCase() ?? "";
            return (
            // div (not button) so a real <select> can nest without invalid HTML
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => onAudit?.(e.query)}
              onKeyDown={(ev) => { if (ev.key === "Enter") onAudit?.(e.query); }}
              className="flex w-full cursor-pointer items-start gap-3 border-b border-line px-4 py-3 text-left transition last:border-0 hover:bg-panel/40"
            >
              <span className="mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase" style={{ color: KIND_META[e.kind].color, background: KIND_META[e.kind].color + "14" }}>
                {KIND_META[e.kind].label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{e.query}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-faint">{e.summary}</span>
                {e.flags && e.flags.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {e.flags.map((f) => (
                      <span key={f} className="mono rounded bg-panel-2 px-1 py-0.5 text-[9.5px] text-ink-faint">{f}</span>
                    ))}
                  </span>
                )}
              </span>
              {/* manual role override — the analyst overrides a thin-evidence
                  misclassification without a rescan (writes local + shared log) */}
              {e.kind === "person" && (
                <select
                  value={currentRole || "MEMBER"}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={(ev) => { ev.stopPropagation(); applyRoles(e.ref ?? e.query, [ev.target.value]); setLog(getLog()); }}
                  title="Set this subject's role (files it on the right category page). Overrides the auto-classification."
                  className="mono mt-0.5 shrink-0 cursor-pointer rounded-md border border-line bg-panel px-1 py-0.5 text-[10px] text-ink-dim transition hover:border-line-2 hover:text-ink focus:outline-none"
                >
                  {["FOUNDER", "PROJECT", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"].map((r) => (
                    <option key={r} value={r}>{r === "INVESTOR" ? "VC" : r.charAt(0) + r.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              )}
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="mono text-[11px] font-semibold uppercase" style={{ color: verdictColor(e) }}>
                  {e.verdict}{typeof e.score === "number" ? ` ${e.score}` : ""}
                </span>
                <span className="mono text-[10px] text-ink-faint">{ago(e.ts)}</span>
              </span>
              {/* span, not <button> — this whole row is already a button */}
              <span
                role="button"
                tabIndex={0}
                title="Remove this subject everywhere: audit log (yours + shared), stored report, trust graph — a fresh audit starts from scratch"
                onClick={(ev) => {
                  ev.stopPropagation();
                  ev.preventDefault();
                  const ref = e.ref ?? e.query;
                  if (!window.confirm(`Delete ${e.query} everywhere (audit log, stored report, trust graph)? This cannot be undone. You can always audit it again later.`)) return;
                  purgeSubject(ref);
                  setLog(getLog());
                }}
                className="mono mt-0.5 shrink-0 cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:border-avoid hover:text-avoid"
              >
                ×
              </span>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mono mt-1 text-[22px] font-semibold tabular" style={{ color: tone ?? "var(--color-ink)" }}>{value}</div>
    </div>
  );
}
