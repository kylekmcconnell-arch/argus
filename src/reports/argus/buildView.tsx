/* Build the redesign's presentation contract from ONE frozen report version.

   Inputs are the saved dossier plus the values the report surface already
   derives from it (presentation state, composition rows, decision basis,
   verification questions). Nothing here scores, rescores or rewrites saved
   evidence: every figure is read from a frozen field, every label names its
   source tier, and absent evidence stays absent. */

import type { Dossier } from "../../data/dossier";
import { personRecordSummary, personRecords } from "./personEvidence";
import type { WebTeamMember } from "../../data/evidence";
import type { DecisionBasisRow } from "../../lib/decisionBasis";
import type { FundingEvidenceSummary } from "../../lib/fundingEvidence";
import type { BasicFactView } from "../../components/BasicFactsPanel";
import type { DecisionLensId, IntelligenceSourceRef } from "../../intelligence/types";
import { deriveIntelligenceBrief, type IntelligenceBriefItem } from "../../lib/intelligenceBrief";
import type { DecisionDiscovery } from "../../lib/reportInsights";
import { judgmentLine } from "../../lib/verdictNarrative";
import { plainDecisionText } from "../../lib/plainDecisionText";
import { linkedinAvatar, trustedOfficialTeamPortraitUrl, trustedOfficialXAvatarUrl, xAvatar } from "../../lib/avatars";
import { plainLanguageSummary } from "../../lib/plainLanguage";
import { auditStoredReportQuality } from "../../lib/reportQualityAudit";
import { canonicalBasicFactPredicate } from "../../lib/basicFactQuestions";
import {
  chainLabel,
  countShort,
  exactPercent,
  finite,
  floorTo,
  linkedinIdentityMismatch,
  linkedinSlug,
  parseBuySellTally,
  personContacts,
  personSourceBadge,
  priceUsd,
  productLabel,
  providerLabel,
  questionIsOpen,
  reconciliationIssues,
  recordedLinkedinsFor,
  safeHttpUrl,
  shortAddress,
  signedPct,
  sourceTierLabel,
  evidenceStateLabel,
  uniqueArtifactCount,
  usd,
  usdShort,
  utcDay,
  utcMonth,
  utcStamp,
  verdictTone,
  verdictWord,
  type ChapterId,
  type HolderRow,
  type ReportIssue,
  type Tone,
} from "./model";
import { HolderReconciliation } from "./chapters/HolderReconciliation";
import type {
  ConnectionView,
  LensView,
  Metric,
  NextStep,
  PersonCardView,
  ProductClaim,
  QuestionView,
  ReportView,
  ScoreRowView,
  ScoreView,
  SourceCard,
  TimelineEvent,
} from "./view";

export interface CompositionInputRow {
  axis: string;
  label: string;
  score: number;
  weight: number;
  rationale: string;
  supportCount?: number;
  applicability?: "not_applicable" | "deferred" | "unassessed";
  sublabel?: string;
}

export interface NarrativeInput { id?: string; title: string; detail?: string; provenance?: string }

export interface PersonViewInput {
  dossier: Dossier;
  isProject: boolean;
  presentedVerdict: string;
  scoreFinal: boolean;
  publishedScore: number | null;
  withheldNote?: string | null;
  compositionRows: CompositionInputRow[];
  decisionRows: DecisionBasisRow[];
  capNote?: string | null;
  /** Report status wording and preliminary signal for a non-final result. */
  statusLine?: string | null;
  tokenScore: {
    score: number | null;
    verdict: string | null;
    rows: Array<{ axis: string; label: string; score: number; weight: number; rationale: string }>;
    unavailableCopy?: string;
  } | null;
  tokenTreatment?: string | null;
  tokenTreatmentReason?: string | null;
  openingSummary: string;
  basicFacts: BasicFactView[];
  fundingEvidence: FundingEvidenceSummary;
  webTeam: WebTeamMember[];
  readiness: { successful: number; applicable: number };
  verificationQuestions: NarrativeInput[];
  supports: NarrativeInput[];
  concerns: NarrativeInput[];
  remainingPoints: NarrativeInput[];
  caseLabel: string | null;
  auditId: string;
  version?: number;
  savedAt?: string | null;
  attestation?: string | null;
  relatedLeadCount: number;
  /** Frozen questions a later binding in the same report already answered. */
  isStaleQuestion?: (item: { id: string; title: string }) => boolean;
  /** One non-obvious, source-backed discovery already selected by the report. */
  discovery?: DecisionDiscovery | null;
  /** Required checks that did not finish, with the note saved for each. */
  openChecks?: Array<{ label: string; note?: string }>;
  legacyCoverageNote?: string | null;
  favorable?: boolean;
  /** Plain-language summary of unverified adverse leads that name the subject. */
  subjectLeadSummary?: string;
  subjectLeadCount?: number;
  cleanScreenLabels?: string[];
  noCleanScreenCopy?: string;
  capLabel?: string | null;
  identityLabel?: { label: string; tone: Tone } | null;
  categoryLabel?: { label: string; basis: string } | null;
  /** A live scan whose immutable version was saved during this session. */
  liveSaved?: boolean;
  /** Why a shown score is still provisional (the saved presentation note). */
  provisionalNote?: string | null;
  /** How many scored areas carry linked sources. */
  sourcedAreas?: { backed: number; total: number } | null;
  /** Contradictions after related-entity quarantine (never the raw list). */
  contradictions?: Dossier["contradictions"];
}

// ── mapping tables ───────────────────────────────────────────────────────

const AXIS_CHAPTER: Record<string, ChapterId> = {
  P1_team_and_identity: "people",
  P2_product_substance: "product",
  P3_token_conduct: "market",
  P4_backing_and_partners: "connections",
  P5_traction_and_liveness: "product",
  P6_transparency_integrity: "evidence",
  T1: "market",
  T2: "market",
  T3: "market",
  T4: "market",
  T5: "market",
  T6: "market",
};

const TOKEN_AXIS_ORDER = ["T2", "T1", "T4", "T3", "T5", "T6"];
const TOKEN_AXIS_LABEL: Record<string, string> = {
  T1: "Liquidity",
  T2: "Code and security",
  T3: "Trading costs",
  T4: "Holders",
  T5: "Trading activity",
  T6: "Maturity and presence",
};

const DOMAIN_CHAPTER: Record<string, ChapterId> = {
  identity: "people",
  team: "people",
  career: "people",
  track_record: "people",
  product: "product",
  operations: "product",
  chronology: "product",
  market: "market",
  liquidity: "market",
  supply: "market",
  economics: "market",
  control: "market",
  funding: "connections",
  relationships: "connections",
  portfolio: "connections",
  fund_scale: "connections",
  treasury: "connections",
  reputation: "social",
  governance: "evidence",
  legal: "evidence",
  security: "evidence",
};

function sentence(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function short(value: string, max = 220): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item).trim().toLowerCase();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

// ── scores ───────────────────────────────────────────────────────────────

function sumLine(values: number[]): string {
  return values.join(" + ");
}

function arithmeticNote(rows: ScoreRowView[], score: number | null, capNote?: string | null): string {
  const scored = rows.filter((row) => !row.applicability);
  if (!scored.length) return "No scored composition is saved for this result.";
  const awarded = scored.reduce((sum, row) => sum + row.awarded, 0);
  const max = scored.reduce((sum, row) => sum + row.max, 0);
  const lines = [`${sumLine(scored.map((row) => row.awarded))} = ${awarded}. The ${scored.length} maxima sum to ${max}.`];
  if (score == null) {
    lines.push("The saved result is withheld, so no headline score is shown.");
  } else if (max === 100 && awarded === score) {
    lines.push("The saved total is arithmetically consistent.");
  } else if (max > 0 && max !== 100 && Math.round((awarded / max) * 100) === score) {
    lines.push(`Normalized over the applicable weight: 100 × ${awarded} / ${max} = ${((awarded / max) * 100).toFixed(2)}, saved as ${score}.`);
  } else if (capNote) {
    lines.push(`The saved score is ${score}: ${capNote}.`);
  } else {
    lines.push(`The saved score is ${score}. It differs from the row sum, and the saved report does not record why; the saved score is shown unchanged.`);
  }
  return lines.join(" ");
}

