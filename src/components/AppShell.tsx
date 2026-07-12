import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ListIcon } from "@phosphor-icons/react";
import { Sidebar, type NavTarget } from "./Sidebar";
import { ArgusMark } from "./ArgusMark";
import type { ReportKind } from "../lib/reports";

// Persistent shell: left rail + scrolling main. On mobile the rail becomes a
// drawer. The old static announcement bar is gone — ServiceAlert (rendered by
// pages that need it) is the only banner, so real alerts stand out.
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
  const [mobile, setMobile] = useState(() => (
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 1023px)").matches
  ));
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    const restoreFocus = () => menuButtonRef.current?.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restoreFocus);
    else restoreFocus();
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <a
        href="#argus-main-content"
        className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-md border border-signal bg-panel-2 px-3 py-2 text-[13.5px] font-medium text-ink transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      {open && mobile && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-void/80 lg:hidden"
          onClick={closeDrawer}
        />
      )}
      <Sidebar
        onNav={onNav}
        onAudit={onAudit}
        onOpenRecent={onOpenRecent}
        activeHandle={activeHandle}
        view={view}
        open={open}
        mobile={mobile}
        onClose={open ? closeDrawer : undefined}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* mobile top bar */}
        <div className="flex min-h-14 items-center gap-3 border-b border-line bg-sidebar px-4 lg:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="argus-navigation-drawer"
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded-md text-ink-dim transition hover:bg-panel hover:text-ink"
          >
            <ListIcon size={21} weight="regular" aria-hidden />
          </button>
          <ArgusMark size={22} />
          <span className="display text-[13.5px] tracking-[0.02em] text-ink">ARGUS</span>
          <span className="mono ml-auto hidden text-[10px] uppercase tracking-[0.12em] text-ink-faint sm:block">Investigation canvas</span>
        </div>

        <main id="argus-main-content" tabIndex={-1} className="thin-scroll atmosphere flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
