import type { ReactNode } from "react";
import { Sidebar, type NavTarget } from "./Sidebar";

// Persistent shell: left rail + a pink-tinted announcement bar + scrolling main,
// matching the origami.chat dashboard chrome.
export function AppShell({
  children,
  onNav,
  onAudit,
  activeHandle,
  view,
}: {
  children: ReactNode;
  onNav: (t: NavTarget) => void;
  onAudit: (handle: string) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <Sidebar onNav={onNav} onAudit={onAudit} activeHandle={activeHandle} view={view} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className="flex items-center justify-center gap-2 border-b border-line px-4 py-2 text-center text-[12px] text-ink-dim"
          style={{ background: "var(--color-accent-tint)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-signal" />
          Forensic due-diligence, person by person. Paste any X handle to begin.
        </div>
        <main className="thin-scroll flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
