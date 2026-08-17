import { useEffect, useRef, useState } from "react";
import type { Dossier } from "../data/dossier";
import { exportReportPdf, exportReportDoc } from "../lib/reportExport";

// A small dropdown next to Share/Watch: take the current audit off the screen as
// a portable document. PDF goes through the browser's native print (Save as PDF);
// "Google Doc" downloads a Word/Docs-importable .doc the user opens from Drive.
export function ExportMenu({ dossier }: { dossier: Dossier }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2500);
  };

  const pdf = () => {
    setOpen(false);
    const ok = exportReportPdf(dossier);
    if (!ok) flash("Allow pop-ups for this site, then retry PDF");
  };
  const doc = () => {
    setOpen(false);
    exportReportDoc(dossier);
    flash("Downloaded · open it from Drive with Google Docs");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink"
        title="Export this report as PDF or a Google Doc"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        Export
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-lg border border-line bg-panel shadow-lg">
          <button onClick={pdf} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-panel-2/60">
            <span className="mono mt-0.5 text-[11px] text-ink-faint">PDF</span>
            <span>
              <span className="block text-[12.5px] text-ink">Save as PDF</span>
              <span className="block text-[11px] text-ink-faint">print-ready · via your browser</span>
            </span>
          </button>
          <div className="h-px bg-line" />
          <button onClick={doc} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-panel-2/60">
            <span className="mono mt-0.5 text-[11px] text-ink-faint">DOC</span>
            <span>
              <span className="block text-[12.5px] text-ink">Google Doc</span>
              <span className="block text-[11px] text-ink-faint">.doc · open from Drive or Word</span>
            </span>
          </button>
        </div>
      )}

      {note && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-lg border border-line bg-panel px-3 py-2 text-[11.5px] text-ink-dim shadow-lg">
          {note}
        </div>
      )}
    </div>
  );
}
