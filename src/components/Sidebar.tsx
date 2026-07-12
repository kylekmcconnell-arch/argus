import { useEffect, useState } from "react";
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
    <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal">
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

// Left rail: brand, grouped nav, a recent-audits live feed, account block.

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
  info: "M12 16v-5M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  code: "M8 9l-4 3 4 3M16 9l4 3-4 3M14 6l-4 12",
  track: "M3 3v18h18M7 15l3-4 3 3 5-7",
  recon: "M12 3a9 9 0 1 0 9 9M21 3l-7 7M12 7a5 5 0 1 0 5 5",
  admin: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  wallet: "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12M16 13h.01",
  key: "M15 7a4 4 0 1 1-4 4h-1l-2 2-2-2H3v-3l6-6a4 4 0 0 1 6 0M15.5 7.5h.01",
  changelog: "M8 6h11M8 12h11M8 18h11M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  kol: "M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1M14 8a4 4 0 0 1 0 8M17 5a8 8 0 0 1 0 14",
  founder: "M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4l2 2 3.5-3.5M17 11h4",
  vc: "M3 3v18h18M7 14l3-3 3 2 5-6M18 7h3v3",
  project: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3M4 7.5l8 4.5 8-4.5M12 12v9",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  trending: "M3 17l6-6 4 4 8-8M21 7v6h-6",
};

