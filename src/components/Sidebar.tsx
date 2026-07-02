import { useEffect, useState } from "react";
import { ArgusMark } from "./ArgusMark";
import { verdictMeta } from "../lib/verdict";
import { getWatchlist } from "../lib/watchlist";
import { mergedLog, subscribeLog, type LogEntry } from "../lib/auditlog";
import { getAnalyst, setAnalyst } from "../lib/analyst";
import { auditImage } from "../lib/avatars";

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
        className="h-6 w-6 shrink-0 rounded-md border border-line bg-panel object-cover"
      />
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-[11px] text-signal">
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
    const k = `${e.kind}:${(e.ref ?? e.query).toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

const KIND_LABEL: Record<LogEntry["kind"], string> = { person: "handle", token: "token", site: "site" };

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
  info: "M12 16v-5M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  code: "M8 9l-4 3 4 3M16 9l4 3-4 3M14 6l-4 12",
  track: "M3 3v18h18M7 15l3-4 3 3 5-7",
  recon: "M12 3a9 9 0 1 0 9 9M21 3l-7 7M12 7a5 5 0 1 0 5 5",
  admin: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  wallet: "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12M16 13h.01",
  key: "M15 7a4 4 0 1 1-4 4h-1l-2 2-2-2H3v-3l6-6a4 4 0 0 1 6 0M15.5 7.5h.01",
  changelog: "M8 6h11M8 12h11M8 18h11M3.5 6h.01M3.5 12h.01M3.5 18h.01",
};

function NavItem({ icon, label, active, onClick, badge }: { icon: keyof typeof ICONS; label: string; active?: boolean; onClick?: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] transition ${
        active ? "bg-panel text-ink soft-shadow" : "text-ink-dim hover:bg-panel/70 hover:text-ink"
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

function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => (typeof document !== "undefined" ? document.documentElement.dataset.theme || "dark" : "dark"));
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("argus-theme", next); } catch { /* noop */ }
    setTheme(next);
  };
  return (
    <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] text-ink-dim transition hover:bg-panel/70 hover:text-ink">
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

// Who's signing audits — sets the contributor tag on shared-log rows so Kyle and
// Enigma can tell their scans apart. Click to edit; stored locally.
function AnalystBadge() {
  const [name, setName] = useState(getAnalyst);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const save = () => {
    const v = draft.trim();
    setAnalyst(v);
    setName(getAnalyst());
    setEditing(false);
  };
  const initial = (name === "anonymous" ? "?" : name[0] || "?").toUpperCase();
  return (
    <div className="mt-1 flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-[12px] font-semibold text-white">{initial}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          placeholder="your name (e.g. Kyle)"
          className="mono min-w-0 flex-1 rounded border border-line bg-panel px-1.5 py-1 text-[12px] text-ink outline-none focus:border-signal"
        />
      ) : (
        <button onClick={() => { setDraft(name === "anonymous" ? "" : name); setEditing(true); }} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13px] text-ink">{name === "anonymous" ? "Set your name" : name}</div>
          <div className="text-[11px] text-ink-faint">Signing audits as · edit</div>
        </button>
      )}
    </div>
  );
}

export type NavTarget = "idle" | "radar" | "recon" | "find" | "dossiers" | "graph" | "watchlist" | "track" | "admin" | "about" | "api" | "providers" | "changelog";

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
  onOpenRecent?: (ref: string) => void;
  activeHandle?: string | null;
  view: NavTarget | "audit";
  open?: boolean;
  onClose?: () => void;
}) {
  const nav = (t: NavTarget) => { onNav(t); onClose?.(); };
  // Recent-audit clicks SHOW the cached result (with Rescan) rather than re-run.
  const openRecent = (h: string) => { (onOpenRecent ?? onAudit)(h); onClose?.(); };
  const [, setTick] = useState(0);
  // Re-render when the shared audit log hydrates or a new audit is logged.
  useEffect(() => subscribeLog(() => setTick((t) => t + 1)), []);
  const recent = recentAudits(14);
  const me = getAnalyst();
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
        <span className="mono ml-auto rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] text-ink-faint">v2.2</span>
      </button>

      {/* nav */}
      <nav className="space-y-0.5 px-2.5 pt-1">
        <NavItem icon="home" label="Home" active={view === "idle"} onClick={() => nav("idle")} />
        <NavItem icon="radar" label="Radar" active={view === "radar"} onClick={() => nav("radar")} />
        <NavItem icon="recon" label="Site recon" active={view === "recon"} onClick={() => nav("recon")} />
        <NavItem icon="wallet" label="Find wallet" active={view === "find"} onClick={() => nav("find")} />
        <NavItem icon="gallery" label="Dossiers" active={view === "dossiers"} onClick={() => nav("dossiers")} />
        <NavItem icon="graph" label="Trust graph" active={view === "graph"} onClick={() => nav("graph")} />
        <NavItem icon="watch" label="Watchlist" active={view === "watchlist"} onClick={() => nav("watchlist")} badge={getWatchlist().length || undefined} />
        <NavItem icon="track" label="Track record" active={view === "track"} onClick={() => nav("track")} />
        <NavItem icon="admin" label="Audit log" active={view === "admin"} onClick={() => nav("admin")} />
      </nav>

      {/* recent audits */}
      <div className="mt-5 px-4 text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink-faint">
        Recent audits
      </div>
      <div className="mt-1.5 space-y-0.5 overflow-y-auto px-2.5 thin-scroll">
        {recent.length === 0 ? (
          <div className="px-2 py-1.5 text-[11.5px] leading-snug text-ink-faint">
            Nothing yet. Audit a handle, token, or site and it lands here.
          </div>
        ) : (
          recent.map((e) => {
            const ref = e.ref ?? e.query;
            const vm = e.verdict ? verdictMeta(e.verdict) : null;
            const active = activeHandle === ref || activeHandle === e.query;
            const avatar = (e.query.replace(/^[@$]/, "").replace(/^https?:\/\//, "")[0] ?? "?").toUpperCase();
            return (
              <button
                key={e.id}
                onClick={() => openRecent(ref)}
                className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                  active ? "bg-panel soft-shadow" : "hover:bg-panel/70"
                }`}
              >
                <AuditAvatar src={auditImage(e)} letter={avatar} />
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[12.5px] text-ink">{e.query.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {KIND_LABEL[e.kind]}{typeof e.score === "number" ? ` · ${e.score}` : ""}
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
      <div className="mt-auto border-t border-line px-2.5 py-3">
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
