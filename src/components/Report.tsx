import { useState } from "react";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import type { Dossier } from "../data/dossier";
import type { RoleReport, SubjectClass } from "../engine";
import { verdictMeta, ROLE_META, axisLabel, capLabel } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";

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

export function Report({ dossier, onReset }: { dossier: Dossier; onReset: () => void }) {
  const f = dossier;
  const { report, graph, founderSummary, evidence } = dossier;
  const roles = report.roles as SubjectClass[];
  const m = verdictMeta(report.composite_verdict);
  const [watched, setWatched] = useState(() => isWatched(report.handle));
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
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5">
        {/* subject identity */}
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line-2 bg-panel text-2xl text-signal">
            {f.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">{f.display_name}</h1>
              <span className="mono text-[13px] text-ink-faint">{f.handle}</span>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-dim">{f.bio}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-faint">
              <span><span className="text-ink-dim">{f.followers}</span> followers</span>
              <span>joined {f.joined}</span>
              <span className="flex items-center gap-1.5">
                {roles.map((r) => (
                  <span key={r} className="rounded border border-line px-1.5 py-0.5 text-ink-dim">
                    {ROLE_META[r].glyph} {ROLE_META[r].label}
                  </span>
                ))}
              </span>
            </div>
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

        {/* identity callout */}
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-line bg-panel/40 px-4 py-3">
          <span className="mono mt-0.5 rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: report.identity_confidence === "SuspectedImpersonation" ? "var(--color-unverifiable)" : "var(--color-line-2)", color: report.identity_confidence === "SuspectedImpersonation" ? "var(--color-unverifiable)" : "var(--color-ink-dim)" }}>
            {report.identity_confidence}
          </span>
          <p className="text-[12.5px] leading-relaxed text-ink-dim">{f.identity_note}</p>
        </div>

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
                  <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                    {evidence.ventures.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12.5px]">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background:
                              v.outcome === "Rug"
                                ? "var(--color-avoid)"
                                : v.outcome === "Acquisition" || v.outcome === "IPO"
                                ? "var(--color-pass)"
                                : "var(--color-ink-faint)",
                          }}
                        />
                        <span className="text-ink">{v.project_name}</span>
                        <span className="text-ink-faint">{v.period}</span>
                        <span className="mono ml-auto text-[11.5px] text-ink-dim">{v.outcome}{v.acquirer ? ` → ${v.acquirer}` : ""}</span>
                      </div>
                    ))}
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

          <div className="min-w-0">
            <Section title="Panoptes trust graph" kicker="who vouches, who they touched">
              <Card className="p-2">
                <TrustGraph nodes={graph.nodes} edges={graph.edges} />
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
