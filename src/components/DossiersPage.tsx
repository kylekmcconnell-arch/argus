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
import { normalizeSubjectRef } from "../lib/subjectRef";
import type { CaseBriefTarget } from "../lib/caseBrief";
import { Archive, FolderOpen, MagnifyingGlass, UsersThree } from "@phosphor-icons/react";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

const normRef = normalizeSubjectRef;
type LibraryFilter = "all" | "people" | "projects" | "sites";

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

function libraryKind(report: ReportListing, roleByRef: Map<string, string>): Exclude<LibraryFilter, "all"> {
  if (report.kind === "site") return "sites";
  if (report.kind === "token" || report.kind === "investigation") return "projects";
  return roleByRef.get(normalizeSubjectRef(report.ref)) === "PROJECT" ? "projects" : "people";
}

export function DossiersPage({
  onOpen,
  onOpenBrief,
}: {
  onOpen: (ref: string, kind?: ReportKind) => void;
  onOpenBrief: (target: CaseBriefTarget) => void;
}) {
  const { role } = useArgusAuth();
  const [reports, setReports] = useState<ReportListing[] | null>(null);
  const [archivedReports, setArchivedReports] = useState<ReportListing[] | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");
  const [filter, setFilter] = useState<LibraryFilter>("all");
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
      const k = normalizeSubjectRef(e.ref ?? e.query);
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
  const libraryCounts = useMemo(() => {
    const rows = selectedReports ?? [];
    return {
      all: rows.length,
      people: rows.filter((report) => libraryKind(report, roleByRef) === "people").length,
      projects: rows.filter((report) => libraryKind(report, roleByRef) === "projects").length,
      sites: rows.filter((report) => libraryKind(report, roleByRef) === "sites").length,
    };
  }, [roleByRef, selectedReports]);
  const shown = (selectedReports ?? []).filter((r) => {
    const matchesKind = filter === "all"
      || filter === libraryKind(r, roleByRef);
    const matchesQuery = !needle
      || r.ref.toLowerCase().includes(needle)
      || (r.query ?? "").toLowerCase().includes(needle)
      || (r.contributor ?? "").toLowerCase().includes(needle);
    return matchesKind && matchesQuery;
  });

  // Entity unification: a project wears three names — the $TOKEN audit, the
  // @handle person audit, and the site recon are three library cards for ONE
  // thing only when the identity is safe. Token + investigation facets group by
  // exact contract (never ticker); person/site facets may group through graph
  // aliases established by the audits' own evidence, never name similarity.
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
          const subjectRole = r.kind === "person" ? roleByRef.get(normalizeSubjectRef(r.ref)) : undefined;
          const km = (subjectRole && ROLE_LABEL[subjectRole]) || KIND_META[r.kind] || KIND_META.person;
          const img = imageByRef.get(normalizeSubjectRef(r.ref));
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
              className="panel group relative flex flex-col p-3 text-left transition hover:border-line-2 hover:bg-panel/80 focus-within:border-line-2 soft-shadow"
            >
              <div className="flex items-center gap-3">
                {img ? (
                  <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-md border border-line object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[13.5px] text-signal-lift">{letter}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {isArchived ? (
                      <span className="mono min-w-0 truncate text-[13.5px] text-ink">{r.query ?? r.ref}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpen(r.ref, r.kind)}
                        aria-label={`Open stored report for ${r.query ?? r.ref}`}
                        title="Open the stored report"
                        className="mono min-w-0 cursor-pointer truncate text-left text-[13.5px] text-ink after:absolute after:inset-0 after:cursor-pointer after:content-[''] focus-visible:outline-none"
                      >
                        {r.query ?? r.ref}
                      </button>
                    )}
                    <span className="chip tint-var shrink-0" style={{ "--tint": km.color } as React.CSSProperties}>{km.label}</span>
                    {isArchived && <span className="chip shrink-0">archived</span>}
                    {readout.positiveNeedsQualification && (
                      <span className="chip shrink-0">partial evidence</span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                    <span className="truncate">
                      {isArchived ? `archived ${ago(r.archivedAt)} · report ${ago(r.ts)}` : ago(r.ts)}
                      {r.contributor && r.contributor !== me && r.contributor !== "anonymous" ? ` · by ${r.contributor}` : ""}
                    </span>
                    {stat && stat.count > 0 && (
                      <span className="mono shrink-0 inline-flex items-center gap-0.5 rounded-md border border-line/70 px-1.5 py-[1px] text-[11px] text-ink-dim" title={`Scanned ${stat.count} time${stat.count === 1 ? "" : "s"}${stat.rank <= 20 ? ` · #${stat.rank} most scanned` : ""}`}>
                        {stat.trend === "up" && <span className="text-pass">▲</span>}
                        {stat.trend === "down" && <span className="text-avoid">▼</span>}
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
                          className="mono relative z-10 inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line/70 bg-void/60 px-1.5 py-[1px] text-[11px] text-ink-dim transition hover:border-line-2 hover:text-ink"
                        >
                          ~${r.cost.usd.toFixed(2)}{open ? " ▾" : " ▸"}
                        </button>
                      ) : (
                        <span
                          title="estimated provider spend for this audit run"
                          className="mono shrink-0 inline-flex items-center gap-0.5 rounded-md border border-line/70 bg-void/60 px-1.5 py-[1px] text-[11px] text-ink-dim"
                        >
                          ~${r.cost.usd.toFixed(2)}
                        </span>
                      )
                    ) : r.kind === "token" && (r.cost?.usd ?? 0) < 0.01 ? (
                      <span className="mono shrink-0 rounded-md border border-line/70 px-1.5 py-[1px] text-[11px] text-ink-faint">free</span>
                    ) : null}
                  </span>
                </span>
                <span
                  className="flex shrink-0 flex-col items-end gap-1 leading-none"
                  title={readout.positiveNeedsQualification ? `Early score: ${r.verdict} ${r.score ?? "N/A"}. Some checks did not finish.` : undefined}
                >
                  <span className="mono text-[18px] font-semibold tabular" style={{ color }}>{r.score ?? "N/A"}</span>
                  {readout.label && <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}>{readout.label}</span>}
                </span>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpenBrief(briefTargetForReport(r));
                  }}
                  aria-label={`Open case brief for the ${r.kind} report ${r.query ?? r.ref}`}
                  title="Open the analyst decision brief for this exact case facet"
                  className="btn-chip relative z-10 shrink-0"
                >
                  Brief
                </button>
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
                    className="btn-chip relative z-10 shrink-0 disabled:cursor-wait disabled:opacity-50"
                  >
                    {pending === lifecycleKey ? `${isArchived ? "Restoring" : "Archiving"}…` : isArchived ? "Restore" : "Archive"}
                  </button>
                )}
              </div>

              {/* full A-to-Z ledger: every provider call this audit made */}
              {open && ledger.length > 0 && (
                <div id={ledgerId} className="relative z-10 mt-2.5 border-t border-line/60 pt-2">
                  <div className="eyebrow mb-1">cost breakdown · estimated, priciest first</div>
                  <div className="space-y-0.5">
                    {ledger.map((l, i) => (
                      <div key={i} className="mono flex items-baseline gap-2 text-[11px]">
                        <span className="text-ink-dim">{l.provider}</span>
                        <span className="truncate text-ink-faint">{l.op}</span>
                        <span className="text-ink-faint">×{l.calls}</span>
                        <span className={`ml-auto shrink-0 tabular ${l.usd >= 0.01 ? "text-caution" : "text-ink-faint"}`}>
                          {l.usd > 0 ? `$${l.usd.toFixed(4)}` : "free"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {ledger.some((l) => l.meta) && (
                    <div className="mt-1 text-[11px] text-ink-faint">
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
    const img = sorted.map((r) => imageByRef.get(normalizeSubjectRef(r.ref))).find(Boolean);
    const letter = (title.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
    const groupKey = sorted.map((r) => `${r.kind}:${r.ref}`).join("|");
    const lifecycleAction: ReportLifecycleAction = isArchived ? "restore" : "archive";
    const lifecycleKey = `${lifecycleAction}:${groupKey}`;
    const subjects = sorted.map((r) => ({ kind: r.kind, ref: r.ref }));
    const contributors = [...new Set(sorted.map((r) => r.contributor).filter((c) => c && c !== me && c !== "anonymous"))];
    return (
      <div
        key={groupKey}
        className="panel group flex flex-col p-3 text-left transition hover:border-line-2 soft-shadow"
      >
        <div className="flex items-center gap-3">
          {img ? (
            <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-md border border-line object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[13.5px] text-signal-lift">{letter}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="mono truncate text-[13.5px] text-ink">{title}</span>
              <span className="chip tint-unverifiable shrink-0">project</span>
              <span className="mono shrink-0 text-[11px] text-ink-faint">{sorted.length} facets</span>
              {isArchived && <span className="chip shrink-0">archived</span>}
              {readout.positiveNeedsQualification && (
                <span className="chip shrink-0">partial evidence</span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
              {isArchived ? `archived ${ago(primary.archivedAt)} · report ${ago(primary.ts)}` : ago(primary.ts)}
              {contributors.length ? ` · with ${contributors.join(", ")}` : ""}
            </span>
          </span>
          <span
            className="flex shrink-0 flex-col items-end gap-1 leading-none"
            title={readout.positiveNeedsQualification ? `Early score: ${scored.verdict} ${scored.score ?? "N/A"}. Some checks did not finish.` : undefined}
          >
            <span className="mono text-[18px] font-semibold tabular" style={{ color }}>{scored.score ?? "N/A"}</span>
            {readout.label && <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}>{readout.label}</span>}
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
              className="btn-chip shrink-0 disabled:cursor-wait disabled:opacity-50"
            >
              {pending === lifecycleKey ? `${isArchived ? "Restoring" : "Archiving"}…` : isArchived ? "Restore all" : "Archive all"}
            </button>
          )}
        </div>
        {/* Each facet owns a distinct report AND brief. Never attach a brief to
            the visual entity group: token and investigation cases can share a
            contract while retaining separate immutable histories. */}
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/60 pt-2">
          {sorted.map((r) => {
            const role = r.kind === "person" ? roleByRef.get(normalizeSubjectRef(r.ref)) : undefined;
            const km = (role && ROLE_LABEL[role]) || KIND_META[r.kind] || KIND_META.person;
            const fm = r.verdict ? verdictMeta(r.verdict) : null;
            return (
              <span key={`${r.kind}:${r.ref}`} className="inline-flex overflow-hidden rounded-md border border-line">
                <button
                  type="button"
                  disabled={isArchived}
                  onClick={(ev) => { openBtn(ev); if (!isArchived) onOpen(r.ref, r.kind); }}
                  title={isArchived ? "Restore this case before opening its report" : `Open the ${km.label} report: ${r.query ?? r.ref}`}
                  className="mono inline-flex min-h-8 min-w-0 items-center gap-1 px-2 py-1 text-[11px] text-ink-dim transition hover:bg-signal/5 hover:text-signal-lift focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-ink-dim"
                >
                  <span className="uppercase" style={{ color: km.color }}>{km.label}</span>
                  <span className="max-w-40 truncate text-ink-faint">{r.query ?? r.ref}</span>
                  {fm && r.score != null && <span style={{ color: fm.color }}>{r.score}</span>}
                </button>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpenBrief(briefTargetForReport(r));
                  }}
                  aria-label={`Open case brief for the ${r.kind} facet ${r.query ?? r.ref}`}
                  title={`Open the analyst brief for this exact ${r.kind} case`}
                  className="mono min-h-8 border-l border-line px-2 py-1 text-[11px] text-ink-faint transition hover:bg-signal/5 hover:text-signal-lift focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
                >
                  Brief
                </button>
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <WorkspacePageHeader
        eyebrow="Cases"
        title="Case library"
        description={<>Every persisted investigation in one decision workspace. Open the frozen evidence without paying for a rerun, or archive a case while retaining its history and graph intelligence.</>}
        meta={(
          <>
            <span className="chip tint-signal"><FolderOpen size={13} weight="bold" aria-hidden="true" /> {reports?.length ?? 0} active</span>
            <span className="chip"><Archive size={13} weight="bold" aria-hidden="true" /> {archivedReports?.length ?? 0} archived</span>
            {total > 0 && <span className="chip"><UsersThree size={13} weight="bold" aria-hidden="true" /> {total.toLocaleString()} scans</span>}
          </>
        )}
      />

      <div className="panel mt-5 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex self-start rounded-lg bg-panel-2 p-1" aria-label="Case lifecycle">
            <button
              type="button"
              onClick={() => { setView("active"); setCostOpen(null); }}
              aria-pressed={view === "active"}
              className={`mono min-h-9 rounded-md px-3 py-1.5 text-[11px] transition ${view === "active" ? "tint-signal" : "text-ink-faint hover:text-ink-dim"}`}
            >
              Active {reports ? `(${reports.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => { setView("archived"); setCostOpen(null); }}
              aria-pressed={view === "archived"}
              className={`mono min-h-9 rounded-md px-3 py-1.5 text-[11px] transition ${view === "archived" ? "tint-signal" : "text-ink-faint hover:text-ink-dim"}`}
            >
              Archived {archivedReports ? `(${archivedReports.length})` : ""}
            </button>
          </div>

          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <label htmlFor="dossier-search" className="sr-only">Search cases</label>
            <input
              id="dossier-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search handle, token, site, or analyst"
              className="field mono min-h-11 w-full pl-9 pr-3 text-[13.5px]"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3" aria-label="Case type filter">
          {([
            ["all", "All cases"],
            ["people", "People"],
            ["projects", "Projects"],
            ["sites", "Sites"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`btn-chip min-h-8 ${filter === key ? "tint-signal" : ""}`}
            >
              {label} <span className="text-ink-faint">{libraryCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="tint-avoid mt-3 rounded-lg border px-3 py-2 text-[12.5px]">
          {error}
        </div>
      )}

      <div className="eyebrow mt-5 mb-2.5 flex items-center gap-2">
        <span>{selectedReports == null ? "loading…" : `${shown.length} ${isArchived ? "archived " : ""}report${shown.length === 1 ? "" : "s"}`}</span>
        {filter !== "all" && <span className="text-ink-faint/70">· {filter}</span>}
      </div>

      {selectedReports != null && shown.length === 0 && (
        <p className="empty-state">
          {needle
            ? "Nothing matches that search."
            : isArchived
              ? "No archived cases."
              : "No persisted reports yet. Run an audit and it lands here automatically."}
        </p>
      )}

      <div className={`grid grid-cols-1 gap-2.5 ${groups.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {groups.map((g) => (g.length === 1 ? renderSingle(g[0]) : renderEntity(g)))}
      </div>
    </div>
  );
}
function briefTargetForReport(report: ReportListing): CaseBriefTarget {
  const expectedReportVersionId = report.reportVersionId;
  return report.caseId
    ? { caseId: report.caseId, expectedReportVersionId }
    : { kind: report.kind, ref: report.ref, expectedReportVersionId };
}
