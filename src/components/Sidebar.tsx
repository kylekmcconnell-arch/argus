import { ArgusMark } from "./ArgusMark";
import { SUBJECTS } from "../data/subjects";
import { ROLE_META, verdictMeta } from "../lib/verdict";
import { buildReport } from "../data/subjects";
import { getWatchlist } from "../lib/watchlist";

// Left rail, origami.chat style: light zinc-100, logo at top, nav, a recent-audits
// list, account at the bottom.

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h14V10",
  radar: "M21 12a9 9 0 1 1-4.6-7.9M12 12l5.5-3.2",
  gallery: "M4 5h16M4 12h16M4 19h16",
  graph: "M5 19V5M5 19h14M9 16l3-5 3 3 4-7",
  watch: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L3.1 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.4h5l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1Z",
};

function NavItem({ icon, label, active, onClick, badge }: { icon: keyof typeof ICONS; label: string; active?: boolean; onClick?: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] transition ${
        active ? "bg-white text-ink soft-shadow" : "text-ink-dim hover:bg-white/70 hover:text-ink"
      }`}
    >
      <span className={active ? "text-signal" : "text-ink-faint"}>
        <Icon d={ICONS[icon]} />
      </span>
      {label}
      {badge ? <span className="mono ml-auto rounded-full bg-signal/15 px-1.5 text-[10px] text-signal-dim">{badge}</span> : null}
    </button>
  );
}

export type NavTarget = "idle" | "radar" | "dossiers" | "graph" | "watchlist";

export function Sidebar({
  onNav,
  onAudit,
  activeHandle,
  view,
  open,
  onClose,
}: {
  onNav: (t: NavTarget) => void;
  onAudit: (handle: string) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
  open?: boolean;
  onClose?: () => void;
}) {
  const nav = (t: NavTarget) => { onNav(t); onClose?.(); };
  const audit = (h: string) => { onAudit(h); onClose?.(); };
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-sidebar transition-transform md:static md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* brand */}
      <button onClick={() => nav("idle")} className="flex items-center gap-2.5 px-4 py-4">
        <ArgusMark size={26} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">ARGUS</span>
        <span className="mono ml-auto rounded border border-line bg-white px-1.5 py-0.5 text-[10px] text-ink-faint">v2.2</span>
      </button>

      {/* nav */}
      <nav className="space-y-0.5 px-2.5 pt-1">
        <NavItem icon="home" label="Home" active={view === "idle"} onClick={() => nav("idle")} />
        <NavItem icon="radar" label="Radar" active={view === "radar"} onClick={() => nav("radar")} />
        <NavItem icon="gallery" label="Dossiers" active={view === "dossiers"} onClick={() => nav("dossiers")} />
        <NavItem icon="graph" label="Trust graph" active={view === "graph"} onClick={() => nav("graph")} />
        <NavItem icon="watch" label="Watchlist" active={view === "watchlist"} onClick={() => nav("watchlist")} badge={getWatchlist().length || undefined} />
      </nav>

      {/* recent audits */}
      <div className="mt-5 px-4 text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink-faint">
        Recent audits
      </div>
      <div className="mt-1.5 space-y-0.5 overflow-y-auto px-2.5 thin-scroll">
        {SUBJECTS.map((s) => {
          const verdict = buildReport(s).report.composite_verdict;
          const vm = verdictMeta(verdict);
          const active = activeHandle === s.handle;
          return (
            <button
              key={s.handle}
              onClick={() => audit(s.handle)}
              className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                active ? "bg-white soft-shadow" : "hover:bg-white/70"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-white text-[11px] text-signal">
                {s.avatar}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{s.handle}</span>
                <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                  {s.roles.slice(0, 3).map((r) => (
                    <span key={r}>{ROLE_META[r].glyph}</span>
                  ))}
                </span>
              </span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: vm.color }} />
            </button>
          );
        })}
      </div>

      {/* account */}
      <div className="mt-auto border-t border-line px-2.5 py-3">
        <NavItem icon="settings" label="Settings" />
        <div className="mt-1 flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-signal text-[12px] font-semibold text-white">K</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] text-ink">Kyle</div>
            <div className="text-[11px] text-ink-faint">Analyst</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
