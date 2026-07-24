import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  Briefcase,
  WarningCircle,
  XCircle,
  Buildings,
  CheckCircle,
  Cube,
  Database,
  DotsThree,
  FileText,
  Fingerprint,
  Graph as GraphIcon,
  Handshake,
  ListChecks,
  MagnifyingGlassPlus,
  Megaphone,
  ShareNetwork,
  Star,
  UserCircle,
  UserFocus,
} from "@phosphor-icons/react";
import { usdCompact } from "../lib/format";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import type { Dossier } from "../data/dossier";
import type { SourceArtifact } from "../data/evidence";
import { SubjectClass, type RoleReport } from "../engine";
import { verdictMeta, ROLE_META, axisLabel, capLabel } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import { CopyTldrButton, OutcomeDeltaStrip, ProviderFailureNotice, ScoreContextStrip } from "./ScoreContext";
import { UsageVisuals } from "./UsageVisuals";
import { getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { Avatar } from "./Avatar";
import { xAvatar, personAvatar } from "../lib/avatars";
import { explorer, shortAddr, walletTier } from "../lib/wallets";
import { IdentitySweep } from "./IdentitySweep";
import { PfpCheck } from "./PfpCheck";
import { PersonGithub } from "./PersonGithub";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { decisionCriticalChecks, isAdverseFinding, personChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { coverageQualifiedCompleteness, exactReportPath, presentPublicReport } from "../lib/reportPresentation";
import { AddInfo } from "./AddInfo";
import { LinkEntity } from "./LinkEntity";
import { AskReport } from "./AskReport";
import { KolReport } from "./KolReport";
import { NewsSection } from "./NewsSection";
import { VcReport } from "./VcReport";
import { ProjectIntel } from "./ProjectIntel";
import { ProjectTokenCard } from "./ProjectTokenCard";
import { changeReportLifecycle } from "../lib/reports";
import { ServiceAlert } from "./ServiceAlert";
import { LegalScreen } from "./LegalScreen";
import { SanctionsNameScreen } from "./SanctionsNameScreen";
import { RingAlert } from "./RingAlert";
import { useArgusAuth } from "../auth-context";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import { DecisionBasis } from "./DecisionBasis";
import { isStrictFundScaleArtifact } from "../lib/fundScaleEvidence";
import { buildDecisionBasis } from "../lib/decisionBasis";
import {
  ReportCanvasNarrativeSection,
  ReportCanvasRailCard,
  ReportCanvasSectionNav,
  type ReportCanvasNarrativeItem,
  type ReportCanvasRailItem,
} from "./ReportCanvasPrimitives";
import {
  BasicFactsPanel,
  type BasicFactLeadView,
  type BasicFactView,
} from "./BasicFactsPanel";
import {
  basicFactQuestionOutcome,
  basicFactQuestionFor,
  basicFactQuestionsFor,
  canonicalBasicFactPredicate,
  supportsExplicitEmptyBasicFact,
} from "../lib/basicFactQuestions";

/* ── small primitives ─────────────────────────────────────────────── */

function RoleIcon({ role, size = 16 }: { role: string; size?: number }) {
  const Icon = role === "FOUNDER"
    ? UserFocus
    : role === "PROJECT"
      ? Cube
      : role === "KOL"
        ? Megaphone
        : role === "INVESTOR"
          ? Buildings
          : role === "ADVISOR"
            ? Handshake
            : role === "AGENCY"
              ? Briefcase
              : UserCircle;
  return <Icon aria-hidden="true" size={size} weight="duotone" />;
}

function VerdictPill({ verdict, size = "sm" }: { verdict: string; size?: "sm" | "lg" }) {
  const m = verdictMeta(verdict);
  const fail = verdict === "FAIL";
  return (
    <span
      className={`verdict-pill ${size === "lg" ? "verdict-pill-lg" : ""} ${fail ? "tint-fail" : "tint-var"}`}
      style={fail ? undefined : ({ "--tint": m.color } as React.CSSProperties)}
    >
      {m.label}
    </span>
  );
}

function ScoreRing({ score, verdict, size = 86, bands = false }: {
  score: number | null; verdict: string; size?: number; bands?: boolean;
}) {
  const m = verdictMeta(verdict);
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  // Published rubric zones on the ring track (FAIL 0-39, CAUTION 40-69,
  // PASS 70-100); 3px gaps articulate the 40 and 70 thresholds so the score
  // arc tip visibly lands inside its zone.
  const zone = (from: number, to: number) => ({
    strokeDasharray: `${Math.max(0, ((to - from) / 100) * c - 3)} ${c}`,
    strokeDashoffset: -((from / 100) * c) - 1.5,
  });
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {bands ? (
          <>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fail)" strokeOpacity="0.22" strokeWidth="4" style={zone(0, 40)} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-caution)" strokeOpacity="0.22" strokeWidth="4" style={zone(40, 70)} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-pass)" strokeOpacity="0.25" strokeWidth="4" style={zone(70, 100)} />
          </>
        ) : (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        )}
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
          {score == null ? "N/A" : score}
        </span>
        <span className="mono text-[10px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

/** Where a score sits inside its published rubric band, in investor words. */
function scoreBandPosition(score: number, capApplied?: string | null): string {
  if (capApplied) return "capped by a disqualifying finding";
  const band = score >= 70 ? { lo: 70, hi: 100, name: "pass band" }
    : score >= 40 ? { lo: 40, hi: 69, name: "caution band" }
      : { lo: 0, hi: 39, name: "fail band" };
  const t = (score - band.lo) / (band.hi - band.lo);
  return `${t >= 0.67 ? "top" : t >= 0.34 ? "middle" : "low end"} of the ${band.name}`;
}

type HeroProofTone = "pass" | "caution" | "avoid" | "neutral";
interface HeroProofChip { key: string; label: string; value?: string; tone: HeroProofTone; href: `#${string}`; title: string }

const PROOF_TONE_CLASS: Record<HeroProofTone, string> = {
  pass: "tint-pass", caution: "tint-caution", avoid: "tint-avoid font-medium", neutral: "",
};

function ProofChipStrip({ chips }: { chips: HeroProofChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" role="list" aria-label="Verification proof points">
      {chips.map((chip) => (
        <a key={chip.key} role="listitem" href={chip.href} title={chip.title}
          className={`chip min-h-8 px-2 transition hover:brightness-125 ${PROOF_TONE_CLASS[chip.tone]}`}>
          {chip.tone === "avoid" ? <XCircle aria-hidden="true" size={12} weight="fill" />
            : chip.tone === "caution" ? <WarningCircle aria-hidden="true" size={12} weight="bold" />
              : chip.tone === "pass" ? <CheckCircle aria-hidden="true" size={12} weight="fill" /> : null}
          {chip.label}
          {chip.value && <span className="tabular font-semibold normal-case">{chip.value}</span>}
        </a>
      ))}
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
        {kicker && <span className="text-[12.5px] text-ink-faint">{kicker}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>{children}</div>
  );
}

/**
 * Collapses long evidence lists behind a "View all" toggle. Nothing is
 * removed from the record: the full list stays in the DOM (print and
 * find-in-page still see it) and one click reveals it.
 */
function Clamp({ itemCount, threshold = 5, label, children }: {
  itemCount: number; threshold?: number; label: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const expand = () => setOpen(true);
    window.addEventListener("beforeprint", expand);
    return () => window.removeEventListener("beforeprint", expand);
  }, []);
  if (itemCount <= threshold) return <>{children}</>;
  return (
    <div>
      <div className={open ? undefined : "max-h-80 overflow-hidden [mask-image:linear-gradient(to_bottom,black_78%,transparent)]"}>
        {children}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-1 flex min-h-10 w-full items-center justify-center gap-1 text-[11.5px] text-signal-lift underline-offset-2 hover:underline"
      >
        {open ? "Show fewer" : `View all ${itemCount} ${label}`}
      </button>
    </div>
  );
}

const PROJECT_DILIGENCE_LABELS: Record<string, string> = {
  P1_team_and_identity: "Team and leadership",
  P2_product_substance: "Product and execution",
  P3_token_conduct: "Token design and conduct",
  P4_backing_and_partners: "Backers and partnerships",
  P5_traction_and_liveness: "Traction and usage",
  P6_transparency_integrity: "Transparency and integrity",
};

function diligenceAreaLabel(axis: string): string {
  if (PROJECT_DILIGENCE_LABELS[axis]) return PROJECT_DILIGENCE_LABELS[axis];
  const known = axisLabel(axis);
  if (known !== axis) return known;
  const plain = axis.replace(/^[A-Z]+\d+[\s_-]*/i, "").replace(/[_-]+/g, " ").trim();
  return plain ? plain.replace(/^./, (letter) => letter.toUpperCase()) : "Diligence area";
}

function sourceProviderLabel(provider: string): string {
  const known: Record<string, string> = {
    "google-news": "Independent news",
    "public-web": "Public web sources",
    "portfolio-web": "Portfolio sources",
    "fund-scale-web": "Fund disclosures",
    twitterapi: "Official X profile",
    grok: "Web research",
    "claude-web-search": "Web research",
    "argus-identity-bootstrap": "ARGUS identity check",
    "claude-vision": "Image review",
    github: "GitHub",
    opensanctions: "Sanctions screening",
    courtlistener: "Court records",
  };
  if (known[provider]) return known[provider];
  const plain = provider.replace(/[_-]+/g, " ").trim();
  return plain ? plain.replace(/^./, (letter) => letter.toUpperCase()) : "Source";
}

function evidenceStrength({
  score,
  weight,
  supportCount,
  counterCount = 0,
  questionCount = 0,
}: {
  score: number;
  weight: number;
  supportCount: number;
  counterCount?: number;
  questionCount?: number;
}): "Strong evidence" | "Moderate evidence" | "Limited evidence" {
  const ratio = weight > 0 ? score / weight : 0;
  if (supportCount >= 3 && ratio >= 0.72 && counterCount === 0 && questionCount === 0) return "Strong evidence";
  if (supportCount >= 2 && ratio >= 0.48 && counterCount <= 1) return "Moderate evidence";
  return "Limited evidence";
}

function questionMeta(count: number): string {
  return count > 0 ? ` · ${count} ${count === 1 ? "question" : "questions"} to verify` : "";
}

// Copy a full wallet address (the row shows a truncated form).
function CopyAddr({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      className="shrink-0 text-[11px] text-ink-faint transition hover:text-ink"
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
  evidenceRefs,
  counterEvidenceRefs,
  gaps,
}: {
  axis: string;
  score: number;
  weight: number;
  rationale: string;
  color: string;
  evidenceRefs?: string[];
  counterEvidenceRefs?: string[];
  gaps?: string[];
}) {
  const ratio = weight ? score / weight : 0;
  const weak = ratio < 0.45;
  const supportCount = evidenceRefs?.length ?? 0;
  const counterCount = counterEvidenceRefs?.length ?? 0;
  const questionCount = gaps?.length ?? 0;
  const strength = evidenceStrength({ score, weight, supportCount, counterCount, questionCount });
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-dim">{diligenceAreaLabel(axis)}</span>
        <span className="shrink-0 text-[11px] text-ink-faint">{strength}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ background: weak ? "var(--color-caution)" : color, width: `${ratio * 100}%`, transition: "width 0.7s ease-out" }}
        />
      </div>
      {rationale && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-faint">{rationale}</p>}
      {evidenceRefs && (
        <a
          href={`#decision-basis-${axis}`}
          className="mt-1.5 inline-flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-[12.5px] text-signal-lift underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <span>{supportCount} {supportCount === 1 ? "source" : "sources"} reviewed</span>
          {counterCount > 0 && <span className="text-caution">{counterCount} {counterCount === 1 ? "source needs" : "sources need"} reconciliation</span>}
          {questionCount > 0 && <span className="text-caution">{questionCount} {questionCount === 1 ? "question" : "questions"} to verify</span>}
          <span aria-hidden="true">↑</span>
        </a>
      )}
    </div>
  );
}

/* ── role card ────────────────────────────────────────────────────── */

type RoleScoreState = "final" | "provisional" | "incomplete";

