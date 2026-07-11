import { useCallback, useEffect, useMemo, useState } from "react";
import {
  changeReportLifecycle,
  listReports,
  groupReportsByEntity,
  type ReportKind,
  type ReportListing,
  type ReportLifecycleAction,
  type ReportSubject,
} from "../lib/reports";
import { verdictMeta } from "../lib/verdict";
import { mergedLog } from "../lib/auditlog";
import { scanStats, totalScans, type ScanStat } from "../lib/scanstats";
import { auditImage } from "../lib/avatars";
import { getAnalyst } from "../lib/analyst";
import { buildAliasResolver } from "../graph/network";
import { getContributions } from "../graph/store";
import { useArgusAuth } from "../auth-context";

const normRef = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");

// The report library: every persisted audit (yours + Enigma's) from the shared
// backend, searchable, newest first. Click opens the stored report (no re-run).
// Owners can archive a case without erasing its immutable history or graph.
// The badge shows the ROLE (Founder / Project / KOL / VC …) — more useful than
// the raw audit kind. Falls back to the kind when no role is known.
const ROLE_LABEL: Record<string, { label: string; color: string }> = {
  FOUNDER: { label: "founder", color: "var(--color-signal)" },
  PROJECT: { label: "project", color: "var(--color-unverifiable)" },
  KOL: { label: "KOL", color: "var(--color-caution)" },
  INVESTOR: { label: "VC", color: "var(--color-pass)" },
  ADVISOR: { label: "advisor", color: "var(--color-ink-dim)" },
  AGENCY: { label: "agency", color: "var(--color-ink-dim)" },
  MEMBER: { label: "member", color: "var(--color-ink-faint)" },
};
const KIND_META: Record<string, { label: string; color: string }> = {
  person: { label: "person", color: "var(--color-signal)" },
  // A token audit and a full investigation are both PROJECT deep-dives.
  token: { label: "project", color: "var(--color-unverifiable)" },
  investigation: { label: "project", color: "var(--color-unverifiable)" },
  site: { label: "site", color: "var(--color-pass)" },
};

