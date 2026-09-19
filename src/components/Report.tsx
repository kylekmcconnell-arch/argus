import { evidenceRetryPlan, evidenceRetryReason } from "../lib/evidenceRetry";
import { useEffect, useState } from "react";
import {
  Briefcase,
  WarningCircle,
  XCircle,
  Buildings,
  Cube,
  Handshake,
  Megaphone,
  UserCircle,
  UserFocus,
} from "@phosphor-icons/react";
import { usdCompact } from "../lib/format";
import { claimedTicker, deriveDecisionDiscovery, deriveNoticedSignals, deriveVerdictArgument } from "../lib/reportInsights";
import { materialDeltaDiscovery } from "../lib/reportDelta";
import { buildPublicClaimConflictDiscovery, buildPublicControlPathDiscovery } from "../lib/reasoningReceipts";
import { VerdictArgumentBlock } from "./InvestigatorBrief";
import { subjectCategoryLabel } from "../lib/subjectCategory";
import { isOrganizationAccount } from "../lib/investorSubject";
import { requestChallenge } from "../lib/challenge";
import { DecisionBasis } from "./DecisionBasis";
import type { DecisionLensId } from "../intelligence/types";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import type { Dossier } from "../data/dossier";
import type { SourceArtifact } from "../data/evidence";
import type { TokenDossier } from "../token/audit";
import { getProfile, SubjectClass, type RoleReport } from "../engine";
import { verdictMeta, ROLE_META, axisLabel, capLabel } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import { ProviderFailureNotice } from "./ScoreContext";
import { UsageVisuals } from "./UsageVisuals";
import { OperatorTrackRecord } from "./OperatorTrackRecord";
import { getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { explorer, shortAddr, walletBindingLabel, walletScreenView, walletTier } from "../lib/wallets";
import { IdentitySweep } from "./IdentitySweep";
import { PfpCheck } from "./PfpCheck";
import { PersonGithub } from "./PersonGithub";
import { GithubAssessment } from "./GithubAssessment";
import { ThreatReport } from "./ThreatScanPage";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { decisionCriticalChecks, isAdverseFinding, personChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { applyReportCheckContract, hasExplicitReportCheckContract } from "../lib/reportCheckContract";
import { coverageQualifiedCompleteness, exactReportPath, presentPublicReport } from "../lib/reportPresentation";
import { reportIdentity } from "../lib/caseLabel";
import { AddInfo } from "./AddInfo";
import { DimensionChapters } from "./DimensionChapters";
import { orderByPlainAxis, personDimensionChapters, plainAxisLabel, projectAxisScores } from "../lib/dimensionChapters";
import { ScoreRing } from "./ScoreRing";
import { LinkEntity } from "./LinkEntity";
import { ArgusEyeAssistant } from "./ArgusEyeAssistant";
import { canonicalOfficialWebsite } from "../lib/fundScaleEvidence";
import { KolReport } from "./KolReport";
import { NewsSection } from "./NewsSection";
import { VcReport } from "./VcReport";
import { ProjectIntel } from "./ProjectIntel";
import { ProjectTokenCard } from "./ProjectTokenCard";
import { EntityContinuityTimeline } from "./EntityContinuityTimeline";
import { changeReportLifecycle } from "../lib/reports";
import { LegalScreen } from "./LegalScreen";
import { SanctionsNameScreen } from "./SanctionsNameScreen";
import { RingAlert } from "./RingAlert";
import { useOptionalArgusAuth } from "../auth-context";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import { isStrictFundScaleArtifact } from "../lib/fundScaleEvidence";
import { portfolioRelationshipBinding, type PortfolioBindingSubject } from "../lib/portfolioRelationshipBinding";
import { buildDecisionBasis, verifiedDecisionPressureArtifact } from "../lib/decisionBasis";
import {
  ReportCanvasNarrativeSection,
  ReportCanvasRailCard,
  type ReportCanvasNarrativeItem,
  type ReportCanvasRailItem,
} from "./ReportCanvasPrimitives";
import type { DecisionCanvasItem } from "./InvestigationDecisionCanvas";
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
import { plainLanguageSummary, plainReportStatusLabel, publicCheckLabel, publicCheckNote } from "../lib/plainLanguage";
import { teamCandidateSourceMatchesIdentity } from "../lib/teamCandidateIdentity";
import { publicFindingTitle, publicIntelligenceText, publicStrengthLabel } from "../lib/intelligencePresentation";
import { PointInTimeIntelligencePanel } from "./PointInTimeIntelligencePanel";
import { DiligenceEvidenceLedgers } from "./DiligenceEvidenceLedgers";
import { ResearchPlanPanel } from "./ResearchPlanPanel";
import { EvmControlSurfacePanel } from "./EvmControlSurfacePanel";
import { FundraisingPanel } from "./FundraisingPanel";
import { LaunchVenuePanel } from "./LaunchVenuePanel";
import { StockHealthPanel } from "./StockHealthPanel";
import { TokenizedStockPairingPanel } from "./TokenizedStockPairingPanel";
import { deriveIntelligenceBrief, isOfficialIdentityQuestion, isOfficialTokenQuestion, isProductDescriptionQuestion } from "../lib/intelligenceBrief";
import { hasBoundProjectDescription, hasBoundProjectIdentity, isReaderDecisionCheck } from "../lib/verificationQuestionPolicy";
import { reportOpeningNarrative } from "../lib/reportNarrative";
import { useReportLane } from "../reports/shared/ReportLaneContext";
import { ArgusReportShell, type MoreAction } from "../reports/argus/ArgusReportShell";
import { buildPersonReportView } from "../reports/argus/buildView";
import { DecisionChapter } from "../reports/argus/chapters/DecisionChapter";
import { ScoresChapter } from "../reports/argus/chapters/ScoresChapter";
import { ProductChapter } from "../reports/argus/chapters/ProductChapter";
import { PeopleChapter } from "../reports/argus/chapters/PeopleChapter";
import { MarketChapter } from "../reports/argus/chapters/MarketChapter";
import { SocialChapter } from "../reports/argus/chapters/SocialChapter";
import { ConnectionsChapter } from "../reports/argus/chapters/ConnectionsChapter";
import { EvidenceChapter } from "../reports/argus/chapters/EvidenceChapter";
import { HolderReconciliation } from "../reports/argus/chapters/HolderReconciliation";
import { LegacySection } from "../reports/argus/primitives";
import { linkedinIdentityMismatch, utcStamp } from "../reports/argus/model";
import type { InvestigationDecisionCanvasProps } from "../reports/shared/reportLaneRendererTypes";
import { printReportPdf, reportPdfFilename } from "../lib/printPdf";
import { exportReportDoc } from "../lib/reportExport";
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
            <VerdictPill verdict={rr.score_coverage?.provisional && rr.verdict !== "AVOID" && rr.verdict !== "UNVERIFIABLE_IDENTITY" && rr.score_total !== null ? "PROVISIONAL" : rr.verdict} />
            {rr.score_coverage?.provisional && (
              <span className="mono text-[11px] text-ink-dim">
                {rr.score_coverage.assessedAxes} of {rr.score_coverage.totalAxes} areas assessed
              </span>
            )}
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
  PartiallyCorroborated: "Partial evidence",
  Unconfirmed: "Not independently confirmed",
  Contradicted: "Conflicting evidence",
};

function relationshipSignalLabel(follows?: boolean | null, acknowledgment?: string | null): string {
  const ack = acknowledgment?.toLowerCase();
  if (ack === "endorsement") return "Public endorsement found";
  if (ack === "thanks") return "Public acknowledgment found";
  if (ack === "mention") return "Public mention found; relationship unconfirmed";
  if (ack === "none" && follows === true) return "Follows the project; no relationship confirmation found";
  if (ack === "none" || follows === false) return "No public confirmation found";
  if (follows === true) return "Follows the project; acknowledgment not checked";
  return "Independent confirmation was not completed";
}

function xProfileLink(handle: string): { href: string; label: string } | null {
  const match = handle.trim().match(/^@([A-Za-z0-9_]{1,30})$/);
  return match ? { href: `https://x.com/${match[1]}`, label: "Open X profile" } : null;
}

function xClaimSearchLink(subjectHandle: string, namedParty: string): string | null {
  const subject = subjectHandle.trim().replace(/^@/, "");
  const party = namedParty.trim().match(/^@[A-Za-z0-9_]{1,30}$/)?.[0];
  if (!subject || !party) return null;
  return `https://x.com/search?q=${encodeURIComponent(`from:${subject} ${party}`)}&src=typed_query&f=live`;
}

function CorroborationTable({
  rows,
  subjectHandle,
}: {
  rows: {
    who: string;
    rel?: string;
    follows?: boolean | null;
    ack?: string | null;
    verdict?: string;
    note?: string;
    evidenceUrl?: string;
    acknowledgmentUrl?: string;
  }[];
  subjectHandle: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim">
        These are people or organizations the subject publicly described as advisors, investors, partners, or backers. A claim is not treated as confirmed until the named party acknowledges it or another source corroborates it.
      </div>
      <div className="hidden grid-cols-[1.25fr_1.15fr_auto] gap-3 border-b border-line px-4 py-2 eyebrow sm:grid">
        <span>Named party and claimed role</span>
        <span>Independent verification</span>
        <span className="text-right">Result</span>
      </div>
      <div className="divide-y divide-line/60">
        {rows.map((r, i) => {
          const profile = xProfileLink(r.who);
          const claimSource = safeSourceLink(r.evidenceUrl);
          const acknowledgmentSource = safeSourceLink(r.acknowledgmentUrl);
          const claimSearch = claimSource ? null : xClaimSearchLink(subjectHandle, r.who);
          return (
            <div key={i} className="grid grid-cols-1 items-start gap-3 px-4 py-3 sm:grid-cols-[1.25fr_1.15fr_auto]">
              <div className="min-w-0">
                {profile ? (
                  <a href={profile.href} target="_blank" rel="noopener noreferrer" className="mono block truncate text-[12.5px] text-ink underline-offset-2 hover:text-signal-lift hover:underline">{r.who}</a>
                ) : (
                  <div className="mono truncate text-[12.5px] text-ink">{r.who}</div>
                )}
                <div className="mt-0.5 text-[11.5px] text-ink-dim">Claimed role: {r.rel || "relationship not specified"}</div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {claimSource ? (
                    <a href={claimSource.href} target="_blank" rel="noopener noreferrer" className="link-ext">Open claim source</a>
                  ) : claimSearch ? (
                    <>
                      <span className="text-ink-faint">Exact claim link not preserved in this saved scan.</span>
                      <a href={claimSearch} target="_blank" rel="noopener noreferrer" className="link-ext">Search the subject's posts</a>
                    </>
                  ) : (
                    <span className="text-ink-faint">Claim source link unavailable</span>
                  )}
                </div>
              </div>
              <div className="min-w-0 text-[12.5px] leading-relaxed text-ink-dim">
                <div>{relationshipSignalLabel(r.follows, r.ack)}</div>
                {acknowledgmentSource && (
                  <a href={acknowledgmentSource.href} target="_blank" rel="noopener noreferrer" className="link-ext mt-1.5 inline-flex">
                    {/* A row that says acknowledgment was never checked cannot
                        offer a confirmed acknowledgment (ARGUS-10). */}
                    {["endorsement", "thanks", "mention"].includes((r.ack ?? "").toLowerCase())
                      ? "Open acknowledgment"
                      : "Open the candidate source (acknowledgment not reviewed)"}
                  </a>
                )}
              </div>
              <div className="max-w-[14rem] sm:max-w-[11rem] sm:text-right">
                <span className="mono text-[11px] font-medium" style={{ color: TV_TONE[r.verdict ?? "Unconfirmed"] }}>
                  {TV_SHORT[r.verdict ?? "Unconfirmed"]}
                </span>
              </div>
            </div>
          );
        })}
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
    <Section
      title="Known connections"
      kicker={`${screen.qualifiedContributionCount} qualified record${screen.qualifiedContributionCount === 1 ? "" : "s"} screened of ${screen.contributionCount} case${screen.contributionCount === 1 ? "" : "s"} on record`}
    >
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
    if (!teamCandidateSourceMatchesIdentity(member)) return false;
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

export function Report({ dossier, onReset, onAudit, onResearchAudit, onOpenSavedResearch, onOpenTokenReport, onRescan, onOpenProject, onOpenBrief, shareView = false }: { dossier: Dossier; onReset: () => void; onAudit?: (q: string) => void; onResearchAudit?: (q: string, privateSearch?: boolean) => void; onOpenSavedResearch?: (q: string, kind: "person" | "token") => void; onOpenTokenReport?: (token: TokenDossier) => void; onRescan?: () => void; onOpenProject?: (name: string, domain?: string, panelCostToken?: string) => void; onOpenBrief?: () => void; /** Read-only share capability view: every workspace action is absent. */ shareView?: boolean }) {
  const reportLane = useReportLane();
  const [decisionLensId, setDecisionLensId] = useState<DecisionLensId>("general_diligence");
  const reportStyle = reportLane.definition.presentationStyle;
  // Null on the public share route (no AuthGate); every workspace action is
  // already absent there, so an anonymous reader is simply a viewer.
  const role = useOptionalArgusAuth()?.role ?? "viewer";
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
    // Match on the name only. Matching on a saved LinkedIn URL let one
    // mis-bound profile attach another person's employment record as this
    // person's role continuity (ARGUS-05).
    return leadershipRows.find((row) => {
      const nameKey = normalizedTeamIdentity(row.name);
      return Boolean(nameKey) && memberKeys.has(nameKey);
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
  const tokenAxisApplicability = governingRoleReport?.axis_applicability?.P3_token_conduct;
  const tokenAxisExcluded = tokenAxisApplicability?.axisTreatment === "not_applicable"
    || tokenAxisApplicability?.axisTreatment === "deferred";
  const compositionRows = [
    ...governingAxes.map(([axis, a]) => ({
    axis,
    label: diligenceAreaLabel(axis),
    score: a.score,
    weight: a.weight,
    rationale: a.rationale,
    supportCount: a.evidenceRefs?.length,
    counterCount: a.counterEvidenceRefs?.length,
    questionCount: a.gaps?.length,
    evidenceHref: f.projectStrengthBands ? `#dimension-${axis}` as const : undefined,
    })),
    ...(tokenAxisExcluded ? [{
      axis: "P3_token_conduct",
      label: "Token design and conduct",
      score: 0,
      weight: 0,
      rationale: tokenAxisApplicability.reason,
      evidenceHref: null,
      applicability: tokenAxisApplicability.axisTreatment as "not_applicable" | "deferred",
      sublabel: tokenAxisApplicability.axisTreatment === "deferred" ? "deferred until launch" : "not applicable",
      countsLine: `Project score normalized over ${governingRoleReport?.applicable_weight ?? 80} applicable points.`,
    }] : []),
  ];
  const linkedTokenDossier = f.threat?.dossier;
  const tokenPairCreatedAt = linkedTokenDossier?.pairCreatedAt ?? f.projectToken?.pairCreatedAt ?? null;
  const reportReferenceTime = Date.parse(report.finalized_at ?? f.projectToken?.capturedAt ?? "");
  const tokenLaunchAgeDays = linkedTokenDossier?.ageDays ?? (
    typeof tokenPairCreatedAt === "number"
    && Number.isFinite(tokenPairCreatedAt)
    && Number.isFinite(reportReferenceTime)
      ? Math.max(0, (reportReferenceTime - tokenPairCreatedAt) / 86_400_000)
      : null
  );
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
  const tokenSafetyAxisTreatment = f.tokenApplicability?.axisTreatment ?? tokenAxisApplicability?.axisTreatment;
  const tokenSafetyScoreSuppressed = tokenSafetyAxisTreatment === "not_applicable"
    || tokenSafetyAxisTreatment === "deferred"
    || tokenSafetyAxisTreatment === "provisional";
  const linkedTokenScore = !tokenSafetyScoreSuppressed && (linkedTokenDossier || f.projectToken?.verified)
    ? {
      label: "Token safety score",
      score: linkedTokenDossier?.score ?? null,
      verdictLabel: linkedTokenDossier?.verdict ?? "Not measured",
      // Two engines answer different questions on opposite polarities: this
      // one is quality out of 100 (higher is better), the market-mechanics
      // lens below reports risk points (higher is worse). A report that
      // published 95 PASS above 46 DANGER named neither scale (ARGUS-02).
      context: "Out of 100, higher is safer. Contract, tradeability, liquidity, holders, market data and sanctions. The market-mechanics lens reports risk points on the opposite scale.",
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
    scoreCoverage: report.score_coverage,
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
  const readinessGuidance = legacyCoverageNotCaptured
    ? "This report was saved before ARGUS recorded every check separately. The old score is kept for history, but it does not prove that every current check ran."
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
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const immutableReviewHref = liveCoreSnapshotSaved && livePersistence?.reportVersionId
    ? exactReportPath(livePersistence.reportVersionId)
    : null;
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
  // Same mint as the Share button, but returning the URL for composition (the
  // TLDR copy) instead of writing it to the clipboard directly. Null on any
  // failure so callers can fall back to the app URL.
  // Watching writes the workspace watchlist with this version's result; it
  // never mutates the frozen report, so saved versions can be watched too.
  const canWatch = !shareView && !privateSession && !embeddedFacet;
  const watch = () => {
    if (!canWatch) return;
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
      evidenceUrl: t.evidence_url,
      acknowledgmentUrl: t.acknowledgment_source_url,
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
    return isReaderDecisionCheck(check) && !(optionalSource && availabilityOnly);
  });
  const providerGaps = (f.providerSnapshot?.runs ?? []).filter((run) =>
    run.state === "partial" || run.state === "failed" || run.state === "unavailable",
  );
  const axisHref = (axis: string): `#${string}` =>
    `#decision-basis-${axis.replace(/[^a-z0-9_-]/gi, "-")}`;
  const intelligenceBrief = f.intelligence
    ? deriveIntelligenceBrief(f.intelligence, decisionLensId)
    : { supports: [], pressures: [], context: [], questions: [] };
  const boundProjectIdentity = hasBoundProjectIdentity(f);
  const boundProjectDescription = hasBoundProjectDescription(f);

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
  // Namesake tokens the scan refused to bind: their DexScreener listings
  // declare this subject's account, but nothing of the subject's own (bio,
  // posts, official site) adopts the contract. Stated so a reader who finds
  // "$CZ" trading never attributes it to the subject.
  const namesakeTokenNarrative: ReportCanvasNarrativeItem[] = (f.namesakeTokens ?? []).length > 0 && !f.projectToken
    ? [{
      id: "namesake-tokens-refused",
      title: `Token${(f.namesakeTokens ?? []).length === 1 ? "" : "s"} trading under this name (${(f.namesakeTokens ?? []).slice(0, 3).map((token) => `$${token.symbol}`).join(", ")}) ${(f.namesakeTokens ?? []).length === 1 ? "was" : "were"} launched by someone else.`,
      detail: `${(f.namesakeTokens ?? []).slice(0, 3).map((token) => `$${token.symbol} on ${token.chain} (${token.address.slice(0, 10)}…)`).join(", ")} ${(f.namesakeTokens ?? []).length === 1 ? "lists" : "list"} this account as its own social link, but anyone can attach any account to a token they deploy. Neither the subject's bio, own posts, nor official site adopts ${(f.namesakeTokens ?? []).length === 1 ? "that contract" : "those contracts"}, so ${(f.namesakeTokens ?? []).length === 1 ? "it has" : "they have"} nothing to do with the subject.`,
      provenance: "DexScreener listing, binding refused",
      href: "#decision-intelligence" as `#${string}`,
    }]
    : [];
  const intelligenceContextNarrative: ReportCanvasNarrativeItem[] = [...namesakeTokenNarrative, ...intelligenceBrief.context.map((item) => ({
    id: item.id,
    title: plainLanguageSummary(item.title),
    detail: plainLanguageSummary(item.detail),
    provenance: item.provenance,
    href: "#decision-intelligence" as `#${string}`,
  }))];

  // Real countervailing signals only: hard caps, coverage shortfalls,
  // contradictions, and mixed evidence. Collection gaps are NOT thesis risks;
  // they live once, in the verification list, and are summarized here through
  // a single aggregate row so a favorable report can never render an
  // all-clear while questions remain open.
  const confidenceLimitsBase: ReportCanvasNarrativeItem[] = [
    ...(tokenLaunchAgeDays !== null && tokenLaunchAgeDays < 30 ? [{
      id: "recent-token-launch",
      title: "The token launched recently.",
      detail: tokenLaunchAgeDays < 1
        ? "The market has less than one day of trading history. That is too little history to judge how liquidity, holder behavior, and price hold up over time."
        : `The market has about ${Math.max(1, Math.round(tokenLaunchAgeDays))} days of trading history. That is still a short record for judging how liquidity, holder behavior, and price hold up over time.`,
      provenance: "Saved market history",
      href: "#project-token" as `#${string}`,
    }] : []),
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
    // These rows carry no artifact references, which the evidence ledger
    // already says out loud. Republishing the model's self-assigned
    // confidence as ARGUS provenance turned a review lead into
    // high-confidence adverse evidence (ARGUS-07).
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
    ...decisionBasisSummary.rows.flatMap((axis) => {
      const artifact = verifiedDecisionPressureArtifact(axis);
      if (!artifact) return [];
      return [{
        id: `verified-pressure-${axis.axis}-${artifact.artifactId}`,
        title: publicFindingTitle(artifact.title),
        detail: publicIntelligenceText(artifact.excerpt || axis.rationale),
        provenance: "Verified score-limiting evidence",
        href: axisHref(axis.axis),
      }];
    }),
  ];
  const favorableVerdict = presentedVerdict === "PASS"
    || (presentedVerdict === "PROVISIONAL" && report.composite_verdict === "PASS");
  // Confidence and score are deliberately separate. An emerging band, an
  // assessed-null axis, a first-party-only source, or an unanswered question
  // may limit the score without establishing an adverse fact. Those states
  // remain visible in score composition and Verify next; only the direct,
  // verified, counter-eligible records assembled above can become cautions.
  const bandTierFor = (axis: string): string | undefined => f.projectStrengthBands?.[axis]?.tier;
  const sentence = (value: string): string => /[.!?]$/.test(value) ? value : `${value}.`;

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
        impactAxis: axis.axis,
      })));
  const axisGapQuestions: ReportCanvasNarrativeItem[] = decisionBasisSummary.rows.flatMap((axis) =>
    axis.gaps.map((gap, index) => ({
      id: `verify-axis-${axis.axis}-${index}`,
      title: plainLanguageSummary(gap),
      detail: "Worth confirming before you invest.",
      provenance: "Not yet confirmed",
      href: axisHref(axis.axis),
      impactAxis: axis.axis,
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
      .filter((item) => !(
        (f.projectToken?.verified && isOfficialTokenQuestion(item))
        || (boundProjectIdentity && isOfficialIdentityQuestion(item))
        || (boundProjectDescription && isProductDescriptionQuestion(item))
      ))
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
  // One paste, whole verdict: composed for group chats and IC memos alike.
  // The link is appended at copy time (share link when mintable, app URL else).
  const confidenceLimits: ReportCanvasNarrativeItem[] = confidenceLimitsBase.slice(0, 6);
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
  const caseArgument = deriveVerdictArgument({
    verdict: presentedVerdict,
    supports: [
      ...intelligenceBrief.supports.map((item) => item.title),
      ...axisSupportNarrative.map((item) => item.title),
    ],
    concerns: confidenceLimitsBase.map((item) => item.title),
    capReason: report.cap_applied
      ? `The score is limited because of: ${capLabel(report.cap_applied)}`
      : null,
    nextChecks: verificationNext.map((item) => item.title),
  });
  const toDecisionCanvasItems = (items: readonly ReportCanvasNarrativeItem[]): DecisionCanvasItem[] =>
    items.map((item) => ({
      label: item.title,
      ...(item.detail ? { detail: item.detail } : {}),
      ...(item.impactAxis ? { impactAxis: item.impactAxis } : {}),
      ...(item.impact ? { impact: item.impact } : {}),
    }));
  const unresolvedRequiredNextSteps: ReportCanvasNarrativeItem[] = unresolvedChecks
    .filter(isReaderDecisionCheck)
    .map((check, index) => ({
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
    confidenceLimits
      .filter((item, index, items) => {
        const key = item.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
        return items.findIndex((candidate) =>
          candidate.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ") === key,
        ) === index;
      })
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


  // Fundamentals we verified, as headline numbers. Every tile derives from a
  // frozen snapshot and is omitted when absent; nothing renders a dash.

  // Decision inputs retained from the saved-report derivations above.
  const organizationAccount = isOrganizationAccount({
    roles,
    profile: {
      handle: f.handle,
      display_name: f.display_name,
      resolved_name: f.resolved_name,
      bio: f.bio,
    },
  });
  const cleanScreens = diligenceChecks.filter((check) => check.status === "checked-empty");
  const unresolvedCheckNames = unresolvedChecks.slice(0, 3).map((check) => publicCheckLabel(check.label));
  const unresolvedCheckRemainder = Math.max(0, unresolvedChecks.length - unresolvedCheckNames.length);
  const noCleanScreenCopy = unresolvedChecks.length > 0
    ? `${unresolvedChecks.length} decision-critical ${unresolvedChecks.length === 1 ? "check remains" : "checks remain"} open or unrecorded: ${unresolvedCheckNames.join(", ")}${unresolvedCheckRemainder > 0 ? `, and ${unresolvedCheckRemainder} more` : ""}. No completed clean screen is recorded, so this report does not support an all-clear.`
    : "No completed clean screen is recorded, so this report does not support an all-clear.";
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
  const adverseVerdictNarrative = [...confidenceLimits]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 6);
  const verdictNarrative = favorableVerdict ? supportNarrative : adverseVerdictNarrative;
  const countervailingNarrative = favorableVerdict
    ? confidenceLimits
    : supportNarrative;
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

  // ── The ARGUS report (approved interactive design, Sept 2026) ──
  // One frozen version, eight chapters. Every figure below is read from the
  // derivations above; the view layer never rescored or rewrites evidence.
  const tokenAxisTreatment = f.tokenApplicability?.axisTreatment ?? tokenAxisApplicability?.axisTreatment ?? null;
  const reportView = buildPersonReportView({
    dossier: f,
    isProject: roles.includes(SubjectClass.PROJECT),
    presentedVerdict,
    scoreFinal: presentation.final,
    publishedScore: presentation.primaryScore && typeof report.governing_score === "number" ? report.governing_score : null,
    withheldNote: legacyCoverageNotCaptured ? readinessGuidance : plainLanguageSummary(presentation.note ?? readinessGuidance),
    compositionRows: presentation.primaryScore ? compositionRows : [],
    decisionRows: decisionBasisSummary.rows,
    capNote: report.cap_applied ? `limited by ${capLabel(report.cap_applied)}` : null,
    statusLine: [
      plainReportStatusLabel(presentation.resultLabel),
      presentation.displayVerdict !== "PROVISIONAL" ? presentation.displayVerdict : null,
      presentation.secondarySignal,
    ].filter(Boolean).join(" · "),
    tokenScore: linkedTokenScore
      ? {
        score: linkedTokenScore.score,
        verdict: linkedTokenDossier?.verdict ?? null,
        rows: (linkedTokenDossier?.axes ?? []).map((axis) => ({ axis: axis.key, label: axis.label, score: axis.score, weight: axis.weight, rationale: axis.rationale })),
        unavailableCopy: linkedTokenScore.unavailableCopy,
      }
      : null,
    tokenTreatment: tokenAxisTreatment,
    tokenTreatmentReason: f.tokenApplicability?.reason ?? tokenAxisApplicability?.reason ?? null,
    openingSummary: plainLanguageSummary(openingSubjectSummary || f.bio || ""),
    basicFacts,
    fundingEvidence,
    webTeam,
    readiness: { successful: readiness.successful, applicable: readiness.applicable },
    verificationQuestions: allVerificationQuestions,
    supports: supportNarrative,
    concerns: confidenceLimits,
    remainingPoints: remainingPointsItems,
    caseLabel: caseLabel ?? null,
    auditId: report.audit_id,
    ...(versionContext?.version ? { version: versionContext.version } : {}),
    savedAt: versionContext?.createdAt ?? (liveCoreSnapshotSaved ? report.finalized_at : null) ?? report.finalized_at ?? null,
    attestation: versionContext?.attestationState ?? null,
    relatedLeadCount: relatedEntityLeads.length,
    liveSaved: liveCoreSnapshotSaved,
    contradictions: visibleContradictions,
    provisionalNote: !presentation.final && presentation.primaryScore ? plainLanguageSummary(presentation.note) : null,
    sourcedAreas: readiness.decisionAxisTotal != null && readiness.decisionAxisTotal > 0 && readiness.evidenceBackedAxes != null
      ? { backed: readiness.evidenceBackedAxes, total: readiness.decisionAxisTotal }
      : null,
    discovery: materialChangeDiscovery ?? controlPathDiscovery ?? claimConflictDiscovery ?? decisionDiscovery,
    openChecks: unresolvedRequiredNextSteps.map((item) => ({ label: item.title, ...(item.detail ? { note: item.detail } : {}) })),
    legacyCoverageNote: legacyCoverageNotCaptured ? `Older report: check details unavailable. ${readinessGuidance}` : null,
    favorable: favorableVerdict,
    subjectLeadSummary,
    subjectLeadCount: subjectAdverseLeads.length,
    cleanScreenLabels: cleanScreens.map((check) => check.label),
    noCleanScreenCopy,
    capLabel: report.cap_applied ? capLabel(report.cap_applied) : null,
    identityLabel: displayIdentityConfidence === "SuspectedImpersonation"
      ? { label: "Possible impersonation", tone: "red" }
      : displayIdentityConfidence === "Confirmed"
        ? { label: "Identity verified", tone: "green" }
        : displayIdentityConfidence === "Probable"
          ? { label: "Identity link found", tone: "amber" }
          : organizationAccount
            ? { label: "Organization unverified", tone: "amber" }
            : { label: "Identity not verified", tone: "neutral" },
    categoryLabel: f.subjectCategory
      ? { label: subjectCategoryLabel(f.subjectCategory), basis: (f.subjectCategory.basis ?? []).join(" ") }
      : null,
    isStaleQuestion: (item) => Boolean(
      (f.projectToken?.verified && isOfficialTokenQuestion(item))
      || (boundProjectIdentity && isOfficialIdentityQuestion(item))
      || (boundProjectDescription && isProductDescriptionQuestion(item)),
    ),
  });
  const exportBrief = async () => {
    const { downloadBriefPdf } = await import("../reports/argus/downloadBrief");
    await downloadBriefPdf(reportView, `${reportPdfFilename(f.display_name || f.handle)}.pdf`);
  };
  const moreActions: MoreAction[] = [
    ...(onOpenBrief ? [{ label: "Case brief", detail: "Analyst decision brief for this case", onClick: onOpenBrief }] : []),
    ...(onRescan ? [{ label: "Rescan", detail: "Run this audit again, fresh", onClick: onRescan }] : []),
    { label: "Print the full report", detail: "Every chapter, through your browser", onClick: () => printReportPdf(f.handle) },
    { label: "Google Doc", detail: ".doc to open from Drive or Word", onClick: () => exportReportDoc(dossier) },
    { label: "New audit", onClick: onReset },
    ...(canArchive ? [{ label: archiveState === "error" ? "Archive failed · retry" : "Archive case", detail: "Keeps the saved report; revokes share links", onClick: () => void archive() }] : []),
  ];
  const shareVersionId = f.versionContext?.reportVersionId
    ?? (f.persistence?.state === "persisted" ? f.persistence.reportVersionId : undefined);
  const holderReconciliation = (
    <HolderReconciliation
      holder={f.holderProfile}
      largestPct={(f.threat as { tokenomics?: { realHolderTopPct?: number } } | null | undefined)?.tokenomics?.realHolderTopPct ?? null}
      largestAddress={(linkedTokenDossier as unknown as { topHolders?: Array<{ address: string; percent: number }> } | undefined)?.topHolders
        ?.find((holder) => Math.abs(holder.percent - ((f.threat as { tokenomics?: { realHolderTopPct?: number } } | null | undefined)?.tokenomics?.realHolderTopPct ?? -1)) < 0.0001)?.address ?? null}
      riskVerdict={(f.threat as { call?: { verdict?: string } } | null | undefined)?.call?.verdict ?? null}
    />
  );
  const developerCanvasProps: InvestigationDecisionCanvasProps = {
    presentationStyle: reportStyle,
    subjectName: f.display_name || f.handle,
    subjectSummary: openingSubjectSummary,
    reportSummary: f.headline,
    verdictLabel: m.label,
    score: presentation.primaryScore && typeof report.governing_score === "number" ? report.governing_score : null,
    favorable: favorableVerdict,
    verdictTone: decisionNarrativeTone,
    argument: caseArgument,
    supports: decisionCanvasSupports,
    concerns: decisionCanvasConcerns,
    context: decisionCanvasContext,
    nextSteps: decisionCanvasNextSteps,
    verified: decisionCanvasVerified,
    coveragePercent: readiness.coveragePercent,
    successful: readiness.successful,
    applicable: readiness.applicable,
    checkScopeLabel: "Required report checks",
    ...(presentation.primaryScore && compositionRows.length > 0 ? { composition: compositionRows } : {}),
    secondaryScore: linkedTokenScore,
  };

  const decisionBefore = (
    <>
      {!versionContext && (showCurrentIntelligence || privateSession) && (
        <div className="rd-legacy" style={{ marginTop: 0, marginBottom: 18 }}>
          <LiveSupplementalNotice private={privateSession} persisted={livePersistence?.state === "persisted"} />
        </div>
      )}
      {persistencePending && (
        <div className="status-box" role="status" style={{ marginTop: 0, marginBottom: 18 }}>Saving this report before running extra checks…</div>
      )}
      {(persistenceFailed || persistenceMissingCapability) && (
        <div className="review-banner" role="alert">
          <span className="review-icon" aria-hidden="true">△</span>
          <div>
            <strong>Extra checks are paused because this report was not saved correctly.</strong>
            <p>Run a new scan before trying them again.{f.persistence?.state === "failed" && f.persistence.reason ? ` Save error: ${f.persistence.reason}` : ""}</p>
          </div>
        </div>
      )}
      {showTrustGraphSupplemental && <div className="rd-legacy" style={{ marginTop: 0 }}><RingAlert handle={report.handle} onAudit={onAudit} snapshotVersion={versionContext?.version} /></div>}
      {(f.protocolTvl?.hacks?.length || hasTerminalXState) ? <div className="rd-legacy" style={{ marginTop: 0, marginBottom: 18 }}><CriticalSubjectAlerts dossier={f} /></div> : null}
      {decisionFrameworkUnavailable && (
        <div className="review-banner" aria-label={routingUnresolved ? "Project routing unresolved" : "Scoring output incomplete"}>
          <span className="review-icon" aria-hidden="true">△</span>
          <div>
            <strong>
              {routingUnresolved
                ? "Project routing unresolved: ARGUS collected intelligence, but did not select a scoring methodology."
                : `Scoring output incomplete: ARGUS resolved this subject to ${resolvedRoleLabel}, but the scoring pass did not complete.`}
            </strong>
            <p>
              {routingUnresolved
                ? "ARGUS could not confirm whether this is a project, organization, token, or person. The sources remain available, but this report does not have a usable result."
                : `The scoring step did not finish. The sources remain available, but this report does not have a usable result.`}
              {` ${readiness.successful} checks completed; ${visibleIntelligenceCount} sources and possible leads saved.`}
            </p>
          </div>
          {onRescan && !shareView && (
            <button type="button" className="textbtn" onClick={onRescan}>{routingUnresolved ? "Run corrected investigation →" : "Retry scoring investigation →"}</button>
          )}
        </div>
      )}
      {partialAxisAssessment && (
        <div className="review-banner" aria-label="Partial decision assessment">
          <span className="review-icon" aria-hidden="true">△</span>
          <div>
            <strong>Partial decision assessment: {governingAxes.length} of {expectedGoverningAxes.length} decision areas were assessed.</strong>
            <p>{unmeasuredGoverningAxes.map(axisLabel).join(" and ")} remain unmeasured, so no overall score was produced and missing evidence was not treated as zero.</p>
          </div>
          {onRescan && !shareView && <button type="button" className="textbtn" onClick={onRescan}>Run a fresh assessment →</button>}
        </div>
      )}
    </>
  );

  const adverseSignalCount = diligenceChecks.filter(isAdverseFinding).length + visibleContradictions.length;
  const decisionAfter = (
    <>
    {presentation.final && !legacyCoverageNotCaptured && (
      <p className="subtle-note" aria-label="Verdict support summary">
        {verifiedDecisionFactCount > 0 && <>{verifiedDecisionFactCount} facts confirmed · </>}
        {cleanScreens.length} screens clean · {" "}
        {adverseSignalCount > 0
          // A neutral assessment null or a profile-photo triage lead is never
          // counter-evidence; isAdverseFinding excludes both from the tally.
          ? <span>{adverseSignalCount} warning {adverseSignalCount === 1 ? "sign" : "signs"}</span>
          // Never assert a zero under an adverse verdict; route to the basis instead.
          : !favorableVerdict
            ? <a href="#decision-basis">see why this scored this way</a>
            // An uncorroborated lead naming the subject is not a zero.
            : subjectAdverseLeads.length > 0
              ? <a href="#subject-leads">{subjectAdverseLeads.length} unverified {subjectAdverseLeads.length === 1 ? "lead" : "leads"} about this subject</a>
              : <span>0 warning signs</span>}
      </p>
    )}
    <details className="disclosure rd-case-detail" open={printExpanded || undefined}>
      <summary>The full case behind this decision</summary>
      <div className="rd-legacy" id="decision-summary">
        <div className="panel px-5">
          <div className="border-b border-line/70 py-4" aria-label="Case synthesis">
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
                : "No verified adverse finding was recorded. Lower-scoring areas reflect limited demonstrated evidence or maturity; review the score breakdown and Verify next."}
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
                // The all-clear sentence must not even be constructible while
                // an adverse lead names the subject.
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
        </div>
      </div>
    </details>
    </>
  );

  const otherRoleReports = report.role_reports.filter((rr) => rr.role !== report.governing_role);
  const scoresLegacy = (
    <LegacySection title="Evidence behind each scoring area" note="The saved chapter for every scored dimension, with its evidence band, sources and open questions.">
      <div id="decision-basis" className="scroll-mt-28">
        <DecisionBasis
          roleReport={governingRoleReport}
          catalog={f.axisEvidenceCatalog}
          lineageVersion={f.axisCitationVersion}
          unavailableReason={routingUnresolved ? "routing" : scoringOutputIncomplete ? "scoring" : undefined}
          onRescan={shareView ? undefined : onRescan}
        />
      </div>
      {f.projectStrengthBands && (
        <DimensionChapters
          chapters={personDimensionChapters(f.projectStrengthBands, projectAxisScores(report))}
          checksHref="#scan-methodology"
        />
      )}
      {otherRoleReports.length > 0 && (
        <div id="role-breakdown" className="mt-5 grid gap-3 sm:grid-cols-2">
          {otherRoleReports.map((rr) => <RoleCard key={rr.role} rr={rr} governing={false} scoreState={roleScoreState} />)}
        </div>
      )}
    </LegacySection>
  );

  const productLegacy = (
    <LegacySection title="Facts, history and code on record" note="The saved fact ledger, contradictions, lineage and code assessment behind this chapter.">
      {showBasicFacts && (
        <div id="basic-facts" className="scroll-mt-28">
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
      {f.entityContinuity && <div id="key-developments" className="scroll-mt-28"><EntityContinuityTimeline snapshot={f.entityContinuity} /></div>}
      {f.githubAssessment && (
        <Section title="GitHub assessment" kicker="quality of work · account history · bio claims vs GitHub reality">
          <Card className="p-4">
            {reportLane.renderers.githubSynthesis?.(f.githubAssessment)}
            <GithubAssessment a={f.githubAssessment} />
          </Card>
        </Section>
      )}
      {showCurrentIntelligence && panelCostToken && <PersonGithub className="min-w-0" handle={report.handle} name={f.display_name} bio={f.bio} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />}
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
          <Section title="Project intelligence" kicker="domain age + claimed security audits; an established brand on a fresh domain is a contradiction">
            <ProjectIntel domain={dom} />
          </Section>
        ) : null;
      })()}
    </LegacySection>
  );

  const peopleLegacy = (
    <LegacySection title="Identity, roles and track record on record" note="Unverified team leads, provider records, ventures and wallet links. Leads are not identity proof and are not scored.">
      {webTeamLeads.length > 0 && (
        <div id="team-leads" className="scroll-mt-28">
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
                {member.linkedin && <span className="text-[11px] text-ink-faint">LinkedIn candidate recorded</span>}
                <span className="text-[11px] text-ink-faint">{sourceProviderLabel(member.provider ?? member.source)}</span>
                {member.evidence && <span className="min-w-full text-[11px] leading-relaxed text-ink-faint">{member.evidence}</span>}
                {member.handle && onAudit && !shareView && <button type="button" onClick={() => onAudit(member.handle!)} className="btn-chip tint-caution ml-auto min-h-11">Verify →</button>}
              </div>
            ))}
          </Card>
        </div>
      )}
      {unmatchedLeadershipRows.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[16px] font-semibold text-ink">Leadership records to reconcile</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">Provider records that do not map to a roster card. They are context, not additional team members.</p>
          <ol className="mt-3 divide-y divide-line/60 rounded-xl border border-line/70">
            {unmatchedLeadershipRows.map((row, index) => {
              const profile = safeSourceLink(row.linkedin ? /^https?:\/\//i.test(row.linkedin) ? row.linkedin : `https://${row.linkedin}` : undefined);
              const mismatch = linkedinIdentityMismatch(row.name, row.linkedin);
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
                  {profile && !mismatch && <a href={profile.href} target="_blank" rel="noreferrer" className="link-ext ml-auto text-[11px]">Confirm on LinkedIn</a>}
                  {mismatch && <span className="ml-auto text-[11px] text-caution">Linked profile needs correction: apparent identity mismatch</span>}
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
      {f.operatorLaunches && (
        <OperatorTrackRecord
          history={f.operatorLaunches}
          operatorHandle={operatorHandleForDossier}
          creatorWallet={f.operatorLaunches.creatorWallet}
        />
      )}
      {evidence.ventures.length > 0 && (
        <Section title="Ventures & affiliations" kicker="founding, employment and operating ties · separate from investments">
          <Clamp itemCount={evidence.ventures.length} label="ventures">
            <Card className="divide-y divide-line/60">
              {evidence.ventures.map((v, i) => {
                const sourceBacked = v.artifact_verified === true;
                const isLead = v.evidence_origin === "model_lead" || v.artifact_verified === false;
                const evidenceState = sourceBacked ? "source-backed" : isLead ? "unverified lead" : "legacy curated";
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12.5px]">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: v.outcome === "Rug" ? "var(--color-avoid)" : v.outcome === "Acquisition" || v.outcome === "IPO" ? "var(--color-pass)" : "var(--color-ink-faint)" }}
                    />
                    {onOpenProject && !shareView ? (
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
      )}
      {displayFounderSummary && (
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
                <div className="mono text-[15px] font-medium">{displayFounderSummary.repeat_backing.strength}</div>
              </div>
            </div>
            {displayFounderSummary.repeat_backing.repeat_backers.length > 0 && (
              <p className="mt-2 text-[12.5px] text-ink-faint">
                Returning backers: <span className="text-ink-dim">{displayFounderSummary.repeat_backing.repeat_backers.join(", ")}</span>
              </p>
            )}
          </Card>
        </Section>
      )}
      {advisedRows.length > 0 && (
        <Section title="Advisory graveyard" kicker="projects lent their name to">
          <Card className="divide-y divide-line/60">
            {advisedRows.map((p, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-faint)" }} />
                <span className="text-[12.5px] text-ink">{p.project_name}</span>
                {p.paid_or_allocated && <span className="chip tint-caution">allocation</span>}
                <span className="mono ml-auto text-[11px]" style={{ color: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>{p.project_outcome}</span>
                <span className="mono text-[11px]" style={{ color: TV_TONE[p.corroboration_verdict ?? "Unconfirmed"] }}>{TV_SHORT[p.corroboration_verdict ?? "Unconfirmed"]}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}
      {showOffchainSupplemental && (
        <div className="mt-3 space-y-2">
          <SanctionsNameScreen name={f.display_name} resolved={displayIdentityConfidence === "Confirmed" || displayIdentityConfidence === "Probable"} />
          <LegalScreen name={f.display_name} resolved={displayIdentityConfidence === "Confirmed" || displayIdentityConfidence === "Probable"} />
        </div>
      )}
      {showCurrentIntelligence && panelCostToken && (
        <Section title="Identity continuity" kicker="current supplemental search · not part of the stored score">
          <IdentitySweep handle={report.handle} auto panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />
        </Section>
      )}
      {showProfilePhotoSupplemental && panelCostToken && (
        <Section title="Profile photo" kicker="current supplemental overlay · outside the frozen core evidence and stored verdict">
          <PfpCheck handle={report.handle} brand={roles.some((role) => String(role) === "PROJECT") && !roles.some((role) => String(role) === "FOUNDER")} panelCostToken={panelCostToken} />
        </Section>
      )}
      {f.profileAuthenticity && (
        <FrozenProfileAuthenticityPanel
          result={f.profileAuthenticity}
          artifact={profilePhotoArtifact}
          reportVersionId={evidenceReportVersionId}
          version={versionContext?.version}
        />
      )}
    </LegacySection>
  );

  const marketLegacy = (
    <LegacySection title="Complete market record" note="The saved token and market panels, contract-control receipt and usage series behind this chapter.">
      {f.projectToken && (
        <ProjectTokenCard
          token={f.projectToken}
          chains={f.projectToken.deployedChains}
          threat={f.threat ?? undefined}
          threatNote={f.threatNote}
          showCurrentIntelligence={showCurrentIntelligence}
          refreshCurrentMarket={currentIntelligenceEnabled}
          onOpenReport={linkedTokenDossier && onOpenTokenReport && !shareView
            ? () => onOpenTokenReport(linkedTokenDossier)
            : undefined}
          onLoadCurrentIntelligence={versionContext && !shareView
            ? () => setCurrentIntelligenceVersionId(versionContext.reportVersionId)
            : undefined}
        />
      )}
      {!f.projectToken && (f.threat || f.threatNote) && (
        <div id="project-token-threat" className="scroll-mt-28">
          <Section title="Project token · threat scan" kicker={f.threatNote ?? "the token threat leg of this audit"}>
            {f.threat ? (
              <Card className="p-2"><ThreatReport scan={f.threat} /></Card>
            ) : (
              <Card className="p-4"><p className="text-[12.5px] leading-relaxed text-ink-dim">{f.threatNote}</p></Card>
            )}
          </Section>
        </div>
      )}
      {(f.protocolTvl || f.protocolFees || f.holderProfile) && (
        <div className="mt-3"><UsageVisuals tvl={f.protocolTvl} fees={f.protocolFees} holders={f.holderProfile} /></div>
      )}
      {f.evmControlReality && <EvmControlSurfacePanel snapshot={f.evmControlReality} />}
      {f.stockHealth && <StockHealthPanel snapshot={f.stockHealth} />}
      {f.tokenizedStockPairing && <TokenizedStockPairingPanel snapshot={f.tokenizedStockPairing} />}
      {f.launchVenueSubject && <LaunchVenuePanel snapshot={f.launchVenueSubject} />}
    </LegacySection>
  );

  const socialLegacy = (
    <LegacySection title="Adverse conversation, news and promotion" note="Direct-subject leads are never counted in the score; they are shown so a quiet page is never read as an all-clear.">
      {(subjectAdverseLeads.length > 0 || (f.socialActivity?.adverseMentions?.length ?? 0) > 0) && (
        <div id="subject-leads" className="scroll-mt-28">
          <Section title="Adverse conversation" kicker="direct-subject leads · never counted in this score">
            <SubjectAccusationStage
              leads={subjectAdverseLeads}
              socialLeads={f.socialActivity?.adverseMentions}
              subject={report.handle}
              summary={subjectLeadSummary}
              panelCostToken={panelCostToken}
            />
          </Section>
        </div>
      )}
      {showCurrentIntelligence && panelCostToken && roles.some((r) => r === "KOL") && (
        <Section title="KOL report" kicker="a promoter's threat model: did their shilled tokens rug, and is their reach real?">
          <KolReport handle={report.handle} promotions={evidence.promotions ?? []} associates={evidence.associates ?? []} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} onAudit={onAudit} />
        </Section>
      )}
      {showOffchainSupplemental && (
        <Section title="In the news" kicker="current supplemental search · not part of the stored score">
          <NewsSection query={f.display_name || report.handle} handle={report.handle} />
        </Section>
      )}
    </LegacySection>
  );

  const connectionsLegacy = (
    <LegacySection title="Relationship records" note="The connection workspace, funding and investor ledgers, claimed relationships and wallet links saved with this report.">
      <div id="relationships" className="scroll-mt-28" />
      {reportLane.renderers.connectionWorkspace?.({
        dossier: f,
        nodes: visibleGraphNodes,
        edges: visibleGraphEdges,
        connections: showTrustGraphSupplemental ? connections : [],
        onAudit: shareView ? undefined : onResearchAudit ?? onAudit,
        onOpenSavedReport: shareView ? undefined : onOpenSavedResearch,
        onOpenProject: onOpenProject && !shareView ? (name) => onOpenProject(name, undefined, panelCostToken) : undefined,
        shareView,
      })}
      {!reportLane.renderers.connectionWorkspace && (visibleGraphEdges.length > 0 || (showTrustGraphSupplemental && connections.length > 0)) && (
        <Section title="Connection web" kicker="select a node to inspect it · subject → projects → the people behind them">
          <Card className="p-2">
            <TrustGraph nodes={visibleGraphNodes} edges={visibleGraphEdges} connections={showTrustGraphSupplemental ? connections : []} onAudit={onAudit} onOpenProject={onOpenProject ? (name) => onOpenProject(name, undefined, panelCostToken) : undefined} panelCostToken={panelCostToken} />
          </Card>
        </Section>
      )}
      <FundraisingPanel dossier={f} />
      <DiligenceEvidenceLedgers
        className="mt-3"
        company={f.companyEnrichment}
        officialWebsite={f.website}
        protocolFunding={f.protocolFunding}
        protocolTvl={f.protocolTvl}
        canonicalGeckoId={f.projectToken?.coingeckoId}
      />
      {corroborationRows.length > 0 && (
        <Section title="Claimed relationships" kicker="project claims checked against public evidence">
          <Clamp itemCount={corroborationRows.length} label="relationships">
            <CorroborationTable rows={corroborationRows} subjectHandle={report.handle} />
          </Clamp>
        </Section>
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

      {showCurrentIntelligence && panelCostToken && roles.some((r) => r === "INVESTOR") && (
        <Section title="VC portfolio leads" kicker="paid current supplemental search · unverified candidates · excluded from graph and verdict">
          <VcReport key={`${report.handle}:${panelCostToken}`} handle={report.handle} name={f.display_name || report.handle} verifiedProjects={verifiedPortfolioProjects} panelCostToken={panelCostToken} onAudit={onAudit} />
        </Section>
      )}
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
    </LegacySection>
  );

  const evidenceCurrent = versionContext && !shareView ? (
    <div className="rd-legacy">
      <SnapshotEvidenceControl
        snapshotVersion={versionContext.version}
        capturedAt={versionContext.createdAt}
        subjectKind="person"
        currentIntelligenceEnabled={currentIntelligenceEnabled}
        onLoadCurrentIntelligence={() => setCurrentIntelligenceVersionId(versionContext.reportVersionId)}
      />
    </div>
  ) : null;

  const evidenceLegacy = (
    <LegacySection title="Complete evidence record" note="Checks, the intelligence ledger, the research plan, frozen sources and the tools to question or add to this report.">
      {(diligenceChecks.length > 0 || providerGaps.length > 0) && (
        <div className="min-w-0">
          {f.evidenceAttempts?.length ? <details className="panel mb-2 p-3">
            <summary className="cursor-pointer font-medium">Evidence gaps and targeted next checks</summary>
            <p className="mt-2 text-sm">{f.evidenceAttempts.filter(a => a.outcome === "accepted").length} source verification attempts accepted out of {f.evidenceAttempts.length} recorded attempts. These are attempts, not unique facts.</p>
            <ul className="mt-2 space-y-2">{evidenceRetryPlan(f.evidenceAttempts).map(item => <li key={item.questionId} className="text-sm">
              <strong>{item.questionId.replace(/[._]/g, " ")}</strong>: {item.action.replace(/_/g, " ")}. {item.reasons.map(evidenceRetryReason).join("; ")}.
            </li>)}</ul>
          </details> : null}
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
      <ProviderFailureNotice failures={f.providerFailures} />
      {f.intelligence && (
        <div id="decision-intelligence" className="scroll-mt-28">
          <PointInTimeIntelligencePanel
            snapshot={f.intelligence}
            thesisEligible={presentation.final && !decisionFrameworkUnavailable}
            governingVerdict={presentedVerdict}
            selectedLensId={decisionLensId}
            onSelectedLensChange={setDecisionLensId}
          />
        </div>
      )}
      {f.researchPlan && <ResearchPlanPanel plan={f.researchPlan} className="mt-3" />}
      {!allVerificationQuestions.length ? null : (
        <details id="follow-up-questions" className="panel mt-3 px-4 py-3" open={printExpanded || undefined}>
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink-dim">Follow up on: {allVerificationQuestions.length} important {allVerificationQuestions.length === 1 ? "question" : "questions"}</summary>
          <ul className="mt-3 space-y-2.5" aria-label="Open follow-up questions">
            {allVerificationQuestions.map((item) => (
              <li key={item.id} className="text-[12.5px] leading-relaxed text-ink-dim">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="min-w-0 text-ink">{item.title}</span>
                  {item.provenance && <span className="mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">{item.provenance}</span>}
                  {!shareView && (
                    <button type="button" onClick={() => requestChallenge(`Open question: ${item.title}`)} className="btn-chip ml-auto shrink-0">
                      Give input
                    </button>
                  )}
                </div>
                {item.detail && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{item.detail}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {publishableSubjectFindings.length > 0 && (
        <div id="publishable-findings" className="scroll-mt-28">
          <Section title="Confirmed findings" kicker="sources and dates included · checked against other records">
            <FindingsLedger findings={publishableSubjectFindings} />
          </Section>
        </div>
      )}
      <details id="evidence-ledger" className="canonical-evidence-disclosure panel mt-5 scroll-mt-28">
        <summary>
          <span>
            <strong>Sources, provenance and frozen evidence</strong>
            <small>The complete source ledger, report date and graph screen.</small>
          </span>
          <span className="mono">Evidence appendix</span>
        </summary>
        <div className="canonical-evidence-disclosure-body">
          <section className="panel px-5 py-5" aria-label="Where this evidence came from">
            <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
      {reportLane.renderers.developerTools?.(developerCanvasProps)}
      {!shareView && (
        <div id="ask-report" className="mt-5 min-w-0 scroll-mt-28">
          <ArgusEyeAssistant subject={report.handle} reportVersionId={evidenceReportVersionId} />
        </div>
      )}
      {showCurrentIntelligence && canMutateWorkspace && !shareView && (
        <div id="add-info" className="mt-3 min-w-0 scroll-mt-28">
          <AddInfo subject={report.handle} subjectKind="person" canonicalRef={report.handle} subjectGraphKey={report.handle} />
        </div>
      )}
      {showCurrentIntelligence && canMutateWorkspace && !shareView && (
        <div className="mt-3 min-w-0">
          <LinkEntity subject={report.handle} subjectKind="person" canonicalRef={report.handle} graphSubjectKey={report.handle} />
        </div>
      )}
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
    </LegacySection>
  );

  const topScores = [
    ...(reportView.primary ? [{ label: reportView.primary.id === "company" ? "Company" : "Person", value: reportView.primary.score != null ? String(reportView.primary.score) : "–" }] : []),
    ...(reportView.tokenScore ? [{ label: "Token", value: reportView.tokenScore.score != null ? String(reportView.tokenScore.score) : reportView.tokenScore.verdictWord }] : []),
  ];

  return (
    <div className="relative min-h-full">
      <ArgusReportShell
        runtime={{
          subjectName: f.display_name || f.handle,
          subjectRef: report.handle,
          caseLabel: caseLabel ?? null,
          auditId: report.audit_id,
          ...(evidenceReportVersionId ? { reportVersionId: evidenceReportVersionId } : {}),
          ...(versionContext?.version ? { version: versionContext.version } : {}),
          ...(reportView.savedAt ? { savedAt: reportView.savedAt } : {}),
          officialDomain: canonicalOfficialWebsite(f.website)?.domain ?? null,
        }}
        shareView={shareView}
        breadcrumbName={f.display_name || f.handle}
        versionLabel={versionContext ? `v${versionContext.version}` : f.live ? "live" : null}
        topScores={topScores}
        savedLine={reportView.savedLine}
        savedHref={immutableReviewHref}
        issues={reportView.issues}
        watch={canWatch ? { watched, toggle: watch } : null}
        exportBrief={exportBrief}
        share={shareView ? null : {
          ...(canShare ? {
            create: async () => {
              const response = await fetch("/api/share", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ kind: "person", ref: report.handle, reportVersionId: shareVersionId }),
              });
              const body = (await response.json().catch(() => null)) as { url?: unknown; message?: unknown } | null;
              if (!body) throw new Error("The sharing service could not be reached. Please try again.");
              if (!response.ok || typeof body.url !== "string") {
                throw new Error(typeof body.message === "string" ? body.message : "Secure share link creation failed.");
              }
              return new URL(body.url, location.origin).toString();
            },
          } : {
            unavailableReason: embeddedFacet
              ? "Share the parent investigation to share this facet."
              : "This report has not been saved as an immutable version yet, so a share link cannot be created.",
          }),
          subjectLabel: f.display_name || f.handle,
          versionLabel: versionContext ? `Version ${versionContext.version}` : "Saved version",
        }}
        more={shareView ? [] : moreActions}
        chapters={{
          decision: () => <DecisionChapter view={reportView} before={decisionBefore} after={decisionAfter} onRescan={shareView ? undefined : onRescan} />,
          scores: () => <ScoresChapter view={reportView} legacy={scoresLegacy} />,
          product: () => <ProductChapter view={reportView} legacy={productLegacy} />,
          people: () => <PeopleChapter view={reportView} legacy={peopleLegacy} />,
          market: ({ active }) => <MarketChapter view={reportView} active={active} reconciliation={holderReconciliation} legacy={marketLegacy} />,
          social: () => <SocialChapter view={reportView} legacy={socialLegacy} />,
          connections: () => <ConnectionsChapter view={reportView} legacy={connectionsLegacy} />,
          evidence: () => <EvidenceChapter view={reportView} current={evidenceCurrent} legacy={evidenceLegacy} />,
        }}
        footerNote={`Snapshot ${versionContext ? `v${versionContext.version}` : "live"}${caseLabel ? ` · Case ${caseLabel}` : ""} · Report ${report.audit_id}`}
        scope={(
          <>
            <h2 className="dialog-title">A decision brief grounded in one saved report.</h2>
            <p className="dialog-body">
              This view presents {versionContext ? `version ${versionContext.version} of the ` : "the "}{f.display_name || f.handle} report{reportView.savedAt ? `, saved ${utcStamp(reportView.savedAt)}` : ""}. Scores, verdicts and evidence are the saved record. Review warnings, reconciliation notes and the newer market snapshot never change them.
            </p>
            <p className="dialog-body">
              Source links can show newer content than the frozen artifacts. Missing evidence is shown as missing, never as zero, clean or adverse. Your checklist and watchlist stay in your browser and workspace; they are not part of shared links or the PDF brief.
            </p>
            <p className="dialog-body">ARGUS is research, not financial advice. No trade, scan or external message is performed from this view.</p>
          </>
        )}
      />
    </div>
  );
}