function RoleCard({ rr, governing, scoreState }: { rr: RoleReport; governing: boolean; scoreState: RoleScoreState }) {
  const [open, setOpen] = useState(governing);
  const m = verdictMeta(rr.verdict);
  const role = ROLE_META[rr.role as SubjectClass];
  const axes = Object.entries(rr.axes);
  const coverageReady = scoreState === "final";
  const provisional = scoreState === "provisional";

  return (
    <Card className={governing ? "ring-1" : ""} >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        onClick={() => setOpen((o) => !o)}
        style={governing ? { boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.color} 36%, transparent)` } : undefined}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-panel-2 text-[15px]" style={{ color: m.color }}>
          <RoleIcon role={rr.role} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{role.label}</span>
            {governing && <span className="chip">governs</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <VerdictPill verdict={rr.verdict} />
            {!coverageReady && rr.verdict === "PASS" && (
              <span className="mono text-[11px] font-medium uppercase tracking-wide text-caution">
                {provisional ? "provisional score" : "scored axes only"}
              </span>
            )}
            {rr.cap_applied && (
              <span className="mono text-[11px] font-medium text-avoid">
                cap · {capLabel(rr.cap_applied)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-center">
          <ScoreRing score={rr.score_total} verdict={rr.verdict} size={64} />
          {!coverageReady && (
            <span className="mono mt-0.5 block text-[9px] font-medium uppercase tracking-wide text-caution">
              {provisional ? "provisional" : "preliminary"}
            </span>
          )}
        </div>
      </button>

      {open && axes.length > 0 && (
        <div className="overflow-hidden border-t border-line px-4 pb-3">
          {!coverageReady && (
            <p className="panel-inset mt-3 px-3 py-2 text-[11px] leading-relaxed text-caution" role="note">
              {provisional
                ? "Evidence-backed scored-axis breakdown. The score is provisional and final clearance remains withheld until the open evidence checks are resolved."
                : "Preliminary scored-axis breakdown. The final decision score is withheld until evidence coverage is complete."}
            </p>
          )}
          <div className="divide-y divide-line/60">
            {axes.map(([k, a]) => (
              <AxisBar
                key={k}
                axis={k}
                score={a.score}
                weight={a.weight}
                rationale={a.rationale}
                color={m.color}
                evidenceRefs={governing ? a.evidenceRefs : undefined}
                counterEvidenceRefs={governing ? a.counterEvidenceRefs : undefined}
                gaps={governing ? a.gaps : undefined}
              />
            ))}
          </div>
          {rr.dox_bonus > 0 && (
            <div className="panel-inset mt-2 flex items-center justify-between px-3 py-2 text-[12.5px]">
              <span className="text-ink-dim">Disclosure bonus (identity verified)</span>
              <span className="mono text-pass">+{rr.dox_bonus}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between px-1 text-[12.5px] text-ink-faint">
            <span>
              {coverageReady ? "raw" : provisional ? "provisional raw axis total" : "preliminary raw axis total"} {rr.raw_total} {rr.dox_bonus ? `+ ${rr.dox_bonus} bonus` : ""}
            </span>
            <span className="mono">= {coverageReady ? "" : provisional ? "provisional " : "preliminary "}{rr.score_total ?? "N/A"}{rr.cap_applied ? " (capped)" : ""}</span>
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
      <div className="grid grid-cols-[1.4fr_1fr_auto] gap-2 border-b border-line px-4 py-2 eyebrow">
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
            {/* null/undefined means the check never ran: render "unchecked",
                not an affirmative negative about a named person */}
            <div className="text-[12.5px] text-ink-dim">
              <span className={r.follows ? "text-ink-dim" : "text-ink-faint line-through/0"}>
                {r.follows ? "follows" : r.follows === false ? "no follow" : "follow unchecked"}
              </span>
              <span className="text-ink-faint"> · {!r.ack ? "ack unchecked" : r.ack !== "none" ? r.ack : "no ack"}</span>
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

type ReportFinding = Dossier["report"]["publishable_findings"][number];

const normalizedEntityHandle = (value?: string | null): string | null => {
  if (!value) return null;
  const match = value.trim().match(/^@?([A-Za-z0-9_]{1,30})$/);
  return match ? match[1].toLowerCase() : null;
};

const findingTarget = (finding: ReportFinding): string | null =>
  finding.finding_scope?.target_entity_key
  ?? finding.claim.match(/@([A-Za-z0-9_]{1,30})/)?.[0]
  ?? null;

/**
 * Stored snapshots are immutable, including early versions produced before the
 * engine enforced entity scope. Apply the current publication boundary as a
 * read-time projection so a historical model lead can never keep appearing as
 * verified subject evidence merely because the underlying payload is frozen.
 */
function isPublishableSubjectFinding(finding: ReportFinding, subject: string): boolean {
  if (finding.evidence_origin === "model_lead" || finding.artifact_verified === false) return false;
  if (finding.independent_source_count < 1) return false;
  if (finding.verification_status !== "Verified" && finding.verification_status !== "Reported") return false;
  const scope = finding.finding_scope;
  if (!scope) {
    // Pre-scope deterministic findings remain readable, but legacy discovery
    // types fail closed because their actual target was not stored separately.
    return !/Lead$/i.test(finding.finding_type);
  }
  return scope.scope === "direct_subject"
    && scope.relationship_to_subject === "self"
    && normalizedEntityHandle(scope.target_entity_key) === normalizedEntityHandle(subject);
}

function actionableInvestigativeLead(finding: ReportFinding): boolean {
  if (finding.artifact_verified === true && finding.evidence_origin !== "model_lead") return true;
  const source = safeSourceLink(finding.source_url);
  if (!source) return false;
  try {
    const url = new URL(source.href);
    const path = url.pathname.toLowerCase();
    return path !== "/search"
      && !path.startsWith("/search/")
      && !url.searchParams.has("q")
      && !url.searchParams.has("query");
  } catch {
    return false;
  }
}

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
                <p className="text-[13.5px] leading-snug text-ink">{f.claim}</p>
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
                    className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
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

function InvestigativeLeadsLedger({ leads, subject }: {
  leads: Dossier["report"]["investigative_leads"];
  subject: string;
}) {
  if (!leads.length) return null;
  return (
    <div className="space-y-2">
      {leads.map((lead, index) => {
        const scope = lead.finding_scope;
        const target = findingTarget(lead) || "unresolved target";
        const inferredRelated = !scope
          && normalizedEntityHandle(target) !== null
          && normalizedEntityHandle(target) !== normalizedEntityHandle(subject);
        const relationship = scope?.relationship_to_subject === "associate"
          ? "About an associate"
          : scope?.relationship_to_subject === "venture"
            ? "About a venture"
            : inferredRelated
              ? "About a related company"
              : "About this subject";
        const verifiedAboutTarget = lead.verification_status === "Verified"
          && lead.artifact_verified === true
          && lead.evidence_origin !== "model_lead";
        // Keep the not-scored disclosure explicit: these items never count as
        // evidence about the audited subject.
        const attributionStatus = verifiedAboutTarget
          ? "confirmed about the named entity · not scored"
          : "unconfirmed · not scored";
        const source = safeSourceLink(lead.source_url);
        return (
          <Card key={`${target}:${lead.claim}:${index}`} className="p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip tint-caution">
                {relationship}
              </span>
              <span className="mono text-[11px] text-ink">{target}</span>
              {scope?.relationship_label && <span className="text-[11px] text-ink-faint">· {scope.relationship_label}</span>}
              <span className="chip ml-auto">{attributionStatus}</span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{lead.claim}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              {verifiedAboutTarget
                ? `This artifact is verified about ${target}, but it is not evidence of conduct by ${subject}.`
                : `This is an unverified follow-up lead about ${target}, not verified evidence of conduct by ${subject}.`}
            </p>
            {source ? (
              <a
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open candidate source for investigative lead ${index + 1}: ${lead.claim}`}
                title={source.href}
                className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
              >
                <span className="shrink-0 text-ink-faint">{verifiedAboutTarget ? "Verified target source" : "Candidate source"}</span>
                <span className="truncate">{source.label}</span>
              </a>
            ) : (
              <p className="mt-2 text-[11px] text-ink-faint">Candidate source link unavailable</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

type FrozenSourceArtifact = NonNullable<Dossier["sourceArtifacts"]>[number];
type FrozenProfileAuthenticity = NonNullable<Dossier["profileAuthenticity"]>;
type FrozenTrustGraphScreen = NonNullable<Dossier["trustGraphScreen"]>;

function safeSourceLink(value?: string): { href: string; label: string } | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.hostname
      && !parsed.username
      && !parsed.password
    ) {
      return {
        href: parsed.href,
        label: `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
      };
    }
  } catch {
    // Malformed or non-web sources remain visible as unavailable metadata.
  }
  return null;
}

function frozenSourceDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function compactSourceDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

const PORTFOLIO_SOURCE_LABEL: Record<NonNullable<SourceArtifact["sourceClass"]>, string> = {
  first_party_subject: "subject's official site",
  first_party_investor: "investor's official site",
  first_party_project: "project announcement",
  public_primary: "public primary record",
  independent_press: "independent press",
  other_public: "public corroborating source",
};

const FUND_SCALE_METRIC_LABEL: Record<NonNullable<SourceArtifact["fundScaleMetric"]>, string> = {
  regulatory_aum: "regulatory AUM",
  reported_aum: "reported AUM",
  fund_vehicle: "fund vehicle",
  first_close: "first close",
  final_close: "final close",
};

const FUND_SCALE_BASIS_LABEL: Record<NonNullable<SourceArtifact["fundScaleBasis"]>, string> = {
  regulatory: "regulatory filing",
  manager_reported: "manager reported",
  press_corroborated: "press corroborated",
};

type InvestorSourceRole = "Affiliation source" | "Fund domain source" | "Scale source" | "Deal source";

function InvestorEvidenceLinks({
  sources,
  role,
  context,
}: {
  sources: readonly SourceArtifact[];
  role: InvestorSourceRole;
  context: string;
}) {
  const seen = new Set<string>();
  const references = sources.flatMap((source) => {
    const rawUrl = role === "Affiliation source"
      ? source.attributionSourceUrl
      : role === "Fund domain source"
        ? source.investorDomainSourceUrl
        : source.sourceUrl;
    const link = safeSourceLink(rawUrl);
    if (!link || seen.has(link.href)) return [];
    seen.add(link.href);
    const capturedValue = role === "Affiliation source"
      ? source.attributionCapturedAt ?? source.capturedAt
      : role === "Fund domain source"
        ? source.investorDomainCapturedAt ?? source.capturedAt
      : source.capturedAt;
    const capturedLabel = compactSourceDate(capturedValue);
    const publishedValue = role === "Scale source" ? source.publishedAt : undefined;
    const publishedLabel = compactSourceDate(publishedValue);
    const descriptor = role === "Affiliation source"
      ? `${source.subjectName || "subject"} affiliation with ${source.investorEntityName || source.fundName || "fund"}`
      : role === "Fund domain source"
        ? `${source.investorDomainProfileName || source.investorEntityName || source.fundName || "fund"} official domain ${source.investorEntityDomain || "unavailable"}`
      : source.title || (source.sourceClass ? PORTFOLIO_SOURCE_LABEL[source.sourceClass] : "public evidence");
    return [{
      href: link.href,
      hostAndPath: link.label,
      descriptor,
      capturedValue,
      capturedLabel,
      publishedValue,
      publishedLabel,
    }];
  });

  if (!references.length) {
    return <span className="text-[11px] text-ink-faint">{role} unavailable</span>;
  }

  return references.map((reference) => {
    const dateDescription = [
      reference.publishedLabel ? `source published ${reference.publishedLabel}` : null,
      reference.capturedLabel ? `captured ${reference.capturedLabel}` : "capture date unavailable",
    ].filter(Boolean).join("; ");
    return (
      <a
        key={`${role}:${reference.href}`}
        href={reference.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${role.toLowerCase()} for ${context}: ${reference.descriptor}; ${reference.hostAndPath}; ${dateDescription}`}
        className="link-ext mono inline-flex max-w-full flex-wrap items-center gap-x-1 text-[11px]"
      >
        <span className="text-ink-faint">{role}</span>
        <span aria-hidden="true">·</span>
        <span className="max-w-full truncate" title={reference.descriptor}>{reference.descriptor}</span>
        <span aria-hidden="true">·</span>
        <span>{reference.hostAndPath}</span>
        {reference.publishedLabel && reference.publishedValue && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-ink-faint">source published <time dateTime={reference.publishedValue}>{reference.publishedLabel}</time></span>
          </>
        )}
        <span aria-hidden="true">·</span>
        {reference.capturedLabel && reference.capturedValue ? (
          <span className="text-ink-faint">captured <time dateTime={reference.capturedValue}>{reference.capturedLabel}</time></span>
        ) : (
          <span className="text-ink-faint">capture date unavailable</span>
        )}
      </a>
    );
  });
}

function fundScaleTemporalLabel(source: SourceArtifact): string {
  const aum = source.fundScaleMetric === "regulatory_aum" || source.fundScaleMetric === "reported_aum";
  // Source publication and capture dates describe provenance, not the claim's
  // measurement or close date. Only claim-local fundScaleAsOf belongs here.
  const asOf = compactSourceDate(source.fundScaleAsOf);
  if (aum) {
    if (source.fundScaleTemporalState === "historical") return asOf ? `Historical AUM · As of ${asOf}` : "Historical AUM · as-of unavailable";
    return asOf ? `As of ${asOf}` : source.fundScaleTemporalState === "current" ? "Current AUM · as-of unavailable" : "AUM as-of unavailable";
  }
  if (source.fundScaleTemporalState === "fixed_historical") {
    const dateKind = source.fundScaleMetric === "first_close" || source.fundScaleMetric === "final_close"
      ? "Fund close date"
      : "Fund vehicle date";
    return asOf ? `${dateKind} · ${asOf}` : `${dateKind} not stated`;
  }
  if (source.fundScaleTemporalState === "historical") return asOf ? `Historical claim · As of ${asOf}` : "Historical claim · date not stated";
  return asOf ? `Claim date · ${asOf}` : "Claim date unavailable";
}

function formatFundScaleUsd(value?: number): string {
  return Number.isFinite(value) ? usdCompact(value) : "amount unavailable";
}

const SOURCE_KIND_LABEL: Record<FrozenSourceArtifact["kind"], string> = {
  press: "Press",
  legal_case: "Court record lead",
  sanctions_screen: "Sanctions screen",
  profile_photo: "Profile photo",
  trust_graph: "Trust graph screen",
  portfolio_relationship: "Portfolio relationship",
  fund_scale: "Fund scale",
};

const SOURCE_MATCH_LABEL: Record<FrozenSourceArtifact["match"], string> = {
  exact_name: "exact name",
  exact_handle: "exact handle",
  candidate: "candidate match",
  no_match: "no exact match",
  observed: "observed",
  risk_signal: "risk signal",
  screened_clear: "screened · no qualified match",
  relationship_confirmed: "relationship verified",
  fund_scale_confirmed: "fund size verified",
};

const PROFILE_CLASSIFICATION_LABEL: Record<FrozenProfileAuthenticity["classification"], string> = {
  real_candid: "Visually plausible personal photo",
  studio_or_stock: "Studio or stock-like image",
  ai_generated: "AI-generated image lead",
  celebrity_or_public_figure: "Public-figure image lead",
  logo_or_cartoon: "Logo or illustration",
  no_photo: "No custom profile photo",
  unclear: "Inconclusive image",
};

