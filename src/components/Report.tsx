import { useState } from "react";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import type { Dossier } from "../data/dossier";
import type { RoleReport, SubjectClass } from "../engine";
import { verdictMeta, ROLE_META, axisLabel, capLabel } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import { getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { Avatar } from "./Avatar";
import { xAvatar } from "../lib/avatars";
import { explorer, shortAddr, walletTier } from "../lib/wallets";
import { IdentitySweep } from "./IdentitySweep";
import { OnchainReality } from "./OnchainReality";
import { PfpCheck } from "./PfpCheck";
import { KolReport } from "./KolReport";
import { NewsSection } from "./NewsSection";
import { VcReport } from "./VcReport";
import { purgeSubject } from "../lib/purge";

/* ── small primitives ─────────────────────────────────────────────── */

function VerdictPill({ verdict, size = "sm" }: { verdict: string; size?: "sm" | "lg" }) {
  const m = verdictMeta(verdict);
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wider ${
        size === "lg" ? "px-3 py-1 text-[13px]" : "px-2 py-0.5 text-[11px]"
      }`}
      style={{ borderColor: m.color, color: m.color, background: m.glow }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

function ScoreRing({ score, verdict, size = 86 }: { score: number | null; verdict: string; size?: number }) {
  const m = verdictMeta(verdict);
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={m.color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[22px] font-semibold leading-none tabular" style={{ color: m.color }}>
          {score == null ? "—" : score}
        </span>
        <span className="mono text-[9px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
        {kicker && <span className="text-[11.5px] text-ink-faint">{kicker}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-panel/70 ${className}`}>{children}</div>
  );
}

// Copy a full wallet address (the row shows a truncated form).
function CopyAddr({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      className="shrink-0 text-[10.5px] text-ink-faint transition hover:text-ink"
      title="Copy full address"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/* ── axis bar ─────────────────────────────────────────────────────── */

function AxisBar({
  axis,
  score,
  weight,
  rationale,
  color,
}: {
  axis: string;
  score: number;
  weight: number;
  rationale: string;
  color: string;
}) {
  const ratio = weight ? score / weight : 0;
  const weak = ratio < 0.45;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-dim">{axisLabel(axis)}</span>
        <span className="mono shrink-0 text-[11px] tabular text-ink-faint">
          {score}
          <span className="text-ink-faint/60">/{weight}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ background: weak ? "var(--color-caution)" : color, width: `${ratio * 100}%`, transition: "width 0.7s ease-out" }}
        />
      </div>
      {rationale && <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">{rationale}</p>}
    </div>
  );
}

/* ── role card ────────────────────────────────────────────────────── */