function primaryScoreView(input: PersonViewInput): ScoreView {
  const f = input.dossier;
  const byAxis = new Map(input.decisionRows.map((row) => [row.axis, row]));
  const roleAxes = f.report.role_reports.find((role) => role.role === f.report.governing_role)?.axes ?? {};
  const axisOrder = (axis: string) => {
    const match = axis.match(/^[A-Z]+(\d+)/);
    return match ? Number(match[1]) : 99;
  };
  const ordered = [...input.compositionRows].sort((left, right) => axisOrder(left.axis) - axisOrder(right.axis));
  const rows: ScoreRowView[] = ordered.map((row) => {
    const basis = byAxis.get(row.axis);
    const gaps = basis?.gaps ?? (roleAxes as Record<string, { gaps?: string[] }>)[row.axis]?.gaps ?? [];
    const counters = (basis?.counter ?? []).map((record) => sentence(plainLanguageSummary(record.title || record.excerpt || "")));
    const band = f.projectStrengthBands?.[row.axis];
    return {
      key: row.axis,
      label: row.label,
      awarded: row.score,
      max: row.weight,
      rationale: plainLanguageSummary(row.rationale ?? ""),
      review: uniqueBy([...counters, ...gaps.map((gap) => sentence(plainLanguageSummary(gap)))], (value) => value).filter(Boolean),
      ...(row.supportCount != null ? { supportCount: row.supportCount } : {}),
      chapter: AXIS_CHAPTER[row.axis] ?? "evidence",
      ...(row.applicability ? { applicability: row.applicability, note: row.sublabel ?? "Not scored" } : {}),
      band: band && finite(band.minScore) && finite(band.maxScore) ? { min: band.minScore, max: band.maxScore, tier: band.tier } : null,
    };
  });
  const verdict = input.presentedVerdict;
  return {
    id: input.isProject ? "company" : "person",
    eyebrow: input.isProject ? "Company diligence" : "Person diligence",
    score: input.publishedScore,
    verdict,
    verdictWord: verdictWord(verdict),
    tone: verdictTone(verdict),
    foot: `${input.isProject ? "People, product, backing and execution." : "Identity, track record, relationships and concerns."}${input.scoreFinal ? "" : " Provisional saved assessment."}${input.capLabel ? ` Score limited: ${input.capLabel}.` : ""}`,
    rows,
    arithmetic: [
      arithmeticNote(rows, input.publishedScore, input.capNote),
      (() => {
        const role = f.report.role_reports.find((candidate) => candidate.role === f.report.governing_role);
        if (!role || !(role.dox_bonus > 0 || role.cap_applied)) return "";
        return `Points before safety limits: ${role.raw_total}${role.dox_bonus > 0 ? ` + ${role.dox_bonus} bonus` : ""}. Current score ${role.score_total}.`;
      })(),
    ].filter(Boolean).join(" "),
    provisional: !input.scoreFinal,
    status: input.scoreFinal ? null : input.statusLine ?? null,
    ...(input.publishedScore == null ? { withheldReason: input.withheldNote ?? "The score is withheld because required evidence is incomplete." } : {}),
  };
}

// ── token context from the saved threat leg ──────────────────────────────

interface TokenContext {
  riskLens: { risk: number | null; verdict: string | null } | null;
  largestNonPool: number | null;
  largestNonPoolAddress: string | null;
  lockers: string[];
  lockedPct: number | null;
  burnedSupplyPct: number | null;
  tape: { buys: number; sells: number; buyUsd?: number; sellUsd?: number; note?: string } | null;
  holdersAnalyzed: number | null;
  simulation: boolean;
  headline: string | null;
  positives: string[];
  topHolders: Array<{ address: string; percent: number; isContract?: boolean; tag?: string }>;
}

function tokenContext(f: Dossier): TokenContext {
  const threat = f.threat ?? null;
  const call = (threat as { call?: { risk?: number; verdict?: string; positives?: string[] } } | null)?.call;
  const tokenomics = (threat as { tokenomics?: { realHolderTopPct?: number; lp?: { lockers?: string[]; lockedPct?: number }; burn?: { burnedSupplyPct?: number } } } | null)?.tokenomics;
  const deep = (threat as { deep?: { sellers?: { recentTape?: { buys?: number; sells?: number; buyUsd?: number; sellUsd?: number; note?: string } | null }; honeypot?: { holdersAnalyzed?: number } | null } } | null)?.deep;
  const dossier = threat?.dossier as unknown as { headline?: string; safety?: { tradeabilityMethod?: string }; topHolders?: Array<{ address: string; percent: number; isContract?: boolean; tag?: string }> } | undefined;
  const tape = deep?.sellers?.recentTape;
  const topHolders = dossier?.topHolders ?? [];
  const largest = finite(tokenomics?.realHolderTopPct) ? tokenomics!.realHolderTopPct! : null;
  const largestAddress = largest != null
    ? topHolders.find((holder) => Math.abs(holder.percent - largest) < 0.0001)?.address ?? null
    : null;
  return {
    riskLens: call ? { risk: finite(call.risk) ? call.risk : null, verdict: call.verdict ?? null } : null,
    largestNonPool: largest,
    largestNonPoolAddress: largestAddress,
    lockers: tokenomics?.lp?.lockers ?? [],
    lockedPct: finite(tokenomics?.lp?.lockedPct) ? tokenomics!.lp!.lockedPct! : null,
    burnedSupplyPct: finite(tokenomics?.burn?.burnedSupplyPct) ? tokenomics!.burn!.burnedSupplyPct! : null,
    tape: tape && finite(tape.buys) && finite(tape.sells)
      ? { buys: tape.buys!, sells: tape.sells!, ...(finite(tape.buyUsd) ? { buyUsd: tape.buyUsd } : {}), ...(finite(tape.sellUsd) ? { sellUsd: tape.sellUsd } : {}), ...(tape.note ? { note: tape.note } : {}) }
      : null,
    holdersAnalyzed: finite(deep?.honeypot?.holdersAnalyzed) ? deep!.honeypot!.holdersAnalyzed! : null,
    simulation: dossier?.safety?.tradeabilityMethod === "simulation",
    headline: dossier?.headline ?? null,
    positives: call?.positives ?? [],
    topHolders,
  };
}

function tokenScoreView(input: PersonViewInput, context: TokenContext, issues: ReportIssue[]): ScoreView | null {
  const treatment = input.tokenTreatment;
  if (treatment === "not_applicable") return null;
  const f = input.dossier;
  if (treatment === "deferred" || treatment === "provisional") {
    return {
      id: "token",
      eyebrow: "Token safety",
      score: null,
      verdict: null,
      verdictWord: treatment === "deferred" ? "Deferred" : "Provisional",
      tone: "neutral",
      foot: "Contract and market checks.",
      rows: [],
      arithmetic: "The token leg is not scored under the saved applicability decision.",
      provisional: true,
      deferredReason: input.tokenTreatmentReason ?? (treatment === "deferred" ? "Token scoring is deferred until launch." : "Token scoring is provisional."),
    };
  }
  const token = input.tokenScore;
  if (!token) return null;
  const holderIssue = issues.find((issue) => issue.id === "holder-population-conflict");
  const tradingIssue = issues.find((issue) => issue.id === "trading-population-conflict");
  const control = f.evmControlReality;
  const ownerZero = control?.ownerProbes?.some((probe) => probe.purpose === "target_owner" && probe.state === "zero_address");
  const ordered = [...token.rows].sort((left, right) => {
    const li = TOKEN_AXIS_ORDER.indexOf(left.axis);
    const ri = TOKEN_AXIS_ORDER.indexOf(right.axis);
    return (li < 0 ? 99 : li) - (ri < 0 ? 99 : ri);
  });
  const rows: ScoreRowView[] = ordered.map((row) => {
    const review: string[] = [];
    if (row.axis === "T2" && ownerZero) review.push("Standard owner() returned zero at the captured block. Custom roles and upgrade paths are not enumerated by that probe.");
    if (row.axis === "T1" && context.lockedPct != null) {
      review.push(`${context.lockedPct}% locked or burned is provider-reported${context.lockers.length ? ` (${context.lockers.join(", ")})` : ""}. Lock amount, expiry and beneficiary are not recorded in the saved report.`);
    }
    if (row.axis === "T4" && holderIssue) review.push(holderIssue.observed);
    if (row.axis === "T3" && context.simulation) review.push("A simulation is point-in-time evidence, not guaranteed future execution.");
    if (row.axis === "T5" && tradingIssue) review.push(tradingIssue.observed);
    if (row.axis === "T6") review.push("Age and social links are context, not evidence of sound economics.");
    return {
      key: row.axis,
      label: TOKEN_AXIS_LABEL[row.axis] ?? row.label,
      awarded: row.score,
      max: row.weight,
      rationale: plainLanguageSummary(row.rationale),
      review,
      chapter: AXIS_CHAPTER[row.axis] ?? "market",
    };
  });
  const lensConflict = issues.some((issue) => issue.id === "token-lens-conflict");
  const risk = context.riskLens;
  return {
    id: "token",
    eyebrow: "Token safety",
    score: token.score,
    verdict: token.verdict,
    verdictWord: verdictWord(token.verdict),
    tone: lensConflict ? "red" : verdictTone(token.verdict),
    ...(lensConflict ? { status: "Current reading: market risk flagged. Saved PASS is not overall clearance." } : {}),
    foot: `Contract and market checks.${lensConflict ? " Conflicts with the detailed risk assessment." : ""}`,
    rows,
    arithmetic: arithmeticNote(rows, token.score),
    provisional: false,
    ...(token.score == null ? { withheldReason: token.unavailableCopy ?? "No completed token-safety score is saved with this report." } : {}),
    ...(risk?.verdict
      ? { scaleNote: `A separate market-mechanics assessment reports ${risk.risk != null ? `${risk.risk} risk points and ` : ""}${String(risk.verdict).toUpperCase()} on the opposite scale (higher is worse). ${lensConflict ? "No valid conversion between the two scales is exposed." : "The two scales answer different questions."}` }
      : {}),
  };
}

// ── sources ──────────────────────────────────────────────────────────────

function sourceCardFromRef(source: IntelligenceSourceRef, index: number): SourceCard {
  const tier = sourceTierLabel(source);
  const tone: Tone = tier === "Measured" || tier === "Verified artifact" || tier === "First party" ? "green" : tier === "Conflicting view" ? "red" : "amber";
  return {
    id: `S${String(index + 1).padStart(2, "0")}`,
    title: plainLanguageSummary(source.title),
    tier,
    tone,
    excerpt: plainLanguageSummary(source.excerpt ?? ""),
    url: safeHttpUrl(source.sourceUrl),
    provider: providerLabel(source.provider),
    capturedAt: source.capturedAt ?? null,
    evidenceState: evidenceStateLabel(source.evidenceState),
  };
}