function NavItem({ icon, label, active, onClick, badge }: { icon: keyof typeof ICONS; label: string; active?: boolean; onClick?: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[5.5px] text-[13.5px] transition ${
        active ? "bg-signal/[0.09] text-ink" : "text-ink-dim hover:bg-panel/70 hover:text-ink"
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal" aria-hidden />}
      <span className={active ? "text-signal" : "text-ink-faint"}>
        <Icon d={ICONS[icon]} />
      </span>
      {label}
      {badge ? <span className="mono ml-auto rounded-full bg-signal/15 px-1.5 text-[10px] text-signal-dim">{badge}</span> : null}
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
  const [theme, setTheme] = useState<string>(() => (typeof document !== "undefined" ? document.documentElement.dataset.theme || "dark" : "dark"));
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("argus-theme", next); } catch { /* noop */ }
    setTheme(next);
  };
  return (
    <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-[5.5px] text-[13.5px] text-ink-dim transition hover:bg-panel/70 hover:text-ink">
      <span className="text-ink-faint">
        {theme === "dark" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></svg>
        )}
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        </svg>
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
  onClose,
}: {
  onNav: (t: NavTarget) => void;
  onAudit: (handle: string) => void;
  onOpenRecent?: (ref: string, kind?: ReportKind) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
  open?: boolean;
  onClose?: () => void;
}) {
  const auth = useArgusAuth();
  const nav = (t: NavTarget) => { onNav(t); onClose?.(); };
  // Recent-audit clicks SHOW the cached result (with Rescan) rather than re-run.
  const openRecent = (ref: string, kind?: ReportKind) => {
    if (onOpenRecent) onOpenRecent(ref, kind);
    else onAudit(ref);
    onClose?.();
  };
  const [, setTick] = useState(0);
  // Re-render when the shared audit log hydrates/updates OR a background run
  // makes progress (so "generating…" ticks up and flips to the finished audit).
  useEffect(() => {
    const a = subscribeLog(() => setTick((t) => t + 1));
    const b = subscribeRuns(() => setTick((t) => t + 1));
    const c = subscribeScans(() => setTick((t) => t + 1));
    const d = subscribeScanRuns(() => setTick((t) => t + 1));
    return () => { a(); b(); c(); d(); };
  }, []);
  const running = activeRuns();
  const runningKeys = new Set(running.map((r) => r.key));
  // Everything in flight beyond person audits: backgrounded token/investigation
  // scans (scanrunner) + foreground site recons (activescans) — same chip.
  const scans = [
    ...activeScanRuns().map((r) => ({ id: r.id, label: r.label, pct: r.pct, ref: r.ref, kind: r.kind })),
    ...activeScans().map((s) => ({ id: s.id, label: s.label, pct: s.pct, ref: s.ref, kind: s.kind })),
  ];
  // A subject being scanned right now shows only its live chip, not its old row.
  const scanRefs = new Set(scans.map((s) => normalizeSubjectRef(s.ref)));
  const recent = recentAudits(14).filter((e) => {
    const ref = normalizeSubjectRef(e.ref ?? e.query);
    return !runningKeys.has(ref) && !scanRefs.has(ref);
  });
  const me = getAnalyst();
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-sidebar transition-transform md:static md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* brand */}
      <button onClick={() => nav("idle")} className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <ArgusMark size={26} />
        <span className="display text-[15px] tracking-[0.02em] text-ink">ARGUS</span>
        <span className="chip ml-auto">v2.2</span>
      </button>

      {/* nav */}
      <nav className="space-y-px px-2.5">
        <NavItem icon="home" label="Home" active={view === "idle"} onClick={() => nav("idle")} />
        <NavItem icon="radar" label="Radar" active={view === "radar"} onClick={() => nav("radar")} />
        <NavItem icon="trending" label="Trending" active={view === "trending"} onClick={() => nav("trending")} />
        <NavItem icon="recon" label="Site recon" active={view === "recon"} onClick={() => nav("recon")} />
        <NavItem icon="wallet" label="Find wallet" active={view === "find"} onClick={() => nav("find")} />
        <NavGroup label="Directories" />
        <NavItem icon="gallery" label="Dossiers" active={view === "dossiers"} onClick={() => nav("dossiers")} />
        <NavItem icon="founder" label="Founders" active={view === "founders"} onClick={() => nav("founders")} />
        <NavItem icon="project" label="Projects" active={view === "projects"} onClick={() => nav("projects")} />
        <NavItem icon="kol" label="KOLs" active={view === "kols"} onClick={() => nav("kols")} />
        <NavItem icon="vc" label="VCs" active={view === "vcs"} onClick={() => nav("vcs")} />
        <NavGroup label="Signals" />
        <NavItem icon="graph" label="Trust graph" active={view === "graph"} onClick={() => nav("graph")} />
        <NavItem icon="watch" label="Watchlist" active={view === "watchlist"} onClick={() => nav("watchlist")} badge={getWatchlist().length || undefined} />
        <NavItem icon="bell" label="Alerts" active={view === "alerts"} onClick={() => nav("alerts")} />
        <NavItem icon="admin" label={auth.role === "owner" ? "Audit & access" : "Audit log"} active={view === "admin"} onClick={() => nav("admin")} />
      </nav>

      {/* recent audits */}
      <div className="eyebrow mt-4 px-4">
        Recent audits
      </div>
      <div className="mt-1.5 space-y-0.5 overflow-y-auto px-2.5 thin-scroll">
        {/* In-progress background runs: keep streaming across navigation and flip
            into the finished audit below the moment they complete. Click to jump
            back into the live console. */}
        {running.map((r) => {
          const active = activeHandle === r.handle;
          const avatar = (r.handle.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();
          return (
            <button
              key={`run:${r.key}`}
              onClick={() => openRecent(r.handle, "person")}
              title="Generating — click to watch. Keeps running if you navigate away."
              className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${active ? "bg-panel soft-shadow" : "hover:bg-panel/70"}`}
            >
              <span className="mono relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal">
                {avatar}
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-signal ring-2 ring-sidebar" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{r.handle}</span>
                <span className="mono block truncate text-[11px] text-signal-dim">generating… {r.pct}%</span>
                <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: `${Math.max(6, r.pct)}%` }} />
                </span>
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
              key={`scan:${s.id}`}
              onClick={() => openRecent(s.ref, s.kind)}
              title={`Scanning ${s.label} (${s.kind})…`}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-panel/70"
            >
              <span className="mono relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal">
                {avatar}
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-signal ring-2 ring-sidebar" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12.5px] text-ink">{s.label}</span>
                <span className="mono block truncate text-[11px] text-signal-dim">scanning… {s.pct}%</span>
                <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: `${Math.max(6, s.pct)}%` }} />
                </span>
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
            const displayedVerdict = presentedAuditVerdict(e);
            const vm = displayedVerdict ? verdictMeta(displayedVerdict) : null;
            const active = activeHandle === ref || activeHandle === e.query;
            const avatar = (e.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
            return (
              <button
                key={e.id}
                onClick={() => openRecent(
                  ref,
                  e.flags?.some((flag) => flag.toLowerCase() === "investigation") ? "investigation" : e.kind,
                )}
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
                      <span className="text-signal-dim"> · {e.contributor}</span>
                    )}
                  </span>
                </span>
                {vm && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: vm.color }} />}
              </button>
            );
          })
        )}
      </div>

      {/* account */}
      <div className="mt-auto border-t border-line px-2.5 py-2.5">
        <NavItem icon="key" label="Providers" active={view === "providers"} onClick={() => nav("providers")} />
        <NavItem icon="changelog" label="Changelog" active={view === "changelog"} onClick={() => nav("changelog")} />
        <NavItem icon="code" label="API" active={view === "api"} onClick={() => nav("api")} />
        <NavItem icon="info" label="How it works" active={view === "about"} onClick={() => nav("about")} />
        <ThemeToggle />
        <AnalystBadge />
      </div>
    </aside>
  );
}
