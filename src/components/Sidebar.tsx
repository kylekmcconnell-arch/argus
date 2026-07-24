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
import { auditReadinessLabel, mergedLog, subscribeLog, type LogEntry } from "../lib/auditlog";
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

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
  nested = false,
  compact = false,
}: {
  icon: NavIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
  nested?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={compact ? label : undefined}
      className={`relative flex min-h-9 w-full items-center rounded-md py-2 text-[13.5px] transition ${compact ? "justify-center px-0" : `gap-2.5 pr-2.5 ${nested ? "pl-7" : "pl-2.5"}`} ${
        active ? "sidebar-nav-active" : "text-ink-dim hover:bg-panel/70 hover:text-ink"
      }`}
    >
      {active && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-on-signal/80" aria-hidden />}
      <span className={active ? "text-on-signal" : "text-ink-faint"}>
        <Icon size={17} weight={active ? "bold" : "regular"} aria-hidden />
      </span>
      <span className={compact ? "sr-only" : "truncate"}>{label}</span>
      {badge ? <span className={`mono rounded-full bg-signal/15 px-1.5 text-[10px] text-signal-lift ${compact ? "absolute right-0 top-0" : "ml-auto"}`}>{badge}</span> : null}
    </button>
  );
}

// Group label inside the rail: quieter than .eyebrow (the rail repeats it often).
function NavGroup({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={compact ? "sr-only" : "mono px-2.5 pb-1 pt-3.5 text-[10px] uppercase tracking-[0.14em] text-ink-faint/80"}>
      {label}
    </div>
  );
}

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ArgusTheme>(() => currentArgusTheme());
  const toggle = () => {
    const next = nextArgusTheme(theme);
    setArgusTheme(next);
    setTheme(next);
  };
  const actionLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" onClick={toggle} aria-label={actionLabel} title={actionLabel} className={`flex min-h-9 w-full items-center rounded-md py-2 text-[13.5px] text-ink-dim transition hover:bg-panel/70 hover:text-ink ${compact ? "justify-center px-0" : "gap-2.5 px-2.5"}`}>
      <span className="text-ink-faint">
        {theme === "dark" ? <SunIcon size={17} aria-hidden /> : <MoonIcon size={17} aria-hidden />}
      </span>
      <span className={compact ? "sr-only" : undefined}>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