function RoleCard({ rr, governing }: { rr: RoleReport; governing: boolean }) {
  const [open, setOpen] = useState(governing);
  const m = verdictMeta(rr.verdict);
  const role = ROLE_META[rr.role as SubjectClass];
  const axes = Object.entries(rr.axes);

  return (
    <Card className={governing ? "ring-1" : ""} >
      <div
        className="flex cursor-pointer items-center gap-3 p-4"
        onClick={() => setOpen((o) => !o)}
        style={governing ? { boxShadow: `inset 0 0 0 1px ${m.color}40` } : undefined}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-panel text-[15px]" style={{ color: m.color }}>
          {role.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{role.label}</span>
            {governing && (
              <span className="mono rounded border border-line px-1 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">
                governs
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <VerdictPill verdict={rr.verdict} />
            {rr.cap_applied && (
              <span className="mono text-[10.5px]" style={{ color: "var(--color-avoid)" }}>
                cap · {capLabel(rr.cap_applied)}
              </span>
            )}
          </div>
        </div>
        <ScoreRing score={rr.score_total} verdict={rr.verdict} size={64} />
      </div>

      {open && axes.length > 0 && (
        <div className="overflow-hidden border-t border-line px-4 pb-3">
          <div className="divide-y divide-line/60">
            {axes.map(([k, a]) => (
              <AxisBar key={k} axis={k} score={a.score} weight={a.weight} rationale={a.rationale} color={m.color} />
            ))}
          </div>
          {rr.dox_bonus > 0 && (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-panel-2/40 px-3 py-2 text-[12px]">
              <span className="text-ink-dim">Disclosure bonus (identity verified)</span>
              <span className="mono text-pass">+{rr.dox_bonus}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between px-1 text-[11.5px] text-ink-faint">
            <span>
              raw {rr.raw_total} {rr.dox_bonus ? `+ ${rr.dox_bonus} bonus` : ""}
            </span>
            <span className="mono">= {rr.score_total ?? "—"}{rr.cap_applied ? " (capped)" : ""}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── corroboration table ──────────────────────────────────────────── */

const TV_TONE: Record<string, string> = {
  Corroborated: "var(--color-pass)",
  PartiallyCorroborated: "var(--color-caution)",
  Unconfirmed: "var(--color-ink-faint)",
  Contradicted: "var(--color-avoid)",
};
const TV_SHORT: Record<string, string> = {
  Corroborated: "Corroborated",
  PartiallyCorroborated: "Partial",
  Unconfirmed: "Unconfirmed",
  Contradicted: "Contradicted",
};

function CorroborationTable({
  rows,
}: {
  rows: { who: string; rel?: string; follows?: boolean | null; ack?: string | null; verdict?: string; note?: string }[];
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[1.4fr_1fr_auto] gap-2 border-b border-line px-4 py-2 text-[10.5px] uppercase tracking-wider text-ink-faint">
        <span>Claimed endorser</span>
        <span>Public signal</span>
        <span className="text-right">Verdict</span>
      </div>
      <div className="divide-y divide-line/60">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <div className="mono truncate text-[12.5px] text-ink">{r.who}</div>
              {r.rel && <div className="text-[11px] text-ink-faint">claims: {r.rel}</div>}
            </div>
            <div className="text-[11.5px] text-ink-dim">
              <span className={r.follows ? "text-ink-dim" : "text-ink-faint line-through/0"}>
                {r.follows ? "follows" : "no follow"}
              </span>
              <span className="text-ink-faint"> · {r.ack && r.ack !== "none" ? r.ack : "no ack"}</span>
            </div>
            <div className="text-right">
              <span
                className="mono text-[11px] font-medium"
                style={{ color: TV_TONE[r.verdict ?? "Unconfirmed"] }}
              >
                {TV_SHORT[r.verdict ?? "Unconfirmed"]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── findings ledger ──────────────────────────────────────────────── */

function FindingsLedger({ findings }: { findings: Dossier["report"]["publishable_findings"] }) {
  if (!findings.length) return null;
  return (
    <div className="space-y-2">
      {findings.map((f, i) => (
        <Card key={i} className="p-3.5">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: f.polarity > 0 ? "var(--color-pass)" : "var(--color-avoid)" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-ink">{f.claim}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                <span className="mono rounded border border-line px-1.5 py-0.5" style={{ color: f.verification_status === "Verified" ? "var(--color-pass)" : "var(--color-caution)" }}>
                  {f.verification_status}
                </span>
                <span className="mono">{f.independent_source_count} src</span>
                <span>{f.source_date}</span>
                {f.source_author && <span className="mono">{f.source_author}</span>}
                <span className="mono truncate text-signal-dim">{f.source_url.replace(/^https?:\/\//, "")}</span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ── main report ──────────────────────────────────────────────────── */

export function Report({ dossier, onReset, onAudit, onOpenProject }: { dossier: Dossier; onReset: () => void; onAudit?: (q: string) => void; onOpenProject?: (name: string, domain?: string) => void }) {
  const f = dossier;
  const { report, graph, founderSummary, evidence, webTeam } = dossier;
  const roles = report.roles as SubjectClass[];
  const m = verdictMeta(report.composite_verdict);
  const [watched, setWatched] = useState(() => isWatched(report.handle));
  // The compounding web: who else (from your past audits) this subject is tied to.
  const connections = subjectConnections(report.handle, getContributions());
  // Candidate token symbols for the on-chain check: the project's own token often
  // isn't the promoted ticker (RECC Finance -> the tradeable $RECC, not $RETF).
  const symbolHints = (() => {
    const STOP = /^(finance|protocol|labs?|capital|network|dao|fi|token|coin|money|app|official|crypto|swap|pay|world|game|games)$/i;
    const clean = (s: string) => s.replace(/[^a-z0-9]/gi, "");
    const out = new Set<string>();
    const first = (f.display_name || "").split(/\s+/).map(clean).filter(Boolean).find((w) => !STOP.test(w));
    if (first) out.add(first.toUpperCase());
    const m = report.handle.replace(/^@/, "").match(/^([A-Za-z0-9]{2,})(finance|protocol|labs?|capital|network|dao|fi|token|coin|money|app|official|crypto|swap|pay)$/i);
    if (m) out.add(m[1].toUpperCase());
    return [...out].filter((s) => s.length >= 2 && s.length <= 8);
  })();
  const [copied, setCopied] = useState(false);
  const share = () => {
    const p = new URLSearchParams({ k: "person", t: report.handle, title: report.handle, v: report.composite_verdict, sc: String(report.governing_score ?? ""), s: (f.headline || "").slice(0, 90) });
    navigator.clipboard?.writeText(`${location.origin}/api/card?${p}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const watch = () =>
    setWatched(
      toggleWatch({
        id: report.handle, kind: "person", label: report.handle, addedAt: 0,
        snapshot: { verdict: report.composite_verdict, score: report.governing_score },
      }),
    );

  const corroborationRows = [
    ...evidence.testimonials.map((t) => ({
      who: t.claimed_endorser_handle ?? t.claimed_endorser_name ?? "—",
      rel: t.claimed_relationship,
      follows: t.follows_subject,
      ack: t.public_acknowledgment,
      verdict: t.corroboration_verdict,
      note: t.notes,
    })),
  ];

  const advisedRows = evidence.advised;

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-72" />

      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Audits
          </button>
          <span className="mono text-[11px] text-ink-faint">/ {report.audit_id}</span>
          <span
            className="mono rounded border px-1.5 py-0.5 text-[10px] tracking-wider"
            style={
              f.live
                ? { borderColor: "var(--color-signal)", color: "var(--color-signal)" }
                : { borderColor: "var(--color-line-2)", color: "var(--color-ink-faint)" }
            }
            title={f.live ? "Collected live from data providers" : "Curated dossier (no provider keys configured)"}
          >
            {f.live ? "● LIVE" : "CURATED"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {onAudit && (
              <button onClick={() => onAudit(report.handle)} title="Run this audit again, fresh" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
                Rescan
              </button>
            )}
            <button onClick={share} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink">{copied ? "Copied ✓" : "Share"}</button>
            <button onClick={watch} className="rounded-lg border px-3 py-1.5 text-[12.5px] transition" style={watched ? { borderColor: "var(--color-signal)", color: "var(--color-signal)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
              {watched ? "★ Watching" : "☆ Watch"}
            </button>
            <button
              onClick={onReset}
              className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink"
            >
              New audit
            </button>
            <button
              onClick={() => {
                if (!window.confirm(`Delete ${report.handle} everywhere (audit log, stored report, trust graph)? A rescan will start from scratch.`)) return;
                purgeSubject(report.handle);
                onReset();
              }}
              title="Remove this report everywhere and start from scratch"
              className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-faint transition hover:border-avoid hover:text-avoid"
            >
              Delete
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5">
        {/* subject identity */}
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <Avatar src={xAvatar(f.handle)} letter={f.avatar} size={56} rounded="rounded-2xl" letterClass="text-2xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">{f.display_name}</h1>
              <span className="mono text-[13px] text-ink-faint">{f.handle}</span>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-dim">{f.bio}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-faint">
              <span><span className="text-ink-dim">{f.followers}</span> followers</span>
              <span>joined {f.joined}</span>
              {typeof f.days_since_post === "number" && (
                <span className={f.days_since_post >= 21 ? "text-avoid" : "text-ink-faint"}>
                  {f.days_since_post >= 21 ? "⚠ " : ""}
                  {f.days_since_post === 0 ? "posted today" : f.days_since_post === 1 ? "posted yesterday" : `last posted ${f.days_since_post}d ago`}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                {roles.map((r) => (
                  <span key={r} className="rounded border border-line px-1.5 py-0.5 text-ink-dim">
                    {ROLE_META[r].glyph} {ROLE_META[r].label}
                  </span>
                ))}
              </span>
            </div>
            {/* follower quality: high-reach + known accounts that follow this subject */}
            {f.notableFollowers.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-faint">Top followers</span>
                {f.notableFollowers.slice(0, 10).map((n) => {
                  const big = (n.count ?? 0) >= 1e6;
                  return (
                    <a
                      key={n.handle}
                      href={`https://x.com/${n.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono rounded-md border px-1.5 py-0.5 text-[10.5px] transition hover:text-ink"
                      style={big ? { borderColor: "var(--color-pass)", color: "var(--color-pass)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
                      title={`${n.label} · ${n.size} followers`}
                    >
                      @{n.handle} <span className="text-ink-faint">{n.size}{n.label && n.label !== "high reach" ? ` · ${n.label}` : ""}</span>
                    </a>
                  );
                })}
                {f.notableFollowers.length > 10 && <span className="text-[10.5px] text-ink-faint">+{f.notableFollowers.length - 10} more</span>}
              </div>
            )}
          </div>
        </div>

        {/* verdict hero */}
        <div
          className="relative mt-6 overflow-hidden rounded-2xl border bg-panel p-6 soft-shadow"
          style={{ borderColor: `${m.color}55` }}
        >
          <div className="absolute right-0 top-0 h-full w-1/2" style={{ background: `radial-gradient(400px 200px at 100% 0%, ${m.glow}, transparent 70%)` }} />
          <div className="relative flex flex-wrap items-center gap-6">
            <ScoreRing score={report.governing_score} verdict={report.composite_verdict} size={96} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-ink-faint">Composite verdict</div>
              <div className="flex items-center gap-3">
                <span className="text-[34px] font-bold leading-none tracking-tight" style={{ color: m.color }}>
                  {m.label}
                </span>
                {report.governing_role && (
                  <span className="mono mt-1 text-[12px] text-ink-faint">
                    governed by {ROLE_META[report.governing_role as SubjectClass].label.toLowerCase()}
                  </span>
                )}
              </div>
              <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">{f.headline}</p>
              {report.cap_applied && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12px]" style={{ borderColor: "var(--color-avoid)", color: "var(--color-avoid)" }}>
                  <span>▲</span> Hard cap · {capLabel(report.cap_applied)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* identity: when a named team resolved it, SHOW the team here (the note
            would just narrate the same names); otherwise show the note. */}
        {webTeam && webTeam.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="mono rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: "var(--color-line-2)", color: "var(--color-ink-dim)" }}>{report.identity_confidence}</span>
              <span className="text-[11px] text-ink-faint">identity resolved through the named team · click a handle to audit them</span>
            </div>
            <Card className="divide-y divide-line/60">
              {webTeam.map((p, i) => (
                <div key={i} className="px-4 py-2.5 text-[12.5px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Avatar src={p.handle ? xAvatar(p.handle) : null} letter={(p.name.replace(/^@/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                      <span className="text-ink">{p.name}</span>
                      {p.handle && <span className="mono text-[11px] text-ink-faint">{p.handle}</span>}
                      <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[9.5px] text-ink-dim">{p.role}</span>
                      {p.linkedin && (
                        <a href={`https://${p.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="text-[10.5px] text-signal-dim underline-offset-2 hover:underline">LinkedIn ↗</a>
                      )}
                      {p.evidence && <span className="text-[10.5px] text-ink-faint">· {p.evidence}</span>}
                      <span className="text-[9.5px] text-ink-faint">({p.source})</span>
                    </span>
                    {p.handle && onAudit ? (
                      <button onClick={() => onAudit(p.handle!)} className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>audit →</button>
                    ) : (
                      <span className="mono shrink-0 text-[10.5px] text-ink-faint">named only</span>
                    )}
                  </div>
                  {p.projects && p.projects.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[26px] text-[10.5px] text-ink-faint">
                      <span>also:</span>
                      {p.projects.map((pr, j) => (
                        onOpenProject ? (
                          <button key={j} onClick={() => onOpenProject(pr.name)} title="Dig everyone on this project" className="rounded border border-line px-1.5 py-0.5 text-ink-dim transition hover:border-signal-dim hover:text-signal-dim">
                            {pr.name}{pr.role ? <span className="text-ink-faint"> · {pr.role}</span> : null}
                          </button>
                        ) : (
                          <span key={j} className="rounded border border-line px-1.5 py-0.5 text-ink-dim">{pr.name}{pr.role ? ` · ${pr.role}` : ""}</span>
                        )
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Card>
            {f.prior_handles && f.prior_handles.length > 0 && (
              <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--color-caution)" }}>
                ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-line bg-panel/40 px-4 py-3">
            <span className="mono mt-0.5 rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: report.identity_confidence === "SuspectedImpersonation" ? "var(--color-unverifiable)" : "var(--color-line-2)", color: report.identity_confidence === "SuspectedImpersonation" ? "var(--color-unverifiable)" : "var(--color-ink-dim)" }}>
              {report.identity_confidence}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] leading-relaxed text-ink-dim">{f.identity_note}</p>
              {f.prior_handles && f.prior_handles.length > 0 && (
                <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--color-caution)" }}>
                  ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
                </p>
              )}
            </div>
          </div>
        )}

        {/* contradictions — claims that do not match the evidence */}
        {f.contradictions.length > 0 && (
          <Section title="Contradictions" kicker="claims that do not match the collected evidence">
            <Card className="divide-y divide-line/60">
              {f.contradictions.map((c, i) => {
                const sc = c.severity === "high" ? "var(--color-avoid)" : c.severity === "medium" ? "var(--color-caution)" : "var(--color-ink-faint)";
                return (
                  <div key={i} className="flex items-start gap-2.5 px-4 py-3">
                    <span className="mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase" style={{ background: `${sc}1a`, color: sc }}>{c.severity}</span>
                    <div className="min-w-0 text-[12.5px] leading-snug">
                      <span className="text-ink">{c.claim}</span>
                      <span className="text-ink-faint"> — but </span>
                      <span className="text-ink-dim">{c.conflict}</span>
                      {c.confidence === "low" && <span className="ml-1.5 text-[10.5px] text-ink-faint">(low confidence)</span>}
                    </div>
                  </div>
                );
              })}
            </Card>
          </Section>
        )}

        {/* connections — the compounding web: other audited subjects tied to this one */}
        {connections.length > 0 && (
          <Section title="Connections" kicker="the web · others you've audited who share projects, people or wallets with this subject">
            <Card className="divide-y divide-line/60">
              {connections.map((c) => {
                const vm = c.otherVerdict ? verdictMeta(c.otherVerdict) : null;
                return (
                  <div key={c.other} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      <Avatar src={/^@[A-Za-z0-9_]{2,30}$/.test(c.other) ? xAvatar(c.other) : null} letter={(c.other.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                      <div className="min-w-0">
                      <span className="mono text-[12.5px] text-ink">{c.other}</span>
                      {vm && <span className="mono ml-2 text-[10px]" style={{ color: vm.color }}>{vm.label}</span>}
                      <div className="mt-0.5 text-[11.5px] leading-snug text-ink-dim">
                        {c.direct && <span>directly linked{c.ties.length > 0 ? " · " : ""}</span>}
                        {c.ties.length > 0 && (
                          <span>via {c.ties.map((t, ti) => (
                            <span key={t.key}>
                              {ti > 0 && ", "}
                              {onOpenProject && t.type === "Company" ? (
                                <button onClick={() => onOpenProject(t.label)} className="text-ink underline-offset-2 transition hover:text-signal-dim hover:underline">{t.label}</button>
                              ) : (
                                <span className="text-ink">{t.label}</span>
                              )}
                            </span>
                          ))}</span>
                        )}
                      </div>
                      </div>
                    </div>
                    {onAudit && (
                      <button onClick={() => onAudit(c.other)} className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>open →</button>
                    )}
                  </div>
                );
              })}
            </Card>
          </Section>
        )}

        {/* role breakdown — governing role full-width and expanded, the rest below */}
        <Section title="Role breakdown" kicker="each role scored on its own track · never averaged">
          {(() => {
            const gov = report.role_reports.find((rr) => rr.role === report.governing_role);
            const others = report.role_reports.filter((rr) => rr.role !== report.governing_role);
            return (
              <div className="space-y-3">
                {gov && <RoleCard key={gov.role} rr={gov} governing />}
                {others.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {others.map((rr) => (
                      <RoleCard key={rr.role} rr={rr} governing={false} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </Section>


        {/* signature modules */}
        <div className="grid gap-3 lg:grid-cols-2">
          {evidence.wallets.length > 0 && (
            <div className="min-w-0">
              <Section title="Wallets & on-chain links" kicker="addresses tied to them · ranked by attribution strength">
                <Card className="divide-y divide-line/60">
                  {[...evidence.wallets]
                    .sort((a, b) => walletTier(a).rank - walletTier(b).rank)
                    .map((w, i) => {
                      const t = walletTier(w);
                      const flags = [
                        w.sold_into_own_promo ? "sold into own promo" : "",
                        w.scam_adjacent_flow ? "scam-adjacent flow" : "",
                      ].filter(Boolean);
                      return (
                        <div key={i} className="px-4 py-2.5 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-ink-faint">
                              {w.chain === "solana" ? "SOL" : "EVM"}
                            </span>
                            <a href={explorer(w)} target="_blank" rel="noreferrer" className="mono truncate text-signal underline-offset-2 hover:underline">{shortAddr(w.address)}</a>
                            <CopyAddr text={w.address} />
                            {w.link_evidence_url && (
                              <a href={w.link_evidence_url} target="_blank" rel="noreferrer" className="shrink-0 text-[10.5px] text-signal-dim hover:underline">proof</a>
                            )}
                            <span className="mono ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px]" style={{ color: t.color, border: `1px solid ${t.color}40` }}>
                              {t.label}
                            </span>
                          </div>
                          {(w.notes || w.activity_summary) && (
                            <div className="mt-1 text-[11px] leading-snug text-ink-faint">
                              {[w.notes, w.activity_summary].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          {(flags.length > 0 || w.positive_signals) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {flags.map((fl) => (
                                <span key={fl} className="mono rounded border border-avoid/40 px-1 py-0.5 text-[9.5px] text-avoid">{fl}</span>
                              ))}
                              {w.positive_signals && (
                                <span className="mono rounded border border-pass/40 px-1 py-0.5 text-[9.5px] text-pass">{w.positive_signals}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </Card>
              </Section>
            </div>
          )}

          {evidence.ventures.length > 0 && (
            <div className="min-w-0">
              <Section title="Ventures & affiliations" kicker="every company tied to them · corroborated where possible">
                <Card className="divide-y divide-line/60">
                  {evidence.ventures.map((v, i) => {
                    const corroborated = /corroborated:/i.test(v.notes ?? "");
                    const isLead = !corroborated && /unverified|lead/i.test(v.notes ?? "");
                    return (
                      <div key={i} className="flex items-center gap-2 px-4 py-2.5 text-[12.5px]">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: v.outcome === "Rug" ? "var(--color-avoid)" : v.outcome === "Acquisition" || v.outcome === "IPO" ? "var(--color-pass)" : "var(--color-ink-faint)" }}
                        />
                        {onOpenProject ? (
                          <button onClick={() => onOpenProject(v.project_name)} className="truncate text-left text-ink underline-offset-2 transition hover:text-signal-dim hover:underline" title="See everyone who worked on this">{v.project_name}</button>
                        ) : (
                          <span className="truncate text-ink">{v.project_name}</span>
                        )}
                        <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[9.5px] text-ink-dim">{v.role}</span>
                        {v.period && <span className="shrink-0 text-[11px] text-ink-faint">{v.period}</span>}
                        {v.evidence_url && (
                          <a href={v.evidence_url} target="_blank" rel="noreferrer" className="shrink-0 text-[10.5px] text-signal-dim hover:underline">source</a>
                        )}
                        <span
                          className="mono ml-auto shrink-0 text-[10px]"
                          style={{ color: corroborated ? "var(--color-pass)" : "var(--color-ink-faint)" }}
                        >
                          {corroborated ? "corroborated" : isLead ? "lead" : ""}
                        </span>
                      </div>
                    );
                  })}
                </Card>
              </Section>
            </div>
          )}

          {corroborationRows.length > 0 && (
            <div className="min-w-0">
              <Section title="Testimonial corroboration" kicker="claimed vs. acknowledged">
                <CorroborationTable rows={corroborationRows} />
              </Section>
            </div>
          )}

          {founderSummary && (
            <div className="min-w-0">
              <Section title="Founder pattern" kicker="outcomes + repeat backing">
                <Card className="p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-ink-faint">Pattern</div>
                      <div className="mono text-[15px] font-medium text-ink">{founderSummary.pattern}</div>
                    </div>
                    <div className="h-8 w-px bg-line" />
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-ink-faint">Repeat backing</div>
                      <div
                        className="mono text-[15px] font-medium"
                        style={{
                          color:
                            founderSummary.repeat_backing.strength === "strong"
                              ? "var(--color-pass)"
                              : founderSummary.repeat_backing.strength === "weak"
                              ? "var(--color-caution)"
                              : "var(--color-ink-faint)",
                        }}
                      >
                        {founderSummary.repeat_backing.strength}
                      </div>
                    </div>
                  </div>
                  {founderSummary.repeat_backing.repeat_backers.length > 0 && (
                    <p className="mt-2 text-[12px] text-ink-faint">
                      Returning backers: <span className="text-ink-dim">{founderSummary.repeat_backing.repeat_backers.join(", ")}</span>
                    </p>
                  )}
                </Card>
              </Section>
            </div>
          )}

          {advisedRows.length > 0 && (
            <div className="min-w-0">
              <Section title="Advisory graveyard" kicker="projects lent their name to">
                <Card className="divide-y divide-line/60">
                  {advisedRows.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-faint)" }}
                      />
                      <span className="text-[12.5px] text-ink">{p.project_name}</span>
                      {p.paid_or_allocated && (
                        <span className="mono rounded border border-line px-1 py-0.5 text-[9.5px] text-caution">allocation</span>
                      )}
                      <span className="mono ml-auto text-[11.5px]" style={{ color: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>
                        {p.project_outcome}
                      </span>
                      <span className="mono text-[10.5px]" style={{ color: TV_TONE[p.corroboration_verdict ?? "Unconfirmed"] }}>
                        {TV_SHORT[p.corroboration_verdict ?? "Unconfirmed"]}
                      </span>
                    </div>
                  ))}
                </Card>
              </Section>
            </div>
          )}

          <div className="min-w-0 lg:col-span-2">
            <Section title="Profile photo" kicker="is the face real, or AI-generated / stock / a logo standing in for a person?">
              <PfpCheck handle={report.handle} brand={(webTeam?.length ?? 0) > 0} />
            </Section>
          </div>

          {/* Not for funds: a VC's portfolio tokens aren't "promotions", and a
              deployer/serial-launch trail on Maker's contract says nothing about
              Paradigm — the VC track record section covers their bets instead. */}
          {report.governing_role !== "INVESTOR" && (evidence.promotions?.length > 0 || symbolHints.length > 0 || evidence.wallets.some((w) => w.chain === "solana")) && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="On-chain reality check" kicker="the token they promote → its deployer → the money trail + serial-launch history">
                <OnchainReality promotions={evidence.promotions ?? []} wallets={evidence.wallets} symbolHints={symbolHints} onAudit={onAudit} />
              </Section>
            </div>
          )}

          {roles.some((r) => r === "INVESTOR") && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="VC track record" kicker="their portfolio → each token bet priced on-chain: a fund graded on how its bets ended">
                <VcReport handle={report.handle} name={f.display_name || report.handle} onAudit={onAudit} />
              </Section>
            </div>
          )}

          {roles.some((r) => r === "KOL") && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="KOL report" kicker="a promoter's threat model: did their shilled tokens rug, and is their reach real?">
                <KolReport handle={report.handle} promotions={evidence.promotions ?? []} associates={evidence.associates ?? []} onAudit={onAudit} />
              </Section>
            </div>
          )}

          <div className="min-w-0 lg:col-span-2">
            <Section title="In the news" kicker="recent press — funding, launches, hacks, exits; an empty trail is itself a signal">
              <NewsSection query={f.display_name || report.handle} handle={report.handle} />
            </Section>
          </div>

          <div className="min-w-0 lg:col-span-2">
            <Section title="Identity continuity" kicker="rebrands + the same handle across GitHub, Farcaster, Reddit, Telegram">
              <IdentitySweep handle={report.handle} auto />
            </Section>
          </div>

          <div className="min-w-0 lg:col-span-2">
            <Section title="Connection web" kicker="click any node to open it · subject → projects → the people behind them">
              <Card className="p-2">
                <TrustGraph nodes={graph.nodes} edges={graph.edges} connections={connections} onAudit={onAudit} onOpenProject={onOpenProject} />
              </Card>
            </Section>
          </div>
        </div>

        {/* findings ledger */}
        {report.publishable_findings.length > 0 && (
          <Section title="Publishable findings" kicker="sourced · dated · independently corroborated">
            <FindingsLedger findings={report.publishable_findings} />
          </Section>
        )}

        {/* methodology footer */}
        <div className="mt-8 rounded-xl border border-line bg-panel/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-dim">
            <ArgusMark size={16} /> How this verdict was reached
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            Each role is scored to 100 on its own axes. Disqualifying findings act as hard caps that
            override the weighted total rather than averaging into it, so a single rug or contradicted
            endorsement cannot be diluted. The composite is the most severe role band, never a mean.
            Identity is rewarded, not gated: pseudonymity is neutral, disclosure earns a bonus, and only
            impersonation blocks a verdict. API-only acquisition, evidence-disciplined, reproducible.
          </p>
        </div>
      </div>
    </div>
  );
}