function ago(ts?: string): string {
  if (!ts) return "";
  const d = Math.floor((Date.now() - Date.parse(ts)) / 86400000);
  if (Number.isNaN(d)) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function reportReadout(report: ReportListing) {
  const positiveNeedsQualification = report.verdict === "PASS" && report.completenessState !== "complete";
  const displayedVerdict = positiveNeedsQualification ? "INCOMPLETE" : report.verdict;
  const label = positiveNeedsQualification
    ? report.completenessState === "partial" ? "PARTIAL" : "INCOMPLETE"
    : displayedVerdict ?? "";
  return {
    displayedVerdict,
    label,
    positiveNeedsQualification,
    color: displayedVerdict ? verdictMeta(displayedVerdict).color : "var(--color-ink-faint)",
  };
}

export function DossiersPage({ onOpen }: { onOpen: (ref: string, kind?: ReportKind) => void }) {
  const { role } = useArgusAuth();
  const [reports, setReports] = useState<ReportListing[] | null>(null);
  const [archivedReports, setArchivedReports] = useState<ReportListing[] | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [costOpen, setCostOpen] = useState<string | null>(null); // "<kind>:<ref>" with expanded cost ledger
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [active, archived] = await Promise.allSettled([listReports(), listReports("archived")]);
    const failures: string[] = [];
    if (active.status === "fulfilled") setReports(active.value);
    else {
      setReports((current) => current ?? []);
      failures.push(active.reason instanceof Error ? active.reason.message : "Active reports are unavailable.");
    }
    if (archived.status === "fulfilled") setArchivedReports(archived.value);
    else {
      setArchivedReports((current) => current ?? []);
      failures.push(archived.reason instanceof Error ? archived.reason.message : "Archived reports are unavailable.");
    }
    if (failures.length) {
      setError(failures.join(" "));
    } else {
      setError("");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const runLifecycle = async (
    action: ReportLifecycleAction,
    subjects: readonly ReportSubject[],
    label: string,
  ) => {
    const actionKey = `${action}:${subjects.map((subject) => `${subject.kind}:${subject.ref}`).join("|")}`;
    if (pending) return;
    if (action === "archive" && !window.confirm(
      `Archive ${label}? Its immutable reports, evidence, audit history, and trust-graph intelligence will be preserved. Active public share links will be revoked.`,
    )) return;
    setPending(actionKey);
    setError("");
    try {
      await changeReportLifecycle(action, subjects);
      await reload();
    } catch (lifecycleError) {
      setError(lifecycleError instanceof Error ? lifecycleError.message : `The case could not be ${action}d.`);
    } finally {
      setPending(null);
    }
  };

  const selectedReports = view === "active" ? reports : archivedReports;
  const isArchived = view === "archived";

  // Images + role come from the audit log (the report listing carries neither).
  const { imageByRef, roleByRef } = useMemo(() => {
    const imageByRef = new Map<string, string>();
    const roleByRef = new Map<string, string>();
    for (const e of mergedLog()) {
      const k = (e.ref ?? e.query).trim().toLowerCase().replace(/^[@$]/, "");
      if (!k) continue;
      const img = auditImage(e);
      if (img && !imageByRef.has(k)) imageByRef.set(k, img);
      // first role: flag is the governing role (logPerson writes it first)
      const role = (e.flags ?? []).find((f) => /^role:/i.test(f))?.slice(5).toUpperCase();
      if (role && !roleByRef.has(k)) roleByRef.set(k, role);
    }
    return { imageByRef, roleByRef };
  }, [reports, archivedReports]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = getAnalyst();
  // Scan counts per subject, so each report box shows how many times it's been run.
  const statByKey = useMemo(() => {
    const m = new Map<string, ScanStat>();
    for (const s of scanStats()) m.set(s.key, s);
    return m;
  }, [reports, archivedReports]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = totalScans();
  const needle = q.trim().toLowerCase();
  const shown = (selectedReports ?? []).filter((r) =>
    !needle || r.ref.toLowerCase().includes(needle) || (r.query ?? "").toLowerCase().includes(needle) || (r.contributor ?? "").toLowerCase().includes(needle),
  );

  // Entity unification: a project wears three names — the $TOKEN audit, the
  // @handle person audit, and the site recon are three library cards for ONE
  // thing. Group them by the alias resolver (which unions token↔handle↔domain
  // from the audits' OWN edges, never name similarity) so the library shows one
  // card per project with its facets, not three unrelated rows. The token audit
  // keys the linkage on its $SYMBOL, so a token/investigation groups by its query
  // ($RECC); person/site group by their ref (the handle / domain).
  const groups = useMemo(
    () => groupReportsByEntity(shown, buildAliasResolver(getContributions())),
    [shown],
  );

  const openBtn = (ev: { stopPropagation: () => void }) => ev.stopPropagation();

  // A single report card (the default — unchanged behaviour for a lone audit).
  const renderSingle = (r: ReportListing) => {
          const readout = reportReadout(r);
          const color = readout.color;
          // Show the ROLE for person audits (Founder/Project/KOL/VC …); fall back
          // to the audit kind (token / project deep-dive) otherwise.
          const subjectRole = r.kind === "person" ? roleByRef.get(r.ref.toLowerCase().replace(/^[@$]/, "")) : undefined;
          const km = (subjectRole && ROLE_LABEL[subjectRole]) || KIND_META[r.kind] || KIND_META.person;
          const img = imageByRef.get(r.ref.toLowerCase().replace(/^[@$]/, ""));
          const letter = ((r.query ?? r.ref).replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
          const cardKey = `${r.kind}:${r.ref}`;
          const stat = statByKey.get(`${r.kind}:${normRef(r.ref)}`);
          const ledger = r.cost?.calls ?? [];
          const open = costOpen === cardKey;
          const ledgerId = `cost-ledger-${encodeURIComponent(cardKey)}`;
          const lifecycleAction: ReportLifecycleAction = isArchived ? "restore" : "archive";
          const lifecycleKey = `${lifecycleAction}:${cardKey}`;
          return (
            <div
              key={cardKey}
              className="group relative flex flex-col rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 hover:bg-panel/80 focus-within:border-line-2 soft-shadow"
            >
              <div className="flex items-center gap-3">
                {img ? (
                  <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[14px] text-signal">{letter}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {isArchived ? (
                      <span className="mono min-w-0 truncate text-[13px] text-ink">{r.query ?? r.ref}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpen(r.ref, r.kind)}
                        aria-label={`Open stored report for ${r.query ?? r.ref}`}
                        title="Open the stored report"
                        className="mono min-w-0 cursor-pointer truncate text-left text-[13px] text-ink after:absolute after:inset-0 after:cursor-pointer after:content-[''] focus-visible:outline-none"
                      >
                        {r.query ?? r.ref}
                      </button>
                    )}
                    <span className="mono shrink-0 rounded px-1 py-0.5 text-[8.5px] uppercase" style={{ color: km.color, background: `${km.color}14` }}>{km.label}</span>
                    {isArchived && <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[8.5px] uppercase text-ink-faint">archived</span>}
                    {readout.positiveNeedsQualification && (
                      <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[8.5px] uppercase text-ink-faint">partial evidence</span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                    <span className="truncate">
                      {isArchived ? `archived ${ago(r.archivedAt)} · report ${ago(r.ts)}` : ago(r.ts)}
                      {r.contributor && r.contributor !== me && r.contributor !== "anonymous" ? ` · by ${r.contributor}` : ""}
                    </span>
                    {stat && stat.count > 0 && (
                      <span className="mono shrink-0 inline-flex items-center gap-0.5 rounded-md border border-line/70 px-1.5 py-[1px] text-[10.5px] text-ink-dim" title={`Scanned ${stat.count} time${stat.count === 1 ? "" : "s"}${stat.rank <= 20 ? ` · #${stat.rank} most scanned` : ""}`}>
                        {stat.trend === "up" && <span style={{ color: "var(--color-pass)" }}>▲</span>}
                        {stat.trend === "down" && <span style={{ color: "var(--color-avoid)" }}>▼</span>}
                        {stat.count}<span className="text-ink-faint">×</span>
                      </span>
                    )}
                    {/* Cost as a readable pill (not faint appended text). Token/project
                        audits run keyless -> "free"; a near-zero or missing person-audit
                        cost shows nothing (not "~$0.00"). */}
                    {typeof r.cost?.usd === "number" && r.cost.usd >= 0.01 ? (
                      ledger.length ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={ledgerId}
                          title="Show the full call-by-call cost breakdown"
                          onClick={() => setCostOpen(open ? null : cardKey)}
                          className="mono relative z-10 inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line/70 bg-void/60 px-1.5 py-[1px] text-[10.5px] text-ink-dim transition hover:border-line-2 hover:text-ink"
                        >
                          ~${r.cost.usd.toFixed(2)}{open ? " ▾" : " ▸"}
                        </button>
                      ) : (
                        <span
                          title="estimated provider spend for this audit run"
                          className="mono shrink-0 inline-flex items-center gap-0.5 rounded-md border border-line/70 bg-void/60 px-1.5 py-[1px] text-[10.5px] text-ink-dim"
                        >
                          ~${r.cost.usd.toFixed(2)}
                        </span>
                      )
                    ) : r.kind === "token" && (r.cost?.usd ?? 0) < 0.01 ? (
                      <span className="mono shrink-0 rounded-md border border-line/70 px-1.5 py-[1px] text-[10.5px] text-ink-faint">free</span>
                    ) : null}
                  </span>
                </span>
                <span
                  className="mono shrink-0 text-right leading-none"
                  style={{ color }}
                  title={readout.positiveNeedsQualification ? `Underlying model signal: ${r.verdict} ${r.score ?? "—"}. Stored evidence is not complete.` : undefined}
                >
                  <span className="block text-[18px] font-semibold tabular">{r.score ?? "—"}</span>
                  <span className="block text-[8px] tracking-wider">{readout.label}</span>
                </span>
                {role === "owner" && (
                  <button
                    type="button"
                    aria-label={`${isArchived ? "Restore" : "Archive"} ${r.query ?? r.ref}`}
                    title={isArchived ? "Restore this case to the active library" : "Archive this case while preserving its evidence and history"}
                    disabled={pending != null}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void runLifecycle(lifecycleAction, [{ kind: r.kind, ref: r.ref }], r.query ?? r.ref);
                    }}
                    className="mono relative z-10 shrink-0 rounded-md border border-line px-2 py-1 text-[10px] text-ink-faint transition hover:border-signal hover:text-signal disabled:cursor-wait disabled:opacity-50"
                  >
                    {pending === lifecycleKey ? `${isArchived ? "Restoring" : "Archiving"}…` : isArchived ? "Restore" : "Archive"}
                  </button>
                )}
              </div>

              {/* full A-to-Z ledger: every provider call this audit made */}
              {open && ledger.length > 0 && (
                <div id={ledgerId} className="relative z-10 mt-2.5 border-t border-line/60 pt-2">
                  <div className="mb-1 text-[9.5px] uppercase tracking-wider text-ink-faint">cost breakdown · estimated, priciest first</div>
                  <div className="space-y-0.5">
                    {ledger.map((l, i) => (
                      <div key={i} className="mono flex items-baseline gap-2 text-[10.5px]">
                        <span className="text-ink-dim">{l.provider}</span>
                        <span className="truncate text-ink-faint">{l.op}</span>
                        <span className="text-ink-faint">×{l.calls}</span>
                        <span className="ml-auto shrink-0 tabular" style={{ color: l.usd >= 0.01 ? "var(--color-caution)" : "var(--color-ink-faint)" }}>
                          {l.usd > 0 ? `$${l.usd.toFixed(4)}` : "free"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {ledger.some((l) => l.meta) && (
                    <div className="mt-1 text-[9.5px] text-ink-faint">
                      {ledger.filter((l) => l.meta).slice(0, 3).map((l) => `${l.provider}/${l.op}: ${l.meta}`).join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
  };

  // A unified entity card: one project shown once, with a facet chip per audit
  // (project / person / site). The facets are the SAME entity resolved across
  // audit kinds — clicking a chip opens that specific stored report.
  const KIND_ORDER: ReportListing["kind"][] = ["investigation", "token", "site", "person"];
  const renderEntity = (group: ReportListing[]) => {
    const sorted = [...group].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const primary = sorted[0];
    // Display name: prefer the project token ($SYMBOL) / site / handle.
    const proj = sorted.find((r) => r.kind === "token" || r.kind === "investigation");
    const site = sorted.find((r) => r.kind === "site");
    const title = proj?.query ?? site?.ref ?? primary.query ?? primary.ref;
    // Headline verdict from the most authoritative facet that has one.
    const scored = sorted.find((r) => r.verdict) ?? primary;
    const readout = reportReadout(scored);
    const color = readout.color;
    const img = sorted.map((r) => imageByRef.get(r.ref.toLowerCase().replace(/^[@$]/, ""))).find(Boolean);
    const letter = (title.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
    const groupKey = sorted.map((r) => `${r.kind}:${r.ref}`).join("|");
    const lifecycleAction: ReportLifecycleAction = isArchived ? "restore" : "archive";
    const lifecycleKey = `${lifecycleAction}:${groupKey}`;
    const subjects = sorted.map((r) => ({ kind: r.kind, ref: r.ref }));
    const contributors = [...new Set(sorted.map((r) => r.contributor).filter((c) => c && c !== me && c !== "anonymous"))];
    return (
      <div
        key={groupKey}
        className="group flex flex-col rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 soft-shadow"
      >
        <div className="flex items-center gap-3">
          {img ? (
            <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[14px] text-signal">{letter}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="mono truncate text-[13px] text-ink">{title}</span>
              <span className="mono shrink-0 rounded px-1 py-0.5 text-[8.5px] uppercase" style={{ color: "var(--color-unverifiable)", background: "var(--color-unverifiable)14" }}>project</span>
              <span className="mono shrink-0 text-[9px] text-ink-faint">{sorted.length} facets</span>
              {isArchived && <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[8.5px] uppercase text-ink-faint">archived</span>}
              {readout.positiveNeedsQualification && (
                <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[8.5px] uppercase text-ink-faint">partial evidence</span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">
              {isArchived ? `archived ${ago(primary.archivedAt)} · report ${ago(primary.ts)}` : ago(primary.ts)}
              {contributors.length ? ` · with ${contributors.join(", ")}` : ""}
            </span>
          </span>
          <span
            className="mono shrink-0 text-right leading-none"
            style={{ color }}
            title={readout.positiveNeedsQualification ? `Underlying model signal: ${scored.verdict} ${scored.score ?? "—"}. Stored evidence is not complete.` : undefined}
          >
            <span className="block text-[18px] font-semibold tabular">{scored.score ?? "—"}</span>
            <span className="block text-[8px] tracking-wider">{readout.label}</span>
          </span>
          {role === "owner" && (
            <button
              type="button"
              aria-label={`${isArchived ? "Restore" : "Archive"} ${title} and its associated reports`}
              title={isArchived ? "Restore every case facet to the active library" : "Archive every case facet while preserving evidence and history"}
              disabled={pending != null}
              onClick={(ev) => {
                ev.stopPropagation();
                void runLifecycle(lifecycleAction, subjects, `${title} and its ${sorted.length} case facets`);
              }}
              className="mono shrink-0 rounded-md border border-line px-2 py-1 text-[10px] text-ink-faint transition hover:border-signal hover:text-signal disabled:cursor-wait disabled:opacity-50"
            >
              {pending === lifecycleKey ? `${isArchived ? "Restoring" : "Archiving"}…` : isArchived ? "Restore all" : "Archive all"}
            </button>
          )}
        </div>
        {/* facet chips — each opens its own stored report */}
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/60 pt-2">
          {sorted.map((r) => {
            const role = r.kind === "person" ? roleByRef.get(r.ref.toLowerCase().replace(/^[@$]/, "")) : undefined;
            const km = (role && ROLE_LABEL[role]) || KIND_META[r.kind] || KIND_META.person;
            const fm = r.verdict ? verdictMeta(r.verdict) : null;
            return (
              <button
                key={`${r.kind}:${r.ref}`}
                type="button"
                disabled={isArchived}
                onClick={(ev) => { openBtn(ev); if (!isArchived) onOpen(r.ref, r.kind); }}
                title={isArchived ? "Restore this case before opening it" : `Open the ${km.label} report — ${r.query ?? r.ref}`}
                className="mono inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink-dim transition hover:border-signal hover:text-signal disabled:cursor-default disabled:hover:border-line disabled:hover:text-ink-dim"
              >
                <span className="uppercase" style={{ color: km.color }}>{km.label}</span>
                <span className="truncate text-ink-faint">{r.query ?? r.ref}</span>
                {fm && r.score != null && <span style={{ color: fm.color }}>{r.score}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Report library</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
        Every audit persisted by you and your co-analysts — click to open the stored report instantly, no re-run.
        Owners can archive a case without erasing its evidence, audit history, or trust-graph intelligence.
      </p>

      <div className="mt-5 inline-flex rounded-lg border border-line bg-panel p-1" aria-label="Report library status">
        <button
          type="button"
          onClick={() => { setView("active"); setCostOpen(null); }}
          aria-pressed={view === "active"}
          className={`mono rounded-md px-3 py-1.5 text-[11px] transition ${view === "active" ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"}`}
        >
          Active {reports ? `(${reports.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => { setView("archived"); setCostOpen(null); }}
          aria-pressed={view === "archived"}
          className={`mono rounded-md px-3 py-1.5 text-[11px] transition ${view === "archived" ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"}`}
        >
          Archived {archivedReports ? `(${archivedReports.length})` : ""}
        </button>
      </div>

      <label htmlFor="dossier-search" className="sr-only">Search reports</label>
      <input
        id="dossier-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search by handle, token, site, or analyst…"
        className="mono mt-4 w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint transition focus:border-line-2 focus:outline-none"
      />

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2 text-[12px] text-avoid">
          {error}
        </div>
      )}

      <div className="mt-5 mb-2.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
        <span>{selectedReports == null ? "loading…" : `${shown.length} ${isArchived ? "archived " : ""}report${shown.length === 1 ? "" : "s"}`}</span>
        {total > 0 && <span className="text-ink-faint/70">· {total.toLocaleString()} total scans</span>}
      </div>

      {selectedReports != null && shown.length === 0 && (
        <p className="text-[13px] text-ink-faint">
          {needle
            ? "Nothing matches that search."
            : isArchived
              ? "No archived cases."
              : "No persisted reports yet — run an audit and it lands here automatically."}
        </p>
      )}

      <div className={`grid grid-cols-1 gap-2.5 ${groups.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {groups.map((g) => (g.length === 1 ? renderSingle(g[0]) : renderEntity(g)))}
      </div>
    </div>
  );
}