function fallbackSources(f: Dossier, facts: readonly BasicFactView[]): SourceCard[] {
  const cards: SourceCard[] = [];
  for (const artifact of f.sourceArtifacts ?? []) {
    cards.push({
      id: `S${String(cards.length + 1).padStart(2, "0")}`,
      title: plainLanguageSummary(artifact.title),
      tier: "Recorded artifact",
      tone: "amber",
      excerpt: plainLanguageSummary(artifact.excerpt ?? ""),
      url: safeHttpUrl(artifact.sourceUrl),
      provider: providerLabel(artifact.provider),
      capturedAt: artifact.capturedAt ?? null,
    });
  }
  for (const fact of facts) {
    for (const source of fact.sources ?? []) {
      cards.push({
        id: `S${String(cards.length + 1).padStart(2, "0")}`,
        title: source.title ? plainLanguageSummary(source.title) : `${String(fact.predicate).replace(/_/g, " ")} source`,
        tier: source.sourceClass === "official_subject" ? "First party" : source.sourceClass === "independent_press" ? "Independent publication" : source.sourceClass === "regulatory_or_onchain" ? "Measured" : "Public source",
        tone: "amber",
        excerpt: plainLanguageSummary(source.excerpt ?? ""),
        url: safeHttpUrl(source.url),
        provider: providerLabel(source.provider),
        capturedAt: source.capturedAt ?? null,
      });
    }
  }
  return uniqueBy(cards, (card) => `${card.url ?? ""}|${card.title}|${card.excerpt.slice(0, 60)}`);
}

// ── lenses ───────────────────────────────────────────────────────────────

function toTask(item: { id?: string; title: string; detail?: string; domain?: string }, fallback: ChapterId, index: number): NextStep {
  const clean = item.title.replace(/\s+/g, " ").trim();
  const cut = clean.search(/[?.](?:\s|$)/);
  return {
    id: item.id ?? `task-${index}`,
    title: (cut > 0 ? clean.slice(0, cut) : clean).replace(/[.?!]+$/, ""),
    ...(item.detail ? { detail: short(item.detail, 160) } : {}),
    chapter: (item.domain && DOMAIN_CHAPTER[item.domain]) || fallback,
  };
}

function briefSources(items: IntelligenceBriefItem[], sources: IntelligenceSourceRef[], cards: SourceCard[]): SourceCard[] {
  const index = new Map(sources.map((source, position) => [source.id, cards[position]]));
  const picked: SourceCard[] = [];
  for (const item of items) {
    for (const ref of item.sourceRefs) {
      const card = index.get(ref);
      if (card && !picked.includes(card)) picked.push(card);
      if (picked.length >= 6) return picked;
    }
  }
  return picked;
}

// ── main ─────────────────────────────────────────────────────────────────

