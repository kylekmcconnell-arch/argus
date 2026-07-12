import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import {
  BellIcon,
  BuildingsIcon,
  CaretDownIcon,
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  CrosshairIcon,
  CubeIcon,
  FilesIcon,
  GitBranchIcon,
  GlobeSimpleIcon,
  InfoIcon,
  KeyIcon,
  MegaphoneIcon,
  MoonIcon,
  PlugsConnectedIcon,
  SignOutIcon,
  StarIcon,
  SunIcon,
  UserFocusIcon,
  UsersThreeIcon,
  WalletIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useArgusAuth } from "../auth-context";
import { ArgusMark } from "./ArgusMark";
import { verdictMeta } from "../lib/verdict";
import { getWatchlist } from "../lib/watchlist";
import { mergedLog, presentedAuditVerdict, subscribeLog, type LogEntry } from "../lib/auditlog";
import { activeRuns, subscribeRuns } from "../lib/runner";
import { activeScans, subscribeScans } from "../lib/activescans";
import { activeScanRuns, subscribeScanRuns } from "../lib/scanrunner";
import { getAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";
import type { ReportKind } from "../lib/reports";
import { normalizeSubjectRef } from "../lib/subjectRef";
import { recentReportHref } from "../lib/recentReportRoute";
import { currentArgusTheme, nextArgusTheme, setArgusTheme, type ArgusTheme } from "../lib/theme";

// Subject thumbnail: the real logo/photo, falling back to a letter if it is
// missing or fails to load (unavatar/favicon/dexscreener can 404).
function AuditAvatar({ src, letter }: { src: string | null; letter: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-6 w-6 shrink-0 rounded-md border border-line bg-panel-2 object-cover"
      />
    );
  }
  return (
    <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal-lift">
      {letter}
    </span>
  );
}

