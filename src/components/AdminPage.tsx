import { useEffect, useState } from "react";
import { auditReadinessLabel, getLog, clearLog, hasCoverageGap, logStats, mergedLog, presentedAuditVerdict, applyRoles, type LogEntry } from "../lib/auditlog";
import { verdictMeta } from "../lib/verdict";
import { PendingEdits } from "./PendingEdits";
import { TeamAccess } from "./TeamAccess";

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

// Kind coloring canon (must match DossiersPage): person=signal, token=unverifiable, site=pass.
const KIND_META: Record<string, { label: string; color: string }> = {
  site: { label: "site", color: "var(--color-pass)" },
  token: { label: "token", color: "var(--color-unverifiable)" },
  person: { label: "person", color: "var(--color-signal)" },
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
  return verdictMeta(presentedAuditVerdict(e) ?? "INCOMPLETE").color;
}

interface SpendEvent { createdAt: string; usd: number; claudeUsd: number }
interface SpendData { truncated: boolean; runs: string[]; events: SpendEvent[] }
interface SpendDay { day: string; label: string; runs: number; usd: number; claudeUsd: number }

// Bucket recorded usage by the analyst's local calendar day, newest first.
// Dollars come from the usage event stream (scans plus follow-up panels,
// stamped when the money was spent); run counts come from persisted report
// versions, superseded ones included. When either feed hit the server row
// cap the oldest returned day may be missing rows, so it is dropped rather
// than shown as a partial total.
export function buildSpendDays(data: SpendData): SpendDay[] {
  const days = new Map<string, SpendDay>();
  const bucketFor = (at: Date): SpendDay => {
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    const existing = days.get(day);
    if (existing) return existing;
    const fresh: SpendDay = {
      day,
      label: at.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      runs: 0,
      usd: 0,
      claudeUsd: 0,
    };
    days.set(day, fresh);
    return fresh;
  };
  for (const run of data.runs) {
    const at = new Date(run);
    if (Number.isNaN(at.getTime())) continue;
    bucketFor(at).runs += 1;
  }
  for (const event of data.events) {
    const at = new Date(event.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = bucketFor(at);
    bucket.usd += event.usd;
    bucket.claudeUsd += event.claudeUsd;
  }
  const ordered = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  if (data.truncated && ordered.length > 1) ordered.pop();
  return ordered;
}

export function AdminPage({ onAudit }: { onAudit?: (q: string) => void }) {
  const [log, setLog] = useState<LogEntry[]>(() => getLog());
  const [filter, setFilter] = useState<"all" | "site" | "token" | "person" | "gaps">("all");
  const [recat, setRecat] = useState<"idle" | "running" | string>("idle");
  const [spend, setSpend] = useState<SpendData | null>(null);
  const stats = logStats(log);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/report?spend", { signal: AbortSignal.timeout(9000) });
        if (!r.ok) return;
        const d = await r.json() as { available?: boolean; truncated?: boolean; runs?: string[]; events?: SpendEvent[] };
        if (!cancelled && d?.available !== false && Array.isArray(d?.runs) && Array.isArray(d?.events)) {
          setSpend({ truncated: d.truncated === true, runs: d.runs, events: d.events });
        }
      } catch {
        /* spend panel is optional; the page works without it */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const spendDays = spend ? buildSpendDays(spend).slice(0, 14) : [];

  const onRecategorize = async () => {
    setRecat("running");
    const r = await recategorizeAll();
    setRecat("error" in r ? `failed: ${r.error}` : `re-filed ${r.updated}/${r.total} subjects`);
    setLog(getLog());
  };

  const shown = log.filter((e) =>
    filter === "all" ? true : filter === "gaps" ? hasCoverageGap(e) : e.kind === filter,
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-sm text-[24px] text-ink">Audit log</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
            Every query that runs through ARGUS, with the verdict it returned and where coverage fell short. Your
            own record to check the engine against. It is also the seed of the data asset: a growing, queryable history
            of who and what has been audited.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onRecategorize}
            disabled={recat === "running"}
            title="Re-file every audited person under the current role taxonomy (Founder / Project / KOL / VC) from their stored summaries. No audits are rerun and scores stay the same."
            className="btn-chip tint-signal shrink-0 disabled:opacity-60"
          >
            {recat === "running" ? "recategorizing…" : "recategorize roles"}
          </button>
          {recat !== "idle" && recat !== "running" && <span className="text-[11px] text-ink-faint">{recat}</span>}
          {log.length > 0 && (
            <button
              onClick={() => { clearLog(); setLog([]); }}
              className="btn-chip shrink-0"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <TeamAccess />

      {/* analyst edits awaiting approval */}
      <div className="mt-5"><PendingEdits /></div>

      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total audits" value={stats.total} />
        <Stat label="Tokens" value={stats.byKind.token} />
        <Stat label="People / sites" value={stats.byKind.person + stats.byKind.site} />
        <Stat label="Coverage gaps" value={stats.gaps} tone="var(--color-unverifiable)" />
      </div>

      {/* provider spend — what each day of scanning actually cost */}
      {spendDays.length > 0 && (
        <div className="panel mt-5 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[12.5px] text-ink-dim">Provider spend by day</div>
            <div className="mono text-[11px] text-ink-faint">
              ${spendDays.reduce((a, d) => a + d.usd, 0).toFixed(2)} over the last {spendDays.length === 1 ? "active day" : `${spendDays.length} active days`}
            </div>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
            Recorded provider usage from the past 30 days: every saved scan counts, including versions later
            replaced by a rescan, plus follow-up intel panels opened on reports. Runs that failed before saving
            anything are not recorded here.
          </p>
          <table className="mt-3 w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint">
                <th className="py-1 pr-3 font-normal">Day</th>
                <th className="py-1 pr-3 text-right font-normal">Runs</th>
                <th className="py-1 pr-3 text-right font-normal">Claude</th>
                <th className="py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {spendDays.map((d) => (
                <tr key={d.day} className="border-t border-line text-ink-dim">
                  <td className="py-1.5 pr-3">{d.label}</td>
                  <td className="py-1.5 pr-3 text-right">{d.runs}</td>
                  <td className="py-1.5 pr-3 text-right">${d.claudeUsd.toFixed(2)}</td>
                  <td className="py-1.5 text-right text-ink">${d.usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* filters */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {(["all", "token", "site", "person", "gaps"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`mono rounded-md border px-2.5 py-1 text-[11px] transition ${filter === f ? "tint-signal" : "border-line text-ink-dim hover:text-ink"}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* log */}
      {shown.length === 0 ? (
        <div className="empty-state mt-6">
          {log.length === 0 ? "No audits yet. Run a token, a handle, or a site recon and it will appear here." : "Nothing matches this filter."}
        </div>
      ) : (
        <div className="panel mt-4 overflow-hidden">
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
              <span className="chip tint-var mt-0.5 shrink-0" style={{ "--tint": KIND_META[e.kind].color } as React.CSSProperties}>
                {KIND_META[e.kind].label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{e.query}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">{e.summary}</span>
                {e.flags && e.flags.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {e.flags.map((f) => (
                      <span key={f} className="chip chip-sm">{f}</span>
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
                  className="field mono mt-0.5 shrink-0 cursor-pointer px-1 py-0.5 text-[11px] text-ink-dim transition"
                >
                  {["FOUNDER", "PROJECT", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"].map((r) => (
                    <option key={r} value={r}>{r === "INVESTOR" ? "VC" : r.charAt(0) + r.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              )}
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="chip tint-var" style={{ "--tint": verdictColor(e) } as React.CSSProperties}>
                  {auditReadinessLabel(e)}{typeof e.score === "number" ? ` ${e.score}` : ""}
                </span>
                {hasCoverageGap(e) && <span className="chip tint-caution">coverage gap</span>}
                <span className="mono text-[11px] text-ink-faint">{ago(e.ts)}</span>
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
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value mt-0.5 font-semibold" style={{ color: tone ?? "var(--color-ink)" }}>{value}</div>
    </div>
  );
}
