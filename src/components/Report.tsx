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
import { claimedTicker, deriveDecisionDiscovery, deriveNoticedSignals, deriveVerdictArgument } from "../lib/reportInsights";
import { materialDeltaDiscovery } from "../lib/reportDelta";
import { buildPublicClaimConflictDiscovery, buildPublicControlPathDiscovery } from "../lib/reasoningReceipts";
import { DecisionLensSelector, NoticedRail, VerdictArgumentBlock } from "./InvestigatorBrief";
import type { DecisionLensId } from "../intelligence/types";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import type { Dossier } from "../data/dossier";
import type { SourceArtifact } from "../data/evidence";
import { getProfile, SubjectClass, type RoleReport } from "../engine";
import { verdictMeta, ROLE_META, axisLabel, capLabel } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import { CopyTldrButton, OutcomeDeltaStrip, ProviderFailureNotice, ScoreContextStrip } from "./ScoreContext";
import { UsageVisuals } from "./UsageVisuals";
import { OperatorTrackRecord } from "./OperatorTrackRecord";
import { getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { Avatar } from "./Avatar";
import { ProjectLinks } from "./ProjectLinks";
import { personAvatar, trustedOfficialXAvatarUrl, xAvatar } from "../lib/avatars";
import { explorer, shortAddr, walletBindingLabel, walletScreenView, walletTier } from "../lib/wallets";
import { IdentitySweep } from "./IdentitySweep";
import { PfpCheck } from "./PfpCheck";
import { PersonGithub } from "./PersonGithub";
import { GithubAssessment } from "./GithubAssessment";
import { ThreatReport } from "./ThreatScanPage";
import { ExportMenu } from "./ExportMenu";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { decisionCriticalChecks, isAdverseFinding, personChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { applyReportCheckContract, hasExplicitReportCheckContract } from "../lib/reportCheckContract";
import { coverageQualifiedCompleteness, exactReportPath, presentPublicReport } from "../lib/reportPresentation";
import { reportIdentity } from "../lib/caseLabel";
import { AddInfo } from "./AddInfo";
import { ScoreComposition } from "./ScoreComposition";
import { DimensionChapters } from "./DimensionChapters";
import { compositionHeadline, orderByPlainAxis, personDimensionChapters, plainAxisLabel } from "../lib/dimensionChapters";
import { DossierReport } from "./DossierReport";
import { ScoreRing } from "./ScoreRing";
import { LinkEntity } from "./LinkEntity";
import { ArgusEyeAssistant } from "./ArgusEyeAssistant";
import { KolReport } from "./KolReport";
import { NewsSection } from "./NewsSection";
import { VcReport } from "./VcReport";
import { ProjectIntel } from "./ProjectIntel";
import { ProjectTokenCard } from "./ProjectTokenCard";
import { changeReportLifecycle } from "../lib/reports";
import { LegalScreen } from "./LegalScreen";
import { SanctionsNameScreen } from "./SanctionsNameScreen";
import { RingAlert } from "./RingAlert";
import { useArgusAuth } from "../auth-context";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import { DecisionBasis } from "./DecisionBasis";
import { isStrictFundScaleArtifact } from "../lib/fundScaleEvidence";
import { portfolioRelationshipBinding, type PortfolioBindingSubject } from "../lib/portfolioRelationshipBinding";
import { buildDecisionBasis } from "../lib/decisionBasis";
import {
  ReportCanvasNarrativeSection,
  ReportCanvasRailCard,
  ReportStickyTableOfContents,
  ReportExperienceLayout,
  type ReportCanvasNavItem,
  type ReportCanvasNarrativeItem,
  type ReportCanvasRailItem,
} from "./ReportCanvasPrimitives";
import { ReportDisclaimer } from "./ReportDisclaimer";
import { InvestigationDecisionCanvas, type DecisionCanvasItem } from "./InvestigationDecisionCanvas";
import {
  BasicFactsPanel,
  type BasicFactLeadView,
  type BasicFactView,
} from "./BasicFactsPanel";
import {
  basicFactQuestionOutcome,
  canonicalBasicFactPredicate,
  reportBasicFactQuestionsFor,
  supportsExplicitEmptyBasicFact,
} from "../lib/basicFactQuestions";
import { summarizeFundingEvidence } from "../lib/fundingEvidence";
import { isExactOfficialXProfile, projectLeadIsRelevant } from "../lib/projectLeadRelevance";
import { ExpandableText } from "./ExpandableText";
import { formatRoleLabel, plainLanguageSummary, plainReportStatusLabel, publicCheckLabel, publicCheckNote, publicConcernTitle } from "../lib/plainLanguage";
import { publicFindingTitle, publicIntelligenceText, publicStrengthLabel } from "../lib/intelligencePresentation";
import { PointInTimeIntelligencePanel } from "./PointInTimeIntelligencePanel";
import { DiligenceEvidenceLedgers } from "./DiligenceEvidenceLedgers";
import { ResearchPlanPanel } from "./ResearchPlanPanel";
import { EvmControlSurfacePanel } from "./EvmControlSurfacePanel";
import { isOrganizationAccount } from "../lib/investorSubject";
import { deriveIntelligenceBrief, isOfficialTokenQuestion } from "../lib/intelligenceBrief";
import { SocialActivityPanel } from "./SocialActivityPanel";
import { reportOpeningNarrative } from "../lib/reportNarrative";
import { useReportLane } from "../reports/shared/ReportLaneContext";
import { KyleGithubSynthesis } from "../reports/kyle/KyleGithubSynthesis";
import { SubjectAccusationStage } from "./SubjectAccusationStage";
import {
  SUBJECT_LEAD_RELATIONSHIP,
  actionableInvestigativeLead,
  findingTarget,
  isPublishableSubjectFinding,
  leadArtifactConfirmed,
  leadRelationshipLabel,
  normalizedEntityHandle,
} from "../lib/subjectLeads";

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

// ScoreRing moved to src/components/ScoreRing.tsx — the shared idiom all
// three report surfaces now use.

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
    <section className="mt-6">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 className="display-sm text-[18px] leading-tight text-ink">{title}</h2>
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

function frozenDateLabel(value?: string | null): string {
  if (!value) return "date not recorded";
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Provider-recorded operational events belong beside the subject identity. */
function CriticalSubjectAlerts({ dossier }: { dossier: Dossier }) {
  const incidents = [...(dossier.protocolTvl?.hacks ?? [])]
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
  const incident = incidents[0];
  const xStatus = dossier.x_account_status === "suspended" || dossier.x_account_status === "unavailable"
    ? dossier.x_account_status
    : null;
  if (!incident && !xStatus) return null;

  const incidentSource = safeSourceLink(dossier.protocolTvl?.sourceUrl);
  const xSource = safeSourceLink(dossier.x_account_status_source_url);
  const incidentRecovery = incident?.returnedFunds === true
    ? incident.returnedAmountUsd
      ? `Provider records ${usdCompact(incident.returnedAmountUsd)} returned`
      : "Provider returned-funds field: yes; amount not recorded"
    : incident?.returnedFunds === false
      ? "Provider returned-funds field: no"
      : "Provider returned-funds field not recorded";

  return (
    <div
      className="order-3 border-t border-line/70 bg-panel/30 px-5 py-4 lg:order-none"
      aria-label="Material subject alerts"
    >
      <div className={`grid gap-3 ${incident && xStatus ? "md:grid-cols-2" : ""}`}>
        {incident && (
          <article className="rounded-xl border border-caution/30 bg-panel/70 p-3.5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-caution/30 bg-caution/[0.06] text-caution">
                <WarningCircle aria-hidden="true" size={17} weight="fill" />
              </span>
              <div className="min-w-0">
                <div className="eyebrow text-caution">Provider-recorded protocol event</div>
                <p className="mt-1 text-[14px] font-semibold leading-snug text-ink">
                  {incident.amountUsd ? usdCompact(incident.amountUsd) : "Amount not recorded"} · {frozenDateLabel(incident.date)}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                  {[incident.classification, incident.technique].filter(Boolean).join(" · ") || "Protocol security incident"}
                  <span className="text-ink-faint"> · {incidentRecovery}</span>
                </p>
                {dossier.report.cap_applied === "recent_critical_protocol_loss_without_recorded_recovery" && (
                  <p className="mt-2 rounded-md border border-caution/25 bg-caution/[0.05] px-2.5 py-2 text-[11.5px] font-medium leading-relaxed text-caution">
                    This saved event record activates the report's 39/100 scoring cap under the frozen rubric.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                  {incidents.length > 1 && <span>{incidents.length} incidents recorded</span>}
                  {incidentSource && (
                    <a href={incidentSource.href} target="_blank" rel="noreferrer" className="text-signal-lift underline-offset-2 hover:underline">
                      Review incident source
                    </a>
                  )}
                </div>
              </div>
            </div>
          </article>
        )}
        {xStatus && (
          <article className="rounded-xl border border-avoid/35 bg-panel/70 p-3.5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-avoid/35 bg-avoid/10 text-avoid">
                <XCircle aria-hidden="true" size={17} weight="fill" />
              </span>
              <div className="min-w-0">
                <div className="eyebrow text-avoid">
                  {xStatus === "suspended" ? "Official X account suspended" : "Official X account unavailable"}
                </div>
                <p className="mt-1 text-[14px] font-semibold leading-snug text-ink">{dossier.handle}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                  {xStatus === "suspended"
                    ? "X currently renders a terminal Account suspended state. The official-site identity binding remains separate, but the project's primary social channel is unavailable."
                    : "No live public X profile was available. Treat follower count, join date, and posting cadence as unavailable rather than zero."}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                  <span>checked {frozenDateLabel(dossier.x_account_status_captured_at)}</span>
                  {xSource && (
                    <a href={xSource.href} target="_blank" rel="noreferrer" className="text-signal-lift underline-offset-2 hover:underline">
                      Open X account state
                    </a>
                  )}
                </div>
              </div>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

function SubjectProfileContext({
  dossier,
  roles,
  hasTerminalXState,
  summary,
  showSummary = true,
}: {
  dossier: Dossier;
  roles: SubjectClass[];
  hasTerminalXState: boolean;
  summary: string;
  showSummary?: boolean;
}) {
  return (
    <>
      {showSummary && <p className="mt-2 max-w-2xl break-words text-[13.5px] leading-relaxed text-ink-dim">{summary}</p>}
      <ReportDisclaimer className="mt-2 max-w-2xl" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {roles.map((role) => (
          <span key={role} className="chip">
            <RoleIcon role={role} size={13} /> {ROLE_META[role].label}
          </span>
        ))}
        {hasTerminalXState ? (
          <span className="text-[12.5px] font-medium text-avoid">X profile metrics unavailable</span>
        ) : (
          <>
            <span className="text-[12.5px] text-ink-faint"><span className="text-ink-dim">{dossier.followers}</span> followers</span>
            <span className="text-[12.5px] text-ink-faint">joined {dossier.joined}</span>
          </>
        )}
        {typeof dossier.days_since_post === "number" && (
          <span className={`text-[12.5px] ${dossier.days_since_post >= 21 ? "font-medium text-avoid" : "text-ink-faint"}`}>
            {hasTerminalXState
              ? `last observed post ${dossier.days_since_post}d ago`
              : dossier.days_since_post === 0
                ? "posted today"
                : dossier.days_since_post === 1
                  ? "posted yesterday"
                  : `last posted ${dossier.days_since_post}d ago`}
          </span>
        )}
      </div>
      {dossier.notableFollowers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-faint">Notable followers</span>
          {dossier.notableFollowers.slice(0, 6).map((notable) => {
            const big = (notable.count ?? 0) >= 1e6;
            return (
              <a
                key={notable.handle}
                href={`https://x.com/${notable.handle}`}
                target="_blank"
                rel="noreferrer"
                className={`chip normal-case tracking-normal transition hover:text-ink ${big ? "tint-pass" : ""}`}
                title={`${notable.label} · ${notable.size} followers`}
              >
                @{notable.handle} <span className="opacity-70">{notable.size}</span>
              </a>
            );
          })}
          {dossier.notableFollowers.length > 6 && <span className="mono text-[11px] text-ink-faint">+{dossier.notableFollowers.length - 6}</span>}
        </div>
      )}
    </>
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
    "operator attribution (followings + bio claim)": "Official X profiles",
    "operator attribution (amplified + bio claim)": "Official X profiles",
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
}): "Strong support" | "Some support" | "Limited support" {
  const ratio = weight > 0 ? score / weight : 0;
  if (supportCount >= 3 && ratio >= 0.72 && counterCount === 0 && questionCount === 0) return "Strong support";
  if (supportCount >= 2 && ratio >= 0.48 && counterCount <= 1) return "Some support";
  return "Limited support";
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
      {rationale && (
        <ExpandableText
          text={rationale}
          collapsedLength={180}
          className="mt-1.5 text-[12.5px] leading-snug text-ink-faint"
        />
      )}
      {evidenceRefs && (
        <a
          href={`#decision-basis-${axis}`}
          className="mt-1.5 inline-flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-[12.5px] text-signal-lift underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <span>{supportCount} {supportCount === 1 ? "source" : "sources"} reviewed</span>
          {counterCount > 0 && <span className="text-caution">{counterCount} {counterCount === 1 ? "source disagrees" : "sources disagree"}</span>}
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
            {governing && <span className="chip">score used</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <VerdictPill verdict={rr.verdict} />
            {!coverageReady && rr.verdict === "PASS" && (
              <span className="mono text-[11px] font-medium uppercase tracking-wide text-caution">
                {provisional ? "checks still open" : "score not ready"}
              </span>
            )}
            {rr.cap_applied && (
              <span className="mono text-[11px] font-medium text-avoid">
                score limited · {capLabel(rr.cap_applied)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-center">
          <ScoreRing score={rr.score_total} verdict={rr.verdict} size={64} />
          {!coverageReady && (
            <span className="mono mt-0.5 block text-[9px] font-medium uppercase tracking-wide text-caution">
              {provisional ? "checks open" : "not ready"}
            </span>
          )}
        </div>
      </button>

      {open && axes.length > 0 && (
        <div className="overflow-hidden border-t border-line px-4 pb-3">
          {!coverageReady && (
            <p className="panel-inset mt-3 px-3 py-2 text-[11px] leading-relaxed text-caution" role="note">
              {provisional
                ? "This score uses the facts collected so far. Treat it as an early read until the open checks finish."
                : "The final score is not ready because key checks are still open."}
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
              <span className="text-ink-dim">Verified identity bonus</span>
              <span className="mono text-pass">+{rr.dox_bonus}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between px-1 text-[12.5px] text-ink-faint">
            <span>
              Points before safety limits {rr.raw_total} {rr.dox_bonus ? `+ ${rr.dox_bonus} bonus` : ""}
            </span>
            <span className="mono">Current score {rr.score_total ?? "N/A"}{rr.cap_applied ? " (limited)" : ""}</span>
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
  Corroborated: "Confirmed",
  PartiallyCorroborated: "Mixed",
  Unconfirmed: "Not confirmed",
  Contradicted: "Sources disagree",
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
        <span className="text-right">Result</span>
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
        // Polarity is signed. A 0 finding is informational context the reader
        // weighs, so it must not borrow the adverse hue and read as an
        // accusation the evidence never made.
        const polarityTone = f.polarity > 0
          ? { color: "var(--color-pass)", label: "Positive finding" }
          : f.polarity < 0
            ? { color: "var(--color-avoid)", label: "Adverse finding" }
            : { color: "var(--color-ink-faint)", label: "Neutral finding" };
        const statusColor = f.verification_status === "Verified"
          ? "var(--color-pass)"
          : f.verification_status === "Rumor"
            ? "var(--color-avoid)"
            : "var(--color-caution)";

        return (
          <Card key={i} className="p-3.5">
            <div className="flex items-start gap-3">
              <span
                role="img"
                aria-label={polarityTone.label}
                className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: polarityTone.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] leading-snug text-ink">{f.claim}</p>
                <div role="group" aria-label="Source details" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-faint">
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
        const relationship = leadRelationshipLabel(lead, subject);
        const aboutSubject = relationship === SUBJECT_LEAD_RELATIONSHIP;
        const verifiedAboutTarget = leadArtifactConfirmed(lead);
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
                : aboutSubject
                  // A lead that names the subject cannot be waved off as
                  // someone else's problem. The not-scored disclosure is on the
                  // row already, so this line says only what was not confirmed.
                  ? `Unverified: no source ARGUS could check corroborates this claim about ${subject}.`
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
  if (date.getTime() < Date.UTC(2020, 0, 1) || date.getTime() > Date.now() + 86_400_000) return null;
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
  press_corroborated: "confirmed by news sources",
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
      : "PHOTO CHECKED";

  return (
    <Section title="Profile photo" kicker="A quick image check. This cannot prove identity.">
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
              {confidence != null && <span className="mono text-[11px] text-ink-faint">{confidence}% confidence</span>}
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{result.note}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              This checks whether the image looks like a real person, logo, stock image, public figure, or AI image. It cannot prove who owns the account.
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
        <details className="mt-3 border-t border-line/60 pt-3 text-[11px] text-ink-faint">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {capturedAt && <span>Saved <time dateTime={result.capturedAt}>{capturedAt}</time></span>}
            <span className="mono" title={imageHash ?? undefined}>Source image SHA-256 {imageHash ? `${imageHash.slice(0, 12)}…` : "unavailable"}</span>
            {artifactHash && <span className="mono" title={artifactHash}>Artifact {artifactHash.slice(0, 12)}…</span>}
            {source && (
              <a href={source.href} target="_blank" rel="noopener noreferrer" className="link-ext mono">
                Open image source
              </a>
            )}
            <ExactVersionLink reportVersionId={reportVersionId} version={version} />
          </div>
        </details>
        {imageHash && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {frozenImageData
              ? "The saved image is shown here."
              : source
                ? "This image is loaded from the source and may change."
                : "The image is not stored in this report."}
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
      : "NO CONCERNING CONNECTION FOUND";

  return (
    <Section title="Known connections" kicker="checked against every case your team has audited">
      <Card className="overflow-hidden">
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip tint-var" style={{ "--tint": tone } as React.CSSProperties}>
              {stateLabel}
            </span>
            {screen.severity && risk && <span className="mono text-[11px] uppercase text-ink-faint">{screen.severity} concern</span>}
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{screen.line}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            These are the connections known when the report was saved. Sharing a person, wallet, funder, or project does not prove common control.
          </p>

          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="stat-tile">
              <dt className="stat-label">Reports checked</dt>
              <dd className="stat-value mt-0.5 font-semibold">{screen.qualifiedContributionCount} / {screen.contributionCount}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Connections found</dt>
              <dd className="stat-value mt-0.5 font-semibold">{screen.connections.length}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Status</dt>
              <dd className="stat-value mt-0.5 font-semibold">{incomplete ? "Not finished" : "Finished"}</dd>
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
                      {connection.qualified ? "used in report" : "context only"}
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

        <details className="border-t border-line/60 px-4 py-3 text-[11px] text-ink-faint">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {capturedAt && <span>Saved <time dateTime={screen.capturedAt}>{capturedAt}</time></span>}
            <span className="mono" title={graphHash ?? undefined}>Graph snapshot SHA-256 {graphHash ? `${graphHash.slice(0, 12)}…` : "unavailable"}</span>
            <ExactVersionLink reportVersionId={reportVersionId} version={version} />
          </div>
        </details>
      </Card>
    </Section>
  );
}

function FrozenSourceLedger({
  artifacts,
  subjectHandle,
  profile,
  roles,
}: {
  artifacts: FrozenSourceArtifact[];
  subjectHandle: string;
  profile: PortfolioBindingSubject["profile"];
  roles: readonly unknown[];
}) {
  if (!artifacts.length) return null;
  const fundScalePeers = artifacts.filter((artifact) => artifact.kind === "fund_scale");
  return (
    <div id="frozen-source-ledger" className="scroll-mt-24">
      <Section
        title="Saved sources"
        kicker="Articles and pages used in this report"
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
          const strictPortfolioMatch = artifact.kind === "portfolio_relationship"
            && Boolean(portfolioRelationshipBinding(artifact, { roles, profile }));
          const matchLabel = artifact.kind === "fund_scale" && artifact.match === "fund_scale_confirmed"
            ? strictFundScaleMatch ? "fund size verified" : "reported · strict verification incomplete"
            : artifact.kind === "portfolio_relationship" && artifact.match === "relationship_confirmed"
              ? strictPortfolioMatch ? "relationship verified" : "reported · strict verification incomplete"
              : SOURCE_MATCH_LABEL[artifact.match];
          const matchColor = artifact.match === "risk_signal"
            ? "var(--color-caution)"
            : strictPortfolioMatch || strictFundScaleMatch
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
                {capturedAt && <span>Saved <time dateTime={artifact.capturedAt}>{capturedAt}</time></span>}
              </div>
              <details className="mt-2 text-[11px] text-ink-faint">
                <summary className="cursor-pointer select-none">Technical details</summary>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span className="mono" title={hash ?? undefined}>SHA-256 {hash ? `${hash.slice(0, 12)}…` : "unavailable"}</span>
                  {sourceHash && <span className="mono" title={sourceHash}>{sourceHashLabel} {sourceHash.slice(0, 12)}…</span>}
                </div>
              </details>
              {source ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
                  aria-label={`Open ${SOURCE_KIND_LABEL[artifact.kind].toLowerCase()} source in a new tab: ${artifact.title}`}
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

const TEAM_CANDIDATE_ROLE = /\b(?:founder|co-?founder|chief|ceo|cto|cfo|coo|head of|manager|director|lead|engineer|developer|designer|marketing|operations?|operator|employee|staff|team member|community (?:master|manager|lead)|ambassador|advisor|adviser)\b/i;

function normalizedTeamIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamIdentityKeys(member: Pick<ReportTeamMember, "name" | "handle" | "linkedin">): string[] {
  return [member.handle, member.linkedin, member.name]
    .map(normalizedTeamIdentity)
    .filter(Boolean);
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
  const groundedKeys = new Set((dossier.webTeam ?? [])
    .filter(groundedTeamMember)
    .flatMap(teamIdentityKeys));
  const seen = new Set<string>();
  return [...(dossier.webTeamLeads ?? []), ...inferred].filter((member) => {
    if (!meaningfulTeamMember(member)) return false;
    // Orientation also discovers support accounts, integrations, grantors,
    // speakers, customers, and community examples. Those remain available in
    // the evidence appendix, but they are not team candidates.
    if (!TEAM_CANDIDATE_ROLE.test(member.role)) return false;
    // A model-only name with no stable identity locator is not an actionable
    // candidate. Showing generic names makes unrelated search snippets look
    // like team evidence and gives the reader no way to verify them.
    if (!member.handle?.trim() && !member.linkedin?.trim()) return false;
    const identityKeys = teamIdentityKeys(member);
    // One person gets one state. If a source-grounded roster card exists, its
    // stronger evidence wins and the model-enriched copy cannot reappear below
    // as an unverified candidate.
    if (identityKeys.some((key) => groundedKeys.has(key))) return false;
    const key = identityKeys[0] ?? [member.name, member.role, member.source].join("|").toLowerCase();
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

function authoritativeProjectTokenFact(dossier: Dossier, fact: BasicFactView): boolean {
  if (canonicalBasicFactPredicate(fact.predicate) !== "official_token") return true;
  if (dossier.projectToken?.verified) return true;
  return (fact.sources ?? []).some((source) =>
    source.sourceClass === "official_subject"
    || source.sourceClass === "official_counterparty"
    || source.sourceClass === "regulatory_or_onchain");
}

/**
 * Frozen discovery remains inspectable without letting generic-name search
 * collisions dominate the report. Project leads must bind to the official
 * scope or name the project in project-specific context. Repeated metrics from
 * one article collapse to one source-level lead.
 */
function reportBasicFactLeads(
  dossier: Dossier,
  audience: "project" | "investor" | "founder" | "person",
  publishedFacts: readonly BasicFactView[],
): BasicFactLeadView[] {
  const legacyTokenLeads = audience !== "project"
    ? []
    : (dossier.basicFacts ?? []).flatMap((fact): BasicFactLeadView[] => {
      if (authoritativeProjectTokenFact(dossier, fact)) return [];
      const [primary, ...additional] = fact.sources ?? [];
      return [{
        predicate: "official_token",
        value: fact.value,
        qualifier: "Reported by other sources; the official token is not confirmed.",
        sourceUrl: primary?.url,
        sourceTitle: primary?.title,
        candidateUrls: additional.map((source) => source.url),
        provider: primary?.provider ?? fact.provider,
      }];
    });
  const candidates = [...(dossier.basicFactLeads ?? []), ...legacyTokenLeads];
  const answeredPredicates = new Set(publishedFacts
    .filter((fact) => fact.status === "verified" || fact.status === "corroborated")
    .map((fact) => canonicalBasicFactPredicate(fact.predicate)));
  const relevant = audience === "project"
    ? candidates.filter((lead) =>
      !answeredPredicates.has(canonicalBasicFactPredicate(lead.predicate))
      && projectLeadIsRelevant(dossier, lead))
    : candidates;
  const seen = new Set<string>();
  return relevant.filter((lead) => {
    const source = lead.sourceUrl || lead.sourceTitle || String(lead.value ?? "");
    const key = `${canonicalBasicFactPredicate(lead.predicate)}:${source}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Frozen payloads stay immutable. This read-time publication projection only
 * removes unrelated identity citations and materializes a first-party product
 * answer already present in the stored provider-resolved X profile.
 */
function reportBasicFacts(dossier: Dossier, audience: "project" | "investor" | "founder" | "person"): BasicFactView[] {
  const projected = (dossier.basicFacts ?? [])
    .filter((fact) => {
      if (audience !== "project" || canonicalBasicFactPredicate(fact.predicate) !== "official_token") return true;
      // Compatibility repair for frozen reports created before official-token
      // corroboration was tightened. Multiple press articles may preserve a
      // useful ticker lead, but without a first-party/counterparty/on-chain
      // binding they must not render as an answered official-token fact.
      return authoritativeProjectTokenFact(dossier, fact);
    })
    .map((fact): BasicFactView => {
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
  const hasStrongerFundingFact = projected.some((fact) =>
    canonicalBasicFactPredicate(fact.predicate) === "funding"
    && fact.providerProjection !== true
    && (fact.status === "verified" || fact.status === "corroborated")
    && (fact.sources ?? []).some((source) =>
      source.provider !== "defillama"
      && source.provider !== "monid"
      && ["independent_press", "official_subject", "official_counterparty", "regulatory_or_onchain"].includes(source.sourceClass ?? "")));
  // Saved reports remain immutable, but their publication view must not put a
  // weaker aggregator summary beside stronger source-backed financing evidence.
  const facts = hasStrongerFundingFact
    ? projected.filter((fact) =>
      canonicalBasicFactPredicate(fact.predicate) !== "funding"
      || fact.providerProjection !== true)
    : projected;
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
    qualifier: "official project description",
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

export function Report({ dossier, onReset, onAudit, onRescan, onOpenProject, onOpenBrief, shareView = false }: { dossier: Dossier; onReset: () => void; onAudit?: (q: string) => void; onRescan?: () => void; onOpenProject?: (name: string, domain?: string, panelCostToken?: string) => void; onOpenBrief?: () => void; /** Read-only share capability view: every workspace action is absent. */ shareView?: boolean }) {
  const reportLane = useReportLane();
  const [decisionLensId, setDecisionLensId] = useState<DecisionLensId>("investment");
  const reportStyle = reportLane.definition.presentationStyle;
  const { role } = useArgusAuth();
  const f = dossier;
  const hasTerminalXState = f.x_account_status === "suspended" || f.x_account_status === "unavailable";
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
    identity_binding: f.identity_binding,
  };
  const portfolioBindingSubject = {
    roles: report.roles,
    profile: {
      handle: f.handle,
      display_name: f.display_name,
      resolved_name: f.resolved_name,
      bio: f.bio,
      website: f.website,
      profile_collection_state: f.profile_collection_state,
      profile_provider: f.profile_provider,
      identity_binding: f.identity_binding,
    },
  };
  const webTeam = (dossier.webTeam ?? []).filter(groundedTeamMember).map(sanitizedGroundedTeamMember);
  const webTeamLeads = reportTeamLeads(dossier);
  const leadershipRows = report.governing_role === "PROJECT" ? (dossier.leaderDepartures ?? []) : [];
  const leadershipForMember = (member: ReportTeamMember) => {
    const memberKeys = new Set(teamIdentityKeys(member));
    return leadershipRows.find((row) => {
      const rowKeys = [row.name, row.linkedin].map(normalizedTeamIdentity).filter(Boolean);
      return rowKeys.some((key) => memberKeys.has(key));
    });
  };
  const unmatchedLeadershipRows = leadershipRows.filter((row) =>
    !webTeam.some((member) => leadershipForMember(member) === row));
  // The operator is the verified team member the launch history was traced
  // through; fall back to the subject's own handle so the panel never renders
  // an empty attribution.
  const operatorHandleForDossier = (dossier.webTeam ?? [])
    .find((member) => member.provider === "twitterapi" && member.artifact_verified === true && member.handle)?.handle
    ?? (dossier.webTeam ?? []).find((member) => member.handle)?.handle
    ?? f.handle;
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
    .map((group) => {
      const confirmedSources = group.sources.filter((source) =>
        Boolean(portfolioRelationshipBinding(source, portfolioBindingSubject)));
      return {
        ...group,
        confirmed: confirmedSources.length > 0,
        confirmedSourceCount: confirmedSources.length,
        reportedSourceCount: group.sources.length - confirmedSources.length,
      };
    })
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
  const organizationAccount = isOrganizationAccount({
    roles,
    profile: {
      handle: f.handle,
      display_name: f.display_name,
      resolved_name: f.resolved_name,
      bio: f.bio,
    },
  });
  const ledgerAudience = f.basicFactQuestionLedger?.[0]?.audience;
  const basicFactsAudience = ledgerAudience === "project"
    ? "project" as const
    : ledgerAudience === "investor"
      ? "investor" as const
      : ledgerAudience === "person"
        ? roles.includes(SubjectClass.PROJECT)
          ? "project" as const
          : roles.includes(SubjectClass.INVESTOR)
            ? "investor" as const
            : roles.includes(SubjectClass.FOUNDER)
              ? "founder" as const
              : "person" as const
        : roles.includes(SubjectClass.PROJECT)
          ? "project" as const
          : roles.includes(SubjectClass.INVESTOR)
            ? "investor" as const
          : roles.includes(SubjectClass.FOUNDER)
            ? "founder" as const
            : "person" as const;
  const publicationBasicFacts = reportBasicFacts(f, basicFactsAudience);
  const basicFactLeads = reportBasicFactLeads(f, basicFactsAudience, publicationBasicFacts);
  const fundingEvidence = summarizeFundingEvidence(
    publicationBasicFacts,
    f.protocolFunding?.rounds ?? [],
  );
  const acceptedFundingFacts = publicationBasicFacts.filter((fact) =>
    canonicalBasicFactPredicate(fact.predicate) === "funding"
    && (fact.status === "verified" || fact.status === "corroborated"));
  const firstFundingFact = acceptedFundingFacts[0];
  const consolidatedFundingFact: BasicFactView | null = firstFundingFact
    && fundingEvidence.independentRoundCount > 0
    && fundingEvidence.totalKnownUsd > 0
    ? {
        ...firstFundingFact,
        value: `≥${usdCompact(fundingEvidence.totalKnownUsd)} across ${fundingEvidence.rounds.length} evidenced funding round${fundingEvidence.rounds.length === 1 ? "" : "s"}`,
        normalizedValue: `at least ${fundingEvidence.totalKnownUsd} documented funding`,
        qualifier: "documented lower bound",
        status: fundingEvidence.independentSourceCount >= 2 ? "corroborated" : firstFundingFact.status,
        providerProjection: false,
        sources: [...new Map(acceptedFundingFacts
          .flatMap((fact) => fact.sources ?? [])
          .filter((source) => source.provider !== "defillama" && source.provider !== "monid")
          .map((source) => [source.url ?? `${source.provider}:${source.title}`, source])).values()],
      }
    : null;
  const basicFacts = consolidatedFundingFact
    ? publicationBasicFacts.filter((fact) =>
      canonicalBasicFactPredicate(fact.predicate) !== "funding"
      || fact === firstFundingFact)
      .map((fact) => fact === firstFundingFact ? consolidatedFundingFact : fact)
    : publicationBasicFacts;
  const openingSubjectSummary = roles.includes(SubjectClass.PROJECT)
    ? reportOpeningNarrative({
        name: f.display_name || f.handle,
        handle: f.handle,
        bio: f.bio,
        ...(f.website ? { website: f.website } : {}),
        ...(f.subjectOrientation ? { subjectOrientation: f.subjectOrientation } : {}),
        ...(basicFacts.length ? { basicFacts } : {}),
        ...(f.projectToken ? { projectToken: f.projectToken } : {}),
      })
    : f.subjectOrientation?.what || f.bio;
  const basicFactResearchAttempted = basicFacts.length > 0
    || basicFactLeads.length > 0
    || (f.basicFactQuestionLedger?.length ?? 0) > 0;
  const fillDecisionFacts = basicFactsAudience !== "person" && basicFactResearchAttempted;
  const showBasicFacts = basicFactResearchAttempted;
  const governingRoleReport = report.role_reports.find((rr) => rr.role === report.governing_role)
    ?? report.role_reports[0];
  const governingAxes = Object.entries(governingRoleReport?.axes ?? {});
  const compositionRows = governingAxes.map(([axis, a]) => ({
    axis,
    label: diligenceAreaLabel(axis),
    score: a.score,
    weight: a.weight,
    rationale: a.rationale,
    supportCount: a.evidenceRefs?.length,
    counterCount: a.counterEvidenceRefs?.length,
    questionCount: a.gaps?.length,
    evidenceHref: f.projectStrengthBands ? `#dimension-${axis}` as const : undefined,
  }));
  const linkedTokenDossier = f.threat?.dossier;
  const linkedTokenCompositionRows = linkedTokenDossier
    ? orderByPlainAxis(linkedTokenDossier.axes.map((tokenAxis) => ({
      axis: tokenAxis.key,
      label: plainAxisLabel(tokenAxis.key, tokenAxis.label),
      score: tokenAxis.score,
      weight: tokenAxis.weight,
      rationale: tokenAxis.rationale,
      evidenceHref: "#project-token-threat" as const,
    })))
    : [];
  const linkedTokenScore = linkedTokenDossier || f.projectToken
    ? {
      label: "Token safety score",
      score: linkedTokenDossier?.score ?? null,
      verdictLabel: linkedTokenDossier?.verdict ?? "Not measured",
      context: "Contract, tradeability, liquidity, holders, market data and sanctions.",
      composition: linkedTokenCompositionRows,
      unavailableCopy: f.threatNote
        ?? "A project token is linked, but this saved project report does not contain a completed token-safety score.",
    }
    : undefined;
  const governingSubjectClass = report.governing_role
    && Object.values(SubjectClass).includes(report.governing_role as SubjectClass)
    ? report.governing_role as SubjectClass
    : null;
  const expectedGoverningAxes = governingSubjectClass
    ? Object.keys(getProfile(governingSubjectClass).axes)
    : [];
  const scoredGoverningAxisIds = new Set(governingAxes.map(([axis]) => axis));
  const unmeasuredGoverningAxes = expectedGoverningAxes
    .filter((axis) => !scoredGoverningAxisIds.has(axis));
  const partialAxisAssessment = governingAxes.length > 0 && unmeasuredGoverningAxes.length > 0;
  // The compact founder summary is derived only from structured venture
  // outcomes/backer arrays. When those arrays contain active ventures but no
  // completed outcomes, the engine returns "Unproven" / "none" even if the
  // cited founder axis documents a major operating outcome. Do not render that
  // empty structured summary as if it contradicted the cited decision basis.
  const displayFounderSummary = founderSummary
    && (
      founderSummary.repeat_backing.repeat_backers.length > 0
      || !["FirstVenture", "Unproven"].includes(founderSummary.pattern)
    )
    ? founderSummary
    : null;
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
  const versionContext = f.versionContext ?? f.viewVersionContext;
  const identity = reportIdentity({ caseId: versionContext?.caseId, auditId: report.audit_id });
  const caseLabel = identity.caseLabel;
  const slashLabel = caseLabel ?? identity.reportId;
  const frozenDiligenceChecks = versionContext?.checks ?? f.checkRuns ?? [];
  const identityResolutionCheck = frozenDiligenceChecks.find((check) => check.checkId === "identity-resolution");
  const fullResolvedName = (f.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2;
  // Older frozen reports sometimes retained "Probable" even after the same
  // snapshot recorded a licensed full-name resolution plus another independent
  // identity source. Correct only that exact, source-counted contradiction at
  // presentation time. Never infer or invent a name from weaker evidence.
  const displayIdentityConfidence = report.identity_confidence === "Probable"
    && identityResolutionCheck?.status === "confirmed"
    && (identityResolutionCheck.sourceCount ?? 0) >= 2
    && /peopledatalabs/i.test(identityResolutionCheck.provider ?? "")
    && /licensed identity record resolved to\b/i.test(identityResolutionCheck.note ?? "")
    && fullResolvedName
    ? "Confirmed"
    : report.identity_confidence;
  const derivedDiligenceChecks = personChecks({
    identityConfidence: displayIdentityConfidence ?? undefined,
    realName: fullResolvedName,
    roles,
    hasAssociates: (evidence.associates?.length ?? 0) > 0,
  });
  const diligenceChecks = applyReportCheckContract("person", versionContext
    ? versionContext.checks
    : f.checkRuns?.length
      ? f.checkRuns
      : derivedDiligenceChecks);
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
  const canApplyCurrentCompletionContract = hasExplicitReportCheckContract("person", versionContext
    ? versionContext.checks
    : f.checkRuns?.length
      ? f.checkRuns
      : derivedDiligenceChecks);
  const presentationCompleteness = coverageQualifiedCompleteness({
    completeness: recordedCompleteness === "failed"
      ? "failed"
      : readiness.status === "ready" && canApplyCurrentCompletionContract
        ? "complete"
        : recordedCompleteness ?? "partial",
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
  const readinessTitle = legacyCoverageNotCaptured ? "Older report: check details unavailable" : readiness.title;
  const readinessGuidance = legacyCoverageNotCaptured
    ? "This report was saved before ARGUS recorded every check separately. The old score is kept for history, but it does not prove that every current check ran."
    : readiness.guidance;
  const presentedVerdict = presentation.displayVerdict === "UNVERIFIABLE"
    ? "UNVERIFIABLE_IDENTITY"
    : presentation.displayVerdict;
  const prioritizeDecisionIntelligence = Boolean(f.intelligence && (
    f.intelligence.rulesetVersion === "argus-entity-point-in-time-v1"
    || (
      f.intelligence.subject.forms.some((form) => form.form === "company")
      && !f.intelligence.subject.forms.some((form) => form.form === "token" || form.form === "protocol")
    )
  ));
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
  const canShare = !embeddedFacet && !shareView && Boolean(
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
  // The sweep writes subject-scoped and related-entity rows into one array, and
  // every row is emitted as an unverified model lead. Split them: an adverse
  // lead that names the SUBJECT is why a favorable report may not print an
  // all-clear, while a lead about an associate is background reading.
  const subjectLeads = investigativeLeads.filter((lead) =>
    leadRelationshipLabel(lead, report.handle) === SUBJECT_LEAD_RELATIONSHIP);
  const relatedEntityLeads = investigativeLeads.filter((lead) =>
    leadRelationshipLabel(lead, report.handle) !== SUBJECT_LEAD_RELATIONSHIP);
  const subjectAdverseLeads = subjectLeads.filter((lead) => lead.polarity < 0);
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
  const unresolvedCheckNames = unresolvedChecks.slice(0, 3).map((check) => publicCheckLabel(check.label));
  const unresolvedCheckRemainder = Math.max(0, unresolvedChecks.length - unresolvedCheckNames.length);
  const noCleanScreenCopy = unresolvedChecks.length > 0
    ? `${unresolvedChecks.length} decision-critical ${unresolvedChecks.length === 1 ? "check remains" : "checks remain"} open or unrecorded: ${unresolvedCheckNames.join(", ")}${unresolvedCheckRemainder > 0 ? `, and ${unresolvedCheckRemainder} more` : ""}. No completed clean screen is recorded, so this report does not support an all-clear.`
    : "No completed clean screen is recorded, so this report does not support an all-clear.";
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
  const intelligenceBrief = f.intelligence
    ? deriveIntelligenceBrief(f.intelligence, decisionLensId)
    : { supports: [], pressures: [], context: [], questions: [] };

  const axisSupportNarrative: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows
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
      const conciseRationale = plainLanguageSummary(axis.rationale);
      const firstSentence = conciseRationale.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? conciseRationale;
      const summary = firstSentence.length > 220
        ? `${firstSentence.slice(0, 217).trimEnd()}…`
        : firstSentence;
      return {
        id: `support-${axis.axis}`,
        title: diligenceAreaLabel(axis.axis),
        detail: summary,
        meta: `${strength} · ${axis.support.length} ${axis.support.length === 1 ? "source" : "sources"}`,
        href: axisHref(axis.axis),
      };
    });
  const intelligenceSupportNarrative: ReportCanvasNarrativeItem[] = intelligenceBrief.supports.map((item) => ({
    id: item.id,
    title: plainLanguageSummary(item.title),
    detail: plainLanguageSummary(item.detail),
    provenance: item.provenance,
    href: "#decision-intelligence" as `#${string}`,
  }));
  const supportNarrative: ReportCanvasNarrativeItem[] = [
    ...axisSupportNarrative,
    ...intelligenceSupportNarrative,
  ].filter((item, index, items) => items.findIndex((candidate) =>
    candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, " ")
      === item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ")) === index).slice(0, 6);
  const intelligenceContextNarrative: ReportCanvasNarrativeItem[] = intelligenceBrief.context.map((item) => ({
    id: item.id,
    title: plainLanguageSummary(item.title),
    detail: plainLanguageSummary(item.detail),
    provenance: item.provenance,
    href: "#decision-intelligence" as `#${string}`,
  }));

  // Real countervailing signals only: hard caps, coverage shortfalls,
  // contradictions, and mixed evidence. Collection gaps are NOT thesis risks;
  // they live once, in the verification list, and are summarized here through
  // a single aggregate row so a favorable report can never render an
  // all-clear while questions remain open.
  const confidenceLimitsBase: ReportCanvasNarrativeItem[] = [
    ...(report.cap_applied ? [{
      id: "hard-cap",
      title: `The score is limited because of: ${capLabel(report.cap_applied)}.`,
      detail: "A serious finding can limit the score even when other areas look strong.",
      provenance: "Scoring rule",
      href: "#role-breakdown" as `#${string}`,
    }] : []),
    // Coverage bookkeeping ("N of M checks recorded, treat as provisional")
    // deliberately does NOT render here: it lives in the verdict header chip
    // and the methodology rail. A verdict section leads with findings about
    // the subject, never with our own process status.
    ...visibleContradictions.slice(0, 2).map((contradiction, index) => ({
      id: `contradiction-${index}`,
      title: plainLanguageSummary(contradiction.claim),
      detail: plainLanguageSummary(contradiction.conflict),
      provenance: `${contradiction.severity} importance · ${contradiction.confidence} confidence`,
      href: "#contradictions" as `#${string}`,
    })),
    ...intelligenceBrief.pressures.map((item) => ({
      id: item.id,
      title: plainLanguageSummary(item.title),
      detail: plainLanguageSummary(item.detail),
      provenance: item.provenance,
      href: "#decision-intelligence" as `#${string}`,
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
      const title = bandTierFor(axis.axis) === "assessed_null"
        ? (ASSESSED_NULL_RISK_TITLES[axis.axis] ?? `${diligenceAreaLabel(axis.axis)} was assessed with no positive record.`)
        : publicConcernTitle({
          axis: axis.axis,
          axisLabel: diligenceAreaLabel(axis.axis),
          gap: axis.gaps[0],
        });
      return {
        id: `low-axis-${axis.axis}`,
        title,
        detail: plainLanguageSummary(axis.rationale),
        provenance: `Limited source support${questionMeta(questions)}`,
        href: axisHref(axis.axis),
      };
    });

  const notApplicableCheckIds = new Set(diligenceChecks
    .filter((check) => check.status === "not-applicable")
    .map((check) => check.checkId)
    .filter((checkId): checkId is string => Boolean(checkId)));
  const axisGapArtifactQuestions: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows.flatMap((axis) =>
    axis.gapArtifacts
      // Older cited catalogs could retain an "unavailable" artifact even
      // after the frozen checklist marked the same operation not applicable.
      // It is auditable lineage, but it is not an investor follow-up.
      .filter((artifact) => !notApplicableCheckIds.has(artifact.operation.replace(/^checkOutcomes:/, "")))
      .map((artifact, index) => ({
        id: `verify-axis-artifact-${axis.axis}-${index}`,
        title: publicFindingTitle(artifact.title),
        detail: publicIntelligenceText(artifact.excerpt || `Source coverage is incomplete for ${diligenceAreaLabel(axis.axis).toLowerCase()}.`),
        provenance: "Source unavailable",
        href: axisHref(axis.axis),
      })));
  const axisGapQuestions: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows.flatMap((axis) =>
    axis.gaps.map((gap, index) => ({
      id: `verify-axis-${axis.axis}-${index}`,
      title: plainLanguageSummary(gap),
      detail: "Worth confirming before you invest.",
      provenance: "Not yet confirmed",
      href: axisHref(axis.axis),
    })));
  const decisionBasicFactQuestions = reportBasicFactQuestionsFor(
    basicFactsAudience,
    f.basicFactQuestionLedger ?? [],
  );
  const resolvedBasicFactPredicates = new Set([
    ...basicFacts
      .filter((fact) => fact.status === "verified" || fact.status === "corroborated" || fact.status === "not_applicable")
      .map((fact) => canonicalBasicFactPredicate(fact.predicate)),
    ...(f.basicFactQuestionLedger ?? [])
      .filter((entry) => basicFactQuestionOutcome(entry) === "answered"
        || (supportsExplicitEmptyBasicFact(entry.predicate)
          && basicFactQuestionOutcome(entry) === "checked_empty"))
      .map((entry) => canonicalBasicFactPredicate(entry.predicate)),
  ]);
  const conflictedBasicFactPredicates = new Set(basicFacts
    .filter((fact) => fact.status === "conflicted" || fact.status === "unresolved")
    .map((fact) => canonicalBasicFactPredicate(fact.predicate)));
  const buildBasicFactQuestion = (
    [predicate, question]: readonly [predicate: string, question: string],
    conflicted: boolean,
  ): ReportCanvasNarrativeItem => ({
    id: `verify-basic-${predicate}`,
    title: question,
    detail: conflicted
      ? "Sources disagree on the answer. Read both before relying on either."
      : "Not answered by any source we checked.",
    provenance: conflicted ? "Sources disagree" : "Decision fact still open",
    href: "#basic-facts" as `#${string}`,
  });
  const conflictedBasicFactQuestions: ReportCanvasNarrativeItem[] = fillDecisionFacts
    ? decisionBasicFactQuestions
      .filter(([predicate]) => conflictedBasicFactPredicates.has(predicate))
      .map((definition) => buildBasicFactQuestion(definition, true))
    : [];
  const openBasicFactQuestions: ReportCanvasNarrativeItem[] = fillDecisionFacts
    ? decisionBasicFactQuestions
      .filter(([predicate]) => !resolvedBasicFactPredicates.has(predicate) && !conflictedBasicFactPredicates.has(predicate))
      .map((definition) => buildBasicFactQuestion(definition, false))
    : [];
  const checkVerificationQuestions: ReportCanvasNarrativeItem[] = investorOpenChecks.map((check, index) => ({
    id: `verify-${check.checkId ?? index}`,
    title: publicCheckLabel(check.label),
    detail: publicCheckNote(check.note),
    provenance: "Not fully checked",
    href: "#scan-methodology" as `#${string}`,
  }));
  // A bio that claims its own token ("Powered by $X") on a scan that could
  // not score or bind it deserves a directed next step in the subject's own
  // language, not an axis id.
  const claimedUnboundTicker = !f.projectToken
    && (routingUnresolved || scoringOutputIncomplete || report.composite_verdict === "INCOMPLETE")
    ? claimedTicker(f.bio)
    : null;
  // Ranked by decision impact: gating problems, then facts where sources
  // disagree, then unresolved decision checks, then unanswered facts, then
  // source gaps, then generic collection gaps. Dedupe keeps the first
  // occurrence, so assembly order IS the ranking.
  const allVerificationQuestions: ReportCanvasNarrativeItem[] = [
    ...(routingUnresolved ? [{
      id: "verify-subject-routing",
      title: "Resolve whether this account represents a project, organization, token, or person",
      detail: "ARGUS could not confirm a role to score. Confirm the official website relationship, then run the matching project and token checks.",
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
    ...(claimedUnboundTicker ? [{
      id: "verify-claimed-token",
      title: `Run the token scan for $${claimedUnboundTicker}`,
      detail: `The profile claims a token ($${claimedUnboundTicker}) this scan could not bind to an official site. The token scan checks the contract, market, holders, and liquidity directly.`,
      provenance: "Claimed token unbound",
      href: "#report-overview" as `#${string}`,
    }] : []),
    ...conflictedBasicFactQuestions,
    ...intelligenceBrief.questions
      .filter((item) => !(f.projectToken?.verified && isOfficialTokenQuestion(item)))
      .map((item) => ({
      id: item.id,
      title: plainLanguageSummary(item.title),
      detail: plainLanguageSummary(item.detail),
      provenance: item.provenance,
      href: "#decision-intelligence" as `#${string}`,
      })),
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
      const firstGap = publicIntelligenceText(axis.gaps[0] ?? "");
      return {
        id: `points-${axis.axis}`,
        title: `${diligenceAreaLabel(axis.axis)}: ${open} of ${axis.weight} points open`,
        detail: firstGap
          ? sentence(firstGap)
          : "The follow-up questions for this area are listed below.",
        provenance: tier
          ? `${publicStrengthLabel(tier)} · scored ${axis.score}/${axis.weight}`
          : `scored ${axis.score}/${axis.weight}`,
        href: axisHref(axis.axis),
      };
    });
  // Investigator rail: deterministic anomalies from the frozen stats, so the
  // few numbers that change a decision stop hiding inside stat grids.
  const noticedSignals = deriveNoticedSignals({
    lpLockedPct: f.holderProfile?.lpLockedOrBurnedPct,
    largestHolderPct: f.holderProfile?.topHolderPct,
    top10HolderPct: f.holderProfile?.top10Pct,
    assessedWalletCount: f.holderProfile?.assessedWalletCount,
    top10HolderPctIsFloor: f.holderProfile?.top10PctIsFloor,
    circulatingPct: (() => {
      const circulating = f.projectToken?.circulatingSupply;
      const denominator = f.projectToken?.maxSupply ?? f.projectToken?.totalSupply;
      return circulating != null && denominator != null && denominator > 0
        ? (circulating / denominator) * 100
        : null;
    })(),
    fdvUsd: f.projectToken?.fdvUsd,
    marketCapUsd: f.projectToken?.marketCapUsd,
    volume24hUsd: f.projectToken?.volume24hUsd,
    nextUnlock: f.tokenUnlocks
      ? { date: f.tokenUnlocks.nextUnlockDate, amountUsd: f.tokenUnlocks.unlockValueUsd, pctSupply: f.tokenUnlocks.percentOfSupply }
      : null,
    tvlChange30dPct: f.protocolTvl?.change30dPct,
    feesChange30dPct: f.protocolFees?.change30dOver30dPct,
    athDrawdownPct: f.projectToken?.ath?.drawdownPct,
    accountSuspended: f.x_account_status === "suspended",
    daysSinceLastPost: f.days_since_post,
    verifiedTeamCount: f.projectToken ? webTeam.length : null,
    namedTeamCount: webTeam.length + webTeamLeads.length,
    anchors: { market: "#project-token", team: "#identity-evidence", account: "#report-overview" },
  });
  const decisionDiscovery = deriveDecisionDiscovery(noticedSignals);
  const materialChangeDiscovery = materialDeltaDiscovery(
    f.reportDelta,
    f.versionContext?.reportVersionId
      ?? f.viewVersionContext?.reportVersionId
      ?? (f.persistence?.state === "persisted" ? f.persistence.reportVersionId : null),
  );
  const controlPathDiscovery = buildPublicControlPathDiscovery([f.graph], "#relationships");
  const claimConflictDiscovery = buildPublicClaimConflictDiscovery(f.basicFacts ?? [], "#basic-facts");
  // One paste, whole verdict: composed for group chats and IC memos alike.
  // The link is appended at copy time (share link when mintable, app URL else).
  const tldrBase = [
    `ARGUS · ${f.display_name || f.handle} · ${presentedVerdict} ${report.governing_score ?? "N/A"}/100`,
    plainLanguageSummary(f.headline),
    remainingPointsItems[0] ? `Top open item: ${remainingPointsItems[0].title}.` : "",
  ].filter(Boolean).join("\n");
  const confidenceLimits: ReportCanvasNarrativeItem[] = confidenceLimitsBase.slice(0, 6);
  const adverseVerdictNarrative = [...confidenceLimits, ...lowAxisDrivers]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 6);
  // An unverified lead is not a finding: it never enters the findings ledger and
  // it never moves the score. What it does do is stop the risk section from
  // saying "no adverse findings" while the same page carries an accusation
  // about the subject. Uncorroborated is not the same as untrue, and it is
  // certainly not clean, so the count and the claims are stated here instead.
  const oneSubjectLead = subjectAdverseLeads.length === 1;
  const subjectLeadSummary = subjectAdverseLeads.length === 0
    ? ""
    : `${subjectAdverseLeads.length} unverified adverse ${oneSubjectLead ? "lead names" : "leads name"} ${report.handle} directly. ${
      // "No source ARGUS could check", not "no source". This scan reached the
      // sources it reached; a flat absence claim would assert a search nobody
      // ran, which is the same overreach the lead itself is being held to.
      subjectAdverseLeads.every((lead) => !leadArtifactConfirmed(lead))
        ? `No source ARGUS could check corroborated ${oneSubjectLead ? "it" : "them"}, so ${oneSubjectLead ? "it is" : "they are"} not recorded as ${oneSubjectLead ? "a finding" : "findings"} and ${oneSubjectLead ? "does" : "do"} not change the score.`
        : `${oneSubjectLead ? "It is" : "They are"} not recorded as ${oneSubjectLead ? "a finding" : "findings"} about ${report.handle} and ${oneSubjectLead ? "does" : "do"} not change the score.`
    }`;
  const subjectLeadNarrative: ReportCanvasNarrativeItem[] = subjectAdverseLeads.slice(0, 4).map((lead, index) => ({
    id: `subject-lead-${index}`,
    title: plainLanguageSummary(lead.claim),
    detail: leadArtifactConfirmed(lead)
      ? `The artifact is confirmed about the entity it names, but it is not recorded as a finding about ${report.handle}.`
      : "No source ARGUS could check corroborated this lead.",
    provenance: "Unverified lead · not scored",
    href: "#subject-leads" as `#${string}`,
  }));
  const verdictNarrative = favorableVerdict ? supportNarrative : adverseVerdictNarrative;
  const countervailingNarrative = favorableVerdict
    ? [...confidenceLimits, ...subjectLeadNarrative]
    : supportNarrative;
  const caseArgument = deriveVerdictArgument({
    verdict: presentedVerdict,
    supports: [
      ...intelligenceBrief.supports.map((item) => item.title),
      ...axisSupportNarrative.map((item) => item.title),
    ],
    concerns: [
      ...confidenceLimitsBase,
      ...lowAxisDrivers,
    ].map((item) => item.title),
    capReason: report.cap_applied
      ? `The score is limited because of: ${capLabel(report.cap_applied)}`
      : null,
    nextChecks: verificationNext.map((item) => item.title),
  });
  const toDecisionCanvasItems = (items: readonly ReportCanvasNarrativeItem[]): DecisionCanvasItem[] =>
    items.map((item) => ({ label: item.title, ...(item.detail ? { detail: item.detail } : {}) }));
  const unresolvedRequiredNextSteps: ReportCanvasNarrativeItem[] = unresolvedChecks.map((check, index) => ({
    id: `required-check-${check.checkId || index}`,
    title: publicCheckLabel(check.label),
    detail: publicCheckNote(check.note || (
      check.status === "stale"
        ? "The saved result is out of date. Run this check again."
        : check.retryable === false
          ? "ARGUS does not currently have a supported source that can finish this check."
          : "This required check did not finish. A rescan may complete it."
    )),
    href: "#scan-methodology" as `#${string}`,
  }));
  const decisionCanvasSupports = toDecisionCanvasItems(supportNarrative);
  const decisionCanvasConcerns = toDecisionCanvasItems(
    [...confidenceLimits, ...lowAxisDrivers, ...subjectLeadNarrative]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 8),
  );
  const decisionCanvasContext = toDecisionCanvasItems(intelligenceContextNarrative);
  const decisionCanvasNextSteps = toDecisionCanvasItems(
    [...unresolvedRequiredNextSteps, ...verificationNext]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title) === index)
      .slice(0, 6),
  );
  const decisionCanvasVerified = decisionCriticalChecks(diligenceChecks)
    .filter((check) => check.status === "confirmed"
      || check.status === "reported"
      || check.status === "finding"
      || check.status === "checked-empty")
    .map((check) => ({ label: publicCheckLabel(check.label), ...(check.note ? { detail: publicCheckNote(check.note) } : {}) }));

  const unscoredIntelNarrative: ReportCanvasNarrativeItem[] = [
    ...(f.projectToken ? [{
      id: "intel-project-token",
      title: `$${f.projectToken.symbol} is the verified project token.`,
      detail: [
        f.projectToken.rank != null ? `Market rank #${f.projectToken.rank}` : null,
        f.projectToken.marketCapUsd != null ? `market cap ${usdCompact(f.projectToken.marketCapUsd)}` : null,
        f.projectToken.chain,
      ].filter(Boolean).join(" · "),
      provenance: `Official token · confirmed through ${f.projectToken.verification === "official_x" ? "official X" : "official website"}`,
      href: "#project-token" as `#${string}`,
    }] : []),
    ...(f.sourceArtifacts ?? []).map((artifact, index) => ({
      id: `intel-artifact-${artifact.contentHash || index}`,
      title: publicFindingTitle(artifact.title),
      detail: publicIntelligenceText(artifact.excerpt),
      provenance: artifact.match.replace(/_/g, " "),
      href: "#evidence-ledger" as `#${string}`,
    })),
    ...publishableSubjectFindings.map((finding, index) => ({
      id: `intel-finding-${index}`,
      title: finding.claim,
      detail: `${finding.verification_status} finding with ${finding.independent_source_count} recorded source${finding.independent_source_count === 1 ? "" : "s"}.`,
      provenance: routingUnresolved
        ? "Verified finding · not scored until ARGUS confirms the report type"
        : "Verified finding · not scored because the scoring step did not finish",
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
    ...(providerCapturedLabel ? [{ id: "provider-captured", label: `Sources checked ${providerCapturedLabel}`, meta: `${f.providerSnapshot?.runs.length ?? 0} outside source checks recorded` }] : []),
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
  const uniqueCounterSignalCount = new Set(
    decisionBasisSummary.rows.flatMap((axis) => axis.counter.map((artifact) => artifact.artifactId)),
  ).size;
  const conflictSignalCount = Math.max(visibleContradictions.length, uniqueCounterSignalCount)
    + basicFacts.filter((fact) => fact.status === "conflicted").length;
  const relationshipRecordCount = connections.length + webTeam.length + (evidence.associates?.length ?? 0);
  const argusEdgeMetrics = [
    ...(basicFactResearchAttempted
      ? [{ label: "Confirmed facts", value: verifiedDecisionFactCount, detail: "answers with sources" }]
      : []),
    { label: "Sources used", value: citedDecisionSourceKeys.size, detail: "used in the score" },
    { label: "Sources that disagree", value: conflictSignalCount, detail: "shown in this report" },
    { label: "Known links", value: relationshipRecordCount, detail: "people and project links" },
    { label: "Still to check", value: decisionQuestionCount, detail: "important open questions" },
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
    const ic = displayIdentityConfidence;
    heroProofChips.push(
      ic === "SuspectedImpersonation"
        ? { key: "identity", label: "Impersonation suspected", tone: "avoid", href: "#identity-evidence", title: "Identity screen flagged suspected impersonation. Review before anything else." }
        : ic === "Confirmed"
          ? { key: "identity", label: "Identity verified", tone: "pass", href: "#identity-evidence", title: findCheck("identity-resolution")?.note ?? "Official identity resolved and confirmed." }
          : ic === "Probable"
            ? { key: "identity", label: "Identity link found", tone: "caution", href: "#identity-evidence", title: "ARGUS found a public identity link, but it is not independently confirmed." }
            : organizationAccount
              ? { key: "identity", label: "Organization unverified", tone: "caution", href: "#identity-evidence", title: "The public brand account was identified, but its legal entity and operators were not confirmed." }
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
            ? organizationAccount
              ? { key: "sanctions", label: "Person sanctions n/a", tone: "neutral", href: "#identity-evidence", title: "This is an organization account. Person-name screening requires verified operator names; entity screening requires a verified legal entity." }
              : { key: "sanctions", label: "Sanctions n/a", tone: "neutral", href: "#identity-evidence", title: sanctionsCheck.note ?? "The sanctions screen needs a resolved real name." }
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
      heroProofChips.push({ key: "audits", label: "No audit on record", tone: "caution", href: "#verification-next", title: "No security audit could be verified for this project. This is a finding about the project, not a scan error; the audit search did not fully finish, so a rescan may still surface one." });
    } else if (auditQuestion) {
      heroProofChips.push({ key: "audits", label: "No audit published", tone: "caution", href: "#basic-facts", title: "A completed search found no independent security audit for this project." });
    }
  }
  {
    const tokenQuestion = heroLedgerEntry("official_token");
    const tokenClaimObserved = Boolean(
      f.projectToken
      || basicFacts.some((fact) => canonicalBasicFactPredicate(fact.predicate) === "official_token"),
    );
    const tokenAbsenceIsMaterial = tokenClaimObserved || roles.some((role) =>
      role === SubjectClass.PROJECT
      || role === SubjectClass.FOUNDER
      || role === SubjectClass.KOL);
    if (f.projectToken) {
      heroProofChips.push({ key: "token", label: "Token verified", value: `$${f.projectToken.symbol}`, tone: "pass", href: "#project-token", title: `Confirmed through ${f.projectToken.verification === "official_x" ? "the official X account" : "the official website"}, not just the token name.` });
    } else if (tokenQuestion && tokenAbsenceIsMaterial && basicFactQuestionOutcome(tokenQuestion) === "checked_empty") {
      heroProofChips.push({ key: "token", label: "No official token", tone: "neutral", href: "#basic-facts", title: "A completed search found no verified official token." });
    } else if (tokenQuestion && tokenClaimObserved) {
      const claimedSymbol = claimedTicker(f.bio);
      heroProofChips.push({
        key: "token",
        label: "Token claim unproven",
        ...(claimedSymbol ? { value: `$${claimedSymbol}` } : {}),
        tone: "caution",
        href: "#verification-next",
        title: `This account claims a token${claimedSymbol ? ` ($${claimedSymbol})` : ""} that no official site or registry record links to it. Anything sold under that name is unproven; this is the core scam vector, so verify before capital moves.`,
      });
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
        ? { key: "coverage", label: "Checks", value: `${readiness.successful}/${readiness.applicable}`, tone: "pass", href: "#scan-methodology", title: `${readiness.coveragePercent}% of required checks finished.` }
        : { key: "coverage", label: `${readiness.coveragePercent}% checked`, value: `${readiness.successful}/${readiness.applicable}`, tone: "caution", href: "#scan-methodology", title: readinessGuidance },
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
    ...(fundingEvidence.totalKnownUsd > 0 ? [{
      key: "raised",
      label: fundingEvidence.independentRoundCount > 0 ? "Confirmed funding" : "Funding record",
      value: `${fundingEvidence.independentRoundCount > 0 ? "≥" : ""}${usdCompact(fundingEvidence.totalKnownUsd)}`,
      sub: fundingEvidence.independentRoundCount > 0
        ? `${fundingEvidence.rounds.length} sourced round${fundingEvidence.rounds.length === 1 ? "" : "s"} · minimum known total`
        : `${fundingEvidence.rounds.length} reported round${fundingEvidence.rounds.length === 1 ? "" : "s"} · third-party database`,
    }] : []),
    ...(f.projectToken?.deployedChains?.length ? [{
      key: "chains",
      label: "Chains",
      value: String(f.projectToken.deployedChains.length),
      sub: "Matched through CoinGecko",
    }] : []),
  ];
  const reportNavItems: ReportCanvasNavItem[] = [
    { href: "#report-summary", label: "Decision", icon: <FileText aria-hidden="true" size={15} weight="bold" /> },
    ...(presentation.primaryScore && governingAxes.length > 0 ? [{ href: "#composition" as const, label: "Score", icon: <ListChecks aria-hidden="true" size={15} weight="bold" /> }] : []),
    ...(roles.includes(SubjectClass.PROJECT)
      ? [{ href: "#dossier-product" as const, label: "Product", icon: <Briefcase aria-hidden="true" size={15} weight="bold" /> }]
      : [{ href: "#dossier" as const, label: "Summary", icon: <Briefcase aria-hidden="true" size={15} weight="bold" /> }]),
    { href: "#identity-evidence", label: "People", icon: <Fingerprint aria-hidden="true" size={15} weight="bold" /> },
    ...(f.projectToken ? [{ href: "#project-token" as const, label: "Market", icon: <Cube aria-hidden="true" size={15} weight="bold" /> }] : []),
    ...(f.socialActivity && roles.includes(SubjectClass.PROJECT) ? [{ href: "#social-activity" as const, label: "Social", icon: <Megaphone aria-hidden="true" size={15} weight="bold" /> }] : []),
    { href: "#relationships", label: "Connections", icon: <GraphIcon aria-hidden="true" size={15} weight="bold" />, count: connections.length },
    ...(f.evmControlReality ? [{ href: "#evm-control-surface" as const, label: "Control surface", icon: <Fingerprint aria-hidden="true" size={15} weight="bold" /> }] : []),
    { href: "#evidence-ledger", label: "Evidence & method", icon: <Database aria-hidden="true" size={15} weight="bold" />, count: visibleIntelligenceCount },
    ...(!shareView ? [{ href: "#ask-report" as const, label: "Challenge", icon: <MagnifyingGlassPlus aria-hidden="true" size={15} weight="bold" /> }] : []),
  ];

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-72" />

      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-void/85 backdrop-blur">
        <div className="report-frame flex flex-nowrap items-center gap-2 py-2.5 sm:py-3">
          <button type="button" onClick={onReset} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[13.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink sm:min-w-0 sm:justify-start">
            <ArrowLeft aria-hidden="true" size={15} weight="bold" />
            <span className="max-sm:sr-only">New investigation</span>
          </button>
          {slashLabel && (
            <span className="mono hidden text-[11px] text-ink-faint md:inline" aria-label={caseLabel ? `Case ${caseLabel}` : `Report ${slashLabel}`}>
              / {slashLabel}
            </span>
          )}
          {immutableReviewHref ? (
            <a
              className="chip tint-signal"
              href={immutableReviewHref}
              target="_blank"
              rel="noreferrer"
              title="Open the exact saved report. New checks shown later do not change its score."
            >
              SAVED REPORT
            </a>
          ) : (
            <span
              className={`chip ${!versionContext && f.live ? "tint-signal" : ""}`}
              title={versionContext ? `Saved report version ${versionContext.version}` : f.live ? "Collected in a new scan" : "Saved example report"}
            >
              {versionContext ? `VERSION ${versionContext.version}` : f.live ? "● LIVE SCAN" : "CURATED"}
            </span>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {onOpenBrief && (
              <button
                type="button"
                onClick={onOpenBrief}
                title="Open the analyst decision brief anchored to this exact person case"
                className="btn-primary btn-brand min-h-11 shrink-0 gap-1.5 px-3 text-[12.5px] font-medium"
              >
                <Briefcase aria-hidden="true" size={14} weight="bold" />
                Case brief
              </button>
            )}
            <div className="hidden items-center gap-2 sm:flex">
            {onRescan && (
              <button type="button" onClick={onRescan} title="Run this audit again, fresh" className="btn-chip tint-signal min-h-11 gap-1.5 px-3">
                <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                Rescan
              </button>
            )}
            <ExportMenu dossier={dossier} />
            {canShare && (
              <button
                type="button"
                onClick={() => void share()}
                disabled={shareState === "creating"}
                aria-live="polite"
                title={shareState === "error" ? "Share link could not be created or copied. Try again." : "Copy a report link that works for 30 days"}
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
            </div>
            {canArchive && (
              <details className="relative hidden sm:block">
                <summary aria-label="More report actions" className="btn-secondary min-h-11 list-none cursor-pointer gap-1.5 px-3 text-[12.5px] [&::-webkit-details-marker]:hidden">
                  <DotsThree aria-hidden="true" size={17} weight="bold" />
                  More
                </summary>
                <div className="panel absolute right-0 top-full z-30 mt-1.5 w-56 p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => void archive()}
                    disabled={archiveState === "archiving"}
                    title="Remove this case from active work while keeping its saved report and history"
                    className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] text-ink-dim transition hover:bg-signal/10 hover:text-signal-lift disabled:cursor-wait disabled:opacity-60"
                  >
                    {archiveState === "archiving" ? "Archiving case…" : archiveState === "error" ? "Archive failed · retry" : "Archive case"}
                  </button>
                </div>
              </details>
            )}
            <details className="relative sm:hidden">
              <summary aria-label="More report actions" className="btn-secondary min-h-11 min-w-11 list-none cursor-pointer justify-center px-2.5 [&::-webkit-details-marker]:hidden">
                <DotsThree aria-hidden="true" size={17} weight="bold" />
                <span className="sr-only">More report actions</span>
              </summary>
              <div className="panel absolute right-0 top-full z-30 mt-1.5 w-56 p-1.5 shadow-xl">
                {onRescan && (
                  <button type="button" onClick={onRescan} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                    <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                    Rescan current evidence
                  </button>
                )}
                {canShare && (
                  <button
                    type="button"
                    onClick={() => void share()}
                    disabled={shareState === "creating"}
                    aria-live="polite"
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-60"
                  >
                    <ShareNetwork aria-hidden="true" size={14} weight="bold" />
                    {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied ✓" : shareState === "error" ? "Share failed · retry" : "Share report"}
                  </button>
                )}
                {canMutateWorkspace && (
                  <button type="button" onClick={watch} aria-pressed={watched} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                    <Star aria-hidden="true" size={14} weight={watched ? "fill" : "regular"} />
                    {watched ? "Watching report" : "Add to watchlist"}
                  </button>
                )}
                <button type="button" onClick={onReset} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                  <MagnifyingGlassPlus aria-hidden="true" size={14} weight="bold" />
                  New audit
                </button>
                {canArchive && (
                  <button
                    type="button"
                    onClick={() => void archive()}
                    disabled={archiveState === "archiving"}
                    className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-signal/10 hover:text-signal-lift disabled:cursor-wait disabled:opacity-60"
                  >
                    {archiveState === "archiving" ? "Archiving case…" : archiveState === "error" ? "Archive failed · retry" : "Archive case"}
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className={`report-frame report-style-${reportStyle}`} data-report-style={reportStyle}>
        {versionContext && (
          <div className="mt-4">
            <SnapshotEvidenceControl
              snapshotVersion={versionContext.version}
              capturedAt={versionContext.createdAt}
              subjectKind="person"
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
            Saving this report before running extra checks…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="finding tint-caution mt-4 px-4 py-3 text-[12.5px]" role="alert">
            Extra checks are paused because this report was not saved correctly. Run a new scan before trying them again.
            {f.persistence?.state === "failed" && f.persistence.reason && (
              <span className="mono mt-1 block text-[11px] text-ink-faint">save error: {f.persistence.reason}</span>
            )}
          </div>
        )}
        {showTrustGraphSupplemental && <RingAlert handle={report.handle} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* Subject identity and decision state are intentionally one hierarchy:
            who is being assessed, what ARGUS concluded, and whether the frozen
            evidence is complete enough to act on. */}
        <section id="report-overview" className="investigation-story-cover mt-6 scroll-mt-28" data-canonical-report-header="true" aria-labelledby="report-subject-title">
          <div className="flex flex-wrap items-end gap-3">
            <Avatar src={f.avatar_url || xAvatar(f.handle)} letter={f.avatar} size={44} rounded="rounded-xl" letterClass="text-lg" />
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{roles.includes(SubjectClass.PROJECT) ? "Project investigation" : "Person investigation"}</p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 id="report-subject-title" className="display-sm text-[30px] leading-none text-ink sm:text-[34px]">{f.display_name}</h1>
                <span className="mono text-[13px] text-ink-faint">{f.handle}</span>
              </div>
            </div>
            <CopyTldrButton
              base={tldrBase}
              {...(!shareView ? { mint: mintShareUrl } : {})}
              className="mb-0.5 ml-auto"
            />
          </div>

          <div className="mt-2 hidden sm:block">
            <SubjectProfileContext dossier={f} roles={roles} hasTerminalXState={hasTerminalXState} summary={openingSubjectSummary} showSummary={reportStyle !== 2} />
          </div>
          <details className="mt-3 border-t border-line/60 pt-1 sm:hidden">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-[11.5px] text-ink-dim [&::-webkit-details-marker]:hidden">
              <span>{roles.map((role) => ROLE_META[role].label).join(" · ") || "Subject"}</span>
              <span className="mono text-[10px] uppercase tracking-wide text-signal-lift">Profile context</span>
            </summary>
            <div className="pb-1">
              <SubjectProfileContext dossier={f} roles={roles} hasTerminalXState={hasTerminalXState} summary={openingSubjectSummary} showSummary={reportStyle !== 2} />
            </div>
          </details>

          <ProjectLinks
            className="mt-3"
            website={f.website}
            xHandle={f.handle}
            contractAddress={f.projectToken?.address}
            chain={f.projectToken?.chain}
            links={f.githubAssessment?.login
              ? [{ label: "GitHub", url: `https://github.com/${f.githubAssessment.login}` }]
              : undefined}
          />

          <details className="mt-3 border-t border-line/60 pt-3 text-[11px]">
            <summary className="cursor-pointer select-none text-[12px] font-medium text-ink-dim">Report details</summary>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3" aria-label="Saved report details">
              {caseLabel && (
                <div>
                  <dt className="stat-label">Case</dt>
                  <dd className="mono mt-1 break-all text-ink-dim">{caseLabel}</dd>
                </div>
              )}
              <div>
                <dt className="stat-label">Report ID</dt>
                <dd className="mono mt-1 break-all text-ink-dim">{report.audit_id}</dd>
              </div>
              <div>
                <dt className="stat-label">Report state</dt>
                <dd className="mono mt-1 text-signal-lift">
                  {versionContext
                    ? `saved report v${versionContext.version}`
                    : liveCoreSnapshotSaved
                      ? "report saved"
                      : f.live
                        ? "new scan"
                        : "saved report"}
                </dd>
              </div>
              {(capturedLabel || finalizedLabel) && (
                <div>
                <dt className="stat-label">Saved</dt>
                <dd className="mt-1 text-ink-dim">{capturedLabel ?? finalizedLabel}</dd>
                </div>
              )}
            </dl>
          </details>

          <CriticalSubjectAlerts dossier={f} />

          <div
            className="hidden"
            aria-hidden="true"
            aria-label="Report result and check status"
          >
            <div className="shrink-0 text-center max-sm:order-2 max-sm:flex max-sm:items-center max-sm:gap-3 max-sm:text-left">
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
              {!shareView && <CopyTldrButton base={tldrBase} mint={mintShareUrl} />}
            </div>
            <div className="min-w-0 flex-1 max-sm:order-1">
              <div className="eyebrow mb-1.5">{plainReportStatusLabel(presentation.resultLabel)}</div>
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
                  ? "Every required safety check finished. Read the sources before relying on this result."
                      : "Some checks are still open. The report lists what is missing."}
                  >
                    {readiness.status === "ready" ? "ready to review" : readiness.status}
                  </span>
                )}
                {report.governing_role && (
                  <span
                    className="mono text-[11px] text-ink-dim"
                    title="ARGUS scores each role separately. The lowest role score becomes the overall result."
                  >
                    {ROLE_META[report.governing_role as SubjectClass].label.toLowerCase()} role set the final score
                  </span>
                )}
                {!presentation.final && f.intelligence && (
                  <a
                    href="#decision-intelligence"
                    className="chip tint-signal min-h-8 font-medium text-signal-lift underline-offset-2 hover:underline"
                  >
                    Deep dive ready · {f.intelligence.measurements.length} evidence points
                  </a>
                )}
              </div>
              <ExpandableText
                text={plainLanguageSummary(presentation.final ? f.headline : legacyCoverageNotCaptured ? readinessGuidance : presentation.note)}
                collapsedLength={240}
                className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim"
              />
              {presentation.final && !legacyCoverageNotCaptured && (
                <p className="mono mt-2 text-[11px] text-ink-faint" aria-label="Verdict support summary">
                  {verifiedDecisionFactCount > 0 && (
                    <>
                      <span className="tabular">{verifiedDecisionFactCount}</span> facts confirmed
                      <span aria-hidden="true"> · </span>
                    </>
                  )}
                  <span className="tabular">{cleanScreens.length}</span> screens clean
                  <span aria-hidden="true"> · </span>
                  {(() => {
                    // A neutral assessment null (e.g. "no repeat backing on record")
                    // is recorded as a substantive "finding" so it can cover + score
                    // its axis, but an absent positive signal is never counter-evidence.
                    // Visual profile-photo triage is also only a review lead.
                    // isAdverseFinding excludes both from the adverse tally.
                    const adverseSignals = diligenceChecks.filter(isAdverseFinding).length
                      + visibleContradictions.length;
                    if (adverseSignals > 0) {
                      return <span className="text-avoid">{adverseSignals} warning {adverseSignals === 1 ? "sign" : "signs"}</span>;
                    }
                    // Never assert a zero under an adverse verdict; route to the basis instead.
                    if (!favorableVerdict) {
                      return <a href="#decision-basis" className="text-avoid underline-offset-2 hover:underline">see why this scored this way</a>;
                    }
                    // No confirmed warning sign is not the same as nothing
                    // found. An uncorroborated lead naming the subject is still
                    // on this page, so report it rather than a zero.
                    if (subjectAdverseLeads.length > 0) {
                      return (
                        <a href="#subject-leads" className="text-caution underline-offset-2 hover:underline">
                          {subjectAdverseLeads.length} unverified {subjectAdverseLeads.length === 1 ? "lead" : "leads"} about this subject
                        </a>
                      );
                    }
                    return <span>0 warning signs</span>;
                  })()}
                </p>
              )}
              {!presentation.final && f.headline && (
                <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
                  <span className="text-ink-dim">This score uses the facts ARGUS saved. It is not an approval or recommendation.</span> {f.headline}
                </p>
              )}
              {!presentation.final && f.intelligence && (
                <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">
                  The score remains withheld, but the saved report still contains a role-specific decision map with exact evidence states, source lineage, critical unknowns, and four diligence lenses.
                </p>
              )}
              {report.cap_applied && (
                <div className="chip tint-avoid mt-3 font-medium">
                  Score limited · {capLabel(report.cap_applied)}
                </div>
              )}
            </div>
          </div>

          {/* A lone tile reads as a broken empty band; two or more justify the
              strip, and the column count tracks the tile count so no cell is
              ever an empty grey box. */}
          {fundamentalTiles.length >= 2 && (
            <dl
              className="hidden"
              aria-hidden="true"
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

          <div className="hidden" aria-hidden="true">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-[12.5px] font-semibold uppercase tracking-[0.14em]">{readinessTitle}</span>
              <span className="text-[11px] text-ink-faint">
                {legacyCoverageNotCaptured ? "this older report does not show every check" : "required checks are shown below"}
              </span>
              {!legacyCoverageNotCaptured && diligenceChecks.length > 0 && (
                <a
                  href={decisionQuestionCount > 0 ? "#verification-next" : "#scan-methodology"}
                  className="ml-auto inline-flex min-h-8 items-center text-[11px] text-signal-lift underline-offset-2 hover:underline"
                >
                  {decisionQuestionCount > 0
                    ? `${decisionQuestionCount} follow-up ${decisionQuestionCount === 1 ? "question" : "questions"}`
                    : "Review checks"}
                </a>
              )}
            </div>
            {versionContext && (
              <details className="mt-2 text-[11px] text-ink-faint">
                <summary className="cursor-pointer select-none">Saved report details</summary>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  <span className="mono uppercase tracking-wide">{versionContext.completenessState} report</span>
                  {attestationLabel && <span>{attestationLabel}</span>}
                  {capturedLabel && <span>saved {capturedLabel}</span>}
                  {versionContext.methodologyVersion && <span className="mono">checks version {versionContext.methodologyVersion}</span>}
                </div>
              </details>
            )}
            {legacyCoverageNotCaptured ? (
              <div className="panel-inset mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-ink">Check details unavailable</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{readinessGuidance}</p>
                </div>
                {onRescan && (
                  <button type="button" onClick={onRescan} className="btn-chip tint-signal min-h-11 shrink-0 gap-1.5 font-medium">
                    <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                    Rescan to record every check
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{readinessGuidance}</p>
            )}
            <ProofChipStrip chips={heroProofChips} />
            {f.priorOutcome && (
              <OutcomeDeltaStrip
                prior={f.priorOutcome}
                score={typeof report.governing_score === "number" ? report.governing_score : null}
                verdict={report.composite_verdict ?? null}
                coverage={f.completeness_state}
              />
            )}
            {noticedSignals.length > 0 && (
              <div className="mt-4 border-t border-line/70 pt-4">
                <NoticedRail signals={noticedSignals} />
              </div>
            )}
          </div>
        </section>

        {reportLane.definition.navigation === "sticky" && (
          <ReportStickyTableOfContents items={reportNavItems} />
        )}

        <InvestigationDecisionCanvas
          presentationStyle={reportStyle}
          subjectName={f.display_name || f.handle}
          subjectSummary={openingSubjectSummary}
          reportSummary={f.headline}
          verdictLabel={m.label}
          score={presentation.primaryScore && typeof report.governing_score === "number" ? report.governing_score : null}
          scoreLabel={roles.includes(SubjectClass.PROJECT) ? "Project diligence score" : "Person diligence score"}
          scoreContext={roles.includes(SubjectClass.PROJECT)
            ? "Team, product, token conduct, backers, traction and transparency."
            : "Identity, operating record, relationships and attributable risk."}
          scoreIsProvisional={!presentation.final}
          favorable={favorableVerdict}
          verdictTone={decisionNarrativeTone}
          argument={caseArgument}
          discovery={materialChangeDiscovery ?? controlPathDiscovery ?? claimConflictDiscovery ?? decisionDiscovery}
          decisionLensId={f.intelligence ? decisionLensId : undefined}
          onDecisionLensChange={f.intelligence ? setDecisionLensId : undefined}
          supports={decisionCanvasSupports}
          concerns={decisionCanvasConcerns}
          context={decisionCanvasContext}
          nextSteps={decisionCanvasNextSteps}
          verified={decisionCanvasVerified}
          coveragePercent={readiness.coveragePercent}
          successful={readiness.successful}
          applicable={readiness.applicable}
          checkScopeLabel="Required report checks"
          capturedAt={capturedLabel ?? finalizedLabel ?? undefined}
          evidenceHref="#evidence-ledger"
          methodologyHref="#scan-methodology"
          challengeAnchorId={shareView ? null : "ask-report"}
          composition={presentation.primaryScore && compositionRows.length > 0 ? compositionRows : undefined}
          secondaryScore={linkedTokenScore}
        />

        <ProviderFailureNotice failures={f.providerFailures} />

        {/* the composition strip: the governing role's weighted dimensions as
            readable rows — expand for the why, jump to the evidence, or
            challenge the score */}
        {presentation.primaryScore && governingAxes.length > 0 && (
          <section id="composition" className={reportStyle === 2 ? "af-doc mt-10 scroll-mt-28" : ""}>
            {reportStyle === 2 && (
              <>
                <p className="af-sec-label">The composition</p>
                <h2 className="af-h2 mt-3">{compositionHeadline(compositionRows.length)}</h2>
                <p className="af-prose">Each row is a section of this file. The weight is how much it counts; the points are what it drove into the result. Open a row for the short version, or go straight to the evidence.</p>
              </>
            )}
            <ScoreComposition
              rows={compositionRows}
              totalScore={report.governing_score}
              capNote={report.cap_applied ? `limited to ${report.governing_score} · ${capLabel(report.cap_applied)}` : null}
              challengeAnchor={shareView ? null : "#ask-report"}
            />
          </section>
        )}

        <ReportExperienceLayout
          items={reportNavItems}
          showGuideNavigation={reportLane.definition.navigation === "guide"}
        >
        {reportStyle === 2 && (
          <>
            <section id="decision-brief" className="canonical-decision-brief story-chapter report-section scroll-mt-28">
              <header className="report-section-heading">
                <div>
                  <p className="eyebrow text-signal-lift">02 · Decision brief</p>
                  <h2 className="story-chapter-title mt-2 text-ink">The case, without the repetition.</h2>
                  <p className="story-chapter-description mt-2 max-w-3xl text-ink-dim">
                    The strongest evidence, the main concerns, and the questions most likely to change the result.
                  </p>
                </div>
              </header>
              <div className="canonical-decision-grid panel overflow-hidden">
                <ReportCanvasNarrativeSection
                  id="canonical-verdict-rationale"
                  title={favorableVerdict ? "What supports this result" : "Main concerns"}
                  description="The three decision-changing points that most strongly govern the result."
                  tone={decisionNarrativeTone}
                  items={verdictNarrative.slice(0, 3)}
                  emptyCopy="No decision-changing concern was recorded. Review the evidence before relying on the result."
                  singleColumn
                />
                <ReportCanvasNarrativeSection
                  id="canonical-confidence-limits"
                  title={favorableVerdict ? "Main concerns" : "What looks credible"}
                  description="The strongest counterweight to the governing result."
                  tone={favorableVerdict ? "caution" : "pass"}
                  items={countervailingNarrative.slice(0, 3)}
                  emptyCopy="No countervailing finding was recorded in this saved report."
                  singleColumn
                />
                <ReportCanvasNarrativeSection
                  id="canonical-verification-next"
                  title="What to check next"
                  description="The three unanswered questions most likely to change the result."
                  tone="signal"
                  items={verificationNext.slice(0, 3)}
                  emptyCopy="No unresolved decision question was recorded."
                  singleColumn
                />
              </div>
            </section>

            <DossierReport
              payload={f as unknown as Record<string, unknown>}
              includeBeats={roles.includes(SubjectClass.PROJECT) ? ["product"] : undefined}
              includeSources={false}
            />

            <section id="identity-evidence" className="canonical-people-section story-chapter report-section scroll-mt-28" aria-labelledby="report-team-heading">
              <header className="report-section-heading">
                <div>
                  <p className="eyebrow text-signal-lift">People &amp; control</p>
                  <h2 id="report-team-heading" className="story-chapter-title mt-2 text-ink">
                    {webTeam.length > 0
                      ? "One roster. Evidence first."
                      : "The people behind this project remain unresolved."}
                  </h2>
                  <p className="story-chapter-description mt-2 max-w-3xl text-ink-dim">
                    {webTeam.length > 0
                      ? `ARGUS found ${webTeam.length} source-grounded ${webTeam.length === 1 ? "person" : "people"}. Leadership continuity and unresolved team leads stay attached to this roster instead of repeating elsewhere.`
                      : f.identity_note}
                  </p>
                </div>
                {(webTeam.length > 0 || webTeamLeads.length > 0) && (
                  <span className="verdict-pill tint-signal">
                    {webTeam.length} verified · {webTeamLeads.length} to verify
                  </span>
                )}
              </header>
              <details
                className="kyle-people-disclosure"
                open={reportLane.definition.id === "kyle" ? undefined : true}
              >
                <summary>
                  <span>
                    <strong>View the complete people and control record</strong>
                    <small>Profiles, role sources, continuity checks, and unresolved leadership claims.</small>
                  </span>
                  <span className="mono">{webTeam.length + webTeamLeads.length + unmatchedLeadershipRows.length} records</span>
                </summary>
              {webTeam.length > 0 && (
                <div className={`grid gap-3 ${webTeam.length > 1 ? "xl:grid-cols-2" : ""}`}>
                  {webTeam.map((person, index) => {
                    const roleProof = safeSourceLink(person.sourceUrl ?? person.source);
                    const continuity = leadershipForMember(person);
                    const continuityProfile = safeSourceLink(continuity?.linkedin
                      ? /^https?:\/\//i.test(continuity.linkedin) ? continuity.linkedin : `https://${continuity.linkedin}`
                      : undefined);
                    const continuityLabel = continuity?.state === "current"
                      ? "current in provider record"
                      : continuity?.state === "departed"
                        ? continuity.ended
                          ? `provider record ends ${frozenDateLabel(continuity.ended)}`
                          : "provider record marks role ended"
                        : continuity?.state === "absent"
                          ? "continuity not established"
                          : null;
                    return (
                      <article key={`${person.name}:${person.handle ?? ""}:${index}`} className="team-person-card panel">
                        <span className="team-person-main">
                          <Avatar src={trustedOfficialXAvatarUrl(person.avatarUrl) ?? personAvatar(person.handle, person.linkedin)} letter={(person.name.replace(/^@/, "")[0] ?? "?").toUpperCase()} size={52} rounded="rounded-full" letterClass="text-[13px]" />
                          <span className="text-[16px] font-semibold text-ink">{person.name}</span>
                          {person.handle && <span className="mono text-[12px] text-ink-faint">{person.handle}</span>}
                          <span className="chip tint-signal shrink-0 normal-case tracking-normal">{formatRoleLabel(person.role)}</span>
                          {roleProof && <a href={roleProof.href} target="_blank" rel="noreferrer" className="link-ext text-[12px]">Open role source</a>}
                          {continuityLabel && (
                            <span className={`chip ${continuity?.state === "current" ? "tint-pass" : continuity?.state === "departed" ? "tint-caution" : ""}`}>
                              {continuityLabel}
                            </span>
                          )}
                          {continuityProfile && <a href={continuityProfile.href} target="_blank" rel="noreferrer" className="link-ext text-[12px]">Confirm continuity</a>}
                          <span className="team-person-evidence text-[13px] leading-relaxed">
                            {person.evidence ? `${plainLanguageSummary(person.evidence)} ` : ""}
                            <span className="mono">Source: {sourceProviderLabel(person.provider ?? person.source)}.</span>
                          </span>
                        </span>
                        {person.handle && onAudit && (
                          <button onClick={() => onAudit(person.handle!)} className="btn-secondary min-h-10 shrink-0 px-3 text-[12px]">Review</button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              {webTeamLeads.length > 0 && (
                <div className="mt-6 border-t border-line/70 pt-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="text-[16px] font-semibold text-ink">Needs verification</h3>
                    <span className="chip tint-caution">{webTeamLeads.length} team {webTeamLeads.length === 1 ? "lead" : "leads"}</span>
                    <span className="text-[11.5px] text-ink-faint">not identity proof · not scored</span>
                  </div>
                  <Card className="divide-y divide-line/60 border-caution/25">
                    {webTeamLeads.map((member, index) => (
                      <div key={`${member.name}:${member.role}:${member.source}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-[12.5px]">
                        <span className="font-medium text-ink-dim">{member.name}</span>
                        <span className="chip">{member.role}</span>
                        {member.handle && <span className="mono text-[11px] text-caution">candidate {member.handle}</span>}
                        <span className="text-[11px] text-ink-faint">{sourceProviderLabel(member.provider ?? member.source)}</span>
                        {member.evidence && <span className="min-w-full text-[11px] leading-relaxed text-ink-faint">{member.evidence}</span>}
                        {member.handle && onAudit && <button type="button" onClick={() => onAudit(member.handle!)} className="btn-chip tint-caution ml-auto min-h-11">Verify →</button>}
                      </div>
                    ))}
                  </Card>
                </div>
              )}
              {unmatchedLeadershipRows.length > 0 && (
                <div className="mt-6 border-t border-line/70 pt-5">
                  <h3 className="text-[16px] font-semibold text-ink">Leadership records to reconcile</h3>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">Provider records that do not map to a verified roster card. They are context, not additional team members.</p>
                  <ol className="mt-3 divide-y divide-line/60 rounded-xl border border-line/70">
                    {unmatchedLeadershipRows.map((row, index) => {
                      const profile = safeSourceLink(row.linkedin ? /^https?:\/\//i.test(row.linkedin) ? row.linkedin : `https://${row.linkedin}` : undefined);
                      const stateLabel = row.state === "current"
                        ? "provider record lists project"
                        : row.state === "departed"
                          ? row.ended ? `provider record ends ${frozenDateLabel(row.ended)}` : "provider record marks role ended"
                          : "provider record did not answer for this project";
                      return (
                        <li key={`${row.name}:${row.role}:${index}`} className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-[12px]">
                          <span className="font-medium text-ink">{row.name}</span>
                          <span className="text-ink-faint">{row.role}</span>
                          <span className={`chip ${row.state === "current" ? "tint-pass" : row.state === "departed" ? "tint-caution" : ""}`}>{stateLabel}</span>
                          {profile && <a href={profile.href} target="_blank" rel="noreferrer" className="link-ext ml-auto text-[11px]">Confirm on LinkedIn</a>}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              </details>
            </section>

            {f.projectToken && (
              <div className="canonical-market-section py-5">
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

            {f.socialActivity && roles.includes(SubjectClass.PROJECT) && (
              <SocialActivityPanel
                snapshot={f.socialActivity}
                className="canonical-social-section mt-3"
                panelCostToken={panelCostToken}
                afterActivity={subjectLeads.length > 0 ? (
                  <div id="subject-leads" className="scroll-mt-28">
                    <SubjectAccusationStage
                      leads={subjectLeads}
                      subject={report.handle}
                      summary={subjectLeadSummary}
                      panelCostToken={panelCostToken}
                    />
                  </div>
                ) : undefined}
              />
            )}
          </>
        )}

        {reportStyle !== 2 && <DossierReport payload={f as unknown as Record<string, unknown>} />}
        {f.projectStrengthBands && (
          reportStyle === 2 ? (
            <details className="canonical-evidence-disclosure panel mt-7 scroll-mt-28">
              <summary>
                <span>
                  <strong>Evidence behind each score dimension</strong>
                  <small>Open the six detailed chapters and their source-backed reasons.</small>
                </span>
                <span className="mono">{Object.keys(f.projectStrengthBands).length} chapters</span>
              </summary>
              <DimensionChapters
                chapters={personDimensionChapters(f.projectStrengthBands)}
                checksHref="#scan-methodology"
              />
            </details>
          ) : (
            <DimensionChapters
              chapters={personDimensionChapters(f.projectStrengthBands)}
              checksHref="#scan-methodology"
            />
          )
        )}

        {reportStyle === 2 ? (
          (f.intelligence || f.researchPlan || showBasicFacts) && (
            <details id="evidence-questions" className="canonical-evidence-disclosure panel mt-5 scroll-mt-28">
              <summary>
                <span>
                  <strong>Research coverage and open questions</strong>
                  <small>The full question ledger, source coverage, and refresh triggers.</small>
                </span>
                <span className="mono">Evidence detail</span>
              </summary>
              <div className="canonical-evidence-disclosure-body">
                {f.intelligence && (
                  <PointInTimeIntelligencePanel
                    snapshot={f.intelligence}
                    thesisEligible={presentation.final && !decisionFrameworkUnavailable}
                    governingVerdict={presentedVerdict}
                    selectedLensId={decisionLensId}
                    onSelectedLensChange={setDecisionLensId}
                  />
                )}
                {f.researchPlan && <ResearchPlanPanel plan={f.researchPlan} className="mt-3" />}
                {showBasicFacts && (
                  <div className="mt-5">
                    <BasicFactsPanel
                      facts={basicFacts}
                      leads={basicFactLeads}
                      fillRequired={fillDecisionFacts}
                      audience={basicFactsAudience}
                      questionLedger={f.basicFactQuestionLedger}
                      fundingRounds={fundingEvidence.rounds}
                      supportingAffiliationCount={evidence.ventures.filter((venture) =>
                        venture.evidence_origin !== "model_lead" && venture.artifact_verified === true).length}
                    />
                  </div>
                )}
              </div>
            </details>
          )
        ) : (
          <>
            {prioritizeDecisionIntelligence && f.intelligence && (
              <PointInTimeIntelligencePanel
                snapshot={f.intelligence}
                thesisEligible={presentation.final && !decisionFrameworkUnavailable}
                governingVerdict={presentedVerdict}
                selectedLensId={decisionLensId}
                onSelectedLensChange={setDecisionLensId}
              />
            )}
            {f.researchPlan && <ResearchPlanPanel plan={f.researchPlan} className="mt-3" />}
            {showBasicFacts && (
              <div className="mt-5">
                <BasicFactsPanel
                  facts={basicFacts}
                  leads={basicFactLeads}
                  fillRequired={fillDecisionFacts}
                  audience={basicFactsAudience}
                  questionLedger={f.basicFactQuestionLedger}
                  fundingRounds={fundingEvidence.rounds}
                  supportingAffiliationCount={evidence.ventures.filter((venture) =>
                    venture.evidence_origin !== "model_lead" && venture.artifact_verified === true).length}
                />
              </div>
            )}
          </>
        )}

        {reportStyle === 2 ? (
          (f.operatorLaunches || f.protocolTvl || f.protocolFees || f.holderProfile || f.companyEnrichment || f.website || f.protocolFunding) && (
            <details className="canonical-evidence-disclosure panel mt-5 scroll-mt-28">
              <summary>
                <span>
                  <strong>Operating history, usage and capital evidence</strong>
                  <small>Track record, adoption signals and the underlying company and funding ledgers.</small>
                </span>
                <span className="mono">Evidence detail</span>
              </summary>
              <div className="canonical-evidence-disclosure-body">
                {f.operatorLaunches && (
                  <div className="mt-3">
                    <OperatorTrackRecord
                      history={f.operatorLaunches}
                      operatorHandle={operatorHandleForDossier}
                      creatorWallet={f.operatorLaunches.creatorWallet}
                    />
                  </div>
                )}
                {(f.protocolTvl || f.protocolFees || f.holderProfile) && (
                  <div className="mt-3">
                    <UsageVisuals tvl={f.protocolTvl} fees={f.protocolFees} holders={f.holderProfile} />
                  </div>
                )}
                <DiligenceEvidenceLedgers
                  className="mt-3"
                  company={f.companyEnrichment}
                  officialWebsite={f.website}
                  protocolFunding={f.protocolFunding}
                  protocolTvl={f.protocolTvl}
                  canonicalGeckoId={f.projectToken?.coingeckoId}
                />
              </div>
            </details>
          )
        ) : (
          <>
            {f.operatorLaunches && (
              <div className="mt-3">
                <OperatorTrackRecord
                  history={f.operatorLaunches}
                  operatorHandle={operatorHandleForDossier}
                  creatorWallet={f.operatorLaunches.creatorWallet}
                />
              </div>
            )}
            {(f.protocolTvl || f.protocolFees || f.holderProfile) && (
              <div className="mt-3">
                <UsageVisuals tvl={f.protocolTvl} fees={f.protocolFees} holders={f.holderProfile} />
              </div>
            )}
            <DiligenceEvidenceLedgers
              className="mt-3"
              company={f.companyEnrichment}
              officialWebsite={f.website}
              protocolFunding={f.protocolFunding}
              protocolTvl={f.protocolTvl}
              canonicalGeckoId={f.projectToken?.coingeckoId}
            />
          </>
        )}

        {reportStyle !== 2 && f.socialActivity && roles.includes(SubjectClass.PROJECT) && (
          <SocialActivityPanel
            snapshot={f.socialActivity}
            className="mt-3"
            panelCostToken={panelCostToken}
            afterActivity={subjectLeads.length > 0 ? (
              <div id="subject-leads" className="scroll-mt-28">
                <SubjectAccusationStage
                  leads={subjectLeads}
                  subject={report.handle}
                  summary={subjectLeadSummary}
                  panelCostToken={panelCostToken}
                />
              </div>
            ) : undefined}
          />
        )}

        {reportStyle !== 2 && f.projectToken && (
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

        <div id="decision-summary" className="legacy-reading-duplicate grid scroll-mt-28 gap-4 py-5">
          {partialAxisAssessment && (
            <section className="finding tint-caution px-5 py-4" aria-label="Partial decision assessment">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="eyebrow text-caution">Partial decision assessment</div>
                  <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
                    {governingAxes.length} of {expectedGoverningAxes.length} decision areas were assessed
                  </h2>
                  <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">
                    ARGUS preserved the areas supported by substantive evidence. {unmeasuredGoverningAxes.map(axisLabel).join(" and ")} remain unmeasured, so no overall score was produced and missing evidence was not treated as zero.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="chip tint-signal">{governingAxes.length} assessed</span>
                    <span className="chip tint-caution">{unmeasuredGoverningAxes.length} unmeasured</span>
                  </div>
                </div>
                {onRescan && (
                  <button type="button" onClick={onRescan} className="btn-chip tint-signal min-h-11 shrink-0 gap-1.5 font-medium">
                    <ArrowsClockwise aria-hidden="true" size={14} weight="bold" />
                    Retry missing checks
                  </button>
                )}
              </div>
            </section>
          )}
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
                      ? "ARGUS could not confirm whether this is a project, organization, token, or person. The sources below may still help, but this report does not have a usable result."
                      : `ARGUS identified this as a ${resolvedRoleLabel.toLowerCase()}, but the scoring step did not finish. The sources below may still help, but this report does not have a usable result.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="chip tint-caution">No decision areas scored</span>
                    <span className="chip">{readiness.successful} checks completed</span>
                    <span className="chip">{visibleIntelligenceCount} sources and possible leads</span>
                    {providerGaps.length > 0 && <span className="chip tint-caution">{providerGaps.length} source checks did not finish</span>}
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
            <div className="border-b border-line/70 py-4" aria-label="Case synthesis">
              {f.intelligence && (
                <DecisionLensSelector value={decisionLensId} onChange={setDecisionLensId} />
              )}
              <VerdictArgumentBlock argument={caseArgument} />
            </div>
            <ReportCanvasNarrativeSection
              id="verdict-rationale"
              title={decisionFrameworkUnavailable ? "What ARGUS found before the score failed" : favorableVerdict ? "Why it scored well" : "Main concerns"}
              description={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "Confirmed facts and possible leads are still shown while ARGUS works out what kind of subject this is."
                  : "Confirmed facts and possible leads are still shown even though the score did not finish."
                : favorableVerdict
                  ? "The strongest source-backed reasons this result holds up."
                  : "The findings, conflicts, and weak areas driving the result."}
              tone={decisionNarrativeTone}
              items={decisionFrameworkUnavailable ? unscoredIntelNarrative : verdictNarrative}
              emptyCopy={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "No usable sources were saved. Confirm what this subject is, review which sources were available, and run the investigation again."
                  : "No usable sources were saved. Review which sources were available and try the investigation again."
                : favorableVerdict
                  ? "This saved report does not explain the score. Review the sources before relying on it."
                  : "No warning in the saved sources explains this result. Review why it scored this way before relying on it."}
            />
            <ReportCanvasNarrativeSection
              id="confidence-limits"
              title={decisionFrameworkUnavailable ? "Why there is no score" : favorableVerdict ? "Main concerns" : "What looks credible"}
              description={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "ARGUS needs to confirm what this subject is before it can score it."
                  : "ARGUS identified the subject, but the decision review did not finish."
                : favorableVerdict
                  ? subjectLeadSummary
                    ? `${subjectLeadSummary} Any verified risk or conflicting source is listed here too.`
                    : "Verified risks and conflicting sources. Unanswered questions are listed separately below."
                  : "Verified positive findings stay visible so a negative result is shown in context."}
              tone={decisionFrameworkUnavailable ? "caution" : favorableVerdict ? (report.cap_applied ? "avoid" : "caution") : "pass"}
              items={decisionFrameworkUnavailable ? confidenceLimits : countervailingNarrative}
              emptyCopy={decisionFrameworkUnavailable
                ? routingUnresolved
                  ? "ARGUS could not confirm what this subject is, so it withheld the score."
                  : "The subject was identified, but the review did not finish, so ARGUS withheld the score."
                : favorableVerdict
                  // Belt and braces. The lead items above already displace this
                  // copy, but the all-clear sentence must not even be
                  // constructible while an adverse lead names the subject.
                  ? subjectLeadSummary
                    ? subjectLeadSummary
                    : cleanScreens.length
                      ? `No adverse findings in ${cleanScreens.length} completed clean ${cleanScreens.length === 1 ? "screen" : "screens"}: ${cleanScreens.slice(0, 3).map((check) => check.label.toLowerCase()).join(", ")}${cleanScreens.length > 3 ? `, and ${cleanScreens.length - 3} more` : ""}.`
                      : noCleanScreenCopy
                  : "No confirmed positive finding is recorded in this report."}
            />
            {intelligenceContextNarrative.length > 0 && (
              <ReportCanvasNarrativeSection
                id="important-context"
                title="Other useful context"
                description="Facts worth knowing that do not raise or lower the result on their own."
                tone="neutral"
                items={intelligenceContextNarrative}
                emptyCopy=""
              />
            )}
            {!decisionFrameworkUnavailable && decisionQuestionCount > 0 && (
              <p className="border-t border-line/60 py-3 text-[11.5px] text-ink-faint">
                Follow up on: <a href="#verification-next" className="text-caution underline-offset-2 hover:underline">{decisionQuestionCount} important {decisionQuestionCount === 1 ? "question" : "questions"}</a>.
              </p>
            )}
          </div>
        </div>

        {reportStyle !== 2 && f.intelligence && !prioritizeDecisionIntelligence && (
          <PointInTimeIntelligencePanel
            snapshot={f.intelligence}
            thesisEligible={presentation.final && !decisionFrameworkUnavailable}
            governingVerdict={presentedVerdict}
            selectedLensId={decisionLensId}
            onSelectedLensChange={setDecisionLensId}
          />
        )}

        {f.evmControlReality && (
          <EvmControlSurfacePanel snapshot={f.evmControlReality} />
        )}

        <div id="decision-basis" className="legacy-reading-duplicate scroll-mt-28">
          <DecisionBasis
            roleReport={governingRoleReport}
            catalog={f.axisEvidenceCatalog}
            lineageVersion={f.axisCitationVersion}
            unavailableReason={routingUnresolved ? "routing" : scoringOutputIncomplete ? "scoring" : undefined}
            onRescan={onRescan}
          />
        </div>

        <div className="legacy-reading-duplicate panel mt-5 px-5">
          <ReportCanvasNarrativeSection
            id="verification-next"
            title="What to check next"
            description="The three unanswered questions most likely to change the result."
            tone="signal"
            items={verificationNext}
            emptyCopy={legacyCoverageNotCaptured
              ? "This report predates per-check outcome records. Rescan to establish a current verification plan."
              : "No unresolved decision question was recorded. Review the cited evidence and any findings before making an investment decision."}
          />
          {remainingVerificationQuestions.length > 0 && (
            <details className="border-t border-line/60 py-4" open={printExpanded || undefined}>
              <summary className="cursor-pointer text-[13px] font-medium text-ink-dim hover:text-ink">
                More follow-up questions · {remainingVerificationQuestions.length}
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
              title="What would improve the score"
              description={`This score is ${report.governing_score} of 100. These are the areas where stronger evidence could change it.`}
              tone="signal"
              items={remainingPointsItems}
              emptyCopy=""
            />
          </div>
        )}

        <div id={reportStyle === 2 ? "identity-evidence-detail" : "identity-evidence"} className="scroll-mt-28">
        {/* Supplemental live checks are deliberately separated from the frozen
            score. They self-gate on a resolved real name and never imply broad
            legal or sanctions clearance. */}
        {showOffchainSupplemental && (
          <div className="mt-3 space-y-2">
            <SanctionsNameScreen name={f.display_name} resolved={displayIdentityConfidence === "Confirmed" || displayIdentityConfidence === "Probable"} />
            <LegalScreen name={f.display_name} resolved={displayIdentityConfidence === "Confirmed" || displayIdentityConfidence === "Probable"} />
          </div>
        )}

        {/* identity: when a named team resolved it, SHOW the team here (the note
            would just narrate the same names); otherwise show the note.
            NOT for KOLs: a KOL's display name colliding with a real project (e.g.
            "@KaminoCrypto" vs the Kamino protocol) pulled that project's team in by
            NAME and wrongly presented it as this handle's identity. A KOL is a
            pseudonymous individual, not a project team — the name-search team is a
            collision, and the contradictions section already explains it. */}
        {report.governing_role !== "KOL" && (webTeam.length > 0 || webTeamLeads.length > 0 || leadershipRows.length > 0) ? (
          <section className="legacy-reading-duplicate team-diligence-card panel mt-3" aria-labelledby="report-team-heading">
            <header className="team-diligence-header">
              <div>
                <div className="eyebrow">People & control</div>
                <h3 id="report-team-heading" className="mt-1 text-[clamp(22px,2.2vw,30px)] font-medium leading-tight tracking-[-0.025em] text-ink">
                  One roster. Evidence first.
                </h3>
                <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-dim">
                  {webTeam.length > 0
                    ? `ARGUS found ${webTeam.length} source-grounded ${webTeam.length === 1 ? "person" : "people"}. Leadership continuity and unresolved candidates are attached here instead of repeated in separate team sections.`
                    : "No source-grounded team member is published yet. The identities below still require verification."}
                </p>
              </div>
              <span className="verdict-pill tint-signal">
                {webTeam.length} verified · {webTeamLeads.length} to verify
              </span>
            </header>
            {webTeam.length > 0 && <div className={`mt-5 grid gap-3 ${webTeam.length > 1 ? "xl:grid-cols-2" : ""}`}>
              {webTeam.map((p, i) => {
                const roleProof = safeSourceLink(p.sourceUrl ?? p.source);
                const continuity = leadershipForMember(p);
                const continuityProfile = safeSourceLink(continuity?.linkedin
                  ? /^https?:\/\//i.test(continuity.linkedin) ? continuity.linkedin : `https://${continuity.linkedin}`
                  : undefined);
                const continuityLabel = continuity?.state === "current"
                  ? "current in provider record"
                  : continuity?.state === "departed"
                    ? continuity.ended
                      ? `provider record ends ${frozenDateLabel(continuity.ended)}`
                      : "provider record marks role ended"
                    : continuity?.state === "absent"
                      ? "continuity not established"
                      : null;
                return (
                <article key={`${p.name}:${p.handle ?? ""}:${i}`} className="team-person-card">
                    <span className="team-person-main">
                      <Avatar src={trustedOfficialXAvatarUrl(p.avatarUrl) ?? personAvatar(p.handle, p.linkedin)} letter={(p.name.replace(/^@/, "")[0] ?? "?").toUpperCase()} size={48} rounded="rounded-full" letterClass="text-[13px]" />
                      <span className="text-[15.5px] font-medium text-ink">{p.name}</span>
                      {p.handle && <span className="mono text-[11.5px] text-ink-faint">{p.handle}</span>}
                      <span className="chip tint-signal shrink-0 normal-case tracking-normal">{formatRoleLabel(p.role)}</span>
                      {p.linkedin && (
                        <a href={`https://${p.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>
                      )}
                      {roleProof && (
                        <a href={roleProof.href} target="_blank" rel="noreferrer" className="link-ext text-[11px]">Open role source</a>
                      )}
                      {continuityLabel && (
                        <span className={`chip ${continuity?.state === "current" ? "tint-pass" : continuity?.state === "departed" ? "tint-caution" : ""}`}>
                          {continuityLabel}
                        </span>
                      )}
                      {continuityProfile && (
                        <a href={continuityProfile.href} target="_blank" rel="noreferrer" className="link-ext text-[11px]">Confirm continuity</a>
                      )}
                      {p.developerProfiles?.map((profile) => {
                        const profileLink = safeSourceLink(profile.url);
                        const profileProof = safeSourceLink(profile.sourceUrl);
                        if (!profileLink) return null;
                        return (
                          <span key={`${profile.provider}:${profile.url}`} className="inline-flex items-center gap-1">
                            <a href={profileLink.href} target="_blank" rel="noreferrer" className="link-ext text-[11px]">
                              {profile.provider === "github" ? "GitHub" : "Hugging Face"}
                            </a>
                            {profileProof && (
                              <a href={profileProof.href} target="_blank" rel="noreferrer" className="text-[10px] text-ink-faint underline-offset-2 hover:underline">
                                profile link proof
                              </a>
                            )}
                          </span>
                        );
                      })}
                      <span className="team-person-evidence">
                        {p.evidence ? `${plainLanguageSummary(p.evidence)} ` : ""}
                        <span className="mono">Source: {sourceProviderLabel(p.provider ?? p.source)}.</span>
                      </span>
                    </span>
                    {p.handle && onAudit ? (
                      <button onClick={() => onAudit(p.handle!)} className="btn-secondary min-h-9 shrink-0 px-3 text-[11.5px]">Review</button>
                    ) : (
                      <span className="shrink-0 text-[11px] text-ink-faint">No X profile</span>
                    )}
                  {p.projects && p.projects.length > 0 && (
                    <div className="mt-3 flex min-w-full flex-wrap items-center gap-1.5 pl-[48px] text-[11px] text-ink-faint">
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
                </article>
                );
              })}
            </div>}
            {webTeamLeads.length > 0 && (
              <div className="mt-5 border-t border-line/70 pt-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="text-[14px] font-medium text-ink">Needs verification</h4>
                  <span className="chip tint-caution">{webTeamLeads.length} team {webTeamLeads.length === 1 ? "lead" : "leads"}</span>
                  <span className="text-[11px] text-ink-faint">not identity proof · not scored</span>
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
            {unmatchedLeadershipRows.length > 0 && (
              <div className="mt-5 border-t border-line/70 pt-4">
                <h4 className="text-[14px] font-medium text-ink">Leadership records to reconcile</h4>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                  Provider records that do not map to a source-grounded roster card. They are context, not additional team members.
                </p>
                <ol className="mt-2 divide-y divide-line/60 rounded-xl border border-line/70">
                  {unmatchedLeadershipRows.map((row, index) => {
                    const profile = safeSourceLink(row.linkedin
                      ? /^https?:\/\//i.test(row.linkedin) ? row.linkedin : `https://${row.linkedin}`
                      : undefined);
                    const stateLabel = row.state === "current"
                      ? "provider record lists project"
                      : row.state === "departed"
                        ? row.ended
                          ? `provider record ends ${frozenDateLabel(row.ended)}`
                          : "provider record marks role ended"
                        : "provider record did not answer for this project";
                    return (
                      <li key={`${row.name}:${row.role}:${index}`} className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-[12px]">
                        <span className="font-medium text-ink">{row.name}</span>
                        <span className="text-ink-faint">{row.role}</span>
                        <span className={`chip ${row.state === "current" ? "tint-pass" : row.state === "departed" ? "tint-caution" : ""}`}>{stateLabel}</span>
                        {profile && <a href={profile.href} target="_blank" rel="noreferrer" className="link-ext ml-auto text-[11px]">Confirm on LinkedIn</a>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            {f.prior_handles && f.prior_handles.length > 0 && (
              <p className="mt-4 text-[12.5px] leading-relaxed text-caution">
                ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
              </p>
            )}
          </section>
        ) : (
          <div className="legacy-reading-duplicate panel mt-3 flex items-start gap-3 px-4 py-3">
            <span className={`chip normal-case mt-0.5 ${displayIdentityConfidence === "SuspectedImpersonation" ? "tint-unverifiable" : ""}`}>
              {displayIdentityConfidence === "Confirmed"
                ? "Identity verified"
                : displayIdentityConfidence === "Probable"
                  ? "Identity link found"
                  : displayIdentityConfidence === "SuspectedImpersonation"
                    ? "Possible impersonation"
                    : "Identity not verified"}
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

        <details id="evidence-ledger" className="canonical-evidence-disclosure panel mt-5 scroll-mt-28">
          <summary>
            <span>
              <strong>Sources, provenance and frozen evidence</strong>
              <small>The complete source ledger, report date, graph screen and profile-authenticity evidence.</small>
            </span>
            <span className="mono">Evidence appendix</span>
          </summary>
          <div className="canonical-evidence-disclosure-body">
        <section className="panel px-5 py-5" aria-label="Where this evidence came from">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="eyebrow text-signal-lift">Sources</p>
              <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">Evidence saved with this report</h2>
            </div>
            <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
              SAVED WITH REPORT
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
              title="Saved sources"
              tone="signal"
              count={`${visibleIntelligenceCount} sources and leads`}
              items={provenanceRail}
              footer={(f.sourceArtifacts?.length ?? 0) > 0 ? <a href="#frozen-source-ledger" className="inline-flex min-h-8 items-center text-signal-lift hover:underline">View source details</a> : undefined}
            />
            <ReportCanvasRailCard title="Report date" tone="neutral" items={freshnessRail} />
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

        <FrozenSourceLedger artifacts={f.sourceArtifacts ?? []} subjectHandle={report.handle} profile={fundScaleProfile} roles={roles} />
          </div>
        </details>

        {/* role breakdown — governing role full-width and expanded, the rest below */}
        <div id="role-breakdown" className="legacy-reading-duplicate scroll-mt-28">
          <Section title="Score breakdown" kicker="Each role is checked separately. The lowest role score is used.">
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
              <Section title="Wallets and blockchain links" kicker="addresses tied to them · strongest links shown first">
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
                          {w.screen && (() => {
                            const view = walletScreenView(w.screen.status);
                            const risk = w.screen.risk;
                            return (
                              <div className="mt-1.5">
                                <div className="flex flex-wrap gap-1">
                                  <span className={`chip ${view.tint}`}>{view.label}</span>
                                  {w.screen.entity?.name && (
                                    <span className="chip">
                                      {w.screen.entity.name}{w.screen.entity.type ? ` · ${w.screen.entity.type}` : ""}
                                    </span>
                                  )}
                                  {risk && (
                                    <span className="chip tint-avoid">
                                      {risk.level} {risk.score}/100{risk.greatestCategory ? ` · ${risk.greatestCategory}` : ""}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] leading-snug text-ink-faint">{w.screen.detail}</p>
                                {risk?.topSources.slice(0, 3).map((source) => (
                                  <p key={source.seed} className="mt-0.5 text-[11px] leading-snug text-ink-faint">
                                    {source.direction === "backward" ? "Funded from" : "Sent to"} {source.seedName || shortAddr(source.seed)}
                                    {source.category ? ` (${source.category})` : ""} · {source.hops} hop{source.hops === 1 ? "" : "s"}
                                    {source.usd > 0 ? ` · $${Math.round(source.usd).toLocaleString()}` : ""}
                                  </p>
                                ))}
                                <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">
                                  Arkham · address {walletBindingLabel(w.screen.binding)} · checked {new Date(w.screen.capturedAt).toLocaleString()}
                                </p>
                              </div>
                            );
                          })()}
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
                      <p>
                        {portfolioLeads.length} candidate{portfolioLeads.length === 1 ? " was" : "s were"} discovered, but none passed deterministic relationship verification. They remain outside the score and graph.
                      </p>
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Unverified portfolio candidates">
                        {portfolioLeads.slice(0, 10).map((lead, index) => {
                          const links = lead.sources.map((source) => ({ source, link: safeSourceLink(source.url) }))
                            .filter((row): row is { source: (typeof lead.sources)[number]; link: NonNullable<ReturnType<typeof safeSourceLink>> } => Boolean(row.link));
                          return (
                            <li key={`${lead.investorEntityName ?? "unknown"}:${lead.projectName}:${index}`} className="panel-inset px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-ink">{lead.projectName}</span>
                                <span className="chip tint-caution">not verified</span>
                              </div>
                              <p className="mt-1 text-[11px] text-ink-faint">
                                {lead.investorEntityName
                                  ? `Claimed investor: ${lead.investorEntityName}${lead.attribution === "affiliated_fund" ? " · affiliated fund" : ""}`
                                  : "Investor attribution missing from discovery output"}
                              </p>
                              {links.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {links.slice(0, 3).map(({ source, link }) => (
                                    <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="btn-chip min-h-8 normal-case tracking-normal" title={source.title ?? link.label}>
                                      {source.title ?? link.label}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-[11px] text-avoid">No inspectable source URL survived.</p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
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

          {displayFounderSummary && (
            <div className="mb-3 min-w-0 break-inside-avoid">
              <Section title="Founder pattern" kicker="outcomes + repeat backing">
                <Card className="p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="eyebrow">Pattern</div>
                      <div className="mono text-[15px] font-medium text-ink">{displayFounderSummary.pattern}</div>
                    </div>
                    <div className="h-8 w-px bg-line" />
                    <div>
                      <div className="eyebrow">Repeat backing</div>
                      <div
                        className="mono text-[15px] font-medium"
                        style={{
                          color:
                            displayFounderSummary.repeat_backing.strength === "strong"
                              ? "var(--color-pass)"
                              : displayFounderSummary.repeat_backing.strength === "weak"
                              ? "var(--color-caution)"
                              : "var(--color-ink-faint)",
                        }}
                      >
                        {displayFounderSummary.repeat_backing.strength}
                      </div>
                    </div>
                  </div>
                  {displayFounderSummary.repeat_backing.repeat_backers.length > 0 && (
                    <p className="mt-2 text-[12.5px] text-ink-faint">
                      Returning backers: <span className="text-ink-dim">{displayFounderSummary.repeat_backing.repeat_backers.join(", ")}</span>
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

          {/* GitHub assessment — quality of work · account history · bio claims vs
              GitHub reality (resolved + frozen during the audit; self-hides when
              no account was matched) */}
          {f.githubAssessment && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="GitHub assessment" kicker="quality of work · account history · bio claims vs GitHub reality">
                <Card className="p-4">
                  {reportLane.definition.id === "kyle" && <KyleGithubSynthesis assessment={f.githubAssessment} />}
                  <GithubAssessment a={f.githubAssessment} />
                </Card>
              </Section>
            </div>
          )}

          {/* the token threat leg of the FULL scan — the subject's own token,
              scanned by the complete threat pipeline in the same run. Absent
              field = older report from before the fold-in; a note without a
              scan = the leg was skipped or failed, and says why. */}
          {(f.threat || f.threatNote) && (
            <div id="project-token-threat" className="min-w-0 scroll-mt-28 lg:col-span-2">
              <Section title="Project token · threat scan" kicker={f.threatNote ?? "the token threat leg of this audit"}>
                {f.threat ? (
                  <Card className="p-2">
                    <ThreatReport scan={f.threat} />
                  </Card>
                ) : (
                  <Card className="p-4">
                    <p className="text-[12.5px] leading-relaxed text-ink-dim">{f.threatNote}</p>
                  </Card>
                )}
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
                    Source problems · {providerGaps.length}
                  </summary>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                    These notes explain which sources did not work. They are not warnings about the subject.
                  </p>
                  <ul className="mt-2 divide-y divide-line/60">
                    {providerGaps.map((run) => (
                      <li key={run.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[11.5px]">
                        <span className="text-ink-dim">{plainLanguageSummary(run.label)}</span>
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
              <Section title="Connection web" kicker="select a node to inspect it · subject → projects → the people behind them">
                <Card className="p-2">
                  <TrustGraph nodes={visibleGraphNodes} edges={visibleGraphEdges} connections={showTrustGraphSupplemental ? connections : []} onAudit={onAudit} onOpenProject={onOpenProject ? (name) => onOpenProject(name, undefined, panelCostToken) : undefined} panelCostToken={panelCostToken} />
                </Card>
              </Section>
            </div>
          )}

          {/* ask-the-report chat — grounded in this person's own evidence.
              Also the landing point for the composition strip's "Challenge
              this" affordance. Absent from the share view. */}
          {!shareView && (
            <div id="ask-report" className="min-w-0 scroll-mt-28 lg:col-span-2">
              <ArgusEyeAssistant
                subject={report.handle}
                reportVersionId={evidenceReportVersionId}
              />
            </div>
          )}

          {/* analyst augmentation — add a piece the scan missed (verified
              before publish). The console's "Attach a document" chip lands
              here. */}
          {showCurrentIntelligence && canMutateWorkspace && (
            <div id="add-info" className="min-w-0 scroll-mt-28 lg:col-span-2">
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
            <Section title="Confirmed findings" kicker="sources and dates included · checked against other records">
              <FindingsLedger findings={publishableSubjectFindings} />
            </Section>
          </div>
        )}

        {/* Leads that name the subject themselves are never filed behind a
            disclosure the reader has to open: a reader who sees only the
            collapsed related-entity list would read this page as clean. */}
        {subjectLeads.length > 0 && !(f.socialActivity && roles.includes(SubjectClass.PROJECT)) && (
          <div id="subject-leads" className="scroll-mt-28">
            <Section title="Adverse conversation" kicker="direct-subject leads · never counted in this score">
              <SubjectAccusationStage
                leads={subjectLeads}
                subject={report.handle}
                summary={subjectLeadSummary}
                panelCostToken={panelCostToken}
              />
            </Section>
          </div>
        )}

        {relatedEntityLeads.length > 0 && (
          <div id="investigative-leads" className="scroll-mt-28">
            <Section title="Worth a second look" kicker="items about related people and companies · never counted in this score">
              <details className="panel px-4 py-3">
                <summary className="cursor-pointer text-[12.5px] font-medium text-ink-dim">
                  Review {relatedEntityLeads.length} unverified follow-up lead{relatedEntityLeads.length === 1 ? "" : "s"}
                </summary>
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                  These leads are excluded from the verdict. Expand them only when you want to continue the investigation.
                </p>
                <div className="mt-3">
                  <InvestigativeLeadsLedger leads={relatedEntityLeads} subject={report.handle} />
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
            ARGUS checks each role separately and uses the lowest result. Serious findings can limit
            the score. A missing public identity does not count as wrongdoing. This report is research,
            not financial advice.
          </p>
          <RunCostLine cost={dossier.cost} />
        </div>
        </ReportExperienceLayout>
      </div>
    </div>
  );
}
