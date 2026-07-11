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
import { xAvatar, personAvatar } from "../lib/avatars";
import { explorer, shortAddr, walletTier } from "../lib/wallets";
import { IdentitySweep } from "./IdentitySweep";
import { PfpCheck } from "./PfpCheck";
import { PersonGithub } from "./PersonGithub";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { personChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { AddInfo } from "./AddInfo";
import { LinkEntity } from "./LinkEntity";
import { AskReport } from "./AskReport";
import { KolReport } from "./KolReport";
import { NewsSection } from "./NewsSection";
import { VcReport } from "./VcReport";
import { ProjectIntel } from "./ProjectIntel";
import { changeReportLifecycle } from "../lib/reports";
import { ServiceAlert } from "./ServiceAlert";
import { LegalScreen } from "./LegalScreen";
import { SanctionsNameScreen } from "./SanctionsNameScreen";
import { RingAlert } from "./RingAlert";
import { useArgusAuth } from "../auth-context";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";

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

function RoleCard({ rr, governing, coverageReady }: { rr: RoleReport; governing: boolean; coverageReady: boolean }) {
  const [open, setOpen] = useState(governing);
  const m = verdictMeta(rr.verdict);
  const role = ROLE_META[rr.role as SubjectClass];
  const axes = Object.entries(rr.axes);

  return (
    <Card className={governing ? "ring-1" : ""} >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
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
            {!coverageReady && rr.verdict === "PASS" && (
              <span className="mono text-[9.5px] uppercase tracking-wide text-caution">scored axes only</span>
            )}
            {rr.cap_applied && (
              <span className="mono text-[10.5px]" style={{ color: "var(--color-avoid)" }}>
                cap · {capLabel(rr.cap_applied)}
              </span>
            )}
          </div>
        </div>
        <ScoreRing score={rr.score_total} verdict={rr.verdict} size={64} />
      </button>

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
      {findings.map((f, i) => {
        let source: { href: string; label: string } | null = null;
        try {
          const parsed = new URL(f.source_url.trim());
          if (
            (parsed.protocol === "https:" || parsed.protocol === "http:")
            && parsed.hostname
            && !parsed.username
            && !parsed.password
          ) {
            source = {
              href: parsed.href,
              label: parsed.href.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            };
          }
        } catch {
          // Missing or malformed source URLs stay visible as unavailable, never as clickable markup.
        }

        const sourceCountLabel = `${f.independent_source_count} independent source${f.independent_source_count === 1 ? "" : "s"} recorded · ${source ? "1 link stored" : "no link stored"}`;
        const statusColor = f.verification_status === "Verified"
          ? "var(--color-pass)"
          : f.verification_status === "Rumor"
            ? "var(--color-avoid)"
            : "var(--color-caution)";

        return (
          <Card key={i} className="p-3.5">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: f.polarity > 0 ? "var(--color-pass)" : "var(--color-avoid)" }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-ink">{f.claim}</p>
                <div role="group" aria-label="Evidence provenance" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-faint">
                  <span className="inline-flex items-center gap-1.5 rounded border border-line px-1.5 py-0.5">
                    <span>Status</span>
                    <span className="mono font-medium" style={{ color: statusColor }}>{f.verification_status}</span>
                  </span>
                  <span>
                    Sources <span className="mono text-ink-dim">{sourceCountLabel}</span>
                  </span>
                  {f.source_date && (
                    <span>
                      Date <time className="mono text-ink-dim" dateTime={f.source_date}>{f.source_date}</time>
                    </span>
                  )}
                  {f.source_author && (
                    <span>
                      Author <span className="mono text-ink-dim">{f.source_author}</span>
                    </span>
                  )}
                </div>
                {source ? (
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open evidence source for finding ${i + 1} in a new tab: ${f.claim}`}
                    title={source.href}
                    className="mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px] text-signal-dim underline-offset-2 hover:text-signal hover:underline"
                  >
                    <span className="shrink-0 text-ink-faint">Source</span>
                    <span className="truncate">{source.label}</span>
                  </a>
                ) : (
                  <p className="mt-2 text-[11px] text-ink-faint">Source link unavailable</p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ── main report ──────────────────────────────────────────────────── */

export function Report({ dossier, onReset, onAudit, onRescan, onOpenProject, onOpenBrief }: { dossier: Dossier; onReset: () => void; onAudit?: (q: string) => void; onRescan?: () => void; onOpenProject?: (name: string, domain?: string, panelCostToken?: string) => void; onOpenBrief?: () => void }) {
  const { role } = useArgusAuth();
  const f = dossier;
  const { report, graph, founderSummary, evidence, webTeam } = dossier;
  const roles = report.roles as SubjectClass[];
  const derivedDiligenceChecks = personChecks({
    identityConfidence: report.identity_confidence ?? undefined,
    realName: (f.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
    roles,
    hasAssociates: (evidence.associates?.length ?? 0) > 0,
  });
  const diligenceChecks = f.versionContext
    ? f.versionContext.checks
    : f.checkRuns?.length
      ? f.checkRuns
      : derivedDiligenceChecks;
  const readiness = deriveDecisionReadiness(diligenceChecks);
  const positiveVerdictNeedsQualification = report.composite_verdict === "PASS" && readiness.status !== "ready";
  const presentedVerdict = positiveVerdictNeedsQualification ? "INCOMPLETE" : report.composite_verdict;
  const m = verdictMeta(presentedVerdict);
  const scoredVerdictMeta = verdictMeta(report.composite_verdict);
  const readinessColor = readiness.status === "ready" ? "var(--color-pass)" : "var(--color-caution)";
  const versionContext = f.versionContext ?? f.viewVersionContext;
  const embeddedFacet = Boolean(f.viewVersionContext || f.viewPersistence);
  const livePersistence = f.viewPersistence ?? f.persistence;
  const panelCostToken = !versionContext && livePersistence?.state === "persisted"
    ? livePersistence.panelCostToken ?? undefined
    : undefined;
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const persistencePending = !versionContext && livePersistence?.state === "pending";
  const persistenceFailed = !versionContext && livePersistence?.state === "failed";
  const persistenceMissingCapability = !versionContext
    && livePersistence?.state === "persisted"
    && !panelCostToken;
  const privateSession = livePersistence?.state === "private";
  const showCurrentIntelligence = versionContext
    ? currentIntelligenceEnabled
    : !privateSession && !persistencePending && !persistenceFailed && !persistenceMissingCapability;
  const canRecordCurrentIntelligence = !versionContext && livePersistence?.state !== "private";
  const canMutateWorkspace = !versionContext && livePersistence?.state !== "private";
  const canShare = !embeddedFacet && Boolean(
    f.versionContext?.reportVersionId
    || (f.persistence?.state === "persisted" && f.persistence.reportVersionId),
  );
  const canArchive = role === "owner" && Boolean(
    f.versionContext?.reportVersionId
    || (f.persistence?.state === "persisted" && f.persistence.reportVersionId),
  );
  const attestationLabel = versionContext?.attestationState === "server_collected"
    ? "server-collected snapshot"
    : versionContext?.attestationState === "analyst_submitted"
      ? "analyst-submitted snapshot"
      : versionContext
        ? "legacy snapshot"
        : null;
  const capturedLabel = versionContext?.createdAt
    ? new Date(versionContext.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;
  const strongestSupport = report.publishable_findings.find((finding) => finding.polarity > 0)?.claim
    ?? "No verified positive finding is stored in this snapshot.";
  const recordedConcern = report.publishable_findings.find((finding) => finding.polarity < 0)?.claim
    ?? [...f.contradictions].sort((left, right) => ({ high: 3, medium: 2, low: 1 }[right.severity] - { high: 3, medium: 2, low: 1 }[left.severity]))[0]?.conflict;
  const highestConcern = recordedConcern
    ?? (readiness.status === "ready"
      ? "No adverse finding is recorded; review the evidence before deciding."
      : "No adverse finding is recorded, but incomplete coverage prevents a clean inference.");
  const openCheckLabels = diligenceChecks
    .filter((check) => check.status === "unknown" || check.status === "unavailable" || check.status === "stale")
    .map((check) => check.label);
  const unresolvedSummary = openCheckLabels.length
    ? `${openCheckLabels.slice(0, 2).join(" · ")}${openCheckLabels.length > 2 ? ` · +${openCheckLabels.length - 2} more` : ""}`
    : "No unresolved applicable checks.";
  const [watched, setWatched] = useState(() => isWatched(report.handle));
  // The compounding web: who else (from your past audits) this subject is tied to.
  const connections = subjectConnections(report.handle, getContributions());
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [archiveState, setArchiveState] = useState<"idle" | "archiving" | "error">("idle");

  const archive = async () => {
    if (archiveState === "archiving") return;
    if (!window.confirm(
      `Archive ${report.handle}? Its immutable report, evidence, audit history, and trust-graph intelligence will be preserved. Active public share links will be revoked.`,
    )) return;
    setArchiveState("archiving");
    try {
      await changeReportLifecycle("archive", [{ kind: "person", ref: report.handle }]);
      onReset();
    } catch (archiveError) {
      console.error("[case] archive failed", archiveError);
      setArchiveState("error");
    }
  };
  const share = async () => {
    if (shareState === "creating") return;
    setShareState("creating");
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "person",
          ref: report.handle,
          reportVersionId: f.versionContext?.reportVersionId
            ?? (f.persistence?.state === "persisted" ? f.persistence.reportVersionId : undefined),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: unknown; message?: unknown };
      if (!response.ok || typeof body.url !== "string") {
        throw new Error(typeof body.message === "string" ? body.message : "Secure share link creation failed.");
      }
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(new URL(body.url, location.origin).toString());
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 1800);
    } catch (error) {
      console.error("[share] principal report failed", error);
      setShareState("error");
      setTimeout(() => setShareState("idle"), 3000);
    }
  };
  const watch = () => {
    if (!canMutateWorkspace) return;
    setWatched(
      toggleWatch({
        id: report.handle, kind: "person", label: report.handle, addedAt: 0,
        snapshot: { verdict: report.composite_verdict, score: report.governing_score },
      }),
    );
  };

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
              versionContext || !f.live
                ? { borderColor: "var(--color-line-2)", color: "var(--color-ink-faint)" }
                : f.live
                ? { borderColor: "var(--color-signal)", color: "var(--color-signal)" }
                : { borderColor: "var(--color-line-2)", color: "var(--color-ink-faint)" }
            }
            title={versionContext ? `Frozen immutable report version ${versionContext.version}` : f.live ? "Collected live from data providers" : "Curated dossier (no provider keys configured)"}
          >
            {versionContext ? `SNAPSHOT v${versionContext.version}` : f.live ? "● LIVE SCAN" : "CURATED"}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {onRescan && (
              <button onClick={onRescan} title="Run this audit again, fresh" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
                Rescan
              </button>
            )}
            {onOpenBrief && (
              <button
                type="button"
                onClick={onOpenBrief}
                title="Open the analyst decision brief anchored to this exact person case"
                className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:border-signal hover:text-signal"
              >
                Case brief
              </button>
            )}
            {canShare && (
              <button
                onClick={() => void share()}
                disabled={shareState === "creating"}
                aria-live="polite"
                title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable report link"}
                className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied ✓" : shareState === "error" ? "Share failed · retry" : "Share"}
              </button>
            )}
            {canMutateWorkspace && (
              <button onClick={watch} className="rounded-lg border px-3 py-1.5 text-[12.5px] transition" style={watched ? { borderColor: "var(--color-signal)", color: "var(--color-signal)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
                {watched ? "★ Watching" : "☆ Watch"}
              </button>
            )}
            <button
              onClick={onReset}
              className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink"
            >
              New audit
            </button>
            {canArchive && (
              <details className="relative">
                <summary className="list-none cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-faint transition hover:border-line-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                  More
                </summary>
                <div className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => void archive()}
                    disabled={archiveState === "archiving"}
                    title="Remove this case from active work while preserving its immutable evidence and history"
                    className="w-full rounded-lg px-3 py-2 text-left text-[12px] text-ink-dim transition hover:bg-signal/10 hover:text-signal disabled:cursor-wait disabled:opacity-60"
                  >
                    {archiveState === "archiving" ? "Archiving case…" : archiveState === "error" ? "Archive failed · retry" : "Archive case"}
                  </button>
                </div>
              </details>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5">
        {!versionContext && <div className="mt-4"><ServiceAlert /></div>}
        {versionContext && (
          <div className="mt-4">
            <SnapshotEvidenceControl
              snapshotVersion={versionContext.version}
              capturedAt={versionContext.createdAt}
              currentIntelligenceEnabled={currentIntelligenceEnabled}
              onLoadCurrentIntelligence={() => setCurrentIntelligenceVersionId(versionContext.reportVersionId)}
            />
          </div>
        )}
        {!versionContext && (showCurrentIntelligence || privateSession) && (
          <div className="mt-4">
            <LiveSupplementalNotice private={privateSession} persisted={livePersistence?.state === "persisted"} />
          </div>
        )}
        {persistencePending && (
          <div className="mt-4 rounded-xl border border-line bg-panel px-4 py-3 text-[11.5px] text-ink-dim" role="status">
            Saving the immutable audit before post-scan intelligence runs…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="mt-4 rounded-xl border border-caution/40 bg-caution/5 px-4 py-3 text-[11.5px] text-caution" role="alert">
            Post-scan intelligence is paused because this audit is not safely bound to an immutable version. Rescan before spending on supplemental providers.
          </div>
        )}
        {showCurrentIntelligence && <RingAlert handle={report.handle} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* subject identity */}
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <Avatar src={f.avatar_url || xAvatar(f.handle)} letter={f.avatar} size={56} rounded="rounded-2xl" letterClass="text-2xl" />
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
            <div className="shrink-0 text-center">
              <ScoreRing score={report.governing_score} verdict={presentedVerdict} size={96} />
              <div className="mono mt-1 text-[9.5px] uppercase tracking-wider text-ink-faint">axis score</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-ink-faint">Scored evidence verdict</div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[34px] font-bold leading-none tracking-tight" style={{ color: m.color }}>
                  {m.label}
                </span>
                {positiveVerdictNeedsQualification && (
                  <span className="mono rounded border px-2 py-1 text-[10px] uppercase tracking-wide" style={{ borderColor: `${scoredVerdictMeta.color}66`, color: scoredVerdictMeta.color }}>
                    preliminary model signal · {scoredVerdictMeta.label} {report.governing_score ?? "—"}
                  </span>
                )}
                {report.governing_role && (
                  <span className="mono mt-1 text-[12px] text-ink-faint">
                    governed by {ROLE_META[report.governing_role as SubjectClass].label.toLowerCase()}
                  </span>
                )}
              </div>
              <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
                {positiveVerdictNeedsQualification ? readiness.guidance : f.headline}
              </p>
              {positiveVerdictNeedsQualification && (
                <p className="mt-2 max-w-xl text-[11.5px] leading-relaxed text-ink-faint">
                  <span className="text-ink-dim">Preliminary scored-evidence summary — not clearance:</span> {f.headline}
                </p>
              )}
              {report.cap_applied && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12px]" style={{ borderColor: "var(--color-avoid)", color: "var(--color-avoid)" }}>
                  <span>▲</span> Hard cap · {capLabel(report.cap_applied)}
                </div>
              )}
            </div>
          </div>
          <div className="relative mt-5 border-t border-line/70 pt-4" aria-label="Due-diligence readiness">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-[10.5px] uppercase tracking-[0.16em]" style={{ color: readinessColor }}>
                {readiness.title}
              </span>
              <span className="text-[11px] text-ink-faint">observable outcomes stored in this report</span>
              <a href="#scan-methodology" className="ml-auto text-[11px] text-signal-dim underline-offset-2 hover:underline">
                Review coverage gaps
              </a>
            </div>
            {versionContext && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint" aria-label="Immutable report version metadata">
                <span className="mono uppercase tracking-wide">{versionContext.completenessState} version</span>
                {attestationLabel && <span>{attestationLabel}</span>}
                {capturedLabel && <span>captured {capturedLabel}</span>}
                {versionContext.methodologyVersion && <span className="mono">methodology {versionContext.methodologyVersion}</span>}
              </div>
            )}
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-line/70 bg-void/35 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-ink-faint">Evidence coverage</dt>
                <dd className="mono mt-0.5 text-[16px] font-semibold text-ink">{readiness.coveragePercent}%</dd>
              </div>
              <div className="rounded-lg border border-line/70 bg-void/35 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-ink-faint">Recorded outcomes</dt>
                <dd className="mono mt-0.5 text-[16px] font-semibold text-ink">{readiness.successful} / {readiness.applicable}</dd>
              </div>
              <div className="rounded-lg border border-line/70 bg-void/35 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-ink-faint">Unresolved checks</dt>
                <dd className="mono mt-0.5 text-[16px] font-semibold" style={{ color: readiness.unresolved ? readinessColor : "var(--color-ink)" }}>{readiness.unresolved}</dd>
              </div>
            </dl>
            <dl className="mt-3 grid gap-2 lg:grid-cols-3">
              <div className="rounded-lg border border-line/70 px-3 py-2.5">
                <dt className="text-[9.5px] uppercase tracking-wider text-ink-faint">Strongest recorded support</dt>
                <dd className="mt-1 text-[11px] leading-relaxed text-ink-dim">{strongestSupport}</dd>
              </div>
              <div className="rounded-lg border border-line/70 px-3 py-2.5">
                <dt className="text-[9.5px] uppercase tracking-wider text-ink-faint">Highest recorded concern</dt>
                <dd className="mt-1 text-[11px] leading-relaxed text-ink-dim">{highestConcern}</dd>
              </div>
              <div className="rounded-lg border border-line/70 px-3 py-2.5">
                <dt className="text-[9.5px] uppercase tracking-wider text-ink-faint">Open questions</dt>
                <dd className="mt-1 text-[11px] leading-relaxed text-ink-dim">{unresolvedSummary}</dd>
              </div>
            </dl>
            {!positiveVerdictNeedsQualification && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-ink-dim">{readiness.guidance}</p>
            )}
          </div>
        </div>

        {/* Supplemental live checks are deliberately separated from the frozen
            score. They self-gate on a resolved real name and never imply broad
            legal or sanctions clearance. */}
        {showCurrentIntelligence && (
          <div className="mt-3 space-y-2">
            <SanctionsNameScreen name={f.display_name} resolved={report.identity_confidence === "Confirmed" || report.identity_confidence === "Probable"} />
            <LegalScreen name={f.display_name} resolved={report.identity_confidence === "Confirmed" || report.identity_confidence === "Probable"} />
          </div>
        )}

        {/* identity: when a named team resolved it, SHOW the team here (the note
            would just narrate the same names); otherwise show the note.
            NOT for KOLs: a KOL's display name colliding with a real project (e.g.
            "@KaminoCrypto" vs the Kamino protocol) pulled that project's team in by
            NAME and wrongly presented it as this handle's identity. A KOL is a
            pseudonymous individual, not a project team — the name-search team is a
            collision, and the contradictions section already explains it. */}
        {report.governing_role !== "KOL" && webTeam && webTeam.length > 0 ? (
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
                      <Avatar src={personAvatar(p.handle, p.linkedin)} letter={(p.name.replace(/^@/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[9px]" />
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
                          <button key={j} onClick={() => onOpenProject(pr.name, undefined, panelCostToken)} title="Dig everyone on this project" className="rounded border border-line px-1.5 py-0.5 text-ink-dim transition hover:border-signal-dim hover:text-signal-dim">
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
        {showCurrentIntelligence && connections.length > 0 && (
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
                                <button onClick={() => onOpenProject(t.label, undefined, panelCostToken)} className="text-ink underline-offset-2 transition hover:text-signal-dim hover:underline">{t.label}</button>
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
                {gov && <RoleCard key={gov.role} rr={gov} governing coverageReady={readiness.status === "ready"} />}
                {others.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {others.map((rr) => (
                      <RoleCard key={rr.role} rr={rr} governing={false} coverageReady={readiness.status === "ready"} />
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
                          <button onClick={() => onOpenProject(v.project_name, undefined, panelCostToken)} className="truncate text-left text-ink underline-offset-2 transition hover:text-signal-dim hover:underline" title="See everyone who worked on this">{v.project_name}</button>
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

          {showCurrentIntelligence && panelCostToken && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="Profile photo" kicker="current supplemental check · not part of the scored evidence verdict">
                <PfpCheck handle={report.handle} brand={(webTeam?.length ?? 0) > 0} panelCostToken={panelCostToken} />
              </Section>
            </div>
          )}

          {/* code footprint — resolve the subject's GitHub from their handle/name/bio
              and analyse it (self-hides when no account is confidently matched) */}
          {showCurrentIntelligence && panelCostToken && <PersonGithub className="min-w-0 lg:col-span-2" handle={report.handle} name={f.display_name} bio={f.bio} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />}

          {/* The old "On-chain reality check" (a single promoted token → deployer)
              was removed: for KOLs the KOL report below is the richer superset, for
              funds a portfolio token isn't a promotion, and for everyone else it
              duplicated the token's own audit. Deployer/funder forensics live on
              each token's audit page. */}

          {showCurrentIntelligence && panelCostToken && roles.some((r) => r === "INVESTOR") && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="VC track record" kicker="their portfolio → each token bet priced on-chain: a fund graded on how its bets ended">
                <VcReport handle={report.handle} name={f.display_name || report.handle} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} onAudit={onAudit} />
              </Section>
            </div>
          )}

          {showCurrentIntelligence && panelCostToken && roles.some((r) => r === "KOL") && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="KOL report" kicker="a promoter's threat model: did their shilled tokens rug, and is their reach real?">
                <KolReport handle={report.handle} promotions={evidence.promotions ?? []} associates={evidence.associates ?? []} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} onAudit={onAudit} />
              </Section>
            </div>
          )}

          {(() => {
            // PROJECT accounts: domain age + audit-claim check from the bio link.
            const dom = (f.bio.match(/\b([a-z0-9][a-z0-9-]*\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1] ?? "").toLowerCase();
            return showCurrentIntelligence && roles.some((r) => r === "PROJECT") && dom ? (
              <div className="min-w-0 lg:col-span-2">
                <Section title="Project intelligence" kicker="domain age + claimed security audits — an established brand on a fresh domain is a contradiction">
                  <ProjectIntel domain={dom} />
                </Section>
              </div>
            ) : null;
          })()}

          {showCurrentIntelligence && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="In the news" kicker="current supplemental search · not part of the stored score">
                <NewsSection query={f.display_name || report.handle} handle={report.handle} />
              </Section>
            </div>
          )}

          {showCurrentIntelligence && panelCostToken && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="Identity continuity" kicker="current supplemental search · not part of the stored score">
                <IdentitySweep handle={report.handle} auto panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />
              </Section>
            </div>
          )}

          <div className="min-w-0 lg:col-span-2">
            <Section title="Connection web" kicker="click any node to open it · subject → projects → the people behind them">
              <Card className="p-2">
                <TrustGraph nodes={graph.nodes} edges={graph.edges} connections={showCurrentIntelligence ? connections : []} onAudit={onAudit} onOpenProject={onOpenProject ? (name) => onOpenProject(name, undefined, panelCostToken) : undefined} />
              </Card>
            </Section>
          </div>

          {/* transparent scan methodology — what ARGUS checked on this person */}
          <div className="min-w-0 lg:col-span-2">
            <MethodologyChecklist id="scan-methodology" checks={diligenceChecks} />
          </div>

          {/* ask-the-report chat — grounded in this person's own evidence */}
          <div className="min-w-0 lg:col-span-2">
            <AskReport subject={report.handle} context={[
              f.headline,
              `roles: ${roles.join(", ")}`,
              !versionContext && connections.length ? `already connected to: ${connections.map((c) => c.other).join(", ")}` : "",
              (evidence.ventures ?? []).length ? `ventures: ${evidence.ventures.map((v) => v.project_name).join(", ")}` : "",
              (webTeam ?? []).length ? `team/associates: ${webTeam.map((p) => p.name).join(", ")}` : "",
            ].filter(Boolean).join(" | ")} />
          </div>

          {/* analyst augmentation — add a piece the scan missed (verified before publish) */}
          {showCurrentIntelligence && canMutateWorkspace && (
            <div className="min-w-0 lg:col-span-2">
              <AddInfo subject={report.handle} subjectKind="person" canonicalRef={report.handle} subjectGraphKey={report.handle} />
            </div>
          )}

          {/* hard link — manually bridge this person to another entity in the graph */}
          {showCurrentIntelligence && canMutateWorkspace && (
            <div className="min-w-0 lg:col-span-2">
              <LinkEntity subject={report.handle} subjectKind="person" canonicalRef={report.handle} graphSubjectKey={report.handle} />
            </div>
          )}
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
