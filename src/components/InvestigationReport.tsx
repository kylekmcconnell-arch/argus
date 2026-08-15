import { useRef, useState } from "react";
import { verdictMeta } from "../lib/verdict";
import { printReportPdf } from "../lib/printPdf";
import { isWatched, toggleWatch } from "../lib/watchlist";
import {
  isConfirmedWebTeamPerson,
  type Investigation,
  type WebPerson,
} from "../lib/investigation";
import { Avatar } from "./Avatar";
import { xAvatar, personAvatar } from "../lib/avatars";
import { OnChainForensics } from "./OnChainForensics";
import { deployerRoleLabel } from "../token/audit";
import { ProjectResearch } from "./ProjectResearch";
import { ProjectLinks } from "./ProjectLinks";
import { MethodologyChecklist } from "./MethodologyChecklist";
import {
  clearanceCoverage,
  decisionCriticalChecks,
  personChecks,
  reconcileInvestigationChecks,
  tokenChecks,
} from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { ArkhamName } from "./ArkhamName";
import { useArkhamLabels } from "../lib/useArkhamLabels";
import { AddInfo } from "./AddInfo";
import { EmbeddedThreatScan } from "./ThreatScanPage";
import { LinkEntity } from "./LinkEntity";
import { AskReport } from "./AskReport";
import { ArkhamGraphBridge } from "./ArkhamGraphBridge";
import { Counterparties } from "./Counterparties";
import { RiskPaths } from "./RiskPaths";
import { Holdings } from "./Holdings";
import { MoneyFlowStory } from "./MoneyFlowStory";
import { arkhamProviderEnabled } from "../lib/providerCapabilities";
import { TokenSnapshotVisuals } from "./TokenSnapshotVisuals";
import { LpCustody } from "./LpCustody";
import { MarketPerformancePanel } from "./MarketPerformancePanel";
import { UsageVisuals } from "./UsageVisuals";
import { NamesakeCheck } from "./NamesakeCheck";
import { RingAlert } from "./RingAlert";
import { TrustGraph } from "./TrustGraph";
import { PanelRequestNotice } from "./PanelRequestNotice";
import { investigationContribution, getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import {
  ArrowClockwise,
  ArrowLeft,
  Briefcase,
  ChartLineUp,
  ClipboardText,
  Database,
  DotsThree,
  Graph,
  IdentificationBadge,
  ShareNetwork,
  ShieldWarning,
  Star,
} from "@phosphor-icons/react";
import { InvestigationDecisionCanvas } from "./InvestigationDecisionCanvas";
import { SecondOpinion } from "./SecondOpinion";
import { ExpandableText } from "./ExpandableText";
import { ReportDisclaimer } from "./ReportDisclaimer";
import { CopyTldrButton, ScoreContextStrip } from "./ScoreContext";
import { ReportCanvasSectionNav } from "./ReportCanvasPrimitives";
import {
  BasicFactsPanel,
  type BasicFactLeadView,
  type BasicFactView,
} from "./BasicFactsPanel";
import { formatRoleLabel, plainLanguageSummary } from "../lib/plainLanguage";
import { deriveNoticedSignals, deriveVerdictArgument, isConcentratedLiquidityPool, top10ShareFromRows } from "../lib/reportInsights";
import { deriveIntelligenceBrief } from "../lib/intelligenceBrief";
import { NoticedRail } from "./InvestigatorBrief";
import { summarizeFundingEvidence, type FundingEvidenceRound } from "../lib/fundingEvidence";
import { walletAgeFact } from "../lib/operatorTrace";
import { projectLeadIsRelevant, type ProjectLeadSubject } from "../lib/projectLeadRelevance";
import { PointInTimeIntelligencePanel } from "./PointInTimeIntelligencePanel";
import { EvmControlSurfacePanel } from "./EvmControlSurfacePanel";
import { DiligenceEvidenceLedgers } from "./DiligenceEvidenceLedgers";
import { ArgusEyeAssistant } from "./ArgusEyeAssistant";
import { projectWebSurfaces } from "../lib/projectWebSurfaces";
import { ResearchPlanPanel } from "./ResearchPlanPanel";
import type { DecisionLensId } from "../intelligence/types";

const initial = (s: string) => (s.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();

const MAX_FOUNDER_AUDITS = 5;

type TeamIdentity = {
  name?: string;
  handle?: string;
  linkedin?: string;
};

function urlMatchesProjectDomain(url: string | undefined, projectDomain: string | null): boolean {
  if (!url || !projectDomain) return false;
  try {
    const sourceHost = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return sourceHost === projectDomain
      || sourceHost.endsWith(`.${projectDomain}`)
      || projectDomain.endsWith(`.${sourceHost}`);
  } catch {
    return false;
  }
}

function normalizedPublicUrl(value?: string): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const absolute = /^https?:\/\//i.test(candidate)
    ? candidate
    : /^(?:www\.)?linkedin\.com\//i.test(candidate)
      ? `https://${candidate}`
      : null;
  if (!absolute) return null;
  try {
    const parsed = new URL(absolute);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const RECORD_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The employment record's own date, spelled the way the record spells it. */
function formatRecordDate(value: string): string {
  const parts = value.trim().match(/^(\d{4})-(\d{2})/);
  if (!parts) return value.trim();
  const month = RECORD_MONTHS[Number(parts[2]) - 1];
  return month ? `${month} ${parts[1]}` : parts[1];
}

/**
 * How old the newest thing this record said about a person was at the frozen
 * report capture, never at viewer time.
 *
 * PeopleDataLabs is a licensed copy of a LinkedIn profile and can lag the live
 * page, so a departure must never read as "as of today". The only date we hold
 * is the record's own end date; report its age and nothing more.
 */
function recordAgeLabel(value: string | undefined, referenceMs: number): string | null {
  const parts = value?.trim().match(/^(\d{4})-(\d{2})/);
  if (!parts) return null;
  const endedMs = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, 1);
  if (!Number.isFinite(endedMs) || !Number.isFinite(referenceMs) || endedMs > referenceMs) return null;
  const months = Math.floor((referenceMs - endedMs) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 1) return "less than a month old";
  if (months < 24) return `${months} month${months === 1 ? "" : "s"} old`;
  const years = Math.floor(months / 12);
  return `${years} years old`;
}

function projectLeadershipPredicates(role: string): Array<"founder" | "executive"> {
  const predicates: Array<"founder" | "executive"> = [];
  if (/\b(?:co[- ]?founder|founder|creator)\b/i.test(role)) predicates.push("founder");
  if (/\b(?:ceo|cto|coo|cfo|chief|president|director|head|lead)\b/i.test(role)) predicates.push("executive");
  return predicates;
}

/**
 * Older saved reports already contain the safe Monid roster rows, but predate
 * their basic-fact projection. Reuse only deterministic rows whose company
 * record is tied to the verified project domain. Name-only matches never pass.
 */
function domainBoundLeadershipFacts(
  projectAccount: Investigation["projectAccount"],
  projectDomain: string | null,
): BasicFactView[] {
  if (!projectAccount || !projectDomain) return [];
  return (projectAccount.webTeam ?? []).flatMap((member) => {
    if (
      member.provider !== "monid"
      || member.artifact_verified !== true
      || member.evidence_origin !== "deterministic"
      || !member.name?.trim()
      || !urlMatchesProjectDomain(member.sourceUrl, projectDomain)
    ) return [];
    const linkedin = normalizedPublicUrl(member.linkedin);
    const excerpt = `${member.name} is listed as ${member.role} in a professional record for the company matched to ${projectDomain}.`;
    const sources: NonNullable<BasicFactView["sources"]> = [{
      url: member.sourceUrl,
      title: "Company record matched to official website",
      excerpt,
      relation: "supports",
      provider: "monid",
      sourceClass: "other_public",
    }];
    if (linkedin) {
      sources.push({
        url: linkedin,
        title: "LinkedIn profile",
        excerpt,
        relation: "supports",
        provider: "monid",
        sourceClass: "other_public",
      });
    }
    return projectLeadershipPredicates(member.role).map((predicate) => ({
      factId: `domain-roster:${predicate}:${normalizedTeamIdentity(member.name)}`,
      predicate,
      value: member.name.trim(),
      qualifier: member.role,
      status: "verified" as const,
      critical: predicate === "founder",
      providerProjection: true,
      sources,
    }));
  });
}

function mergeLeadershipFacts(
  facts: readonly BasicFactView[],
  leadershipFacts: readonly BasicFactView[],
): BasicFactView[] {
  const merged = facts.map((fact) => ({ ...fact, sources: [...(fact.sources ?? [])] }));
  for (const leadership of leadershipFacts) {
    const leadershipName = typeof leadership.value === "string"
      ? normalizedTeamIdentity(leadership.value)
      : "";
    const existing = leadershipName
      ? merged.find((fact) =>
          fact.predicate === leadership.predicate
          && typeof fact.value === "string"
          && normalizedTeamIdentity(fact.value) === leadershipName)
      : undefined;
    if (!existing) {
      merged.push({ ...leadership, sources: [...(leadership.sources ?? [])] });
      continue;
    }
    const sourceKeys = new Set((existing.sources ?? []).map((source) =>
      `${source.url ?? ""}:${source.relation ?? "supports"}`));
    for (const source of leadership.sources ?? []) {
      const key = `${source.url ?? ""}:${source.relation ?? "supports"}`;
      if (!sourceKeys.has(key)) {
        existing.sources!.push(source);
        sourceKeys.add(key);
      }
    }
    existing.qualifier ||= leadership.qualifier;
  }
  return merged;
}

function normalizedTeamIdentity(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamIdentityKeys(person: TeamIdentity): Set<string> {
  const keys = new Set<string>();
  const handle = normalizedTeamIdentity(person.handle?.replace(/^@/, ""));
  const linkedin = (person.linkedin ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  const nameTokens = (person.name ?? "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const compactName = nameTokens.join("");

  if (handle) keys.add(`person:${handle}`);
  if (linkedin) keys.add(`linkedin:${linkedin}`);
  if (compactName) keys.add(`person:${compactName}`);
  if (nameTokens.length >= 2) {
    keys.add(`person:${nameTokens[0]}${nameTokens[nameTokens.length - 1]}`);
  }
  return keys;
}

function sameTeamIdentity(a: TeamIdentity, b: TeamIdentity): boolean {
  const aKeys = teamIdentityKeys(a);
  return [...teamIdentityKeys(b)].some((key) => aKeys.has(key));
}

function teamNameLooksLikeHandle(person: TeamIdentity): boolean {
  const name = person.name ?? "";
  return name.startsWith("@")
    || (!/[\s._-]/.test(name)
      && normalizedTeamIdentity(name) === normalizedTeamIdentity(person.handle));
}

// A leadership title only renders against a resolved human identity. A row
// whose display name is just its own handle (the @twistartups class: a media
// account bound to "our CEO" inside a post) is a mention, not a team member.
const LEADERSHIP_ROLE_CLAIM = /\b(?:founder|co[- ]?founder|creator|ceo|cto|coo|cfo|cmo|chief|president|owner|head|director|officer|lead)\b/i;

function credibleTeamRow(person: TeamIdentity & { role?: string }): boolean {
  return !LEADERSHIP_ROLE_CLAIM.test(person.role ?? "") || !teamNameLooksLikeHandle(person);
}

function supplementalTeamLeadLabel(person: WebPerson): string {
  if (person.evidenceKind === "project_association") return "X association only";
  if (person.evidenceKind === "code_contribution") return "GitHub contribution";
  if (person.evidenceKind === "team_attribution") return "supplemental team attribution";
  return "web/X candidate";
}

function humanTeamName(current: TeamIdentity, incoming: TeamIdentity): string {
  const currentName = current.name ?? "";
  const incomingName = incoming.name ?? "";
  const currentLooksLikeHandle = teamNameLooksLikeHandle(current);
  const incomingLooksLikeHandle = teamNameLooksLikeHandle(incoming);
  if (currentLooksLikeHandle && incomingName && !incomingLooksLikeHandle) return incomingName;
  return currentName || incomingName;
}

function mergeTeamSources(...sources: string[]): string {
  return [...new Set(sources.flatMap((source) => source.split(" + ")).filter(Boolean))].join(" + ");
}

function ReportSectionHeading({
  index,
  title,
  description,
  id,
}: {
  index: string;
  title: string;
  description: string;
  id?: string;
}) {
  return (
    <header className="report-section-heading" id={id}>
      <div>
        <p className="eyebrow text-signal-lift">{index}</p>
        <h2 className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">{title}</h2>
        <p className="story-chapter-description mt-2 max-w-2xl leading-relaxed text-ink-dim">{description}</p>
      </div>
    </header>
  );
}

function money(n?: number): string {
  if (n == null) return "N/A";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

function StatusPill({
  label,
  color,
  score,
  title,
  fail = false,
  large = false,
}: {
  label: string;
  color: string;
  score: number | null;
  title?: string;
  fail?: boolean;
  large?: boolean;
}) {
  return (
    <span
      className={`verdict-pill ${large ? "verdict-pill-lg" : ""} ${fail ? "tint-fail" : "tint-var"}`}
      style={fail ? undefined : ({ "--tint": color } as React.CSSProperties)}
      title={title}
    >
      {label}{typeof score === "number" ? ` ${score}` : ""}
    </span>
  );
}

function VerdictPill({ verdict, score, large = false }: { verdict: string; score: number | null; large?: boolean }) {
  const m = verdictMeta(verdict);
  return (
    <StatusPill
      label={m.label}
      color={m.color}
      score={score}
      fail={verdict === "FAIL"}
      large={large}
    />
  );
}

function ProjectAccountStatusPill({
  reviewOpen,
  verdict,
  score,
}: {
  reviewOpen: boolean;
  verdict?: string;
  score: number | null;
}) {
  if (reviewOpen || !verdict) {
    return (
      <StatusPill
        label="Account review open"
        color="var(--color-caution)"
        score={null}
        title="The token safety checks may be finished, but the separate review of the project’s X account still has missing checks."
      />
    );
  }
  return <VerdictPill verdict={verdict} score={score} />;
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className={`panel p-4 ${accent ? "tint-var" : ""}`} style={accent ? ({ "--tint": accent } as React.CSSProperties) : undefined}>
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </div>
  );
}

function fundingDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Rounds shown in full before the schedule collapses to a floor note. */
const MAX_SCHEDULED_ROUNDS = 8;

/**
 * The whole financing schedule, newest first, in the fact sheet's round-list
 * language: a name, a date, an amount, and a bar sized against the largest
 * priced round. A single summed total hides which round was which and who
 * backed it, so every row keeps its own date, amount, valuation and backers.
 * A round the record never priced reads as undisclosed, never as zero. An
 * undated round does sort last, having no date to sort by, but it says "date
 * not recorded" on its own row rather than borrowing a neighbour's.
 */
function FundingRoundSchedule({ rounds }: { rounds: readonly FundingEvidenceRound[] }) {
  const ordered = [...rounds].sort((left, right) =>
    String(right.date ?? "").localeCompare(String(left.date ?? "")));
  const shown = ordered.slice(0, MAX_SCHEDULED_ROUNDS);
  const largest = Math.max(...shown.map((round) => round.amountUsd ?? 0), 0);
  return (
    <>
      <ol className="mt-3.5 divide-y divide-line/50 border-t border-line/60" aria-label="Disclosed funding rounds">
        {shown.map((round, index) => {
          const leads = round.leadInvestors.filter(Boolean);
          const others = round.otherInvestors.filter(Boolean);
          const priced = round.amountUsd != null && round.amountUsd > 0;
          const dated = fundingDate(round.date);
          const valued = round.valuationUsd != null && round.valuationUsd > 0;
          const attribution = [
            // Both lists declare their own truncation. A row that silently drops
            // the fourth lead reads as the complete set of leads for that round.
            leads.length > 0
              ? `led by ${leads.slice(0, 3).join(", ")}${leads.length > 3 ? ` and ${leads.length - 3} more` : ""}`
              : "",
            others.length > 0
              ? `with ${others.slice(0, 4).join(", ")}${others.length > 4 ? ` and ${others.length - 4} more` : ""}`
              : "",
            valued ? `${money(round.valuationUsd ?? undefined)} valuation` : "",
          ].filter(Boolean).join(" · ");
          return (
            <li
              key={`${round.round}:${round.date ?? "undated"}:${index}`}
              className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-2 text-[12px]"
            >
              <span className="font-medium text-ink">{round.round}</span>
              <span className="mono text-[10.5px] text-ink-faint">{dated ?? "date not recorded"}</span>
              <span className={`mono ml-auto font-semibold tabular-nums ${priced ? "text-ink" : "text-ink-faint"}`}>
                {priced ? money(round.amountUsd ?? undefined) : "amount undisclosed"}
              </span>
              {largest > 0 && (
                <span className="block h-1 min-w-full overflow-hidden rounded-full bg-line/50" aria-hidden="true">
                  {priced && (
                    <span
                      className="block h-full rounded-full bg-signal-lift/70"
                      style={{ width: `${Math.max(2, ((round.amountUsd ?? 0) / largest) * 100)}%` }}
                    />
                  )}
                </span>
              )}
              {attribution && (
                <span className="min-w-full text-[11px] leading-snug text-ink-faint">{attribution}</span>
              )}
            </li>
          );
        })}
      </ol>
      {ordered.length > shown.length && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
          Showing the {shown.length} most recent of {ordered.length} documented rounds.
        </p>
      )}
    </>
  );
}

function CapitalStructurePanel({
  facts,
  indexedRounds,
  tokenSymbol,
  tokenMarketCap,
  tokenFdv,
}: {
  facts: readonly BasicFactView[];
  indexedRounds: NonNullable<NonNullable<Investigation["projectAccount"]>["protocolFunding"]>["rounds"];
  tokenSymbol: string;
  tokenMarketCap?: number;
  tokenFdv?: number;
}) {
  const fundingFacts = facts.filter((fact) =>
    fact.predicate === "funding"
    && (fact.status === "verified" || fact.status === "corroborated"));
  const funding = summarizeFundingEvidence(fundingFacts, indexedRounds);
  const newestRound = [...funding.rounds].sort((left, right) =>
    String(right.date ?? "").localeCompare(String(left.date ?? "")))[0];
  const projectedRoundCount = fundingFacts
    .map((fact) => String(fact.value ?? "").match(/\b(\d+)\s+funding rounds?\s+indexed\b/i)?.[1])
    .find(Boolean);
  const roundCount = funding.rounds.length || Number(projectedRoundCount ?? 0);
  const fundingRecordFound = fundingFacts.length > 0 || roundCount > 0;
  const source = fundingFacts
    .flatMap((fact) => fact.sources ?? [])
    .find((candidate) =>
      candidate.url
      && candidate.provider !== "monid"
      && candidate.provider !== "defillama");
  // Backers are unioned across the WHOLE schedule, not read off the newest
  // round: a fund that led the seed is still a named backer three rounds later.
  // Leads and other participants stay in separate lines so an aggregator's
  // "otherInvestors" name is never presented as having led the round.
  const leadNames = [...new Set(funding.rounds
    .flatMap((round) => round.leadInvestors)
    .map((name) => name.trim())
    .filter(Boolean))];
  const otherNames = [...new Set([
    ...funding.rounds.flatMap((round) => round.otherInvestors),
    ...facts
      .filter((fact) =>
        fact.predicate === "investor"
        && (fact.status === "verified" || fact.status === "corroborated"))
      .map((fact) => typeof fact.value === "string" ? fact.value : ""),
  ].map((name) => name.trim()).filter(Boolean))]
    .filter((name) => !leadNames.some((lead) => lead.toLowerCase() === name.toLowerCase()));
  const pricedRounds = funding.rounds.filter((round) => round.amountUsd != null && round.amountUsd > 0);
  const unpricedRounds = funding.rounds.length - pricedRounds.length;
  const amountKnown = funding.totalKnownUsd > 0;

  return (
    <section className="panel overflow-hidden" aria-label="Company funding and token market">
      <div className="border-b border-line/70 px-4 py-4 sm:px-5">
        <p className="eyebrow text-signal-lift">Two separate kinds of capital</p>
        <h3 className="mt-1 text-[17px] font-semibold text-ink">Company funding and the ${tokenSymbol} token</h3>
        <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">
          Company investors and token buyers own different things. The figures below should never be combined.
        </p>
      </div>
      <div className="grid divide-y divide-line/70 md:grid-cols-2 md:divide-x md:divide-y-0">
        <article className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow">Company funding</span>
            <span className={`chip ${amountKnown ? "tint-signal" : fundingRecordFound ? "tint-caution" : ""}`}>
              {amountKnown ? "EQUITY ROUND" : fundingRecordFound ? "FUNDING RECORD" : "NOT VERIFIED"}
            </span>
          </div>
          {amountKnown ? (
            <>
              <p className="display-sm mt-4 text-[27px] leading-none text-ink">{money(funding.totalKnownUsd)}</p>
              <p className="mt-1.5 text-[12px] text-ink-dim">
                {`Sum of ${pricedRounds.length} priced round${pricedRounds.length === 1 ? "" : "s"}`}
                {unpricedRounds > 0
                  ? ` · ${unpricedRounds} round${unpricedRounds === 1 ? "" : "s"} with no disclosed amount`
                  : ""}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                A documented floor, not a verified lifetime raise.
              </p>
              {newestRound?.valuationUsd && (
                <p className="mt-3 text-[12.5px] text-ink">
                  Company valuation <span className="mono font-medium">{money(newestRound.valuationUsd)}</span>
                </p>
              )}
            </>
          ) : fundingRecordFound ? (
            <>
              <p className="mt-4 text-[16px] font-semibold text-ink">Funding record found</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                ARGUS found {roundCount || "a"} company funding {roundCount === 1 ? "round" : "rounds"}, but no round amount was disclosed in the saved record.
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-[16px] font-semibold text-ink">No company round verified</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                This report did not confirm a public company funding announcement.
              </p>
            </>
          )}
          {funding.rounds.length > 0 && <FundingRoundSchedule rounds={funding.rounds} />}
          {leadNames.length > 0 && (
            <p className="mt-2.5 text-[12px] leading-relaxed text-ink-dim">
              Led by {leadNames.slice(0, 4).join(", ")}
              {leadNames.length > 4 ? ` and ${leadNames.length - 4} more` : ""}
            </p>
          )}
          {otherNames.length > 0 && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
              Also named: {otherNames.slice(0, 6).join(", ")}
              {otherNames.length > 6 ? ` and ${otherNames.length - 6} more` : ""}
            </p>
          )}
          {source?.url && (
            <a href={source.url} target="_blank" rel="noreferrer" className="link-ext mt-3 inline-flex text-[11.5px]">
              Read the funding source
            </a>
          )}
          <p className="mono mt-4 border-t border-line/70 pt-3 text-[10.5px] uppercase tracking-[0.07em] text-ink-faint">
            Company ownership · not token ownership
          </p>
        </article>

        <article className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow">${tokenSymbol} token</span>
            <span className="chip tint-pass">CRYPTO ASSET</span>
          </div>
          <p className="display-sm mt-4 text-[27px] leading-none text-ink">{money(tokenMarketCap)}</p>
          <p className="mt-1.5 text-[12px] text-ink-dim">Token market cap when this report was saved</p>
          {tokenFdv != null && (
            <p className="mt-3 text-[12.5px] text-ink">
              Value if all tokens circulated <span className="mono font-medium">{money(tokenFdv)}</span>
            </p>
          )}
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">
            Token holders own a tradeable crypto asset. That does not automatically mean they own shares in the company.
          </p>
          <p className="mono mt-4 border-t border-line/70 pt-3 text-[10.5px] uppercase tracking-[0.07em] text-ink-faint">
            Token market value · not company valuation
          </p>
        </article>
      </div>
    </section>
  );
}

export function InvestigationReport({
  inv,
  onAudit,
  onReset,
  onOpenToken,
  onOpenProjectAccount,
  onReAudit,
  onOpenBrief,
}: {
  inv: Investigation;
  onAudit: (q: string) => void;
  onReset: () => void;
  onOpenToken: () => void;
  onOpenProjectAccount: () => void;
  onReAudit?: () => void;
  onOpenBrief?: () => void;
}) {
  const arkhamEnabled = arkhamProviderEnabled();
  const [spent, setSpent] = useState(0);
  const [decisionLensId, setDecisionLensId] = useState<DecisionLensId>("investment");
  const [watched, setWatched] = useState(() => isWatched(inv.token.address));
  const spentRef = useRef(0); // synchronous guard so a rapid double-click can't overshoot the cap
  const versionContext = inv.versionContext;
  const frozenReportVersionId = versionContext?.reportVersionId
    ?? (inv.persistence?.state === "persisted" ? inv.persistence.reportVersionId : undefined)
    ?? undefined;
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const loadCurrentIntelligence = () => {
    if (versionContext) setCurrentIntelligenceVersionId(versionContext.reportVersionId);
  };
  const persistencePending = !versionContext && inv.persistence?.state === "pending";
  const persistenceFailed = !versionContext && inv.persistence?.state === "failed";
  const panelCostToken = !versionContext && inv.persistence?.state === "persisted"
    ? inv.persistence.panelCostToken ?? undefined
    : undefined;
  const persistenceMissingCapability = !versionContext
    && inv.persistence?.state === "persisted"
    && !panelCostToken;
  const privateSession = inv.persistence?.state === "private";
  const showCurrentIntelligence = versionContext
    ? currentIntelligenceEnabled
    : !privateSession && !persistencePending && !persistenceFailed && !persistenceMissingCapability;
  const canRecordCurrentIntelligence = !versionContext && inv.persistence?.state !== "private";
  const canMutateWorkspace = !versionContext && inv.persistence?.state !== "private";
  const canShare = Boolean(
    versionContext?.reportVersionId
    || (inv.persistence?.state === "persisted" && inv.persistence.reportVersionId),
  );
  const { token, projectX, siteUrl, recon, projectAccount, founders, deployerTrail } = inv;
  // The deployer wallet's age, said in the unit that carries it and stamped with
  // what it was measured to. Null when the trail never measured one: a wallet
  // whose first activity sits outside the pagination window is not a new wallet
  // and is not an old one.
  const deployerTrailAge = walletAgeFact(deployerTrail && {
    ageMinutes: deployerTrail.walletAgeMinutes,
    ageDays: deployerTrail.walletAgeDays,
    ageBasis: deployerTrail.walletAgeBasis,
  });
  const investigationBasicFactSnapshot = inv as Investigation & {
    basicFacts?: BasicFactView[];
    basicFactLeads?: BasicFactLeadView[];
  };
  const rawProjectBasicFacts = projectAccount?.basicFacts
    ?? investigationBasicFactSnapshot.basicFacts
    ?? [];
  // Unverified discovery leads are name-matched search results, so on a token
  // whose project shares its name with a company in another industry they carry
  // that company's facts. This report used to render them raw, which is how a
  // law firm's page about a used-car retailer called Clutch was published as a
  // memecoin's funding round. The dossier report's rule now lives in
  // src/lib/projectLeadRelevance.ts and both surfaces apply it.
  //
  // The subject comes from the embedded project account when there is one, and
  // otherwise from the investigation's own project handle, token name and site.
  // A frozen investigation carrying neither has nothing to bind a lead against
  // and publishes none, which is the fail-closed direction.
  const projectLeadSubject: ProjectLeadSubject | null = projectAccount
    ? projectAccount
    : projectX || token.name || siteUrl
      ? {
        handle: projectX ?? "",
        display_name: (token.name || token.symbol || "").trim(),
        website: siteUrl,
      }
      : null;
  const rawProjectBasicFactLeads = projectAccount?.basicFactLeads
    ?? investigationBasicFactSnapshot.basicFactLeads
    ?? [];
  // The whole rule, the same one the dossier report applies. This was scoped to
  // funding and investor for one commit because the shared rule used to drop
  // every LinkedIn lead, including the person profiles that carry named
  // leadership; person profiles are now judged on their own text instead of
  // banned by host, so both surfaces can hold the same line.
  const projectBasicFactLeads = projectLeadSubject
    ? rawProjectBasicFactLeads.filter((lead) => projectLeadIsRelevant(projectLeadSubject, lead))
    : [];
  const tokenSubjectGraphKey = String(token.graph.nodes.find((node) => node.subject)?.key ?? "") || undefined;
  // Credit org-side outcomes the bound project scan recorded in this same
  // payload; without a confirmed canonical binding this is a no-op.
  const diligenceChecks = reconcileInvestigationChecks(
    inv.versionContext ? inv.versionContext.checks : tokenChecks(token),
    token.address,
    projectAccount,
    inv.projectAccountAudit,
  );
  const readiness = deriveDecisionReadiness(diligenceChecks);
  const clearance = clearanceCoverage(diligenceChecks);
  const observedTokenMeta = verdictMeta(token.verdict);
  const readinessLabel = readiness.status === "ready"
    ? "READY TO REVIEW"
    : readiness.status === "provisional"
      ? "REVIEW WITH GAPS"
      : "NOT READY";
  const readinessColor = readiness.status === "ready"
    ? "var(--color-pass)"
    : readiness.status === "provisional"
      ? "var(--color-caution)"
      : "var(--color-avoid)";
  const recordedChecks = diligenceChecks.filter((check) => ["confirmed", "reported", "finding", "checked-empty"].includes(check.status));
  const gapChecks = diligenceChecks.filter((check) => ["unknown", "unavailable", "stale"].includes(check.status));
  // The exact rows behind the "Checks finished N/M" counter: the same
  // decision-critical set deriveDecisionReadiness counts, minus the finished
  // ones — so the dropdown's list always sums with the counter it explains.
  const unfinishedCounterChecks = decisionCriticalChecks(diligenceChecks)
    .filter((check) => ["unknown", "unavailable", "stale"].includes(check.status));
  const requiredGapChecks = gapChecks.filter((check) =>
    check.checkId ? clearance.openNeverWaive.includes(check.checkId) : false);
  const enrichmentGapChecks = gapChecks.filter((check) => !requiredGapChecks.includes(check));
  // A gap the providers cannot close on this chain stays open and still blocks
  // clearance, but offering a rescan for it would be a false remedy.
  const unretryableGapChecks = requiredGapChecks.filter((check) => check.retryable === false);
  const retryCanCloseAGap = requiredGapChecks.length === 0
    || unretryableGapChecks.length < requiredGapChecks.length;
  const projectChecks = projectAccount
    ? projectAccount.versionContext
      ? projectAccount.versionContext.checks
      : projectAccount.checkRuns?.length
        ? projectAccount.checkRuns
        : personChecks({
            identityConfidence: projectAccount.report.identity_confidence ?? undefined,
            realName: (projectAccount.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
            roles: projectAccount.report.roles ?? [],
            hasAssociates: (projectAccount.evidence.associates ?? []).length > 0,
          })
    : [];
  const projectReadiness = projectAccount ? deriveDecisionReadiness(projectChecks) : null;
  const projectPositiveNeedsQualification = Boolean(
    projectAccount?.report.composite_verdict === "PASS" && projectReadiness?.status !== "ready",
  );
  const projectReviewOpen = Boolean(
    projectPositiveNeedsQualification || projectAccount?.report.composite_verdict === "INCOMPLETE",
  );
  const presentedProjectVerdict = projectAccount?.report.composite_verdict;
  const projectAccountHeadline = projectAccount
    ? projectReviewOpen
      ? "This project account review is missing one or more required checks. Open the full report to see what is still needed."
      : projectAccount.headline
    : undefined;
  const marketCap = token.mcap ?? token.cg?.mcapUsd ?? undefined;
  const fullyDilutedValue = token.fdv
    ?? projectAccount?.projectToken?.fdvUsd
    ?? undefined;
  const establishedAsset = Boolean(
    (token.cg?.rank != null && token.cg.rank <= 250)
    || (marketCap != null && marketCap >= 100_000_000)
    || (token.cg?.cexCount != null && token.cg.cexCount >= 10),
  );
  const projectSourceBackedVentures = (projectAccount?.evidence.ventures ?? [])
    .filter((venture) => venture.evidence_origin !== "model_lead" && venture.artifact_verified === true);
  const projectUnverifiedVentureCount = (projectAccount?.evidence.ventures ?? [])
    .filter((venture) => venture.evidence_origin === "model_lead" || venture.artifact_verified === false).length;
  const projectLegacyVentureCount = (projectAccount?.evidence.ventures ?? []).length
    - projectSourceBackedVentures.length
    - projectUnverifiedVentureCount;
  // Arkham entity labels for the deployer + funder wallets.
  const { labels: arkham, state: arkhamState } = useArkhamLabels(
    arkhamEnabled && showCurrentIntelligence && panelCostToken ? [token.deployer, deployerTrail?.funder?.address] : [],
    panelCostToken,
  );
  const tm = observedTokenMeta;
  // The project's GitHub org (from its site links), for commit forensics.
  // The project's own website (first non-social link) → domain intelligence.
  // The audited project account is the canonical company/protocol surface.
  // `siteUrl` can instead be the token's own landing page (STONKBROKER is the
  // concrete case), so collapsing the two both hides a useful link and binds
  // company evidence to the wrong domain.
  const evidencedProjectSites = projectWebSurfaces(projectAccount);
  const projectDomain = [evidencedProjectSites[0]?.url, projectAccount?.website, siteUrl, ...(recon?.socials ?? []).map((s) => s.url), ...(token.socials ?? []).map((s) => s.url)]
    .filter((url): url is string => Boolean(url))
    .find((u) => /^https?:\/\//i.test(u) && !/x\.com|twitter\.com|t\.me|telegram|discord|github\.com|medium\.com|linktr\.ee/i.test(u))
    ?.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "") ?? null;
  const ghOrg = (recon?.socials ?? [])
    .map((s) => s.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
    .find((g) => g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing)$/i.test(g)) ?? null;
  const retainedProjectBasicFacts = rawProjectBasicFacts.filter((fact) => {
    const monidSources = (fact.sources ?? []).filter((source) =>
      source.provider === "monid" || /Monid\/Akta/i.test(source.title ?? ""));
    if (!fact.providerProjection || !monidSources.length) return true;
    if (!projectDomain) return false;
    return monidSources.some((source) => urlMatchesProjectDomain(source.url, projectDomain));
  });
  const hasConfirmedProjectIdentity = retainedProjectBasicFacts.some((fact) =>
    fact.predicate === "official_identity"
    && (fact.status === "verified" || fact.status === "corroborated"));
  const confirmedProjectIdentity: BasicFactView[] = !hasConfirmedProjectIdentity
    && projectAccount?.report.identity_confidence === "Confirmed"
    && projectAccount.display_name?.trim()
    ? [{
        factId: "confirmed-project-account-identity",
        predicate: "official_identity",
        value: projectAccount.display_name.trim(),
        qualifier: projectAccount.handle,
        status: "verified",
        critical: true,
        providerProjection: true,
        sources: [{
          url: `https://x.com/${projectAccount.handle.replace(/^@/, "")}`,
          title: "Official project profile",
          relation: "supports",
          provider: "twitterapi",
          sourceClass: "official_subject",
        }],
      }]
    : [];
  const projectBasicFacts = mergeLeadershipFacts([
    ...retainedProjectBasicFacts,
    ...confirmedProjectIdentity,
  ], domainBoundLeadershipFacts(projectAccount, projectDomain));
  const showProjectBasicFacts = Boolean(projectAccount)
    || projectBasicFacts.length > 0
    || projectBasicFactLeads.length > 0;
  const groundedProjectTeamMembers = (projectAccount?.webTeam ?? []).filter((person) => {
    if (person.evidence_origin === "model_lead" || person.artifact_verified !== true) return false;
    if (person.provider === "monid" && !urlMatchesProjectDomain(person.sourceUrl, projectDomain)) return false;
    return credibleTeamRow(person);
  });
  const supplementalConfirmedTeam = (inv.webTeam ?? []).filter((person) =>
    isConfirmedWebTeamPerson(person) && credibleTeamRow(person));
  const supplementalTeamLeads = (inv.webTeam ?? []).filter((person) =>
    !isConfirmedWebTeamPerson(person));
  // Unified team: members named in the project's X content (associates) merged
  // with people dug up via the web/LinkedIn search, deduped by handle so a
  // pseudonymous handle gets enriched with its real name + LinkedIn.
  const teamUnified: { name: string; handle?: string; role: string; linkedin?: string; sourceUrl?: string; evidence?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string }[] = (() => {
    type TeamRow = { name: string; handle?: string; role: string; linkedin?: string; sourceUrl?: string; evidence?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string };
    const map = new Map<string, TeamRow>();
    const findExisting = (person: { name: string; handle?: string; linkedin?: string }) => {
      return [...map.entries()].find(([, row]) => sameTeamIdentity(row, person));
    };
    const add = (person: TeamRow) => {
      const existing = findExisting(person);
      if (!existing) {
        map.set([...teamIdentityKeys(person)][0] ?? person.name.toLowerCase(), person);
        return;
      }
      const [key, row] = existing;
      map.set(key, {
        ...row,
        name: humanTeamName(row, person),
        handle: row.handle ?? person.handle,
        linkedin: row.linkedin ?? person.linkedin,
        role: !row.role || /^team$/i.test(row.role) ? person.role : row.role,
        sourceUrl: row.sourceUrl ?? person.sourceUrl,
        evidence: row.evidence ?? person.evidence,
        developerProfiles: row.developerProfiles ?? person.developerProfiles,
        source: mergeTeamSources(row.source, person.source),
      });
    };
    for (const p of groundedProjectTeamMembers) {
      add({
        name: p.name,
        handle: p.handle,
        role: p.role,
        linkedin: p.linkedin,
        sourceUrl: p.sourceUrl,
        evidence: p.evidence,
        developerProfiles: p.developerProfiles,
        source: p.linkedin ? "project scan + LinkedIn" : "project scan",
      });
    }
    for (const p of supplementalConfirmedTeam) {
      add({
        name: p.name,
        handle: p.handle,
        role: p.role,
        linkedin: p.linkedin,
        developerProfiles: p.developerProfiles,
        source: "supplemental team attribution",
      });
    }
    return [...map.values()].filter(credibleTeamRow);
  })();
  // Confirmed team groups contain only grounded project-team artifacts or a
  // direct supplemental team attribution. First-party names render separately.
  const teamPeople: { name: string; handle?: string; role?: string; linkedin?: string; sourceUrl?: string; evidence?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string }[] = (() => {
    type TeamPerson = { name: string; handle?: string; role?: string; linkedin?: string; sourceUrl?: string; evidence?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string };
    const people: TeamPerson[] = [];
    const add = (person: TeamPerson) => {
      const existing = people.find((candidate) => sameTeamIdentity(candidate, person));
      if (!existing) {
        people.push(person);
        return;
      }
      existing.name = humanTeamName(existing, person);
      existing.handle ??= person.handle;
      existing.linkedin ??= person.linkedin;
      existing.role = !existing.role || /^team$/i.test(existing.role) ? person.role : existing.role;
      existing.sourceUrl ??= person.sourceUrl;
      existing.evidence ??= person.evidence;
      existing.developerProfiles ??= person.developerProfiles;
      existing.source = mergeTeamSources(existing.source, person.source);
    };
    for (const m of teamUnified) {
      add({ name: m.name, handle: m.handle, role: m.role, linkedin: m.linkedin, sourceUrl: m.sourceUrl, evidence: m.evidence, developerProfiles: m.developerProfiles, source: m.source });
    }
    return people;
  })();
  const publishedTeamClaims = (() => {
    const claims: Array<{ name: string; handle?: string; role?: string; source: string; sourceUrl?: string; evidence?: string }> = [];
    const add = (claim: { name: string; handle?: string; role?: string; source: string; sourceUrl?: string; evidence?: string }) => {
      if (teamPeople.some((person) => sameTeamIdentity(person, claim))) return;
      if (claims.some((person) => sameTeamIdentity(person, claim))) return;
      claims.push(claim);
    };
    for (const associate of projectAccount?.evidence.associates ?? []) {
      if (!/^team:/i.test(associate.relation ?? "")) continue;
      add({
        name: associate.associate_key,
        handle: associate.associate_key,
        role: (associate.relation ?? "team").replace(/^team:\s*/i, ""),
        source: "project-attributed role",
        sourceUrl: associate.evidence_url,
        evidence: associate.notes,
      });
    }
    for (const founder of founders) {
      add({
        name: founder.name,
        handle: founder.handle ?? undefined,
        role: "Founder",
        source: "project-attributed role",
      });
    }
    return claims;
  })();
  const groundedTeamSupportPeople = groundedProjectTeamMembers.filter((person, index, all) =>
    all.findIndex((candidate) => sameTeamIdentity(candidate, person)) === index);
  // Investigator rail: deterministic anomalies computed from the frozen stats
  // so the few numbers that change a decision stop hiding inside stat grids.
  // An absent LP-holder record is not a zero. Coercing it with ?? 0 published
  // "None of the trading liquidity is locked" as a red alert about tokens whose
  // lock was never measured, which is the claim the engine already refuses to make.
  const lpLockedOrBurnedPct = token.safetyChecked && token.safety?.available && token.safety.lpAssessed !== false
    ? (token.safety.lpLockedPct ?? 0) + (token.safety.lpBurnedPct ?? 0)
    : projectAccount?.holderProfile?.lpLockedOrBurnedPct ?? null;
  // Summing the audit's own rows is only a top-ten share when the token lane
  // trusted its register and returned ten of them; otherwise it is a floor, and
  // a floor must not backfill a project-side figure that was suppressed.
  const top10FromRows = top10ShareFromRows(token.topHolders, token.holdersAssessed);
  const projectHolderAggregate = projectAccount?.holderProfile?.top10Pct != null;
  const circulatingSupplyPct = (() => {
    const circulating = projectAccount?.projectToken?.circulatingSupply;
    const denominator = projectAccount?.projectToken?.maxSupply ?? projectAccount?.projectToken?.totalSupply;
    return circulating != null && denominator != null && denominator > 0
      ? (circulating / denominator) * 100
      : null;
  })();
  const upcomingUnlocks = projectAccount?.tokenUnlocks;
  const noticedSignals = deriveNoticedSignals({
    lpLockedPct: lpLockedOrBurnedPct,
    isConcentratedLiquidityPool: isConcentratedLiquidityPool(token.dexId, token.dexLabels),
    largestHolderPct: token.safety?.topHolderPct ?? projectAccount?.holderProfile?.topHolderPct,
    top10HolderPct: projectAccount?.holderProfile?.top10Pct ?? top10FromRows,
    assessedWalletCount: projectHolderAggregate
      ? projectAccount?.holderProfile?.assessedWalletCount
      : top10FromRows != null ? 10 : null,
    top10HolderPctIsFloor: projectHolderAggregate
      ? projectAccount?.holderProfile?.top10PctIsFloor
      : top10FromRows != null ? false : undefined,
    circulatingPct: circulatingSupplyPct,
    fdvUsd: fullyDilutedValue ?? null,
    marketCapUsd: marketCap ?? null,
    volume24hUsd: token.vol24 ?? null,
    nextUnlock: upcomingUnlocks
      ? { date: upcomingUnlocks.nextUnlockDate, amountUsd: upcomingUnlocks.unlockValueUsd, pctSupply: upcomingUnlocks.percentOfSupply }
      : null,
    tvlChange30dPct: projectAccount?.protocolTvl?.change30dPct ?? null,
    feesChange30dPct: projectAccount?.protocolFees?.change30dOver30dPct ?? null,
    athDrawdownPct: token.cg?.ath?.drawdownPct ?? projectAccount?.projectToken?.ath?.drawdownPct ?? null,
    accountSuspended: projectAccount?.x_account_status === "suspended",
    daysSinceLastPost: projectAccount?.days_since_post ?? null,
    verifiedTeamCount: projectAccount ? groundedTeamSupportPeople.length : null,
    namedTeamCount: projectAccount ? teamPeople.length + publishedTeamClaims.length : null,
    projectAttributedTeam: publishedTeamClaims.map((person) => ({
      name: person.handle || person.name,
      role: person.role,
    })),
    anchors: { market: "#investigation-visuals", team: "#investigation-team", account: "#investigation-people" },
  });
  const advisors = (projectAccount?.evidence.testimonials ?? []).filter((t) => t.claimed_relationship === "advisor");
  const founderTeam = teamPeople.filter((person) => /\b(?:co[- ]?founder|founder|creator)\b/i.test(person.role ?? ""));
  const otherNamedTeam = teamPeople.filter((person) => !founderTeam.includes(person));
  const teamGroups = [
    { label: "Founders", people: founderTeam },
    { label: "Other named team", people: otherNamedTeam },
  ].filter((group) => group.people.length > 0);
  const supplementalTeamCoverageNote = !inv.webTeamDiscovery?.attempted
    ? null
    : inv.webTeamDiscovery.completed
      ? "Configured supplemental people discovery completed. Candidate rows remain outside team support unless a direct team attribution is verified."
      : "Supplemental people discovery did not complete. People outside the saved project evidence remain unknown.";
  // The paid leadership-currency answer. An "absent" row means the employment
  // record held no role for that person at all: not a departure, not a
  // confirmation, and nothing a reader can act on. Silent is better, so only
  // the two rows the record actually answered are published.
  const leadershipCurrency = (projectAccount?.leaderDepartures ?? [])
    .filter((row) => row.state === "departed" || row.state === "current");
  const leadershipUnanswered = (projectAccount?.leaderDepartures ?? [])
    .filter((row) => row.state === "absent").length;
  const advisorChip = (v?: string): { label: string; color: string } => {
    const s = (v ?? "").toLowerCase();
    if (s.includes("corrobor")) return { label: "confirmed twice", color: "var(--color-pass)" };
    if (s.includes("contradict")) return { label: "contradicted", color: "var(--color-avoid)" };
    return { label: "unconfirmed", color: "var(--color-ink-faint)" };
  };
  const auditFounder = (handle: string) => {
    if (spentRef.current >= MAX_FOUNDER_AUDITS) return;
    spentRef.current += 1;
    setSpent(spentRef.current);
    onAudit(handle);
  };
  const share = async () => {
    if (shareState === "creating") return;
    setShareState("creating");
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "investigation",
          ref: token.address,
          reportVersionId: versionContext?.reportVersionId
            ?? (inv.persistence?.state === "persisted" ? inv.persistence.reportVersionId : undefined),
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
      console.error("[share] investigation report failed", error);
      setShareState("error");
      setTimeout(() => setShareState("idle"), 3000);
    }
  };
  const watch = () => {
    if (!canMutateWorkspace) return;
    setWatched(toggleWatch({
      id: token.address,
      kind: "token",
      label: `$${token.symbol}`,
      chain: token.chain,
      via: token.chain === "solana" ? "solana" : "evm",
      addedAt: 0,
      snapshot: {
        verdict: token.verdict,
        score: token.score,
        completenessState: readiness.status === "ready" ? "complete" : "partial",
        liquidityUsd: token.liquidityUsd,
        mcap: marketCap,
      },
    }));
  };

  // Same mint the Share button uses, composed into the TLDR at copy time so a
  // pasted summary opens without sign-in and unfurls into the report card.
  const mintShareUrl = async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "investigation",
          ref: token.address,
          reportVersionId: versionContext?.reportVersionId
            ?? (inv.persistence?.state === "persisted" ? inv.persistence.reportVersionId : undefined),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: unknown };
      if (!response.ok || typeof body.url !== "string") return null;
      return new URL(body.url, location.origin).toString();
    } catch {
      return null;
    }
  };

  // The connection web: this token's own subgraph (deployer → funder trail, project
  // account, site) plus every cross-audit tie to other subjects you've scanned.
  const invGraph = investigationContribution(inv);
  const connections = subjectConnections("$" + token.symbol, getContributions());
  const intelligenceBrief = projectAccount?.intelligence
    ? deriveIntelligenceBrief(projectAccount.intelligence, decisionLensId)
    : { supports: [], pressures: [], context: [], questions: [] };
  const supportItems = [
    ...token.findings
      .filter((finding) => finding.tone === "good")
      .map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...(groundedTeamSupportPeople.length > 0 ? [{
      label: `${groundedTeamSupportPeople.length} source-grounded team ${groundedTeamSupportPeople.length === 1 ? "member" : "members"} identified`,
      detail: groundedTeamSupportPeople.slice(0, 4).map((person) => person.name).filter(Boolean).join(", "),
    }] : []),
    ...intelligenceBrief.supports.map((item) => ({
      label: item.title,
      detail: `${item.detail} ${item.provenance}`.trim(),
    })),
    // Checked-empty rows are coverage, never support: a completed no-result
    // search must not render as positive evidence pulling against the verdict.
    // They stay visible in the recorded-outcomes rail below.
    ...recordedChecks
      .filter((check) => check.status === "confirmed")
      .map((check) => ({ label: check.label, detail: check.note })),
  ].slice(0, 6);
  const concernItems = [
    ...token.findings
      .filter((finding) => finding.tone !== "good")
      .map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...recordedChecks
      .filter((check) => check.status === "finding")
      .map((check) => ({ label: check.label, detail: check.note })),
    ...intelligenceBrief.pressures.map((item) => ({
      label: item.title,
      detail: `${item.detail} ${item.provenance}`.trim(),
    })),
    ...(readiness.status !== "ready" ? [{
      label: readinessLabel,
      detail: requiredGapChecks.length
        ? `Finish ${requiredGapChecks.map((check) => check.label).join(", ")} before relying on this report.`
        : readiness.guidance,
    }] : []),
  ].slice(0, 6);
  const requiredNextStepItems = requiredGapChecks
    .map((check) => ({
      label: `Required: Check ${check.label.toLowerCase()}`,
      detail: check.note,
    }));
  const enrichmentNextStepItems = enrichmentGapChecks
    .map((check) => ({
      label: `Check ${check.label.toLowerCase()}`,
      detail: check.note,
    }));
  const nextStepItems = [
    ...requiredNextStepItems,
    ...intelligenceBrief.questions.map((item) => ({
      label: item.title,
      detail: `${item.detail} ${item.provenance}`.trim(),
    })),
    ...enrichmentNextStepItems,
  ].filter((item, index, items) => {
    const key = item.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return items.findIndex((candidate) =>
      candidate.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key) === index;
  }).slice(0, 6);
  // The three-line argument at the top of the case: strongest support,
  // sharpest concern (a cap always wins that slot), and what to check next.
  const verdictArgument = deriveVerdictArgument({
    verdict: token.verdict,
    supports: [
      ...intelligenceBrief.supports.map((item) => item.title),
      ...supportItems.map((item) => item.label),
    ],
    concerns: concernItems.map((item) => item.label),
    capReason: token.capApplied ? `The score is capped: ${token.capApplied.replace(/_/g, " ")}` : null,
    nextChecks: nextStepItems.map((item) => item.label),
  });
  // One paste, whole verdict: composed for group chats. The link is appended
  // at copy time (share link when mintable, app URL else).
  const tldrBase = [
    `ARGUS · $${token.symbol} investigation · risk score ${observedTokenMeta.label}${token.score == null ? "" : ` ${token.score}/100`} · safety checks ${readinessLabel}`,
    plainLanguageSummary(token.headline),
    nextStepItems[0] ? `Top open item: ${nextStepItems[0].label}.` : "",
  ].filter(Boolean).join("\n");
  const verifiedItems = recordedChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const openQuestionItems = [
    ...gapChecks.map((check) => ({ label: check.label, detail: check.note })),
    ...intelligenceBrief.questions.map((item) => ({ label: item.title, detail: `${item.detail} ${item.provenance}`.trim() })),
  ].filter((item, index, items) => {
    const key = item.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return items.findIndex((candidate) =>
      candidate.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key) === index;
  }).slice(0, 6);
  const capturedAt = versionContext?.createdAt
    ? new Date(versionContext.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : undefined;
  const leadershipReferenceTime = Date.parse(
    versionContext?.createdAt ?? projectAccount?.profile_captured_at ?? "",
  );
  const favorableVerdict = token.verdict === "PASS";
  const decisionCanvasTone = favorableVerdict
    ? "pass"
    : token.verdict === "CAUTION" || token.verdict === "INCOMPLETE" || token.verdict === "UNVERIFIABLE_IDENTITY"
      ? "caution"
      : "avoid";
  const hasConnectionsChapter = Boolean(invGraph && invGraph.nodes.length > 1);
  const connectionsChapterNumber = 5;
  const challengeChapterNumber = connectionsChapterNumber + Number(hasConnectionsChapter);
  const scanDetailsChapterNumber = challengeChapterNumber + 1;
  const chapterLabel = (chapter: number, label: string) =>
    `${String(chapter).padStart(2, "0")} · ${label}`;

  return (
    <div className="investigation-story relative min-h-full pb-24">
      <header className="report-toolbar sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-nowrap items-center gap-2 px-4 py-2.5 sm:px-5 sm:py-3">
          <button onClick={onReset} className="btn-ghost flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-2 text-[12.5px] sm:min-w-0 sm:justify-start sm:px-1">
            <ArrowLeft size={15} weight="bold" aria-hidden="true" />
            <span className="max-sm:sr-only">New investigation</span>
          </button>
          <span className="mono hidden text-[11px] text-ink-faint sm:inline">/ token + project report</span>
          <span className={`chip shrink-0 ${versionContext ? "" : "tint-signal"}`}>
            <span className="sm:hidden">{versionContext ? `v${versionContext.version}` : "live"}</span>
            <span className="hidden sm:inline">{versionContext ? `saved report v${versionContext.version}` : "new scan"}</span>
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {onOpenBrief && (
              <button type="button" onClick={onOpenBrief} title="Open the analyst decision brief anchored to this exact investigation case" className="btn-primary flex min-h-11 shrink-0 items-center gap-2 px-3 text-[12.5px] font-medium">
                <Briefcase size={16} weight="duotone" aria-hidden="true" /> Case brief
              </button>
            )}
            <a href="#investigation-challenge" title="Tell ARGUS what looks wrong or missing in this report" className="btn-secondary hidden min-h-11 items-center justify-center gap-2 px-3 text-[12.5px] font-medium sm:flex">
              <ShieldWarning size={16} weight="duotone" aria-hidden="true" /> Challenge
            </a>
            {onReAudit && (
              <button onClick={onReAudit} title="Run this investigation again with current evidence" className="btn-secondary hidden min-h-11 items-center justify-center gap-2 px-3 text-[12.5px] font-medium sm:flex">
                <ArrowClockwise size={16} weight="duotone" aria-hidden="true" />
                Rescan
              </button>
            )}
            <div className="hidden items-center gap-2 sm:flex">
              <button type="button" onClick={() => printReportPdf(inv.token.name || inv.token.symbol)} title="Save this report as a PDF (opens the print dialog)" className="btn-secondary print:hidden flex min-h-10 items-center gap-2 px-3 text-[12.5px]">Export PDF</button>
              {canShare && (
                <button type="button" onClick={() => void share()} disabled={shareState === "creating"} aria-live="polite" title={shareState === "error" ? "Share link could not be created or copied. Try again." : "Copy a report link that works for 30 days"} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] disabled:cursor-wait disabled:opacity-60">
                  <ShareNetwork size={16} weight="duotone" aria-hidden="true" />
                  {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied" : shareState === "error" ? "Retry share" : "Share"}
                </button>
              )}
              {canMutateWorkspace && (
                <button type="button" onClick={watch} aria-pressed={watched} title="Add this report to your watchlist so later scans can flag changes" className={`btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] ${watched ? "tint-signal" : ""}`}>
                  <Star size={16} weight={watched ? "fill" : "duotone"} aria-hidden="true" />
                  {watched ? "Watching" : "Watch"}
                </button>
              )}
            </div>
            <details className="group relative sm:hidden">
                <summary
                  aria-label="More report actions"
                  className="btn-secondary flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center px-2.5 [&::-webkit-details-marker]:hidden"
                >
                  <DotsThree size={19} weight="bold" aria-hidden="true" />
                  <span className="sr-only">More report actions</span>
                </summary>
                <div className="absolute right-0 top-[calc(100%+0.4rem)] z-20 min-w-52 overflow-hidden rounded-lg border border-line bg-panel py-1 soft-shadow">
                  <a href="#investigation-challenge" className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                    <ShieldWarning size={16} weight="duotone" aria-hidden="true" />
                    Challenge report
                  </a>
                  {onReAudit && (
                    <button type="button" onClick={onReAudit} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                      <ArrowClockwise size={16} weight="duotone" aria-hidden="true" />
                      Rescan current evidence
                    </button>
                  )}
                  {canShare && (
                    <button type="button" onClick={() => void share()} disabled={shareState === "creating"} aria-live="polite" className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-60">
                      <ShareNetwork size={16} weight="duotone" aria-hidden="true" />
                      {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied" : shareState === "error" ? "Retry share" : "Share report"}
                    </button>
                  )}
                  {canMutateWorkspace && (
                    <button type="button" onClick={watch} aria-pressed={watched} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                      <Star size={16} weight={watched ? "fill" : "duotone"} aria-hidden="true" />
                      {watched ? "Watching report" : "Add to watchlist"}
                    </button>
                  )}
                </div>
              </details>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-5">
        {versionContext && (
          <div className="mt-4">
            <SnapshotEvidenceControl
              snapshotVersion={versionContext.version}
              capturedAt={versionContext.createdAt}
              subjectKind="investigation"
              currentIntelligenceEnabled={currentIntelligenceEnabled}
              onLoadCurrentIntelligence={loadCurrentIntelligence}
            />
          </div>
        )}
        {!versionContext && (showCurrentIntelligence || privateSession) && (
          <div className="mt-4">
            <LiveSupplementalNotice private={privateSession} persisted={inv.persistence?.state === "persisted"} />
          </div>
        )}
        {persistencePending && (
          <div className="mt-4 panel px-4 py-3 text-[12.5px] text-ink-dim" role="status">
            Saving this report before running extra checks…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="finding tint-caution mt-4 px-4 py-3 text-[12.5px]" role="alert">
            Post-scan intelligence is paused because this investigation could not be saved. Rescan before spending on supplemental providers.
          </div>
        )}
        {showCurrentIntelligence && <RingAlert handle={"$" + token.symbol} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* headline */}
        <div className="investigation-story-cover mt-6">
          <div className="flex flex-wrap items-end gap-3">
            {token.imageUrl && <img src={token.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-xl border border-line object-cover soft-shadow" />}
            <div>
              <p className="eyebrow">Token investigation</p>
              <h1 className="display-sm mt-0.5 text-[30px] leading-none text-ink sm:text-[34px]">{`$${token.symbol}`}</h1>
            </div>
            {establishedAsset && (
              <span className="chip tint-signal mb-0.5">
                Large market
              </span>
            )}
            {canShare && <CopyTldrButton base={tldrBase} mint={mintShareUrl} className="mb-0.5 ml-auto" />}
          </div>

          {/* Where the project actually lives, at the top where a reader looks
              first: official site, socials, and the contract in one click. */}
          <ProjectLinks
            className="mt-3"
            websites={[
              ...(evidencedProjectSites.length
                ? evidencedProjectSites.map((site, index) => ({
                    label: index === 0 ? `${projectAccount?.display_name || "Project"} site` : site.host,
                    url: site.url,
                  }))
                : projectAccount?.website
                  ? [{ label: `${projectAccount.display_name || "Project"} site`, url: projectAccount.website }]
                : []),
              ...(siteUrl
                ? [{ label: `$${token.symbol} site`, url: siteUrl }]
                : []),
            ]}
            xHandle={projectX ?? token.cg?.twitter}
            contractAddress={token.address}
            links={[...(recon?.socials ?? []), ...(token.socials ?? [])]}
          />

          <div className="investigation-hero-grid mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <section
              className={`panel investigation-hero-card flex flex-col ${readiness.status === "ready" ? "p-5" : "order-2 p-4 lg:p-5"}`}
              aria-label={readiness.status === "ready" ? "Risk score" : "Preliminary risk score"}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eyebrow">{readiness.status === "ready" ? "Risk score" : "Preliminary risk score"}</span>
                {readiness.status === "ready" ? (
                  <VerdictPill verdict={token.verdict} score={token.score} large />
                ) : (
                  <StatusPill
                    label="EARLY SCORE"
                    color="var(--color-caution)"
                    score={token.score}
                    title="This is an unfinished score, not a PASS or investment verdict."
                  />
                )}
              </div>
              <p className={`${readiness.status === "ready" ? "mt-4" : "mt-2.5"} text-[13px] leading-relaxed text-ink-dim`}>
                {readiness.status === "ready"
                  ? "This score uses the checks that finished. It is not an approval to buy or invest."
                  : "Based only on finished checks. Do not rely on this score until the required checks finish."}
              </p>
              <div className={`${readiness.status === "ready" ? "mt-auto" : "mt-3"} border-t border-line/70 pt-3`}>
                <p className="mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">Score only · not financial advice</p>
                <ScoreContextStrip
                  subjectRef={token.address}
                  score={token.score}
                  peerKind="token"
                  align="start"
                />
              </div>
            </section>

            <section
              className={`panel investigation-hero-card investigation-readiness-card flex flex-col p-5 tint-var ${readiness.status === "ready" ? "" : "order-1"}`}
              style={{ "--tint": readinessColor } as React.CSSProperties}
              aria-label="Report status"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eyebrow">Safety checks</span>
                <StatusPill label={readinessLabel} color={readinessColor} score={null} large />
              </div>
              <h2 className="mt-4 text-[17px] font-semibold leading-snug text-ink">
                {requiredGapChecks.length
                  ? `${requiredGapChecks.length} required safety ${requiredGapChecks.length === 1 ? "check is" : "checks are"} not finished`
                  : readiness.status === "ready"
                    ? "Required safety checks are finished"
                    : "This report does not have enough finished checks"}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                {requiredGapChecks.length
                  ? "You can still see the score, but this report is not ready until that check finishes."
                  : readiness.status === "ready"
                    ? "Extra research may still be open. We list it below so nothing is hidden."
                    : "Read the open questions below. Do not rely on this score yet."}
              </p>
              <div className="mt-auto pt-4">
                {unfinishedCounterChecks.length > 0 ? (
                  <details className="group">
                    <summary className="list-none [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center justify-between gap-3">
                        <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">Checks finished</span>
                        <span className="mono flex items-center gap-1.5 text-[11px] text-ink-dim">
                          {readiness.successful}/{readiness.applicable} · {readiness.coveragePercent}%
                          <span aria-hidden="true" className="text-[9px] text-ink-faint transition-transform group-open:rotate-180">▾</span>
                        </span>
                      </div>
                      <progress
                        className="readiness-progress mt-2"
                        value={readiness.coveragePercent}
                        max={100}
                        aria-label={`Checks finished: ${readiness.coveragePercent}%`}
                      />
                      <p className="mt-1.5 text-[10.5px] text-ink-faint group-open:hidden">
                        {unfinishedCounterChecks.length} not finished · click to see which, and why
                      </p>
                    </summary>
                    <ul className="mt-2 divide-y divide-line/60 border-t border-line/70" aria-label="Checks not finished">
                      {unfinishedCounterChecks.map((check) => (
                        <li key={check.checkId ?? check.label} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-[12px] font-medium text-ink">{check.label}</span>
                            {check.checkId && clearance.openNeverWaive.includes(check.checkId) && (
                              <span className="mono rounded border border-current px-1 py-0.5 text-[9px] uppercase tracking-wider" style={{ color: "var(--color-avoid)" }}>required</span>
                            )}
                            <span className="mono ml-auto text-[10px] uppercase tracking-wider text-ink-faint">
                              {check.status === "unavailable" ? "source unavailable" : check.status === "stale" ? "out of date" : "did not finish"}
                            </span>
                          </div>
                          {check.note && <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{check.note}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">Checks finished</span>
                      <span className="mono text-[11px] text-ink-dim">
                        {readiness.successful}/{readiness.applicable} · {readiness.coveragePercent}%
                      </span>
                    </div>
                    <progress
                      className="readiness-progress mt-2"
                      value={readiness.coveragePercent}
                      max={100}
                      aria-label={`Checks finished: ${readiness.coveragePercent}%`}
                    />
                  </>
                )}
              </div>
            </section>

            <section className={`panel investigation-hero-card investigation-market-card p-5 lg:col-span-2 xl:col-span-1 ${readiness.status === "ready" ? "" : "order-3"}`} aria-label="Market size">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow">Market size</span>
                {establishedAsset && <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-signal-lift">Large market</span>}
              </div>
              <div className="mt-4">
                <p className="display-sm text-[27px] leading-none text-ink">{money(marketCap)}</p>
                <p className="mono mt-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">Current market value</p>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 xl:grid-cols-2" aria-label="Market size details">
                <div>
                  <dt className="stat-label">Market rank</dt>
                  <dd className="stat-value mt-1 text-signal-lift">{token.cg?.rank ? `#${token.cg.rank}` : "N/A"}</dd>
                </div>
                <div>
                  <dt className="stat-label" title="Estimated value if every token were available to trade.">Value if all circulate</dt>
                  <dd className="stat-value mt-1">{money(fullyDilutedValue)}</dd>
                </div>
                <div>
                  <dt className="stat-label">Liquidity</dt>
                  <dd className="stat-value mt-1">{money(token.liquidityUsd)}</dd>
                </div>
                <div>
                  <dt className="stat-label">Holders</dt>
                  <dd className="stat-value mt-1">{token.safety?.holderCount ? token.safety.holderCount.toLocaleString() : "N/A"}</dd>
                </div>
              </dl>
              <p className="mono mt-5 border-t border-line/70 pt-3 text-[10.5px] uppercase tracking-[0.08em] text-signal-lift">
                Size helps with context · it does not make an asset safe
              </p>
            </section>
          </div>

          {noticedSignals.length > 0 && (
            <section className="panel mt-3 p-4" aria-label="What Argus noticed">
              <NoticedRail signals={noticedSignals} />
            </section>
          )}

          {(requiredGapChecks.length > 0 || readiness.status !== "ready") && <section
            className="panel clearance-boundary mt-3 flex flex-col gap-4 p-4 tint-var sm:flex-row sm:items-center sm:justify-between"
            style={{ "--tint": readinessColor } as React.CSSProperties}
            aria-label="Report warning"
          >
            <div>
              <p className="eyebrow">Before you use this report</p>
              <h2 className="mt-1 text-[14px] font-semibold text-ink">
                {requiredGapChecks.length
                  ? unretryableGapChecks.length === requiredGapChecks.length
                    ? `${requiredGapChecks.map((check) => check.label).join(", ")} could not run for this token.`
                    : `${requiredGapChecks.map((check) => check.label).join(", ")} must finish before this report is ready.`
                  : readiness.status === "ready"
                    ? "Required safety checks are finished."
                    : "This report is not ready to rely on yet."}
              </h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
                {requiredGapChecks.length
                  ? unretryableGapChecks.length === requiredGapChecks.length
                    ? `${unretryableGapChecks[0]?.note ?? "A required screen could not run."} A new scan would reach the same limit.`
                    : `${enrichmentGapChecks.length} extra ${enrichmentGapChecks.length === 1 ? "check is" : "checks are"} also open and listed below.`
                  : readiness.status === "ready"
                    ? `${enrichmentGapChecks.length} extra ${enrichmentGapChecks.length === 1 ? "check is" : "checks are"} still open. ${enrichmentGapChecks.length === 1 ? "It does" : "They do"} not block review.`
                    : "Open the check list to see what is missing."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <a href="#investigation-methodology" className="text-[12px] font-medium text-signal-lift underline-offset-2 hover:underline">
                See every check
              </a>
              {onReAudit && readiness.status !== "ready" && retryCanCloseAGap && (
                <button type="button" onClick={onReAudit} className="btn-primary min-h-10 px-3 text-[12px] font-medium">
                  <ArrowClockwise size={15} weight="duotone" aria-hidden="true" />
                  Retry required scan
                </button>
              )}
            </div>
          </section>}

          {projectAccount && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-dim">
              <span className="eyebrow">Project account</span>
              <ProjectAccountStatusPill
                reviewOpen={projectReviewOpen}
                verdict={presentedProjectVerdict}
                score={projectReviewOpen ? null : projectAccount.report.governing_score}
              />
              {projectReadiness && <span>{projectReadiness.successful}/{projectReadiness.applicable} checks finished</span>}
            </div>
          )}
          {/* Lead with the TEAM when we know it — don't declare "no team" when it's named below. */}
          {teamPeople.length > 0 ? (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">
              Built by {teamPeople.slice(0, 3).map((p) => p.name).filter(Boolean).join(", ")}{teamPeople.length > 3 ? ` +${teamPeople.length - 3} more` : ""}{projectX ? ` · project account ${projectX}` : ""}. Full team below.
            </p>
          ) : publishedTeamClaims.length > 0 ? (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">
              {projectAccount?.display_name || projectX || token.name} identifies {publishedTeamClaims.slice(0, 3).map((person) => `${person.handle || person.name}${person.role ? ` as ${formatRoleLabel(person.role)}` : ""}`).join(", ")}. This establishes the project's published role attribution; independent corroboration of identity, ownership, and control remains open.
            </p>
          ) : (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">{inv.founderNote}</p>
          )}
          {/* What the project actually IS — CoinGecko's own blurb, else the project's X bio. */}
          {(() => {
            const blurb = token.cg?.description || projectAccount?.bio || null;
            return blurb ? (
              <ExpandableText
                text={blurb}
                className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-dim"
              />
            ) : null;
          })()}
          <ReportDisclaimer className="mt-2 max-w-3xl" />
          {canMutateWorkspace && (
            <div className="mt-3 flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2/40 px-3 py-2.5">
              <span className="text-[12.5px] text-ink-dim">Get an alert when a later scan finds a change.</span>
              <button type="button" onClick={watch} aria-pressed={watched} className={`btn-chip ml-auto ${watched ? "tint-signal" : ""}`}>
                {watched ? "Watching report" : "Add to watchlist"}
              </button>
            </div>
          )}
          <p className="mono mt-2 break-all text-[11px] text-ink-faint">{inv.rootRef}</p>
        </div>

        <div className="investigation-story-nav sticky top-[101px] z-20 mt-6 sm:top-[65px]">
          <ReportCanvasSectionNav
            sticky={false}
            label="Report story"
            items={[
              { href: "#report-summary", label: "The short answer", icon: <ClipboardText size={16} weight="duotone" aria-hidden="true" /> },
              ...(projectAccount?.intelligence ? [{ href: "#decision-intelligence" as const, label: "Deep dive", icon: <ChartLineUp size={16} weight="duotone" aria-hidden="true" /> }] : []),
              ...(projectAccount?.evmControlReality ? [{ href: "#evm-control-surface" as const, label: "Control surface", icon: <ShieldWarning size={16} weight="duotone" aria-hidden="true" /> }] : []),
              { href: "#investigation-why", label: "Why", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#investigation-visuals", label: "Market", icon: <ChartLineUp size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#investigation-people", label: "People", icon: <IdentificationBadge size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#investigation-challenge", label: "Challenge", icon: <ShieldWarning size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#investigation-methodology", label: "Scan details", icon: <Graph size={16} weight="duotone" aria-hidden="true" /> },
            ]}
          />
        </div>

        <InvestigationDecisionCanvas
          verdictLabel={observedTokenMeta.label}
          favorable={favorableVerdict}
          verdictTone={decisionCanvasTone}
          argument={verdictArgument}
          decisionLensId={projectAccount?.intelligence ? decisionLensId : undefined}
          onDecisionLensChange={projectAccount?.intelligence ? setDecisionLensId : undefined}
          supports={supportItems}
          concerns={concernItems}
          context={intelligenceBrief.context.map((item) => ({
            label: item.title,
            detail: `${item.detail} ${item.provenance}`.trim(),
          }))}
          nextSteps={nextStepItems}
          verified={verifiedItems}
          openQuestions={openQuestionItems}
          coveragePercent={readiness.coveragePercent}
          successful={readiness.successful}
          applicable={readiness.applicable}
          capturedAt={capturedAt}
          evidenceHref="#investigation-evidence"
          methodologyHref="#investigation-methodology"
        />

        {projectAccount?.intelligence && (
          <PointInTimeIntelligencePanel
            snapshot={projectAccount.intelligence}
            thesisEligible={projectReadiness?.status === "ready" && projectAccount.report.composite_verdict !== "INCOMPLETE"}
            governingVerdict={projectAccount.report.composite_verdict}
            selectedLensId={decisionLensId}
            onSelectedLensChange={setDecisionLensId}
          />
        )}

        {projectAccount?.researchPlan && (
          <ResearchPlanPanel plan={projectAccount.researchPlan} className="mt-3" />
        )}

        {projectAccount?.evmControlReality && (
          <EvmControlSurfacePanel snapshot={projectAccount.evmControlReality} />
        )}

        <div id="investigation-why" className="story-chapter story-chapter-muted report-section scroll-mt-28 mt-7">
          <ReportSectionHeading
            index="02 · Why"
            title="Why ARGUS reached this result"
            description={showProjectBasicFacts
              ? "Start with the facts we could confirm. Possible leads stay separate so they are not mistaken for proof."
              : "Start with the saved evidence behind the score. Anything we could not confirm remains clearly marked below."}
          />
          {showProjectBasicFacts && (
            <BasicFactsPanel
              id="investigation-basic-facts"
              facts={projectBasicFacts}
              leads={projectBasicFactLeads}
              fillRequired
              supportingAffiliationCount={projectSourceBackedVentures.length}
            />
          )}
          {!showProjectBasicFacts && (
            <p className="panel px-4 py-3 text-[13px] leading-relaxed text-ink-dim">
              No separate project fact sheet was saved with this scan. The source cards below show the evidence ARGUS used.
            </p>
          )}
        </div>

        <div id="investigation-visuals" className="story-chapter report-section scroll-mt-28 mt-7">
          <ReportSectionHeading
            index="03 · Market"
            title="What the market tells us"
            description={`Company funding and the $${token.symbol} token are separate. Then review price, liquidity, ownership, and usage.`}
          />
          <div className="mt-3 space-y-3">
            <CapitalStructurePanel
              facts={projectBasicFacts}
              indexedRounds={projectAccount?.protocolFunding?.rounds ?? []}
              tokenSymbol={token.symbol}
              tokenMarketCap={projectAccount?.projectToken?.marketCapUsd ?? token.cg?.mcapUsd ?? marketCap}
              tokenFdv={projectAccount?.projectToken?.fdvUsd ?? fullyDilutedValue}
            />
            <MarketPerformancePanel
              token={token}
              projectToken={projectAccount?.projectToken}
              showCurrentIntelligence={showCurrentIntelligence}
              refreshCurrentMarket={currentIntelligenceEnabled}
              onLoadCurrentIntelligence={loadCurrentIntelligence}
            />
            <TokenSnapshotVisuals token={token} showPriceMomentum={false} />
            {isConcentratedLiquidityPool(token.dexId, token.dexLabels) && token.pairAddress && (
              <LpCustody chain={token.chain} pairAddress={token.pairAddress} />
            )}
            {(projectAccount?.protocolTvl || projectAccount?.protocolFees || projectAccount?.holderProfile) && (
              <UsageVisuals
                tvl={projectAccount.protocolTvl}
                fees={projectAccount.protocolFees}
                holders={projectAccount.holderProfile}
              />
            )}
            <DiligenceEvidenceLedgers
              company={projectAccount?.companyEnrichment}
              officialWebsite={projectAccount?.website ?? siteUrl}
              protocolFunding={projectAccount?.protocolFunding}
              protocolTvl={projectAccount?.protocolTvl}
              canonicalGeckoId={projectAccount?.projectToken?.coingeckoId}
            />
          </div>
        </div>

        <div id="investigation-people" className="story-chapter story-chapter-muted report-section scroll-mt-28 mt-7">
          <ReportSectionHeading
            index="04 · People"
            title="Project, deployer, and team"
            description="See the official project account, the wallet that deployed the token, and the people publicly tied to the project."
          />
          <div id="investigation-evidence" className="scroll-mt-28 grid gap-3 lg:grid-cols-2">
          {/* on-chain */}
          <Card title="Token record" accent={readiness.status === "ready" ? tm.color : "var(--color-caution)"}>
            <div className="flex items-center justify-between">
              <span className="mono text-[13.5px] text-ink">{`$${token.symbol}`}</span>
              {readiness.status === "ready" ? (
                <VerdictPill verdict={token.verdict} score={token.score} />
              ) : (
                <StatusPill label="EARLY SCORE" color="var(--color-caution)" score={token.score} />
              )}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">
              {plainLanguageSummary(token.headline)
                .replace(/^Clears the forensic bar:\s*/i, "Passed the main token checks: ")
                .replace(/owned, tradeable, with real depth/gi, "tradeable with meaningful liquidity")}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
              <span>Liquidity <span className="mono text-ink-dim">{money(token.liquidityUsd)}</span></span>
              <span>Market cap <span className="mono text-ink-dim">{money(token.mcap)}</span></span>
              <span>Network <span className="mono text-ink-dim capitalize">{token.chain}</span></span>
            </div>
            {/* CEX listings — real centralized-exchange listings are a strong legitimacy signal */}
            {token.cg?.cexNames && token.cg.cexNames.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/60 pt-2">
                <span className="text-[11px] text-ink-faint">listed on</span>
                {token.cg.cexNames.slice(0, 8).map((n) => (
                  <span key={n} className="chip tint-pass normal-case tracking-normal">{n}</span>
                ))}
                {token.cg.cexCount > 8 && <span className="text-[11px] text-ink-faint">+{token.cg.cexCount - 8} more</span>}
              </div>
            ) : token.cg && !token.cg.listed ? (
              <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-ink-faint">Not on CoinGecko · no centralized-exchange listings (DEX-only).</div>
            ) : token.cg && token.cg.cexCount === 0 ? (
              <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-ink-faint">No centralized-exchange listings (DEX-only).</div>
            ) : null}
            <button onClick={onOpenToken} className="btn-chip tint-signal mt-3">Open token report</button>
          </Card>

          <Card title="Project account and deployer">
            {/* project account — explicitly NOT a founder */}
            <div>
              <div className="eyebrow">Project account (not a founder)</div>
              {projectX ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="mono text-[12.5px] text-ink">{projectX}</span>
                  {projectAccount ? (
                    <ProjectAccountStatusPill
                      reviewOpen={projectReviewOpen}
                      verdict={presentedProjectVerdict}
                      score={projectReviewOpen ? null : projectAccount.report.governing_score}
                    />
                  ) : (
                    <button onClick={() => auditFounder(projectX)} disabled={spent >= MAX_FOUNDER_AUDITS} className="btn-chip tint-signal shrink-0 disabled:opacity-40">
                      {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "Audit"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] text-ink-faint">No X account linked to this token.</p>
              )}
            </div>

            {token.deployer && (
              <div className="mt-2.5 border-t border-line/60 pt-2.5 text-[11px] text-ink-faint">
                <div>
                  Deployed by <ArkhamName address={token.deployer} chain={token.chain} labels={arkham} fallback={shortAddr(token.deployer)} className="text-ink-dim" />
                  {/* Whole days alone printed "0d" for a wallet 95 minutes old
                      at the launch, and said nothing about whether the age was
                      measured at the launch or at the scan. The shared fact
                      picks the unit that carries the number and states its
                      basis, so this line and the operator panel cannot differ. */}
                  {deployerTrailAge && <> · <span className="text-ink-dim">{deployerTrailAge}</span></>}
                  {/* Floored, like the serial chip below: the count is read off
                      the wallet's most recent transactions, so it is a lower
                      bound and not a lifetime total. */}
                  {deployerTrail?.tokensCreated != null && <> · <span className="text-ink-dim">{deployerTrail.tokensCreated}+</span> tokens minted</>}
                </div>
                {deployerTrail?.chain && deployerTrail.chain.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-ink-faint">money trail</span>
                    <span className="chip normal-case tracking-normal">{shortAddr(token.deployer)}</span>
                    {deployerTrail.chain.map((h, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <ArrowLeft aria-hidden="true" size={11} weight="bold" className="text-ink-faint" />
                        {h.label ? (
                          <span className="chip tint-pass normal-case tracking-normal">{h.label}</span>
                        ) : (
                          <span className="chip normal-case tracking-normal">{shortAddr(h.to)}</span>
                        )}
                      </span>
                    ))}
                    {!deployerTrail.terminatesAtCex && <span className="text-ink-faint">· trail cold</span>}
                  </div>
                ) : deployerTrail?.funder ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span>funded by</span>
                    {deployerTrail.funder.label ? (
                      <span className="chip tint-pass normal-case tracking-normal">{deployerTrail.funder.label}</span>
                    ) : (
                      <ArkhamName address={deployerTrail.funder.address} chain={token.chain} labels={arkham} fallback={shortAddr(deployerTrail.funder.address)} className="text-ink-dim" />
                    )}
                  </div>
                ) : null}
                {deployerTrail?.serialDeployer && (
                  <span className="chip tint-avoid mt-1">serial deployer · {deployerTrail.tokensCreated}+ tokens</span>
                )}
                {deployerTrail && <div className="mt-1 leading-snug">{deployerTrail.note}</div>}
                {!deployerTrail && <div className="mt-0.5">We could not confirm who owns the wallet that deployed the contract.</div>}
              </div>
            )}
          </Card>
          </div>
          <div id="investigation-team" className="mt-3 scroll-mt-28">
            <Card title="Team evidence">
              {teamPeople.length > 0 ? (
                <div>
                  <p className="text-[12.5px] leading-relaxed text-ink-dim">
                    {teamPeople.length} source-grounded {teamPeople.length === 1 ? "person is" : "people are"} tied to this project. People are grouped by their published role.
                  </p>
                  <div className="mt-3 space-y-3">
                    {teamGroups.map((group) => (
                      <section key={group.label} aria-label={group.label}>
                        <div className="eyebrow">{group.label} ({group.people.length})</div>
                        <div className="mt-1.5 space-y-1.5">
                          {group.people.map((m) => {
                            const roleProof = normalizedPublicUrl(m.sourceUrl);
                            return (
                            <div key={m.handle ?? m.name} className="flex items-start justify-between gap-2">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <Avatar src={personAvatar(m.handle, m.linkedin)} letter={initial(m.name)} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                                <span className="text-[12.5px] text-ink">{m.name}</span>
                                {m.handle && !teamNameLooksLikeHandle(m) && <span className="mono text-[11px] text-ink-faint">{m.handle}</span>}
                                {m.role && <span className="text-[11px] text-ink-faint">{formatRoleLabel(m.role)}</span>}
                                {m.linkedin && (
                                  <a href={`https://${m.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>
                                )}
                                {roleProof && (
                                  <a href={roleProof} target="_blank" rel="noreferrer" className="link-ext text-[11px]">role proof</a>
                                )}
                                {m.developerProfiles?.map((profile) => {
                                  const profileUrl = normalizedPublicUrl(profile.url);
                                  const profileProof = normalizedPublicUrl(profile.sourceUrl);
                                  if (!profileUrl) return null;
                                  return (
                                    <span key={profile.url} className="inline-flex items-center gap-1">
                                      <a href={profileUrl} target="_blank" rel="noreferrer" className="link-ext text-[11px]">
                                        {profile.provider === "github" ? "GitHub" : "Hugging Face"}
                                      </a>
                                      {profileProof && (
                                        <a href={profileProof} target="_blank" rel="noreferrer" className="text-[10px] text-ink-faint underline-offset-2 hover:underline">
                                          profile link proof
                                        </a>
                                      )}
                                    </span>
                                  );
                                })}
                                <span className="chip normal-case tracking-normal">{m.source}</span>
                                {m.evidence && <span className="min-w-full pl-7 text-[10.5px] leading-relaxed text-ink-faint">{m.evidence}</span>}
                              </span>
                              {m.handle ? (
                                <button
                                  onClick={() => auditFounder(m.handle!)}
                                  disabled={spent >= MAX_FOUNDER_AUDITS}
                                  className="btn-chip tint-signal shrink-0 disabled:opacity-40"
                                >
                                  {spent >= MAX_FOUNDER_AUDITS ? "review limit reached" : "Review"}
                                </button>
                              ) : (
                                <span className="shrink-0 text-[11px] text-ink-faint">No X profile</span>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[12.5px] font-medium text-ink">No independently corroborated team member was found.</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                    {publishedTeamClaims.length > 0
                      ? "The project-published role attribution is shown below. The stated role is separate from independent verification of the person, ownership, or operational control."
                      : recon?.team.state === "named"
                        ? "The rendered project site published names below, but those first-party claims were not independently corroborated."
                      : recon ? recon.identityLine : inv.founderNote}
                  </p>
                </div>
              )}
              {publishedTeamClaims.length > 0 && (
                <section className="mt-3 border-t border-line/60 pt-3" aria-label="Project-attributed team">
                  <div className="eyebrow">Project-attributed team ({publishedTeamClaims.length})</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                    The project site or account identifies these people in the roles shown. ARGUS can state that attribution directly while keeping independent identity, ownership, wallet, and control verification separate.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {publishedTeamClaims.map((person) => (
                      <div key={`${person.source}:${person.handle ?? person.name}`} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <Avatar src={personAvatar(person.handle)} letter={initial(person.name)} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                          <span className="text-[12.5px] text-ink">{person.name}</span>
                          {person.handle && !teamNameLooksLikeHandle(person) && <span className="mono text-[11px] text-ink-faint">{person.handle}</span>}
                          {person.role && <span className="text-[11px] text-ink-faint">{formatRoleLabel(person.role)}</span>}
                          <span className="chip normal-case tracking-normal">{person.source}</span>
                          {person.sourceUrl && (
                            <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="link-ext text-[11px]">attribution source</a>
                          )}
                          {person.evidence && <span className="min-w-full pl-7 text-[10.5px] leading-relaxed text-ink-faint">{person.evidence}</span>}
                        </span>
                        {person.handle ? (
                          <button
                            onClick={() => auditFounder(person.handle!)}
                            disabled={spent >= MAX_FOUNDER_AUDITS}
                            className="btn-chip tint-signal shrink-0 disabled:opacity-40"
                          >
                            {spent >= MAX_FOUNDER_AUDITS ? "review limit reached" : "Review"}
                          </button>
                        ) : (
                          <span className="shrink-0 text-[11px] text-ink-faint">Claim only</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {supplementalTeamLeads.length > 0 && (
                <section className="mt-3 border-t border-line/60 pt-3" aria-label="Unverified supplemental team leads">
                  <div className="eyebrow">Possible people to verify ({supplementalTeamLeads.length})</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                    Search candidates, X associations, and code contributors are shown for follow-up. They are not counted as team or verdict support.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {supplementalTeamLeads.map((person, index) => (
                      <div key={`${person.provider ?? "unknown"}:${person.handle ?? person.name}:${index}`} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <Avatar src={personAvatar(person.handle, person.linkedin)} letter={initial(person.name)} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                          <span className="text-[12.5px] text-ink">{person.name}</span>
                          {person.handle && <span className="mono text-[11px] text-ink-faint">{person.handle}</span>}
                          {person.role && <span className="text-[11px] text-ink-faint">{formatRoleLabel(person.role)}</span>}
                          {person.linkedin && <a href={person.linkedin} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>}
                          <span className="chip normal-case tracking-normal">{supplementalTeamLeadLabel(person)}</span>
                        </span>
                        {person.handle ? (
                          <button
                            onClick={() => auditFounder(person.handle!)}
                            disabled={spent >= MAX_FOUNDER_AUDITS}
                            className="btn-chip tint-signal shrink-0 disabled:opacity-40"
                          >
                            {spent >= MAX_FOUNDER_AUDITS ? "review limit reached" : "Review"}
                          </button>
                        ) : (
                          <span className="shrink-0 text-[11px] text-ink-faint">Candidate only</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {supplementalTeamCoverageNote && (
                <p className="mt-3 border-t border-line/60 pt-3 text-[11px] leading-snug text-ink-faint">{supplementalTeamCoverageNote}</p>
              )}
              {leadershipCurrency.length > 0 && (
                <section
                  aria-label="Leadership currency"
                  className={teamPeople.length > 0 ? "mt-3 border-t border-line/60 pt-3" : ""}
                >
                  <div className="eyebrow">Does the named leadership still list this project? ({leadershipCurrency.length})</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                    Checked against a licensed employment record for the named founders and C-level, three people at most.
                    That record is a copy of a LinkedIn profile and can lag the live page, so each row carries the record's
                    own date and a link to confirm it against.
                    {leadershipUnanswered > 0
                      ? ` The record held no role for ${leadershipUnanswered} other named ${leadershipUnanswered === 1 ? "leader" : "leaders"}; an unanswered lookup is not reported either way.`
                      : ""}
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {leadershipCurrency.map((row) => {
                      const departed = row.state === "departed";
                      const profile = normalizedPublicUrl(row.linkedin);
                      const age = departed ? recordAgeLabel(row.ended, leadershipReferenceTime) : null;
                      return (
                        <div key={`${row.name}-${row.role}`} className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-[12.5px] text-ink">{row.name}</span>
                          {row.role && <span className="text-[11px] text-ink-faint">{formatRoleLabel(row.role)}</span>}
                          <span className={departed ? "chip tint-avoid" : "chip tint-pass"}>
                            {departed ? "no longer lists this project" : "still lists this project"}
                          </span>
                          {departed && (
                            <span className="text-[11px] text-ink-dim">
                              {row.ended
                                ? `record ends ${formatRecordDate(row.ended)}${age ? ` · that record is ${age}` : ""}`
                                : "the record does not state an end date"}
                            </span>
                          )}
                          {profile && (
                            <a href={profile} target="_blank" rel="noreferrer" className="link-ext text-[11px]">
                              confirm on LinkedIn
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              {advisors.length > 0 && (
                <div className={teamPeople.length > 0 ? "mt-3 border-t border-line/60 pt-3" : ""}>
                  <div className="eyebrow">Claimed advisors and backers ({advisors.length})</div>
                  <p className="mt-1 text-[11.5px] text-ink-faint">These names are checked separately and are not counted as team members.</p>
                  <div className="mt-1.5 space-y-1.5">
                    {advisors.map((a) => {
                      const c = advisorChip(a.corroboration_verdict);
                      return (
                        <div key={a.claimed_endorser_handle} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <Avatar src={a.claimed_endorser_handle ? xAvatar(a.claimed_endorser_handle) : null} letter={initial(a.claimed_endorser_handle ?? "?")} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                            <span className="mono text-[12.5px] text-ink">{a.claimed_endorser_handle}</span>
                            <span className="chip tint-var" style={{ "--tint": c.color } as React.CSSProperties}>{c.label}</span>
                            {a.follows_subject === false && <span className="text-[11px] text-ink-dim">does not follow project</span>}
                          </span>
                          {a.claimed_endorser_handle && (
                            <button
                              onClick={() => auditFounder(a.claimed_endorser_handle!)}
                              disabled={spent >= MAX_FOUNDER_AUDITS}
                              className="btn-chip tint-signal shrink-0 disabled:opacity-40"
                            >
                              {spent >= MAX_FOUNDER_AUDITS ? "review limit reached" : "Review"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug text-ink-faint">A claimed advisor who has never publicly acknowledged the project may be a misleading name-drop.</p>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* on-chain forensic suite — the same cluster the token report uses:
            market intel, holders, clustering, operator trace, EVM deployer +
            bytecode, and the OFAC sanctions screen, in one canonical order. */}
        {showCurrentIntelligence && panelCostToken && (
          <div className="mt-3">
            <OnChainForensics token={token} onAudit={onAudit} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} projectHandle={projectX} projectWebsite={siteUrl} />
            {arkhamEnabled && (arkhamState === "rescan_required" || arkhamState === "unavailable") && (
              <PanelRequestNotice failure={arkhamState} label="Wallet identity labels" className="mt-3" />
            )}
            {arkhamEnabled && canRecordCurrentIntelligence && <ArkhamGraphBridge subject={`$${token.symbol}`} labels={arkham} />}
            {arkhamEnabled && token.deployer && <MoneyFlowStory address={token.deployer} chain={token.chain} panelCostToken={panelCostToken} roleLabel={deployerRoleLabel(token.deployerAttribution)} />}
            {arkhamEnabled && token.deployer && <Counterparties address={token.deployer} subject={`$${token.symbol}`} chain={token.chain} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />}
            {arkhamEnabled && token.deployer && <RiskPaths address={token.deployer} panelCostToken={panelCostToken} />}
            {arkhamEnabled && token.deployer && <div className="mt-3"><Holdings address={token.deployer} symbol={token.symbol} panelCostToken={panelCostToken} /></div>}
          </div>
        )}

        {/* token provenance: who it's named after, and whether they're behind it */}
        {showCurrentIntelligence && panelCostToken && (
          <div className="mt-3">
            <NamesakeCheck symbol={token.symbol} name={token.name} contract={token.address} chain={token.chain} panelCostToken={panelCostToken} onAudit={onAudit} />
          </div>
        )}

        {/* unified project research: news & press, documents & resources, domain
            intelligence, and GitHub forensics — the same cluster every report uses */}
        {showCurrentIntelligence && (
          <div className="mt-3">
            <ProjectResearch name={token.name} symbol={token.symbol} domain={projectDomain} githubOrg={ghOrg} subjectKey={`$${token.symbol}`} newsHandle={projectX} record={canRecordCurrentIntelligence} {...(panelCostToken ? { panelCostToken } : {})} />
          </div>
        )}

        {/* Connection web: the subject's graph + its ties to everything else you've
            audited — the deeper map, below the team. */}
        {hasConnectionsChapter && invGraph && (
          <div id="investigation-relationships" className="story-chapter story-chapter-muted report-section scroll-mt-28 mt-7">
            <ReportSectionHeading
              index={chapterLabel(connectionsChapterNumber, "Connections")}
              title="How these people and wallets connect"
              description="The graph shows recorded links. A link by itself does not mean wrongdoing."
            />
            <Card title="Connection web · click any node to open it">
              <TrustGraph nodes={invGraph.nodes} edges={invGraph.edges} connections={showCurrentIntelligence ? connections : []} onAudit={onAudit} onOpenProject={(name) => onAudit(name)} />
            </Card>
          </div>
        )}

        {/* project account dossier detail */}
        {projectAccount && (
          <div className="mt-3">
            <Card title={`Project account · ${projectAccount.handle}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Avatar src={projectAccount.avatar_url || token.imageUrl || xAvatar(projectAccount.handle)} letter={initial(projectAccount.handle)} size={28} rounded="rounded-lg" letterClass="text-[12px]" />
                <span className="text-[13.5px] font-medium text-ink">{projectAccount.display_name || projectAccount.handle}</span>
                <ProjectAccountStatusPill
                  reviewOpen={projectReviewOpen}
                  verdict={presentedProjectVerdict}
                  score={projectReviewOpen ? null : projectAccount.report.governing_score}
                />
                <span className="ml-auto text-[11px] text-ink-faint">{projectAccount.followers} followers · joined {projectAccount.joined}</span>
              </div>
              {/* why the score landed where it did. This score reviews the X
                  ACCOUNT behind the project (team, backing, disclosures) and is
                  deliberately separate from the token score at the top of the
                  report, which audits the contract and its market. Say so, or
                  the report reads as carrying two contradictory scores. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                {projectAccount.report.governing_role
                  ? <span>this scores the project's X account ({String(projectAccount.report.governing_role).toLowerCase()} review), separate from the token score above</span>
                  : <span>Account score not ready</span>}
                {projectAccount.report.cap_applied && <span className="chip tint-avoid">score limited · {String(projectAccount.report.cap_applied).replace(/_/g, " ")}</span>}
                <button onClick={onOpenProjectAccount} className="btn-chip tint-signal ml-auto">Open full report</button>
              </div>
              {projectAccount.bio && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{projectAccount.bio}</p>}
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{projectAccountHeadline}</p>
              {projectAccount.evidence.ventures.length > 0 && (
                <div className="mt-2 border-t border-line/60 pt-2">
                  <div className="eyebrow">Verified links</div>
                  {projectSourceBackedVentures.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">
                    {projectSourceBackedVentures.slice(0, 6).map((v, i) => (
                      <span key={i} className="chip normal-case tracking-normal">{v.project_name}</span>
                    ))}
                  </div>}
                  <div className="mt-1 text-[10.5px] text-ink-faint">
                    {projectSourceBackedVentures.length} verified
                    {projectLegacyVentureCount > 0 ? ` · ${projectLegacyVentureCount} saved` : ""}
                    {projectUnverifiedVentureCount > 0 ? ` · ${projectUnverifiedVentureCount} possible lead${projectUnverifiedVentureCount === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="story-chapter report-section scroll-mt-28 mt-7">
          <ReportSectionHeading
            index={chapterLabel(challengeChapterNumber, "Challenge")}
            title="What could change the result"
            description="Tell ARGUS what looks wrong or missing. We will compare your concern with the evidence saved in this report."
          />
          <SecondOpinion
            id="investigation-challenge"
            dossier={token}
            panelCostToken={panelCostToken}
            onRescan={onReAudit}
          />
        </div>

        {/* transparent scan methodology — what ARGUS checked + the outcome of each */}
        <div className="story-chapter story-chapter-muted report-section mt-7">
          <ReportSectionHeading
            index={chapterLabel(scanDetailsChapterNumber, "Scan details")}
            title="What ARGUS checked"
            description="Open each list to see what finished, what needs attention, and what could not be completed."
          />
          <div className="mt-3 space-y-3">
            <MethodologyChecklist
              id="investigation-methodology"
              checks={diligenceChecks}
              summaryLabel="Token checks"
            />
            {projectAccount && projectChecks.length > 0 && (
              <MethodologyChecklist
                id="investigation-project-methodology"
                checks={projectChecks}
                summaryLabel="Project account checks"
              />
            )}
          </div>
        </div>

        {/* ask-the-report chat — grounded in this investigation's own evidence */}
        <div className="mt-3">
          <AskReport
            subject={`$${token.symbol}`}
            reportVersionId={versionContext?.reportVersionId
              ?? (inv.persistence?.state === "persisted" ? inv.persistence.reportVersionId : undefined)
              ?? undefined}
            context={[
            inv.founderNote,
            token.headline,
            `scored token verdict ${token.verdict} ${token.score ?? ""}; decision readiness ${readiness.status}; ${readiness.successful}/${readiness.applicable} evidence outcomes recorded`,
            projectAccount && projectReadiness ? `project account scored verdict ${projectAccount.report.composite_verdict} ${projectAccount.report.governing_score ?? ""}; decision readiness ${projectReadiness.status}; ${projectReadiness.successful}/${projectReadiness.applicable} evidence outcomes recorded` : "",
            teamPeople.length ? `team: ${teamPeople.map((p) => p.name + (p.handle ? ` ${p.handle}` : "")).join(", ")}` : "",
            projectX ? `project X account ${projectX}` : "",
            token.deployer ? `deployer wallet ${token.deployer}` : "",
            deployerTrail?.funder ? `funder ${deployerTrail.funder.label ?? deployerTrail.funder.address}` : "",
            !versionContext && connections.length ? `already connected to: ${connections.map((c) => c.other).join(", ")}` : "",
            invGraph ? `graph entities: ${[...new Set(invGraph.nodes.map((n) => String(n.key)))].slice(0, 30).join(", ")}` : "",
            ].filter(Boolean).join(" | ")}
          />
        </div>

        {/* analyst augmentation — add a piece the scan missed (verified before publish) */}
        {showCurrentIntelligence && canMutateWorkspace && (
          <div className="mt-3">
            <AddInfo subject={`$${token.symbol}`} subjectKind="investigation" canonicalRef={token.address} subjectGraphKey={tokenSubjectGraphKey} />
          </div>
        )}

        {/* hard link — manually bridge this subject to another entity in the graph */}
        {showCurrentIntelligence && canMutateWorkspace && (
          <div className="mt-3">
            <LinkEntity subject={`$${token.symbol}`} subjectKind="investigation" canonicalRef={token.address} graphSubjectKey={tokenSubjectGraphKey} />
          </div>
        )}

        {/* Full threat scan merged into the investigation: verdict, flags, AI
            source read, launch provenance, tokenomics, checklist - shares the
            1h scan cache with the standalone Threat scan surface. */}
        <div className="mt-4 panel p-5">
          <div className="eyebrow mb-1">Threat scan</div>
          <EmbeddedThreatScan address={token.address} chain={token.chain} />
        </div>

        <div className="mt-4 panel p-4 text-[12.5px] leading-relaxed text-ink-faint">
          ARGUS checked the token, website, project account, and public team. Open a person to run a deeper review. Names without a verified profile stay unconfirmed.
        </div>
      </div>
      <ArgusEyeAssistant inv={inv} reportVersionId={frozenReportVersionId} />
    </div>
  );
}