export function buildPersonReportView(input: PersonViewInput): ReportView {
  const f = input.dossier;
  const name = f.display_name || f.handle;
  const token = f.projectToken ?? null;
  const context = tokenContext(f);
  const intelligence = f.intelligence;
  const holder = f.holderProfile;

  // Team and identity inputs for reconciliation.
  const teamCheck = (f.versionContext?.checks ?? f.checkRuns ?? []).find((check) => check.checkId === "project-team-identity");
  const teamAxis = input.compositionRows.find((row) => row.axis === "P1_team_and_identity");
  const mismatches = uniqueBy([
    ...input.webTeam.filter((member) => linkedinIdentityMismatch(member.name, member.linkedin)).map((member) => ({ name: member.name, slug: linkedinSlug(member.linkedin) ?? "" })),
    ...(f.leaderDepartures ?? []).filter((row) => linkedinIdentityMismatch(row.name, row.linkedin)).map((row) => ({ name: row.name, slug: linkedinSlug(row.linkedin) ?? "" })),
  ].filter((row) => row.slug), (row) => `${row.name}|${row.slug}`);

  const tokenAxisRationaleT5 = input.tokenScore?.rows.find((row) => row.axis === "T5")?.rationale;
  const scoreTally = parseBuySellTally(tokenAxisRationaleT5);
  const questions: QuestionView[] = (intelligence?.questions ?? []).map((question) => ({
    id: question.id,
    domain: question.domain,
    prompt: plainLanguageSummary(question.prompt),
    state: question.state,
    materiality: question.materiality,
  }));
  const openQuestionCount = questions.filter((question) => questionIsOpen(question.state)).length;

  const quality = auditStoredReportQuality({
    kind: "person",
    ref: f.handle,
    query: f.handle,
    version: input.version ?? 0,
    verdict: f.report.composite_verdict ?? null,
    score: f.report.governing_score ?? null,
    completeness: f.versionContext?.completenessState ?? f.completeness_state ?? null,
    attestation: input.attestation ?? null,
    createdAt: input.savedAt ?? null,
    payload: f,
  });

  const issues = reconciliationIssues({
    subjectName: name,
    tokenSymbol: token?.symbol ?? null,
    tokenScore: input.tokenScore && input.tokenTreatment !== "not_applicable" && input.tokenTreatment !== "deferred" && input.tokenTreatment !== "provisional"
      ? { score: input.tokenScore.score, verdict: input.tokenScore.verdict }
      : null,
    riskLens: context.riskLens,
    assessedWallets: holder && holder.holdersAssessed !== false
      ? { topPct: holder.topHolderPct, combinedPct: holder.top10Pct, assessedCount: holder.assessedWalletCount ?? null, excludedNote: holder.distributionNote ?? null }
      : null,
    largestNonPoolHolderPct: context.largestNonPool,
    teamAxis: teamAxis ? { score: teamAxis.score, weight: teamAxis.weight, label: teamAxis.label } : null,
    strictTeamVerification: teamCheck ? { status: teamCheck.status, note: teamCheck.note ?? "" } : null,
    mismatchedIdentities: mismatches,
    tradingWindows: [
      ...(scoreTally ? [{ label: "Token score explanation", ...scoreTally }] : []),
      ...(context.tape ? [{ label: "Sell-structure tape (24 hours)", buys: context.tape.buys, sells: context.tape.sells }] : []),
    ],
    collection: input.readiness.applicable > 0 ? input.readiness : null,
    openQuestions: questions.length ? { open: openQuestionCount, total: questions.length } : null,
    qualityFindings: quality.findings,
  });

  const primary = primaryScoreView(input);
  // Reconciliation notes belong beside the scoring area they affect.
  for (const row of primary.rows) {
    if (row.key !== "P1_team_and_identity") continue;
    for (const issue of issues.filter((candidate) => candidate.id === "team-verification-conflict" || candidate.id.startsWith("identity-mismatch-"))) {
      row.review.push(issue.observed);
    }
  }
  const tokenScore = tokenScoreView(input, context, issues);

  // ── sources ──
  const intelligenceSources = intelligence?.sources ?? [];
  const sourceCards = intelligenceSources.length
    ? intelligenceSources.map(sourceCardFromRef)
    : fallbackSources(f, input.basicFacts);
  const productSource = f.officialProductDescription;
  if (productSource && safeHttpUrl(productSource.sourceUrl) && f.website) {
    try {
      const sourceHost = new URL(productSource.sourceUrl).hostname.replace(/^www\./, "");
      const officialHost = new URL(f.website).hostname.replace(/^www\./, "");
      if (sourceHost === officialHost && Number.isFinite(Date.parse(productSource.capturedAt))) {
        sourceCards.push({
          id: `S${String(sourceCards.length + 1).padStart(2, "0")}`,
          title: "Official website product description",
          tier: "First party",
          tone: "amber",
          excerpt: `The project's own description; not independent product validation. ${plainLanguageSummary(productSource.text.slice(0, 1200))}`,
          url: productSource.sourceUrl,
          provider: "Official website",
          capturedAt: productSource.capturedAt,
        });
      }
    } catch { /* Ignore unbound metadata from malformed saved snapshots. */ }
  }

  // ── hero ──
  const label = f.subjectOrientation?.what ? productLabel(name, f.subjectOrientation.what) : null;
  const tractionVerified = input.basicFacts.some((fact) => canonicalBasicFactPredicate(fact.predicate) === "traction" && (fact.status === "verified" || fact.status === "corroborated"));
  let summary = input.openingSummary;
  if (label && f.subjectOrientation?.what) {
    const what = f.subjectOrientation.what.replace(/\s+/g, " ").trim();
    const at = what.toLowerCase().indexOf(label.toLowerCase());
    const remainder = at >= 0 ? what.slice(at + label.length).replace(/^[\s,;:-]*(?:that|which)?\s*/i, "") : "";
    const verb = remainder.match(/^([a-z]+?)(es|s)\b\s+(.*)$/i);
    const base = verb ? (/(?:sh|ch|x|ss|z)$/i.test(verb[1]) && verb[2] === "es" ? verb[1] : verb[2] === "es" ? `${verb[1]}e` : verb[1]) : null;
    const claim = verb && base && base.length >= 3 ? sentence(`Claims to ${base.toLowerCase()} ${verb[3]}`) : "";
    summary = claim
      ? [claim, input.isProject && !tractionVerified ? "Product availability and operating traction need corroboration." : ""].filter(Boolean).join(" ")
      : input.openingSummary;
  }

  const chain = token?.chain ?? null;
  const eyebrow = input.isProject
    ? `${tokenScore || token ? "Company + token" : "Company"}${chain ? ` · ${chainLabel(chain)}` : ""}`
    : "Person";

  // ── lenses ──
  const briefs: Partial<Record<DecisionLensId, ReturnType<typeof deriveIntelligenceBrief>>> = intelligence
    ? {
      investment: deriveIntelligenceBrief(intelligence, "investment"),
      alpha_research: deriveIntelligenceBrief(intelligence, "alpha_research"),
      counterparty: deriveIntelligenceBrief(intelligence, "counterparty"),
    }
    : {};
  const reconciliation = issues.filter((issue) => issue.kind === "reconciliation");
  const criticalIssue = reconciliation.find((issue) => issue.severity === "Critical") ?? reconciliation.find((issue) => issue.severity === "High");
  const holderIssue = issues.find((issue) => issue.id === "holder-population-conflict");
  const uncertaintyFrom = (fallback: NarrativeInput | undefined, chapter: ChapterId): LensView["uncertainty"] => {
    if (criticalIssue) {
      return {
        title: criticalIssue.title,
        text: short(criticalIssue.observed, 200),
        detail: criticalIssue.id === "holder-population-conflict" ? (
          <HolderReconciliation holder={holder} largestPct={context.largestNonPool} largestAddress={context.largestNonPoolAddress} riskVerdict={context.riskLens?.verdict} />
        ) : (
          <>
            <div className="eyebrow">{criticalIssue.area} · {criticalIssue.severity}</div>
            <h2 className="dialog-title">{criticalIssue.title}</h2>
            <p className="dialog-body">{criticalIssue.observed}</p>
            <div className="status-box">{criticalIssue.handling}</div>
          </>
        ),
        chapter: criticalIssue.chapter,
      };
    }
    if (input.discovery) {
      const raw = input.discovery;
      const discovery = {
        ...raw,
        headline: plainDecisionText(raw.headline),
        consequence: plainDecisionText(raw.consequence),
        reversalCondition: plainDecisionText(raw.reversalCondition),
        ...(raw.path ? { path: raw.path.map((node) => plainDecisionText(node)) } : {}),
      };
      return {
        title: discovery.headline,
        text: short(discovery.headline, 200),
        detail: (
          <>
            <div className="eyebrow">ARGUS found a source-backed pattern</div>
            <h2 className="dialog-title">{discovery.headline}</h2>
            <p className="dialog-body">{discovery.consequence}</p>
            {discovery.path && discovery.path.length > 1 && <p className="dialog-body">{discovery.path.join(" → ")}</p>}
            <div className="dialog-section"><h3>What would change it</h3><p>{discovery.reversalCondition}</p></div>
            <p>
              <a href={discovery.evidenceHref}>{discovery.path ? "Open relationship graph" : discovery.id.startsWith("claim-conflict:") ? "Open both records" : "Open the proof"} →</a>
              {discovery.receipts?.map((receipt) => (
                <span key={`${receipt.label}-${receipt.href}`}> · <a href={receipt.href} target="_blank" rel="noopener noreferrer">{receipt.label} ↗</a></span>
              ))}
            </p>
          </>
        ),
        chapter: discovery.path ? "connections" : "product",
      };
    }
    if (input.subjectLeadSummary && input.favorable) {
      return {
        title: "Unverified leads name the subject",
        text: short(input.subjectLeadSummary, 200),
        detail: (
          <>
            <div className="eyebrow">Unverified adverse leads</div>
            <h2 className="dialog-title">Leads that name {name} directly</h2>
            <p className="dialog-body">{input.subjectLeadSummary}</p>
          </>
        ),
        chapter: "social",
      };
    }
    if (!fallback) {
      if (!input.favorable) return null;
      const clean = input.cleanScreenLabels ?? [];
      const text = clean.length
        ? `No adverse findings in ${clean.length} completed clean ${clean.length === 1 ? "screen" : "screens"}: ${clean.slice(0, 3).map((label) => label.toLowerCase()).join(", ")}${clean.length > 3 ? `, and ${clean.length - 3} more` : ""}.`
        : input.noCleanScreenCopy ?? "No completed clean screen is recorded, so this report does not support an all-clear.";
      return {
        title: "What the completed screens show",
        text,
        detail: (
          <>
            <div className="eyebrow">Completed screens</div>
            <h2 className="dialog-title">What the completed screens show</h2>
            <p className="dialog-body">{text}</p>
            <p className="subtle-note">An all-clear covers only the screens that completed. Open checks and unanswered questions stay listed in Evidence &amp; method.</p>
          </>
        ),
        chapter: "evidence",
      };
    }
    return {
      title: fallback.title,
      text: short(`${fallback.title} ${fallback.detail ?? ""}`, 200),
      detail: (
        <>
          <div className="eyebrow">{fallback.provenance ?? "Recorded concern"}</div>
          <h2 className="dialog-title">{fallback.title}</h2>
          {fallback.detail && <p className="dialog-body">{fallback.detail}</p>}
        </>
      ),
      chapter,
    };
  };
  const firstClause = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    const cut = clean.search(/[?.](?:\s|$)/);
    return (cut > 0 ? clean.slice(0, cut) : clean).replace(/[.?!]+$/, "");
  };
  const changeText = (items: NarrativeInput[]) => {
    const titles = items.slice(0, 3).map((item) => firstClause(item.title));
    return titles.length ? `${titles.join("; ")}.` : null;
  };
  const fresh = <T extends { id: string; title: string }>(items: T[]): T[] =>
    items.filter((item) => !input.isStaleQuestion?.(item));

  const freshBrief = (brief: ReturnType<typeof deriveIntelligenceBrief> | undefined) => brief ? { ...brief, questions: fresh(brief.questions) } : undefined;
  const investorBrief = freshBrief(briefs.investment);
  const traderBrief = freshBrief(briefs.alpha_research);
  const founderBrief = freshBrief(briefs.counterparty);
  const verification = input.verificationQuestions;
  const investorSupports = [
    ...(investorBrief?.supports ?? []).map((item) => item.title),
    ...input.supports.map((item) => item.detail || item.title),
  ];
  const investorTasks = uniqueBy([
    ...(investorBrief?.questions ?? []).map((item, index) => toTask(item, "evidence", index)),
    ...verification.map((item, index) => toTask(item, "evidence", index)),
  ], (task) => task.title).slice(0, 3);
  const traderTasks = uniqueBy([
    ...(holderIssue ? [{ id: "reconcile-holders", title: "Reconcile holder classifications", detail: "Classify the largest non-pool address, the exclusions and beneficial control at a common block.", chapter: "market" as ChapterId }] : []),
    ...(traderBrief?.questions ?? []).filter((item) => ["market", "liquidity", "supply", "control", "security", "economics"].includes(item.domain)).map((item, index) => toTask(item, "market", index)),
    ...(traderBrief?.questions ?? []).map((item, index) => toTask(item, "market", index)),
  ], (task) => task.title).slice(0, 3);
  const founderTasks = uniqueBy([
    ...input.remainingPoints.map((item, index) => ({ ...toTask(item, "scores", index), chapter: "scores" as ChapterId })),
    ...(founderBrief?.questions ?? []).map((item, index) => toTask(item, "evidence", index)),
  ], (task) => task.title).slice(0, 3);

  const lenses: LensView[] = [
    {
      key: "Investor",
      eyebrow: input.isProject ? "What the company evidence supports" : "What the evidence supports",
      title: judgmentLine(input.presentedVerdict),
      body: plainLanguageSummary(f.headline || input.openingSummary),
      foundation: investorSupports.length
        ? { text: short(investorSupports.slice(0, 2).map((value) => sentence(value)).join(" "), 220), sources: briefSources(investorBrief?.supports ?? [], intelligenceSources, sourceCards) }
        : null,
      uncertainty: uncertaintyFrom(input.concerns[0], "evidence"),
      change: changeText(investorBrief?.questions.length ? investorBrief.questions : verification) ? { text: changeText(investorBrief?.questions.length ? investorBrief.questions : verification)! } : null,
      nextHeading: "Prioritize the evidence that matters",
      tasks: investorTasks,
    },
    {
      key: "Trader",
      eyebrow: "What the token evidence supports",
      title: reconciliation.some((issue) => issue.id === "token-lens-conflict")
        ? "Market risk is flagged; the saved token PASS is not overall clearance."
        : tokenScore?.verdict
        ? `${judgmentLine(tokenScore.verdict)}${reconciliation.some((issue) => issue.chapter === "market" || issue.id === "token-lens-conflict") ? " Control and concentration remain unsettled." : ""}`
        : token ? "The token is bound, but no token-safety score is saved." : "No token is attributed to this subject.",
      body: context.headline
        ? plainLanguageSummary(context.headline)
        : f.threatNote
          ? plainLanguageSummary(f.threatNote)
          : "No token evidence is saved with this report. Missing token data is not a finding about the subject.",
      foundation: context.positives.length
        ? { text: short(context.positives.slice(0, 3).map((value) => sentence(plainLanguageSummary(value))).join(" "), 220), sources: briefSources(traderBrief?.supports ?? [], intelligenceSources, sourceCards) }
        : null,
      uncertainty: uncertaintyFrom((traderBrief?.pressures ?? [])[0] ?? input.concerns[0], "market"),
      change: changeText(traderBrief?.questions ?? verification) ? { text: changeText(traderBrief?.questions ?? verification)! } : null,
      nextHeading: "Resolve token risk first",
      tasks: traderTasks,
    },
    {
      key: "Founder",
      eyebrow: "What to make verifiable",
      title: "Make the business as verifiable as its claims.",
      body: input.remainingPoints.length
        ? `The saved score leaves ${primary.rows.filter((row) => !row.applicability).reduce((sum, row) => sum + Math.max(0, row.max - row.awarded), 0)} points open. Each follow-up names evidence the team can publish or confirm.`
        : "Each follow-up names evidence the team can publish or confirm.",
      foundation: investorSupports.length
        ? { text: short(investorSupports.slice(0, 2).map((value) => sentence(value)).join(" "), 220), sources: briefSources(founderBrief?.supports ?? [], intelligenceSources, sourceCards) }
        : null,
      uncertainty: uncertaintyFrom((founderBrief?.pressures ?? [])[0] ?? input.concerns[0], "evidence"),
      change: changeText(founderBrief?.questions ?? verification) ? { text: changeText(founderBrief?.questions ?? verification)! } : null,
      nextHeading: "Close the credibility gaps",
      tasks: founderTasks,
    },
  ];

  // ── decision metrics ──
  const enrichmentFunding = f.companyEnrichment?.funding;
  const firstRound = input.fundingEvidence.rounds[0] ?? enrichmentFunding?.rounds?.[0];
  const fundingTotal = input.fundingEvidence.totalKnownUsd > 0 ? input.fundingEvidence.totalKnownUsd : enrichmentFunding?.totalRaisedUsd ?? null;
  const circulatingPct = token?.circulatingSupply != null && (token.maxSupply ?? token.totalSupply)
    ? (token.circulatingSupply / (token.maxSupply ?? token.totalSupply!)) * 100
    : null;
  const liquidity = token?.liquidityUsd ?? null;
  const metrics: Metric[] = [
    ...(fundingTotal ? [{
      label: "Reported funding",
      value: usdShort(fundingTotal)!,
      note: [firstRound?.round, utcDay(firstRound?.date ?? null), input.fundingEvidence.totalKnownUsd > 0 ? null : providerLabel("monid")].filter(Boolean).join(" · ") || undefined,
    }] : []),
    ...(token?.marketCapUsd ? [{ label: "Token market cap", value: usdShort(token.marketCapUsd)!, note: "Saved snapshot, not live" }] : []),
    ...(liquidity ? [{ label: "DEX liquidity", value: usdShort(liquidity)!, note: token?.marketCapUsd ? `${((liquidity / token.marketCapUsd) * 100).toFixed(2)}% of market cap` : undefined }] : []),
    ...(circulatingPct != null ? [{ label: "Reported circulation", value: `${floorTo(circulatingPct, 1).toFixed(1)}%`, note: `${countShort(token!.circulatingSupply!)} of ${countShort(token!.maxSupply ?? token!.totalSupply!)} total supply` }] : []),
    ...(f.protocolTvl && f.protocolTvl.tvlUsd > 0 ? [{ label: "Value locked", value: usdShort(f.protocolTvl.tvlUsd)!, note: `DeFiLlama · ${utcDay(f.protocolTvl.capturedAt)}` }] : []),
  ].map((metric) => ({ ...metric, note: metric.note ?? undefined })) as Metric[];

  // ── product ──
  const orientation = f.subjectOrientation;
  const siteState = intelligence?.measurements.find((measurement) => measurement.id === "official_site_response_state");
  const productCheck = (f.versionContext?.checks ?? f.checkRuns ?? []).find((check) => check.checkId === "project-product-substance");
  const claims: ProductClaim[] = [];
  if (f.website) {
    const note = productCheck?.note ?? (siteState && siteState.valueType === "text" ? `Saved homepage state: ${siteState.value.replace(/_/g, " ")}` : null);
    claims.push({
      key: "website",
      title: "Public website",
      text: note
        ? `${sentence(plainLanguageSummary(note))} This establishes the homepage state at capture, not that every app or service was unavailable.`
        : "The official website is bound to the subject. Its product surface was not classified in this saved report.",
      badge: { label: "Observed page state", tone: "green" },
      sourceUrl: safeHttpUrl(f.website),
      sourceLabel: "Open website",
    });
  }
  for (const [index, contradiction] of (input.contradictions ?? []).slice(0, 3).entries()) {
    claims.push({
      key: `contradiction-${index}`,
      title: "Claim under review",
      text: `${sentence(plainLanguageSummary(contradiction.claim))} Conflicting record: ${sentence(plainLanguageSummary(contradiction.conflict))} Compare exact dated artifacts for the same product surface before treating this as a contradiction.`,
      badge: { label: "Lead, not a finding", tone: "amber" },
    });
  }
  const tractionFacts = input.basicFacts.filter((fact) => canonicalBasicFactPredicate(fact.predicate) === "traction" && (fact.status === "verified" || fact.status === "corroborated"));
  claims.push(tractionFacts.length
    ? {
      key: "traction",
      title: "Traction and commercial reality",
      text: tractionFacts.map((fact) => sentence(String(fact.value ?? ""))).join(" "),
      badge: { label: "Verified", tone: "green" },
      sourceUrl: tractionFacts[0].sources?.[0]?.url ?? null,
      sourceLabel: "View evidence",
    }
    : {
      key: "traction",
      title: "Traction and commercial reality",
      text: `Verified active users, revenue, retention and platform volume are not established in this report.${token ? " The token's trading volume is a different metric." : ""}`,
      badge: { label: "Not established", tone: "amber" },
    });

  const github = f.githubAssessment;
  const repos = (github?.notableRepos ?? []).map((repo) => ({
    name: repo.name,
    language: repo.language ?? null,
    lastPush: utcMonth(repo.lastPush ?? null),
    stars: repo.stars ?? null,
    url: safeHttpUrl(repo.url),
    fork: repo.fork,
  }));
  const originals = github?.originalCount ?? repos.filter((repo) => !repo.fork).length;
  const auditFacts = input.basicFacts.filter((fact) => canonicalBasicFactPredicate(fact.predicate) === "audit" && (fact.status === "verified" || fact.status === "corroborated"));
  const auditStatus = auditFacts.length
    ? `Audit record${auditFacts.length === 1 ? "" : "s"} cited: ${auditFacts.map((fact) => String(fact.value ?? "")).join("; ")}. Confirm each report on the auditor's own site.`
    : "No named security auditor was verified in the saved report. This is a collection result, not proof that no audit exists.";

  const timeline: TimelineEvent[] = [];
  if (f.domainRegistration?.registeredAt) {
    timeline.push({ key: "domain", when: utcDay(f.domainRegistration.registeredAt)!, sort: f.domainRegistration.registeredAt, label: "Domain record", text: `${f.domainRegistration.domain} registered. This does not establish company age.` });
  }
  const founded = f.companyEnrichment?.firmographic?.foundedYear;
  if (founded) {
    timeline.push({ key: "founded", when: String(founded), sort: `${founded}-01-01`, label: "Provider-reported company year", text: `${providerLabel("monid")} lists founded ${founded}${f.joined ? `; the X account shows joined ${f.joined}` : ""}.` });
  }
  for (const [index, round] of (enrichmentFunding?.rounds ?? []).entries()) {
    if (!round.date) continue;
    timeline.push({
      key: `round-${index}`,
      when: utcDay(round.date)!,
      sort: round.date,
      label: "Indexed funding",
      text: `${round.amountUsd ? `${usdShort(round.amountUsd)} ` : ""}${round.round || "funding"} round${round.leadInvestors?.length ? ` with ${round.leadInvestors.join(", ")} as named lead` : ""}.`,
    });
  }
  for (const [index, event] of (f.entityContinuity?.events ?? []).entries()) {
    const date = (event as { date?: string }).date;
    if (!date) continue;
    const record = event as { title?: string; detail?: string; summary?: string; kind?: string };
    timeline.push({ key: `event-${index}`, when: utcDay(date) ?? date, sort: date, label: record.kind ? `Lifecycle · ${record.kind}` : "Lifecycle event", text: [record.title, record.detail ?? record.summary].filter(Boolean).map((value) => sentence(plainLanguageSummary(String(value)))).join(" ") || "Recorded lifecycle event." });
  }
  if (input.savedAt) {
    timeline.push({ key: "captured", when: utcDay(input.savedAt)!, sort: input.savedAt, label: "Report saved", text: "The product evidence in this report was captured. Newer surfaces are not reflected." });
  }
  timeline.sort((left, right) => left.sort.localeCompare(right.sort));
  const continuity = f.entityContinuity;
  const historyLead = continuity?.predecessorName && token && !(continuity.events?.length)
    ? {
      title: `${continuity.predecessorName} → ${token.symbol} is an unresolved history lead.`,
      text: `The report records a predecessor relationship with zero sourced lifecycle events. Contracts, dates and migration terms remain unconfirmed.`,
    }
    : null;

  const tags = uniqueBy([
    ...(token ? [chainLabel(token.chain)] : []),
    ...(token?.deployedChains ?? []).map(chainLabel),
    ...((f.threat?.dossier as unknown as { cg?: { categories?: string[] } } | undefined)?.cg?.categories ?? []),
  ], (tag) => tag).slice(0, 8);

  // ── people ──
  const management = f.companyEnrichment?.management ?? [];
  const departures = f.leaderDepartures ?? [];
  const cards: PersonCardView[] = input.webTeam.map((member, index) => {
    const record = management.find((row) => row.name.trim().toLowerCase() === member.name.trim().toLowerCase());
    const departure = departures.find((row) => row.name.trim().toLowerCase() === member.name.trim().toLowerCase());
    const contacts = personContacts(member, [
      ...recordedLinkedinsFor(member.name, f.basicFacts),
      departure?.linkedin,
    ]);
    const badge = personSourceBadge(member, contacts);
    const provider = providerLabel(member.provider ?? member.source);
    const parts: string[] = [];
    if (record) {
      parts.push(`${provider} lists a role${record.startYear ? ` beginning in ${record.startYear}` : ""}${record.priorCompanies?.length ? ` and prior affiliation with ${record.priorCompanies.join(", ")}` : ""}.`);
    } else {
      parts.push(`${provider} records this role.`);
    }
    if (member.biography) parts.push(sentence(member.biography));
    if (contacts.mismatchedLinkedinSlug) {
      parts.push(`The attached LinkedIn URL names ${contacts.mismatchedLinkedinSlug}, an apparent identity mismatch. Do not use it as identity proof.`);
    }
    if (departure?.state === "current") parts.push("The employment record lists this role as current.");
    else if (departure?.state === "departed") parts.push(`The employment record marks the role ended${departure.ended ? ` ${utcDay(departure.ended)}` : ""}.`);
    else if (departure?.state === "absent" && !contacts.mismatchedLinkedinSlug) parts.push("An employment-record check did not find this role; the record may be incomplete.");
    else if (!departure) parts.push("Independent current-role verification is unresolved.");
    if (!record?.priorCompanies?.length && member.evidence && !/^prior:/i.test(member.evidence)) parts.push(sentence(plainLanguageSummary(member.evidence)));
    if (!record?.priorCompanies?.length && member.evidence && /^prior:/i.test(member.evidence)) parts.push(`Prior affiliation recorded: ${member.evidence.replace(/^prior:\s*/i, "")}.`);
    const avatarCandidates = [
      trustedOfficialTeamPortraitUrl(member.officialPortraitUrl, member.officialPortraitSourceUrl),
      contacts.mismatchedLinkedinSlug ? null : linkedinAvatar(contacts.linkedin?.url ?? member.linkedin),
      trustedOfficialXAvatarUrl(member.avatarUrl),
      member.handle ? xAvatar(member.handle) : null,
    ].filter((url): url is string => Boolean(url));
    const records = personRecords({
      name: member.name,
      handle: member.handle ?? null,
      basicFacts: f.basicFacts,
      leads: f.report?.investigative_leads,
      adverseMentions: f.socialActivity?.adverseMentions,
      contradictions: input.contradictions,
      ventures: f.evidence?.ventures,
      associates: f.evidence?.associates,
      intelligenceSources: f.intelligence?.sources,
    });
    return {
      key: `${member.name}-${index}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      name: member.name,
      role: member.role,
      // Portrait preference: the project's own website, then LinkedIn, then X.
      // A LinkedIn URL that names someone else is an identity mismatch, so its
      // photo is never shown as this person's face.
      avatarUrl: avatarCandidates[0] ?? null,
      avatarCandidates,
      developerProfiles: (member.developerProfiles ?? [])
        .map((profile) => ({
          label: profile.provider === "github" ? "GitHub" : "Hugging Face",
          url: safeHttpUrl(profile.url) ?? "",
          proofUrl: safeHttpUrl(profile.sourceUrl),
        }))
        .filter((profile) => profile.url),
      badge,
      text: parts.join(" "),
      auditHandle: member.handle ?? null,
      records,
      recordSummary: personRecordSummary(records),
      contacts,
      sourceUrl: safeHttpUrl(member.sourceUrl),
      sourceLabel: provider,
    };
  });
  const teamConflict = issues.find((issue) => issue.id === "team-verification-conflict");
  const leadershipCheck = (f.versionContext?.checks ?? f.checkRuns ?? []).find((check) => check.checkId === "project-leadership-currency");
  const measurement = (id: string) => {
    const found = intelligence?.measurements.find((row) => row.id === id);
    return found && found.valueType === "number" ? found.value : null;
  };
  const checkedLeaders = measurement("checked_leader_count") ?? (departures.length || null);
  const currentLeaders = measurement("current_leader_count") ?? departures.filter((row) => row.state === "current").length;
  const continuityRows = [
    { label: "Named leaders in provider roster", value: String(management.length || input.webTeam.length) },
    ...(checkedLeaders != null ? [{ label: "Leaders checked in employment enrichment", value: String(checkedLeaders) }] : [{ label: "Leaders checked in employment enrichment", value: leadershipCheck ? "0" : "Not checked" }]),
    ...(checkedLeaders != null ? [{ label: "Current roles matched in that check", value: String(currentLeaders) }] : []),
  ];
  const legalFact = input.basicFacts.find((fact) => ["legal_entity", "legal_name", "registration"].includes(canonicalBasicFactPredicate(fact.predicate)) && (fact.status === "verified" || fact.status === "corroborated"));
  const control = legalFact
    ? `The saved report binds a legal entity record: ${String(legalFact.value ?? "")}. Beneficial ownership, board, signing authority and formal governance still need their own records.`
    : "The report does not establish a current legal entity, beneficial ownership, board, signing authority or formal governance. A role label and a self-disclosed wallet do not answer those questions.";

  // ── market ──
  const pt = token;
  const marketMetrics: Metric[] = pt ? [
    ...(pt.priceUsd != null ? [{ label: "Price at capture", value: priceUsd(pt.priceUsd)!, note: pt.ath?.drawdownPct != null ? `${signedPct(pt.ath.drawdownPct, 1)} from reported ATH` : undefined }] : []),
    ...(pt.marketCapUsd != null ? [{ label: "Market cap", value: usdShort(pt.marketCapUsd)!, note: pt.rank != null ? `CoinGecko rank #${pt.rank.toLocaleString("en-US")}` : undefined }] : []),
    ...(pt.fdvUsd != null ? [{ label: "Fully diluted value", value: usdShort(pt.fdvUsd)!, note: pt.marketCapUsd ? `${(pt.fdvUsd / pt.marketCapUsd).toFixed(2)}× market cap` : undefined }] : []),
    ...(pt.volume24hUsd != null ? [{ label: "24h reported volume", value: usdShort(pt.volume24hUsd)!, note: pt.marketCapUsd ? `${((pt.volume24hUsd / pt.marketCapUsd) * 100).toFixed(2)}% of market cap` : undefined }] : []),
  ] as Metric[] : [];

  const addresses: HolderRow[] = context.topHolders.slice(0, 6).map((row) => ({
    label: row.tag ? `${row.tag} pool` : shortAddress(row.address),
    percent: row.percent,
    alert: context.largestNonPoolAddress ? row.address.toLowerCase() === context.largestNonPoolAddress.toLowerCase() : false,
    address: row.address,
  }));
  const wallets: HolderRow[] = holder && holder.holdersAssessed !== false && holder.topHolderPct != null
    ? [
      { label: "Largest assessed", percent: holder.topHolderPct },
      ...(holder.top10Pct != null && holder.top10Pct > holder.topHolderPct
        ? [{ label: `Other assessed${holder.assessedWalletCount ? ` (${holder.assessedWalletCount - 1})` : ""}`, percent: holder.top10Pct - holder.topHolderPct }]
        : []),
    ]
    : [];
  const marketFacts: Metric[] = [
    ...(liquidity != null ? [{ label: "liquidity", value: usd(liquidity, 0)!, note: "Observed DEX liquidity" }] : []),
    ...(liquidity != null && pt?.marketCapUsd ? [{ label: "liq-mcap", value: `${((liquidity / pt.marketCapUsd) * 100).toFixed(2)}%`, note: "Liquidity ÷ market cap" }] : []),
    ...((f.threat as { tokenomics?: { tax?: { buy?: number; sell?: number } } } | null | undefined)?.tokenomics?.tax
      ? [{ label: "tax", value: `${(f.threat as { tokenomics: { tax: { buy?: number } } }).tokenomics.tax.buy ?? "?"}% / ${(f.threat as { tokenomics: { tax: { sell?: number } } }).tokenomics.tax.sell ?? "?"}%`, note: context.simulation ? "Simulated buy / sell tax" : "Buy / sell tax" }]
      : []),
    ...(holder?.lpLockedOrBurnedPct != null ? [{ label: "lp", value: `${holder.lpLockedOrBurnedPct}%`, note: "LP secured, provider-reported" }] : []),
  ];
  const history = pt?.history;
  const trading: Array<{ label: string; value: string }> = [
    ...(history?.changePct != null ? [{ label: `${history.spanPeriods ?? history.points?.length ?? ""}-${history.timeframe === "hour" ? "hour" : "day"} saved price change`, value: signedPct(history.changePct, 2)! }] : []),
    ...((history as { volume?: { changePct?: number } } | undefined)?.volume?.changePct != null
      ? [{ label: "Recent 7-day volume vs prior 7 days", value: signedPct((history as { volume: { changePct: number } }).volume.changePct, 2)! }]
      : []),
    ...(pt?.ath?.drawdownPct != null ? [{ label: "Saved lifetime-high drawdown", value: signedPct(pt.ath.drawdownPct, 1)! }] : []),
    ...(context.tape ? [
      { label: "Sell-structure window", value: "24 hours" },
      { label: `${context.tape.sells} sells / ${context.tape.buys} buys`, value: context.tape.sellUsd != null && context.tape.buyUsd != null ? `${usd(context.tape.sellUsd, 0)} / ${usd(context.tape.buyUsd, 0)}` : "USD not recorded" },
    ] : []),
  ];
  const tradingIssue = issues.find((issue) => issue.id === "trading-population-conflict");
  const tradingNote = [
    tradingIssue ? `${tradingIssue.observed} Different sources or windows may explain the difference, but the report does not reconcile them.` : "",
    history ? "Raw candles are kept in the saved record; no synthetic price chart is drawn here." : "",
  ].filter(Boolean).join(" ") || null;
  const evm = f.evmControlReality;
  const ownerProbe = evm?.ownerProbes?.find((probe) => probe.purpose === "target_owner");
  const controlView = evm ? {
    facts: [
      ...(ownerProbe ? [{ label: "owner", value: ownerProbe.state === "zero_address" ? "Zero address" : ownerProbe.state.replace(/_/g, " "), note: "owner() at the captured block" }] : []),
      { label: "proxy", value: evm.proxy?.state === "no_standard_proxy_indicator" ? "0 detected" : `${evm.proxy?.indicators?.length ?? 0} indicator${(evm.proxy?.indicators?.length ?? 0) === 1 ? "" : "s"}`, note: "Standard proxy indicators" },
      ...(context.holdersAnalyzed != null ? [{ label: "sims", value: context.holdersAnalyzed.toLocaleString("en-US"), note: "Holder sell simulations reported" }] : []),
      ...(evm.capture?.blockNumber ? [{ label: "block", value: evm.capture.blockNumber.toLocaleString("en-US"), note: `${chainLabel(evm.chain)} block · ${utcStamp(evm.capture.blockTimestamp) ?? "time not recorded"}` }] : []),
    ],
    note: ownerProbe?.state === "zero_address"
      ? "owner() returned zero at the captured block. The presence of a privileged function in code is distinct from anyone's current ability to execute it; role-based mint or upgrade paths are not established by this probe."
      : null,
    limitation: evm.limitations?.[1] ?? evm.limitations?.[0] ?? null,
  } : null;
  const market = pt ? {
    ...(holder?.holderIntelligence ? { holderIntelligence: holder.holderIntelligence } : {}),
    capturedAt: pt.capturedAt,
    metrics: marketMetrics,
    holders: addresses.length || wallets.length ? {
      addresses,
      wallets,
      walletsNote: holder?.distributionNote ? sentence(plainLanguageSummary(holder.distributionNote)) : null,
      combinedAssessedPct: holder?.top10Pct ?? null,
      largestLabel: context.largestNonPoolAddress ? `The ${context.largestNonPool?.toFixed(2)}% address ${shortAddress(context.largestNonPoolAddress)}` : null,
      sourceUrl: safeHttpUrl(holder?.sourceUrl),
    } : null,
    supply: {
      circulating: pt.circulatingSupply ?? null,
      total: pt.maxSupply ?? pt.totalSupply ?? null,
      circulatingPct,
      burnedPct: context.burnedSupplyPct,
    },
    facts: marketFacts,
    lockNote: context.lockers.length
      ? `${context.lockers.join(", ")} ${context.lockers.length === 1 ? "is" : "are"} named as lock provider. Lock expiry, beneficiary and executable exit depth must be checked. Locked liquidity does not eliminate concentration or market risk.`
      : null,
    trading,
    tradingNote,
    control: controlView,
  } : null;

  // ── social ──
  const continuityCheck = (f.versionContext?.checks ?? f.checkRuns ?? []).find((check) => check.checkId === "identity-continuity");
  const social = f.socialActivity && f.socialActivity.state !== "unavailable" ? {
    snapshot: f.socialActivity,
    handleHistory: f.prior_handles?.length
      ? { label: "Prior handles found", tone: "amber" as Tone, note: `Previously ${f.prior_handles.map((handle) => `@${handle}`).join(", ")}.` }
      : continuityCheck?.status === "checked-empty"
        ? { label: /partial/i.test(continuityCheck.note ?? "") ? "Partial coverage" : "None found", tone: "amber" as Tone, note: `${sentence(plainLanguageSummary(continuityCheck.note ?? "The handle-history check returned no prior handle."))} This does not clear account repurposing.` }
        : { label: "Not checked", tone: "neutral" as Tone, note: "No handle-history result is saved." },
  } : null;

  // ── connections ──
  const items: ConnectionView[] = [];
  for (const card of cards) {
    items.push({ key: `person-${card.key}`, name: card.name, group: "People", role: card.role, tier: card.badge.label, detail: card.text, url: card.sourceUrl ?? null });
  }
  for (const round of enrichmentFunding?.rounds ?? []) {
    for (const lead of round.leadInvestors ?? []) {
      items.push({
        key: `backer-${lead}`,
        name: lead,
        group: "Backers",
        role: `Named ${round.round ? `${round.round.toLowerCase()} ` : ""}lead`,
        tier: "Provider-reported",
        detail: `${providerLabel("monid")} names ${lead} as lead of a ${round.amountUsd ? `${usdShort(round.amountUsd)} ` : ""}${round.round || "funding"} round${round.date ? ` dated ${utcDay(round.date)}` : ""}. A database record is not independent confirmation of investment.`,
        url: safeHttpUrl(f.companyEnrichment?.sourceUrl),
      });
    }
  }
  for (const relation of f.organizationRelationships ?? []) {
    const backed = /back|invest|fund/i.test(relation.role);
    items.push({
      key: `org-${relation.handle ?? relation.name}`,
      name: relation.name,
      group: backed ? "Backers" : "Advisors",
      role: backed ? "Backer named by the subject" : `${relation.role.replace(/-/g, " ")} named by the subject`,
      tier: relation.artifact_verified ? "Named by the subject" : "Unresolved",
      detail: `${sentence(plainLanguageSummary(relation.evidence ?? relation.source))} A relationship named by the subject is not confirmed by the named party; subject-bound backing evidence is required before it counts as a confirmed edge.`,
      url: safeHttpUrl(relation.enrichmentSourceUrl ?? relation.sourceUrl),
    });
  }
  const sameParty = (left: string, right: string) =>
    left.replace(/^@/, "").replace(/[^a-z0-9]/gi, "").toLowerCase() === right.replace(/^@/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const testimonial of f.evidence.testimonials ?? []) {
    const handle = testimonial.claimed_endorser_handle ?? testimonial.claimed_endorser_name ?? "Unnamed party";
    const verdict = testimonial.corroboration_verdict ?? "Unconfirmed";
    const relationship = String(testimonial.claimed_relationship ?? "relationship");
    const claimedRole = `claimed ${relationship.charAt(0).toLowerCase()}${relationship.slice(1)}`;
    const detail = `A project post names this relationship. ${testimonial.follows_subject ? "The party follows the subject, which is partial evidence, not role confirmation." : "The party does not follow the subject."}${testimonial.acknowledgment_source_url ? " An acknowledgment lead is recorded; its meaning was not independently verified." : ""}`;
    const existing = items.find((item) => sameParty(item.name, handle));
    if (existing) {
      existing.role = `${existing.role} · ${claimedRole}`;
      existing.detail = `${existing.detail} ${detail}`;
      continue;
    }
    items.push({
      key: `claim-${handle}`,
      name: handle,
      group: /back|invest/i.test(relationship) ? "Backers" : "Advisors",
      role: `${claimedRole.charAt(0).toUpperCase()}${claimedRole.slice(1)}`,
      tier: verdict === "Corroborated" ? "Corroborated" : verdict === "PartiallyCorroborated" ? "Partially corroborated" : "Unconfirmed",
      detail,
      url: safeHttpUrl(testimonial.acknowledgment_source_url ?? testimonial.evidence_url),
    });
  }
  if (pt) {
    items.push({
      key: "token",
      name: `$${pt.symbol}`,
      group: "Assets",
      role: "Official token in the saved report",
      tier: "Linked asset",
      detail: `${chainLabel(pt.chain)} contract ${pt.address}. Attributed through the ${pt.verification === "official_x" ? "official X account" : "official website"} and the canonical contract. A market registry alone would not prove reciprocity.`,
      url: safeHttpUrl(pt.sourceUrl),
    });
  }
  const postedWallets = f.evidence.wallets ?? [];
  const contractCoded = postedWallets.filter((wallet) => wallet.screen?.status === "not_attributable");
  const walletLeads = postedWallets.filter((wallet) => wallet.screen?.status !== "not_attributable");
  for (const wallet of walletLeads) {
    items.push({
      key: `wallet-${wallet.address}`,
      name: shortAddress(wallet.address),
      group: "Assets",
      role: `${wallet.binding === "self_disclosed" || wallet.link_tier === "SelfDoxxed" ? "Self-disclosed" : "Linked"} ${wallet.chain === "solana" ? "Solana" : "EVM"} address`,
      tier: wallet.link_tier === "SelfDoxxed" ? "Self-disclosed" : String(wallet.link_tier ?? "Linked"),
      detail: `${sentence(plainLanguageSummary(wallet.notes ?? "Address recorded in the saved report."))} One of ${walletLeads.length} retained wallet lead${walletLeads.length === 1 ? "" : "s"}.${contractCoded.length ? ` ${contractCoded.length} other posted address${contractCoded.length === 1 ? " has" : "es have"} contract code and ${contractCoded.length === 1 ? "is" : "are"} not treated as a wallet the subject controls.` : ""} Posting an address does not establish ownership or beneficial control.`,
      url: null,
    });
  }
  if (github?.login) {
    items.push({ key: "github", name: github.login, group: "Identity", role: "GitHub organization", tier: "Linked account", detail: `${sentence(plainLanguageSummary(github.summary ?? ""))} Identity linkage does not prove technical claims.`, url: `https://github.com/${github.login}` });
  }
  items.push({
    key: "x",
    name: f.handle,
    group: "Identity",
    role: f.x_account_status === "suspended" || f.x_account_status === "unavailable"
      ? "Official X account · X profile metrics unavailable"
      : "Official X account",
    tier: "First party",
    detail: f.x_account_status === "suspended" || f.x_account_status === "unavailable"
      ? `X profile metrics unavailable: the account was ${f.x_account_status} when checked. Follower count and join date are unavailable, not zero.`
      : `${f.followers ? `${f.followers} followers` : "Follower count not recorded"}${f.joined ? `; joined ${f.joined}` : ""} at capture. Audience size is not credibility.`,
    url: `https://x.com/${f.handle.replace(/^@/, "")}`,
  });
  const connectionItems = uniqueBy(items, (item) => `${item.group}|${item.name}`);

  const fundingRound = enrichmentFunding?.rounds?.[0];
  const funding = fundingRound ? {
    heading: `${fundingRound.amountUsd ? `${usdShort(fundingRound.amountUsd)} ` : ""}${fundingRound.round || "funding"} round`,
    detail: [utcDay(fundingRound.date ?? null), fundingRound.leadInvestors?.length ? `${fundingRound.leadInvestors.join(", ")} named lead` : null].filter(Boolean).join(" · "),
    tags: fundingRound.otherInvestors ?? [],
    note: `Other named participants in the ${providerLabel("monid")} index. Instrument, valuation, token terms and ownership are not stated. ${enrichmentFunding?.rounds && enrichmentFunding.rounds.length > 1 ? `${enrichmentFunding.rounds.length} rounds are indexed.` : "The provider's total raised equals this disclosed round; it is not a complete cap table."}`,
    sourceUrl: safeHttpUrl(f.companyEnrichment?.sourceUrl),
  } : null;
  const screen = f.trustGraphScreen;
  const graph = screen ? {
    qualified: screen.qualifiedContributionCount ?? 0,
    total: screen.contributionCount ?? 0,
    line: sentence(plainLanguageSummary(screen.line)),
    leadsNote: input.relatedLeadCount > 0
      ? `${input.relatedLeadCount} unverified lead${input.relatedLeadCount === 1 ? "" : "s"} about related people or companies ${input.relatedLeadCount === 1 ? "is" : "are"} retained. ${input.relatedLeadCount === 1 ? "It does" : "They do"} not establish wrongdoing by ${name} and ${input.relatedLeadCount === 1 ? "does" : "do"} not enter its score.`
      : null,
  } : null;

  // ── evidence ──
  const criticalGaps = uniqueBy([
    ...(intelligence?.questions ?? []).filter((question) => question.materiality === "critical" && questionIsOpen(question.state)).map((question) => {
      const prompt = plainLanguageSummary(question.prompt).replace(/\s+/g, " ").trim();
      const end = prompt.indexOf("?");
      return end > 0 ? prompt.slice(0, end + 1) : sentence(prompt);
    }),
    ...(input.openChecks ?? []).map((check) => `${check.label}: ${sentence(check.note ?? "not completed")}`),
  ], (value) => value).slice(0, 10);
  const providerIssues = [
    ...(f.providerFailures ?? []).map((failure) => `${providerLabel(failure.provider)} rejected ${failure.failed} ${failure.op.replace(/^scan:/, "").replace(/-/g, " ")} request${failure.failed === 1 ? "" : "s"}.`),
    ...(f.providerSnapshot?.runs ?? []).filter((run) => run.state === "partial" || run.state === "failed").map((run) => `${plainLanguageSummary(run.label)} ${run.state === "failed" ? "failed" : "is partial"}.`),
  ];

  const companyTotal = primary.score != null ? `${primary.score}` : undefined;
  const tokenTotal = tokenScore?.score != null ? `${tokenScore.score}` : undefined;

  return {
    subjectName: name,
    subjectKind: input.isProject ? "project" : "person",
    handle: f.handle,
    avatarUrl: f.avatar_url ?? null,
    eyebrow,
    productLabel: label,
    summary,
    website: safeHttpUrl(f.website),
    xHandle: f.handle,
    token: pt ? {
      symbol: pt.symbol,
      chain: pt.chain,
      address: pt.address,
      pairAddress: pt.pairAddress ?? pt.history?.poolAddress ?? null,
      coingeckoId: pt.coingeckoId ?? null,
    } : null,
    savedLine: input.liveSaved
      ? `Report saved${input.savedAt ? ` · ${utcStamp(input.savedAt)}` : ""}`
      : input.savedAt ? `Saved report · ${utcStamp(input.savedAt)}` : f.live ? "Live scan · not yet saved" : "Saved report",
    savedAt: input.savedAt ?? null,
    ...(input.version ? { version: input.version } : {}),
    caseLabel: input.caseLabel,
    auditId: input.auditId,
    primary,
    tokenScore,
    issues,
    lenses,
    checkRail: input.readiness.applicable > 0 || input.legacyCoverageNote ? {
      successful: input.readiness.successful,
      applicable: input.readiness.applicable,
      open: input.openChecks ?? [],
      legacyNote: input.legacyCoverageNote ?? null,
    } : null,
    leadBanner: input.subjectLeadCount && input.subjectLeadSummary ? {
      title: `${input.subjectLeadCount} unverified adverse ${input.subjectLeadCount === 1 ? "lead names" : "leads name"} ${f.handle} directly.`,
      body: input.subjectLeadSummary,
    } : null,
    category: input.categoryLabel ?? null,
    identity: input.identityLabel ?? null,
    researchStatus: [
      ...(input.provisionalNote ? [{ lead: "Provisional score:", text: input.provisionalNote }] : []),
      ...(input.readiness.applicable > 0 ? [{ lead: `${input.readiness.successful}/${input.readiness.applicable} collection checks`, text: `completed (${exactPercent(input.readiness.successful, input.readiness.applicable)}).` }] : []),
      ...(questions.length ? [{ lead: `${openQuestionCount} of ${questions.length} diligence questions`, text: "remain wholly or partly open in the expanded ledger." }] : []),
      ...(input.sourcedAreas ? [{ lead: `${input.sourcedAreas.backed} of ${input.sourcedAreas.total} scored areas`, text: "have linked sources." }] : []),
    ],
    metrics,
    bands: primary.rows.filter((row) => row.band && !row.applicability).map((row) => ({
      label: row.label,
      awarded: row.awarded,
      max: row.max,
      band: `${row.band!.min}–${row.band!.max} of ${row.max}`,
    })),
    applicability: input.isProject && primary.rows.length ? (() => {
      const scored = primary.rows.filter((row) => !row.applicability);
      const tokenRow = scored.find((row) => row.key === "P3_token_conduct");
      const excluded = primary.rows.find((row) => row.key === "P3_token_conduct" && row.applicability);
      return {
        tokenAwarded: tokenRow?.awarded ?? 0,
        tokenMax: tokenRow?.max ?? 0,
        total: scored.reduce((sum, row) => sum + row.awarded, 0),
        max: scored.reduce((sum, row) => sum + row.max, 0),
        ...(excluded ? { excluded: `This saved report already omits token conduct (${excluded.note}); the remaining weights are normalized.` } : {}),
      };
    })() : null,
    product: {
      heading: label ?? (input.isProject ? `What ${name} says it does` : `What ${name} says they do`),
      description: orientation?.what
        ? `${sentence(plainLanguageSummary(orientation.what))}${orientation.audience ? ` Stated audience: ${sentence(plainLanguageSummary(orientation.audience))}` : ""}`
        : input.openingSummary,
      tags,
      claims,
      repos,
      repoSummary: github
        ? `The saved GitHub assessment links ${github.login} ${github.confidence === "gold" ? "through the subject's own profile" : "to the subject"} and lists ${originals} non-fork repositor${originals === 1 ? "y" : "ies"} with ${github.totalStarsOnOriginals ?? 0} star${github.totalStarsOnOriginals === 1 ? "" : "s"}. Non-fork status does not establish code originality or quality.`
        : "No GitHub account was resolved for this subject in the saved report.",
      repoHeading: github ? `${originals} original repositor${originals === 1 ? "y" : "ies"}. Limited proof of the product.` : "No public code on record.",
      repoNote: github?.daysSinceActivity != null
        ? `Most recent public activity ${github.daysSinceActivity} day${github.daysSinceActivity === 1 ? "" : "s"} before the scan. It may describe any listed repository and does not establish that the product itself is actively maintained.`
        : null,
      auditStatus,
      timeline,
      historyLead,
    },
    people: {
      cards,
      verificationConflict: teamConflict ? `${teamConflict.observed} This view uses the conservative label “provider-reported” pending reconciliation.` : null,
      continuity: continuityRows,
      control,
      identityNote: f.identity_note ? plainLanguageSummary(f.identity_note) : null,
      identity: input.identityLabel ?? null,
    },
    market,
    social,
    connections: { items: connectionItems, funding, graph },
    evidence: {
      collection: input.readiness.applicable > 0 ? input.readiness : null,
      questions,
      sources: sourceCards,
      referenceCount: intelligenceSources.length || sourceCards.length,
      uniqueArtifacts: intelligenceSources.length ? uniqueArtifactCount(intelligenceSources) : sourceCards.length,
      missingCaptureTime: intelligenceSources.length
        ? intelligenceSources.filter((source) => !source.capturedAt).length
        : sourceCards.filter((card) => !card.capturedAt).length,
      criticalGaps,
      providerIssues,
      intelligenceSources,
    },
    totals: {
      ...(companyTotal ? { company: `${input.isProject ? "Company" : "Person"} ${companyTotal}` } : {}),
      ...(tokenTotal ? { token: `token ${tokenTotal}` } : {}),
    },
  };
}