function validHash(value?: string): string | null {
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function safeFrozenImageData(value?: string): string | null {
  return value && /^data:image\/(?:jpeg|png|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : null;
}

function ExactVersionLink({ reportVersionId, version, label = "Open exact report version" }: { reportVersionId?: string; version?: number; label?: string }) {
  if (!reportVersionId) return null;
  return (
    <a
      href={exactReportPath(reportVersionId)}
      target="_blank"
      rel="noopener noreferrer"
      className="link-ext mono text-[11px]"
    >
      {label}{version != null ? ` v${version}` : ""}
    </a>
  );
}

function FrozenProfileAuthenticityPanel({
  result,
  artifact,
  reportVersionId,
  version,
}: {
  result: FrozenProfileAuthenticity;
  artifact?: FrozenSourceArtifact;
  reportVersionId?: string;
  version?: number;
}) {
  const capturedAt = frozenSourceDate(result.capturedAt);
  const imageHash = validHash(result.imageContentHash ?? artifact?.sourceContentHash);
  const artifactHash = validHash(artifact?.contentHash);
  const source = safeSourceLink(result.imageUrl ?? artifact?.sourceUrl);
  const frozenImageData = safeFrozenImageData(result.imageData);
  const imagePreview = frozenImageData ?? source?.href;
  const confidence = typeof result.confidence === "number"
    ? Math.round(Math.max(0, Math.min(1, result.confidence)) * 100)
    : null;
  const inconclusive = result.classification === "unclear";
  const tone = result.flag || inconclusive ? "var(--color-caution)" : "var(--color-signal)";
  const stateLabel = result.flag
    ? "REVIEW LEAD"
    : inconclusive
      ? "INCONCLUSIVE"
      : "VISUAL SCREEN RECORDED";

  return (
    <Section title="Profile-photo check" kicker="a quick photo check, not identity proof">
      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {imagePreview && result.classification !== "no_photo" && (
            <img
              src={imagePreview}
              alt="Profile image inspected by ARGUS"
              referrerPolicy="no-referrer"
              className="h-16 w-16 shrink-0 rounded-xl border border-line bg-void object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium text-ink">{PROFILE_CLASSIFICATION_LABEL[result.classification]}</span>
              <span className="chip tint-var" style={{ "--tint": tone } as React.CSSProperties}>
                {stateLabel}
              </span>
              {confidence != null && <span className="mono text-[11px] text-ink-faint">{confidence}% model confidence</span>}
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{result.note}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              This screen can surface synthetic, stock-like, or public-figure image leads. It cannot prove image ownership, identity, or web-wide reuse.
            </p>
            {result.tells.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Visible profile-image indicators">
                {result.tells.map((tell) => (
                  <span key={tell} className="chip">{tell}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 pt-3 text-[11px] text-ink-faint">
          {capturedAt && <span>Captured <time dateTime={result.capturedAt}>{capturedAt}</time></span>}
          <span className="mono" title={imageHash ?? undefined}>Source image SHA-256 {imageHash ? `${imageHash.slice(0, 12)}…` : "unavailable"}</span>
          {artifactHash && <span className="mono" title={artifactHash}>Artifact {artifactHash.slice(0, 12)}…</span>}
          {source && (
            <a href={source.href} target="_blank" rel="noopener noreferrer" className="link-ext mono">
              Open image source
            </a>
          )}
          <ExactVersionLink reportVersionId={reportVersionId} version={version} />
        </div>
        {imageHash && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {frozenImageData
              ? "The preview uses the exact image bytes retained with this report; the source-image hash verifies them."
              : source
                ? "The preview is loaded from the source URL and may change. The source-image hash identifies the exact bytes inspected in this report."
                : "No image preview is embedded in this snapshot. The source-image hash still identifies the exact bytes inspected."}
          </p>
        )}
      </Card>
    </Section>
  );
}

function FrozenTrustGraphPanel({
  screen,
  reportVersionId,
  version,
}: {
  screen: FrozenTrustGraphScreen;
  reportVersionId?: string;
  version?: number;
}) {
  const capturedAt = frozenSourceDate(screen.capturedAt);
  const graphHash = validHash(screen.sourceContentHash);
  const risk = screen.status === "risk";
  const incomplete = screen.status === "incomplete";
  const tone = risk
    ? screen.severity === "avoid" ? "var(--color-avoid)" : "var(--color-caution)"
    : incomplete ? "var(--color-caution)" : "var(--color-signal)";
  const stateLabel = risk
    ? "RISK SIGNAL"
    : incomplete
      ? "INCOMPLETE"
      : "SCREENED · NO QUALIFIED FLAGGED LINK";

  return (
    <Section title="Known connections" kicker="checked against every case your team has audited">
      <Card className="overflow-hidden">
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip tint-var" style={{ "--tint": tone } as React.CSSProperties}>
              {stateLabel}
            </span>
            {screen.severity && risk && <span className="mono text-[11px] uppercase text-ink-faint">{screen.severity} policy tier</span>}
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{screen.line}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            This is the graph state available at capture time. A shared person, wallet, funder, or project is an investigative lead; it is not proof of common control by itself.
          </p>

          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="stat-tile">
              <dt className="stat-label">Qualified reports</dt>
              <dd className="stat-value mt-0.5 font-semibold">{screen.qualifiedContributionCount} / {screen.contributionCount}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Connections surfaced</dt>
              <dd className="stat-value mt-0.5 font-semibold">{screen.connections.length}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Graph snapshot</dt>
              <dd className="mono mt-0.5 truncate text-[11px] text-ink-dim" title={graphHash ?? undefined}>{graphHash ? `${graphHash.slice(0, 16)}…` : "hash unavailable"}</dd>
            </div>
          </dl>
        </div>

        {screen.connections.length > 0 && (
          <div className="divide-y divide-line/60 border-t border-line/60">
            {screen.connections.map((connection) => {
              return (
                <article key={`${connection.other}:${connection.otherReportVersionId ?? "unversioned"}`} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-[12.5px] font-medium text-ink">{connection.other}</span>
                    {connection.otherVerdict && <VerdictPill verdict={connection.otherVerdict} />}
                    <span className={`chip ${connection.qualified ? "tint-pass" : ""}`}>
                      {connection.qualified ? "decision-qualified snapshot" : "context only"}
                    </span>
                    {connection.direct && <span className="text-[11px] text-ink-faint">directly surfaced</span>}
                    <span className="ml-auto">
                      <ExactVersionLink reportVersionId={connection.otherReportVersionId} label="Open exact connected report" />
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                    {connection.otherAttestation && <span>{connection.otherAttestation.replace(/_/g, " ")}</span>}
                    {connection.otherCompleteness && <span>{connection.otherCompleteness} coverage</span>}
                    {!connection.otherReportVersionId && <span>Exact report version unavailable</span>}
                  </div>
                  {connection.ties.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Frozen ties to ${connection.other}`}>
                      {connection.ties.map((tie) => (
                        <span key={`${tie.key}:${tie.strength}`} className="chip normal-case" title={[...tie.subjectEdgeTypes, ...tie.otherEdgeTypes].join(" · ")}>
                          <span className="uppercase text-ink-faint">{tie.strength}</span>
                          {tie.label}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 px-4 py-3 text-[11px] text-ink-faint">
          {capturedAt && <span>Captured <time dateTime={screen.capturedAt}>{capturedAt}</time></span>}
          <span className="mono" title={graphHash ?? undefined}>Graph snapshot SHA-256 {graphHash ? `${graphHash.slice(0, 12)}…` : "unavailable"}</span>
          <ExactVersionLink reportVersionId={reportVersionId} version={version} />
        </div>
      </Card>
    </Section>
  );
}

function FrozenSourceLedger({
  artifacts,
  subjectHandle,
  profile,
}: {
  artifacts: FrozenSourceArtifact[];
  subjectHandle: string;
  profile: unknown;
}) {
  if (!artifacts.length) return null;
  const fundScalePeers = artifacts.filter((artifact) => artifact.kind === "fund_scale");
  return (
    <div id="frozen-source-ledger" className="scroll-mt-24">
      <Section
        title="Sources we saved"
        kicker="every article and page used, saved exactly as read"
      >
        <Card className="divide-y divide-line/60 overflow-hidden">
        {artifacts.map((artifact, index) => {
          const source = safeSourceLink(artifact.sourceUrl);
          const capturedAt = frozenSourceDate(artifact.capturedAt);
          const publishedAt = frozenSourceDate(artifact.publishedAt);
          const hash = validHash(artifact.contentHash);
          const sourceHash = validHash(artifact.sourceContentHash);
          const sourceHashLabel = artifact.kind === "sanctions_screen"
            ? "Source index"
            : artifact.kind === "profile_photo"
              ? "Source image"
              : artifact.kind === "trust_graph"
                ? "Graph snapshot"
                : "Source content";
          const strictFundScaleMatch = artifact.kind === "fund_scale"
            && isStrictFundScaleArtifact(artifact, fundScalePeers, { subjectHandle, profile });
          const matchLabel = artifact.kind === "fund_scale" && artifact.match === "fund_scale_confirmed"
            ? strictFundScaleMatch ? "fund size verified" : "reported · strict verification incomplete"
            : SOURCE_MATCH_LABEL[artifact.match];
          const matchColor = artifact.match === "risk_signal"
            ? "var(--color-caution)"
            : artifact.match === "relationship_confirmed" || strictFundScaleMatch
              ? "var(--color-pass)"
            : artifact.match === "candidate"
              ? "var(--color-caution)"
              : artifact.match === "no_match" || artifact.match === "screened_clear"
                ? "var(--color-ink-dim)"
                : "var(--color-signal)";
          return (
            <article id={`source-${artifact.contentHash}`} key={`${artifact.provider}:${artifact.contentHash}:${index}`} className="scroll-mt-24 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">
                  {SOURCE_KIND_LABEL[artifact.kind]}
                </span>
                <span className="mono text-[11px] uppercase tracking-wide text-ink-faint">{artifact.provider}</span>
                <span className="chip tint-var" style={{ "--tint": matchColor } as React.CSSProperties}>
                  {matchLabel}
                </span>
              </div>
              <h3 className="mt-2 text-[13.5px] font-medium leading-snug text-ink">{artifact.title}</h3>
              {artifact.excerpt && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{artifact.excerpt}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                {publishedAt && <span>Published <time dateTime={artifact.publishedAt}>{publishedAt}</time></span>}
                {capturedAt && <span>Captured <time dateTime={artifact.capturedAt}>{capturedAt}</time></span>}
                <span className="mono" title={hash ?? undefined}>SHA-256 {hash ? `${hash.slice(0, 12)}…` : "unavailable"}</span>
                {sourceHash && <span className="mono" title={sourceHash}>{sourceHashLabel} {sourceHash.slice(0, 12)}…</span>}
              </div>
              {source ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
                  aria-label={`Open frozen ${SOURCE_KIND_LABEL[artifact.kind].toLowerCase()} source in a new tab: ${artifact.title}`}
                >
                  <span className="shrink-0 text-ink-faint">Open source</span>
                  <span className="truncate">{source.label}</span>
                </a>
              ) : (
                <p className="mt-2 text-[11px] text-ink-faint">Source link unavailable</p>
              )}
            </article>
          );
        })}
        </Card>
      </Section>
    </div>
  );
}

/* ── main report ──────────────────────────────────────────────────── */

type ReportTeamMember = Dossier["webTeam"][number];

function placeholderEntityValue(value: unknown): boolean {
  return typeof value === "string"
    && /^(?:<\s*)?(?:unknown|n\/a|null|undefined)(?:\s*>)?$/i.test(value.trim());
}

function meaningfulTeamMember(member: ReportTeamMember): boolean {
  const name = member.name.trim();
  const role = member.role.trim();
  return Boolean(name)
    && !placeholderEntityValue(name)
    && !placeholderEntityValue(role);
}

function groundedTeamMember(member: ReportTeamMember): boolean {
  return meaningfulTeamMember(member)
    && member.evidence_origin !== "model_lead"
    && member.artifact_verified === true;
}

function sanitizedGroundedTeamMember(member: ReportTeamMember): ReportTeamMember {
  return {
    ...member,
    ...(member.identity_link_evidence_origin === "model_lead"
      ? { handle: undefined, linkedin: undefined }
      : {}),
    ...(member.projects_evidence_origin === "model_lead" ? { projects: [] } : {}),
  };
}

function reportTeamLeads(dossier: Dossier): ReportTeamMember[] {
  // assembleDossier already emits model-enriched grounded members into
  // webTeamLeads (handle kept, source suffixed); re-deriving them from the
  // sanitized webTeam copy renders the same person twice. Client derivation
  // stays only as compat for persisted dossiers that predate webTeamLeads.
  const inferred = dossier.webTeamLeads ? [] : (dossier.webTeam ?? []).flatMap((member) => {
    if (!groundedTeamMember(member)) return [member];
    // Compat path mirrors assembleDossier: only an unproven identity link
    // re-renders a verified person as a candidate; model-found projects alone
    // never do.
    if (member.identity_link_evidence_origin !== "model_lead") return [];
    return [{
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
    }];
  });
  const seen = new Set<string>();
  return [...(dossier.webTeamLeads ?? []), ...inferred].filter((member) => {
    if (!meaningfulTeamMember(member)) return false;
    // A model-only name with no stable identity locator is not an actionable
    // candidate. Showing generic names makes unrelated search snippets look
    // like team evidence and gives the reader no way to verify them.
    if (!member.handle?.trim() && !member.linkedin?.trim()) return false;
    const key = [member.name, member.handle ?? "", member.linkedin ?? "", member.role, member.source].join("|").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const REPORT_PROJECT_PRODUCT_LANGUAGE = /\b(?:app|application|borrow|build|chain|coins?|develop|exchange|launch|launchpad|lend|marketplace|network|operate|payments?|platform|protocol|provide|stake|tokens?|trade|trading|wallet)\b/i;

function reportProjectProductFromBio(bio?: string): string | null {
  const cleaned = (bio ?? "")
    .replace(/\s+(?:at|via)\s+https?:\/\/\S+\s*$/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 10 || cleaned.length > 240 || !REPORT_PROJECT_PRODUCT_LANGUAGE.test(cleaned)) return null;
  return cleaned;
}

function isExactOfficialXProfile(url: string | undefined, handle: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return (host === "x.com" || host === "twitter.com")
      && path === `/${handle.replace(/^@/, "").toLowerCase()}`;
  } catch {
    return false;
  }
}

/**
 * Frozen payloads stay immutable. This read-time publication projection only
 * removes unrelated identity citations and materializes a first-party product
 * answer already present in the stored provider-resolved X profile.
 */
function reportBasicFacts(dossier: Dossier, audience: "project" | "investor" | "founder" | "person"): BasicFactView[] {
  const facts = (dossier.basicFacts ?? []).map((fact): BasicFactView => {
    if (fact.predicate !== "official_identity") return fact;
    const sources = fact.sources ?? [];
    const hasOfficialProfile = sources.some((source) => isExactOfficialXProfile(source.url, dossier.handle));
    if (!hasOfficialProfile) return fact;
    return {
      ...fact,
      sources: sources.filter((source) =>
        isExactOfficialXProfile(source.url, dossier.handle)
        || source.sourceClass === "official_subject"
        || source.sourceClass === "official_counterparty"
        || source.sourceClass === "regulatory_or_onchain"),
    };
  });
  if (
    audience !== "project"
    || facts.some((fact) =>
      canonicalBasicFactPredicate(fact.predicate) === "product"
      && (fact.status === "verified" || fact.status === "corroborated"))
    || dossier.profile_collection_state !== "resolved"
    || dossier.profile_provider !== "twitterapi"
  ) return facts;
  const product = reportProjectProductFromBio(dossier.bio);
  if (!product) return facts;
  const handle = dossier.handle.replace(/^@/, "");
  return [...facts, {
    factId: `profile-product:${handle.toLowerCase()}`,
    predicate: "product",
    value: product,
    normalizedValue: product.toLowerCase(),
    qualifier: "first-party project description",
    status: "verified",
    critical: true,
    sources: [{
      url: `https://x.com/${encodeURIComponent(handle)}`,
      title: "Official X profile",
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: `${dossier.display_name} (${dossier.handle}): ${dossier.bio}`,
      provider: "twitterapi",
    }],
  }];
}

// What this run actually cost, from the provider ledger frozen with the
// report. Keyless or pre-ledger scans have no ledger and render nothing.
// Paid providers only: the ledger also records every free call ($0 lines
// for caches and keyless sources), which would inflate "across N providers"
// into a claim the money trail cannot support.
function RunCostLine({ cost }: { cost: Dossier["cost"] }) {
  if (!cost || !(cost.usd > 0)) return null;
  const providers = new Set((cost.calls ?? []).filter((c) => c.usd > 0).map((c) => c.provider)).size;
  const scope = providers > 1 ? ` across ${providers} providers` : "";
  const claudeShare = cost.claudeUsd > 0 && cost.claudeUsd < cost.usd
    ? ` Claude research and analysis was $${cost.claudeUsd.toFixed(2)} of it.`
    : "";
  return (
    <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-faint">
      This investigation cost about ${cost.usd.toFixed(2)}{scope}.{claudeShare}
    </p>
  );
}

export function Report({ dossier, onReset, onAudit, onRescan, onOpenProject, onOpenBrief }: { dossier: Dossier; onReset: () => void; onAudit?: (q: string) => void; onRescan?: () => void; onOpenProject?: (name: string, domain?: string, panelCostToken?: string) => void; onOpenBrief?: () => void }) {
  const { role } = useArgusAuth();
  const f = dossier;
  const { report, graph, founderSummary, evidence } = dossier;
  const fundScaleProfile = {
    handle: f.handle,
    display_name: f.display_name,
    resolved_name: f.resolved_name,
    bio: f.bio,
    website: f.website,
    profile_collection_state: f.profile_collection_state,
    profile_provider: f.profile_provider,
    profile_captured_at: f.profile_captured_at,
  };
  const webTeam = (dossier.webTeam ?? []).filter(groundedTeamMember).map(sanitizedGroundedTeamMember);
  const webTeamLeads = reportTeamLeads(dossier);
  const placeholderGraphKeys = new Set(graph.nodes
    .filter((node) => placeholderEntityValue(node.key) || placeholderEntityValue(node.label))
    .map((node) => node.key));
  const visibleGraphNodes = graph.nodes.filter((node) => !placeholderGraphKeys.has(node.key));
  const visibleGraphEdges = graph.edges.filter((edge) =>
    !placeholderGraphKeys.has(edge.src) && !placeholderGraphKeys.has(edge.dst));
  const portfolioArtifactGroups = [...(f.sourceArtifacts ?? [])
    .filter((artifact) => artifact.kind === "portfolio_relationship" && artifact.projectName)
    .reduce((groups, artifact) => {
      const investor = artifact.investorEntityName || artifact.subjectName || f.display_name || report.handle;
      const subject = artifact.subjectName || f.display_name || report.handle;
      const attribution = artifact.attribution ?? "unattributed";
      const key = `${investor.trim().toLowerCase()}::${artifact.projectName!.trim().toLowerCase()}::${attribution}`;
      const group = groups.get(key) ?? { key, project: artifact.projectName!, investor, subject, attribution: artifact.attribution, sources: [] as SourceArtifact[] };
      group.sources.push(artifact);
      groups.set(key, group);
      return groups;
    }, new Map<string, { key: string; project: string; investor: string; subject: string; attribution?: SourceArtifact["attribution"]; sources: SourceArtifact[] }>())
    .values()]
    .map((group) => ({
      ...group,
      confirmed: group.sources.some((source) => source.match === "relationship_confirmed"),
      confirmedSourceCount: group.sources.filter((source) => source.match === "relationship_confirmed").length,
      reportedSourceCount: group.sources.filter((source) => source.match !== "relationship_confirmed").length,
    }))
    .sort((left, right) => Number(right.confirmed) - Number(left.confirmed) || left.project.localeCompare(right.project));
  const verifiedPortfolioProjects = portfolioArtifactGroups.filter((group) => group.confirmed).map((group) => group.project);
  const reportedPortfolioProjects = portfolioArtifactGroups.filter((group) => !group.confirmed).map((group) => group.project);
  const fundScaleArtifacts = (f.sourceArtifacts ?? []).filter((artifact) => artifact.kind === "fund_scale");
  const fundScaleArtifactGroups = [...fundScaleArtifacts
    .filter((artifact) => artifact.kind === "fund_scale" && artifact.fundName && Number.isFinite(artifact.fundSizeUsd))
    .reduce((groups, artifact) => {
      const key = artifact.fundScaleClaimId?.trim() || [
        "legacy",
        artifact.fundName!.trim().toLowerCase(),
        artifact.fundVehicle?.trim().toLowerCase() ?? "vehicle-unknown",
        artifact.fundScaleMetric ?? "metric-unknown",
        artifact.fundSizeUsd,
        artifact.fundAmountQualifier ?? "qualifier-unknown",
        artifact.attribution ?? "attribution-unknown",
      ].join("::");
      const group = groups.get(key) ?? {
        key,
        fundName: artifact.fundName!,
        amountUsd: artifact.fundSizeUsd!,
        metric: artifact.fundScaleMetric,
        qualifier: artifact.fundAmountQualifier,
        attribution: artifact.attribution,
        sources: [] as SourceArtifact[],
      };
      group.sources.push(artifact);
      groups.set(key, group);
      return groups;
    }, new Map<string, {
      key: string;
      fundName: string;
      amountUsd: number;
      metric?: SourceArtifact["fundScaleMetric"];
      qualifier?: SourceArtifact["fundAmountQualifier"];
      attribution?: SourceArtifact["attribution"];
      sources: SourceArtifact[];
    }>())
    .values()]
    .map((group) => {
      const strictSources = group.sources.filter((source) => isStrictFundScaleArtifact(source, fundScaleArtifacts, {
        subjectHandle: report.handle,
        profile: fundScaleProfile,
      }));
      const representative = strictSources[0] ?? group.sources[0];
      const namedVehicle = (strictSources.length ? strictSources : group.sources)
        .find((source) => source.fundVehicle && source.fundVehicle !== "Unspecified Fund")
        ?.fundVehicle;
      return {
        ...group,
        subject: representative.subjectName || f.display_name || report.handle,
        investor: representative.investorEntityName || group.fundName,
        fundVehicle: namedVehicle ?? representative.fundVehicle,
        basis: representative.fundScaleBasis,
        temporalLabel: fundScaleTemporalLabel(representative),
        confirmed: strictSources.length > 0,
        confirmedSourceCount: strictSources.length,
        reportedSourceCount: group.sources.length - strictSources.length,
      };
    })
    .sort((left, right) => Number(right.confirmed) - Number(left.confirmed) || right.amountUsd - left.amountUsd);
  const verifiedFundScaleClaims = fundScaleArtifactGroups.filter((group) => group.confirmed);
  const reportedFundScaleClaims = fundScaleArtifactGroups.filter((group) => !group.confirmed);
  const reportedFundScaleOverlapCount = (group: (typeof fundScaleArtifactGroups)[number]) =>
    reportedFundScaleClaims.filter((candidate) =>
      candidate.fundName.trim().toLowerCase() === group.fundName.trim().toLowerCase()
      && candidate.amountUsd === group.amountUsd
      && candidate.metric === group.metric
      && candidate.attribution === group.attribution,
    ).length;
  const portfolioLeads = f.portfolioLeads ?? [];
  const verifiedPortfolioProjectKeys = new Set(verifiedPortfolioProjects.map((project) => project.trim().toLowerCase()));
  const unmatchedPortfolioLeadCount = portfolioLeads.filter((lead) =>
    !verifiedPortfolioProjectKeys.has(lead.projectName.trim().toLowerCase())).length;
  const roles = report.roles as SubjectClass[];
  const basicFactLeads: BasicFactLeadView[] = f.basicFactLeads ?? [];
  const ledgerAudience = f.basicFactQuestionLedger?.[0]?.audience;
  const basicFactsAudience = ledgerAudience === "project"
    ? "project" as const
    : ledgerAudience === "investor"
      ? "investor" as const
      : ledgerAudience === "person"
        ? roles.includes(SubjectClass.FOUNDER) ? "founder" as const : "person" as const
        : roles.includes(SubjectClass.PROJECT)
          ? "project" as const
          : roles.includes(SubjectClass.INVESTOR)
            ? "investor" as const
          : roles.includes(SubjectClass.FOUNDER)
              ? "founder" as const
              : "person" as const;
  const basicFacts = reportBasicFacts(f, basicFactsAudience);
  const basicFactResearchAttempted = basicFacts.length > 0
    || basicFactLeads.length > 0
    || (f.basicFactQuestionLedger?.length ?? 0) > 0;
  const fillDecisionFacts = basicFactsAudience !== "person" && basicFactResearchAttempted;
  const showBasicFacts = basicFactResearchAttempted;
  const governingRoleReport = report.role_reports.find((rr) => rr.role === report.governing_role)
    ?? report.role_reports[0];
  const governingAxes = Object.entries(governingRoleReport?.axes ?? {});
  const decisionBasisSummary = buildDecisionBasis(governingRoleReport, f.axisEvidenceCatalog, f.axisCitationVersion);
  const evidenceBackedAxisCount = decisionBasisSummary.evidenceBacked;
  const routingUnresolved = roles.length === 0;
  const scoringOutputIncomplete = roles.length > 0 && governingAxes.length === 0;
  const decisionFrameworkUnavailable = routingUnresolved || scoringOutputIncomplete;
  const resolvedRoleLabel = report.governing_role
    ? ROLE_META[report.governing_role as SubjectClass]?.label ?? report.governing_role
    : roles[0]
      ? ROLE_META[roles[0]]?.label ?? roles[0]
      : "subject";
  const derivedDiligenceChecks = personChecks({
    identityConfidence: report.identity_confidence ?? undefined,
    realName: (f.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
    roles,
    hasAssociates: (evidence.associates?.length ?? 0) > 0,
  });
  const versionContext = f.versionContext ?? f.viewVersionContext;
  const diligenceChecks = versionContext
    ? versionContext.checks
    : f.checkRuns?.length
      ? f.checkRuns
      : derivedDiligenceChecks;
  const legacyCoverageNotCaptured = versionContext?.attestationState === "legacy_unattested"
    && versionContext.checks.length === 0;
  // Screens that completed and explicitly found nothing: the honest content
  // of a favorable "what could break the thesis" section when no adverse
  // finding exists.
  const cleanScreens = diligenceChecks.filter((check) => check.status === "checked-empty");
  const readiness = deriveDecisionReadiness(
    diligenceChecks,
    versionContext?.attestationState === "legacy_unattested"
      ? {}
      : {
          roleCount: roles.length,
          decisionAxisTotal: governingAxes.length,
          evidenceBackedAxes: evidenceBackedAxisCount,
        },
  );
  const recordedCompleteness = versionContext?.completenessState ?? f.completeness_state;
  const presentationCompleteness = coverageQualifiedCompleteness({
    completeness: recordedCompleteness ?? (readiness.status === "ready" ? "complete" : "partial"),
    attestation: versionContext?.attestationState ?? (f.live ? "server_collected" : undefined),
    checks: diligenceChecks,
  });
  const presentation = presentPublicReport({
    verdict: report.composite_verdict,
    score: report.governing_score,
    completeness: presentationCompleteness,
    readiness: {
      status: readiness.status,
      coveragePercent: readiness.coveragePercent,
      roleCount: roles.length,
      decisionAxisTotal: readiness.decisionAxisTotal,
      evidenceBackedAxes: readiness.evidenceBackedAxes,
      neededEvidenceSummary: readiness.unresolved > 0
        ? `${readiness.unresolved} of ${readiness.applicable} applicable evidence checks remain open.`
        : "No open evidence checks remain.",
    },
  });
  const readinessTitle = legacyCoverageNotCaptured ? "Coverage not captured" : readiness.title;
  const readinessGuidance = legacyCoverageNotCaptured
    ? "This report was saved before per-check results were recorded. The score is preserved for history, not as proof the checks ran."
    : readiness.guidance;
  const presentedVerdict = presentation.displayVerdict === "UNVERIFIABLE"
    ? "UNVERIFIABLE_IDENTITY"
    : presentation.displayVerdict;
  const roleScoreState: RoleScoreState = presentation.final
    ? "final"
    : presentation.displayVerdict === "PROVISIONAL"
      ? "provisional"
      : "incomplete";
  const m = verdictMeta(presentedVerdict);
  const verdictTextClass = presentedVerdict === "PASS"
    ? "text-pass"
    : presentedVerdict === "CAUTION" || presentedVerdict === "PROVISIONAL"
      ? "text-caution"
      : presentedVerdict === "FAIL"
        ? "text-fail"
        : presentedVerdict === "AVOID"
          ? "text-avoid"
          // Only a suspected-impersonation verdict is "unverifiable" (purple);
          // INCOMPLETE means insufficient evidence, which is neutral, not a
          // finding about identity — never borrow the impersonation color.
          : presentedVerdict === "UNVERIFIABLE_IDENTITY"
            ? "text-unverifiable"
            : "text-ink-dim";
  const embeddedFacet = Boolean(f.viewVersionContext || f.viewPersistence);
  const livePersistence = f.viewPersistence ?? f.persistence;
  const panelCostToken = !versionContext && livePersistence?.state === "persisted"
    ? livePersistence.panelCostToken ?? undefined
    : undefined;
  const evidenceReportVersionId = versionContext?.reportVersionId
    ?? (livePersistence?.state === "persisted" ? livePersistence.reportVersionId ?? undefined : undefined);
  const liveCoreSnapshotSaved = !versionContext
    && livePersistence?.state === "persisted"
    && Boolean(livePersistence.reportVersionId);
  const immutableReviewHref = liveCoreSnapshotSaved && livePersistence?.reportVersionId
    ? exactReportPath(livePersistence.reportVersionId)
    : null;
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
  const frozenOutcomeChecks = versionContext?.checks ?? f.checkRuns ?? [];
  const recordedFrozenCheck = (checkId: string) => frozenOutcomeChecks.some((check) =>
    check.checkId === checkId
    && check.status !== "unknown"
    && check.status !== "stale",
  );
  const profilePhotoArtifact = f.sourceArtifacts?.find((artifact) => artifact.kind === "profile_photo");
  const trustGraphArtifact = f.sourceArtifacts?.find((artifact) => artifact.kind === "trust_graph");
  const hasFrozenProfilePhotoOutcome = Boolean(
    f.profileAuthenticity
    || profilePhotoArtifact
    || recordedFrozenCheck("profile-photo-authenticity"),
  );
  const hasFrozenTrustGraphOutcome = Boolean(
    f.trustGraphScreen
    || trustGraphArtifact
    || recordedFrozenCheck("trust-graph-connections"),
  );
  const explicitCurrentOverlay = Boolean(versionContext && currentIntelligenceEnabled);
  const hasFrozenOffchainOutcomes = ["news-press", "us-legal-history", "ofac-sanctions-name"].every(
    (checkId) => frozenOutcomeChecks.some((check) =>
      check.checkId === checkId && check.status !== "unknown" && check.status !== "stale",
    ),
  );
  const showOffchainSupplemental = showCurrentIntelligence
    && (explicitCurrentOverlay || !hasFrozenOffchainOutcomes);
  const showProfilePhotoSupplemental = showCurrentIntelligence
    && (explicitCurrentOverlay || !hasFrozenProfilePhotoOutcome);
  const showTrustGraphSupplemental = showCurrentIntelligence
    && (explicitCurrentOverlay || !hasFrozenTrustGraphOutcome);
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
  const publishableSubjectFindings = report.publishable_findings.filter((finding) =>
    isPublishableSubjectFinding(finding, report.handle),
  );
  const quarantinedLegacyFindings = report.publishable_findings.filter((finding) =>
    !isPublishableSubjectFinding(finding, report.handle),
  );
  const investigativeLeads = [...(report.investigative_leads ?? []), ...quarantinedLegacyFindings]
    .filter((finding, index, all) => all.findIndex((candidate) =>
      candidate.finding_type === finding.finding_type
      && candidate.claim === finding.claim
      && candidate.source_url === finding.source_url,
    ) === index)
    .filter(actionableInvestigativeLead);
  const quarantinedRelatedHandles = new Set(quarantinedLegacyFindings
    .map((finding) => normalizedEntityHandle(findingTarget(finding)))
    .filter((target): target is string => Boolean(target && target !== normalizedEntityHandle(report.handle))));
  const visibleContradictions = f.contradictions.filter((contradiction) => {
    const text = `${contradiction.claim}\n${contradiction.conflict}`.toLowerCase();
    return ![...quarantinedRelatedHandles].some((target) => text.includes(`@${target}`));
  });
  const [watched, setWatched] = useState(() => isWatched(report.handle));
  // The compounding web: who else (from your past audits) this subject is tied to.
  const connections = subjectConnections(report.handle, getContributions());
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [archiveState, setArchiveState] = useState<"idle" | "archiving" | "error">("idle");
  // A collapsed list must not hide open questions from a printed or exported
  // copy of a favorable report.
  const [printExpanded, setPrintExpanded] = useState(false);
  useEffect(() => {
    const expand = () => setPrintExpanded(true);
    window.addEventListener("beforeprint", expand);
    return () => window.removeEventListener("beforeprint", expand);
  }, []);

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
  // Same mint as the Share button, but returning the URL for composition (the
  // TLDR copy) instead of writing it to the clipboard directly. Null on any
  // failure so callers can fall back to the app URL.
  const mintShareUrl = async (): Promise<string | null> => {
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
      const body = (await response.json().catch(() => ({}))) as { url?: unknown };
      if (!response.ok || typeof body.url !== "string") return null;
      return new URL(body.url, location.origin).toString();
    } catch {
      return null;
    }
  };
  const watch = () => {
    if (!canMutateWorkspace) return;
    const watchVerdict = presentation.displayVerdict === "UNVERIFIABLE"
      ? "UNVERIFIABLE_IDENTITY"
      : presentation.displayVerdict;
    setWatched(
      toggleWatch({
        id: report.handle, kind: "person", label: report.handle, addedAt: 0,
        snapshot: {
          verdict: watchVerdict,
          score: presentation.primaryScore ? report.governing_score : null,
          completenessState: presentationCompleteness,
        },
      }),
    );
  };

  const corroborationRows = [
    ...evidence.testimonials.map((t) => ({
      who: t.claimed_endorser_handle ?? t.claimed_endorser_name ?? "N/A",
      rel: t.claimed_relationship,
      follows: t.follows_subject,
      ack: t.public_acknowledgment,
      verdict: t.corroboration_verdict,
      note: t.notes,
    })),
  ];

  const advisedRows = evidence.advised;

  const decisionNarrativeTone = presentedVerdict === "PASS"
    ? "pass"
    : presentedVerdict === "CAUTION" || presentedVerdict === "INCOMPLETE" || presentedVerdict === "UNVERIFIABLE_IDENTITY"
      ? "caution"
      : presentedVerdict === "FAIL" || presentedVerdict === "AVOID"
        ? "avoid"
        : "signal";
  const unresolvedChecks = decisionCriticalChecks(diligenceChecks).filter((check) =>
    check.status === "unknown" || check.status === "unavailable" || check.status === "stale",
  );
  const investorOpenChecks = unresolvedChecks.filter((check) => {
    const diagnostic = [check.label, check.note, check.provider].filter(Boolean).join(" ").toLowerCase();
    const optionalSource = /\b(?:crunchbase|reddit|people data labs|pdl|grok|twitterapi(?:\.io)?|x provider)\b/.test(diagnostic);
    const availabilityOnly = /\b(?:collection|provider|api|failed|failure|partial|unavailable|rate limit)\b/.test(diagnostic);
    return !(optionalSource && availabilityOnly);
  });
  const providerGaps = (f.providerSnapshot?.runs ?? []).filter((run) =>
    run.state === "partial" || run.state === "failed" || run.state === "unavailable",
  );
  const axisHref = (axis: string): `#${string}` =>
    `#decision-basis-${axis.replace(/[^a-z0-9_-]/gi, "-")}`;

  const supportNarrative: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows
    .filter((axis) => Boolean(axis.rationale) && axis.support.length > 0)
    .sort((left, right) => (right.weight ? right.score / right.weight : 0) - (left.weight ? left.score / left.weight : 0))
    .slice(0, 5)
    .map((axis) => {
      const questionCount = Math.max(axis.gaps.length, axis.gapArtifacts.length);
      const strength = evidenceStrength({
        score: axis.score,
        weight: axis.weight,
        supportCount: axis.support.length,
        counterCount: axis.counter.length,
        questionCount,
      });
      const conciseRationale = axis.rationale.replace(/\s+/g, " ").trim();
      const firstSentence = conciseRationale.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? conciseRationale;
      const summary = firstSentence.length > 220
        ? `${firstSentence.slice(0, 217).trimEnd()}…`
        : firstSentence;
      return {
        id: `support-${axis.axis}`,
        title: diligenceAreaLabel(axis.axis),
        detail: summary,
        meta: `${strength.replace(" evidence", "")} · ${axis.support.length} src`,
        href: axisHref(axis.axis),
      };
    });

  // Real countervailing signals only: hard caps, coverage shortfalls,
  // contradictions, and mixed evidence. Collection gaps are NOT thesis risks;
  // they live once, in the verification list, and are summarized here through
  // a single aggregate row so a favorable report can never render an
  // all-clear while questions remain open.
  const confidenceLimitsBase: ReportCanvasNarrativeItem[] = [
    ...(report.cap_applied ? [{
      id: "hard-cap",
      title: `A hard cap governs the result: ${capLabel(report.cap_applied)}.`,
      detail: "A disqualifying finding overrides the weighted role total.",
      provenance: "Frozen scoring policy",
      href: "#role-breakdown" as `#${string}`,
    }] : []),
    // Coverage bookkeeping ("N of M checks recorded, treat as provisional")
    // deliberately does NOT render here: it lives in the verdict header chip
    // and the methodology rail. A verdict section leads with findings about
    // the subject, never with our own process status.
    ...visibleContradictions.slice(0, 2).map((contradiction, index) => ({
      id: `contradiction-${index}`,
      title: contradiction.claim,
      detail: contradiction.conflict,
      provenance: `${contradiction.severity} severity · ${contradiction.confidence} confidence`,
      href: "#contradictions" as `#${string}`,
    })),
    ...decisionBasisSummary.rows
      .filter((axis) => axis.counter.length > 0)
      .map((axis) => ({
        id: `counter-${axis.axis}`,
        title: `The evidence on ${diligenceAreaLabel(axis.axis).toLowerCase()} is mixed.`,
        detail: `${axis.counter.length} ${axis.counter.length === 1 ? "source disagrees" : "sources disagree"}.`,
        provenance: "Review competing sources",
        href: axisHref(axis.axis),
      })),
  ];
  const favorableVerdict = presentedVerdict === "PASS"
    || (presentedVerdict === "PROVISIONAL" && report.composite_verdict === "PASS");
  // Risk cards lead with a FINDING about the subject, never with our process
  // status: an assessed-null axis gets its deterministic conclusion, any other
  // weak axis gets the analyst's own first gap statement (already specific,
  // already dash-stripped server-side), and only then a thin-evidence fallback.
  // A solid or exceptional strength band is not a risk driver even when its
  // integer floor dips just under the 70 percent line.
  const bandTierFor = (axis: string): string | undefined => f.projectStrengthBands?.[axis]?.tier;
  const ASSESSED_NULL_RISK_TITLES: Record<string, string> = {
    P3_token_conduct: "No token could be tied to the project's official identity.",
    P4_backing_and_partners: "No outside backers or partners are verified.",
  };
  const sentence = (value: string): string => /[.!?]$/.test(value) ? value : `${value}.`;
  const lowAxisDrivers: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows
    .filter((axis) => axis.weight > 0 && axis.score / axis.weight < 0.7)
    .filter((axis) => !["solid", "exceptional"].includes(bandTierFor(axis.axis) ?? ""))
    .sort((left, right) => (left.weight ? left.score / left.weight : 1) - (right.weight ? right.score / right.weight : 1))
    .map((axis) => {
      const questions = Math.max(axis.gaps.length, axis.gapArtifacts.length);
      const firstGap = (axis.gaps[0] ?? "").trim();
      const title = bandTierFor(axis.axis) === "assessed_null"
        ? (ASSESSED_NULL_RISK_TITLES[axis.axis] ?? `${diligenceAreaLabel(axis.axis)} was assessed with no positive record.`)
        : firstGap && firstGap.length <= 140
          ? sentence(firstGap)
          : `Verified evidence on ${diligenceAreaLabel(axis.axis).toLowerCase()} is thin.`;
      return {
        id: `low-axis-${axis.axis}`,
        title,
        detail: axis.rationale,
        provenance: `Limited evidence${questionMeta(questions)}`,
        href: axisHref(axis.axis),
      };
    });

  const axisGapArtifactQuestions: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows.flatMap((axis) =>
    axis.gapArtifacts.map((artifact, index) => ({
      id: `verify-axis-artifact-${axis.axis}-${index}`,
      title: artifact.title,
      detail: artifact.excerpt || `Source coverage is incomplete for ${diligenceAreaLabel(axis.axis).toLowerCase()}.`,
      provenance: "Source unavailable",
      href: axisHref(axis.axis),
    })));
  const axisGapQuestions: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows.flatMap((axis) =>
    axis.gaps.map((gap, index) => ({
      id: `verify-axis-${axis.axis}-${index}`,
      title: gap,
      detail: "Worth confirming before you invest.",
      provenance: "Not yet confirmed",
      href: axisHref(axis.axis),
    })));
  const resolvedBasicFactPredicates = new Set([
    ...basicFacts
      .filter((fact) => fact.status === "verified" || fact.status === "corroborated" || fact.status === "not_applicable")
      .map((fact) => canonicalBasicFactPredicate(fact.predicate)),
    ...(f.basicFactQuestionLedger ?? [])
      .filter((entry) => supportsExplicitEmptyBasicFact(entry.predicate)
        && basicFactQuestionOutcome(entry) === "checked_empty")
      .map((entry) => canonicalBasicFactPredicate(entry.predicate)),
  ]);
  const conflictedBasicFactPredicates = new Set(basicFacts
    .filter((fact) => fact.status === "conflicted" || fact.status === "unresolved")
    .map((fact) => canonicalBasicFactPredicate(fact.predicate)));
  const buildBasicFactQuestion = (predicate: string, conflicted: boolean): ReportCanvasNarrativeItem => ({
    id: `verify-basic-${predicate}`,
    title: basicFactQuestionFor(predicate, basicFactsAudience),
    detail: conflicted
      ? "Sources disagree on the answer. Read both before relying on either."
      : "Not answered by any source we checked.",
    provenance: conflicted ? "Sources disagree" : "Decision fact still open",
    href: "#basic-facts" as `#${string}`,
  });
  const conflictedBasicFactQuestions: ReportCanvasNarrativeItem[] = fillDecisionFacts
    ? basicFactQuestionsFor(basicFactsAudience)
      .filter(([predicate]) => conflictedBasicFactPredicates.has(predicate))
      .map(([predicate]) => buildBasicFactQuestion(predicate, true))
    : [];
  const openBasicFactQuestions: ReportCanvasNarrativeItem[] = fillDecisionFacts
    ? basicFactQuestionsFor(basicFactsAudience)
      .filter(([predicate]) => !resolvedBasicFactPredicates.has(predicate) && !conflictedBasicFactPredicates.has(predicate))
      .map(([predicate]) => buildBasicFactQuestion(predicate, false))
    : [];
  const checkVerificationQuestions: ReportCanvasNarrativeItem[] = investorOpenChecks.map((check, index) => ({
    id: `verify-${check.checkId ?? index}`,
    title: check.label,
    detail: check.note,
    provenance: "Not fully checked",
    href: "#scan-methodology" as `#${string}`,
  }));
  // Ranked by decision impact: gating problems, then facts where sources
  // disagree, then unresolved decision checks, then unanswered facts, then
  // source gaps, then generic collection gaps. Dedupe keeps the first
  // occurrence, so assembly order IS the ranking.
  const allVerificationQuestions: ReportCanvasNarrativeItem[] = [
    ...(routingUnresolved ? [{
      id: "verify-subject-routing",
      title: "Resolve whether this account represents a project, organization, token, or person",
      detail: "No evidence-backed role selected a scoring methodology. Confirm the official site relationship, then run the matching project and on-chain investigation paths.",
      provenance: "Required before scoring",
      href: "#identity-evidence" as `#${string}`,
    }] : []),
    ...(scoringOutputIncomplete ? [{
      id: "verify-scoring-pass",
      title: `Complete the ${resolvedRoleLabel} scoring pass`,
      detail: `ARGUS identified this as a ${resolvedRoleLabel.toLowerCase()}, but the decision review did not finish. Rerun it without discarding the evidence already collected.`,
      provenance: "Decision review incomplete",
      href: "#decision-basis" as `#${string}`,
    }] : []),
    ...conflictedBasicFactQuestions,
    ...checkVerificationQuestions,
    ...openBasicFactQuestions,
    ...axisGapArtifactQuestions,
    ...axisGapQuestions,
  ].filter((item, index, items) => {
    const key = item.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return items.findIndex((candidate) =>
      candidate.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ") === key,
    ) === index;
  });
  const verificationNext = allVerificationQuestions.slice(0, 3);
  const remainingVerificationQuestions = allVerificationQuestions.slice(3);
  const decisionQuestionCount = allVerificationQuestions.length;

  // Real countervailing signals only. Open-question pressure renders as a
  // dedicated line attached to the section (never the lead item), so the
  // section leads with what was FOUND while a favorable report still can
  // never show an all-clear body without naming its open questions beside it.
  // Persona question this answers directly: "why this score and not higher,
  // and what exactly would raise it?" Deterministic from the stored axis
  // scores, so it renders on already-saved reports: each area's open points,
  // with the analyst's own most specific open item as the path to earning
  // them. Guidance framing by design; never a promise of points.
  const remainingPointsItems: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows
    .filter((axis) => axis.weight > 0 && axis.weight - axis.score > 0)
    .sort((left, right) => (right.weight - right.score) - (left.weight - left.score))
    .slice(0, 4)
    .map((axis) => {
      const open = axis.weight - axis.score;
      const tier = bandTierFor(axis.axis);
      const firstGap = (axis.gaps[0] ?? "").trim();
      return {
        id: `points-${axis.axis}`,
        title: `${diligenceAreaLabel(axis.axis)}: ${open} of ${axis.weight} points open`,
        detail: firstGap
          ? sentence(firstGap)
          : "The open questions for this area are listed in the verification plan.",
        provenance: tier
          ? `${tier.replace(/_/g, " ")} evidence tier · scored ${axis.score}/${axis.weight}`
          : `scored ${axis.score}/${axis.weight}`,
        href: axisHref(axis.axis),
      };
    });
  // One paste, whole verdict: composed for group chats and IC memos alike.
  // The link is appended at copy time (share link when mintable, app URL else).
  const tldrBase = [
    `ARGUS · ${f.display_name || f.handle} · ${presentedVerdict} ${report.governing_score ?? "N/A"}/100`,
    f.headline,
    remainingPointsItems[0] ? `Top open item: ${remainingPointsItems[0].title}.` : "",
  ].filter(Boolean).join("\n");
  const confidenceLimits: ReportCanvasNarrativeItem[] = confidenceLimitsBase.slice(0, 6);
  const adverseVerdictNarrative = [...confidenceLimits, ...lowAxisDrivers]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 6);
  const verdictNarrative = favorableVerdict ? supportNarrative : adverseVerdictNarrative;
  const countervailingNarrative = favorableVerdict ? confidenceLimits : supportNarrative;

  const unscoredIntelNarrative: ReportCanvasNarrativeItem[] = [
    ...(f.projectToken ? [{
      id: "intel-project-token",
      title: `$${f.projectToken.symbol} is the verified project token.`,
      detail: [
        f.projectToken.rank != null ? `CoinGecko rank #${f.projectToken.rank}` : null,
        f.projectToken.marketCapUsd != null ? `market cap ${usdCompact(f.projectToken.marketCapUsd)}` : null,
        f.projectToken.chain,
      ].filter(Boolean).join(" · "),
      provenance: `Canonical token · verified via ${f.projectToken.verification === "official_x" ? "official X" : "official domain"}`,
      href: "#project-token" as `#${string}`,
    }] : []),
    ...(f.sourceArtifacts ?? []).map((artifact, index) => ({
      id: `intel-artifact-${artifact.contentHash || index}`,
      title: artifact.title,
      detail: artifact.excerpt,
      provenance: `${artifact.provider} · ${artifact.match.replace(/_/g, " ")}`,
      href: "#evidence-ledger" as `#${string}`,
    })),
    ...publishableSubjectFindings.map((finding, index) => ({
      id: `intel-finding-${index}`,
      title: finding.claim,
      detail: `${finding.verification_status} finding with ${finding.independent_source_count} recorded source${finding.independent_source_count === 1 ? "" : "s"}.`,
      provenance: routingUnresolved
        ? "Verified finding · excluded from scoring until routing resolves"
        : "Verified finding · excluded because the scoring pass did not complete",
      href: "#publishable-findings" as `#${string}`,
    })),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title) === index).slice(0, 8);
  const visibleIntelligenceCount = (f.projectToken ? 1 : 0)
    + (f.sourceArtifacts?.length ?? 0)
    + publishableSubjectFindings.length
    + investigativeLeads.length;

  const artifactProviderCounts = [...(f.sourceArtifacts ?? []).reduce((counts, artifact) => {
    counts.set(artifact.provider, (counts.get(artifact.provider) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].sort((left, right) => right[1] - left[1]);
  const provenanceRail: ReportCanvasRailItem[] = artifactProviderCounts.slice(0, 5).map(([provider, count]) => ({
    id: `provider-${provider}`,
    label: sourceProviderLabel(provider),
    meta: `${count} saved source${count === 1 ? "" : "s"}`,
    href: "#frozen-source-ledger",
  }));
  const finalizedLabel = /^20\d{2}-\d{2}-\d{2}T/.test(report.finalized_at ?? "")
    ? frozenSourceDate(report.finalized_at)
    : null;
  const providerCapturedLabel = frozenSourceDate(f.providerSnapshot?.capturedAt);
  const freshnessRail: ReportCanvasRailItem[] = [
    ...(capturedLabel ? [{ id: "version-captured", label: `Report saved ${capturedLabel}`, meta: versionContext ? `version ${versionContext.version}` : undefined }] : []),
    ...(providerCapturedLabel ? [{ id: "provider-captured", label: `Evidence gathered ${providerCapturedLabel}`, meta: `${f.providerSnapshot?.runs.length ?? 0} data-source runs recorded` }] : []),
    ...(finalizedLabel ? [{ id: "report-finalized", label: `Scored ${finalizedLabel}`, meta: report.audit_id }] : []),
  ];
  const verifiedDecisionFactCount = basicFacts.filter((fact) =>
    fact.status === "verified" || fact.status === "corroborated",
  ).length;
  const citedDecisionSourceKeys = new Set([
    ...decisionBasisSummary.rows.flatMap((axis) => [...axis.support, ...axis.counter]
      .map((artifact) => artifact.artifactId)),
    ...basicFacts.flatMap((fact) => (fact.sources ?? [])
      .map((source) => source.url)
      .filter((url): url is string => Boolean(url))),
  ]);
  const conflictSignalCount = visibleContradictions.length
    + decisionBasisSummary.rows.filter((axis) => axis.counter.length > 0).length
    + basicFacts.filter((fact) => fact.status === "conflicted").length;
  const relationshipRecordCount = connections.length + webTeam.length + (evidence.associates?.length ?? 0);
  const argusEdgeMetrics = [
    { label: "Verified facts", value: verifiedDecisionFactCount, detail: "source-backed answers" },
    { label: "Decision sources", value: citedDecisionSourceKeys.size, detail: "bound to the verdict" },
    { label: "Conflicts captured", value: conflictSignalCount, detail: "stored in this snapshot" },
    { label: "Relationship records", value: relationshipRecordCount, detail: "people and graph links" },
    { label: "Open questions", value: decisionQuestionCount, detail: "worth verifying" },
  ] as const;

  // Hero proof chips: every chip is a projection of recorded check outcomes,
  // verified facts, or frozen snapshots, deep-linking to its evidence.
  // Adverse findings always outrank proof in the sort; a missing screen shows
  // as caution, never silence.
  const findCheck = (id: string) => diligenceChecks.find((check) => check.checkId === id);
  const heroLedgerEntry = (predicate: string) => (f.basicFactQuestionLedger ?? []).find((entry) =>
    canonicalBasicFactPredicate(entry.predicate) === predicate);
  const heroProofChips: HeroProofChip[] = [];
  {
    const ic = report.identity_confidence;
    heroProofChips.push(
      ic === "SuspectedImpersonation"
        ? { key: "identity", label: "Impersonation suspected", tone: "avoid", href: "#identity-evidence", title: "Identity screen flagged suspected impersonation. Review before anything else." }
        : ic === "Confirmed"
          ? { key: "identity", label: "Identity verified", tone: "pass", href: "#identity-evidence", title: findCheck("identity-resolution")?.note ?? "Official identity resolved and confirmed." }
          : ic === "Probable"
            ? { key: "identity", label: "Identity probable", tone: "caution", href: "#identity-evidence", title: "Identity resolution is probable, not confirmed." }
            : { key: "identity", label: "Identity unresolved", tone: "caution", href: "#identity-evidence", title: "No confirmed identity resolution is recorded." },
    );
  }
  if (!legacyCoverageNotCaptured) {
    const sanctionsCheck = findCheck("ofac-sanctions-name");
    const sanctionsNames = sanctionsCheck?.note?.match(/against ([\d,]+) OFAC SDN names/)?.[1];
    heroProofChips.push(
      sanctionsCheck?.status === "checked-empty"
        ? { key: "sanctions", label: "Sanctions clear", value: sanctionsNames ? `${sanctionsNames} names` : undefined, tone: "pass", href: "#identity-evidence", title: sanctionsCheck.note ?? "Exact-name sanctions screen completed with no match." }
        : sanctionsCheck?.status === "finding"
          ? { key: "sanctions", label: "Sanctions match", tone: "avoid", href: "#identity-evidence", title: sanctionsCheck.note ?? "An exact-name sanctions match requires identity review." }
          : sanctionsCheck?.status === "not-applicable"
            ? { key: "sanctions", label: "Sanctions n/a", tone: "neutral", href: "#identity-evidence", title: sanctionsCheck.note ?? "The sanctions screen needs a resolved real name." }
            : { key: "sanctions", label: "Sanctions not screened", tone: "caution", href: "#scan-methodology", title: sanctionsCheck?.note ?? "No sanctions-screen outcome is recorded in this snapshot." },
    );
  }
  {
    const auditFacts = basicFacts.filter((fact) =>
      canonicalBasicFactPredicate(fact.predicate) === "audit"
      && (fact.status === "verified" || fact.status === "corroborated"));
    const conflictedAudit = basicFacts.some((fact) =>
      canonicalBasicFactPredicate(fact.predicate) === "audit" && fact.status === "conflicted");
    const auditorConfirmed = auditFacts.filter((fact) =>
      (fact.sources ?? []).some((candidate) => candidate.sourceClass === "official_counterparty")).length;
    const auditQuestion = heroLedgerEntry("audit");
    if (conflictedAudit) {
      heroProofChips.push({ key: "audits", label: "Audit claim conflicted", tone: "avoid", href: "#basic-facts", title: "An audit claim is contradicted by a source. Read both before relying on either." });
    } else if (auditorConfirmed > 0) {
      heroProofChips.push({ key: "audits", label: "Audits confirmed", value: `x${auditorConfirmed}`, tone: "pass", href: "#basic-facts", title: `${auditorConfirmed} audit ${auditorConfirmed === 1 ? "claim" : "claims"} confirmed on the auditor's own site, not just the project's.` });
    } else if (auditFacts.length > 0) {
      heroProofChips.push({ key: "audits", label: "Audits cited", value: `x${auditFacts.length}`, tone: "neutral", href: "#basic-facts", title: "Audit claims verified on project materials; auditor-site confirmation not recorded." });
    } else if (auditQuestion && basicFactQuestionOutcome(auditQuestion) !== "checked_empty") {
      heroProofChips.push({ key: "audits", label: "Audits not verified", tone: "caution", href: "#verification-next", title: "Independent audits are not verified in this snapshot." });
    } else if (auditQuestion) {
      heroProofChips.push({ key: "audits", label: "No audits found", tone: "caution", href: "#basic-facts", title: "A completed search found no independent audit." });
    }
  }
  {
    const tokenQuestion = heroLedgerEntry("official_token");
    if (f.projectToken) {
      heroProofChips.push({ key: "token", label: "Token verified", value: `$${f.projectToken.symbol}`, tone: "pass", href: "#project-token", title: `Canonical token bound via ${f.projectToken.verification === "official_x" ? "the official X account" : "the official domain"}, never a name match.` });
    } else if (tokenQuestion && basicFactQuestionOutcome(tokenQuestion) === "checked_empty") {
      heroProofChips.push({ key: "token", label: "No official token", tone: "neutral", href: "#basic-facts", title: "A completed search found no verified official token." });
    } else if (tokenQuestion) {
      heroProofChips.push({ key: "token", label: "Token identity unresolved", tone: "caution", href: "#verification-next", title: "Official-token candidacy is not resolved. This is the core scam vector; verify before capital moves." });
    }
  }
  {
    // Scale reads pass tone only from sources a subject cannot self-publish;
    // an official-subject-only usage claim stays labeled as self-reported.
    const HARD_SCALE_CLASSES = new Set(["regulatory_or_onchain", "independent_press", "official_counterparty"]);
    const tractionFacts = basicFacts.filter((fact) =>
      canonicalBasicFactPredicate(fact.predicate) === "traction"
      && (fact.status === "verified" || fact.status === "corroborated"));
    const tvlFact = tractionFacts.find((fact) => /total value locked|TVL/i.test(String(fact.value ?? "")));
    const scaleFact = tvlFact ?? tractionFacts[0];
    if (scaleFact) {
      const hardScale = (scaleFact.sources ?? []).some((candidate) => HARD_SCALE_CLASSES.has(candidate.sourceClass ?? ""));
      const raw = String(scaleFact.value ?? "");
      const tvlMatch = raw.match(/\$\s?([\d.,]+)\s*(billion|bn|b|million|mn|m)\b/i);
      const compact = tvlMatch && tvlFact === scaleFact
        ? `$${tvlMatch[1].replace(/,/g, "")}${/^b/i.test(tvlMatch[2]) ? "B" : "M"} TVL`
        : undefined;
      heroProofChips.push(hardScale
        ? { key: "scale", label: compact ? "Verified" : "Usage verified", value: compact, tone: "pass", href: "#basic-facts", title: raw.slice(0, 160) }
        : { key: "scale", label: "Self-reported usage", value: compact, tone: "neutral", href: "#basic-facts", title: `${raw.slice(0, 140)} (source: the project's own materials)` });
    }
  }
  {
    const foundedFact = basicFacts.find((fact) =>
      canonicalBasicFactPredicate(fact.predicate) === "founded"
      && (fact.status === "verified" || fact.status === "corroborated"));
    const foundedYear = foundedFact ? String(foundedFact.value ?? "").match(/(?:19|20)\d{2}/)?.[0] : undefined;
    if (foundedYear) {
      heroProofChips.push({ key: "age", label: "since", value: foundedYear, tone: "neutral", href: "#basic-facts", title: `Founded ${foundedYear}, verified against fetched sources.` });
    }
  }
  if (!legacyCoverageNotCaptured) {
    heroProofChips.push(
      readiness.status === "ready"
        ? { key: "coverage", label: "Checks", value: `${readiness.successful}/${readiness.applicable}`, tone: "pass", href: "#scan-methodology", title: `${readiness.coveragePercent}% of applicable decision-critical checks have recorded outcomes.` }
        : { key: "coverage", label: `Coverage ${readiness.coveragePercent}%`, value: `${readiness.successful}/${readiness.applicable}`, tone: "caution", href: "#scan-methodology", title: readinessGuidance },
    );
  }
  // Findings lead, then what we FOUND. Absence-class caution chips stay
  // visible but trail the proof: a report never leads with what it did not
  // find, while an actual adverse finding still outranks everything.
  const PROOF_TONE_RANK: Record<HeroProofTone, number> = { avoid: 0, pass: 1, neutral: 2, caution: 3 };
  heroProofChips.sort((a, b) => PROOF_TONE_RANK[a.tone] - PROOF_TONE_RANK[b.tone]);

  // Fundamentals we verified, as headline numbers. Every tile derives from a
  // frozen snapshot and is omitted when absent; nothing renders a dash.
  const fundamentalTiles: Array<{ key: string; label: string; value: string; sub: string }> = [
    ...(f.protocolTvl && f.protocolTvl.tvlUsd > 0 ? [{
      key: "tvl",
      label: "Value locked",
      value: usdCompact(f.protocolTvl.tvlUsd),
      sub: `DeFiLlama · ${f.protocolTvl.capturedAt.slice(0, 10)}`,
    }] : []),
    ...(f.projectToken?.rank != null ? [{
      key: "rank",
      label: "Market rank",
      value: `#${f.projectToken.rank}`,
      sub: "CoinGecko, all crypto assets",
    }] : []),
    ...(f.protocolTvl?.firstRecordedAt ? [{
      key: "history",
      label: "TVL history",
      value: `since ${f.protocolTvl.firstRecordedAt.slice(0, 4)}`,
      sub: "series start, bounds age",
    }] : []),
    ...(f.protocolFunding && f.protocolFunding.totalRaisedUsd > 0 ? [{
      key: "raised",
      label: "Raised",
      value: usdCompact(f.protocolFunding.totalRaisedUsd),
      sub: `${f.protocolFunding.rounds.length} public round${f.protocolFunding.rounds.length === 1 ? "" : "s"}`,
    }] : []),
    ...(f.projectToken?.deployedChains?.length ? [{
      key: "chains",
      label: "Chains",
      value: String(f.projectToken.deployedChains.length),
      sub: "CoinGecko-id joined",
    }] : []),
  ];

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-72" />

      {/* top bar */}
      <header className="relative z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-3">
          <button type="button" onClick={onReset} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
            <ArrowLeft aria-hidden="true" size={15} weight="bold" />
            New investigation
          </button>
          <span className="mono hidden text-[11px] text-ink-faint md:inline">/ {report.audit_id}</span>
          {immutableReviewHref ? (
            <a
              className="chip tint-signal"
              href={immutableReviewHref}
              target="_blank"
              rel="noreferrer"
              title="The core report is saved. Open the exact immutable snapshot; live supplemental panels remain outside its verdict."
            >
              SAVED REPORT
            </a>
          ) : (
            <span
              className={`chip ${!versionContext && f.live ? "tint-signal" : ""}`}
              title={versionContext ? `Frozen immutable report version ${versionContext.version}` : f.live ? "Collected live from data providers" : "Curated dossier (no provider keys configured)"}
            >
              {versionContext ? `VERSION ${versionContext.version}` : f.live ? "● LIVE SCAN" : "CURATED"}
            </span>
          )}
          <div className="scrollbar-none order-3 flex w-full items-center gap-2 overflow-x-auto pb-1 sm:order-none sm:ml-auto sm:w-auto sm:justify-end sm:overflow-visible sm:pb-0">
            {onRescan && (
              <button type="button" onClick={onRescan} title="Run this audit again, fresh" className="btn-chip tint-signal min-h-11 gap-1.5 px-3">
                <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                Rescan
              </button>
            )}
            {onOpenBrief && (
              <button
                type="button"
                onClick={onOpenBrief}
                title="Open the analyst decision brief anchored to this exact person case"
                className="btn-primary min-h-11 gap-1.5 px-3 text-[12.5px] font-medium"
              >
                <Briefcase aria-hidden="true" size={14} weight="bold" />
                Case brief
              </button>
            )}
            {canShare && (
              <button
                type="button"
                onClick={() => void share()}
                disabled={shareState === "creating"}
                aria-live="polite"
                title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable report link"}
                className="btn-secondary min-h-11 gap-1.5 px-3 text-[12.5px] disabled:cursor-wait disabled:opacity-60"
              >
                <ShareNetwork aria-hidden="true" size={14} weight="bold" />
                {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied ✓" : shareState === "error" ? "Share failed · retry" : "Share"}
              </button>
            )}
            {canMutateWorkspace && (
              <button type="button" onClick={watch} aria-pressed={watched} className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-[12.5px] transition ${watched ? "tint-signal" : "btn-secondary"}`}>
                <Star aria-hidden="true" size={14} weight={watched ? "fill" : "regular"} />
                {watched ? "Watching" : "Watch"}
              </button>
            )}
            <button
              type="button"
              onClick={onReset}
              className="btn-secondary min-h-11 gap-1.5 px-3 text-[12.5px]"
            >
              <MagnifyingGlassPlus aria-hidden="true" size={14} weight="bold" />
              New audit
            </button>
            {canArchive && (
              <details className="relative">
                <summary aria-label="More report actions" className="btn-secondary min-h-11 list-none cursor-pointer gap-1.5 px-3 text-[12.5px] [&::-webkit-details-marker]:hidden">
                  <DotsThree aria-hidden="true" size={17} weight="bold" />
                  More
                </summary>
                <div className="panel absolute right-0 top-full z-30 mt-1.5 w-56 p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => void archive()}
                    disabled={archiveState === "archiving"}
                    title="Remove this case from active work while preserving its immutable evidence and history"
                    className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] text-ink-dim transition hover:bg-signal/10 hover:text-signal-lift disabled:cursor-wait disabled:opacity-60"
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
          <div className="panel mt-4 px-4 py-3 text-[12.5px] text-ink-dim" role="status">
            Saving the immutable audit before post-scan intelligence runs…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="finding tint-caution mt-4 px-4 py-3 text-[12.5px]" role="alert">
            Post-scan intelligence is paused because this audit is not safely bound to an immutable version. Rescan before spending on supplemental providers.
            {f.persistence?.state === "failed" && f.persistence.reason && (
              <span className="mono mt-1 block text-[11px] text-ink-faint">save error: {f.persistence.reason}</span>
            )}
          </div>
        )}
        {showTrustGraphSupplemental && <RingAlert handle={report.handle} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* Subject identity and decision state are intentionally one hierarchy:
            who is being assessed, what ARGUS concluded, and whether the frozen
            evidence is complete enough to act on. */}
        <section id="report-overview" className="panel mt-6 flex scroll-mt-28 flex-col overflow-hidden" aria-labelledby="report-subject-title">
          <div className="contents lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-5 lg:p-5">
            <div className="order-1 flex min-w-0 items-start gap-4 p-5 lg:order-none lg:p-0">
              <Avatar src={f.avatar_url || xAvatar(f.handle)} letter={f.avatar} size={56} rounded="rounded-2xl" letterClass="text-2xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h1 id="report-subject-title" className="display text-[32px] leading-none text-ink max-sm:text-[24px]">{f.display_name}</h1>
                  <span className="mono text-[13.5px] text-ink-faint">{f.handle}</span>
                </div>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">{f.bio}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {roles.map((r) => (
                    <span key={r} className="chip">
                      <RoleIcon role={r} size={13} /> {ROLE_META[r].label}
                    </span>
                  ))}
                  <span className="text-[12.5px] text-ink-faint"><span className="text-ink-dim">{f.followers}</span> followers</span>
                  <span className="text-[12.5px] text-ink-faint">joined {f.joined}</span>
                  {typeof f.days_since_post === "number" && (
                    <span className={`text-[12.5px] ${f.days_since_post >= 21 ? "font-medium text-avoid" : "text-ink-faint"}`}>
                      {f.days_since_post === 0 ? "posted today" : f.days_since_post === 1 ? "posted yesterday" : `last posted ${f.days_since_post}d ago`}
                    </span>
                  )}
                </div>
                {f.notableFollowers.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-ink-faint">Notable followers</span>
                    {f.notableFollowers.slice(0, 6).map((n) => {
                      const big = (n.count ?? 0) >= 1e6;
                      return (
                        <a
                          key={n.handle}
                          href={`https://x.com/${n.handle}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`chip normal-case tracking-normal transition hover:text-ink ${big ? "tint-pass" : ""}`}
                          title={`${n.label} · ${n.size} followers`}
                        >
                          @{n.handle} <span className="opacity-70">{n.size}</span>
                        </a>
                      );
                    })}
                    {f.notableFollowers.length > 6 && <span className="mono text-[11px] text-ink-faint">+{f.notableFollowers.length - 6}</span>}
                  </div>
                )}
              </div>
            </div>

            <dl className="order-4 mx-5 mb-5 grid content-start gap-3 border-t border-line/60 pt-4 text-[11px] lg:order-none lg:m-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0" aria-label="Immutable report identity">
              <div>
                <dt className="stat-label">Report ID</dt>
                <dd className="mono mt-1 break-all text-ink-dim">{report.audit_id}</dd>
              </div>
              <div>
                <dt className="stat-label">Report state</dt>
                <dd className="mono mt-1 text-signal-lift">
                  {versionContext
                    ? `v${versionContext.version} · frozen`
                    : liveCoreSnapshotSaved
                      ? "core snapshot saved"
                      : f.live
                        ? "live collection"
                        : "curated dossier"}
                </dd>
              </div>
              {(capturedLabel || finalizedLabel) && (
                <div>
                  <dt className="stat-label">Captured</dt>
                  <dd className="mt-1 text-ink-dim">{capturedLabel ?? finalizedLabel}</dd>
                </div>
              )}
            </dl>
          </div>

          <div
            className="order-2 flex flex-wrap items-center gap-5 border-t border-line/60 px-5 py-5 max-sm:grid max-sm:items-start max-sm:gap-4"
            aria-label="Decision readiness result"
          >
            <div className="shrink-0 text-center max-sm:flex max-sm:items-center max-sm:gap-3 max-sm:text-left">
              <ScoreRing
                score={presentation.primaryScore ? report.governing_score : null}
                verdict={presentedVerdict}
                size={92}
                bands={Boolean(presentation.primaryScore)}
              />
              <div className="mono mt-1 max-w-[9.5rem] text-[11px] uppercase tracking-wider text-ink-faint">
                {presentation.scoreLabel?.toLowerCase() ?? "score withheld"}
                {presentation.primaryScore && report.governing_score != null && (
                  <span className="block normal-case tracking-normal text-ink-dim">
                    {scoreBandPosition(report.governing_score, report.cap_applied)}
                  </span>
                )}
              </div>
              <ScoreContextStrip
                subjectRef={f.handle || f.display_name}
                score={presentation.primaryScore ? report.governing_score : null}
              />
              <CopyTldrButton base={tldrBase} mint={mintShareUrl} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="eyebrow mb-1.5">{presentation.resultLabel}</div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className={`display text-[44px] uppercase leading-none max-sm:text-[32px] ${verdictTextClass}`}>
                  {m.label}
                </span>
                {presentation.secondarySignal && <span className="chip chip-wrap text-ink-faint">{presentation.secondarySignal}</span>}
                {presentation.displayVerdict !== "PROVISIONAL"
                  // Suppress the readiness chip when it merely repeats the verdict
                  // word (e.g. an INCOMPLETE verdict already reads "INCOMPLETE").
                  // "decision-ready" always adds information next to PASS/CAUTION/etc.
                  && !(readiness.status !== "ready" && m.label.toUpperCase() === readiness.status.toUpperCase()) && (
                  <span
                    className={`chip ${readiness.status === "ready" ? "tint-pass" : "tint-caution"}`}
                    title={readiness.status === "ready"
                      ? "Decision-ready: every safety screen recorded its outcome and evidence coverage cleared the bar, so this verdict is complete enough to act on."
                      : "This verdict is published with known gaps; the coverage panel lists exactly what is still open."}
                  >
                    {readiness.status === "ready" ? "decision-ready" : readiness.status}
                  </span>
                )}
                {report.governing_role && (
                  <span
                    className="mono text-[11px] text-ink-dim"
                    title="Subjects can hold several roles (project, founder, investor). Each role is scored separately and the LOWER-scoring role sets the final number, so a strong role can never mask a weak one."
                  >
                    governed by {ROLE_META[report.governing_role as SubjectClass].label.toLowerCase()}
                  </span>
                )}
              </div>
              <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
                {presentation.final ? f.headline : legacyCoverageNotCaptured ? readinessGuidance : presentation.note}
              </p>
              {presentation.final && !legacyCoverageNotCaptured && (
                <p className="mono mt-2 text-[11px] text-ink-faint" aria-label="Verdict support summary">
                  <span className="tabular">{verifiedDecisionFactCount}</span> facts verified
                  <span aria-hidden="true"> · </span>
                  <span className="tabular">{cleanScreens.length}</span> screens clean
                  <span aria-hidden="true"> · </span>
                  {(() => {
                    // A neutral assessment null (e.g. "no repeat backing on record")
                    // is recorded as a substantive "finding" so it can cover + score
                    // its axis, but an absent positive signal is never counter-evidence.
                    // isAdverseFinding excludes those neutral nulls from the tally.
                    const adverseSignals = diligenceChecks.filter(isAdverseFinding).length
                      + visibleContradictions.length;
                    if (adverseSignals > 0) {
                      return <span className="text-avoid">{adverseSignals} adverse {adverseSignals === 1 ? "signal" : "signals"}</span>;
                    }
                    // Never assert a zero under an adverse verdict; route to the basis instead.
                    return favorableVerdict
                      ? <span>0 adverse findings</span>
                      : <a href="#decision-basis" className="text-avoid underline-offset-2 hover:underline">see decision basis</a>;
                  })()}
                </p>
              )}
              {!presentation.final && f.headline && (
                <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
                  <span className="text-ink-dim">Stored scored-evidence summary, not clearance:</span> {f.headline}
                </p>
              )}
              {report.cap_applied && (
                <div className="chip tint-avoid mt-3 font-medium">
                  Hard cap · {capLabel(report.cap_applied)}
                </div>
              )}
            </div>
          </div>

          {/* A lone tile reads as a broken empty band; two or more justify the
              strip, and the column count tracks the tile count so no cell is
              ever an empty grey box. */}
          {fundamentalTiles.length >= 2 && (
            <dl
              className="order-3 grid grid-cols-2 gap-px border-t border-line/60 bg-line max-sm:[&>div:last-child:nth-child(odd)]:col-span-2 sm:[grid-template-columns:repeat(var(--tile-count),minmax(0,1fr))]"
              style={{ "--tile-count": Math.min(fundamentalTiles.length, 5) } as React.CSSProperties}
              aria-label="Verified fundamentals"
            >
              {fundamentalTiles.map((tile) => (
                <div key={tile.key} className="bg-panel px-5 py-3.5">
                  <dt className="stat-label">{tile.label}</dt>
                  <dd className="stat-value mt-1 text-[19px] font-semibold tabular-nums">{tile.value}</dd>
                  <dd className="mono mt-0.5 text-[10px] leading-snug text-ink-faint">{tile.sub}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className={`finding relative order-4 px-5 py-4 ${readiness.status === "ready" ? "tint-pass" : "tint-caution"}`} aria-label="Due-diligence readiness">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-[12.5px] font-semibold uppercase tracking-[0.14em]">{readinessTitle}</span>
              <span className="text-[11px] text-ink-faint">
                {legacyCoverageNotCaptured ? "this snapshot contains no frozen check-level outcomes" : "observable outcomes stored in this report"}
              </span>
              {!legacyCoverageNotCaptured && diligenceChecks.length > 0 && (
                <a
                  href={decisionQuestionCount > 0 ? "#verification-next" : "#scan-methodology"}
                  className="ml-auto inline-flex min-h-8 items-center text-[11px] text-signal-lift underline-offset-2 hover:underline"
                >
                  {decisionQuestionCount > 0
                    ? `${decisionQuestionCount} open ${decisionQuestionCount === 1 ? "question" : "questions"}`
                    : "Review methodology"}
                </a>
              )}
            </div>
            {versionContext && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint" aria-label="Immutable report version metadata">
                <span className="mono uppercase tracking-wide">{versionContext.completenessState} version</span>
                {attestationLabel && <span>{attestationLabel}</span>}
                {capturedLabel && <span>captured {capturedLabel}</span>}
                {versionContext.methodologyVersion && <span className="mono">methodology {versionContext.methodologyVersion}</span>}
              </div>
            )}
            {legacyCoverageNotCaptured ? (
              <div className="panel-inset mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-ink">Frozen coverage unavailable</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{readinessGuidance}</p>
                </div>
                {onRescan && (
                  <button type="button" onClick={onRescan} className="btn-chip tint-signal min-h-11 shrink-0 gap-1.5 font-medium">
                    <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                    Rescan to capture coverage
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{readinessGuidance}</p>
            )}
            <ProofChipStrip chips={heroProofChips} />
            <ProviderFailureNotice failures={f.providerFailures} />
            {f.priorOutcome && (
              <OutcomeDeltaStrip
                prior={f.priorOutcome}
                score={typeof report.governing_score === "number" ? report.governing_score : null}
                verdict={report.composite_verdict ?? null}
                coverage={f.completeness_state}
              />
            )}
          </div>
        </section>

        <div className="sticky top-0 z-10 mt-5">
          <ReportCanvasSectionNav
            sticky={false}
            items={[
              { href: "#decision-summary", label: "Summary", icon: <FileText aria-hidden="true" size={15} weight="bold" /> },
              ...(showBasicFacts ? [{
                href: "#basic-facts" as const,
                label: "Key facts",
                icon: <CheckCircle aria-hidden="true" size={15} weight="bold" />,
                count: new Set(basicFacts
                  .filter((fact) => fact.status === "verified" || fact.status === "corroborated")
                  .map((fact) => fact.predicate)).size,
              }] : []),
              ...(f.projectToken ? [{ href: "#project-token" as const, label: "Token", icon: <Cube aria-hidden="true" size={15} weight="bold" /> }] : []),
              { href: "#decision-basis", label: "Diligence", icon: <ListChecks aria-hidden="true" size={15} weight="bold" />, count: governingAxes.length },
              { href: "#identity-evidence", label: "Identity", icon: <Fingerprint aria-hidden="true" size={15} weight="bold" /> },
              ...(visibleIntelligenceCount > 0 ? [{ href: "#evidence-ledger" as const, label: "Evidence", icon: <Database aria-hidden="true" size={15} weight="bold" />, count: visibleIntelligenceCount }] : []),
              { href: "#relationships", label: "Relationships", icon: <GraphIcon aria-hidden="true" size={15} weight="bold" />, count: connections.length },
              ...(diligenceChecks.length > 0 ? [{ href: "#scan-methodology" as const, label: "Methodology", icon: <UserFocus aria-hidden="true" size={15} weight="bold" />, count: diligenceChecks.length }] : []),
            ]}
          />
        </div>

        {showBasicFacts && (
          <div className="mt-5">
            <BasicFactsPanel
              facts={basicFacts}
              leads={basicFactLeads}
              fillRequired={fillDecisionFacts}
              audience={basicFactsAudience}
              questionLedger={f.basicFactQuestionLedger}
              fundingRounds={f.protocolFunding?.rounds}
            />
          </div>
        )}

        {(f.protocolTvl || f.protocolFees || f.holderProfile) && (
          <div className="mt-3">
            <UsageVisuals tvl={f.protocolTvl} fees={f.protocolFees} holders={f.holderProfile} />
          </div>
        )}

        {f.projectToken && (
          <div className="py-5">
            <ProjectTokenCard
              token={f.projectToken}
              chains={f.projectToken.deployedChains}
              showCurrentIntelligence={showCurrentIntelligence}
              refreshCurrentMarket={currentIntelligenceEnabled}
              onAudit={onAudit}
              onLoadCurrentIntelligence={versionContext
                ? () => setCurrentIntelligenceVersionId(versionContext.reportVersionId)
                : undefined}
            />
          </div>
        )}

        <div id="decision-summary" className="grid scroll-mt-28 gap-4 py-5">
          {decisionFrameworkUnavailable && (
            <section
              className="finding tint-caution px-5 py-4"
              aria-label={routingUnresolved ? "Project routing unresolved" : "Scoring output incomplete"}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="eyebrow text-caution">
                    {routingUnresolved ? "Project routing unresolved" : "Scoring output incomplete"}
                  </div>
                  <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
                    {routingUnresolved
                      ? "ARGUS collected intelligence, but did not select a scoring methodology"
                      : `ARGUS resolved this subject to ${resolvedRoleLabel}, but the scoring pass did not complete`}
                  </h2>
                  <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">
                    {routingUnresolved
                      ? "ARGUS could not confirm whether this is a project, organization, token, or person. The evidence below is still useful, but this snapshot is not ready for an investment decision."
                      : `ARGUS identified this as a ${resolvedRoleLabel.toLowerCase()}, but the decision review did not finish. The evidence below is still useful, but this snapshot is not ready for an investment decision.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="chip tint-caution">No decision areas scored</span>
                    <span className="chip">{readiness.successful} checks completed</span>
                    <span className="chip">{visibleIntelligenceCount} evidence items and leads</span>
                    {providerGaps.length > 0 && <span className="chip tint-caution">{providerGaps.length} source gaps</span>}
                  </div>
                </div>
                {onRescan && (
                  <button type="button" onClick={onRescan} className="btn-chip tint-signal min-h-11 shrink-0 gap-1.5 font-medium">
                    <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                    {routingUnresolved ? "Run corrected investigation" : "Retry scoring investigation"}
                  </button>
                )}
              </div>
            </section>
          )}
          <div className="panel px-5">
            <ReportCanvasNarrativeSection
              id="verdict-rationale"
              title={decisionFrameworkUnavailable ? "What ARGUS found before the decision failed" : favorableVerdict ? "The investment case" : "Why this is risky"}
              description={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "Verified artifacts and investigative leads stay visible while subject routing is unresolved. Leads remain explicitly unscored."
                  : "Verified artifacts and investigative leads stay visible even though the scoring pass was incomplete. Leads remain explicitly unscored."
                : favorableVerdict
                  ? "The strongest source-backed reasons this result holds up."
                  : "The findings, conflicts, and weak areas driving the result."}
              tone={decisionNarrativeTone}
              items={decisionFrameworkUnavailable ? unscoredIntelNarrative : verdictNarrative}
              emptyCopy={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "No usable evidence was saved. Confirm what this subject is, review source coverage, and rerun the investigation."
                  : "No usable evidence was saved. Review source coverage and retry the investigation."
                : favorableVerdict
                  ? "No cited rationale is available in this snapshot. Review the underlying evidence before relying on the score."
                  : "No adverse evidence driver is recorded for this result. Inspect the decision basis before relying on the stored verdict."}
            />
            <ReportCanvasNarrativeSection
              id="confidence-limits"
              title={decisionFrameworkUnavailable ? "Why ARGUS withheld a verdict" : favorableVerdict ? "What could break the thesis" : "What argues against the risk case"}
              description={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "ARGUS needs to confirm what this subject is before it can apply the right review standard."
                  : "ARGUS identified the subject, but the decision review did not finish."
                : favorableVerdict
                  ? "Verified risks, conflicts, and adverse findings. Things we have not checked yet are listed separately under open questions."
                  : "Verified positive findings stay visible so an adverse verdict is shown in context."}
              tone={decisionFrameworkUnavailable ? "caution" : favorableVerdict ? (report.cap_applied ? "avoid" : "caution") : "pass"}
              items={decisionFrameworkUnavailable ? confidenceLimits : countervailingNarrative}
              emptyCopy={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "ARGUS could not confirm what this subject is, so it withheld the score."
                  : "The subject was identified, but the review did not finish, so ARGUS withheld the score."
                : favorableVerdict
                  ? cleanScreens.length
                    ? `No adverse findings in the collected evidence. ${cleanScreens.length} ${cleanScreens.length === 1 ? "screen" : "screens"} ran clean, including ${cleanScreens.slice(0, 3).map((check) => check.label.toLowerCase()).join(", ")}.`
                    : "No adverse findings in the collected evidence."
                  : "No evidence-backed positive counterweight is recorded in this report."}
            />
            {!decisionFrameworkUnavailable && decisionQuestionCount > 0 && (
              <p className="border-t border-line/60 py-3 text-[11.5px] text-ink-faint">
                Also open: <a href="#verification-next" className="text-caution underline-offset-2 hover:underline">{decisionQuestionCount} decision {decisionQuestionCount === 1 ? "question" : "questions"}</a>. The score reflects the evidence collected; read them before relying on it.
              </p>
            )}
          </div>
        </div>

        <div id="decision-basis" className="scroll-mt-28">
          <DecisionBasis
            roleReport={governingRoleReport}
            catalog={f.axisEvidenceCatalog}
            lineageVersion={f.axisCitationVersion}
            unavailableReason={routingUnresolved ? "routing" : scoringOutputIncomplete ? "scoring" : undefined}
            onRescan={onRescan}
          />
        </div>

        <div className="panel mt-5 px-5">
          <ReportCanvasNarrativeSection
            id="verification-next"
            title="What the investor should verify next"
            description="The three unanswered questions with the most decision impact. Everything else we have not checked yet is in the list below."
            tone="signal"
            items={verificationNext}
            emptyCopy={legacyCoverageNotCaptured
              ? "This report predates per-check outcome records. Rescan to establish a current verification plan."
              : "No unresolved decision question was recorded. Review the cited evidence and any findings before making an investment decision."}
          />
          {remainingVerificationQuestions.length > 0 && (
            <details className="border-t border-line/60 py-4" open={printExpanded || undefined}>
              <summary className="cursor-pointer text-[13px] font-medium text-ink-dim hover:text-ink">
                Not yet checked · {remainingVerificationQuestions.length} more {remainingVerificationQuestions.length === 1 ? "item" : "items"}
              </summary>
              <ul className="mt-3 space-y-2">
                {remainingVerificationQuestions.map((item) => (
                  <li key={item.id} className="text-[12.5px] leading-relaxed text-ink-dim">
                    {item.href ? <a href={item.href} className="hover:text-ink hover:underline">{item.title}</a> : item.title}
                    <span className="ml-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">{item.provenance}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {favorableVerdict && remainingPointsItems.length > 0 && (
          <div className="panel mt-5 px-5">
            <ReportCanvasNarrativeSection
              id="remaining-points"
              title="Where the remaining points are"
              description={`This score is ${report.governing_score} of 100. The open points sit in the areas below; each one links to the evidence and the exact questions that would earn them.`}
              tone="signal"
              items={remainingPointsItems}
              emptyCopy=""
            />
          </div>
        )}

        <div id="identity-evidence" className="scroll-mt-28">
        {/* Supplemental live checks are deliberately separated from the frozen
            score. They self-gate on a resolved real name and never imply broad
            legal or sanctions clearance. */}
        {showOffchainSupplemental && (
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
              <span className="chip normal-case">{report.identity_confidence}</span>
              <span className="text-[11px] text-ink-faint">identity resolved through the named team · click a handle to audit them</span>
            </div>
            <Card className="divide-y divide-line/60">
              {webTeam.map((p, i) => (
                <div key={i} className="px-4 py-2.5 text-[12.5px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Avatar src={personAvatar(p.handle, p.linkedin)} letter={(p.name.replace(/^@/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[10px]" />
                      <span className="text-ink">{p.name}</span>
                      {p.handle && <span className="mono text-[11px] text-ink-faint">{p.handle}</span>}
                      <span className="chip shrink-0">{p.role}</span>
                      {p.linkedin && (
                        <a href={`https://${p.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>
                      )}
                      {p.evidence && <span className="text-[11px] text-ink-faint">· {p.evidence}</span>}
                      <span className="text-[11px] text-ink-faint">({p.source})</span>
                    </span>
                    {p.handle && onAudit ? (
                      <button onClick={() => onAudit(p.handle!)} className="btn-chip tint-signal shrink-0">audit →</button>
                    ) : (
                      <span className="mono shrink-0 text-[11px] text-ink-faint">named only</span>
                    )}
                  </div>
                  {p.projects && p.projects.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[26px] text-[11px] text-ink-faint">
                      <span>also:</span>
                      {p.projects.map((pr, j) => (
                        onOpenProject ? (
                          <button key={j} onClick={() => onOpenProject(pr.name, undefined, panelCostToken)} title="Dig everyone on this project" className="btn-chip tint-signal normal-case">
                            {pr.name}{pr.role ? <span className="text-ink-faint"> · {pr.role}</span> : null}
                          </button>
                        ) : (
                          <span key={j} className="chip normal-case">{pr.name}{pr.role ? ` · ${pr.role}` : ""}</span>
                        )
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Card>
            {f.prior_handles && f.prior_handles.length > 0 && (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-caution">
                ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
              </p>
            )}
          </div>
        ) : (
          <div className="panel mt-3 flex items-start gap-3 px-4 py-3">
            <span className={`chip normal-case mt-0.5 ${report.identity_confidence === "SuspectedImpersonation" ? "tint-unverifiable" : ""}`}>
              {report.identity_confidence}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] leading-relaxed text-ink-dim">{f.identity_note}</p>
              {f.prior_handles && f.prior_handles.length > 0 && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-caution">
                  ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
                </p>
              )}
            </div>
          </div>
        )}

        {webTeamLeads.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="chip tint-caution">Investigative team candidates</span>
              <span className="text-[11px] text-ink-faint">unverified leads · not identity proof · not scored or sent to report chat</span>
            </div>
            <Card className="divide-y divide-line/60 border-caution/25">
              {webTeamLeads.map((member, index) => (
                <div key={`${member.name}:${member.role}:${member.source}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-[12.5px]">
                  <span className="font-medium text-ink-dim">{member.name}</span>
                  <span className="chip">{member.role}</span>
                  {member.handle && <span className="mono text-[11px] text-caution">candidate {member.handle}</span>}
                  {member.linkedin && <span className="text-[11px] text-ink-faint">LinkedIn candidate recorded</span>}
                  <span className="text-[11px] text-ink-faint">{sourceProviderLabel(member.provider ?? member.source)}</span>
                  {member.evidence && <span className="min-w-full text-[11px] leading-relaxed text-ink-faint">{member.evidence}</span>}
                  {member.handle && onAudit && (
                    <button
                      type="button"
                      onClick={() => onAudit(member.handle!)}
                      className="btn-chip tint-caution ml-auto min-h-11"
                    >
                      verify →
                    </button>
                  )}
                </div>
              ))}
            </Card>
          </div>
        )}
        </div>

        {/* contradictions — claims that do not match the evidence */}
        {visibleContradictions.length > 0 && (
          <div id="contradictions" className="scroll-mt-28">
            <Section title="Contradictions" kicker="claims that do not match the collected evidence">
              <Card className="divide-y divide-line/60">
                {visibleContradictions.map((c, i) => {
                  const sc = c.severity === "high" ? "var(--color-avoid)" : c.severity === "medium" ? "var(--color-caution)" : "var(--color-ink-faint)";
                  return (
                    <div key={i} className="flex items-start gap-2.5 px-4 py-3">
                      <span className="chip tint-var mt-0.5 shrink-0" style={{ "--tint": sc } as React.CSSProperties}>{c.severity}</span>
                      <div className="min-w-0 text-[12.5px] leading-snug">
                        <span className="text-ink">{c.claim.replace(/[.!?]\s*$/, "")}</span>
                        <span className="text-ink-faint">. Conflicting evidence: </span>
                        <span className="text-ink-dim">{c.conflict}</span>
                        {c.confidence === "low" && <span className="ml-1.5 text-[11px] text-ink-faint">(low confidence)</span>}
                      </div>
                    </div>
                  );
                })}
              </Card>
            </Section>
          </div>
        )}

        <div id="evidence-ledger" className="scroll-mt-28" />
        <section className="panel mt-5 px-5 py-5" aria-label="Where this evidence came from">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="eyebrow text-signal-lift">Provenance</p>
              <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">Where this evidence came from</h2>
            </div>
            <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
              saved · repeatable · sourced
            </span>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {argusEdgeMetrics.map((metric) => (
              <div key={metric.label} className="panel-inset px-3 py-3">
                <dt className="text-[10.5px] text-ink-faint">{metric.label}</dt>
                <dd className="stat-value mt-1 text-[20px] font-semibold">{metric.value}</dd>
                <dd className="mt-1 text-[10.5px] leading-snug text-ink-faint">{metric.detail}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <ReportCanvasRailCard
              title="Sources we saved"
              tone="signal"
              count={`${visibleIntelligenceCount} sources and leads`}
              items={provenanceRail}
              footer={(f.sourceArtifacts?.length ?? 0) > 0 ? <a href="#frozen-source-ledger" className="inline-flex min-h-8 items-center text-signal-lift hover:underline">View source details</a> : undefined}
            />
            <ReportCanvasRailCard title="Report freshness" tone="neutral" items={freshnessRail} />
          </div>
        </section>
        {f.profileAuthenticity && (
          <FrozenProfileAuthenticityPanel
            result={f.profileAuthenticity}
            artifact={profilePhotoArtifact}
            reportVersionId={evidenceReportVersionId}
            version={versionContext?.version}
          />
        )}

        {f.trustGraphScreen && (
          <FrozenTrustGraphPanel
            screen={f.trustGraphScreen}
            reportVersionId={evidenceReportVersionId}
            version={versionContext?.version}
          />
        )}

        <FrozenSourceLedger artifacts={f.sourceArtifacts ?? []} subjectHandle={report.handle} profile={fundScaleProfile} />

        <div id="relationships" className="scroll-mt-28" />
        {/* connections — the compounding web: other audited subjects tied to this one */}
        {showTrustGraphSupplemental && connections.length > 0 && (
          <Section title="Connections" kicker="the web · others you've audited who share projects, people or wallets with this subject">
            <Card className="divide-y divide-line/60">
              {connections.map((c) => {
                const vm = c.otherVerdict ? verdictMeta(c.otherVerdict) : null;
                return (
                  <div key={c.other} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      <Avatar src={/^@[A-Za-z0-9_]{2,30}$/.test(c.other) ? xAvatar(c.other) : null} letter={(c.other.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[10px]" />
                      <div className="min-w-0">
                      <span className="mono text-[12.5px] text-ink">{c.other}</span>
                      {vm && <span className={`verdict-pill ml-2 ${c.otherVerdict === "FAIL" ? "tint-fail" : "tint-var"}`} style={c.otherVerdict === "FAIL" ? undefined : ({ "--tint": vm.color } as React.CSSProperties)}>{vm.label}</span>}
                      <div className="mt-0.5 text-[12.5px] leading-snug text-ink-dim">
                        {c.direct && <span>directly linked{c.ties.length > 0 ? " · " : ""}</span>}
                        {c.ties.length > 0 && (
                          <span>via {c.ties.map((t, ti) => (
                            <span key={t.key}>
                              {ti > 0 && ", "}
                              {onOpenProject && t.type === "Company" ? (
                                <button onClick={() => onOpenProject(t.label, undefined, panelCostToken)} className="text-ink underline-offset-2 transition hover:text-signal-lift hover:underline">{t.label}</button>
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
                      <button onClick={() => onAudit(c.other)} className="btn-chip tint-signal shrink-0">open →</button>
                    )}
                  </div>
                );
              })}
            </Card>
          </Section>
        )}

        {/* role breakdown — governing role full-width and expanded, the rest below */}
        <div id="role-breakdown" className="scroll-mt-28">
          <Section title="Role breakdown" kicker="each role scored on its own track · never averaged">
            {(() => {
              const gov = report.role_reports.find((rr) => rr.role === report.governing_role);
              const others = report.role_reports.filter((rr) => rr.role !== report.governing_role);
              return (
                <div className="space-y-3">
                  {gov && <RoleCard key={gov.role} rr={gov} governing scoreState={roleScoreState} />}
                  {others.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {others.map((rr) => (
                        <RoleCard key={rr.role} rr={rr} governing={false} scoreState={roleScoreState} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </Section>
        </div>


        {/* signature modules */}
        <div className="2xl:columns-2 2xl:gap-3">
          {evidence.wallets.length > 0 && (
            <div className="mb-3 min-w-0 break-inside-avoid">
              <Section title="Wallets & on-chain links" kicker="addresses tied to them · ranked by attribution strength">
                <Clamp itemCount={evidence.wallets.length} label="wallets">
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
                            <span className="chip shrink-0">
                              {w.chain === "solana" ? "SOL" : "EVM"}
                            </span>
                            <a href={explorer(w)} target="_blank" rel="noreferrer" className="mono link-ext truncate">{shortAddr(w.address)}</a>
                            <CopyAddr text={w.address} />
                            {w.link_evidence_url && (
                              <a href={w.link_evidence_url} target="_blank" rel="noreferrer" className="link-ext shrink-0 text-[11px]">proof</a>
                            )}
                            <span className="chip tint-var ml-auto shrink-0" style={{ "--tint": t.color } as React.CSSProperties}>
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
                                <span key={fl} className="chip tint-avoid">{fl}</span>
                              ))}
                              {w.positive_signals && (
                                <span className="chip tint-pass">{w.positive_signals}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </Card>
                </Clamp>
              </Section>
            </div>
          )}

          {(fundScaleArtifactGroups.length > 0 || portfolioArtifactGroups.length > 0 || (roles.some((role) => role === "INVESTOR") && portfolioLeads.length > 0)) && (
            <div className="min-w-0 lg:col-span-2">
              <Section
                title="Investor evidence"
                kicker={`${verifiedPortfolioProjects.length} verified relationship${verifiedPortfolioProjects.length === 1 ? "" : "s"} · ${verifiedFundScaleClaims.length} verified scale claim${verifiedFundScaleClaims.length === 1 ? "" : "s"} · ${reportedFundScaleClaims.length} reported-only scale claim${reportedFundScaleClaims.length === 1 ? "" : "s"} · ${reportedPortfolioProjects.length} reported-only relationship${reportedPortfolioProjects.length === 1 ? "" : "s"}`}
              >
                <Card className="divide-y divide-line/60">
                  {fundScaleArtifactGroups.length > 0 && (
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">Fund scale</h3>
                      <span className="text-[10.5px] text-ink-faint">Capital managed by the named entity, never assumed to be the subject's personal capital</span>
                    </div>
                  )}
                  {fundScaleArtifactGroups.map((group) => (
                    <article key={group.key} className="px-4 py-3 text-[12.5px]">
                      {group.attribution === "affiliated_fund" && (
                        <p className="mb-2 text-[12px] font-medium text-ink-dim">
                          {group.subject} → affiliated with {group.fundName}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <h4 className="font-medium text-ink">{group.fundVehicle || group.fundName}</h4>
                        {group.fundVehicle && (
                          <span className="text-[10.5px] text-ink-faint">fund vehicle · {group.fundName}</span>
                        )}
                        <span className="mono text-[12px] font-medium text-ink-dim">
                          {group.qualifier === "at_least" ? "≥ " : group.qualifier === "approximate" ? "≈ " : ""}
                          {formatFundScaleUsd(group.amountUsd)}
                        </span>
                        <span className="chip">
                          {group.metric ? FUND_SCALE_METRIC_LABEL[group.metric] : "fund scale"}
                        </span>
                        {group.basis && <span className="chip">{FUND_SCALE_BASIS_LABEL[group.basis]}</span>}
                        <span className="chip">{group.temporalLabel}</span>
                        <span className={`chip chip-wrap ${group.confirmed ? "tint-pass" : "tint-caution"}`}>
                          {group.confirmed
                            ? group.attribution === "affiliated_fund"
                              ? "fund scale verified · not personal capital"
                              : "fund scale verified"
                            : "reported scale · strict verification incomplete"}
                        </span>
                        <span className="ml-auto text-[10.5px] text-ink-faint">
                          {group.confirmedSourceCount > 0
                            ? `${group.confirmedSourceCount} source${group.confirmedSourceCount === 1 ? "" : "s"} passed strict gate`
                            : "no source passed the strict gate"}
                          {group.reportedSourceCount ? ` · ${group.reportedSourceCount} other source${group.reportedSourceCount === 1 ? "" : "s"}` : ""}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-col items-start gap-1">
                        {group.attribution === "affiliated_fund" && (
                          <>
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Affiliation source"
                              context={`${group.subject} affiliation with ${group.fundName}`}
                            />
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Fund domain source"
                              context={`${group.fundName} official domain`}
                            />
                          </>
                        )}
                        <InvestorEvidenceLinks
                          sources={group.sources}
                          role="Scale source"
                          context={`${group.fundVehicle || group.fundName} fund scale`}
                        />
                      </div>
                      {!group.confirmed && reportedFundScaleOverlapCount(group) > 1 && (
                        <p className="panel-inset mt-2 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
                          Possible overlap: another reported claim names the same amount but a different or unspecified vehicle. ARGUS keeps them separate because the frozen evidence does not establish that they are the same fund.
                        </p>
                      )}
                    </article>
                  ))}
                  {(portfolioArtifactGroups.length > 0 || portfolioLeads.length > 0) && (
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">Portfolio relationships</h3>
                      <span className="text-[10.5px] text-ink-faint">Entity attribution and deal evidence are shown separately</span>
                    </div>
                  )}
                  {portfolioArtifactGroups.map((group) => (
                    <article key={group.key} className="px-4 py-3 text-[12.5px]">
                      <h4 className="font-medium text-ink">
                        {group.attribution === "affiliated_fund"
                          ? `${group.subject} → affiliated with ${group.investor} → invested in ${group.project}`
                          : `${group.subject} → invested in ${group.project}`}
                      </h4>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className={`chip chip-wrap ${group.confirmed ? "tint-pass" : "tint-caution"}`}>
                          {group.confirmed
                            ? group.attribution === "affiliated_fund"
                              ? "fund investment verified · not attributed personally"
                              : "direct investment verified"
                            : "reported · needs corroboration"}
                        </span>
                        <span className="ml-auto text-[10.5px] text-ink-faint">
                          {group.confirmedSourceCount} verified source{group.confirmedSourceCount === 1 ? "" : "s"}
                          {group.reportedSourceCount ? ` · ${group.reportedSourceCount} reported source${group.reportedSourceCount === 1 ? "" : "s"}` : ""}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-col items-start gap-1">
                        {group.attribution === "affiliated_fund" && (
                          <>
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Affiliation source"
                              context={`${group.subject} affiliation with ${group.investor}`}
                            />
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Fund domain source"
                              context={`${group.investor} official domain`}
                            />
                          </>
                        )}
                        <InvestorEvidenceLinks
                          sources={group.sources}
                          role="Deal source"
                          context={`${group.investor} investment in ${group.project}`}
                        />
                      </div>
                    </article>
                  ))}
                  {portfolioArtifactGroups.length === 0 && portfolioLeads.length > 0 && (
                    <div className="px-4 py-3 text-[12px] leading-relaxed text-ink-dim">
                      {portfolioLeads.length} source-linked candidate{portfolioLeads.length === 1 ? " was" : "s were"} discovered, but none passed deterministic relationship verification. Candidates remain outside the score and graph.
                    </div>
                  )}
                </Card>
                {unmatchedPortfolioLeadCount > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                    Discovery breadth is not verification: unmatched or single-source candidates remain leads and cannot improve the frozen investor score.
                  </p>
                )}
              </Section>
            </div>
          )}

          {evidence.ventures.length > 0 && (
            <div className="mb-3 min-w-0 break-inside-avoid">
              <Section title="Ventures & affiliations" kicker="founding, employment and operating ties · separate from investments">
                <Clamp itemCount={evidence.ventures.length} label="ventures">
                <Card className="divide-y divide-line/60">
                  {evidence.ventures.map((v, i) => {
                    // Discovered-by-model, verified-by-fetch is the standard leads pattern:
                    // a first-party source naming the venture makes it source-backed.
                    const sourceBacked = v.artifact_verified === true;
                    const isLead = v.evidence_origin === "model_lead" || v.artifact_verified === false;
                    const evidenceState = sourceBacked ? "source-backed" : isLead ? "unverified lead" : "legacy curated";
                    return (
                      <div key={i} className="flex items-center gap-2 px-4 py-2.5 text-[12.5px]">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: v.outcome === "Rug" ? "var(--color-avoid)" : v.outcome === "Acquisition" || v.outcome === "IPO" ? "var(--color-pass)" : "var(--color-ink-faint)" }}
                        />
                        {onOpenProject ? (
                          <button onClick={() => onOpenProject(v.project_name, undefined, panelCostToken)} className="truncate text-left text-ink underline-offset-2 transition hover:text-signal-lift hover:underline" title="See everyone who worked on this">{v.project_name}</button>
                        ) : (
                          <span className="truncate text-ink">{v.project_name}</span>
                        )}
                        <span className="chip shrink-0">{v.role}</span>
                        {v.period && <span className="shrink-0 text-[11px] text-ink-faint">{v.period}</span>}
                        {v.evidence_url && (
                          <a href={v.evidence_url} target="_blank" rel="noreferrer" className="link-ext shrink-0 text-[11px]">source</a>
                        )}
                        <span className={`mono ml-auto shrink-0 text-[11px] ${sourceBacked ? "text-pass" : "text-ink-faint"}`}>
                          {evidenceState}
                        </span>
                      </div>
                    );
                  })}
                </Card>
                </Clamp>
              </Section>
            </div>
          )}

          {corroborationRows.length > 0 && (
            <div className="mb-3 min-w-0 break-inside-avoid">
              <Section title="Testimonial corroboration" kicker="claimed vs. acknowledged">
                <Clamp itemCount={corroborationRows.length} label="endorsements">
                <CorroborationTable rows={corroborationRows} />
                </Clamp>
              </Section>
            </div>
          )}

          {founderSummary && (
            <div className="mb-3 min-w-0 break-inside-avoid">
              <Section title="Founder pattern" kicker="outcomes + repeat backing">
                <Card className="p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="eyebrow">Pattern</div>
                      <div className="mono text-[15px] font-medium text-ink">{founderSummary.pattern}</div>
                    </div>
                    <div className="h-8 w-px bg-line" />
                    <div>
                      <div className="eyebrow">Repeat backing</div>
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
                    <p className="mt-2 text-[12.5px] text-ink-faint">
                      Returning backers: <span className="text-ink-dim">{founderSummary.repeat_backing.repeat_backers.join(", ")}</span>
                    </p>
                  )}
                </Card>
              </Section>
            </div>
          )}

          {advisedRows.length > 0 && (
            <div className="mb-3 min-w-0 break-inside-avoid">
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
                        <span className="chip tint-caution">allocation</span>
                      )}
                      <span className="mono ml-auto text-[11px]" style={{ color: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>
                        {p.project_outcome}
                      </span>
                      <span className="mono text-[11px]" style={{ color: TV_TONE[p.corroboration_verdict ?? "Unconfirmed"] }}>
                        {TV_SHORT[p.corroboration_verdict ?? "Unconfirmed"]}
                      </span>
                    </div>
                  ))}
                </Card>
              </Section>
            </div>
          )}

          {showProfilePhotoSupplemental && panelCostToken && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="Profile photo" kicker="current supplemental overlay · outside the frozen core evidence and stored verdict">
                <PfpCheck handle={report.handle} brand={roles.some((role) => String(role) === "PROJECT") && !roles.some((role) => String(role) === "FOUNDER")} panelCostToken={panelCostToken} />
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
              <Section title="VC portfolio leads" kicker="paid current supplemental search · unverified candidates · excluded from graph and verdict">
                <VcReport key={`${report.handle}:${panelCostToken}`} handle={report.handle} name={f.display_name || report.handle} verifiedProjects={verifiedPortfolioProjects} panelCostToken={panelCostToken} onAudit={onAudit} />
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
            const dom = (() => {
              try {
                return f.website ? new URL(f.website).hostname.replace(/^www\./i, "").toLowerCase() : "";
              } catch {
                return (f.bio.match(/\b([a-z0-9][a-z0-9-]*\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1] ?? "").toLowerCase();
              }
            })();
            return showCurrentIntelligence && roles.some((r) => r === "PROJECT") && dom ? (
              <div className="min-w-0 lg:col-span-2">
                <Section title="Project intelligence" kicker="domain age + claimed security audits; an established brand on a fresh domain is a contradiction">
                  <ProjectIntel domain={dom} />
                </Section>
              </div>
            ) : null;
          })()}

          {showOffchainSupplemental && (
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

          {/* transparent scan methodology — what ARGUS checked on this person */}
          {(diligenceChecks.length > 0 || providerGaps.length > 0) && (
            <div className="min-w-0 lg:col-span-2">
              {diligenceChecks.length > 0 && <MethodologyChecklist id="scan-methodology" checks={diligenceChecks} />}
              {providerGaps.length > 0 && (
                <details id={diligenceChecks.length > 0 ? "provider-data-coverage" : "scan-methodology"} className="panel mt-2 px-4 py-3">
                  <summary className="cursor-pointer text-[12.5px] font-medium text-ink-dim">
                    Data coverage notes · {providerGaps.length}
                  </summary>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                    These source availability notes explain coverage. They are not findings about the subject.
                  </p>
                  <ul className="mt-2 divide-y divide-line/60">
                    {providerGaps.map((run) => (
                      <li key={run.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[11.5px]">
                        <span className="text-ink-dim">{run.label}</span>
                        <span className="text-ink-faint">{run.state}</span>
                        {run.detail && <span className="w-full leading-relaxed text-ink-faint">{run.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {(visibleGraphEdges.length > 0 || (showTrustGraphSupplemental && connections.length > 0)) && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="Connection web" kicker="click any node to open it · subject → projects → the people behind them">
                <Card className="p-2">
                  <TrustGraph nodes={visibleGraphNodes} edges={visibleGraphEdges} connections={showTrustGraphSupplemental ? connections : []} onAudit={onAudit} onOpenProject={onOpenProject ? (name) => onOpenProject(name, undefined, panelCostToken) : undefined} />
                </Card>
              </Section>
            </div>
          )}

          {/* ask-the-report chat — grounded in this person's own evidence */}
          <div className="min-w-0 lg:col-span-2">
            <AskReport
              subject={report.handle}
              reportVersionId={evidenceReportVersionId}
            />
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
        {publishableSubjectFindings.length > 0 && (
          <div id="publishable-findings" className="scroll-mt-28">
            <Section title="Publishable findings" kicker="sourced · dated · independently corroborated">
              <FindingsLedger findings={publishableSubjectFindings} />
            </Section>
          </div>
        )}

        {investigativeLeads.length > 0 && (
          <div id="investigative-leads" className="scroll-mt-28">
            <Section title="Worth a second look" kicker="items about related people and companies · never counted in this score">
              <details className="panel px-4 py-3">
                <summary className="cursor-pointer text-[12.5px] font-medium text-ink-dim">
                  Review {investigativeLeads.length} unverified follow-up lead{investigativeLeads.length === 1 ? "" : "s"}
                </summary>
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                  These leads are excluded from the verdict. Expand them only when you want to continue the investigation.
                </p>
                <div className="mt-3">
                  <InvestigativeLeadsLedger leads={investigativeLeads} subject={report.handle} />
                </div>
              </details>
            </Section>
          </div>
        )}

        {/* methodology footer */}
        <div className="panel mt-8 p-5">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-dim">
            <ArgusMark size={16} /> How this verdict was reached
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            Each role is scored to 100 on its own axes. Disqualifying findings act as hard caps that
            override the weighted total rather than averaging into it, so a single rug or contradicted
            endorsement cannot be diluted. The composite is the most severe role band, never a mean.
            Identity is rewarded, not gated: pseudonymity is neutral, disclosure earns a bonus, and only
            impersonation blocks a verdict. API-only acquisition, evidence-disciplined, reproducible.
          </p>
          <RunCostLine cost={dossier.cost} />
        </div>
      </div>
    </div>
  );
}
