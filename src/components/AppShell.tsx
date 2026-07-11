import { useState, type ReactNode } from "react";
import { Sidebar, type NavTarget } from "./Sidebar";
import { ArgusMark } from "./ArgusMark";
import type { ReportKind } from "../lib/reports";

// Persistent shell: left rail + a pink-tinted announcement bar + scrolling main,
// matching the origami.chat dashboard chrome. On mobile the rail becomes a drawer.
export function AppShell({
  children,
  onNav,
  onAudit,
  onOpenRecent,
  activeHandle,
  view,
}: {
  children: ReactNode;
  onNav: (t: NavTarget) => void;
  onAudit: (handle: string) => void;
  onOpenRecent?: (ref: string, kind?: ReportKind) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-void">
      {open && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      <Sidebar onNav={onNav} onAudit={onAudit} onOpenRecent={onOpenRecent} activeHandle={activeHandle} view={view} open={open} onClose={() => setOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* mobile top bar */}
        <div className="flex items-center gap-3 border-b border-line bg-void px-4 py-2.5 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-ink-dim">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <ArgusMark size={22} />
          <span className="mono text-[13px] font-semibold tracking-[0.2em] text-ink">ARGUS</span>
        </div>

        <div
          className="flex items-center justify-center gap-2 border-b border-line px-4 py-2 text-center text-[12px] text-ink-dim"
          style={{ background: "var(--color-accent-tint)" }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
          <span className="truncate">Forensic due-diligence. Paste an X handle or a token contract.</span>
        </div>
        <main className="thin-scroll flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