// Verified account identity replaces the old client-editable contributor label.
// The backend independently derives this value from the authenticated member.
function AnalystBadge({ compact = false }: { compact?: boolean }) {
  const auth = useArgusAuth();
  const name = auth.user.displayName || auth.user.email;
  const initial = (name[0] || "?").toUpperCase();
  return (
    <div className={`mt-1 flex items-center rounded-md py-1.5 ${compact ? "justify-center gap-1 px-0" : "gap-2.5 px-2.5"}`}>
      <span title={compact ? `${name} · ${auth.role}` : undefined} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-[12.5px] font-semibold text-white">{initial}</span>
      <div className={compact ? "sr-only" : "min-w-0 flex-1"}>
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
  compact: requestedCompact = false,
  onClose,
}: {
  onNav: (t: NavTarget) => void;
  onAudit: (handle: string) => void;
  onOpenRecent?: (ref: string, kind?: ReportKind) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
  open?: boolean;
  mobile?: boolean;
  compact?: boolean;
  onClose?: () => void;
}) {
  const auth = useArgusAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Reports need more canvas, but collapsing the rail to icons removes too much
  // navigation context. Keep labels at every desktop width, use a modest laptop
  // width for audit surfaces, and restore the full rail at xl.
  const reportLayout = view === "audit" && !mobile;
  const compact = requestedCompact && !mobile;
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
  const recent = recentAudits(compact ? 3 : 5).filter((e) => {
    const ref = normalizeSubjectRef(e.ref ?? e.query);
    return !runningKeys.has(ref) && !scanRefs.has(ref);
  });
  const me = getAnalyst();
  const accountControls = (
    <div className={`${mobile ? "mt-4" : "mt-auto"} border-t border-line py-2.5 ${compact ? "px-2" : "px-2.5"}`} data-sidebar-account>
      <NavItem compact={compact} icon={InfoIcon} label="How it works" active={view === "about"} onClick={() => nav("about")} />
      <NavItem compact={compact} icon={CodeIcon} label="API" active={view === "api"} onClick={() => nav("api")} />
      <NavItem compact={compact} icon={ClockCounterClockwiseIcon} label="Changelog" active={view === "changelog"} onClick={() => nav("changelog")} />
      <ThemeToggle compact={compact} />
      <AnalystBadge compact={compact} />
    </div>
  );
  return (
    <aside
      ref={drawerRef}
      id="argus-navigation-drawer"
      role={open && mobile ? "dialog" : undefined}
      aria-modal={open && mobile ? true : undefined}
      aria-label={open && mobile ? "ARGUS navigation" : undefined}
      aria-hidden={mobile && !open ? true : undefined}
      inert={mobile && !open ? true : undefined}
      data-sidebar-mode={reportLayout ? "report" : "standard"}
      className={`app-sidebar fixed inset-y-0 left-0 z-40 flex h-full w-[248px] shrink-0 flex-col border-r border-line-2 bg-sidebar transition-[transform,width] duration-200 lg:static lg:translate-x-0 ${
        "lg:w-[248px]"
      } ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* brand */}
      <div className={`flex min-h-16 items-center gap-2 ${compact ? "justify-center px-2" : "px-4"}`}>
        <button type="button" onClick={() => nav("idle")} title={compact ? "ARGUS home" : undefined} className={`flex min-w-0 items-center rounded-md text-left ${compact ? "justify-center" : "flex-1 gap-2.5"}`}>
          <ArgusMark size={26} />
          <span className={compact ? "sr-only" : "display text-[15px] tracking-[0.02em] text-ink"}>ARGUS</span>
          <span className={compact ? "sr-only" : "chip ml-auto"}>v3.0</span>
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
        <nav aria-label="Primary" className={`space-y-px ${compact ? "px-2" : "px-2.5"}`}>
          <NavGroup compact={compact} label="Investigate" />
          <NavItem compact={compact} icon={FilesIcon} label="New investigation" active={view === "idle" || view === "audit"} onClick={() => nav("idle")} />
          <NavItem compact={compact} icon={CrosshairIcon} label="Radar" active={view === "radar"} onClick={() => nav("radar")} />
          <NavItem compact={compact} icon={GlobeSimpleIcon} label="Website check" active={view === "recon"} onClick={() => nav("recon")} />
          <NavItem compact={compact} icon={WalletIcon} label="Find wallet" active={view === "find"} onClick={() => nav("find")} />

          <NavGroup compact={compact} label="Intelligence" />
          <NavItem compact={compact} icon={GitBranchIcon} label="Connections" active={view === "graph"} onClick={() => nav("graph")} />
          <NavItem compact={compact} icon={ChartLineUpIcon} label="Market trends" active={view === "trending"} onClick={() => nav("trending")} />
          {compact ? (
            <NavItem compact icon={UsersThreeIcon} label="People & projects" active={directoryActive} onClick={() => nav("founders")} />
          ) : (
            <details
              open={directoryActive || directoriesOpen}
              onToggle={(event) => setDirectoriesOpen(event.currentTarget.open)}
              className="group"
            >
              <summary className={`flex min-h-9 cursor-pointer list-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition hover:bg-panel/70 hover:text-ink [&::-webkit-details-marker]:hidden ${directoryActive ? "text-ink" : "text-ink-dim"}`}>
                <UsersThreeIcon size={17} weight={directoryActive ? "bold" : "regular"} className={directoryActive ? "text-signal-lift" : "text-ink-faint"} aria-hidden />
                <span>People &amp; projects</span>
                <CaretDownIcon size={14} className="ml-auto text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-px">
                <NavItem nested icon={UserFocusIcon} label="Founders" active={view === "founders"} onClick={() => nav("founders")} />
                <NavItem nested icon={CubeIcon} label="Projects" active={view === "projects"} onClick={() => nav("projects")} />
                <NavItem nested icon={MegaphoneIcon} label="KOLs" active={view === "kols"} onClick={() => nav("kols")} />
                <NavItem nested icon={BuildingsIcon} label="VCs" active={view === "vcs"} onClick={() => nav("vcs")} />
              </div>
            </details>
          )}

          <NavGroup compact={compact} label="Cases" />
          <NavItem compact={compact} icon={FilesIcon} label="All cases" active={view === "dossiers"} onClick={() => nav("dossiers")} />
          <NavItem compact={compact} icon={StarIcon} label="Watchlist" active={view === "watchlist"} onClick={() => nav("watchlist")} badge={getWatchlist().length || undefined} />

          <NavGroup compact={compact} label="Workspace" />
          <NavItem compact={compact} icon={BellIcon} label="Alerts" active={view === "alerts"} onClick={() => nav("alerts")} />
          <NavItem compact={compact} icon={PlugsConnectedIcon} label="Data sources" active={view === "providers"} onClick={() => nav("providers")} />
          <NavItem compact={compact} icon={KeyIcon} label={auth.role === "owner" ? "Access & activity" : "Activity log"} active={view === "admin"} onClick={() => nav("admin")} />
        </nav>

        {/* recent cases */}
        <section aria-labelledby="recent-cases-label" className={`${compact ? "mt-3 px-2 pt-2" : "mt-4 pt-3"} border-t border-line/70`}>
          <div id="recent-cases-label" className={compact ? "sr-only" : "eyebrow px-4"}>Recent cases</div>
          <div className={`${compact ? "mt-0 space-y-1 px-0" : "mt-1.5 space-y-0.5 px-2.5"}`}>
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
              className={`group flex w-full items-center rounded-md py-1.5 text-left transition ${compact ? "justify-center px-0" : "gap-2 px-2"} ${active ? "sidebar-case-active" : "hover:bg-panel/70"}`}
            >
              <span className="mono relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal-lift">
                {avatar}
                <span className="pulse-ring absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal ring-2 ring-sidebar" aria-hidden />
              </span>
              <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
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
              className={`group flex w-full items-center rounded-md py-1.5 text-left transition hover:bg-panel/70 ${compact ? "justify-center px-0" : "gap-2 px-2"}`}
            >
              <span className="mono relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal-lift">
                {avatar}
                <span className="pulse-ring absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal ring-2 ring-sidebar" aria-hidden />
              </span>
              <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
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
          <div className={compact ? "sr-only" : "px-2 py-1.5 text-[11px] leading-snug text-ink-faint"}>
            Nothing yet. Audit a handle, token, or site and it lands here.
          </div>
        ) : (
          recent.map((e) => {
            const ref = e.ref ?? e.query;
            const kind = e.flags?.some((flag) => flag.toLowerCase() === "investigation") ? "investigation" : e.kind;
            const readinessLabel = auditReadinessLabel(e);
            const vm = readinessLabel ? verdictMeta(readinessLabel) : null;
            const active = activeHandle === ref || activeHandle === e.query;
            const avatar = (e.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
            return (
              <a
                key={e.id}
                href={recentReportHref(ref, kind)}
                title={compact ? e.query.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined}
                onClick={(event) => {
                  if (!onOpenRecent) return;
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onOpenRecent(ref, kind);
                  onClose?.();
                }}
                className={`group relative flex w-full items-center rounded-md py-1.5 text-left transition ${compact ? "justify-center px-0" : "gap-2 px-2"} ${
                  active ? "sidebar-case-active" : "hover:bg-panel/70"
                }`}
              >
                <AuditAvatar src={auditImage(e)} letter={avatar} />
                <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
                  <span className="mono block truncate text-[12.5px] text-ink">{e.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {KIND_LABEL[e.kind]}{typeof e.score === "number" ? ` · ${e.score}` : ""}{readinessLabel === "PROVISIONAL" ? " · checks open" : readinessLabel === "BLOCKED" ? " · not ready" : ""}
                    {e.contributor && e.contributor !== me && e.contributor !== "anonymous" && (
                      <span className="text-signal-lift"> · {e.contributor}</span>
                    )}
                  </span>
                </span>
                {vm && <span className={`tint-var h-1.5 w-1.5 shrink-0 rounded-full ${compact ? "absolute ml-5 mt-5" : ""}`} style={{ "--tint": vm.color } as CSSProperties} />}
              </a>
            );
          })
        )}
          </div>
          {!compact && (recent.length > 0 || running.length > 0 || scans.length > 0) && (
            <button
              type="button"
              onClick={() => nav("dossiers")}
              className="btn-ghost mono ml-4 mt-2 text-[11px] text-signal-lift"
            >
              View all cases →
            </button>
          )}
        </section>
        {mobile && accountControls}
      </div>

      {/* account */}
      {!mobile && accountControls}
    </aside>
  );
}
