import { useEffect, useMemo, useState } from "react";
import { listReports, type ReportListing } from "../lib/reports";
import { purgeSubject } from "../lib/purge";
import { verdictMeta } from "../lib/verdict";
import { mergedLog } from "../lib/auditlog";
import { auditImage } from "../lib/avatars";
import { getAnalyst } from "../lib/analyst";

// The report library: every persisted audit (yours + Enigma's) from the shared
// backend, searchable, newest first. Click opens the stored report (no re-run);
// x purges the subject everywhere for a from-scratch redo.
const KIND_META: Record<string, { label: string; color: string }> = {
  person: { label: "person", color: "var(--color-signal)" },
  token: { label: "token", color: "var(--color-caution)" },
  investigation: { label: "invest.", color: "var(--color-unverifiable)" },
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

export function DossiersPage({ onOpen }: { onOpen: (ref: string) => void }) {
  const [reports, setReports] = useState<ReportListing[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    void listReports().then(setReports);
  }, []);

  // Images come from the audit log (the library listing itself has none).
  const imageByRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of mergedLog()) {
      const img = auditImage(e);
      const k = (e.ref ?? e.query).trim().toLowerCase().replace(/^[@$]/, "");
      if (img && k && !m.has(k)) m.set(k, img);
    }
    return m;
  }, [reports]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = getAnalyst();
  const needle = q.trim().toLowerCase();
  const shown = (reports ?? []).filter((r) =>
    !needle || r.ref.toLowerCase().includes(needle) || (r.query ?? "").toLowerCase().includes(needle) || (r.contributor ?? "").toLowerCase().includes(needle),
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Report library</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
        Every audit persisted by you and your co-analysts — click to open the stored report instantly, no re-run.
        Remove one to start that subject from scratch.
      </p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search by handle, token, site, or analyst…"
        className="mono mt-5 w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint transition focus:border-line-2 focus:outline-none"
      />

      <div className="mt-5 mb-2.5 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
        {reports == null ? "loading…" : `${shown.length} report${shown.length === 1 ? "" : "s"}`}
      </div>

      {reports != null && shown.length === 0 && (
        <p className="text-[13px] text-ink-faint">
          {needle ? "Nothing matches that search." : "No persisted reports yet — run an audit and it lands here automatically."}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {shown.map((r) => {
          const m = r.verdict ? verdictMeta(r.verdict) : null;
          const color = m?.color ?? "var(--color-ink-faint)";
          const km = KIND_META[r.kind] ?? KIND_META.person;
          const img = imageByRef.get(r.ref.toLowerCase());
          const letter = ((r.query ?? r.ref).replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
          return (
            <div
              key={`${r.kind}:${r.ref}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r.ref)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.ref); }}
              title="Open the stored report"
              className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-line-2 hover:bg-panel/80 soft-shadow"
            >
              {img ? (
                <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-void text-[14px] text-signal">{letter}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="mono truncate text-[13px] text-ink">{r.query ?? r.ref}</span>
                  <span className="mono shrink-0 rounded px-1 py-0.5 text-[8.5px] uppercase" style={{ color: km.color, background: `${km.color}14` }}>{km.label}</span>
                </span>
                <span className="block truncate text-[10.5px] text-ink-faint">
                  {ago(r.ts)}{r.contributor && r.contributor !== me && r.contributor !== "anonymous" ? ` · by ${r.contributor}` : ""}
                </span>
              </span>
              <span className="mono shrink-0 text-right leading-none" style={{ color }}>
                <span className="block text-[18px] font-semibold tabular">{r.score ?? "—"}</span>
                <span className="block text-[8px] tracking-wider">{r.verdict ?? ""}</span>
              </span>
              <span
                role="button"
                tabIndex={0}
                title="Remove this subject everywhere (log, stored report, graph)"
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (!window.confirm(`Remove ${r.query ?? r.ref} everywhere? A rescan will start from scratch.`)) return;
                  purgeSubject(r.ref);
                  setReports((prev) => (prev ?? []).filter((x) => !(x.kind === r.kind && x.ref === r.ref)));
                }}
                className="mono shrink-0 cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:border-avoid hover:text-avoid"
              >
                ×
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