// Most recent audits (mine + the shared community feed), de-duped by what was
// audited (one row per subject, newest).
function recentAudits(max: number): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of mergedLog()) {
    const k = `${e.kind}:${normalizeSubjectRef(e.ref ?? e.query)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

const KIND_LABEL: Record<LogEntry["kind"], string> = { person: "handle", token: "token", site: "site" };

// Left rail: grouped investigation tools, compact case history, and account.
type NavIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean }>;

function NavItem({ icon: Icon, label, active, onClick, badge, nested = false }: { icon: NavIcon; label: string; active?: boolean; onClick?: () => void; badge?: number; nested?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-9 w-full items-center gap-2.5 rounded-md py-2 pr-2.5 text-[13.5px] transition ${nested ? "pl-7" : "pl-2.5"} ${
        active ? "bg-signal/[0.09] text-ink" : "text-ink-dim hover:bg-panel/70 hover:text-ink"
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-signal" aria-hidden />}
      <span className={active ? "text-signal-lift" : "text-ink-faint"}>
        <Icon size={17} weight={active ? "bold" : "regular"} aria-hidden />
      </span>
      <span className="truncate">{label}</span>
      {badge ? <span className="mono ml-auto rounded-full bg-signal/15 px-1.5 text-[10px] text-signal-lift">{badge}</span> : null}
    </button>
  );
}

// Group label inside the rail: quieter than .eyebrow (the rail repeats it often).
function NavGroup({ label }: { label: string }) {
  return (
    <div className="mono px-2.5 pb-1 pt-3.5 text-[10px] uppercase tracking-[0.14em] text-ink-faint/80">
      {label}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ArgusTheme>(() => currentArgusTheme());
  const toggle = () => {
    const next = nextArgusTheme(theme);
    setArgusTheme(next);
    setTheme(next);
  };
  const actionLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" onClick={toggle} aria-label={actionLabel} title={actionLabel} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-ink-dim transition hover:bg-panel/70 hover:text-ink">
      <span className="text-ink-faint">
        {theme === "dark" ? <SunIcon size={17} aria-hidden /> : <MoonIcon size={17} aria-hidden />}
      </span>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

// Verified account identity replaces the old client-editable contributor label.
// The backend independently derives this value from the authenticated member.
function AnalystBadge() {
  const auth = useArgusAuth();
  const name = auth.user.displayName || auth.user.email;
  const initial = (name[0] || "?").toUpperCase();
  return (
    <div className="mt-1 flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-[12.5px] font-semibold text-white">{initial}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-ink">{name}</div>
        <div className="truncate text-[11px] text-ink-dim">{auth.role} · verified</div>
      </div>
      <button
        type="button"
        onClick={() => void auth.signOut()}
        title="Sign out"
        aria-label="Sign out"
        className="rounded p-1 text-ink-faint transition hover:bg-panel hover:text-ink"
      >
        <SignOutIcon size={16} aria-hidden />
      </button>
    </div>
  );
}

export type NavTarget = "idle" | "radar" | "trending" | "recon" | "find" | "dossiers" | "graph" | "kols" | "founders" | "projects" | "vcs" | "watchlist" | "alerts" | "track" | "admin" | "about" | "api" | "providers" | "changelog";

export function Sidebar({
  onNav,
  onAudit,
  onOpenRecent,
  activeHandle,
  view,
  open,
  mobile = false,
  onClose,
}: {
  onNav: (t: NavTarget) => void;
  onAudit: (handle: string) => void;
  onOpenRecent?: (ref: string, kind?: ReportKind) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
  open?: boolean;
  mobile?: boolean;
  onClose?: () => void;
}) {
  const auth = useArgusAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const directoryActive = view === "founders" || view === "projects" || view === "kols" || view === "vcs";
  const [directoriesOpen, setDirectoriesOpen] = useState(false);
  const nav = (t: NavTarget) => { onNav(t); onClose?.(); };
  // Recent-audit clicks SHOW the cached result (with Rescan) rather than re-run.
  const openRecent = (ref: string, kind?: ReportKind) => {
    if (onOpenRecent) onOpenRecent(ref, kind);
    else onAudit(ref);
    onClose?.();
  };
  const [, setTick] = useState(0);
  // Re-render when the shared audit log hydrates/updates OR a background run
  // records real evidence and flips into the finished audit.
  useEffect(() => {
    const a = subscribeLog(() => setTick((t) => t + 1));
    const b = subscribeRuns(() => setTick((t) => t + 1));
    const c = subscribeScans(() => setTick((t) => t + 1));
    const d = subscribeScanRuns(() => setTick((t) => t + 1));
    return () => { a(); b(); c(); d(); };
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("inert"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    drawer.addEventListener("keydown", onKeyDown);
    return () => drawer.removeEventListener("keydown", onKeyDown);
  }, [mobile, onClose, open]);
  const running = activeRuns();
  const runningKeys = new Set(running.map((r) => r.key));
  // Everything in flight beyond person audits: backgrounded token/investigation
  // scans (scanrunner) + foreground site recons (activescans) — same chip.
  const scans = [
    ...activeScanRuns().map((r) => ({
      id: r.id,
      label: r.label,
      ref: r.ref,
      kind: r.kind,
      events: r.steps.length,
      activity: r.hop ?? r.steps.at(-1)?.label ?? "Preparing evidence acquisition",
    })),
    ...activeScans().map((s) => ({
      id: s.id,
      label: s.label,
      ref: s.ref,
      kind: s.kind,
      events: null,
      activity: s.kind === "site" ? "Site recon active" : "Evidence acquisition active",
    })),
  ];
  // A subject being scanned right now shows only its live chip, not its old row.
  const scanRefs = new Set(scans.map((s) => normalizeSubjectRef(s.ref)));
  const recent = recentAudits(5).filter((e) => {
    const ref = normalizeSubjectRef(e.ref ?? e.query);
    return !runningKeys.has(ref) && !scanRefs.has(ref);
  });
  const me = getAnalyst();
  return (
    <aside
      ref={drawerRef}
      id="argus-navigation-drawer"
      role={open && mobile ? "dialog" : undefined}
      aria-modal={open && mobile ? true : undefined}
      aria-label={open && mobile ? "ARGUS navigation" : undefined}
      aria-hidden={mobile && !open ? true : undefined}
      inert={mobile && !open ? true : undefined}
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-sidebar transition-transform lg:static lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* brand */}
      <div className="flex min-h-16 items-center gap-2 px-4">
        <button type="button" onClick={() => nav("idle")} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left">
          <ArgusMark size={26} />
          <span className="display text-[15px] tracking-[0.02em] text-ink">ARGUS</span>
          <span className="chip ml-auto">v3.0</span>
        </button>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-dim transition hover:bg-panel hover:text-ink lg:hidden"
        >
          <XIcon size={19} aria-hidden />
        </button>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto pb-3">
        {/* primary navigation */}
        <nav aria-label="Primary" className="space-y-px px-2.5">
          <NavGroup label="Investigate" />
          <NavItem icon={FilesIcon} label="Investigation canvas" active={view === "idle"} onClick={() => nav("idle")} />
          <NavItem icon={CrosshairIcon} label="Radar" active={view === "radar"} onClick={() => nav("radar")} />
          <NavItem icon={GlobeSimpleIcon} label="Site recon" active={view === "recon"} onClick={() => nav("recon")} />
          <NavItem icon={WalletIcon} label="Find wallet" active={view === "find"} onClick={() => nav("find")} />

          <NavGroup label="Intelligence" />
          <NavItem icon={GitBranchIcon} label="Trust graph" active={view === "graph"} onClick={() => nav("graph")} />
          <NavItem icon={ChartLineUpIcon} label="Market signals" active={view === "trending"} onClick={() => nav("trending")} />
          <details
            open={directoryActive || directoriesOpen}
            onToggle={(event) => setDirectoriesOpen(event.currentTarget.open)}
            className="group"
          >
            <summary className={`flex min-h-9 cursor-pointer list-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition hover:bg-panel/70 hover:text-ink [&::-webkit-details-marker]:hidden ${directoryActive ? "text-ink" : "text-ink-dim"}`}>
              <UsersThreeIcon size={17} weight={directoryActive ? "bold" : "regular"} className={directoryActive ? "text-signal-lift" : "text-ink-faint"} aria-hidden />
              <span>Entity library</span>
              <CaretDownIcon size={14} className="ml-auto text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-px">
              <NavItem nested icon={UserFocusIcon} label="Founders" active={view === "founders"} onClick={() => nav("founders")} />
              <NavItem nested icon={CubeIcon} label="Projects" active={view === "projects"} onClick={() => nav("projects")} />
              <NavItem nested icon={MegaphoneIcon} label="KOLs" active={view === "kols"} onClick={() => nav("kols")} />
              <NavItem nested icon={BuildingsIcon} label="VCs" active={view === "vcs"} onClick={() => nav("vcs")} />
            </div>
          </details>

          <NavGroup label="Cases" />
          <NavItem icon={FilesIcon} label="All cases" active={view === "dossiers"} onClick={() => nav("dossiers")} />
          <NavItem icon={StarIcon} label="Watchlist" active={view === "watchlist"} onClick={() => nav("watchlist")} badge={getWatchlist().length || undefined} />

          <NavGroup label="Workspace" />
          <NavItem icon={BellIcon} label="Alerts" active={view === "alerts"} onClick={() => nav("alerts")} />
          <NavItem icon={PlugsConnectedIcon} label="Data sources" active={view === "providers"} onClick={() => nav("providers")} />
          <NavItem icon={KeyIcon} label={auth.role === "owner" ? "Audit & access" : "Audit log"} active={view === "admin"} onClick={() => nav("admin")} />
        </nav>

        {/* recent cases */}
        <section aria-labelledby="recent-cases-label" className="mt-4 border-t border-line/70 pt-3">
          <div id="recent-cases-label" className="eyebrow px-4">Recent cases</div>
          <div className="mt-1.5 space-y-0.5 px-2.5">
        {/* In-progress background runs: keep streaming across navigation and flip
            into the finished audit below the moment they complete. Click to jump
            back into the live console. */}
        {running.map((r) => {
          const active = activeHandle === r.handle;
          const avatar = (r.handle.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
          return (
            <button
              type="button"
              key={`run:${r.key}`}
              onClick={() => openRecent(r.handle, "person")}
              title="Generating. Click to watch. Keeps running if you navigate away."
              className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${active ? "bg-panel soft-shadow" : "hover:bg-panel/70"}`}
            >
              <span className="mono relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal-lift">
                {avatar}
                <span className="pulse-ring absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal ring-2 ring-sidebar" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{r.handle}</span>
                <span className="mono block truncate text-[11px] text-signal-lift">
                  {r.steps.length} evidence {r.steps.length === 1 ? "event" : "events"} · {r.steps.at(-1)?.phase ?? "initializing"}
                </span>
                <span className="scan-bar mt-1 block w-full" aria-hidden />
              </span>
            </button>
          );
        })}
        {/* Foreground scans in flight (token / site / investigation) — a live
            "scanning…" indicator so a rescan is visible in the rail until done. */}
        {scans.map((s) => {
          const avatar = (s.label.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
          return (
            <button
              type="button"
              key={`scan:${s.id}`}
              onClick={() => openRecent(s.ref, s.kind)}
              title={`Scanning ${s.label} (${s.kind})…`}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-panel/70"
            >
              <span className="mono relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal-lift">
                {avatar}
                <span className="pulse-ring absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal ring-2 ring-sidebar" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{s.label}</span>
                <span className="mono block truncate text-[11px] text-signal-lift">
                  {s.events === null ? s.activity : `${s.events} evidence ${s.events === 1 ? "event" : "events"} · ${s.activity}`}
                </span>
                <span className="scan-bar mt-1 block w-full" aria-hidden />
              </span>
            </button>
          );
        })}
        {recent.length === 0 && running.length === 0 && scans.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] leading-snug text-ink-faint">
            Nothing yet. Audit a handle, token, or site and it lands here.
          </div>
        ) : (
          recent.map((e) => {
            const ref = e.ref ?? e.query;
            const kind = e.flags?.some((flag) => flag.toLowerCase() === "investigation") ? "investigation" : e.kind;
            const displayedVerdict = presentedAuditVerdict(e);
            const vm = displayedVerdict ? verdictMeta(displayedVerdict) : null;
            const active = activeHandle === ref || activeHandle === e.query;
            const avatar = (e.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
            return (
              <a
                key={e.id}
                href={recentReportHref(ref, kind)}
                onClick={(event) => {
                  if (!onOpenRecent) return;
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onOpenRecent(ref, kind);
                  onClose?.();
                }}
                className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                  active ? "bg-panel soft-shadow" : "hover:bg-panel/70"
                }`}
              >
                <AuditAvatar src={auditImage(e)} letter={avatar} />
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[12.5px] text-ink">{e.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {KIND_LABEL[e.kind]}{typeof e.score === "number" ? ` · ${e.score}` : ""}{displayedVerdict === "INCOMPLETE" ? " · incomplete" : ""}
                    {e.contributor && e.contributor !== me && e.contributor !== "anonymous" && (
                      <span className="text-signal-lift"> · {e.contributor}</span>
                    )}
                  </span>
                </span>
                {vm && <span className="tint-var h-1.5 w-1.5 shrink-0 rounded-full" style={{ "--tint": vm.color } as CSSProperties} />}
              </a>
            );
          })
        )}
          </div>
          {(recent.length > 0 || running.length > 0 || scans.length > 0) && (
            <button
              type="button"
              onClick={() => nav("dossiers")}
              className="btn-ghost mono ml-4 mt-2 text-[11px] text-signal-lift"
            >
              View all cases →
            </button>
          )}
        </section>
      </div>

      {/* account */}
      <div className="mt-auto border-t border-line px-2.5 py-2.5">
        <NavItem icon={InfoIcon} label="How it works" active={view === "about"} onClick={() => nav("about")} />
        <NavItem icon={CodeIcon} label="API" active={view === "api"} onClick={() => nav("api")} />
        <NavItem icon={ClockCounterClockwiseIcon} label="Changelog" active={view === "changelog"} onClick={() => nav("changelog")} />
        <ThemeToggle />
        <AnalystBadge />
      </div>
    </aside>
  );
}
