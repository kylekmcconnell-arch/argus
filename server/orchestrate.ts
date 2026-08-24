// The collector orchestrator: @handle -> populated evidence -> verdict.
//
// Strategy (hybrid, honest):
//  - If the handle is a known subject, seed the evidence bag from its fixture so
//    the live adapters have real CLAIMS to re-verify against fresh data.
//  - Run every configured adapter; each enriches the bag and streams progress.
//  - A live path always discards fixture scores/headlines. Only a complete,
//    observed analyst result may publish fresh axes; otherwise it is INCOMPLETE.
//  - With NO applicable live provider configured, replay the curated trace and
//    return the fixture dossier unchanged, so the demo always works.
// The engine always owns caps, banding and the composite verdict.

import { getProfile, classifySubject, SubjectClass, VentureOutcome, canonicalEntityKey, repeatBackingSignal, type Finding, type Venture } from "../src/engine";
import { env, providerFallbacksEnabled } from "./config";
import { assembleDossier, type Dossier } from "../src/data/dossier";
import { findSubject, toEvidence } from "../src/data/subjects";
import { emptyEvidence, type BasicFact, type WebTeamMember } from "../src/data/evidence";
import type { EvmControlRealitySnapshot } from "../src/data/evmControlReality";
import type { AdapterRunResult, CheckObservation, CollectedEvidence, Emit, CollectContext, Adapter } from "./adapters/types";
import {
  ANALYST_EVIDENCE_MAX_CHARS,
  analystAvailable,
  analyzeSubject,
  buildScoringEvidencePacket,
  deriveProjectStrengthBands,
  extractClaims,
  extractScoringEvidenceCatalog,
  inspectAnalystScoringPreflight,
  scanContradictions,
} from "./agent";
import { getCost, providerFailureLines, recordCall, withCostLedger } from "./cost";
import { tokenFromBio, tokenFromPromotions } from "../src/lib/projectTokenLeg";
import { teamIdentityKeys } from "../src/lib/teamIdentity";
import { PersonCheckTracker, type ChecklistObservation, type ProviderRunState } from "./checks";

import { xAdapter, getProfile as xProfile, getRecentPostsMeta, collectCorpus, fmtFollowers, discoverAffiliations, findTeam, findTeamOnSite, enrichTeamIdentities, officialXNamedTeam, officialXNamedOrgs, discoverOperatorsFromFollowings, discoverOperatorsFromAmplified, findRoleClaimants, confirmClaimantBios, serperConfirmedFounderFollowup, discoverReverseBioFromTwitterapi, followsSubject, resetFollowScanMemo, handleHistory, searchAdverseSignals, detectManipulationTooling, type DiscoveredAffiliation, type AdverseSignal, type TeamMember } from "./adapters/x";
import { fetchTeamPage } from "./adapters/teampage";
import { checkSiteSubstance, type SiteSubstance } from "./adapters/sitecheck";
import { isLinkHubUrl, resolveLinkHubWebsite } from "./adapters/linkHub";
import { collectDomainRegistration, deriveLaunchWindow } from "./adapters/domainAge";
import { checkLeaderDepartures, type LeaderDepartureCheck } from "./adapters/peopledatalabs";
import { enrichFirstPartyTeamAvatars } from "./adapters/teamEnrichment";
import { detectTokenLifecycle } from "./adapters/dexscreener";
import { analyzeCadence } from "../src/lib/cadence";
import { canonicalOfficialWebsite, canonicalPublicProfileWebsite } from "../src/lib/fundScaleEvidence";
import { handlesMatch, orientSubjectWithGrok, orientationHandleBound, orientationMentionLeads, projectOrientationBound } from "./subjectOrientation";
import { personChecks } from "../src/lib/scanChecklist";
import { basicFactQuestionOutcome } from "../src/lib/basicFactQuestions";
import { isOrganizationAccount } from "../src/lib/investorSubject";
import { axisLabel } from "../src/lib/verdict";
import {
  buildResearchPlan,
  finalizeResearchPlan,
  researchPlanAllows,
  type ResearchCapability,
  type ResearchIntent,
} from "../src/lib/researchDirector";
import { restrictResearchPlan } from "../src/lib/gapInvestigation";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  COLLECTION_ANALYST_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
  TRUST_GRAPH_SCREEN_RESERVE_MS,
} from "../src/lib/investigationRuntime";
import { peopledatalabsAdapter } from "./adapters/peopledatalabs";
import { githubAdapter } from "./adapters/github";
import { dexscreenerAdapter } from "./adapters/dexscreener";
import { coingeckoAdapter } from "./adapters/coingecko";
import { onchainAdapter } from "./adapters/onchain";
import { basicFactsAdapter, registrableDomain, screenSecRegistryForNames } from "./adapters/basicFacts";
import { writeEntityFacts } from "./entityStore";
import {
  hasResolvedRealName,
  offchainAdapter,
  refreshResolvedNameOffchain,
  resolvedOffchainName,
  screenOrganizationSanctions,
} from "./adapters/offchain";
import { archiveCorroborationLabels, archivedAffiliation } from "./adapters/wayback";
import { resolveForHandle } from "./adapters/wallet";
import { collectTrustGraph } from "./adapters/trustgraph";
import { collectPortfolioRelationships } from "./adapters/portfolio";
import { collectFundScale } from "./adapters/fundScale";
import { collectProjectTokenIdentity, collectVentureTokenIdentity } from "./adapters/projectToken";
import { hydrateProjectTeamFromVerifiedFacts, projectProviderBackedBasicFacts } from "./basicFactsProjection";
import { enforceProjectFactCoherence } from "./projectFactCoherence";
import {
  collectProtocolAuditLinks,
  collectProtocolFees,
  collectProtocolFunding,
  collectProtocolTvl,
  defiLlamaLookupName,
  resetDefiLlamaScanMemo,
} from "./adapters/defiLlama";
import { collectHolderProfile } from "./adapters/tokenHolders";
import { collectUpcomingUnlocks } from "./adapters/tokenUnlocks";
import { describeOutcomeDelta, readPriorOutcome } from "./adapters/priorOutcome";
import { collectSecurityAudits } from "./adapters/securityAudits";
import {
  collectEvmControlReality,
  PUBLIC_EVM_RPC,
} from "./adapters/evmControlReality";
import {
  collectProjectCompanyEnrichment,
  companyEnrichmentMatchesOfficialDomain,
} from "./adapters/monid";
import { collectOperatorLaunches, describeLaunchHistory } from "./adapters/operatorLaunches";
import { collectSocialActivity } from "./socialActivity";
import {
  hydrateOfficialProjectIdentityFromFacts,
  verifiedOfficialProjectIdentity,
} from "./projectIdentity";

// Role words stripped when a venture name is derived from a fact value like
// "Aave Labs CEO" or "CEO at Aave Labs": only the company survives.
const VENTURE_ROLE_TOKENS = /\b(?:co[- ]?founders?|founders?|creators?|ceo|cto|coo|cfo|chief\s+\w+(?:\s+officer)?|presidents?|chair(?:man|woman|person)?|executives?)\b/gi;
const BIO_FOUNDER_CLAIM = /\b(?:co[- ]?founder|founder|creator|ceo|chief executive)\b/i;

function cleanVentureName(value: string): string {
  const afterAt = value.split(/\bat\b/i).pop() ?? value;
  return afterAt.replace(VENTURE_ROLE_TOKENS, " ").replace(/[&,@]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Derive a FOUNDER subject's primary venture for the related-asset binding.
 * Ladder, strongest first:
 *  1. a verified structured venture row (bridge keys included);
 *  2. a verified founder/current_role fact (role words cleaned from the value),
 *     with the bio's @handle accepted only when it agrees with the name and
 *     the official-subject source host as the domain key;
 *  3. a verified identity-class fact anchored on an official-subject host
 *     whose label agrees with a founder/CEO claim naming an @handle in the
 *     subject's own bio (aave.com + "Founder & CEO @Aave" -> Aave).
 * Exported for tests.
 */
export function deriveFounderVentureCandidate(
  evidence: CollectedEvidence,
): { project_name: string; x_handle?: string; domain?: string } | null {
  const row = evidence.ventures.find((venture) =>
    venture.artifact_verified === true
    && venture.evidence_origin !== "model_lead"
    && venture.project_name.trim()
    && /\b(?:co[- ]?founder|founder|creator|ceo|chief executive)\b/i.test(venture.role));
  if (row) {
    return {
      project_name: row.project_name.trim(),
      ...(row.x_handle ? { x_handle: row.x_handle } : {}),
      ...(row.domain ? { domain: row.domain } : {}),
    };
  }
  const verifiedFacts = (evidence.basicFacts ?? []).filter((fact) =>
    fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated"));
  const officialHostOf = (fact: (typeof verifiedFacts)[number]): string | undefined => fact.sources
    .filter((candidate) => candidate.sourceClass === "official_subject" && candidate.relation === "supports")
    .map((candidate) => { try { return new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } })
    .find((host) => host && !/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(host));
  const bioHandle = BIO_FOUNDER_CLAIM.test(evidence.profile.bio)
    ? evidence.profile.bio.match(/@([A-Za-z0-9_]{2,15})/)?.[1]
    : undefined;
  const handleKey = bioHandle?.toLowerCase() ?? "";

  // Rung 2: a venture-naming fact.
  const roleFact = verifiedFacts.find((fact) =>
    (fact.predicate === "founder" || fact.predicate === "current_role")
    && cleanVentureName(fact.value).length > 1);
  if (roleFact) {
    const ventureName = cleanVentureName(roleFact.value);
    const nameKey = ventureName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const handleAgrees = Boolean(nameKey && handleKey
      && (nameKey.startsWith(handleKey) || handleKey.startsWith(nameKey)));
    const officialHost = officialHostOf(roleFact);
    // The official host is a bridge key only when its label identifies the
    // venture itself (aave.com for "Aave Labs"); a person's own site or an
    // unrelated official page never vouches for the venture identity.
    const hostLabelKey = (officialHost?.split(".")[0] ?? "").replace(/[^a-z0-9]+/g, "");
    const hostAgrees = Boolean(nameKey && hostLabelKey
      && (nameKey.startsWith(hostLabelKey) || hostLabelKey.startsWith(nameKey)));
    if (handleAgrees || hostAgrees) {
      return {
        project_name: ventureName,
        ...(handleAgrees && bioHandle ? { x_handle: `@${bioHandle}` } : {}),
        ...(hostAgrees && officialHost ? { domain: officialHost } : {}),
      };
    }
  }

  // Rung 3: identity anchored on the venture's own domain plus a bio claim.
  if (bioHandle && handleKey) {
    for (const fact of verifiedFacts) {
      if (fact.predicate !== "official_identity" && fact.predicate !== "founder" && fact.predicate !== "current_role") continue;
      const officialHost = officialHostOf(fact);
      if (!officialHost) continue;
      const label = (officialHost.split(".")[0] ?? "").replace(/[^a-z0-9]+/g, "");
      if (label && (label.startsWith(handleKey) || handleKey.startsWith(label))) {
        return { project_name: bioHandle, x_handle: `@${bioHandle}`, domain: officialHost };
      }
    }
  }
  return null;
}

// Monid enrichment polls asynchronous runs (1-120s). An audit already runs
// minutes against a bounded platform function budget, so enrichment gets a
// hard wall-clock box: over budget degrades to a skipped enrichment, never a
// dead run. The adapter's own polling keeps its result cheap to discard.
const MONID_ENRICHMENT_BUDGET_MS = 25_000;
// Up to ~6 bounded page fetches (security page candidates + auditor hops).
const SECURITY_AUDITS_BUDGET_MS = 45_000;
// Each public RPC request is individually bounded. The collector keeps an exact
// request count and tries the configured fallback only when a block-consistent
// capture cannot be completed on the first endpoint.
const EVM_CONTROL_RPC_TIMEOUT_MS = 2_500;
const withWallClockBox = <T>(work: Promise<T>, budgetMs: number): Promise<T | null> =>
  Promise.race([
    work,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), budgetMs);
      // Do not hold the event loop open for the box itself.
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }),
  ]);

const VERIFIED_EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function verifiedEvmControlTarget(
  evidence: CollectedEvidence,
): { chain: string; address: string } | null {
  const token = evidence.projectToken;
  if (token?.verified !== true) return null;
  const chain = token.chain.trim().toLowerCase();
  const address = token.address.trim().toLowerCase();
  if (!VERIFIED_EVM_ADDRESS.test(address) || !PUBLIC_EVM_RPC[chain]?.length) return null;
  return { chain, address };
}

const unavailableEvmControlSnapshot = (
  chain: string,
  target: string,
  note: string,
): EvmControlRealitySnapshot => ({
  schemaVersion: 1,
  state: "unavailable",
  chain,
  target,
  mode: "point_in_time",
  scoringImpact: "none",
  collection: {
    sourceClass: "direct_chain_rpc",
    rpcCalls: 0,
    modelCalls: 0,
    marginalUsd: 0,
  },
  ownerProbes: [],
  authorities: [],
  safeCompatibleMultisigs: [],
  receipts: [],
  limitations: [
    "No direct-chain control claim was made because a block-consistent RPC capture was unavailable.",
  ],
  note,
});

/**
 * Defensive packet boundary for score-neutral point-in-time context. Even if a
 * future refactor starts from a wider evidence object, this field cannot reach
 * the v1 scorer or contradiction model through this packet.
 */
export function excludeScoreNeutralControlReality<
  T extends { evmControlReality?: unknown },
>(input: T): Omit<T, "evmControlReality"> {
  const { evmControlReality: _scoreNeutralContext, ...modelEvidence } = input;
  void _scoreNeutralContext;
  return modelEvidence;
}

export function protocolRecordMatchesCanonicalToken(
  recordGeckoId: string | null | undefined,
  canonicalGeckoId: string,
): boolean {
  return Boolean(recordGeckoId) && recordGeckoId === canonicalGeckoId;
}

const ADAPTERS: Adapter[] = [
  xAdapter,
  githubAdapter,
  peopledatalabsAdapter,
  offchainAdapter,
  // crunchbaseAdapter retired: DeFiLlama + Monid/Akta cover funding/backing.
  dexscreenerAdapter,
  coingeckoAdapter,
  // redditAdapter retired: Reddit API access was not approved.
  onchainAdapter,
  basicFactsAdapter,
];

// Concurrent adapter lanes. Serial within a lane (read-after-write
// dependencies from the adapter field audit); lanes are pairwise disjoint in
// evidence fields, check ids, external hosts, and cost-ledger providers.
// basic-facts runs alone after all lanes settle (it reads everything).
/** Test-only view of the registry so the lane partition guard cannot drift. */
export const ADAPTERS_FOR_TEST: readonly Adapter[] = ADAPTERS;
export const IDENTITY_LANE = [xAdapter, githubAdapter, peopledatalabsAdapter, offchainAdapter] as const;
export const TOKEN_LANE = [dexscreenerAdapter, coingeckoAdapter] as const;
export const WALLET_LANE = [onchainAdapter] as const;

/**
 * Every cost-ledger provider an adapter's run() can record. Concurrent
 * attempt accounting filters the shared ledger by these so a stage-mate's
 * calls are never cross-attributed; the lane schedule guarantees no two
 * concurrently-running adapters share a provider. memory.lol is
 * coldIntake-only and intentionally absent. basic-facts is omitted on
 * purpose: it runs alone post-barrier, keeping its historical unfiltered
 * delta byte-identical.
 */
export const ADAPTER_PROVIDERS: Record<string, readonly string[]> = {
  "x": ["twitterapi", "grok", "cache"],
  "github": ["github"],
  "peopledatalabs": ["peopledatalabs"],
  "offchain-diligence": ["google-news", "courtlistener", "opensanctions", "x-avatar", "claude", "cache"],
  "dexscreener": ["dexscreener"],
  "coingecko": ["coingecko"],
  "onchain": ["helius"],
};

const teamEvidenceRank = (member: WebTeamMember): number =>
  member.artifact_verified === true && member.evidence_origin !== "model_lead"
    ? 2
    : member.evidence_origin !== "model_lead"
      ? 1
      : 0;

/**
 * Collapse roster rows that resolve to the same X identity after enrichment.
 * Exact multi-part names are also safe merge keys for the common case where a
 * provider roster arrives before another source resolves that person's handle.
 * Keep the strongest source-backed row as the governing name, role, and
 * provenance, while carrying over non-governing identity links it lacks.
 */
export function coalesceTeamMembersByHandle(members: readonly WebTeamMember[]): WebTeamMember[] {
  const output: WebTeamMember[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const member of members) {
    const identityKeys = teamIdentityKeys(member);
    const existingIndex = identityKeys
      .map((key) => indexByIdentity.get(key))
      .find((index): index is number => index !== undefined);
    if (existingIndex === undefined) {
      output.push({ ...member });
      for (const key of identityKeys) indexByIdentity.set(key, output.length - 1);
      continue;
    }

    const existing = output[existingIndex];
    const preferred = teamEvidenceRank(member) > teamEvidenceRank(existing) ? member : existing;
    const secondary = preferred === existing ? member : existing;
    const merged: WebTeamMember = { ...preferred };
    // Same "only ever turns ON" rule as the assembly merge above: a person
    // the subject's own posts/following/amplification bound stays
    // first-party even when the higher-ranked row for this coalesce came
    // from a different lane (e.g. a team page) that never carried the marker.
    if (secondary.handleProvenance === "subject_first_party" && merged.handleProvenance !== "subject_first_party") {
      merged.handleProvenance = "subject_first_party";
    }
    if (!merged.handle && secondary.handle) merged.handle = secondary.handle;
    if (!merged.linkedin && secondary.linkedin) merged.linkedin = secondary.linkedin;
    if ((!merged.projects || !merged.projects.length) && secondary.projects?.length) {
      merged.projects = secondary.projects;
      merged.projects_evidence_origin = secondary.projects_evidence_origin;
    }
    if (
      secondary.identity_link_evidence_origin !== "model_lead"
      && preferred.identity_link_evidence_origin === "model_lead"
    ) {
      merged.identity_link_evidence_origin = secondary.identity_link_evidence_origin;
      if (secondary.handle) merged.handle = secondary.handle;
      if (secondary.linkedin) merged.linkedin = secondary.linkedin;
    }
    output[existingIndex] = merged;
    for (const key of [...identityKeys, ...teamIdentityKeys(merged)]) {
      indexByIdentity.set(key, existingIndex);
    }
  }
  return output;
}

// Adapters that require a key to do anything meaningful (keyless DEX/CG no-op
// without a promoted contract, so they don't count as "live collection").
const KEYED = new Set(["x", "github", "peopledatalabs", "crunchbase", "reddit", "onchain", "basic-facts"]);

interface AttemptTotals {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  cached: number;
}

const attemptTotals = (providers?: readonly string[], operations?: readonly string[]): AttemptTotals => {
  const allow = providers ? new Set(providers) : null;
  const allowOperations = operations ? new Set(operations) : null;
  return getCost().calls.reduce<AttemptTotals>((totals, line) => {
    if (allow && !allow.has(line.provider)) return totals;
    if (allowOperations && !allowOperations.has(line.op)) return totals;
    totals.total += line.calls;
    totals.succeeded += line.succeeded;
    totals.partial += line.partial;
    totals.failed += line.failed;
    totals.cached += line.cached;
    return totals;
  }, { total: 0, succeeded: 0, partial: 0, failed: 0, cached: 0 });
};

const ANALYST_ATTEMPT_PROVIDERS = ["claude", "grok"] as const;

/** Provider-attributable attempts that can establish a fresh analyst run. */
export const analystAttemptTotals = (operations: readonly string[]): AttemptTotals =>
  attemptTotals(ANALYST_ATTEMPT_PROVIDERS, operations);

const attemptDelta = (before: AttemptTotals, after: AttemptTotals): AttemptTotals => ({
  total: Math.max(0, after.total - before.total),
  succeeded: Math.max(0, after.succeeded - before.succeeded),
  partial: Math.max(0, after.partial - before.partial),
  failed: Math.max(0, after.failed - before.failed),
  cached: Math.max(0, after.cached - before.cached),
});

const observedRunState = (attempts: AttemptTotals): ProviderRunState => {
  if (attempts.total === 0) return "skipped";
  if (attempts.failed === attempts.total) return "failed";
  if (attempts.failed > 0 || attempts.partial > 0) return "partial";
  return "executed";
};

const adapterRunState = (
  result: void | AdapterRunResult,
  attempts: AttemptTotals,
): ProviderRunState => {
  // A claimed success without a collector-owned attempt is a skip, never an
  // execution. Partial/failed may still describe a local preflight failure.
  if (result?.state === "failed" || result?.state === "partial") return result.state;
  if (attempts.total === 0) return "skipped";
  return observedRunState(attempts);
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The checklist outcome for the bounded, paid leadership-currency lookup.
 *
 * The lookup answers three different ways and they must not be conflated:
 *   - a leader with a CLOSED role is a dated finding,
 *   - an all-still-listed roster is its own confirmed signal,
 *   - a record that holds no role for anyone answered nobody, which is a
 *     completed lookup with no answer, not a clean result.
 * A record with no matching role is "not measured", never "still there", so
 * absent rows are counted apart from both and never inflate the still-listed
 * tally. Returns null when no leader was resolved at all, because Kyle's rule
 * is that an unresolvable leader is skipped and never reported.
 *
 * Exported for tests.
 */
export function leadershipCurrencyObservation(
  departures: readonly LeaderDepartureCheck[],
  company: string,
): ChecklistObservation | null {
  if (!departures.length) return null;
  const left = departures.filter((row) => row.state === "departed");
  const stillListed = departures.filter((row) => row.state === "current");
  const unanswered = departures.filter((row) => row.state === "absent");
  // PDL is a licensed derivative of LinkedIn, so its record is a copy that can
  // lag the live profile. Say so on every outcome, never only the bad one.
  const lag = "PeopleDataLabs is a licensed copy of a LinkedIn record and can lag the live profile, so each row carries its own dates and profile URL to confirm against.";
  const unansweredNote = unanswered.length
    ? ` The employment record holds no ${company} role for ${unanswered.length} other named leader${unanswered.length === 1 ? "" : "s"}, which is an unanswered lookup and not evidence they were never involved.`
    : "";
  if (left.length) {
    return {
      id: "project-leadership-currency",
      status: "finding",
      note: `${left.map((row) => row.summary).join(" ")}${unansweredNote} ${lag}`,
      provider: "peopledatalabs",
      sourceCount: left.length,
    };
  }
  if (stillListed.length) {
    return {
      id: "project-leadership-currency",
      status: "confirmed",
      note: `${stillListed.length} named leader${stillListed.length === 1 ? " still lists" : "s still list"} ${company} as a current role, and none of the leaders checked has a closed ${company} role.${unansweredNote} ${lag}`,
      provider: "peopledatalabs",
      sourceCount: stillListed.length,
    };
  }
  return {
    id: "project-leadership-currency",
    status: "checked-empty",
    note: `The employment record returned no ${company} role for any of the ${departures.length} named leader${departures.length === 1 ? "" : "s"} checked. That record may simply be incomplete, so this is neither a departure nor a confirmation. ${lag}`,
    provider: "peopledatalabs",
  };
}

function parseOutcome(s?: string): VentureOutcome {
  if (!s) return VentureOutcome.UNKNOWN;
  const match = Object.values(VentureOutcome).find((v) => v.toLowerCase() === s.toLowerCase());
  return (match as VentureOutcome) ?? VentureOutcome.UNKNOWN;
}

// F3_repeat_backing is the only FOUNDER axis with no producer once the `ventures`
// section is empty (its `testimonials` feeder was never wired), so a founder we
// have richly evidenced on identity, track record, product, reputation, and
// network was withheld a score entirely — the whole subject abstained because
// this single axis had no substantive artifact. This runs a deterministic
// assessment over the collected venture record (reusing the engine's canonical
// repeatBackingSignal) and records an observable outcome so F3 gets a substantive
// artifact: a positive repeat backer/re-backed exit, or an affirmative null that
// the analyst scores at the low end for lack of a demonstrated positive signal.
// It only runs when there is at least one known venture or company to assess; a
// genuinely unassessable subject records nothing and still abstains, honestly.
export function assessFounderRepeatBacking(evidence: CollectedEvidence): CheckObservation | null {
  if (!evidence.roles.includes(SubjectClass.FOUNDER)) return null;
  const ventures = evidence.ventures.filter(
    (v) => v.evidence_origin !== "model_lead" && v.artifact_verified === true,
  );
  const companyFacts = (evidence.basicFacts ?? []).filter(
    (f) => f.artifact_verified === true
      && (f.status === "verified" || f.status === "corroborated")
      && (f.predicate === "founder" || f.predicate === "founded" || f.predicate === "executive" || f.predicate === "prior_role"),
  );
  const knownCompanies = new Set<string>(
    [
      ...ventures.map((v) => v.project_name.trim().toLowerCase()),
      ...companyFacts.map((f) => f.value.trim().toLowerCase()),
    ].filter(Boolean),
  );
  // Nothing to assess: leave F3 a coverage gap so preflight correctly abstains
  // rather than manufacturing an "assessed" result over an empty record.
  if (knownCompanies.size === 0) return null;

  const signal = repeatBackingSignal(ventures);
  const ventureLabel = `${knownCompanies.size} known venture${knownCompanies.size === 1 ? "" : "s"}`;
  if (signal.strength !== "none" && signal.repeat_backers.length) {
    return {
      id: "founder-repeat-backing",
      status: "confirmed",
      note: `Repeat backing established across ${ventureLabel}: ${signal.repeat_backers.slice(0, 3).join(", ")} re-backed the founder${signal.from_successful_exit ? " through a successful exit" : ""}.`,
      provider: "argus-analysis",
      sourceCount: signal.repeat_backers.length,
    };
  }
  return {
    id: "founder-repeat-backing",
    status: "finding",
    note: `Assessed repeat backing across ${ventureLabel}; no source-backed repeat financing, re-backing, or re-backed exit appears in the collected record.`,
    provider: "argus-analysis",
  };
}

function asRoles(roles: string[]): SubjectClass[] {
  const valid = new Set(Object.values(SubjectClass) as string[]);
  let out = roles.filter((r) => valid.has(r)).map((r) => r as SubjectClass);
  // Deterministic backstop for a rule the LLM applies inconsistently: a fund IS
  // an organization, so it sometimes tags INVESTOR+PROJECT — but PROJECT is for
  // accounts shipping a product/token, and the combo files funds under Projects.
  // The INVESTOR track fully covers the org case, so PROJECT is dropped.
  if (out.includes(SubjectClass.INVESTOR) && out.includes(SubjectClass.PROJECT)) {
    out = out.filter((r) => r !== SubjectClass.PROJECT);
  }
  return out;
}

export function recordOfficialXAccountStatusFinding(evidence: CollectedEvidence): boolean {
  if (evidence.profile.x_account_status !== "suspended") return false;
  const sourceUrl = evidence.profile.x_account_status_source_url;
  const capturedAt = evidence.profile.x_account_status_captured_at;
  if (!sourceUrl || !capturedAt) return false;
  if (evidence.findings.some((finding) =>
    finding.finding_type === "OfficialXAccountSuspended"
    && finding.source_url === sourceUrl,
  )) return false;
  evidence.findings.push({
    finding_type: "OfficialXAccountSuspended",
    claim: `${evidence.profile.handle} rendered X's terminal Account suspended state when checked on ${capturedAt.slice(0, 10)}. The official-site identity binding can remain valid, but the project's primary social channel is unavailable. X does not publicly state the underlying reason on this page, so suspension alone is not evidence of fraud.`,
    source_url: sourceUrl,
    source_date: capturedAt,
    source_author: "x.com",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "x-public",
    finding_scope: {
      scope: "direct_subject",
      target_entity_key: evidence.profile.handle,
      target_entity_type: evidence.roles.includes(SubjectClass.PROJECT) ? "project" : "person",
      relationship_to_subject: "self",
    },
  });
  return true;
}

async function resolveProfile(ctx: CollectContext): Promise<void> {
  const prof = await xProfile(ctx.handle);
  if (prof?.accountStatus === "active") {
    ctx.evidence.profile.profile_collection_state = "resolved";
    ctx.evidence.profile.profile_provider = "twitterapi";
    ctx.evidence.profile.profile_captured_at = prof.statusCapturedAt;
    ctx.evidence.profile.x_account_status = "active";
    ctx.evidence.profile.x_account_status_source_url = prof.statusSourceUrl;
    ctx.evidence.profile.x_account_status_captured_at = prof.statusCapturedAt;
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
    if (prof.image) {
      ctx.evidence.profile.avatar_url = prof.image; // official X image source for the frozen integrity screen
      ctx.evidence.profile.avatar_source_state = "resolved";
    } else {
      ctx.evidence.profile.avatar_source_state = "none";
    }
    ctx.evidence.profile.bio = prof.bio ?? "";
    const profileWebsite = canonicalPublicProfileWebsite(prof.website) ?? undefined;
    ctx.evidence.profile.website = profileWebsite;
    const officialWebsites = (prof.officialWebsites ?? [])
      .map((url) => canonicalPublicProfileWebsite(url))
      .filter((url): url is string => Boolean(url));
    if (officialWebsites.length) ctx.evidence.profile.official_websites = officialWebsites;
    // A link aggregator is a pointer, not a website: left as-is it kills
    // PROJECT routing, official-site verification, and token binding for the
    // whole run. Dereference it deterministically (hub must link this exact
    // handle; the extracted site must link the handle back) or disclose why
    // site-based checks will run without an official website.
    if (isLinkHubUrl(profileWebsite)) {
      const hubResolved = await resolveLinkHubWebsite(profileWebsite!, ctx.handle);
      if (hubResolved) {
        ctx.evidence.profile.website = hubResolved.website;
        ctx.emit({ phase: "P0 · Intake", label: "Official site resolved through the profile link hub", detail: `${hubResolved.hubUrl} lists ${hubResolved.website}, and that site links back to ${ctx.handle}. Using it as the official website.`, source: "site fetch", tone: "neutral" });
      } else {
        // Actually treat it as unknown. Leaving the hub URL in place made the
        // sentence below false: every site, team, and infrastructure check
        // then ran against the AGGREGATOR. A live @theformsvc scan quoted
        // Linktree's own marketing page as the subject's live site and went
        // on to crawl linktr.ee/team and /leadership for the subject's
        // people. The verification gate withheld those candidates, but a
        // report must not spend calls hunting an unrelated company's staff,
        // and one gate is the wrong place to first notice the subject is
        // wrong. An unresolvable hub yields no official website.
        ctx.evidence.profile.website = undefined;
        ctx.emit({ phase: "P0 · Intake", label: "Profile links a link hub, not a website", detail: `${profileWebsite} did not resolve to a single site that links back to ${ctx.handle}. The link aggregator is not treated as the official website, so site-based checks run without one.`, source: "site fetch", tone: "warn" });
      }
    }
    if (prof.followers != null) ctx.evidence.profile.followers = fmtFollowers(prof.followers);
    if (prof.createdAt) {
      const d = new Date(prof.createdAt);
      if (!isNaN(d.getTime())) {
        ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
        ctx.evidence.profile.account_created_at = d.toISOString();
      }
    }
    ctx.emit({ phase: "P0 · Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle} · ${ctx.evidence.profile.followers} followers · joined ${ctx.evidence.profile.joined}`, source: "twitterapi.io", tone: "neutral" });
  } else if (prof) {
    ctx.evidence.profile.profile_collection_state = "unavailable";
    ctx.evidence.profile.profile_provider = "twitterapi";
    ctx.evidence.profile.profile_captured_at = undefined;
    ctx.evidence.profile.x_account_status = prof.accountStatus;
    ctx.evidence.profile.x_account_status_source_url = prof.statusSourceUrl;
    ctx.evidence.profile.x_account_status_captured_at = prof.statusCapturedAt;
    ctx.emit({
      phase: "P0 · Intake",
      label: prof.accountStatus === "suspended" ? "Official X account suspended" : "Official X account unavailable",
      detail: prof.accountStatus === "suspended"
        ? `${prof.handle} currently renders X's terminal Account suspended state. Continuing through the verified official site and public records.`
        : `${prof.handle} currently has no live public X profile. Continuing through the verified official site and public records.`,
      source: "x.com",
      tone: "warn",
    });
  } else {
    ctx.evidence.profile.profile_collection_state = "unavailable";
    ctx.evidence.profile.profile_provider = "twitterapi";
    ctx.evidence.profile.profile_captured_at = undefined;
    // Be honest about a missing profile instead of silently rendering "—
    // followers" — discovery below can still proceed.
    ctx.emit({ phase: "P0 · Intake", label: "Profile unavailable", detail: "twitterapi.io has no record of this handle (not in their index). Continuing with web/X discovery.", source: "twitterapi.io", tone: "warn" });
  }
}

export function applySiteSubstanceOutcome(
  ctx: CollectContext,
  domain: string,
  site: SiteSubstance,
): void {
  ctx.evidence.profile.website = site.url;
  ctx.evidence.profile.site_substance_status = site.status;
  const isProject = ctx.evidence.roles.includes(SubjectClass.PROJECT);
  const verifiedProjectToken = ctx.evidence.projectToken?.verified === true
    ? ctx.evidence.projectToken
    : undefined;
  const verifiedNotLive = site.status === "coming_soon"
    && (site.reason === "coming_soon" || site.reason === "parked");

  // A personal profile URL is not automatically the website of a project the
  // person founded, advised, or invested in. Preserve the observed page state,
  // but do not create project counter-evidence without a project route.
  if (!isProject) {
    ctx.emit({
      phase: "P2 · Substance",
      label: verifiedNotLive
        ? "Profile website is not launched"
        : site.status === "coming_soon"
          ? "Profile website check unavailable"
          : "Profile website checked",
      detail: verifiedNotLive
        ? `${domain} serves a verified coming-soon or parked page. This personal-profile URL is not treated as project counter-evidence.`
        : site.status === "coming_soon"
          ? `${domain} returned an ungrounded coming-soon label. No profile or project-liveness conclusion was drawn.`
        : `${domain}: ${site.detail}. No project-liveness conclusion was drawn for this person profile.`,
      source: "site-fetch",
      tone: "neutral",
    });
    return;
  }

  // SiteNotLive is reserved for direct, served-page evidence. Access blocks,
  // HTTP errors, and DNS/transport failures are collection gaps, never adverse
  // evidence about whether the product exists.
  if (verifiedNotLive) {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "finding",
      note: `${domain}: ${site.detail}`,
      provider: "site-fetch",
      sourceCount: 1,
    });
    const tokenContext = verifiedProjectToken
      ? ` No live product surface despite the account promoting the verified $${verifiedProjectToken.symbol} project token.`
      : " No live product surface was verified.";
    ctx.evidence.findings.push({
      finding_type: "SiteNotLive",
      claim: `The project's own website (${domain}) is not live yet: ${site.detail}.${tokenContext}`,
      source_url: site.url,
      source_date: "",
      source_author: "site-fetch",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
    });
    ctx.emit({
      phase: "P2 · Substance",
      label: "Website not live",
      detail: verifiedProjectToken
        ? `${domain} is a verified coming-soon or parked page: ${site.detail}. The account promotes the verified $${verifiedProjectToken.symbol} project token, so this is product-substance counter-evidence.`
        : `${domain} is a verified coming-soon or parked page: ${site.detail}. This is product-substance counter-evidence, but no token-promotion claim was inferred.`,
      source: "site-fetch",
      tone: "bad",
    });
    return;
  }

  // Defensive boundary for callers or persisted adapter payloads that claim a
  // coming-soon status without the direct marker attribution introduced above.
  // Absence is itself a claim, so an ungrounded label stays a neutral gap.
  if (site.status === "coming_soon") {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "unavailable",
      note: `${domain}: coming-soon classification lacked a verified served-page marker`,
      provider: "site-fetch",
    });
    ctx.emit({
      phase: "P2 · Substance",
      label: "Website check unavailable",
      detail: `${domain}: a coming-soon label was returned without direct served-page evidence. No liveness conclusion was drawn.`,
      source: "site-fetch",
      tone: "neutral",
    });
    return;
  }

  if (site.status === "access_blocked" || site.status === "unavailable" || site.status === "unreachable") {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "unavailable",
      note: `${domain}: ${site.detail}; no adverse site-liveness conclusion was drawn`,
      provider: "site-fetch",
    });
    ctx.emit({
      phase: "P2 · Substance",
      label: "Website check unavailable",
      detail: `${domain}: ${site.detail}. This is a neutral provider gap, not evidence that the website or product is offline.`,
      source: "site-fetch",
      tone: "neutral",
    });
    return;
  }

  ctx.recordCheck?.({
    id: "project-product-substance",
    status: "confirmed",
    note: `${domain}: ${site.detail}`,
    provider: "site-fetch",
    sourceCount: 1,
  });
  if (site.status === "client_rendered") {
    ctx.emit({ phase: "P2 · Substance", label: "Website live (app)", detail: `${domain} serves a client-rendered app; ${site.detail}.`, source: "site-fetch", tone: "neutral" });
  } else {
    ctx.emit({ phase: "P2 · Substance", label: "Website live", detail: `${domain} is a live site: ${site.detail}.`, source: "site-fetch", tone: "good" });
  }
}

async function collectProjectSiteSubstance(ctx: CollectContext, domain: string): Promise<SiteSubstance | null> {
  if (!domain) return null;
  const site = await checkSiteSubstance(domain).catch(() => null);
  if (!site) return null;
  if (site.detail.trim()) siteSubstanceExcerptByEvidence.set(ctx.evidence, site.detail);
  applySiteSubstanceOutcome(ctx, domain, site);
  return site;
}

// The bare-domain grab from bio TEXT (distinct from the profile's website
// field). An email's host must never qualify: "team@gmail.com" would otherwise
// make gmail.com the subject's official website, which seeds product-substance
// credit, official-source classification, and team-page fetches. Emails are
// stripped before matching. Exported for tests.
export function bioWebsiteDomain(bio: string): string | undefined {
  return bio
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, " ")
    .match(/\b([a-z0-9-]+\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1];
}

/**
 * Fold discovered affiliations into the ventures evidence. A fresh lead is
 * pushed immediately as a live record the corroboration loop refines in place.
 * A name collision with an existing venture (claims extraction seeds the
 * subject's primary venture with NO x_handle/domain) backfills the missing
 * bridge keys instead of dropping the discovery, so archive corroboration and
 * the venture-scoped adverse sweep still reach it. Returns the records
 * eligible for corroboration: every fresh lead plus each collided row that is
 * still an unverified model lead (a provider-verified row keeps its own
 * provenance and never re-enters the queue). Exported for tests.
 */
export function mergeDiscoveredAffiliations(
  ventures: Venture[],
  discovered: readonly DiscoveredAffiliation[],
): { v: DiscoveredAffiliation; rec: Venture }[] {
  const byName = new Map(ventures.map((row) => [row.project_name.toLowerCase(), row]));
  const pending: { v: DiscoveredAffiliation; rec: Venture }[] = [];
  for (const v of discovered) {
    const existing = byName.get(v.name.toLowerCase());
    if (existing) {
      existing.x_handle ??= v.x_handle;
      existing.domain ??= v.domain;
      if (v.evidence) existing.notes = [existing.notes, v.evidence].filter(Boolean).join(" · ");
      if (existing.evidence_origin === "model_lead" && existing.artifact_verified !== true) {
        pending.push({ v, rec: existing });
      }
      continue;
    }
    const rec: Venture = {
      project_name: v.name,
      // Canonical bridge keys: the venture's own X account / domain. Without
      // these the graph keys the project on its fuzzy name and never connects
      // it to the same project seen in another audit.
      x_handle: v.x_handle,
      domain: v.domain,
      role: v.role,
      period: v.year ?? "",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: null,
      notes: [v.evidence, "single-source lead, unverified"].filter(Boolean).join(" · "),
      // An archived-page corroboration can promote this lead to a scoreable
      // artifact below (default stays an unverified model lead).
      evidence_origin: "model_lead",
      artifact_verified: false,
    };
    ventures.push(rec);
    byName.set(v.name.toLowerCase(), rec);
    pending.push({ v, rec });
  }
  return pending;
}


/**
 * Serper LinkedIn/press follow-up is for unique-id confirmed founders only.
 * discoverReverseBioFromTwitterapi puts two kinds of people on `.team`:
 * live-bio unique-id confirms (`their current X bio states "..."`) and
 * tweet-only rows (bio @-mentions the project; role came from a tweet).
 * Tweet-only people stay on the report team but must not spend Serper.
 */
export function uniqueIdConfirmedForFounderFollowup(
  member: Pick<TeamMember, "handle" | "evidence">,
  subjectHandle: string,
): boolean {
  const key = (member.handle ?? "").replace(/^@/, "").toLowerCase();
  const subject = subjectHandle.replace(/^@/, "").toLowerCase();
  if (!key || key === subject) return false;
  return /their current X bio states/.test(member.evidence ?? "");
}

// Cold handle: resolve the profile, pull recent posts, and extract self-claims
// so the verification adapters have something to check. Without this an unknown
// subject has no ventures/endorsements/advisory seats to verify.
// Exported for tests.
export async function coldIntake(ctx: CollectContext, profileAlreadyResolved = false) {
  if (!profileAlreadyResolved) await resolveProfile(ctx);
  const siteUrl = canonicalPublicProfileWebsite(ctx.evidence.profile.website) ?? undefined;
  const bioDomain = bioWebsiteDomain(ctx.evidence.profile.bio);
  const domain = (siteUrl ?? (bioDomain ? `https://${bioDomain}` : "")).replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  // Three provider chains with no data dependency on one another run
  // concurrently (handle history; corpus then wallet resolution, which reads
  // the corpus posts; site liveness), so this prelude costs one slow provider,
  // not the sum. Results are applied in the original order below so every
  // evidence merge stays identical to the serial pipeline.
  const [hist, { corpus, foundWallets }, registration, siteSubstance] = await Promise.all([
    handleHistory(ctx.handle),
    (async () => {
      const corpus = await collectCorpus(ctx.handle);
      const foundWallets = await resolveForHandle(ctx.handle, [ctx.evidence.profile.bio, ...corpus.posts].join(" \n "));
      return { corpus, foundWallets };
    })(),
    // Free, keyless registry lookup in the same wave: it costs no extra latency
    // and gives the second date the launch window needs.
    collectDomainRegistration(domain),
    // Site liveness is deterministic and should not disappear when the language
    // model is unavailable. Running token identity first means slogan-only project
    // accounts can supply their verified CoinGecko homepage here.
    collectProjectSiteSubstance(ctx, domain),
  ]);
  if (registration.available) {
    ctx.evidence.domainRegistration = { ...registration.value };
    const window = deriveLaunchWindow(registration.value.registeredAt, ctx.evidence.profile.account_created_at);
    if (window) {
      ctx.evidence.launchWindow = { ...window };
      ctx.emit({ phase: "P0 · Intake", label: "Public footprint window", detail: window.summary, source: "rdap + twitterapi", tone: "neutral" });
    } else {
      ctx.emit({ phase: "P0 · Intake", label: "Domain age", detail: `${registration.value.domain} was registered ${registration.value.registeredAt.slice(0, 10)} (${registration.value.ageMonths} months ago).`, source: "rdap", tone: "neutral" });
    }
  }

  // Handle-change history: a rebrand to escape a burned reputation is a real
  // flag, and the old handles let us search the subject's history under them.
  if (hist && hist.priorHandles.length) {
    ctx.evidence.profile.prior_handles = hist.priorHandles;
    ctx.recordCheck?.({
      id: "identity-continuity",
      status: "finding",
      note: `prior handles found: ${hist.priorHandles.map((handle) => `@${handle}`).join(", ")}`,
      provider: "memory.lol",
      sourceCount: hist.priorHandles.length,
    });
    ctx.emit({ phase: "P0 · Intake", label: "Handle history", detail: `This account previously went by ${hist.priorHandles.map((p) => "@" + p).join(", ")}, indicating a rebrand. Old posts and mentions are searched too.`, source: "memory.lol", tone: "warn" });
  } else if (hist) {
    ctx.recordCheck?.({
      id: "identity-continuity",
      status: "checked-empty",
      note: "handle-history provider returned no prior handle (provider coverage is partial)",
      provider: "memory.lol",
    });
    ctx.emit({ phase: "P0 · Intake", label: "Handle history", detail: "No prior X handle on record for this account (no rebrand found; memory.lol coverage is partial).", source: "memory.lol", tone: "neutral" });
  }

  // Claim-targeted corpus: recent originals + keyword search over the whole
  // history (pinned/announcement posts where claims actually live), ranked and
  // date-stamped — not just the newest 20 items (mostly replies/gm, and gameable).
  const posts = corpus.posts;
  if (posts.length) {
    ctx.evidence.recentActivity = corpus.newest.length ? corpus.newest : posts; // newest originals drive tone/dormancy
    // An account with an empty bio still says what it is, in its own posts.
    // Freeze a bounded sample so routing can classify from first-party content
    // instead of abandoning the subject for lack of a bio string.
    if (!ctx.evidence.profile.bio.trim()) {
      ctx.evidence.profile.self_post_sample = posts.slice(0, 24).join(" \n ").slice(0, 6000);
    }
    ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Assembled a ${posts.length}-post claim corpus (${corpus.count.originals} recent originals + ${corpus.count.searched} from keyword search over full history) to mine for self-claims.`, source: "twitterapi.io", tone: "neutral" });
  }
  await maybeOrientSubject(ctx, siteSubstance?.detail);

  // Find-wallet: a self-disclosed wallet (a 0x address or ENS/basename/.sol name)
  // in the bio/posts. The richer corpus surfaces more contract/URL mentions.
  if (foundWallets.length) {
    for (const w of foundWallets) {
      ctx.evidence.wallets.push({ address: w.address, chain: w.chain, link_tier: w.tier, notes: w.source });
    }
    ctx.emit({ phase: "P0 · Intake", label: "Wallet resolved", detail: `${foundWallets.length} wallet${foundWallets.length > 1 ? "s" : ""}: ${foundWallets.map((w) => `${w.address.slice(0, 8)}… (${w.chain}, ${w.source.includes("Farcaster") ? "Farcaster" : "self-disclosed"})`).join(", ")}. Running on-chain forensics.`, source: "find-wallet", tone: "good" });
  }

  const canExtractClaims = analystAvailable();
  if (canExtractClaims) {
    ctx.emit({ phase: "P0 · Intake", label: "Extract claims", detail: "Reading the subject's bio and posts for self-claims to verify…", tone: "neutral" });
  }
  // Claim extraction and affiliation/team discovery read the same frozen intake
  // inputs and do not depend on one another. Start both provider waves together,
  // but continue to apply claims first below so venture/testimonial merge order and
  // every evidence/provenance decision remain identical to the serial pipeline.
  // When no domain is in the bio, guess one from the handle so we can still fetch
  // the project's own team page (handle "VulcanForged" -> vulcanforged.com, whose
  // docs.* /team is the canonical roster). Failed guesses just fetch nothing.
  const teamDomain = domain || `${ctx.handle.replace(/^@/, "").toLowerCase()}.com`;
  // AI claim extraction is optional. Do not let a missing model key
  // suppress independent Grok/X discovery or the keyless first-party team
  // fetchers below; each provider must fail and attribute independently.
  const claimsPromise = canExtractClaims
    ? extractClaims(ctx.handle, ctx.evidence.profile.bio, posts)
    : Promise.resolve(null);
  const discoveryPromise = Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.prior_handles ?? []),
    // Team announcements are usually old, high-signal posts. `posts` is the
    // claim-targeted full-history corpus; `recentActivity` intentionally keeps
    // only the newest originals for cadence and tone. Passing the latter here
    // silently discarded the historical founder/team posts we had already paid
    // twitterapi.io to retrieve.
    findTeam(ctx.handle, ctx.evidence.profile.display_name, posts, corpus.teamSignalPosts),
    // Run the deeper web/LinkedIn/press team search whenever we have EITHER a
    // domain or a project name — a big public project's roster lives off-X, and
    // many project accounts put no plain domain in the bio.
    domain || ctx.evidence.profile.display_name
      ? findTeamOnSite(domain, ctx.evidence.profile.display_name)
      : Promise.resolve([] as TeamMember[]),
    // Read the project's own /team page directly (Grok's summary can miss it).
    fetchTeamPage(teamDomain, ctx.evidence.profile.display_name),
    // Operator attribution: the accounts THIS account follows whose own bio
    // claims they build it. For a fresh launchpad project with no team page,
    // no press and no listing, this is often the only first-party operator
    // evidence that exists (and it is two crossing signals, not a guess).
    discoverOperatorsFromFollowings(ctx.handle, ctx.evidence.profile.display_name),
    // Same doctrine over the OTHER first-party edge: accounts this account
    // retweets/quote-posts whose own bio claims they run it. Catches the
    // founder the follow scan misses (no follow edge, or beyond its page
    // budget) — e.g. a project account amplifying its founder's posts while
    // the founder's bio says "Founder @project".
    discoverOperatorsFromAmplified(ctx.handle),
    // Reverse role-phrase search: who does the PUBLIC RECORD say founded or
    // leads this project? Runs quoted queries ("founder of @y", "cofounder of
    // @y", "CEO at @y", "@y team", name/domain variants) across X and the web,
    // where the project's own surfaces never name anyone but the founder's
    // bio, a press piece, or an AI answer does.
    findRoleClaimants(ctx.handle, ctx.evidence.profile.display_name, domain),
    // twitterapi reverse-bio: mentions / followings / followers / tweet search
    // for H, then live bios. Official posts often never name anyone. This lane
    // does not consult Serper/Grok, so founder finding survives web-search down.
    discoverReverseBioFromTwitterapi(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.bio),
  ]);

  const claims = await claimsPromise;
  if (claims) {
    const candidateRoles = [...new Set(asRoles(claims.roles))];
    for (const role of candidateRoles) {
      ctx.evidence.findings.push({
        finding_type: "RoleCandidate",
        claim: `Model-extracted self-claim suggests ${role}; provider corroboration is required before routing.`,
        source_url: "",
        source_date: "",
        source_author: "ai-analyst-intake",
        verification_status: "Rumor",
        independent_source_count: 0,
        polarity: 0,
        evidence_origin: "model_lead",
        artifact_verified: false,
        finding_scope: {
          scope: "direct_subject",
          target_entity_key: ctx.evidence.profile.handle,
          target_entity_type: "person",
          relationship_to_subject: "self",
          relationship_label: "audited subject role claim",
        },
      });
    }
    ctx.evidence.ventures = claims.ventures.map((v) => ({
      project_name: v.project_name,
      role: v.role ?? "founder",
      period: v.period ?? "",
      outcome: parseOutcome(v.claimed_outcome),
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    ctx.evidence.testimonials = claims.testimonials.map((t) => ({
      claimed_endorser_handle: t.claimed_endorser_handle,
      claimed_relationship: t.claimed_relationship,
      appears_at: "subject surfaces",
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    ctx.evidence.advised = claims.advised.map((p) => ({
      project_name: p.project_name,
      project_handle: p.project_handle,
      claimed_role: p.claimed_role ?? "advisor",
      appears_at: "subject surfaces",
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    ctx.evidence.promotions = claims.promotions.map((p) => ({
      ticker: p.ticker,
      contract_address: p.contract_address,
      chain: p.chain,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    const n = claims.ventures.length + claims.testimonials.length + claims.advised.length + claims.promotions.length;
    ctx.emit({ phase: "P0 · Intake", label: "Claims extracted", detail: `${n} self-claims across ${candidateRoles.join(", ") || "no role candidates"}. Role candidates remain non-governing until independently verified.`, source: "AI analyst", tone: "neutral" });
  }

  // ── Affiliation discovery: every venture the subject is publicly tied to in
  //    ANY capacity (founded, led, worked at, contributed to, advised), beyond
  //    their own bio and LinkedIn. Each lead is then corroborated against an
  //    independent source (the venture's X follow-graph, an archived team page)
  //    so a web hit becomes a graded tie, never a bare assertion. ──
  ctx.emit({ phase: "P0 · Intake", label: "Discover affiliations", detail: "Three angles in parallel: what this account is tied to, who has named them, and the team named in their own X posts…", source: "grok", tone: "neutral" });
  // Three blind search angles run concurrently (each Grok call is 45s-capped, so
  // parallel keeps wall-clock to one). Subject-first finds what they claim/built;
  // reverse-mention finds projects whose OWN timeline named them; team-from-X
  // mines THIS account's posts for the people behind it (the project-account case).
  // The project's own website (from its X bio link, or a domain in the bio text)
  // is where the team page actually lives — mine it like Site recon would.
  // discoverAffiliations now covers the reverse-mention angle too (was a second
  // Grok search call — merged to halve intake search spend).
  const [bySubject, people, siteTeam, pageTeam, operatorTeam, amplifiedTeam, reverseTeam, reverseBioTwitter] = await discoveryPromise;

  // Reverse-search leads are model output until the claimed person's LIVE bio
  // is fetched and really carries the claim. A confirmed bio is a first-party
  // artifact from the claimant's side; it upgrades the lead's identity link
  // and evidence quote, while subject-side vouching still comes only from the
  // account's own edges (follow, amplification, its posts, its site).
  const mentionLeads = orientationMentionLeads(ctx.evidence.subjectOrientation);
  const roleLeads = [...mentionLeads, ...reverseTeam];
  const reverseBioClaims = roleLeads.length
    ? await confirmClaimantBios(roleLeads, ctx.handle, ctx.evidence.profile.display_name)
    : new Map<string, { role: string; phrase: string; bio?: string; name?: string }>();
  if (reverseBioClaims.size) {
    const quoted = [...reverseBioClaims.entries()]
      .map(([h, claim]) => `@${h} ("${claim.phrase}")`)
      .join(", ");
    ctx.emit({ phase: "P1 · Team", label: "Role claim in live bio", detail: `Live-bio confirmation surfaced ${reverseBioClaims.size} candidate${reverseBioClaims.size === 1 ? "" : "s"} whose current X bio carries the claim first-party: ${quoted}.`, source: "reverse role search + orientation + bio fetch", tone: "good" });
  }

  // Temporary Serper LinkedIn/press follow-up: UNIQUE-ID CONFIRMED founders only
  // (live bio claim for THIS project handle). Unverified leads, orgs, the
  // subject handle, display-name-only rows, and tweet-only reverse-bio members
  // are never searched. Cap 3. confirmClaimantBios entries stay as they are.
  const followupConfirmed = new Map(reverseBioClaims);
  for (const member of reverseBioTwitter.team) {
    if (!uniqueIdConfirmedForFounderFollowup(member, ctx.handle)) continue;
    const key = (member.handle ?? "").replace(/^@/, "").toLowerCase();
    if (followupConfirmed.has(key)) continue;
    followupConfirmed.set(key, {
      role: member.role,
      phrase: member.evidence ?? member.role,
      name: member.name,
    });
  }
  const founderFollowup = followupConfirmed.size
    ? await serperConfirmedFounderFollowup(followupConfirmed, ctx.handle, ctx.evidence.profile.display_name)
    : new Map<string, { linkedin?: string; pressUrls: string[] }>();

  // Auto-pivot team: merge everyone found across the website search, the account's
  // own X content, and a deterministic post role-word scan (founder/CEO/CTO...).
  // Named-only people are KEPT here (a real name + role is signal even with no
  // handle to audit) — this is what a plain handle audit used to drop.
  const webTeam = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  // MERGE duplicates instead of dropping them: the team page gives the
  // authoritative name+role but no links; Grok gives the same person WITH their
  // @handle/LinkedIn. Keep the first occurrence and fill its missing fields from
  // later duplicates, so a page-roster name still gets its identity links.
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^@/, "");
  const namedCorpus = [...posts, ...corpus.teamSignalPosts];
  const officialOrgs = officialXNamedOrgs(namedCorpus).filter((org) => norm(org.handle) && norm(org.handle) !== norm(ctx.handle));
  const orgKeys = new Set(officialOrgs.map((org) => norm(org.handle)));
  // Official twitterapi corpus naming @handles as founder/co-founder/team.
  // Unique-id is the handle. Independent of Serper.
  const postRoleTeam = officialXNamedTeam(namedCorpus, ctx.evidence.profile.display_name, ctx.handle)
    .filter((member) => {
      const h = norm(member.handle);
      return !!h && h !== norm(ctx.handle) && !orgKeys.has(h);
    });
  const byHandle = new Map<string, (typeof webTeam)[number]>();
  const byName = new Map<string, (typeof webTeam)[number]>();
  // Provider-backed management rows may already be present before the website
  // and X team lanes run. Seed both indexes so later identity enrichment fills
  // those rows instead of creating a second copy of the same person.
  for (const member of webTeam) {
    const handle = norm(member.handle);
    const name = norm(member.name);
    if (handle) byHandle.set(handle, member);
    if (name) byName.set(name, member);
  }
  const teamCandidates = [
    // Website/team-page discovery, however deterministic the page fetch
    // itself is, is not the subject account's OWN X activity, so it never
    // carries the first-party handle marker the avatar/follower enrichment
    // collector gates on.
    ...pageTeam.map((member) => ({
      ...member,
      evidence_origin: domain ? "deterministic" as const : "model_lead" as const,
      artifact_verified: !!domain,
      provider: domain ? "team-page" : "team-page-candidate",
      identity_link_evidence_origin: domain ? "deterministic" as const : "model_lead" as const,
      projects_evidence_origin: domain ? "deterministic" as const : "model_lead" as const,
      handleProvenance: undefined as "subject_first_party" | undefined,
    })),
    ...siteTeam.map((member) => ({
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead" as const,
      projects_evidence_origin: "model_lead" as const,
      handleProvenance: undefined as "subject_first_party" | undefined,
    })),
    ...people.map((member) => ({
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead" as const,
      projects_evidence_origin: "model_lead" as const,
      handleProvenance: undefined as "subject_first_party" | undefined,
    })),
    ...postRoleTeam.map((member) => ({
      ...member,
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      provider: "twitterapi",
      identity_link_evidence_origin: "deterministic" as const,
      projects_evidence_origin: "deterministic" as const,
      handleProvenance: member.handle ? "subject_first_party" as const : undefined,
    })),
    // Both halves are first-party provider records: the subject's own
    // following edge and the candidate's own profile text. The handle IS the
    // evidence, so the identity link is deterministic; the OTHER projects
    // named in that bio stay model-free leads (self-claimed, unverified).
    ...operatorTeam.map((member) => ({
      ...member,
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      provider: "twitterapi",
      identity_link_evidence_origin: "deterministic" as const,
      projects_evidence_origin: "model_lead" as const,
      handleProvenance: member.handle ? "subject_first_party" as const : undefined,
    })),
    // Same two crossing first-party signals as the followings lane, over the
    // amplification edge (the subject's own timeline retweeted/quoted the
    // claimant, and the claimant's own bio states the role).
    ...amplifiedTeam.map((member) => ({
      ...member,
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      provider: "twitterapi",
      identity_link_evidence_origin: "deterministic" as const,
      projects_evidence_origin: "model_lead" as const,
      handleProvenance: member.handle ? "subject_first_party" as const : undefined,
    })),
    // Reverse-search leads stay model leads (one-sided until the subject's own
    // edges vouch — the deterministic lanes above own that call and win the
    // merge), but a live-bio-confirmed claim upgrades the identity link and
    // swaps the model's paraphrase for the fetched artifact's own words.
    // Orientation mentionedHandles are the same class of lead: quoted from
    // official posts or live x_search of THIS subject, never auto-bound.
    ...[...mentionLeads, ...reverseTeam].map((member) => {
      const claim = member.handle ? reverseBioClaims.get(member.handle.replace(/^@/, "").toLowerCase()) : undefined;
      const handle = member.handle?.replace(/^@/, "");
      if (claim && handle) {
        return {
          ...member,
          role: claim.role,
          evidence: `their current X bio states "${claim.phrase}"`,
          sourceUrl: member.sourceUrl ?? `https://x.com/${handle}`,
          evidence_origin: "deterministic" as const,
          artifact_verified: true,
          provider: "twitterapi",
          identity_link_evidence_origin: "deterministic" as const,
          projects_evidence_origin: "model_lead" as const,
          handleProvenance: "subject_first_party" as const,
        };
      }
      return {
        ...member,
        evidence_origin: "model_lead" as const,
        artifact_verified: false,
        provider: member.source === "orientation-live-x" ? "orientation-live-x" : "reverse-role-search",
        identity_link_evidence_origin: "model_lead" as const,
        projects_evidence_origin: "model_lead" as const,
        handleProvenance: undefined as "subject_first_party" | undefined,
      };
    }),
    // Reverse-bio twitterapi: the claimant's own bio @-mentions this subject
    // next to founder/COO/CEO/"we built @H" language. Handle is the unique id.
    ...reverseBioTwitter.team.map((member) => ({
      ...member,
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      provider: "twitterapi",
      identity_link_evidence_origin: "deterministic" as const,
      projects_evidence_origin: "model_lead" as const,
      handleProvenance: member.handle ? "subject_first_party" as const : undefined,
    })),
  ];
  for (const t of teamCandidates) {
    const h = t.handle ? norm(t.handle) : "";
    const n = norm(t.name);
    if (!h && !n) continue;
    // Never list the audited subject handle as founder (or any role) of itself.
    if (t.handle && handlesMatch(t.handle, ctx.handle)) continue;
    const existing = (h && byHandle.get(h)) || (n && byName.get(n)) || null;
    if (existing) {
      if (!existing.handle && t.handle) {
        existing.handle = t.handle;
        existing.identity_link_evidence_origin = t.identity_link_evidence_origin;
        byHandle.set(norm(t.handle), existing);
      }
      if (!existing.linkedin && t.linkedin) {
        existing.linkedin = t.linkedin;
        existing.identity_link_evidence_origin = t.identity_link_evidence_origin;
      }
      if ((!existing.projects || !existing.projects.length) && t.projects?.length) {
        existing.projects = t.projects;
        existing.projects_evidence_origin = t.projects_evidence_origin;
      }
      if (t.artifact_verified === true && existing.artifact_verified !== true) {
        // Promote only the facts the deterministic record actually established.
        // Keeping a model-discovered role while merely swapping its provenance
        // to deterministic could turn a generic team mention into an asserted
        // founder title. The verified row owns the governing role and evidence.
        existing.role = t.role;
        existing.evidence_origin = "deterministic";
        existing.artifact_verified = true;
        existing.provider = t.provider;
        existing.source = t.source ?? existing.source;
        existing.sourceUrl = t.sourceUrl ?? existing.sourceUrl;
        existing.evidence = t.evidence ?? existing.evidence;
      }
      // A handle the deterministic record itself asserts (the official
      // account's own role post, or the fetched team page) is a deterministic
      // identity binding. Without this, a model candidate that arrived first
      // keeps the SAME handle flagged model_lead, and an already-bound founder
      // still renders as a needs-verification lead.
      if (
        t.identity_link_evidence_origin === "deterministic"
        && t.handle && norm(t.handle) === norm(existing.handle)
        && existing.identity_link_evidence_origin !== "deterministic"
      ) {
        existing.identity_link_evidence_origin = "deterministic";
      }
      // The marker only ever turns ON: a handle first surfaced by a search
      // lane and later independently confirmed by the subject's own posts/
      // following/amplification edge stays first-party even though it wasn't
      // on arrival. It never turns off — no later lane can revoke it.
      if (
        t.handleProvenance === "subject_first_party"
        && t.handle && norm(t.handle) === norm(existing.handle)
        && existing.handleProvenance !== "subject_first_party"
      ) {
        existing.handleProvenance = "subject_first_party";
      }
      continue;
    }
    const rec = {
      name: t.name,
      handle: t.handle,
      role: t.role,
      kind: "kind" in t && (t.kind === "org" || t.kind === "person") ? t.kind : "person" as const,
      linkedin: t.linkedin,
      evidence: t.evidence,
      source: t.source ?? "X content",
      sourceUrl: t.sourceUrl,
      projects: t.projects,
      evidence_origin: t.evidence_origin,
      artifact_verified: t.artifact_verified,
      provider: t.provider,
      identity_link_evidence_origin: t.identity_link_evidence_origin,
      projects_evidence_origin: t.projects_evidence_origin,
      handleProvenance: t.handleProvenance,
    };
    webTeam.push(rec);
    if (h) byHandle.set(h, rec);
    if (n) byName.set(n, rec);
  }

  // Corroboration only: copy linkedin.com/in URLs extracted from Serper organic
  // onto already unique-id-bound founders. Never create rows, never bind by
  // LinkedIn, never change identity_link_evidence_origin.
  let linkedinCorroborated = 0;
  for (const [handle, hit] of founderFollowup) {
    const existing = byHandle.get(handle);
    if (!existing || existing.kind === "org" || !hit.linkedin) continue;
    if (!existing.linkedin) {
      existing.linkedin = hit.linkedin;
      linkedinCorroborated += 1;
    }
  }
  if (linkedinCorroborated) {
    ctx.emit({
      phase: "P1 · Team",
      label: "Founder LinkedIn corroboration",
      detail: `Serper organic added LinkedIn profile URLs for ${linkedinCorroborated} unique-id-confirmed founder${linkedinCorroborated === 1 ? "" : "s"} (corroboration, not a bind key).`,
      source: "serper founder follow-up",
      tone: "good",
    });
  }

  // Linked orgs/funds/incubators named next to org language in founder or
  // project bios. They are associates, never founder people (a fund on webTeam
  // would inflate P1 namedLeaderCount).
  const linkedOrgs = [...officialOrgs, ...reverseBioTwitter.orgs];
  if (linkedOrgs.length) {
    const haveAssoc = new Set(ctx.evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
    const personKeys = new Set(webTeam.map((m) => (m.handle ?? "").replace(/^@/, "").toLowerCase()).filter(Boolean));
    const addedOrgs: string[] = [];
    for (const org of linkedOrgs) {
      const key = org.handle.replace(/^@/, "").toLowerCase();
      if (!key || key === norm(ctx.handle) || haveAssoc.has(key) || personKeys.has(key)) continue;
      haveAssoc.add(key);
      if (!byHandle.has(key)) {
        const orgRow = {
          name: org.name,
          handle: org.handle,
          role: org.role,
          kind: "org" as const,
          evidence: org.evidence,
          source: org.source,
          sourceUrl: org.sourceUrl,
          evidence_origin: "deterministic" as const,
          artifact_verified: true,
          provider: "twitterapi",
          identity_link_evidence_origin: "deterministic" as const,
          handleProvenance: "subject_first_party" as const,
        };
        webTeam.push(orgRow);
        byHandle.set(key, orgRow);
      }
      ctx.evidence.associates.push({
        associate_handle: org.handle,
        relation: org.role,
        notes: org.evidence,
        evidence_url: org.sourceUrl,
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
      });
      addedOrgs.push(org.handle);
    }
    if (addedOrgs.length) {
      ctx.emit({
        phase: "P1 · Team",
        label: "Linked orgs",
        detail: `Bound ${addedOrgs.length} org/fund/incubator handle${addedOrgs.length === 1 ? "" : "s"} from official posts or founder/project bios: ${addedOrgs.slice(0, 6).join(", ")}.`,
        source: "twitterapi",
        tone: "good",
      });
    }
  }

  // PRIOR LAUNCHES: a launchpad token's risk lives in the operator's history,
  // not its (renounced, LP-locked) contract. Same-wallet history plus the
  // OTHER projects the operator's own bio claims, each resolved to a traded
  // token only when that token's own metadata names the exact handle. Free,
  // keyless, and silent unless the subject really is a launchpad token.
  const launchMint = ctx.evidence.projectToken?.verified === true ? ctx.evidence.projectToken.address : "";
  if (launchMint && ctx.evidence.projectToken?.chain === "solana") {
    try {
      const operatorHandles = operatorTeam.flatMap((member) => (member.projects ?? []).map((project) => project.name));
      // The operator's own account is the one place a launch from a different
      // wallet still gets claimed out loud.
      const operatorHandle = operatorTeam.find((member) => member.handle)?.handle;
      // Who we are auditing. pump.fun knows this for its own mints, but a
      // verified solana token that launched anywhere else has no launchpad
      // record, and then the collector cannot recognise the subject in the
      // operator's own posts. Told here, the audited project is never listed
      // among the operator's earlier projects.
      const history = await collectOperatorLaunches(launchMint, operatorHandles, operatorHandle, {
        symbol: ctx.evidence.projectToken?.symbol ?? "",
        handle: ctx.evidence.profile.handle,
      });
      const narrative = describeLaunchHistory(history);
      // Stamp the STRUCTURE, not only the sentence. This is the join no other
      // tool makes (an X following edge to a bio claim to a launch announcement
      // to a launchpad creator index), and flattening it to prose threw away
      // every per-launch value, tie and date before the client ever saw them.
      // The record travels with the frozen payload, so a saved report can still
      // show each earlier launch years from now.
      //
      // Carried even when no launch resolved to a live pool: the operator's own
      // dated claims of earlier projects are evidence in their own right. They
      // stay CLAIMS, quoted and dated, never an assertion of abandonment.
      if (history.launches.length || history.claimedProjects.length) {
        ctx.evidence.operatorLaunches = history;
      }
      if (narrative && history.launches.length) {
        ctx.evidence.findings.push({
          finding_type: "OperatorLaunchHistory",
          claim: narrative,
          source_url: history.launches[0].url,
          source_date: "",
          source_author: "pump.fun + dexscreener",
          verification_status: "Verified",
          independent_source_count: history.launches.length,
          // Informational base rate, not an accusation: the current values of
          // earlier launches are stated and the reader weighs them.
          polarity: 0,
          evidence_origin: "deterministic",
          artifact_verified: true,
        });
        ctx.emit({
          phase: "P1 · Team",
          label: `Operator has launched before · ${history.totalLaunches} tokens`,
          detail: narrative,
          source: "pump.fun + dexscreener",
          tone: "warn",
        });
      }
    } catch (error) {
      ctx.emit({ phase: "P1 · Team", label: "Prior-launch check error", detail: String(error), tone: "warn" });
    }
  }

  // Does the ACCOUNT ITSELF vouch for this team, or was it only matched by NAME?
  // A real project/founder account ties to its team through its OWN evidence: its
  // handle is among them, it links its site in bio (domain), or its own posts name
  // the people (people/postRoleTeam come from the account's content). A KOL whose
  // display name merely COLLIDES with a project (e.g. @KaminoCrypto vs the Kamino
  // protocol) has none of these — so a by-name team lookup returns that project's
  // founders, and attaching them here is a false identity resolution (the exact
  // name collision the contradictions section catches). Drop it at the source
  // rather than present a stranger's team as this account's identity.
  const subj = norm(ctx.handle);
  const accountVouchesTeam = !!domain
    || postRoleTeam.length > 0
    || operatorTeam.length > 0
    || amplifiedTeam.length > 0
    || reverseBioTwitter.team.length > 0
    || webTeam.some((t) => t.artifact_verified === true && norm(t.handle) === subj);
  if (webTeam.length && !accountVouchesTeam) {
    ctx.emit({ phase: "P1 · Team", label: "Uncorroborated team lead", detail: `Found a possible team for the name "${ctx.evidence.profile.display_name || ctx.handle}", but nothing ties THIS account to it. Its handle isn't independently matched, it links no site, and its own posts name no team. Preserved for follow-up but excluded from scoring and the trust graph.`, source: "team-search", tone: "warn" });
    for (const member of webTeam) {
      // Reverse-bio / follow / amplify first-party handles must survive even
      // when the official account never named anyone and no domain is bound.
      if (member.handleProvenance === "subject_first_party") continue;
      member.evidence_origin = "model_lead";
      member.artifact_verified = false;
      member.identity_link_evidence_origin = "model_lead";
      member.projects_evidence_origin = "model_lead";
    }
  }

  // Actively resolve identities for members still name-only (the team page names
  // them but links nothing): one batched Grok pass finds each person's X handle
  // and LinkedIn. The co-founder of a known fund should never render "named only".
  const nameOnly = webTeam.filter((m) => !m.handle && !m.linkedin).slice(0, 15);
  if (nameOnly.length >= 1) {
    const found = await enrichTeamIdentities(ctx.evidence.profile.display_name || ctx.handle, nameOnly.map((m) => ({ name: m.name, role: m.role })));
    let linked = 0;
    for (const f of found) {
      const m = byName.get(norm(f.name));
      if (!m) continue;
      if (!m.handle && f.handle) {
        m.handle = f.handle;
        m.identity_link_evidence_origin = "model_lead";
        byHandle.set(norm(f.handle), m);
        linked++;
      }
      if (!m.linkedin && f.linkedin) {
        m.linkedin = f.linkedin;
        m.identity_link_evidence_origin = "model_lead";
        if (!f.handle) linked++;
      }
    }
    if (linked) ctx.emit({ phase: "P1 · Team", label: "Identities linked", detail: `Resolved X/LinkedIn for ${linked} of ${nameOnly.length} name-only team members.`, source: "grok", tone: "good" });
  }
  const coalescedTeam = coalesceTeamMembersByHandle(webTeam);
  if (coalescedTeam.length !== webTeam.length) {
    webTeam.splice(0, webTeam.length, ...coalescedTeam);
  }
  // A face, follower count, and account status only for a member whose handle
  // the subject account itself bound (its own posts, following, or
  // amplification edge) — never a team-page or search-discovered handle. See
  // handleProvenance on WebTeamMember for why this is a durable marker rather
  // than a gate on evidence_origin.
  await enrichFirstPartyTeamAvatars(ctx);
  if (webTeam.length) {
    const groundedTeam = webTeam.filter((member) =>
      member.artifact_verified === true && member.evidence_origin !== "model_lead");
    ctx.emit(groundedTeam.length
      ? {
          phase: "P1 · Team",
          label: "Team evidence verified",
          detail: `${groundedTeam.length} project team identit${groundedTeam.length === 1 ? "y" : "ies"} passed first-party or deterministic verification: ${groundedTeam.slice(0, 6).map((member) => member.name + (member.handle ? ` ${member.handle}` : "")).join(", ")}.`,
          source: "team-search",
          tone: "good",
        }
      : {
          phase: "P1 · Team",
          label: "Team candidates withheld",
          detail: `${webTeam.length} search candidate${webTeam.length === 1 ? "" : "s"} did not pass source verification and will not be presented as people behind the project.`,
          source: "team-search",
          tone: "warn",
        });
    // A named team resolves the PROJECT's real-world identity even when the X
    // handle itself is a corporate/brand account (e.g. @VulcanForged). Without
    // this, a brand handle stays "Unverified" and the founder verdict gets
    // capped as if anonymous, contradicting a report that names the CEO. Raise
    // the identity floor: a LinkedIn-corroborated leader -> Confirmed, otherwise
    // a named leader / two named people -> Probable. Only ever raises, and never
    // overrides a suspected-impersonation finding.
    const isLeader = (r?: string) => /founder|cofounder|co-founder|ceo|cto|coo|president|chief/i.test(r ?? "");
    // Only directly fetched first-party team pages and deterministic role scans
    // can raise identity confidence. Grok web/X results remain useful leads in
    // the roster, but cannot confirm the very identity it was asked to discover.
    const backedTeam = [...(domain ? pageTeam : []), ...postRoleTeam, ...reverseBioTwitter.team, ...operatorTeam, ...amplifiedTeam].filter((candidate) =>
      webTeam.some((member) =>
        (!!candidate.handle && norm(candidate.handle) === norm(member.handle)) ||
        (!!candidate.name && norm(candidate.name) === norm(member.name)),
      ),
    );
    const leaders = backedTeam.filter((t) => isLeader(t.role));
    const leaderWithLinkedin = pageTeam.some((t) => isLeader(t.role) && !!t.linkedin);
    const rank: Record<string, number> = { Unverified: 0, Probable: 1, Confirmed: 2 };
    const cur = ctx.evidence.profile.identity_confidence;
    if (backedTeam.length) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "confirmed",
        note: `${backedTeam.length} team identit${backedTeam.length === 1 ? "y" : "ies"} backed by a first-party team page or deterministic post scan`,
        provider: "team-page/post-scan",
        sourceCount: backedTeam.length,
      });
      ctx.recordCheck?.({
        id: "project-team-identity",
        status: "confirmed",
        note: `${backedTeam.length} project team identit${backedTeam.length === 1 ? "y" : "ies"} backed by first-party team or account evidence`,
        provider: "team-page/post-scan",
        sourceCount: backedTeam.length,
      });
    }
    if (cur !== "SuspectedImpersonation") {
      const target = leaderWithLinkedin ? "Confirmed" : leaders.length || backedTeam.length >= 2 ? "Probable" : null;
      if (target) {
        ctx.recordCheck?.({
          id: "identity-resolution",
          status: "confirmed",
          note: `project identity resolved through ${backedTeam.length} independently collected team record${backedTeam.length === 1 ? "" : "s"}`,
          provider: "team-page/post-scan",
          sourceCount: backedTeam.length,
        });
      }
      if (target && (rank[target] ?? 0) > (rank[cur ?? "Unverified"] ?? 0)) {
        ctx.evidence.profile.identity_confidence = target as typeof cur;
        ctx.emit({ phase: "P1 · Team", label: `Identity ${target.toLowerCase()}`, detail: `Project identity resolved through independently fetched team evidence${leaderWithLinkedin ? " (a first-party team page links its leadership)" : ""}; a brand handle over a public team is not an anonymity flag.`, source: "team-page / post scan", tone: "good" });
      }
    }
  } else if (domain) {
    ctx.recordCheck?.({
      id: "project-team-identity",
      status: "checked-empty",
      note: "the official site and project account were checked, but no named team member was attributable",
      provider: "team-page/post-scan",
    });
    ctx.emit({ phase: "P1 · Team", label: "No named team", detail: `Dug ${domain} and the account's posts; no individual team members could be attributed. For a project raising money, an unnamed team is itself a flag.`, source: "team-search", tone: "warn" });
  }

  // People named in the account's X content, routed by kind:
  //  - TEAM -> associates (the investigation lists them as backgroundable people).
  //  - ADVISORS -> testimonials (claimed endorsers), so the corroboration loop can
  //    check whether the named advisor actually follows/acknowledges the project,
  //    or it's a fake name-drop. Only @-handled people are wired in (a bare name
  //    can't be normalized and isn't auditable); named-only ones are just reported.
  if (people.length) {
    const teamList = people.filter((p) => p.kind === "team");
    const advisorList = people.filter((p) => p.kind === "advisor");
    const haveAssoc = new Set(ctx.evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
    const haveTest = new Set(ctx.evidence.testimonials.map((t) => (t.claimed_endorser_handle ?? "").replace(/^@/, "").toLowerCase()));
    const addedTeam: string[] = [];
    for (const t of teamList) {
      if (!t.handle) continue;
      const key = t.handle.replace(/^@/, "").toLowerCase();
      if (haveAssoc.has(key)) continue;
      haveAssoc.add(key);
      ctx.evidence.associates.push({
        associate_handle: t.handle,
        relation: `team: ${t.role}`,
        notes: t.evidence,
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      });
      addedTeam.push(`${t.name} (${t.handle})`);
    }
    const addedAdv: string[] = [];
    for (const a of advisorList) {
      if (!a.handle) continue;
      const key = a.handle.replace(/^@/, "").toLowerCase();
      if (haveTest.has(key)) continue;
      haveTest.add(key);
      ctx.evidence.testimonials.push({
        claimed_endorser_handle: a.handle,
        claimed_relationship: "advisor",
        appears_at: "model search of project X content",
        evidence_origin: "model_lead",
        artifact_verified: false,
      });
      addedAdv.push(`${a.name} (${a.handle})`);
    }
    const namedOnly = people.filter((p) => !p.handle).map((p) => `${p.name} (${p.kind === "advisor" ? "advisor" : p.role})`);
    if (addedTeam.length) ctx.emit({ phase: "P0 · Intake", label: "Team surfaced", detail: `${addedTeam.length} team member${addedTeam.length === 1 ? "" : "s"} named in this account's X content: ${addedTeam.slice(0, 6).join(", ")}.`, source: "grok", tone: "good" });
    if (addedAdv.length) ctx.emit({ phase: "P0 · Intake", label: "Advisors surfaced", detail: `${addedAdv.length} advisor${addedAdv.length === 1 ? "" : "s"}/backer${addedAdv.length === 1 ? "" : "s"} claimed in X content (corroborating each): ${addedAdv.slice(0, 6).join(", ")}.`, source: "grok", tone: "neutral" });
    if (namedOnly.length) ctx.emit({ phase: "P0 · Intake", label: "Named only", detail: `Also named without a handle (not auditable): ${namedOnly.slice(0, 5).join(", ")}.`, source: "grok", tone: "neutral" });
  }
  const mergedMap = new Map<string, DiscoveredAffiliation>();
  for (const v of bySubject) {
    const k = v.name.toLowerCase();
    const ex = mergedMap.get(k);
    // Keep the richest record: prefer an X handle / domain (so corroboration can run).
    if (!ex) mergedMap.set(k, v);
    else mergedMap.set(k, { ...ex, x_handle: ex.x_handle ?? v.x_handle, domain: ex.domain ?? v.domain, evidence: ex.evidence ?? v.evidence, role: ex.role || v.role });
  }
  const discovered = [...mergedMap.values()];
  if (discovered.length) {
    // 1. Push every fresh lead immediately so the audit never blocks on
    //    corroboration. Each record is a live object we refine in place below;
    //    a name collision merges bridge keys instead of dropping the discovery.
    const pending = mergeDiscoveredAffiliations(ctx.evidence.ventures, discovered);
    ctx.emit({ phase: "P0 · Intake", label: "Affiliations discovered", detail: `${discovered.length} public affiliation${discovered.length === 1 ? "" : "s"} tied to the subject: ${discovered.slice(0, 5).map((v) => v.name).join(", ")}.`, source: "grok", tone: "good" });

    // 2. Corroborate the top leads against a second, independent source, all in
    //    parallel and time-boxed, so wall-clock is one slow check, not N. Each
    //    confirmed tie refines its record in place and emits a step.
    let corroboratedAffiliations = 0;
    await Promise.all(
      pending.slice(0, 5).map(async ({ v, rec }) => {
        const corrob: string[] = [];
        // The project handle is often only in the cited post text, not the
        // structured field — recover it so the follow-graph note can run.
        const subjectU = ctx.handle.replace(/^@/, "").toLowerCase();
        const xHandle = v.x_handle ?? (v.evidence?.match(/@([A-Za-z0-9_]{2,30})/g) ?? []).map((s) => s.slice(1)).find((u) => u.toLowerCase() !== subjectU);
        // Only Grok's STRUCTURED domain claim drives a scoreable promotion: a
        // domain scavenged from free post text is too weak to carry deterministic
        // weight (it could be a press/platform host, not the venture's own site).
        let archiveVerified = false;
        let archiveProvider: "wayback" | "arquivo" | null = null;
        try {
          if (v.domain) {
            // The archived page must name BOTH the subject AND the venture on its
            // own /team or /about page, so this is a genuine first-party team tie
            // (not a coincidental mention on a wrong or misguessed domain).
            const arch = await archivedAffiliation(v.domain, ctx.evidence.profile.display_name, v.name);
            // The archive now reads a bounded spread of captures rather than only
            // the newest, so a name scrubbed from a current team page still
            // corroborates. When the tie survives only in the older captures the
            // adapter also hands back that fact, dated, and it is recorded next
            // to the corroboration rather than quietly dropped.
            if (arch) {
              corrob.push(...archiveCorroborationLabels(arch));
              rec.evidence_url = arch.url;
              archiveVerified = true;
              archiveProvider = arch.provider;
            }
          }
          if (xHandle) {
            const follows = await followsSubject("@" + xHandle.replace(/^@/, ""), ctx.handle);
            if (follows) corrob.push(`@${xHandle.replace(/^@/, "")} follows the subject`);
          }
        } catch { /* corroboration is best-effort; the lead still stands */ }
        if (corrob.length) {
          corroboratedAffiliations += 1;
          const base = [v.evidence, `corroborated: ${corrob.join("; ")}`].filter(Boolean).join(" · ");
          rec.notes = base;
          if (archiveVerified) {
            // Promote from single-source model lead to a scoreable artifact: the
            // venture's own archived team/about page independently ties this person
            // to it, so F2/F3/F4/F6 can use it instead of abstaining. A follow-graph
            // tie alone never reaches here.
            rec.evidence_origin = "deterministic";
            rec.artifact_verified = true;
            rec.provider = archiveProvider ?? "wayback";
          }
          ctx.emit({ phase: "P0 · Intake", label: `Affiliation corroborated · ${v.name}`, detail: `${v.role}${v.year ? `, ${v.year}` : ""}: ${corrob.join("; ")}${archiveVerified ? " (verified, scoreable)" : ""}.`, source: "argus", tone: "good" });
        }
      }),
    );
    if (corroboratedAffiliations) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "confirmed",
        note: `${corroboratedAffiliations} discovered affiliation${corroboratedAffiliations === 1 ? "" : "s"} corroborated against an independent artifact or follow-graph result`,
        provider: "wayback/twitterapi.io",
        sourceCount: corroboratedAffiliations,
      });
    }
  } else {
    ctx.emit({ phase: "P0 · Intake", label: "No affiliations found", detail: "No public company affiliations could be attributed to this person via web/X search.", source: "grok", tone: "neutral" });
  }
}

export function axisCatalog(roles: SubjectClass[]) {
  const out: { axis: string; weight: number; role: string }[] = [];
  for (const role of roles) {
    const prof = getProfile(role);
    for (const [axis, weight] of Object.entries(prof.axes)) {
      out.push({ axis, weight, role });
    }
  }
  return out;
}

const siteSubstanceExcerptByEvidence = new WeakMap<CollectedEvidence, string>();

async function maybeOrientSubject(ctx: CollectContext, siteExcerpt?: string): Promise<void> {
  const prior = ctx.evidence.subjectOrientation;
  if (prior && prior.kind !== "UNKNOWN") return;
  if (providerBackedRoles(ctx.evidence).length > 0) return;
  const excerpt = (siteExcerpt ?? siteSubstanceExcerptByEvidence.get(ctx.evidence) ?? "").trim() || undefined;
  const orientation = await orientSubjectWithGrok(ctx.evidence, { siteExcerpt: excerpt });
  if (!orientation) return;
  ctx.evidence.subjectOrientation = orientation;
  if (orientation.kind !== "UNKNOWN" && orientation.what.trim()) {
    ctx.evidence.profile.identity_note = orientation.what;
  }
  if (orientation.what.trim()) {
    ctx.emit({
      phase: "Director",
      label: `Orientation: ${orientation.what}`,
      detail: orientation.what,
      source: "grok-orientation",
      tone: "neutral",
    });
  }
  ctx.evidence.roles = providerBackedRoles(ctx.evidence);
}

/**
 * Select methodologies only from collector-owned evidence. A PROJECT label is
 * intentionally stricter than a generic bio keyword: the current X profile
 * must come from twitterapi and bind the account to a credible first-party
 * website. This makes brand accounts such as @world_xyz deterministic without
 * allowing a model-discovered role or an arbitrary shared-host URL to govern.
 */
export function providerBackedRoles(evidence: CollectedEvidence): SubjectClass[] {
  const roles = new Set<SubjectClass>();
  let bioPrimaryProjectVerified = false;
  let investorBeyondBio = false;
  // Unique-id: a PROJECT-bound handle is the brand/protocol account. Display
  // name never binds a person. Founder facts describe some OTHER handle.
  const projectBound = projectOrientationBound(evidence);
  // A canonical token can bind the audited handle to the project even when
  // the orientation model mistakes a project bio that names a developer for
  // that developer's personal account. The exact official-X match is a
  // unique-id bind; the absence of a resolved person name keeps this rule from
  // collapsing a real founder's personal account into the project brand.
  const canonicalTokenProjectBound = evidence.projectToken?.verified === true
    && Boolean(evidence.projectToken.officialX)
    && handlesMatch(evidence.projectToken.officialX ?? "", evidence.profile.handle)
    && !evidence.profile.resolved_name?.trim();
  // The bio is the first-party self-description, but an empty bio is not an
  // absent subject: the account's own posts are the same kind of evidence from
  // the same provider, so they classify when the bio says nothing.
  const selfDescription = evidence.profile.bio.trim() || (evidence.profile.self_post_sample ?? "").trim();
  if (evidence.profile.profile_collection_state === "resolved" && selfDescription) {
    const classification = classifySubject(selfDescription);
    const profileRoles = classification.applicable_classes;
    const providerCapturedAt = Date.parse(evidence.profile.profile_captured_at ?? "");
    const officialSite = canonicalOfficialWebsite(evidence.profile.website);
    const projectProfileVerified = evidence.profile.profile_provider === "twitterapi"
      && Number.isFinite(providerCapturedAt)
      && officialSite !== null;
    // Strict margin required: on a PROJECT/INVESTOR tie the fund lens keeps
    // governing, so a real fund with product-ish vocabulary never flips.
    bioPrimaryProjectVerified = projectProfileVerified
      && classification.subject_class === SubjectClass.PROJECT
      && classification.scores[SubjectClass.PROJECT] > classification.scores[SubjectClass.INVESTOR];
    profileRoles.forEach((role) => {
      // classifySubject(bio) founder/CEO/"building" language describes a person.
      // It must not put FOUNDER methodology on a PROJECT-bound brand handle.
      if (role === SubjectClass.FOUNDER && projectBound) return;
      if (role !== SubjectClass.PROJECT || projectProfileVerified) roles.add(role);
    });
  }
  for (const venture of evidence.ventures) {
    if (venture.evidence_origin === "model_lead" || venture.artifact_verified !== true) continue;
    const role = (venture.role ?? "").toLowerCase();
    if (/founder|co-?founder|\bceo\b|\bcto\b|creator|owner/.test(role)) {
      if (!projectBound) roles.add(SubjectClass.FOUNDER);
    }
    else if (/advisor|adviser|board/.test(role)) roles.add(SubjectClass.ADVISOR);
    // Specific capital-allocation titles are checked before generic employment
    // words so Investment Director and Portfolio Manager do not collapse into
    // MEMBER. The investor terms remain whole words: Principal Engineer and
    // Partnerships Lead are staff, while Partnerships is not Partner.
    else if (/\b(?:investment director|investment principal|investment partner|venture partner|venture lead|portfolio manager|fund manager|chief investment officer|angel investor|venture capitalist)\b/.test(role)) {
      roles.add(SubjectClass.INVESTOR);
      investorBeyondBio = true;
    }
    else if (/contributor|engineer|developer|employee|manager|director|lead|role on record/.test(role)) roles.add(SubjectClass.MEMBER);
    else if (/\binvestor\b|\bpartner\b|\bprincipal\b|\bventure capital(?:ist)?\b|\bvc\b|\bgp\b/.test(role)) {
      roles.add(SubjectClass.INVESTOR);
      investorBeyondBio = true;
    }
  }
  // A verified founder or executive fact is provider-backed role evidence just
  // as much as a verified venture row is: a subject whose bio carries no role
  // keyword (a cryptic or personal bio) but whom a fetched first-party or
  // independent source names as a company's founder or executive must still
  // route to FOUNDER, not publish INCOMPLETE for lack of a governing role.
  const organizationSubject = isOrganizationAccount(evidence);
  const personIdentityBound = Boolean(evidence.profile.identity_binding);
  for (const fact of evidence.basicFacts ?? []) {
    if (fact.artifact_verified !== true) continue;
    if (fact.status !== "verified" && fact.status !== "corroborated") continue;
    if (!organizationSubject && personIdentityBound && (fact.predicate === "founder" || fact.predicate === "founded" || fact.predicate === "executive")) {
      // A verified founder fact is about a person, not this PROJECT-bound handle.
      if (!projectBound) roles.add(SubjectClass.FOUNDER);
    }
    if (
      !organizationSubject
      && personIdentityBound
      && fact.predicate === "current_role"
      && /\b(?:angel investor|venture capitalist|investor|general partner|managing partner|investment partner|venture partner|portfolio manager|investment director|investment principal|fund manager|chief investment officer|gp)\b/i.test(fact.value)
    ) {
      roles.add(SubjectClass.INVESTOR);
      investorBeyondBio = true;
    }
    // When an X account is suspended or missing from the profile provider, a
    // freshly fetched first-party site can still prove the brand identity by
    // linking back to that exact handle. The basic-facts collector freezes that
    // relationship as a verified official_identity fact. Route only when the
    // verified identity text itself classifies as a project, so a person's own
    // website never becomes a PROJECT methodology by accident.
    if (
      fact.predicate === "official_identity"
      && verifiedOfficialProjectIdentity(evidence, [fact]) !== null
    ) {
      roles.add(SubjectClass.PROJECT);
    }
  }
  if (evidence.clientEngagements.some((row) => row.evidence_origin !== "model_lead" && row.artifact_verified === true)) {
    roles.add(SubjectClass.AGENCY);
  }
  if (evidence.projectToken?.verified === true) {
    roles.add(SubjectClass.PROJECT);
  }
  // A fund's brand account can use project-like language, but its governing
  // methodology remains INVESTOR unless it also ships a separately verified
  // product/token under the exact audited identity. Symmetric exception: a
  // brand account whose bio LEADS with its own product/token ("powered by
  // $X") and whose verified official site links the handle back is a project
  // that merely talks about capital; when no venture record verified the
  // investing (vocabulary was the only investor evidence), the fund
  // methodology is the wrong lens and would starve the scan into INCOMPLETE.
  if (roles.has(SubjectClass.INVESTOR) && !evidence.projectToken?.verified) {
    if (bioPrimaryProjectVerified && !investorBeyondBio) {
      roles.delete(SubjectClass.INVESTOR);
    } else {
      roles.delete(SubjectClass.PROJECT);
    }
  }
  // Last-resort structural routing: a brand account whose bio carries no
  // classifying keyword ("Launch coins on Robinhood via <link>") still routes
  // to PROJECT when its provider-resolved profile links a credible official
  // site that served a live product surface when fetched. The served site is
  // provider-observed evidence of what the account is; without this the
  // subject is unroutable and publishes as an empty INCOMPLETE shell with no
  // methodology at all, which helps no one deciding on the subject.
  if (roles.size === 0
    && evidence.profile.profile_collection_state === "resolved"
    && evidence.profile.profile_provider === "twitterapi"
    && canonicalOfficialWebsite(evidence.profile.website) !== null
    && evidence.profile.site_substance_status === "live") {
    roles.add(SubjectClass.PROJECT);
  }
  // Grok orientation last-resort: same empty-role gate as the live-site
  // fallback, so a bio-classified KOL/founder is never overwritten. PROJECT
  // needs a bound official domain; FOUNDER/INVESTOR need only the twitterapi
  // handle. UNKNOWN never adds a role. site_substance_status is not required.
  if (roles.size === 0 && evidence.subjectOrientation && evidence.subjectOrientation.kind !== "UNKNOWN"
    && orientationHandleBound(evidence)) {
    const kind = evidence.subjectOrientation.kind;
    if (kind === "PROJECT" && evidence.subjectOrientation.boundDomain) {
      roles.add(SubjectClass.PROJECT);
    } else if (kind === "FOUNDER") {
      roles.add(SubjectClass.FOUNDER);
    } else if (kind === "INVESTOR") {
      roles.add(SubjectClass.INVESTOR);
    }
  }
  // PROJECT-bound unique-id is final for this handle: it is the brand account,
  // never also the founder person. Personal orientation FOUNDER stays FOUNDER.
  // Other bio-classified methodologies (KOL / INVESTOR) still govern.
  if (projectBound || canonicalTokenProjectBound) {
    roles.delete(SubjectClass.FOUNDER);
    const other = [...roles].filter((role) => role !== SubjectClass.PROJECT);
    if (other.length === 0) roles.add(SubjectClass.PROJECT);
  }
  return [...roles];
}

const LEGAL_ENTITY_LANGUAGE = /\b(?:incorporated|corporation|company|limited|llc|l\.l\.c\.?|ltd\.?|inc\.?|plc|llp|l\.p\.?|gmbh|s\.a\.?|foundation|association|registered)\b/i;

/**
 * Select the exact frozen legal-entity fact that may arm an organization
 * sanctions query. Display names, bios, model leads, related-company facts,
 * and independent name-only mentions are all excluded.
 */
export function strictOrganizationLegalEntity(
  evidence: CollectedEvidence,
): { name: string; fact: BasicFact; sourceCount: number } | null {
  if (!isOrganizationAccount(evidence)) return null;
  if (!evidence.roles.some((role) => role === SubjectClass.INVESTOR || role === SubjectClass.AGENCY)) return null;
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const candidates = (evidence.basicFacts ?? []).filter((fact) => {
    if (
      fact.predicate !== "legal_entity"
      || fact.status !== "verified"
      || fact.artifact_verified !== true
      || fact.evidence_origin !== "deterministic"
      || !/^(?:investor_org|organization)\.legal_entity$/.test(fact.questionId ?? "")
    ) return false;
    const name = fact.value.replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 200 || /^unknown|not (?:found|available)$/i.test(name)) return false;
    const normalizedName = normalized(name);
    return fact.sources.some((source) =>
      source.relation === "supports"
      && source.artifactVerified === true
      && (source.sourceClass === "official_subject" || source.sourceClass === "regulatory_or_onchain")
      && normalized(source.excerpt).includes(normalizedName)
      && LEGAL_ENTITY_LANGUAGE.test(`${name} ${source.excerpt}`));
  });
  // Many receipts for ONE entity are corroboration, not ambiguity. Counting
  // rows instead of distinct names meant two verified facts naming the same
  // legal entity in different spellings withheld the screen entirely and left
  // the never-waive gate permanently open, so the report could never clear.
  // Genuinely DIFFERENT entities still fail closed: picking one of them would
  // screen an entity the evidence does not single out.
  const distinctNames = new Set(candidates.map((fact) => normalized(fact.value)));
  if (candidates.length === 0 || distinctNames.size !== 1) return null;
  const fact = [...candidates].sort((left, right) =>
    right.sources.filter((source) => source.relation === "supports").length
      - left.sources.filter((source) => source.relation === "supports").length
    || left.value.localeCompare(right.value))[0];
  const supporting = fact.sources.filter((source) => source.relation === "supports");
  return { name: fact.value.replace(/\s+/g, " ").trim(), fact, sourceCount: supporting.length };
}

/**
 * Reuse source-fetched founder and executive facts in the human-readable team
 * roster. The search model only suggests candidates; every row admitted here
 * already passed an independent page fetch plus exact excerpt verification.
 */
const isRetainedSourceFact = (fact: BasicFact): boolean =>
  fact.artifact_verified === true
  && (fact.status === "verified" || fact.status === "corroborated");

// A provider projection or ceiling-only record is useful investigator context,
// but it is deliberately ineligible to become ARGUS verification. Keep this
// predicate shared by every project check that publishes the word "verified".
const isStrictlyVerifiedFact = (fact: BasicFact): boolean =>
  isRetainedSourceFact(fact)
  && fact.providerProjection !== true
  && fact.floorEligible !== false;

export function projectVerifiedBasicFacts(ctx: CollectContext): void {
  if (!providerBackedRoles(ctx.evidence).includes(SubjectClass.PROJECT)) return;
  const retainedFacts = (ctx.evidence.basicFacts ?? []).filter(isRetainedSourceFact);
  if (!retainedFacts.length) return;
  const facts = retainedFacts.filter(isStrictlyVerifiedFact);
  const reportedFacts = retainedFacts.filter((fact) => !isStrictlyVerifiedFact(fact));

  const brandIdentity = facts.find((fact) =>
    fact.predicate === "official_identity"
    && fact.sources.some((source) => source.sourceClass === "official_subject"));
  const officialWebsite = canonicalOfficialWebsite(ctx.evidence.profile.website);
  const officialWebsiteSources = officialWebsite
    ? facts.flatMap((fact) => fact.sources).filter((source) => {
      if (source.sourceClass !== "official_subject") return false;
      try {
        const host = new URL(source.url).hostname.replace(/^www\./, "").toLowerCase();
        return host === officialWebsite.domain || host.endsWith(`.${officialWebsite.domain}`);
      } catch {
        return false;
      }
    })
    : [];
  if (
    brandIdentity
    && officialWebsite
    && ctx.evidence.profile.profile_collection_state === "resolved"
    && ctx.evidence.profile.profile_provider === "twitterapi"
    && (
      ctx.evidence.profile.site_substance_status === "live"
      || officialWebsiteSources.length > 0
    )
    && ctx.evidence.profile.identity_confidence !== "SuspectedImpersonation"
  ) {
    ctx.evidence.profile.identity_confidence = "Confirmed";
    ctx.recordCheck?.({
      id: "identity-resolution",
      status: "confirmed",
      note: `project brand identity confirmed by the provider-resolved official X account and live official site ${officialWebsite.domain}; operator identity remains a separate team finding`,
      provider: "twitterapi/basic-facts-web/site-fetch",
      sourceCount: brandIdentity.sources.length + Math.max(1, officialWebsiteSources.length),
    });
  }

  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normHandle = (value: string) => value.trim().replace(/^@/, "").toLowerCase();
  const subjectHandle = normHandle(ctx.handle);
  const citedPersonHandle = (fact: BasicFact): string | undefined => {
    const handles = new Set<string>();
    const escapedName = fact.value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escapedName) return undefined;
    const nameThenHandle = new RegExp(
      `${escapedName}\\s*(?:\\(\\s*|\\[\\s*)?@([A-Za-z0-9_]{2,30})\\b`,
      "gi",
    );
    const handleThenName = new RegExp(
      `@([A-Za-z0-9_]{2,30})\\s*(?:\\(\\s*|\\[\\s*)${escapedName}\\b`,
      "gi",
    );
    for (const source of fact.sources) {
      for (const match of source.excerpt.matchAll(nameThenHandle)) {
        handles.add(normHandle(match[1]));
      }
      for (const match of source.excerpt.matchAll(handleThenName)) {
        handles.add(normHandle(match[1]));
      }
    }
    handles.delete(subjectHandle);
    return handles.size === 1 ? [...handles][0] : undefined;
  };
  const roster = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  const people = facts.filter((fact) => fact.predicate === "founder" || fact.predicate === "executive");
  for (const fact of people) {
    const citedHandle = citedPersonHandle(fact);
    if (handlesMatch(fact.value, ctx.handle)) continue;
    if (citedHandle && handlesMatch(citedHandle, ctx.handle)) continue;
    const existing = roster.find((member) =>
      norm(member.name) === norm(fact.value)
      || Boolean(citedHandle && member.handle && normHandle(member.handle) === citedHandle));
    if (existing) continue;
    const source = fact.sources.find((candidate) => candidate.relation === "supports") ?? fact.sources[0];
    if (!source) continue;
    roster.push({
      name: fact.value,
      ...(citedHandle ? { handle: `@${citedHandle}`, identity_link_evidence_origin: "deterministic" as const } : {}),
      role: fact.qualifier ?? (fact.predicate === "founder" ? "Founder" : "Executive"),
      evidence: source.excerpt,
      source: source.title ?? (source.sourceClass === "official_subject" ? "Official project source" : "Corroborated public sources"),
      sourceUrl: source.url,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "basic-facts-web",
    });
  }

  if (people.length) {
    const peopleSourceCount = people.reduce((total, fact) => total + fact.sources.length, 0);
    // Public-record identity is CONFIRMED, not merely probable: a founder or
    // executive fact verified across two or more independent registrable
    // domains (self-published sources excluded) is the institutional
    // equivalent of a LinkedIn-linked leader. A Google-obvious identity such
    // as Uniswap/Hayden Adams must not present as a hedge. Impersonation
    // still overrides, and single-source identities stay Probable.
    const publicRecordIdentity = people.some((fact) => {
      const domains = new Set(fact.sources
        .filter((src) => src.sourceClass !== "official_subject")
        .map((src) => registrableDomain(src.url))
        .filter((domain): domain is string => Boolean(domain)));
      return domains.size >= 2;
    });
    if (ctx.evidence.profile.identity_confidence !== "SuspectedImpersonation") {
      if (publicRecordIdentity) {
        ctx.evidence.profile.identity_confidence = "Confirmed";
      } else if (ctx.evidence.profile.identity_confidence === "Unverified") {
        ctx.evidence.profile.identity_confidence = "Probable";
      }
    }
    ctx.recordCheck?.({
      id: "identity-resolution",
      status: "confirmed",
      note: `project identity resolved through ${people.length} founder or executive record${people.length === 1 ? "" : "s"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: peopleSourceCount,
    });
    ctx.recordCheck?.({
      id: "affiliations-associates",
      status: "confirmed",
      note: `${people.length} project team affiliation${people.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: peopleSourceCount,
    });
    ctx.recordCheck?.({
      id: "project-team-identity",
      status: "confirmed",
      note: `${people.length} founder or executive record${people.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: peopleSourceCount,
    });
  } else {
    const reportedPeople = reportedFacts.filter((fact) =>
      fact.predicate === "founder" || fact.predicate === "executive");
    const teamPredicates = ["founder", "executive"] as const;
    const teamSearchCompleted = teamPredicates.every((predicate) =>
      (ctx.evidence.basicFactQuestionLedger ?? []).some((entry) =>
        entry.audience === "project"
        && entry.predicate === predicate
        && entry.status === "unanswered"
        && entry.providerRuns.some((run) =>
          run.state === "succeeded" || run.state === "completed_empty")));
    if (reportedPeople.length) {
      ctx.recordCheck?.({
        id: "project-team-identity",
        status: "reported",
        note: `${reportedPeople.length} source-attributed founder or executive record${reportedPeople.length === 1 ? " was" : "s were"} retained as context, but did not pass strict verification and did not resolve operator identity`,
        provider: "basic-facts-web",
        sourceCount: reportedPeople.reduce((total, fact) => total + fact.sources.length, 0),
      });
    } else if (teamSearchCompleted) {
      ctx.recordCheck?.({
        id: "project-team-identity",
        status: "finding",
        note: "bounded founder and executive searches completed against the official project record, but no named operator passed source verification; the project brand is verified separately",
        provider: "basic-facts-web",
      });
    }
  }

  const products = facts.filter((fact) => fact.predicate === "product");
  if (products.length) {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "confirmed",
      note: `${products.length} core product description${products.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: products.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else {
    const reportedProducts = reportedFacts.filter((fact) => fact.predicate === "product");
    if (reportedProducts.length) {
      ctx.recordCheck?.({
        id: "project-product-substance",
        status: "reported",
        note: `${reportedProducts.length} provider-attributed or first-party product description${reportedProducts.length === 1 ? " was" : "s were"} retained as context; ${reportedProducts.length === 1 ? "it was" : "they were"} not independently verified enough to set a score floor`,
        provider: "basic-facts-web",
        sourceCount: reportedProducts.reduce((total, fact) => total + fact.sources.length, 0),
      });
    }
  }

  const traction = facts.filter((fact) => fact.predicate === "traction");
  if (traction.length) {
    ctx.recordCheck?.({
      id: "project-traction-liveness",
      status: "confirmed",
      note: `${traction.length} concrete traction or usage metric${traction.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: traction.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else {
    const reportedTraction = reportedFacts.filter((fact) => fact.predicate === "traction");
    if (reportedTraction.length) {
      ctx.recordCheck?.({
        id: "project-traction-liveness",
        status: "reported",
        note: `${reportedTraction.length} provider-reported traction or usage metric${reportedTraction.length === 1 ? " was" : "s were"} retained as context; ${reportedTraction.length === 1 ? "it was" : "they were"} not independently verified enough to set a score floor`,
        provider: "basic-facts-web",
        sourceCount: reportedTraction.reduce((total, fact) => total + fact.sources.length, 0),
      });
    }
  }
}

type FounderDecisionCheckId =
  | "founder-identity-authority"
  | "founder-company-relationships"
  | "founder-track-record"
  | "founder-control-conflicts"
  | "founder-legal-regulatory"
  | "founder-asset-distinction";

interface FounderDecisionQuestionGroup {
  id: FounderDecisionCheckId;
  predicates: readonly string[];
  answerMode: "all" | "any";
  answeredNote: string;
  emptyNote: string;
}

const FOUNDER_DECISION_QUESTION_GROUPS: readonly FounderDecisionQuestionGroup[] = [
  {
    id: "founder-identity-authority",
    predicates: ["official_identity", "current_role"],
    answerMode: "all",
    answeredNote: "identity and current decision-making role are both tied to verified evidence",
    emptyNote: "the source search completed without verifying both identity and current authority",
  },
  {
    id: "founder-company-relationships",
    predicates: ["founder", "current_role"],
    answerMode: "all",
    answeredNote: "founded companies and current operating relationships are tied to verified evidence",
    emptyNote: "the source search completed without verifying both founded companies and current operating relationships",
  },
  {
    id: "founder-track-record",
    predicates: ["track_record", "exit", "prior_role", "founded", "product", "launched", "traction"],
    answerMode: "any",
    answeredNote: "at least one prior role, founded venture, shipped product, traction result, venture outcome, or exit is tied to verified evidence",
    emptyNote: "the source search completed without a publishable prior role, founded venture, shipped product, traction result, venture outcome, or exit",
  },
  {
    id: "founder-control-conflicts",
    predicates: ["control", "conflict_of_interest", "governance"],
    answerMode: "any",
    answeredNote: "at least one control, governance, or conflict disclosure is tied to verified evidence",
    emptyNote: "the source search completed without a publishable control or conflict disclosure; this is a gap, not a clean screen",
  },
  {
    id: "founder-legal-regulatory",
    predicates: ["legal_regulatory_event"],
    answerMode: "any",
    answeredNote: "a material legal or regulatory event is tied to its explicitly named subject and stated status",
    emptyNote: "the source search completed without a verified event explicitly naming this person; this is not legal clearance",
  },
  {
    id: "founder-asset-distinction",
    predicates: ["public_security", "official_token"],
    answerMode: "any",
    answeredNote: "every observed security or token claim is classified and verified in its own asset category",
    emptyNote: "no security or token claim entered the frozen evidence set, so asset classification was not applicable",
  },
] as const;

/**
 * Convert the role-aware question ledger into six investor-facing founder
 * outcomes. A completed empty search records the gap without claiming a
 * negative. Provider failures remain unavailable for observed claims, while
 * an asset class with no claim or candidate in the frozen evidence is not
 * applicable rather than a fabricated negative finding.
 */
export function collectFounderDecisionQuestionOutcomes(ctx: CollectContext): void {
  if (!ctx.evidence.roles.includes(SubjectClass.FOUNDER)) return;
  const ledger = ctx.evidence.basicFactQuestionLedger ?? [];
  if (!ledger.length) return;
  const verifiedFacts = (ctx.evidence.basicFacts ?? []).filter((fact) =>
    fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated"),
  );

  for (const group of FOUNDER_DECISION_QUESTION_GROUPS) {
    const entries = group.predicates
      .map((predicate) => ledger.find((entry) => entry.predicate === predicate))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (!entries.length) continue;
    const ledgerAnswered = group.answerMode === "all"
      ? group.predicates.every((predicate) => entries.some((entry) => entry.predicate === predicate && entry.status === "answered"))
      : entries.some((entry) => entry.status === "answered");
    const facts = verifiedFacts.filter((fact) =>
      group.predicates.includes(fact.predicate)
      && (group.id !== "founder-legal-regulatory" || fact.attributionScope === "direct_subject"));
    if (group.id === "founder-asset-distinction") {
      const assetOutcomes = group.predicates.map((predicate) => {
        const entry = entries.find((candidate) => candidate.predicate === predicate);
        const fact = facts.find((candidate) => candidate.predicate === predicate);
        // A verified project token (project audits) or the founder's verified
        // venture token (person audits, bound via the venture's own bridge
        // keys) both resolve the token category deterministically.
        const verifiedProjectToken = predicate === "official_token"
          ? ctx.evidence.projectToken?.verified
            ? ctx.evidence.projectToken
            : ctx.evidence.ventureToken?.verified
              ? ctx.evidence.ventureToken
              : null
          : null;
        const claimObserved = Boolean(
          fact
          || verifiedProjectToken
          || (ctx.evidence.basicFactLeads ?? []).some((lead) => lead.predicate === predicate)
          || entry?.status === "answered"
        );
        const outcome = fact || verifiedProjectToken
          ? "verified" as const
          : entry?.status === "unanswered" && basicFactQuestionOutcome(entry) === "checked_empty"
            ? "checked_empty" as const
            : claimObserved
              ? "unresolved" as const
              : "not_applicable" as const;
        const label = predicate === "public_security" ? "Public security" : "Official crypto token";
        const verifiedValue = fact?.value
          ?? (verifiedProjectToken ? `$${verifiedProjectToken.symbol}` : "");
        return {
          predicate,
          outcome,
          note: outcome === "verified"
            ? `${label}: ${verifiedValue} verified`
            : outcome === "checked_empty"
              ? `${label}: completed search found no verified asset`
              : outcome === "not_applicable"
                ? `${label}: not applicable because no claim or candidate was observed in the frozen person/founder evidence`
                : `${label}: unresolved`,
        };
      });
      const unresolvedAssets = assetOutcomes.filter((outcome) => outcome.outcome === "unresolved");
      const applicableAssets = assetOutcomes.filter((outcome) => outcome.outcome !== "not_applicable");
      const sourceCount = facts.reduce((count, fact) => count + fact.sources.length, 0);
      ctx.recordCheck?.({
        id: group.id,
        status: unresolvedAssets.length
          ? "unavailable"
          : applicableAssets.some((outcome) => outcome.outcome === "verified")
            ? "confirmed"
            : applicableAssets.some((outcome) => outcome.outcome === "checked_empty")
              ? "checked-empty"
              : "not-applicable",
        note: `${assetOutcomes.map((outcome) => outcome.note).join("; ")}. ${unresolvedAssets.length
          ? "Each observed asset claim must be verified in its own category before this distinction is complete."
          : applicableAssets.length
            ? "Every observed asset was classified separately. A not-applicable category is not a provider-backed negative finding."
            : "No asset claim entered the frozen evidence set, so this classification check does not govern readiness."}`,
        provider: "basic-facts-question-ledger",
        sourceCount,
      });
      continue;
    }
    // The ledger can contain useful related-company legal context, but only an
    // event attributed exactly to the audited person may close or govern the
    // founder's legal question.
    const answered = ledgerAnswered
      && (group.id !== "founder-legal-regulatory" || facts.length > 0);
    // Last-run-wins via the canonical helper (the asset branch above already
    // uses it): only an explicit final completed-empty pass may read as a
    // completed screen. A failed or partial targeted repair, or a succeeded
    // batch that left only unverified leads, stays unavailable.
    const completedSearch = entries.every((entry) => {
      const outcome = basicFactQuestionOutcome(entry);
      return outcome === "answered" || outcome === "checked_empty";
    });
    if (answered) {
      const hasAttributedConcern = facts.some((fact) =>
        fact.predicate === "legal_regulatory_event" || fact.predicate === "conflict_of_interest",
      );
      ctx.recordCheck?.({
        id: group.id,
        status: hasAttributedConcern ? "finding" : "confirmed",
        note: group.answeredNote,
        provider: "basic-facts-question-ledger",
        sourceCount: facts.reduce((count, fact) => count + fact.sources.length, 0),
      });
      continue;
    }

    ctx.recordCheck?.({
      id: group.id,
      status: completedSearch ? "checked-empty" : "unavailable",
      note: completedSearch
        ? group.emptyNote
        : `${group.emptyNote}; one or more targeted search passes were partial, failed, or unavailable`,
      provider: "basic-facts-question-ledger",
      sourceCount: 0,
    });
  }
}

const PROJECT_BACKING_ROLE = /\b(?:advisor|adviser|backer|investor)\b/i;
const PROJECT_BACKING_PROVIDERS = new Set(["team-page", "twitterapi"]);
const PROJECT_TRANSPARENCY_FACT_PREDICATES = new Set([
  "legal_entity",
  "governance",
  "tokenomics",
  "vesting",
  "treasury",
  "audit",
  "repository",
]);

export interface ProjectCoreEvidenceOutcomeOptions {
  /** A disclosure search completed and explicitly returned no candidate facts. */
  transparencySearchExplicitlyEmpty?: boolean;
}

/**
 * Record the project-check outcomes that core collection can defend today.
 * This deliberately does not turn model search, notable followers, or a
 * generic "partner" title into evidence of project backing. A product
 * partnership qualifies only through the separately verified Basic Fact path.
 * Transparency stays
 * unavailable until a fetched source directly proves a qualifying disclosure
 * instead of merely appearing on a disclosure-themed URL. A
 * completed empty search is recorded separately from an unavailable provider.
 */
export function collectProjectCoreEvidenceOutcomes(
  ctx: CollectContext,
  options: ProjectCoreEvidenceOutcomeOptions = {},
): {
  state: "partial" | "skipped";
  detail: string;
} {
  if (!ctx.evidence.roles.includes(SubjectClass.PROJECT)) {
    return { state: "skipped", detail: "not a provider-backed project role" };
  }

  const verifiedBackers = (ctx.evidence.webTeam ?? [])
    .slice(0, 32)
    .filter((member) =>
      member.artifact_verified === true
      && member.evidence_origin !== "model_lead"
      && !!member.provider
      && PROJECT_BACKING_PROVIDERS.has(member.provider)
      && PROJECT_BACKING_ROLE.test(member.role),
    );

  const backingFacts = (ctx.evidence.basicFacts ?? []).filter((fact) =>
    (fact.predicate === "funding" || fact.predicate === "investor" || fact.predicate === "partnership")
    && isRetainedSourceFact(fact));
  const verifiedBackingFacts = backingFacts.filter(isStrictlyVerifiedFact);
  const reportedBackingFacts = backingFacts.filter((fact) => !isStrictlyVerifiedFact(fact));
  const backingCount = verifiedBackers.length + verifiedBackingFacts.length;

  if (backingCount) {
    const providers = [...new Set([
      ...verifiedBackers.map((member) => member.provider!),
      ...(verifiedBackingFacts.length ? ["basic-facts-web"] : []),
    ])];
    ctx.recordCheck?.({
      id: "project-backing-partners",
      status: "confirmed",
      note: `${backingCount} funding, investor, advisor, counterparty, or operating-partner record${backingCount === 1 ? " was" : "s were"} verified from fetched public evidence; relationship terms were not inferred beyond those sources`,
      provider: providers.join("/"),
      sourceCount: verifiedBackers.length + verifiedBackingFacts.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else if (reportedBackingFacts.length) {
    ctx.recordCheck?.({
      id: "project-backing-partners",
      status: "reported",
      note: `${reportedBackingFacts.length} provider-attributed funding, investor, or partnership record${reportedBackingFacts.length === 1 ? " was" : "s were"} retained as context; ${reportedBackingFacts.length === 1 ? "it was" : "they were"} not independently verified enough to establish the relationship or set a score floor`,
      provider: "basic-facts-web",
      sourceCount: reportedBackingFacts.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else {
    // When the scan actually ran over collected first-party material (a
    // roster, verified facts, or a fetched live site), an empty result is a
    // completed ASSESSMENT of this axis (the founder-repeat-backing idiom),
    // not a coverage gap: without it every young or bootstrapped project
    // abstains INCOMPLETE on P4 forever. Only a scan with nothing at all to
    // read stays a checked-empty coverage row.
    const assessable = (ctx.evidence.webTeam ?? []).length > 0
      || (ctx.evidence.basicFacts ?? []).length > 0
      || ctx.evidence.profile.site_substance_status === "live";
    ctx.recordCheck?.({
      id: "project-backing-partners",
      status: assessable ? "finding" : "checked-empty",
      note: assessable
        ? "assessed backing and partners across the collected first-party record (team roster, verified facts, official site): no verified funding, investor, advisor, counterparty, or operating-partner evidence appears. Project-only partnership claims and model-only leads were excluded. This is a null result on this axis, not adverse evidence."
        : "bounded scan of up to 32 frozen first-party team and account records found no verified funding, investor, advisor, counterparty, or operating-partner evidence; project-only partnership claims and model-only leads were excluded",
      provider: "project-core-evidence",
    });
  }

  const disclosures = (ctx.evidence.basicFacts ?? []).filter((fact) =>
    PROJECT_TRANSPARENCY_FACT_PREDICATES.has(fact.predicate)
    && isRetainedSourceFact(fact));
  const verifiedDisclosures = disclosures.filter(isStrictlyVerifiedFact);
  const reportedDisclosures = disclosures.filter((fact) => !isStrictlyVerifiedFact(fact));
  if (verifiedDisclosures.length) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "confirmed",
      note: `${verifiedDisclosures.length} legal, governance, token-economic, repository, or security disclosure${verifiedDisclosures.length === 1 ? " was" : "s were"} verified against fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: verifiedDisclosures.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else if (reportedDisclosures.length) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "reported",
      note: `${reportedDisclosures.length} provider-attributed or self-attested disclosure${reportedDisclosures.length === 1 ? " was" : "s were"} retained as context; ${reportedDisclosures.length === 1 ? "it did" : "they did"} not pass independent verification and did not set a score floor`,
      provider: "basic-facts-web",
      sourceCount: reportedDisclosures.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else if (options.transparencySearchExplicitlyEmpty) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "checked-empty",
      note: "bounded disclosure search completed with an explicit no-match; no source-linked legal, governance, token-economic, repository, or security disclosure candidate was returned",
      provider: "basic-facts-web",
    });
  } else if (
    (ctx.evidence.basicFacts ?? []).length > 0
    || (ctx.evidence.webTeam ?? []).length > 0
    || ctx.evidence.profile.site_substance_status === "live"
  ) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "finding",
      note: "bounded disclosure verification completed against the fetched project record, but no legal, governance, token-economic, repository, or direct audit-report source passed verification; canonical token identity alone does not establish transparency",
      provider: "project-disclosure-collector",
    });
  } else {
    // Canonical token identity alone is not a transparency attestation and does
    // not prove that a disclosure search had material to inspect.
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "unavailable",
      note: "no fetched project record was available for bounded disclosure verification; canonical token identity alone does not establish transparency",
      provider: "project-disclosure-collector",
    });
  }

  return {
    state: "partial",
    detail: `bounded frozen-evidence scan completed with ${backingCount} strictly verified backing record${backingCount === 1 ? "" : "s"}, ${verifiedDisclosures.length} strictly verified disclosure record${verifiedDisclosures.length === 1 ? "" : "s"}, and ${reportedBackingFacts.length + reportedDisclosures.length} source-reported context record${reportedBackingFacts.length + reportedDisclosures.length === 1 ? "" : "s"}`,
  };
}

/**
 * Freeze a severe canonical-token drawdown as its own score-limiting fact.
 * The verified project-token snapshot remains positive identity/market
 * evidence; this separate record prevents one citation from appearing as both
 * support and counter-evidence. Drawdown alone is explicitly not misconduct.
 */
export function recordProjectTokenDrawdownFinding(evidence: CollectedEvidence): boolean {
  const token = evidence.projectToken;
  const history = token?.history;
  const historySourceUrl = history?.sourceUrl;
  const closeDrawdown = history?.drawdownPct;
  // The close series cannot see the shape this finding is for. A token that ran
  // inside one candle and gave it all back closes flat, so its close-based
  // drawdown is 0 while the fall from the reported intraday high is 97%. Read
  // the more severe of the two, and say which one was measured: a candle high
  // is the highest price ONE source reported inside ONE period, never an
  // all-time high, and never a peak established across the whole market.
  const rangeDrawdown = history?.range?.drawdownFromHighPct;
  const usable = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const fromRange = usable(rangeDrawdown) && (!usable(closeDrawdown) || rangeDrawdown < closeDrawdown);
  const drawdownPct = fromRange ? rangeDrawdown : closeDrawdown;
  if (
    !token
    || !usable(drawdownPct)
    || drawdownPct > -70
    || !historySourceUrl
  ) {
    return false;
  }
  if (evidence.findings.some((finding) =>
    finding.finding_type === "ProjectTokenDrawdown"
    && finding.source_url === historySourceUrl,
  )) return false;

  const timeframe = history!.timeframe === "hour" ? "hourly" : "daily";
  const period = history!.timeframe === "hour" ? "hour" : "day";
  const measured = fromRange
    ? `fall from the highest price GeckoTerminal reported inside a single ${period} of`
    : "fall from the highest close in";
  // A window with holes covers fewer periods than it spans, so the claim states
  // what it observed rather than implying an unbroken stretch.
  const coverage = history!.windowIsPartial && history!.spanPeriods
    ? ` That window observed ${history!.points.length} of ${history!.spanPeriods} ${period}s, so it is a partial read of its own span.`
    : "";
  evidence.findings.push({
    finding_type: "ProjectTokenDrawdown",
    claim: `$${token.symbol} recorded a verified ${Math.abs(drawdownPct).toFixed(1)}% ${measured} the captured GeckoTerminal ${timeframe} OHLCV window.${coverage} ${token.coingeckoId ? "CoinGecko and DexScreener established" : "DexScreener established"} canonical token and pool context; price drawdown alone does not establish misconduct.`,
    source_url: historySourceUrl,
    source_date: token.capturedAt,
    source_author: "geckoterminal",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
  });
  return true;
}

/**
 * Promote DeFiLlama's frozen protocol-incident rows into standalone verified
 * counter-evidence. These records describe security/control failure, not fraud
 * by the project, so they never trigger a misconduct hard cap by themselves.
 */
export function recordProtocolSecurityIncidentFindings(evidence: CollectedEvidence): number {
  const protocol = evidence.protocolTvl;
  if (!protocol?.hacks?.length) return 0;
  let recorded = 0;
  for (const incident of [...protocol.hacks]
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")))
    .slice(0, 5)) {
    const sourceDate = incident.date ?? protocol.capturedAt;
    const duplicate = evidence.findings.some((finding) =>
      finding.finding_type === "ProtocolSecurityIncident"
      && finding.source_url === protocol.sourceUrl
      && finding.source_date === sourceDate);
    if (duplicate) continue;
    const amount = incident.amountUsd ? `$${(incident.amountUsd / 1_000_000).toFixed(incident.amountUsd % 1_000_000 === 0 ? 0 : 1)}M` : "an unquantified";
    const classification = incident.classification ? `${incident.classification.toLowerCase()} ` : "";
    const technique = incident.technique ? ` Technique recorded: ${incident.technique}.` : "";
    const recovery = incident.returnedFunds
      ? incident.returnedAmountUsd
        ? ` DeFiLlama records $${(incident.returnedAmountUsd / 1_000_000).toFixed(incident.returnedAmountUsd % 1_000_000 === 0 ? 0 : 1)}M returned.`
        : " DeFiLlama records the funds as returned."
      : " DeFiLlama does not record returned funds for this incident.";
    const fullReturnRecorded = incident.returnedFunds
      && (
        incident.returnedAmountUsd == null
        || incident.amountUsd == null
        || incident.returnedAmountUsd >= incident.amountUsd
      );
    evidence.findings.push({
      finding_type: "ProtocolSecurityIncident",
      claim: `DeFiLlama records ${amount} ${classification}security incident affecting ${protocol.name}${incident.date ? ` on ${incident.date}` : ""}.${technique}${recovery} This is evidence of protocol security and control failure, not by itself evidence of fraud or intentional misconduct.`,
      source_url: protocol.sourceUrl,
      source_date: sourceDate,
      source_author: "defillama",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "defillama",
      protocol_incident: {
        incident_date: incident.date,
        observed_at: protocol.capturedAt,
        amount_usd: incident.amountUsd,
        reference_tvl_usd: protocol.tvlUsd,
        recovery_status: fullReturnRecorded ? "recorded_full_return" : "no_recorded_full_return",
        returned_amount_usd: incident.returnedAmountUsd ?? null,
      },
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: evidence.profile.handle,
        target_entity_type: "project",
        relationship_to_subject: "self",
      },
    });
    recorded += 1;
  }
  return recorded;
}

async function recoverProjectProtocolIncidentEvidence(ctx: CollectContext): Promise<void> {
  const token = ctx.evidence.projectToken;
  if (!token?.verified || ctx.evidence.protocolTvl) return;
  const outcome = await collectProtocolTvl(defiLlamaLookupName(token.name));
  if (
    !outcome.available
    || !token.coingeckoId
    || !protocolRecordMatchesCanonicalToken(outcome.value.geckoId, token.coingeckoId)
  ) return;
  ctx.evidence.protocolTvl = {
    ...outcome.value,
  };
  if (outcome.value.chains.length) {
    ctx.evidence.projectToken = {
      ...token,
      deployedChains: outcome.value.chains,
    };
  }
  const incidentCount = recordProtocolSecurityIncidentFindings(ctx.evidence);
  if (!incidentCount) return;
  const newest = [...(ctx.evidence.protocolTvl.hacks ?? [])]
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")))[0];
  ctx.emit({
    phase: "Token",
    label: `${incidentCount} protocol security incident${incidentCount === 1 ? "" : "s"} recovered`,
    detail: `${newest?.date ?? "Undated"}${newest?.amountUsd ? ` · $${(newest.amountUsd / 1_000_000).toFixed(0)}M` : ""} · verified after the official project identity was restored.`,
    source: "defillama",
    tone: "warn",
  });
}

// ── Phase 3.5: adverse-signal sweep, manipulation-tooling flag, cross-project
//    overlap ("the Venn"). This is the playbook's core: for the subject AND every
//    project/associate discovered, hunt real rug/scam/drain complaints; flag a
//    founder who BUILDS the means to manipulate; and surface people who recur
//    across the ventures. Findings feed the engine's existing fraud/manipulation
//    hooks (InvestigatorCallout / DeceptionFinding / manipulation_service_flag),
//    so a confirmed pattern actually moves the verdict, not just the narrative. ──
const handleFrom = (s?: string | null): string | undefined =>
  s?.match(/@([A-Za-z0-9_]{2,30})/)?.[1];

// Grok is discovery, not corroboration. A URL it returns is one candidate
// artifact, never proof that the page exists or supports the claim. These rows
// remain model leads until a deterministic collector fetches and verifies them;
// the engine explicitly excludes model leads from every hard cap.
export function adverseSignalToFinding(sig: AdverseSignal): Finding {
  const hasCandidateArtifact = !!sig.source_url;
  return {
    finding_type: "AdverseLead",
    claim: `${sig.target_entity_key} (${sig.category.replace(/_/g, " ")} lead): ${sig.claim}`,
    source_url: sig.source_url ?? "",
    source_date: "",
    source_author: sig.source,
    // A model-returned URL is a candidate to fetch, not a verified report about
    // the subject. Keep the trust label honest until a deterministic collector
    // retrieves the page and confirms that it supports the claim.
    verification_status: "Rumor",
    independent_source_count: hasCandidateArtifact ? 1 : 0,
    polarity: -1,
    evidence_origin: "model_lead" as const,
    artifact_verified: false,
    finding_scope: {
      scope: sig.relationship_to_subject === "self" ? "direct_subject" : "related_entity",
      target_entity_key: sig.target_entity_key,
      target_entity_type: sig.target_entity_type,
      relationship_to_subject: sig.relationship_to_subject,
      relationship_label: sig.relationship_label,
    },
  };
}

/**
 * The sweep answers a decision question ("is anyone accusing this subject of
 * taking their money?"), so it must record a checklist OUTCOME, not just a
 * provider run: provider runs are invisible to the coverage snapshot, which is
 * how a report with no sweep at all was still publishing full clearance.
 *
 * `record` is the tracker's own recorder rather than ctx.recordCheck because
 * the adverse-screen id is not in the adapter-facing PersonCheckId union yet
 * (see ChecklistCheckId in server/checks.ts). Exported for tests.
 */
export async function adverseSignalsAndTooling(
  ctx: CollectContext,
  record: (observation: ChecklistObservation) => void,
) {
  const { evidence } = ctx;
  const self = ctx.handle.replace(/^@/, "").toLowerCase();
  // The subject's OWN token first. evidence.promotions is everything the account
  // has ever mentioned, so its first entry is whatever they happened to post
  // about: on @uniswap that is $ARB from an Arbitrum deployment announcement,
  // and the sweep screened Arbitrum while never once screening $UNI. A verified
  // projectToken is the binding this screen is supposed to be about; a promoted
  // ticker is only the fallback for a subject that has no token of its own.
  const ticker = (evidence.projectToken?.verified === true ? evidence.projectToken.symbol : null)
    ?? evidence.promotions.find((p) => p.ticker)?.ticker;

  // Targets: the subject, and the top discovered ventures (as
  // projects), each with a recoverable @handle so the search is grounded.
  const subjectKind = evidence.roles.includes(SubjectClass.PROJECT) ? "project" : "person";
  const projectTargets = evidence.ventures
    .filter((venture) => venture.artifact_verified === true && venture.evidence_origin !== "model_lead")
    .map((v) => ({
      name: v.project_name,
      role: v.role,
      handle: (v.x_handle ? v.x_handle.replace(/^@/, "") : undefined) ?? handleFrom(v.evidence_url) ?? handleFrom(v.notes),
    }))
    .filter((v) => v.handle && v.handle.toLowerCase() !== self)
    .slice(0, 4);
  const associateTargets = evidence.associates
    .filter((associate) => associate.artifact_verified === true && associate.evidence_origin !== "model_lead")
    .map((a) => ({ handle: a.associate_handle, relation: a.relation }))
    .filter((a) => a.handle && a.handle.replace(/^@/, "").toLowerCase() !== self)
    .slice(0, 4);

  ctx.emit({ phase: "Adverse", label: "Scam / rug sweep", detail: `Searching for rug, slow-rug, liquidity-pull, drain, and FUD signals across the subject${ticker ? `, $${ticker.replace(/^\$/, "")}` : ""}, ${projectTargets.length} project${projectTargets.length === 1 ? "" : "s"}, and ${associateTargets.length} associate${associateTargets.length === 1 ? "" : "s"}…`, source: "grok", tone: "neutral" });

  // All searches + the tooling probe run concurrently and time-boxed, so the
  // whole sweep costs one slow call, not the sum.
  const [tooling, subjectScreen, projectScreens, assocScreens, ventureTeams] = await Promise.all([
    detectManipulationTooling(ctx.handle, evidence.profile.display_name),
    searchAdverseSignals(ctx.handle, subjectKind, {
      relationship_to_subject: "self",
      relationship_label: "audited subject",
    }, ticker),
    Promise.all(projectTargets.map((p) => searchAdverseSignals(p.handle!, "project", {
      relationship_to_subject: "venture",
      relationship_label: [p.role, p.name].filter(Boolean).join(" at ") || p.name,
    }))),
    Promise.all(associateTargets.map((a) => searchAdverseSignals(a.handle, "person", {
      relationship_to_subject: "associate",
      relationship_label: a.relation || "recorded associate",
    }))),
    projectTargets.length >= 2
      ? Promise.all(projectTargets.map((p) => findTeam(p.handle!, p.name)))
      : Promise.resolve([] as TeamMember[][]),
  ]);

  // 1. Manipulation-tooling discovery. Grok can surface the page, but cannot
  //    verify either the page or the subject-to-product relationship. Keep the
  //    candidate visible and explicitly non-capping until a deterministic fetch
  //    produces a verified artifact.
  if (tooling?.tools.length) {
    const list = tooling.tools.map((t) => `${t.name} (${t.kind.replace(/_/g, " ")})`).join(", ");
    const candidateUrl = tooling.tools.find((t) => t.url)?.url;
    evidence.findings.push({
      finding_type: "ManipulationToolingLead",
      claim: `Model-discovered lead: subject may be connected as ${tooling.role_claim || "operator"} to manipulation tooling: ${list}.`,
      source_url: candidateUrl ?? "",
      source_date: "",
      source_author: "model-discovered candidate page",
      verification_status: candidateUrl ? "Reported" : "Rumor",
      independent_source_count: candidateUrl ? 1 : 0,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: `@${self}`,
        target_entity_type: subjectKind,
        relationship_to_subject: "self",
        relationship_label: "audited subject",
      },
    });
    for (const t of tooling.tools) {
      evidence.clientEngagements.push({
        client_name: t.name,
        service_type: `possible_manipulation_tooling:${t.kind}`,
        manipulation_service_flag: false,
        evidence_url: t.url,
        notes: [t.evidence, "model-discovered lead; relationship not independently verified"].filter(Boolean).join(" · "),
        evidence_origin: "model_lead",
        artifact_verified: false,
      });
    }
    ctx.emit({ phase: "Adverse", label: "Manipulation-tooling lead", detail: `Candidate connection surfaced for ${list}; independent artifact verification is still required before this can affect a hard cap.`, source: "grok", tone: "warn" });
  }

  // 2. Adverse discovery across every target. Every row stays a non-capping lead.
  const pushSigs = (sigs: AdverseSignal[]) => {
    for (const s of sigs) {
      evidence.findings.push(adverseSignalToFinding(s));
    }
  };
  const screens = [subjectScreen, ...projectScreens, ...assocScreens];
  let totalSigs = 0;
  for (const screen of screens) {
    pushSigs(screen.signals);
    totalSigs += screen.signals.length;
  }

  if (totalSigs) {
    const top = screens.flatMap((screen) => screen.signals)
      .slice(0, 3)
      .map((s) => `${s.relationship_to_subject} ${s.target_entity_key} · ${s.category.replace(/_/g, " ")}: ${s.claim}`)
      .join(" · ");
    ctx.emit({ phase: "Adverse", label: `${totalSigs} adverse lead${totalSigs === 1 ? "" : "s"}`, detail: `Unverified candidate sources for follow-up. ${top}`, source: "grok", tone: "warn" });
  } else {
    ctx.emit({ phase: "Adverse", label: "No adverse leads surfaced", detail: "The model search returned no candidate rug/scam/drain/FUD source URLs for follow-up; this is not proof that none exist.", source: "grok", tone: "neutral" });
  }

  // Record the sweep's outcome HERE, the moment it is known, so a later error
  // in the cross-project hop below cannot lose the answer we already paid for.
  //
  // A search that never answered is not a search that answered nothing. The
  // provider returning nothing, an unreadable answer and a genuinely empty
  // result all arrive as zero leads, and this row now completes a coverage
  // question, so publishing them alike would turn a model-search outage into
  // "swept, nothing found" and RAISE the report's clearance for it.
  const toolingLeads = tooling?.tools.length ?? 0;
  const answered = screens.filter((screen) => screen.completed).length;
  const unanswered = screens.length - answered;
  const swept = `the subject, ${projectTargets.length} project${projectTargets.length === 1 ? "" : "s"}, and ${associateTargets.length} associate${associateTargets.length === 1 ? "" : "s"}`;
  // The empty answer covers only the targets that answered, so the gap is named
  // beside it rather than left for the reader to assume away.
  const gap = unanswered
    ? ` The search did not answer for ${unanswered} of the ${screens.length} targets screened, so those are unscreened rather than clear.`
    : "";
  if (totalSigs || toolingLeads) {
    record({
      id: "adverse-screen",
      status: "finding",
      note: `Swept ${swept} for rug, slow-rug, liquidity-pull, drain, and scam reports: ${totalSigs} adverse lead${totalSigs === 1 ? "" : "s"}${toolingLeads ? ` and ${toolingLeads} manipulation-tooling lead${toolingLeads === 1 ? "" : "s"}` : ""} surfaced. Each is an unverified candidate source for follow-up, not a verified finding.${gap}`,
      provider: "adverse-sweep",
      sourceCount: totalSigs + toolingLeads,
    });
  } else if (!answered) {
    record({
      id: "adverse-screen",
      status: "unavailable",
      note: `the model search returned no readable answer for any of the ${screens.length} adverse-screen target${screens.length === 1 ? "" : "s"}, so no rug, scam, or drain search was completed`,
      provider: "adverse-sweep",
    });
  } else {
    record({
      id: "adverse-screen",
      status: "checked-empty",
      // A completed empty search is an answer; it is not a clean record.
      note: `Swept ${swept} for rug, slow-rug, liquidity-pull, drain, and scam reports: the search returned no candidate source. An empty search is not proof that no adverse record exists.${gap}`,
      provider: "adverse-sweep",
    });
  }

  // 3. Cross-project overlap ("the Venn"): second hop over the ventures' teams to
  //    find people who recur across projects. A person wired into multiple of the
  //    subject's ventures is the internal co-occurrence the playbook looks for.
  if (projectTargets.length >= 2) {
    // Feed the FULL second hop into the graph: subject → venture → each of its
    // people. These teams were already fetched for the Venn below; wiring them as
    // venture→person edges (keyed canonically) is what turns the graph from a
    // shallow star into a web, and cross-links a venture's team member to the
    // subject's associates / another audit automatically. (The Venn overlap logic
    // that follows is unchanged — it still flags people recurring across ventures.)
    ctx.evidence.ventureTeams = projectTargets.map((p, i) => ({
      key: canonicalEntityKey({ handle: p.handle, name: p.name }),
      name: p.name,
      people: (ventureTeams[i] ?? [])
        .filter((m) => (m.handle || m.name) && m.handle?.replace(/^@/, "").toLowerCase() !== self)
        .slice(0, 8)
        .map((m) => ({ name: m.name, handle: m.handle, role: m.role })),
      provider: "grok",
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    })).filter((vt) => vt.people.length > 0);
    if (ctx.evidence.ventureTeams.length) {
      const total = ctx.evidence.ventureTeams.reduce((n, vt) => n + vt.people.length, 0);
      ctx.emit({ phase: "Network", label: "Venture teams mapped", detail: `${total} people across ${ctx.evidence.ventureTeams.length} venture${ctx.evidence.ventureTeams.length === 1 ? "" : "s"} wired into the graph: subject → venture → the people behind it.`, source: "grok", tone: "good" });
    }
    const appearances = new Map<string, { name: string; projects: Set<string> }>();
    ventureTeams.forEach((team, i) => {
      for (const member of team) {
        if (!member.handle) continue;
        const key = member.handle.replace(/^@/, "").toLowerCase();
        if (key === self) continue;
        const rec = appearances.get(key) ?? { name: member.name, projects: new Set<string>() };
        rec.projects.add(projectTargets[i].name);
        appearances.set(key, rec);
      }
    });
    const overlaps = [...appearances.entries()].filter(([, r]) => r.projects.size >= 2);
    if (overlaps.length) {
      const haveAssoc = new Set(evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
      for (const [key, r] of overlaps) {
        const projList = [...r.projects].join(", ");
        if (haveAssoc.has(key)) {
          const existing = evidence.associates.find((a) => a.associate_handle.replace(/^@/, "").toLowerCase() === key);
          if (existing?.evidence_origin === "model_lead") {
            existing.notes = [existing.notes, `also on: ${projList}`].filter(Boolean).join(" · ");
          } else {
            evidence.associates.push({
              associate_handle: "@" + key,
              relation: "cross-project overlap",
              notes: `appears across ${projList}`,
              provider: "grok",
              evidence_origin: "model_lead",
              artifact_verified: false,
            });
          }
        } else {
          evidence.associates.push({
            associate_handle: "@" + key,
            relation: "cross-project overlap",
            notes: `appears across ${projList}`,
            provider: "grok",
            evidence_origin: "model_lead",
            artifact_verified: false,
          });
        }
      }
      ctx.emit({ phase: "Adverse", label: `${overlaps.length} cross-project overlap${overlaps.length === 1 ? "" : "s"}`, detail: overlaps.slice(0, 5).map(([k, r]) => `@${k} (${[...r.projects].join(", ")})`).join(" · "), source: "grok", tone: "warn" });
    }
  }
}

// ── Token lifecycle: migration / relaunch + post-relaunch dive ──
// For each promoted ticker, group same-ticker contracts into generations (a
// relaunch mints a new one) and check whether the current token launched and
// then collapsed. The collapse is observed on-chain (Verified, but NOT proof of
// fraud, so it surfaces without capping); the multi-generation migration is a
// heuristic, reported as "possible".
// Exported for tests.
export async function tokenLifecycle(ctx: CollectContext) {
  const { evidence } = ctx;
  // Same subject-class guard as the dexscreener adapter: a project account's
  // own token mentions are not KOL promotions, and a project token drawdown
  // must never charge the promotion-conduct axes (ProjectTokenDrawdown covers
  // that case as P5-only by design).
  if (evidence.roles.includes(SubjectClass.PROJECT) && !evidence.roles.includes(SubjectClass.KOL)) return;
  // ONLY analyze ticker + contract pairs. A ticker alone can't attribute
  // on-chain conduct: "$WORLD" (a common word) matches dozens of unrelated
  // copycat tokens, and blaming their collapses / counting them as "the
  // subject's contracts" is exactly the false signal that mislabels a real
  // project by ticker collision. The pair itself is still only as trustworthy
  // as the promotions row it came from; provenance is inherited below.
  const promos = evidence.promotions.filter((p) => p.ticker && p.contract_address).slice(0, 3);
  if (!promos.length) return;
  await Promise.all(
    promos.map(async (p) => {
      const sig = await detectTokenLifecycle(p.ticker, p.contract_address);
      if (!sig) return;
      // The collapse is observed on-chain, but the subject-to-contract join
      // inherits the promotion row's provenance: a model-extracted pairing is
      // never verified evidence about the subject, so it fails closed as a
      // lead (artifactIsEligible rejects model_lead rows) instead of
      // laundering into a Verified deterministic finding.
      const attributionVerified = p.evidence_origin !== "model_lead" && p.artifact_verified === true;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: sig.dive ? "finding" : "confirmed",
        note: sig.dive
          ? attributionVerified
            ? `$${sig.ticker} verified contract collapse: ${sig.dive.detail}`
            : `$${sig.ticker} promoted-contract collapse (model-extracted promotion, attribution unverified): ${sig.dive.detail}`
          : `$${sig.ticker} lifecycle lookup completed with no collapse surfaced`,
        provider: "dexscreener",
        sourceCount: 1,
      });
      if (!sig.dive) return; // dive is gated on the verified contract inside detect
      evidence.findings.push({
        finding_type: "TokenCollapse",
        claim: `$${sig.ticker} (${p.contract_address!.slice(0, 8)}…) launched and collapsed to near-zero (${sig.dive.detail}).${attributionVerified ? "" : " The claim that the subject promoted this contract is model-extracted and not yet verified."}`,
        source_url: `https://dexscreener.com/search?q=${encodeURIComponent(sig.dive.address)}`,
        source_date: "",
        source_author: "dexscreener",
        verification_status: attributionVerified ? "Verified" : "Reported",
        independent_source_count: 1,
        polarity: -1,
        evidence_origin: attributionVerified ? "deterministic" : "model_lead",
        artifact_verified: attributionVerified,
      });
      ctx.emit({ phase: "Token", label: `$${sig.ticker} collapse`, detail: `${sig.dive.detail}. The dive-after-launch pattern.`, source: "dexscreener", tone: "bad" });
    }),
  );
}

// ── Post cadence: is the account whittling down or going silent? ──
// A team going quiet after a launch is a disappearing-act / soft-rug tell. Pulls
// timestamped posts and runs the pure analyzer; a decaying or silent cadence
// surfaces as a finding (observed, non-capping).
async function postCadence(ctx: CollectContext) {
  const posts = await getRecentPostsMeta(ctx.handle);
  const report = analyzeCadence(posts, Date.now());
  if (!report) return;
  ctx.recordCheck?.({
    id: "project-traction-liveness",
    status: report.silent || report.decaying ? "finding" : "confirmed",
    note: report.summary,
    provider: "twitterapi.io",
    sourceCount: posts.length,
  });
  if (report.silent || report.decaying) {
    ctx.evidence.findings.push({
      finding_type: "CadenceDecay",
      claim: `@${ctx.handle.replace(/^@/, "")}: ${report.summary}`,
      source_url: "",
      source_date: "",
      source_author: "twitterapi.io",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
    });
    ctx.emit({ phase: "Cadence", label: report.silent ? "Went quiet" : "Cadence thinning", detail: report.summary, source: "twitterapi.io", tone: report.silent ? "bad" : "warn" });
  } else {
    ctx.emit({ phase: "Cadence", label: "Posting steady", detail: report.summary, source: "twitterapi.io", tone: "neutral" });
  }
}

const fixtureDiscoveryNote = (existing: string | null | undefined, claims: string[]): string => [
  existing?.trim(),
  claims.length
    ? `Fixture discovery claim (unverified; requires a fresh provider re-check): ${claims.join("; ")}`
    : "Fixture discovery claim (unverified; requires a fresh provider re-check).",
].filter(Boolean).join(" · ");

/**
 * Curated fixtures are useful claim seeds, but none of their recorded outcomes
 * may cross into a live run as current evidence. Preserve only the identifiers
 * adapters need for a fresh lookup and demote every verification/cap predicate
 * to an explicitly unverified discovery claim.
 */
export function downgradeFixtureEvidenceForLive(seed: CollectedEvidence): CollectedEvidence {
  const handleLabel = seed.profile.handle.replace(/^@/, "") || "unknown";
  return {
    ...seed,
    roles: [],
    profile: {
      // A fixture profile is also a claim seed. Mutable public metadata and
      // resolved identity fields must be recollected; otherwise an unrelated
      // configured provider could make stale fixture identity look current.
      handle: seed.profile.handle,
      display_name: handleLabel,
      avatar: handleLabel.slice(0, 1).toUpperCase(),
      bio: "",
      followers: "N/A",
      joined: "N/A",
      identity_confidence: "Unverified",
      identity_note: "Fixture discovery seed only; identity requires a fresh provider re-check.",
      profile_collection_state: "unavailable",
      profile_provider: "twitterapi",
    },
    axes: [],
    headline: "",
    ventures: seed.ventures.map((venture) => ({
      ...venture,
      outcome: VentureOutcome.UNKNOWN,
      acquirer: null,
      deal_type: null,
      deal_value_usd: null,
      investors: [],
      current_backers: [],
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(venture.notes, [
        venture.outcome !== VentureOutcome.UNKNOWN ? `claimed outcome ${venture.outcome}` : "",
        venture.acquirer ? `claimed acquirer ${venture.acquirer}` : "",
        venture.investors?.length ? `claimed investors ${venture.investors.join(", ")}` : "",
        venture.current_backers?.length ? `claimed current backers ${venture.current_backers.join(", ")}` : "",
      ].filter(Boolean)),
    })),
    testimonials: seed.testimonials.map((testimonial) => ({
      ...testimonial,
      public_acknowledgment: null,
      follows_subject: null,
      relationship_corroborated: null,
      sentiment: null,
      fud_present: false,
      corroboration_verdict: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(testimonial.notes, [
        testimonial.public_acknowledgment ? `claimed acknowledgment ${testimonial.public_acknowledgment}` : "",
        testimonial.relationship_corroborated ? "claimed relationship corroboration" : "",
        testimonial.follows_subject === true ? "claimed follow" : testimonial.follows_subject === false ? "claimed no follow" : "",
        testimonial.sentiment ? `claimed sentiment ${testimonial.sentiment}` : "",
      ].filter(Boolean)),
    })),
    advised: seed.advised.map((project) => ({
      ...project,
      public_acknowledgment: null,
      follows_subject: null,
      relationship_corroborated: null,
      sentiment: null,
      fud_present: false,
      corroboration_verdict: undefined,
      project_outcome: VentureOutcome.UNKNOWN,
      paid_or_allocated: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(project.notes, [
        project.public_acknowledgment ? `claimed acknowledgment ${project.public_acknowledgment}` : "",
        project.relationship_corroborated ? "claimed relationship corroboration" : "",
        project.project_outcome && project.project_outcome !== VentureOutcome.UNKNOWN
          ? `claimed project outcome ${project.project_outcome}`
          : "",
        project.paid_or_allocated ? "claimed paid role or allocation" : "",
      ].filter(Boolean)),
    })),
    wallets: seed.wallets.map((wallet) => ({
      ...wallet,
      link_tier: "Inferred",
      activity_summary: undefined,
      sold_into_own_promo: undefined,
      scam_adjacent_flow: undefined,
      positive_signals: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(wallet.notes, [
        wallet.link_tier ? `claimed attribution ${wallet.link_tier}` : "",
        wallet.sold_into_own_promo ? "claimed sale into own promotion" : "",
        wallet.scam_adjacent_flow ? "claimed scam-adjacent flow" : "",
      ].filter(Boolean)),
    })),
    promotions: seed.promotions.map((promotion) => ({
      ...promotion,
      paid_promo: undefined,
      outcome_was_rug: undefined,
      perf_current: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(promotion.notes, [
        promotion.paid_promo ? "claimed paid promotion" : "",
        promotion.outcome_was_rug ? "claimed rug outcome" : "",
      ].filter(Boolean)),
    })),
    clientEngagements: seed.clientEngagements.map((engagement) => ({
      ...engagement,
      client_outcome: VentureOutcome.UNKNOWN,
      manipulation_service_flag: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(engagement.notes, [
        engagement.client_outcome && engagement.client_outcome !== VentureOutcome.UNKNOWN
          ? `claimed client outcome ${engagement.client_outcome}`
          : "",
        engagement.manipulation_service_flag ? "claimed manipulation service" : "",
      ].filter(Boolean)),
    })),
    findings: [
      ...seed.findings.map((finding) => ({
        ...finding,
        verification_status: "Rumor",
        independent_source_count: 0,
        evidence_origin: "model_lead" as const,
        artifact_verified: false,
        content_hash: undefined,
        trust_graph: undefined,
      })),
      ...seed.roles.map((role) => ({
        finding_type: "RoleCandidate",
        claim: `Fixture discovery suggests ${role}; provider corroboration is required before routing.`,
        source_url: "",
        source_date: "",
        source_author: "fixture-discovery",
        verification_status: "Rumor",
        independent_source_count: 0,
        polarity: 0,
        evidence_origin: "model_lead" as const,
        artifact_verified: false,
        finding_scope: {
          scope: "direct_subject" as const,
          target_entity_key: seed.profile.handle,
          target_entity_type: "person" as const,
          relationship_to_subject: "self" as const,
          relationship_label: "fixture role candidate",
        },
      })),
    ],
    // Fixture relationship and frozen-artifact collections are not wired to a
    // live re-verifier. Drop them instead of materializing stale graph edges or
    // letting old source snapshots enter a new analyst context.
    associates: [],
    recentActivity: [],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: [],
    portfolioLeads: [],
    profileAuthenticity: undefined,
    trustGraphScreen: undefined,
    evmControlReality: undefined,
    webTeam: [],
    ventureTeams: [],
    basicFacts: [],
    basicFactLeads: [],
  };
}

interface RunAuditOptions {
  organizationId?: string;
  analystDeadlineAt?: number;
  intent?: ResearchIntent;
  /** Server-derived from one frozen saved plan. Never accept these values directly from a browser. */
  authorizedResearchScope?: {
    taskIds: readonly string[];
    capabilities: readonly ResearchCapability[];
    delegates: readonly string[];
  };
  tokenAddress?: string;
  tokenChain?: string;
  tokenSymbol?: string;
}

/**
 * Monid management profiles are keyed provider records for the SAME resolved
 * company whose funding numbers already become corroborated facts; surface
 * them as verified roster members instead of dropping paid data. Answers the
 * "why isn't more of the team listed" gap without a new provider.
 */
export function mergeManagementIntoWebTeam(evidence: CollectedEvidence, emit: Emit): void {
  const enrichment = evidence.companyEnrichment;
  const officialWebsite = evidence.projectToken?.homepage
    ?? canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl;
  if (!enrichment || !companyEnrichmentMatchesOfficialDomain(enrichment, officialWebsite)) {
    if (evidence.companyEnrichment?.management?.length) {
      emit({
        phase: "Team",
        label: "Leadership match rejected",
        detail: `Monid returned ${evidence.companyEnrichment.name}, but its company website did not match the project's verified official domain. Its people were excluded.`,
        source: "monid",
        tone: "warn",
      });
    }
    return;
  }
  const management = enrichment.management ?? [];
  if (!management.length) return;
  const webTeam = evidence.webTeam ?? (evidence.webTeam = []);
  const norm = (value?: string | null) => (value ?? "").trim().toLowerCase().replace(/^@/, "");
  let added = 0;
  let corroborated = 0;
  for (const person of management) {
    const name = person.name?.trim();
    if (!name) continue;
    const existing = webTeam.find((member) => norm(member.name) === norm(name));
    if (existing) {
      if (!existing.linkedin && person.linkedin) {
        existing.linkedin = person.linkedin;
        existing.identity_link_evidence_origin = "deterministic";
      }
      if ((!existing.role || /^team$/i.test(existing.role)) && person.title) existing.role = person.title;
      if (existing.artifact_verified !== true) {
        existing.evidence_origin = "deterministic";
        existing.artifact_verified = true;
        existing.provider = "monid";
        corroborated += 1;
      }
      continue;
    }
    webTeam.push({
      name,
      role: person.title?.trim() || "leadership",
      linkedin: person.linkedin ?? undefined,
      evidence: person.priorCompanies?.length ? `prior: ${person.priorCompanies.slice(0, 3).join(", ")}` : undefined,
      source: "Monid/Akta leadership record",
      sourceUrl: enrichment.sourceUrl,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "monid",
      identity_link_evidence_origin: "deterministic",
      projects_evidence_origin: "deterministic",
    });
    added += 1;
  }
  if (added || corroborated) {
    emit({
      phase: "P1 · Team",
      label: "Leadership roster from private-market data",
      detail: `${added} leadership profile${added === 1 ? "" : "s"} added${corroborated ? ` and ${corroborated} existing member${corroborated === 1 ? "" : "s"} corroborated` : ""} from the Monid/Akta management record.`,
      source: "monid",
      tone: "good",
    });
  }
}

async function runAuditWithLedger(rawHandle: string, emit: Emit, options?: RunAuditOptions): Promise<Dossier | null> {
  const runtimeStartedAt = Date.now();
  const authorizedCapabilities = options?.authorizedResearchScope?.capabilities;
  const authorizedCapabilitySet = authorizedCapabilities ? new Set(authorizedCapabilities) : null;
  const capabilityIsAuthorized = (...capabilities: ResearchCapability[]): boolean =>
    !authorizedCapabilitySet || capabilities.some((capability) => authorizedCapabilitySet.has(capability));
  const authorizedDelegates = options?.authorizedResearchScope
    ? new Set(options.authorizedResearchScope.delegates)
    : null;
  const adapterDelegates: Record<string, readonly string[]> = {
    x: ["x-profile", "twitterapi", "official-x"],
    github: ["github"],
    peopledatalabs: ["peopledatalabs"],
    "offchain-diligence": ["official-domain", "public-web", "independent-web", "adverse-search", "courtlistener", "opensanctions"],
    dexscreener: ["dexscreener"],
    coingecko: ["coingecko"],
    onchain: ["direct-chain-rpc", "wallet-graph"],
    "basic-facts": ["basic-facts"],
  };
  const adapterIsAuthorized = (adapter: Adapter): boolean => !authorizedDelegates
    || (adapterDelegates[adapter.id] ?? []).some((delegate) => authorizedDelegates.has(delegate));
  // The DeFiLlama reader coalesces reads of the same URL for a short window so
  // one protocol document is not pulled three times per scan. That window is
  // already far shorter than a scan, but a warm serverless container can start
  // the next subject inside it, so the real scan boundary is made explicit
  // here: a document can never carry from one subject's audit into another's.
  resetDefiLlamaScanMemo();
  // Same boundary, same reason: the follow answers belong to one subject's scan.
  resetFollowScanMemo();
  // Single source of truth for the analyst start-by deadline (the route passes
  // it; fall back to the same formula for direct/test callers). Collection must
  // stop launching new provider work COLLECTION_ANALYST_RESERVE_MS before it, so
  // the analyst + finalization + persistence always fit inside the function
  // ceiling. collectionOverBudget() is checked before each adapter/pass rather
  // than mid-run, so no in-flight adapter is abandoned while it mutates evidence.
  const analystDeadlineAt = options?.analystDeadlineAt
    ?? runtimeStartedAt + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000 - ANALYST_FINALIZATION_RESERVE_MS;
  const collectionDeadlineAt = analystDeadlineAt - COLLECTION_ANALYST_RESERVE_MS;
  const collectionOverBudget = () => Date.now() >= collectionDeadlineAt;
  // The never-waive trust-graph screen runs AFTER general collection stops, in a
  // dedicated window carved from the reserve. General adapters halt at
  // collectionDeadlineAt; the bounded graph screen may still run until here, so a
  // high-connectivity subject's flagged-subject screen is recorded instead of
  // skipped. Still leaves ANALYST_SCORING_TIMEOUT_MS before analystDeadlineAt.
  const graphScreenDeadlineAt = collectionDeadlineAt + TRUST_GRAPH_SCREEN_RESERVE_MS;
  const graphScreenOverBudget = () => Date.now() >= graphScreenDeadlineAt;
  const startRuntimeStage = (stage: string) => {
    const stageStartedAt = Date.now();
    console.info("[audit-runtime]", JSON.stringify({
      stage,
      state: "started",
      elapsedMs: stageStartedAt - runtimeStartedAt,
    }));
    return stageStartedAt;
  };
  const finishRuntimeStage = (stage: string, stageStartedAt: number) => {
    console.info("[audit-runtime]", JSON.stringify({
      stage,
      state: "complete",
      stageMs: Date.now() - stageStartedAt,
      elapsedMs: Date.now() - runtimeStartedAt,
    }));
  };
  const fixture = findSubject(rawHandle);
  const seededEvidence = fixture ? toEvidence(fixture) : null;
  const liveSeedEvidence = seededEvidence ? downgradeFixtureEvidenceForLive(seededEvidence) : null;
  const liveProviders = ADAPTERS.filter((adapter) =>
    adapterIsAuthorized(adapter)
    &&
    KEYED.has(adapter.id)
    && adapter.available()
    && (!liveSeedEvidence || !adapter.applicable || adapter.applicable(liveSeedEvidence)),
  );
  const anyLive = liveProviders.length > 0 || analystAvailable();

  // ── Pure fixture fallback: replay the curated trace, return curated dossier ──
  if (fixture && !anyLive) {
    for (const step of fixture.trace) {
      emit(step);
      await delay(420 + Math.random() * 360);
    }
    await delay(500);
    const dossier = assembleDossier(seededEvidence!, false);
    dossier.checkRuns = personChecks({
      identityConfidence: dossier.report.identity_confidence ?? undefined,
      realName: dossier.display_name.trim().split(/\s+/).filter(Boolean).length >= 2,
      roles: dossier.report.roles ?? [],
      hasAssociates: (dossier.evidence.associates ?? []).length > 0,
    });
    dossier.completeness_state = "partial";
    dossier.providerSnapshot = { capturedAt: new Date().toISOString(), runs: [] };
    return dossier;
  }

  // ── Live pipeline ──
  const evidence: CollectedEvidence = liveSeedEvidence
    ? liveSeedEvidence
    : emptyEvidence(rawHandle);
  const checkTracker = new PersonCheckTracker();
  const adapterResults = new Map<string, AdapterRunResult>();
  emit({ phase: "P0 · Intake", label: "Resolve handle", detail: `Normalizing ${rawHandle} and opening the audit ledger.`, tone: "neutral" });

  const ctx: CollectContext = {
    handle: evidence.profile.handle,
    organizationId: options?.organizationId,
    evidence,
    emit,
    recordCheck: (observation) => checkTracker.record(observation),
    ...(options?.tokenAddress && options?.tokenChain
      ? {
          tokenAddress: options.tokenAddress,
          tokenChain: options.tokenChain,
          ...(options.tokenSymbol ? { tokenSymbol: options.tokenSymbol } : {}),
        }
      : {}),
  };

  const organizationSafetyPass = async (): Promise<void> => {
    const institutionalOrganization = isOrganizationAccount(evidence)
      && evidence.roles.some((role) => role === SubjectClass.INVESTOR || role === SubjectClass.AGENCY);
    if (!institutionalOrganization) return;

    const entity = strictOrganizationLegalEntity(evidence);
    if (!entity) {
      checkTracker.record({
        id: "organization-registration",
        status: "unavailable",
        note: "no single strict direct-subject legal_entity fact bound the organization to an exact legal name, so organization registration remains unresolved",
        provider: "basic-facts:legal-entity",
      });
      checkTracker.record({
        id: "organization-sanctions",
        status: "unavailable",
        note: "an exact legal entity was not bound, so no organization OFAC query was allowed",
        provider: "opensanctions",
      });
      checkTracker.provider(
        "organization-entity-safety",
        "Organization legal identity and OFAC",
        "partial",
        "no strict exact legal-entity fact; sanctions query withheld",
      );
      return;
    }

    checkTracker.record({
      id: "organization-registration",
      status: "confirmed",
      note: `a strict fetched legal_entity passage binds the audited organization to ${entity.name}`,
      provider: "basic-facts:legal-entity",
      sourceCount: entity.sourceCount,
    });
    if (collectionOverBudget()) {
      checkTracker.record({
        id: "organization-sanctions",
        status: "unavailable",
        note: `the exact legal entity ${entity.name} was bound, but collection time expired before its OFAC entity screen could run`,
        provider: "opensanctions",
      });
      checkTracker.provider(
        "organization-entity-safety",
        "Organization legal identity and OFAC",
        "skipped",
        `legal entity bound to ${entity.name}; OFAC screen skipped at collection deadline`,
      );
      return;
    }

    try {
      const result = await screenOrganizationSanctions(ctx, entity.name);
      checkTracker.provider(
        "organization-entity-safety",
        "Organization legal identity and OFAC",
        result.state === "executed" ? "executed" : result.state,
        result.detail,
      );
      emit({
        phase: "Off-chain",
        label: "Organization legal identity and OFAC",
        detail: result.detail ?? `Exact legal-entity screen completed for ${entity.name}.`,
        source: "basic-facts · opensanctions",
        tone: result.state === "executed" ? "neutral" : "warn",
      });
    } catch (error) {
      checkTracker.record({
        id: "organization-sanctions",
        status: "unavailable",
        note: `the OFAC legal-entity screen failed before it returned a complete outcome: ${String(error)}`,
        provider: "opensanctions",
      });
      checkTracker.provider(
        "organization-entity-safety",
        "Organization legal identity and OFAC",
        "failed",
        String(error),
      );
    }
  };

  const projectTokenPass = async () => {
    const providers = ["coingecko", "dexscreener", "geckoterminal"] as const;
    const before = attemptTotals(providers);
    try {
      const result = await collectProjectTokenIdentity(ctx);
      const recordedDrawdown = recordProjectTokenDrawdownFinding(evidence);
      if (recordedDrawdown) {
        emit({
          phase: "Token",
          label: "Canonical token drawdown",
          detail: `${evidence.projectToken?.symbol ?? "Token"} market drawdown was frozen as traction counter-evidence; it is not treated as misconduct.`,
          source: "project-token-market",
          tone: "warn",
        });
      }
      const attempts = attemptDelta(before, attemptTotals(providers));
      const state = adapterRunState(result, attempts);
      checkTracker.provider(
        "project-token",
        "Canonical project token",
        state,
        result.detail ?? `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`,
      );
    } catch (error) {
      checkTracker.provider("project-token", "Canonical project token", "failed", String(error));
      emit({ phase: "Token", label: "Project token resolution error", detail: String(error), tone: "warn" });
    }
  };

  const evmControlRealityPass = async (): Promise<void> => {
    const target = verifiedEvmControlTarget(evidence);
    if (!target) return;
    const stageStartedAt = startRuntimeStage("evm-control-reality");
    let snapshot: EvmControlRealitySnapshot;
    if (collectionOverBudget()) {
      snapshot = unavailableEvmControlSnapshot(
        target.chain,
        target.address,
        "Collection time budget reached before the direct RPC capture could start.",
      );
    } else {
      try {
        snapshot = await collectEvmControlReality(target.chain, target.address, {
          timeoutMs: EVM_CONTROL_RPC_TIMEOUT_MS,
        });
      } catch (error) {
        snapshot = unavailableEvmControlSnapshot(
          target.chain,
          target.address,
          `Direct RPC capture failed before a complete snapshot was returned: ${String(error)}`,
        );
      }
    }
    evidence.evmControlReality = snapshot;

    const ledgerMeta = `${target.chain} · ${snapshot.state} · ${snapshot.collection.rpcCalls} RPC calls`;
    if (snapshot.state === "unavailable") {
      // A failed block-consistent capture can contain successful setup reads
      // before the terminal RPC failure. The adapter retains the exact total,
      // but not a truthful per-call split once every endpoint has failed.
      for (let call = 0; call < snapshot.collection.rpcCalls; call += 1) {
        recordCall("public-evm-rpc", "control-reality", 0, ledgerMeta, "partial");
      }
    } else {
      // A returned snapshot proves the two block-capture calls and final block
      // verification succeeded on the selected endpoint. Individual bounded
      // reads preserve their own returned or rpc_error state. Any additional
      // calls came from a failed fallback attempt and remain partial rather
      // than being mislabeled as successful.
      let recordedCalls = 0;
      const envelopeCalls = Math.min(3, snapshot.collection.rpcCalls);
      for (; recordedCalls < envelopeCalls; recordedCalls += 1) {
        recordCall("public-evm-rpc", "control-reality", 0, ledgerMeta, "succeeded");
      }
      for (const receipt of snapshot.receipts) {
        if (recordedCalls >= snapshot.collection.rpcCalls) break;
        recordCall(
          "public-evm-rpc",
          "control-reality",
          0,
          ledgerMeta,
          receipt.state === "returned" ? "succeeded" : "failed",
        );
        recordedCalls += 1;
      }
      for (; recordedCalls < snapshot.collection.rpcCalls; recordedCalls += 1) {
        recordCall("public-evm-rpc", "control-reality", 0, ledgerMeta, "partial");
      }
    }

    if (snapshot.state === "observed") {
      emit({
        phase: "Control",
        label: `Contract control frozen at block ${snapshot.capture?.blockNumber ?? "unknown"}`,
        detail: `${snapshot.proxy?.indicators.length ?? 0} standard proxy indicator${snapshot.proxy?.indicators.length === 1 ? "" : "s"}, ${snapshot.authorities.length} standard authority observation${snapshot.authorities.length === 1 ? "" : "s"}. Custom permission paths remain outside this bounded read.`,
        source: "public-evm-rpc",
        tone: snapshot.proxy?.state === "conflicting_implementation_candidates" ? "warn" : "neutral",
      });
    } else if (snapshot.state === "not_contract") {
      emit({
        phase: "Control",
        label: "Canonical EVM address had no contract code",
        detail: `The verified token address had no bytecode at captured block ${snapshot.capture?.blockNumber ?? "unknown"}; no contract-control claim was inferred.`,
        source: "public-evm-rpc",
        tone: "warn",
      });
    } else {
      emit({
        phase: "Control",
        label: "Contract control capture unavailable",
        detail: snapshot.note ?? "A block-consistent public RPC capture was not available, so no contract-control claim was made.",
        source: "public-evm-rpc",
        tone: "warn",
      });
    }
    finishRuntimeStage("evm-control-reality", stageStartedAt);
  };

  // Resolve the provider-backed profile, then bind an official token before the
  // rest of intake. This lets a slogan-only project account inherit an exact
  // identity-bound market-registry homepage before team, product, docs, and
  // site discovery begin.
  if (!fixture) {
    const stageStartedAt = startRuntimeStage("cold-intake");
    await resolveProfile(ctx);
    if (capabilityIsAuthorized("token_and_market", "project_fundamentals")) {
      await projectTokenPass();
    }
    // Provider-backed backing/traction enrichment for a verified project token:
    // DeFiLlama TVL + funding (free), with a Monid/Akta private-company fallback
    // for funding + founder identity only when the free funding source is empty
    // (cost control — Monid enrichment is metered). Additive and never-throws;
    // feeds P4 (backing/partners) and P5 (traction) so an established project is
    // no longer published INCOMPLETE for a missing backing axis.
    if (evidence.projectToken?.verified && capabilityIsAuthorized("token_and_market", "project_fundamentals")) {
      const projectName = evidence.projectToken.name;
      const protocolLookupName = defiLlamaLookupName(projectName);
      try {
        const [tvlOutcome, fundingOutcome, feesOutcome, holdersOutcome, unlocksOutcome] = await Promise.all([
          collectProtocolTvl(protocolLookupName),
          collectProtocolFunding(protocolLookupName),
          collectProtocolFees(protocolLookupName),
          // Float control (free, keyless): who holds the supply, is the LP
          // locked. Answers the reader's dump/rug question for project tokens.
          evidence.projectToken.address
            ? collectHolderProfile(evidence.projectToken.chain, evidence.projectToken.address)
            : Promise.resolve({ available: false as const, note: "no canonical token address" }),
          // Upcoming unlocks (CryptoRank, dormant until keyed): the next-dump
          // schedule a buyer cannot easily assemble elsewhere.
          collectUpcomingUnlocks(
            projectName,
            evidence.projectToken.symbol,
            {
              address: evidence.projectToken.address,
              chain: evidence.projectToken.chain,
            },
          ),
        ]);
        if (holdersOutcome.available) {
          evidence.holderProfile = { ...holdersOutcome.value, capturedAt: holdersOutcome.value.sourceCapturedAt };
        }
        // CryptoRank owns this timestamp and exact source lineage. Reusing the
        // canonical token's capture time would falsely date a later vesting read.
        if (unlocksOutcome.available) evidence.tokenUnlocks = { ...unlocksOutcome.value };
        const canonicalGeckoId = evidence.projectToken.coingeckoId;
        const tvlIdentityMatched = canonicalGeckoId !== undefined
          && tvlOutcome.available
          && protocolRecordMatchesCanonicalToken(tvlOutcome.value.geckoId, canonicalGeckoId);
        const fundingIdentityMatched = canonicalGeckoId !== undefined
          && fundingOutcome.available
          && protocolRecordMatchesCanonicalToken(fundingOutcome.value.geckoId, canonicalGeckoId);
        // Slug similarity is discovery, not identity. A protocol document can
        // only lend TVL, fees, or funding to the audited project when its own
        // CoinGecko id joins the already verified canonical token.
        if (feesOutcome.available && (tvlIdentityMatched || fundingIdentityMatched)) {
          evidence.protocolFees = {
            ...feesOutcome.value,
            binding: {
              canonicalGeckoId: canonicalGeckoId!,
              protocolSlug: feesOutcome.value.slug,
              method: "matched_protocol_gecko_id",
            },
          };
        }
        if (tvlIdentityMatched) {
          evidence.protocolTvl = { ...tvlOutcome.value };
          const incidentCount = recordProtocolSecurityIncidentFindings(evidence);
          if (incidentCount > 0) {
            const newest = evidence.protocolTvl.hacks?.[0];
            emit({
              phase: "Token",
              label: `${incidentCount} protocol security incident${incidentCount === 1 ? "" : "s"} recorded`,
              detail: `${newest?.date ?? "Undated"}${newest?.amountUsd ? ` · $${(newest.amountUsd / 1_000_000).toFixed(0)}M` : ""} · frozen as verified counter-evidence, separate from misconduct.`,
              source: "defillama",
              tone: "warn",
            });
          }
          if (tvlOutcome.value.chains.length) {
            evidence.projectToken = { ...evidence.projectToken, deployedChains: tvlOutcome.value.chains };
          }
        }
        if (fundingIdentityMatched) {
          evidence.protocolFunding = { ...fundingOutcome.value };
        }
        const mismatchedProtocolSources = canonicalGeckoId ? [
          ...(tvlOutcome.available && !tvlIdentityMatched ? [`TVL (${tvlOutcome.value.geckoId ?? "no CoinGecko id"})`] : []),
          ...(fundingOutcome.available && !fundingIdentityMatched ? [`funding (${fundingOutcome.value.geckoId ?? "no CoinGecko id"})`] : []),
          ...(feesOutcome.available && !tvlIdentityMatched && !fundingIdentityMatched ? ["fees"] : []),
        ] : [];
        if (mismatchedProtocolSources.length) {
          emit({
            phase: "Token",
            label: "Protocol enrichment identity mismatch",
            detail: `${mismatchedProtocolSources.join(", ")} did not join canonical CoinGecko id ${canonicalGeckoId}; those records were excluded.`,
            source: "defillama",
            tone: "warn",
          });
        }
        // Independent audits: bounded discovery leads plus the auditor-domain
        // corroboration hop. Wall-clock boxed: up to ~6
        // bounded fetches must degrade to a skipped enrichment, never a
        // stalled audit.
        {
          const auditLinks = await collectProtocolAuditLinks(protocolLookupName);
          const auditsResult = await withWallClockBox(
            collectSecurityAudits(
              projectName,
              evidence.projectToken.homepage ?? canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl,
              auditLinks.available ? auditLinks.value.auditLinks : [],
              { canonicalContractAddress: evidence.projectToken.address },
            ),
            SECURITY_AUDITS_BUDGET_MS,
          );
          if (auditsResult?.available) {
            evidence.securityAudits = {
              securityPageUrl: auditsResult.securityPageUrl,
              selfAttested: auditsResult.selfAttested,
              attestations: auditsResult.attestations.map((attestation) => ({ ...attestation })),
              corroborated: auditsResult.corroborated.map((entry) => ({
                ...entry,
                matchedIdentityAnchor: { ...entry.matchedIdentityAnchor },
              })),
              capturedAt: auditsResult.capturedAt,
            };
            emit({
              phase: "Token",
              label: auditsResult.corroborated.length
                ? `Independent audits confirmed · ${auditsResult.corroborated.map((entry) => entry.auditor).slice(0, 3).join(", ")}`
                : "Audit leads found · confirmation pending",
              detail: auditsResult.corroborated.length
                ? `${auditsResult.corroborated.length} auditor-domain page${auditsResult.corroborated.length === 1 ? "" : "s"} carried explicit audit context plus a canonical identity anchor for ${projectName}; ${auditsResult.selfAttested.length} unverified auditor lead${auditsResult.selfAttested.length === 1 ? " came" : "s came"} from bounded subject disclosures or curated audit-link sources.`
                : `${auditsResult.selfAttested.length} unverified auditor lead${auditsResult.selfAttested.length === 1 ? " came" : "s came"} from bounded subject disclosures or curated audit-link sources; no auditor page met both the explicit audit-context and canonical identity-anchor requirements this run.`,
              source: "security-audits",
              tone: auditsResult.corroborated.length ? "good" : "neutral",
            });
          }
        }
        if (!fundingIdentityMatched) {
          // Hard wall-clock box: Monid runs poll asynchronously (1-120s) and an
          // audit already runs minutes; an over-budget enrichment must degrade
          // to a skipped path, never push the whole run past the platform
          // function budget.
          const companyLookup = evidence.projectToken.homepage
            ?? canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl;
          if (companyLookup) {
            const enrichment = await withWallClockBox(
              collectProjectCompanyEnrichment(companyLookup, {
                sections: ["funding_detail", "management_profile", "firmographic"],
                officialName: projectName,
              }),
              MONID_ENRICHMENT_BUDGET_MS,
            );
            if (enrichment?.available && companyEnrichmentMatchesOfficialDomain(enrichment.value, companyLookup)) {
              evidence.companyEnrichment = { ...enrichment.value };
              mergeManagementIntoWebTeam(evidence, emit);
            }
          }
        }
      } catch (error) {
        emit({ phase: "Token", label: "Backing enrichment error", detail: String(error), tone: "warn" });
      }
    }
    evidence.roles = providerBackedRoles(evidence);
    recordOfficialXAccountStatusFinding(evidence);
    await coldIntake(ctx, true);
    finishRuntimeStage("cold-intake", stageStartedAt);
  }

  // -- Project-token announcement: the FULL scan includes the token threat leg.
  // Resolve the subject's token as early as possible and stamp it on a step
  // (machine-readable `token` field) so the CLIENT launches the browser-side
  // threat scanner in parallel with everything below - one product, no added
  // wall-clock. The bio CA is authoritative (impersonation defense: the
  // official account states its own contract); a claimed promotion with a
  // contract is second. No match here is not terminal - the client falls back
  // to a canonical name-match after the dossier lands.
  try {
    const tokenCand = tokenFromBio(evidence.profile.bio) ?? tokenFromPromotions(evidence.promotions);
    if (tokenCand) {
      emit({
        phase: "ARGUS · Threat",
        label: "Project token resolved",
        detail: `${tokenCand.address.slice(0, 10)}… (${tokenCand.via}) via ${tokenCand.source} - the token threat scan runs in parallel with the rest of this audit.`,
        source: "argus",
        tone: "neutral",
        token: tokenCand,
      });
    }
  } catch { /* attribution is best-effort; the client can still resolve later */ }

  // The investigation director turns the resolved subject and decision intent
  // into explicit evidence questions with allowlisted specialist delegates.
  // It does not decide whether a provider succeeded and never creates facts;
  // the frozen check ledger remains the authority for every outcome.
  let researchPlan = restrictResearchPlan(
    buildResearchPlan(evidence, options?.intent ?? "investment_due_diligence"),
    authorizedCapabilities,
  );
  evidence.researchPlan = researchPlan;
  emit({
    phase: "Director",
    label: `Research plan · ${researchPlan.tasks.length} workstreams`,
    detail: researchPlan.tasks
      .filter((task) => task.priority === "critical" || task.priority === "high")
      .slice(0, 6)
      .map((task) => `${task.question} → ${task.delegates.slice(0, 3).join(", ")}`)
      .join(" · "),
    source: "argus-research-director",
    tone: "neutral",
  });

  // ── Dependency-staged adapter schedule ────────────────────────────────
  // Serial within a lane (arrows are read-after-write dependencies from the
  // adapter field maps); lanes run concurrently because they touch disjoint
  // evidence fields, disjoint check ids, disjoint external hosts, and
  // disjoint cost-ledger providers. Field ownership contract:
  //   Lane A owns profile/ventures/associates/findings/sourceArtifacts,
  //   Lane B owns promotions[].perf_current,
  //   Lane C owns wallets[].activity_summary.
  // basic-facts is the evidence sink: it runs alone after the barrier with
  // its role refresh and offchain full-name post-hook attached.
  const laneProviderRows: Array<{ id: string; label: string; state: Parameters<typeof checkTracker.provider>[2]; detail: string; observedAt: string }> = [];
  const flushLaneProviderRows = () => {
    const byId = new Map(laneProviderRows.map((row) => [row.id, row] as const));
    for (const a of ADAPTERS) {
      const row = byId.get(a.id);
      if (row) checkTracker.provider(row.id, row.label, row.state, row.detail, row.observedAt);
    }
    laneProviderRows.length = 0;
  };

  const runAdapter = async (a: Adapter): Promise<void> => {
    if (!adapterIsAuthorized(a)) {
      laneProviderRows.push({
        id: a.id,
        label: a.label,
        state: "skipped",
        detail: "outside the frozen gap-investigation authorization",
        observedAt: new Date().toISOString(),
      });
      return;
    }
    // Stop launching new provider work once the collection budget is spent, so a
    // large multi-venture/high-connectivity subject leaves time to score and
    // persist instead of running to the function ceiling. Already-running
    // adapters finish; only not-yet-started ones are skipped (no evidence race).
    if (collectionOverBudget()) {
      laneProviderRows.push({ id: a.id, label: a.label, state: "skipped", detail: "collection time budget reached; skipped to preserve scoring and persistence time", observedAt: new Date().toISOString() });
      return;
    }
    if (!a.available()) {
      laneProviderRows.push({ id: a.id, label: a.label, state: "unavailable", detail: "provider is not configured", observedAt: new Date().toISOString() });
      if (a.id === "github") {
        checkTracker.record({
          id: "code-footprint-github",
          status: "unavailable",
          note: "GitHub provider is not configured",
          provider: "github",
        });
      }
      return;
    }
    // Identity and career adapters run before Basic Facts and may establish a
    // founder or investor role that was not explicit in the original X bio.
    // Refresh the trusted role set so the research model receives the correct
    // role-aware question set and critical-gap repair plan.
    if (a.id === "basic-facts") evidence.roles = providerBackedRoles(evidence);
    const nameBeforeBasicFacts = a.id === "basic-facts" ? resolvedOffchainName(ctx) : null;
    // basic-facts runs alone post-barrier, so its historical unfiltered
    // ledger delta stays byte-identical; concurrent lanes filter by provider.
    const providers = ADAPTER_PROVIDERS[a.id];
    const stageStartedAt = startRuntimeStage(`adapter:${a.id}`);
    try {
      const before = attemptTotals(providers);
      const result = await a.run(ctx);
      if (result) adapterResults.set(a.id, result);
      const attempts = attemptDelta(before, attemptTotals(providers));
      const state = adapterRunState(result, attempts);
      const detail = result?.detail
        ?? (state === "skipped"
          ? "no applicable provider call was observed"
          : `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`);
      laneProviderRows.push({ id: a.id, label: a.label, state, detail, observedAt: new Date().toISOString() });
    } catch (e) {
      laneProviderRows.push({ id: a.id, label: a.label, state: "failed", detail: String(e), observedAt: new Date().toISOString() });
      if (a.id === "github") {
        checkTracker.record({ id: "code-footprint-github", status: "unavailable", note: `GitHub adapter failed: ${String(e)}`, provider: "github" });
      }
      emit({ phase: "Collect", label: `${a.label} error`, detail: String(e), tone: "warn" });
    }
    finishRuntimeStage(`adapter:${a.id}`, stageStartedAt);
    if (a.id === "basic-facts") {
      const resolvedName = resolvedOffchainName(ctx);
      if (resolvedName && resolvedName.toLowerCase() !== nameBeforeBasicFacts?.toLowerCase()) {
        const refreshStartedAt = startRuntimeStage("offchain-full-name-refresh");
        try {
          const refresh = await refreshResolvedNameOffchain(ctx);
          const prior = adapterResults.get("offchain-diligence");
          const states = [prior?.state, refresh.state].filter(
            (state): state is AdapterRunResult["state"] => Boolean(state && state !== "skipped"),
          );
          const failed = states.filter((state) => state === "failed").length;
          const partial = states.filter((state) => state === "partial").length;
          const state: AdapterRunResult["state"] = states.length && failed === states.length
            ? "failed"
            : failed || partial
              ? "partial"
              : "executed";
          const combined = {
            state,
            detail: [prior?.detail, refresh.detail].filter(Boolean).join("; "),
          } satisfies AdapterRunResult;
          adapterResults.set("offchain-diligence", combined);
          checkTracker.provider("offchain-diligence", offchainAdapter.label, combined.state, combined.detail);
        } catch (error) {
          checkTracker.provider("offchain-diligence", offchainAdapter.label, "partial", `full-name refresh failed: ${String(error)}`);
          emit({ phase: "Off-chain", label: "Full-name refresh error", detail: String(error), tone: "warn" });
        }
        finishRuntimeStage("offchain-full-name-refresh", refreshStartedAt);
      }
    }
  };

  const runLane = async (lane: readonly Adapter[]) => {
    // Serial chain within the lane; a run() throw is caught per-adapter
    // inside runAdapter, so the lane continues exactly like the old loop.
    for (const a of lane) await runAdapter(a);
  };

  // Instant no-deploy rollback lever and the switch for the serial/parallel
  // equivalence test.
  const lanes: ReadonlyArray<readonly Adapter[]> = env("ARGUS_SERIAL_ADAPTERS")
    ? [[...IDENTITY_LANE, ...TOKEN_LANE, ...WALLET_LANE]]
    : [IDENTITY_LANE, TOKEN_LANE, WALLET_LANE];
  const lanesStartedAt = startRuntimeStage("adapter-lanes");
  const settledLanes = await Promise.allSettled(lanes.map(runLane));
  finishRuntimeStage("adapter-lanes", lanesStartedAt);
  flushLaneProviderRows();
  // A throw from bookkeeping itself (not run(), which is caught per-adapter)
  // still fails the audit, as it did in the serial loop; it just no longer
  // strands sibling lanes mid-flight.
  const laneFailure = settledLanes.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (laneFailure) throw laneFailure.reason;

  const officialWebsiteBeforeBasicFacts = canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl ?? null;
  await runAdapter(basicFactsAdapter);
  flushLaneProviderRows();
  hydrateOfficialProjectIdentityFromFacts(evidence);
  const initialProjectCoherence = enforceProjectFactCoherence(evidence);
  if (initialProjectCoherence.rejected.length) {
    emit({
      phase: "Research",
      label: `Entity-coherence firewall rejected ${initialProjectCoherence.rejected.length} fact${initialProjectCoherence.rejected.length === 1 ? "" : "s"}`,
      detail: initialProjectCoherence.rejected
        .map((entry) => `${entry.predicate}: ${entry.value}`)
        .join("; "),
      source: "entity coherence",
      tone: "warn",
    });
  }
  let rolesAfterBasicFacts = providerBackedRoles(evidence);
  evidence.roles = rolesAfterBasicFacts;
  if (rolesAfterBasicFacts.includes(SubjectClass.PROJECT)) {
    const socialStageStartedAt = startRuntimeStage("social-activity");
    evidence.socialActivity = await collectSocialActivity({
      handle: evidence.profile.handle,
      ticker: evidence.projectToken?.symbol ?? ctx.tokenSymbol,
      projectName: evidence.projectToken?.name ?? evidence.profile.display_name,
    });
    const social = evidence.socialActivity;
    emit({
      phase: "Research",
      label: social.state === "complete"
        ? "Social activity captured"
        : social.state === "partial"
          ? "Social activity partly captured"
          : "Social activity unavailable",
      detail: social.state === "complete"
        ? `${social.windows.last7Days.uniqueAccounts?.toLocaleString() ?? 0} unique public X accounts matched the project over seven days.`
        : social.note,
      source: "X API v2",
      tone: social.state === "complete" ? "neutral" : "warn",
    });
    finishRuntimeStage("social-activity", socialStageStartedAt);
  }
  // AFTER the roles are updated, never before. The hydration bails unless
  // evidence.roles already carries PROJECT, and the sparse or suspended
  // accounts it exists to rescue are exactly the ones whose PROJECT
  // classification is first established BY this basic-facts pass. Running it
  // on the stale role set made it a no-op in its own motivating case, leaving
  // the report claiming no known team while verified founder facts sat in the
  // ledger.
  hydrateProjectTeamFromVerifiedFacts(evidence);
  const revisedResearchPlan = restrictResearchPlan(
    buildResearchPlan(evidence, researchPlan.intent),
    authorizedCapabilities,
  );
  researchPlan = { ...revisedResearchPlan, createdAt: researchPlan.createdAt };
  evidence.researchPlan = researchPlan;
  emit({
    phase: "Director",
    label: `Plan revised for ${rolesAfterBasicFacts.length ? rolesAfterBasicFacts.join(", ") : "unresolved role"}`,
    detail: `${researchPlan.tasks.length} applicable workstreams; ${researchPlan.tasks.filter((task) => task.triggeredBy.length > 0).length} were raised or reprioritized by open evidence questions; ${researchPlan.tasks.filter((task) => task.blockedBy.length > 0).length} relationship searches are identity-gated. Next: ${researchPlan.nextActions[0]?.action ?? "reconcile collected evidence"}`,
    source: "argus-research-director",
    tone: rolesAfterBasicFacts.length ? "neutral" : "warn",
  });
  const officialWebsiteAfterBasicFacts = canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl ?? null;
  const recoveredProjectSite = !officialWebsiteBeforeBasicFacts
    && officialWebsiteAfterBasicFacts !== null
    && rolesAfterBasicFacts.includes(SubjectClass.PROJECT);
  if (recoveredProjectSite && capabilityIsAuthorized("official_facts", "project_fundamentals")) {
    // A suspended or provider-missing project account can only reveal its
    // official site during source verification. Re-run the two deterministic
    // website-dependent collectors now that the exact account ↔ domain binding
    // is frozen, otherwise the scan routes correctly but still omits product
    // liveness and the canonical token market record.
    const siteHost = new URL(officialWebsiteAfterBasicFacts).hostname.replace(/^www\./, "");
    evidence.roles = rolesAfterBasicFacts;
    await collectProjectSiteSubstance(ctx, siteHost);
  }
  if (rolesAfterBasicFacts.length === 0) {
    await maybeOrientSubject(ctx);
    rolesAfterBasicFacts = providerBackedRoles(evidence);
    evidence.roles = rolesAfterBasicFacts;
  }
  if (
    capabilityIsAuthorized("token_and_market", "project_fundamentals")
    && (fixture || (recoveredProjectSite && !evidence.projectToken?.verified))
  ) {
    await projectTokenPass();
    evidence.roles = providerBackedRoles(evidence);
  } else {
    evidence.roles = rolesAfterBasicFacts;
  }
  if (capabilityIsAuthorized("legal_and_adverse")) await organizationSafetyPass();
  if (
    recoveredProjectSite
    && evidence.projectToken?.verified
    && !evidence.protocolTvl
    && capabilityIsAuthorized("project_fundamentals", "legal_and_adverse")
  ) {
    try {
      await recoverProjectProtocolIncidentEvidence(ctx);
    } catch (error) {
      emit({
        phase: "Token",
        label: "Recovered protocol incident lookup failed",
        detail: String(error),
        source: "defillama",
        tone: "warn",
      });
    }
  }
  // The canonical token binding is final at this point, including the recovery
  // path for sparse or suspended project profiles. Only that verified binding
  // may select a chain and address for the fixed-block control read.
  if (capabilityIsAuthorized("people_and_control", "token_and_market")) await evmControlRealityPass();
  // The official domain may only be recovered during the basic-facts pass
  // (common for suspended or sparse X profiles). Run company leadership only
  // after that exact domain is known. Never fall back to a company-name match.
  const recoveredCompanyLookup = evidence.projectToken?.homepage
    ?? canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl;
  if (
    capabilityIsAuthorized("people_and_control", "project_fundamentals")
    &&
    !fixture
    && recoveredCompanyLookup
    && rolesAfterBasicFacts.includes(SubjectClass.PROJECT)
    && evidence.companyEnrichment?.identityMatch !== "official_domain"
  ) {
    try {
      const enrichment = await withWallClockBox(
        collectProjectCompanyEnrichment(recoveredCompanyLookup, {
          sections: ["funding_detail", "management_profile", "firmographic"],
          officialName: evidence.profile.resolved_name ?? evidence.profile.display_name,
        }),
        MONID_ENRICHMENT_BUDGET_MS,
      );
      if (enrichment?.available && companyEnrichmentMatchesOfficialDomain(enrichment.value, recoveredCompanyLookup)) {
        evidence.companyEnrichment = { ...enrichment.value };
        mergeManagementIntoWebTeam(evidence, emit);
      }
    } catch (error) {
      emit({ phase: "Team", label: "Company leadership lookup failed", detail: String(error), source: "monid", tone: "warn" });
    }
  }
  // Founder financing recall: a verified founder's primary venture usually has
  // public funding rounds (the financing record the basic-facts pass otherwise
  // reports as a critical gap). When the project-token path has not already
  // enriched a company, resolve the venture through Monid/Akta so the
  // projection can mint a source-backed venture-financing fact. Self-gated on
  // MONID_API_KEY and never-throws; skipped for fixtures so canary runs stay
  // deterministic.
  if (
    capabilityIsAuthorized("portfolio_and_outcomes", "project_fundamentals")
    && !fixture
    && !evidence.companyEnrichment
    && evidence.roles.includes(SubjectClass.FOUNDER)
  ) {
    const primaryVenture = deriveFounderVentureCandidate(evidence);
    emit({
      phase: "Founder",
      label: primaryVenture ? `Primary venture derived · ${primaryVenture.project_name}` : "No primary venture derived",
      detail: primaryVenture
        ? `Bridge keys: ${[primaryVenture.x_handle, primaryVenture.domain].filter(Boolean).join(" · ") || "none"}; used for financing enrichment and the related-asset token binding.`
        : "No verified venture row, venture-naming fact, or official-domain identity anchor agreed with a bio founder claim; the related-asset binding is skipped.",
      source: "argus-founder-assets",
      tone: primaryVenture ? "neutral" : "warn",
    });
    if (primaryVenture) {
      try {
        const enrichment = primaryVenture.domain
          ? await withWallClockBox(
              collectProjectCompanyEnrichment(primaryVenture.domain, {
                sections: ["funding_detail", "firmographic"],
                officialName: primaryVenture.project_name.trim(),
              }),
              MONID_ENRICHMENT_BUDGET_MS,
            )
          : null;
        if (enrichment?.available && companyEnrichmentMatchesOfficialDomain(enrichment.value, primaryVenture.domain)) {
          evidence.companyEnrichment = { ...enrichment.value };
        }
      } catch (error) {
        emit({ phase: "Founder", label: "Venture financing enrichment error", detail: String(error), tone: "warn" });
      }
      // Founder related-asset binding: resolve the verified venture's canonical
      // token with the same official-X / official-domain binding a project
      // audit uses, scoped to the venture's own bridge keys. This answers the
      // founder official_token question deterministically (the never-waive
      // asset-distinction screen) without granting the person a PROJECT role.
      if (!evidence.ventureToken && (primaryVenture.x_handle || primaryVenture.domain)) {
        try {
          const ventureToken = await collectVentureTokenIdentity({
            name: primaryVenture.project_name.trim(),
            ...(primaryVenture.x_handle ? { xHandle: primaryVenture.x_handle } : {}),
            ...(primaryVenture.domain ? { domain: primaryVenture.domain } : {}),
          });
          if (ventureToken) {
            evidence.ventureToken = ventureToken;
            emit({
              phase: "Founder",
              label: `Venture token resolved · $${ventureToken.symbol}`,
              detail: `${ventureToken.ventureName} matched by ${ventureToken.verification === "official_x" ? "official X account" : "official domain"}; frozen as the founder's related asset.`,
              source: "coingecko",
              tone: "good",
            });
            // Public-security half of the asset distinction: the venture
            // identity is now verified through its official X account, so the
            // US exchange registry can be screened for it. A completed empty
            // screen closes the category honestly; a name match stays open
            // for review instead of becoming a silent fact.
            const verifiedSecurity = (evidence.basicFacts ?? []).some((fact) =>
              fact.predicate === "public_security"
              && fact.artifact_verified === true
              && (fact.status === "verified" || fact.status === "corroborated"));
            const securityEntry = (evidence.basicFactQuestionLedger ?? [])
              .find((entry) => entry.predicate === "public_security");
            if (!verifiedSecurity && securityEntry && securityEntry.status === "unanswered") {
              const screen = await screenSecRegistryForNames([
                ventureToken.ventureName,
                ventureToken.name,
                primaryVenture.project_name,
              ]);
              if (screen === "empty") {
                securityEntry.providerRuns.push({ phase: "repair", provider: "sec-registry", state: "completed_empty" });
                emit({
                  phase: "Founder",
                  label: "Public-security registry screened",
                  detail: `No listed issuer for ${ventureToken.ventureName} in the US exchange registry; the security category closes as checked-empty.`,
                  source: "sec-registry",
                  tone: "neutral",
                });
              } else if (screen === "matched") {
                emit({
                  phase: "Founder",
                  label: "Public-security registry match",
                  detail: `${ventureToken.ventureName} matched a listed issuer name; the security category stays open for review.`,
                  source: "sec-registry",
                  tone: "warn",
                });
              } else {
                emit({
                  phase: "Founder",
                  label: "Public-security registry unavailable",
                  detail: "The US exchange registry could not be screened this run; the security category is unchanged.",
                  source: "sec-registry",
                  tone: "warn",
                });
              }
            }
          }
        } catch (error) {
          emit({ phase: "Founder", label: "Venture token resolution error", detail: String(error), tone: "warn" });
        }
      }
    }
  }
  projectProviderBackedBasicFacts(evidence);
  const finalProjectCoherence = enforceProjectFactCoherence(evidence);
  if (finalProjectCoherence.rejected.length) {
    emit({
      phase: "Research",
      label: `Final coherence pass rejected ${finalProjectCoherence.rejected.length} fact${finalProjectCoherence.rejected.length === 1 ? "" : "s"}`,
      detail: finalProjectCoherence.rejected
        .map((entry) => `${entry.predicate}: ${entry.value}`)
        .join("; "),
      source: "entity coherence",
      tone: "warn",
    });
  }
  projectVerifiedBasicFacts(ctx);

  // Post-discovery signal passes, all before the analyst so their findings feed
  // the scoring. Token lifecycle is keyless (DexScreener); cadence needs the
  // twitterapi key; the adverse/tooling sweep needs Grok or Claude. Each is
  // isolated so one failing never sinks the audit.
  const trackedPass = (
    id: string,
    label: string,
    providers: readonly string[],
    work: () => Promise<void>,
    onError: (error: unknown) => void,
  ) => {
    const before = attemptTotals(providers);
    return Promise.resolve().then(work).then(() => {
      const attempts = attemptDelta(before, attemptTotals(providers));
      const state = observedRunState(attempts);
      checkTracker.provider(
        id,
        label,
        state,
        state === "skipped"
          ? "no applicable provider call was observed"
          : `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`,
      );
    }).catch((error) => {
      checkTracker.provider(id, label, "failed", String(error));
      onError(error);
    });
  };
  const signalPassesStartedAt = startRuntimeStage("signal-passes");
  // Skipping the sweep is a coverage GAP, not a silent saving: the checklist
  // row has to say so, or the report reads as if the sweep finished clean.
  const recordAdverseUnavailable = (note: string) => checkTracker.record({
    id: "adverse-screen",
    status: "unavailable",
    note,
    provider: "adverse-sweep",
  });
  if (collectionOverBudget()) {
    // Over the collection budget already: skip these enrichment passes (the
    // slowest is the Grok adverse sweep) and preserve time to score + persist.
    for (const [id, label] of [
      ["token-lifecycle", "Promoted-token lifecycle"],
      ["post-cadence", "Posting cadence"],
      ["adverse-sweep", "Adverse-signal sweep"],
    ] as const) {
      checkTracker.provider(id, label, "unavailable", "collection time budget reached before this pass");
    }
    recordAdverseUnavailable("the collection time budget was reached before the adverse, scam, and rug sweep ran, so no adverse search was attempted");
    emit({ phase: "Collect", label: "Signal passes skipped", detail: "Collection time budget reached; skipping enrichment passes to leave time to score and persist a partial report.", tone: "warn" });
  } else {
    const signalPasses: Promise<void>[] = [];
    if (capabilityIsAuthorized("token_and_market")) {
      signalPasses.push(trackedPass("token-lifecycle", "Promoted-token lifecycle", ["dexscreener"], () => tokenLifecycle(ctx), (e) => {
        emit({ phase: "Token", label: "Lifecycle error", detail: String(e), tone: "warn" });
      }));
    } else {
      checkTracker.provider("token-lifecycle", "Promoted-token lifecycle", "skipped", "outside the frozen gap-investigation authorization");
    }
    if (capabilityIsAuthorized("official_facts", "counter_evidence") && env("TWITTERAPI_KEY")) {
      signalPasses.push(trackedPass("post-cadence", "Posting cadence", ["twitterapi"], () => postCadence(ctx), (e) => {
        emit({ phase: "Cadence", label: "Cadence error", detail: String(e), tone: "warn" });
      }));
    } else if (!capabilityIsAuthorized("official_facts", "counter_evidence")) {
      checkTracker.provider("post-cadence", "Posting cadence", "skipped", "outside the frozen gap-investigation authorization");
    } else {
      checkTracker.provider("post-cadence", "Posting cadence", "unavailable", "twitterapi.io provider is not configured");
    }
    if (researchPlanAllows(researchPlan, "legal_and_adverse") && (analystAvailable() || env("XAI_API_KEY"))) {
      signalPasses.push(trackedPass(
        "adverse-sweep",
        "Adverse-signal sweep",
        ["grok", "cache"],
        () => adverseSignalsAndTooling(ctx, (observation) => checkTracker.record(observation)),
        (e) => {
          // The sweep records its own completed outcome the moment it has one,
          // and a completed outcome outranks this row, so an error after that
          // point cannot downgrade an answer we already have.
          recordAdverseUnavailable(`the adverse, scam, and rug sweep failed before it completed: ${String(e)}`);
          emit({ phase: "Adverse", label: "Sweep error", detail: String(e), tone: "warn" });
        },
      ));
    } else if (!researchPlanAllows(researchPlan, "legal_and_adverse")) {
      checkTracker.provider("adverse-sweep", "Adverse-signal sweep", "skipped", `research director did not select this workstream for ${researchPlan.intent}`);
      recordAdverseUnavailable(`the research director did not select the adverse workstream for ${researchPlan.intent}; no adverse, scam, or rug search was attempted`);
    } else {
      checkTracker.provider("adverse-sweep", "Adverse-signal sweep", "unavailable", "model search provider is not configured");
      recordAdverseUnavailable("no model search provider is configured, so no adverse, scam, or rug search was attempted");
    }
    await Promise.all(signalPasses);
  }
  finishRuntimeStage("signal-passes", signalPassesStartedAt);

  // Route only from provider-backed profile/career evidence. Model-extracted
  // role candidates remain investigator-visible leads and can never select the
  // governing methodology on their own.
  evidence.roles = providerBackedRoles(evidence);
  if (evidence.roles.length) {
    emit({ phase: "P0 · Routing", label: "Classify roles", detail: `Provider-backed evidence routed to ${evidence.roles.join(", ")}.`, tone: "neutral" });
  } else {
    emit({ phase: "P0 · Routing", label: "Role unresolved", detail: "No deterministic or provider-corroborated role evidence was collected. Model role candidates remain leads; the report will publish INCOMPLETE.", tone: "warn" });
  }
  collectFounderDecisionQuestionOutcomes(ctx);

  // Project backing and disclosure outcomes are bounded reads over already
  // frozen first-party evidence. An official token binding alone is never
  // allowed to complete transparency.
  try {
    const projectOutcomes = collectProjectCoreEvidenceOutcomes(ctx, {
      transparencySearchExplicitlyEmpty: adapterResults
        .get("basic-facts")
        ?.explicitEmptyChecks
        ?.includes("project-transparency") === true,
    });
    checkTracker.provider(
      "project-core-outcomes",
      "Project backing and disclosure evidence",
      projectOutcomes.state,
      projectOutcomes.detail,
    );
  } catch (error) {
    const detail = `Project core evidence outcome scan failed: ${String(error)}`;
    checkTracker.provider("project-core-outcomes", "Project backing and disclosure evidence", "failed", detail);
    if (evidence.roles.includes(SubjectClass.PROJECT)) {
      checkTracker.record({ id: "project-backing-partners", status: "unavailable", note: detail, provider: "project-core-evidence" });
      checkTracker.record({ id: "project-transparency", status: "unavailable", note: detail, provider: "project-disclosure-collector" });
    }
  }

  // Does the leadership this project claims still claim the project back? A
  // team page records who was once listed; only the employment record shows
  // who quietly stopped listing it. Each lookup is paid, so this is bounded to
  // founders and C-level and capped at three, and it runs only when a project
  // has both a name to match and named leaders to check.
  if (
    capabilityIsAuthorized("people_and_control")
    && evidence.roles.includes(SubjectClass.PROJECT)
    && (evidence.webTeam?.length ?? 0) > 0
  ) {
    const leaderCompany = evidence.projectToken?.name?.trim() || evidence.profile.display_name.trim();
    try {
      const departures = await checkLeaderDepartures(evidence.webTeam ?? [], leaderCompany);
      const left = departures.filter((row) => row.state === "departed");
      const observation = leadershipCurrencyObservation(departures, leaderCompany);
      if (observation) {
        evidence.leaderDepartures = departures.map((row) => ({ ...row }));
        checkTracker.record(observation);
      }
      if (left.length) {
        emit({
          phase: "P1 · Team",
          label: `${left.length} named leader${left.length === 1 ? "" : "s"} no longer list this project`,
          detail: `${left[0].summary} The licensed record can lag a live profile, so confirm on the person's own page before relying on it.`,
          source: "peopledatalabs",
          tone: "warn",
        });
      }
    } catch (error) {
      checkTracker.record({
        id: "project-leadership-currency",
        status: "unavailable",
        note: `the leadership currency lookup failed before it completed: ${String(error)}`,
        provider: "peopledatalabs",
      });
      emit({ phase: "P1 · Team", label: "Leadership currency check failed", detail: String(error), source: "peopledatalabs", tone: "warn" });
    }
  }

  // Portfolio completion is source-agnostic. Crunchbase may enrich a company,
  // but company existence alone never proves that this investor backed it. Run
  // one bounded discovery + deterministic source-verification pass after the
  // provider-backed role set is known, then let that pass own the check outcome.
  if (evidence.roles.includes(SubjectClass.INVESTOR) && researchPlanAllows(researchPlan, "portfolio_and_outcomes")) {
    const portfolioStartedAt = startRuntimeStage("portfolio-verification");
    const before = attemptTotals(["grok", "cache", "portfolio-web", "twitterapi"]);
    try {
      const result = await collectPortfolioRelationships(ctx);
      const attempts = attemptDelta(before, attemptTotals(["grok", "cache", "portfolio-web", "twitterapi"]));
      const state: ProviderRunState = result.state === "skipped"
        ? "unavailable"
        : result.state === "failed" || result.state === "partial"
          ? result.state
          : observedRunState(attempts);
      checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", state, result.detail);
    } catch (error) {
      const detail = `Portfolio verification failed: ${String(error)}`;
      checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", "failed", detail);
      checkTracker.record({
        id: "vc-portfolio-track-record",
        status: "unavailable",
        note: detail,
        provider: "portfolio-web",
      });
      emit({ phase: "Investor", label: "Portfolio verification incomplete", detail, source: "portfolio-web", tone: "warn" });
    } finally {
      finishRuntimeStage("portfolio-verification", portfolioStartedAt);
    }

    // Fund scale is a separate semantic claim from portfolio membership. It
    // reuses the same bounded discovery response, but only a fetched manager,
    // regulatory, or independently corroborated amount can support I3.
    const fundScaleStartedAt = startRuntimeStage("fund-scale-verification");
    const fundScaleBefore = attemptTotals(["grok", "cache", "fund-scale-web", "twitterapi"]);
    try {
      const result = await collectFundScale(ctx);
      const attempts = attemptDelta(fundScaleBefore, attemptTotals(["grok", "cache", "fund-scale-web", "twitterapi"]));
      const state: ProviderRunState = result.state === "skipped"
        ? "unavailable"
        : result.state === "failed" || result.state === "partial"
          ? result.state
          : observedRunState(attempts);
      checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", state, result.detail);
      // A bounded search that did not find a qualifying scale claim is coverage,
      // not evidence that the fund is small or has no AUM. Keep I3 abstained
      // unless an amount passes the strict identity, metric, source, and time
      // gates in the collector.
      if (result.state !== "skipped" && result.state !== "failed") {
        const fundScaleConfirmed = ctx.evidence.sourceArtifacts.some(
          (artifact) => artifact.kind === "fund_scale" && artifact.match === "fund_scale_confirmed",
        );
        if (!fundScaleConfirmed) {
          checkTracker.record({
            id: "investor-fund-scale",
            status: result.state === "partial" ? "unavailable" : "checked-empty",
            note: "The bounded fund-scale search retained no qualifying AUM, fund close, or vehicle-size claim. This is not evidence that no amount exists and cannot support a low fund-scale score.",
            provider: "fund-scale-web",
          });
        }
      }
    } catch (error) {
      const detail = `Fund-scale verification failed: ${String(error)}`;
      checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", "failed", detail);
      emit({ phase: "Investor", label: "Fund scale incomplete", detail, source: "fund-scale-web", tone: "warn" });
    } finally {
      finishRuntimeStage("fund-scale-verification", fundScaleStartedAt);
    }
  } else {
    const directorDeselected = evidence.roles.includes(SubjectClass.INVESTOR);
    const reason = directorDeselected
      ? `research director did not select investor performance work for ${researchPlan.intent}`
      : "not a provider-backed investor/fund role";
    checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", "skipped", reason);
    checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", "skipped", reason);
    if (directorDeselected) {
      // These rows are decision-critical for an INVESTOR, and a narrower
      // research intent must NOT quietly clear them: the intent arrives from
      // the caller, so waiving the gate on it would let a query parameter buy
      // a decision-ready investor report with no track-record evidence. They
      // record the deliberate reason instead of sitting at an unexplained
      // "unknown" that reads as a collection failure.
      //
      // The reason has to be the REAL one. A live run showed this row telling
      // the reader the work was descoped by an intent that in fact dispatches
      // it; the workstream was actually held back by an unresolved identity
      // gate, which is a different fact about a different problem.
      const identityGates = researchPlan.tasks
        .filter((task) => task.capability === "portfolio_and_outcomes" || task.capability === "fund_scale")
        .flatMap((task) => task.blockedBy ?? []);
      const note = identityGates.length > 0
        ? `Portfolio and fund-scale work was held back because the subject's exact identity is not yet bound (${identityGates.length} unresolved identity gate${identityGates.length === 1 ? "" : "s"}). Relationship searches stay blocked until then so evidence cannot bind to the wrong person, and the investor track-record question remains open.`
        : `Portfolio and fund-scale work was not dispatched under the ${researchPlan.intent} research intent. This is a deliberate scope choice, not a finding about the subject, and it leaves the investor track-record question open.`;
      checkTracker.record({
        id: "vc-portfolio-track-record",
        status: "unavailable",
        note,
        provider: "argus-research-director",
      });
      checkTracker.record({
        id: "investor-fund-scale",
        status: "unavailable",
        note,
        provider: "argus-research-director",
      });
    }
  }

  // Final deterministic pre-analyst pass: join the freshly collected graph to
  // prior organization evidence, but allow only exact immutable, complete,
  // server-collected report versions to carry verdict text or govern a cap.
  // The provisional dossier is used only to materialize today's graph; its
  // score/verdict is deliberately omitted from the contribution.
  const trustGraphStartedAt = startRuntimeStage("trust-graph");
  if (graphScreenOverBudget()) {
    // Never-waive gate, but graph reconciliation (which scales with connectivity)
    // must not push the run past the ceiling. It runs in its own reserved window
    // (graphScreenDeadlineAt) past the general collection deadline, so a
    // high-connectivity subject records a real screen instead of being clipped;
    // only when even that window is exhausted do we record it unavailable so the
    // report persists as partial/not-decision-ready rather than not finishing.
    checkTracker.provider("trust-graph", "Frozen trust-graph reconciliation", "unavailable", "collection time budget reached before graph reconciliation");
    checkTracker.record({
      id: "trust-graph-connections",
      status: "unavailable",
      note: "collection time budget reached before flagged-subject graph reconciliation",
      provider: "argus-graph",
    });
    emit({ phase: "Network", label: "Trust graph skipped", detail: "Collection time budget reached; skipped graph reconciliation to leave time to score and persist a partial report.", source: "argus-graph", tone: "warn" });
  } else {
    try {
      const provisional = assembleDossier(evidence, true);
      const graphResult = await collectTrustGraph(ctx, {
        handle: provisional.handle,
        nodes: provisional.graph.nodes,
        edges: provisional.graph.edges,
        aliases: [provisional.handle],
      });
      checkTracker.provider(
        "trust-graph",
        "Frozen trust-graph reconciliation",
        graphResult.state,
        graphResult.detail,
      );
    } catch (error) {
      const detail = `Trust-graph materialization failed: ${String(error)}`;
      checkTracker.provider("trust-graph", "Frozen trust-graph reconciliation", "failed", detail);
      checkTracker.record({
        id: "trust-graph-connections",
        status: "unavailable",
        note: detail,
        provider: "argus-graph",
      });
      emit({ phase: "Network", label: "Trust graph incomplete", detail, source: "argus-graph", tone: "warn" });
    }
  }
  finishRuntimeStage("trust-graph", trustGraphStartedAt);

  // Deterministic F3 (repeat backing) assessment. Founder-only; records an
  // observable outcome so a richly-evidenced founder with no resolved venture row
  // is no longer withheld a score by this single unassessed axis. Records nothing
  // when there is no venture or company to assess, preserving honest abstention.
  const repeatBacking = assessFounderRepeatBacking(evidence);
  if (repeatBacking) {
    checkTracker.record(repeatBacking);
    emit({
      phase: "Founder",
      label: repeatBacking.status === "confirmed" ? "Repeat backing confirmed" : "Repeat backing assessed",
      detail: repeatBacking.note,
      source: "argus-analysis",
      tone: repeatBacking.status === "confirmed" ? "good" : "neutral",
    });
  }

  // Strip ARGUS's OWN analysis fields (identity_confidence/identity_note) from
  // what the LLMs see: the analyst writes identity_note fresh, and the
  // contradiction scanner must never "contradict" our metadata against itself.
  const profileForLlm: Record<string, unknown> = { ...evidence.profile };
  delete profileForLlm.identity_confidence;
  delete profileForLlm.identity_note;
  const baseEvidence = excludeScoreNeutralControlReality({
    profile: profileForLlm,
    ventures: evidence.ventures,
    testimonials: evidence.testimonials,
    advised: evidence.advised,
    promotions: evidence.promotions.map((promotion) => ({ ...promotion, provider: "twitterapi" })),
    wallets: evidence.wallets.map((wallet) => ({ ...wallet, provider: "find-wallet/onchain" })),
    clientEngagements: evidence.clientEngagements,
    associates: evidence.associates,
    // The named people behind the project (from the site + LinkedIn + X content),
    // so identity/founder scoring reflects the team we actually found.
    team: (evidence.webTeam ?? []).map((p) => ({
      name: p.name,
      handle: p.identity_link_evidence_origin === "model_lead" ? undefined : p.handle,
      role: p.role,
      linkedin: p.identity_link_evidence_origin === "model_lead" ? undefined : p.linkedin,
      source: p.source,
      sourceUrl: p.sourceUrl,
      evidence: p.evidence,
      otherProjects: p.projects_evidence_origin === "model_lead" ? undefined : p.projects,
      provider: p.provider,
      evidence_origin: p.evidence_origin,
      artifact_verified: p.artifact_verified,
    })),
    ventureTeams: evidence.ventureTeams,
    findings: evidence.findings,
    notableFollowers: evidence.notableFollowers.map((follower) => ({ ...follower, provider: "twitterapi" })),
    recentActivity: evidence.recentActivity.slice(0, 12).map((text) => ({ text, provider: "twitterapi" })),
    sourceArtifacts: evidence.sourceArtifacts,
    profileAuthenticity: evidence.profileAuthenticity,
    trustGraphScreen: evidence.trustGraphScreen,
    projectToken: evidence.projectToken,
    // The scale of the venture a founder verifiably founded is scoreable
    // evidence about them (F2/F4). It was collected and then dropped before.
    ventureToken: evidence.ventureToken,
    basicFacts: evidence.basicFacts,
    checkOutcomes: checkTracker.snapshot(evidence.roles, {
      resolvedRealName: hasResolvedRealName(ctx),
      organizationSubject: isOrganizationAccount(evidence),
    }),
    providerRuns: checkTracker.providers().runs,
    // Keep the exclusion explicit at the packet boundary. The raw fixed-block
    // receipts persist in the dossier but cannot affect v1 scoring or model
    // contradiction analysis.
    evmControlReality: evidence.evmControlReality,
  });

  // ── Phase 4 contradiction scan + axis scoring, run CONCURRENTLY (both read the
  //    same evidence) so the extra analyst call doesn't extend the critical path. ──
  const analystStartedAt = startRuntimeStage("analyst");
  if (analystAvailable()) {
    // Decision models receive a structurally isolated packet. Related-entity and
    // model-discovered leads remain visible to investigators, but are absent from
    // both the subject scorer and contradiction analyzer context.
    const requestedAxes = axisCatalog(evidence.roles);
    const evidenceJson = buildScoringEvidencePacket(baseEvidence, requestedAxes);
    const frozenAxisEvidence = extractScoringEvidenceCatalog(evidenceJson, requestedAxes);
    const projectStrengthBands = deriveProjectStrengthBands(evidenceJson, requestedAxes);
    const scoringPreflight = inspectAnalystScoringPreflight(requestedAxes, evidenceJson);
    const missingSubstantiveAxisSet = new Set(scoringPreflight.missingSubstantiveAxes);
    const scoringAxes = scoringPreflight.state === "insufficient_evidence"
      ? requestedAxes.filter(({ axis }) => !missingSubstantiveAxisSet.has(axis))
      : requestedAxes;
    const partialAxisScoring = scoringPreflight.state === "insufficient_evidence"
      && scoringAxes.length > 0;
    const scorerCanRun = scoringPreflight.state === "ready" || partialAxisScoring;
    const scoringEvidenceJson = partialAxisScoring
      ? buildScoringEvidencePacket(baseEvidence, scoringAxes)
      : evidenceJson;
    const decisionPacketUsable = scoringPreflight.state === "ready"
      || scoringPreflight.state === "insufficient_evidence";
    if (decisionPacketUsable) {
      emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions…", tone: "neutral" });
    }
    if (scorerCanRun) {
      emit({
        phase: "Analyst",
        label: partialAxisScoring ? "Score supported axes" : "Score axes",
        detail: partialAxisScoring
          ? `AI analyst scoring ${scoringAxes.length} supported decision area${scoringAxes.length === 1 ? "" : "s"}; ${scoringPreflight.missingSubstantiveAxes.length} remain unmeasured.`
          : "AI analyst scoring every axis from the collected evidence…",
        tone: partialAxisScoring ? "warn" : "neutral",
      });
    }
    if (frozenAxisEvidence.length > 0) {
      evidence.axisCitationVersion = 1;
      evidence.axisEvidenceCatalog = frozenAxisEvidence;
      if (Object.keys(projectStrengthBands).length > 0) {
        evidence.projectStrengthBands = projectStrengthBands;
      }
    }
    // The validator accepts all requested axes or none, and the collector ledger
    // must independently confirm that a fresh analyst attempt occurred.
    evidence.axes = [];
    const contradictionBefore = analystAttemptTotals(["record_contradictions"]);
    const scorerBefore = analystAttemptTotals(["record_verdict"]);
    // analystDeadlineAt is computed once at the top of the run (see above).
    const [found, verdict] = await Promise.all([
      decisionPacketUsable
        ? scanContradictions(evidence.profile.handle, evidenceJson, { deadlineAt: analystDeadlineAt })
        : Promise.resolve(null),
      scorerCanRun
        ? analyzeSubject(evidence.profile.handle, evidence.roles, scoringAxes, scoringEvidenceJson, {
            analystDeadlineAt,
          })
        : Promise.resolve(null),
    ]);
    const contradictionAttempts = attemptDelta(
      contradictionBefore,
      analystAttemptTotals(["record_contradictions"]),
    );
    const scorerAttempts = attemptDelta(
      scorerBefore,
      analystAttemptTotals(["record_verdict"]),
    );
    const contradictionObserved = contradictionAttempts.total > 0;
    const scorerObserved = scorerAttempts.total > 0;
    if (!decisionPacketUsable) {
      const detail = scoringPreflight.state === "packet_oversize"
        ? "Contradiction analysis was skipped because the bounded evidence packet could not preserve required coverage."
        : scoringPreflight.state === "no_axes"
          ? "Contradiction analysis was skipped because no provider-backed role selected a methodology."
          : scoringPreflight.state === "unsupported_axes"
            ? "Contradiction analysis was skipped because the requested methodology contains unsupported axes."
            : "Contradiction analysis was skipped because the frozen evidence catalog failed validation.";
      emit({ phase: "Contradictions", label: "Skipped", detail, tone: "warn" });
    } else if (contradictionObserved && found && found.length) {
      evidence.contradictions = found;
      const worst = found.some((c) => c.severity === "high") ? "bad" : "warn";
      emit({ phase: "Contradictions", label: `${found.length} contradiction${found.length === 1 ? "" : "s"}`, detail: found.slice(0, 3).map((c) => `${c.claim} vs ${c.conflict}`).join(" · "), source: "AI analyst", tone: worst });
    } else if (contradictionObserved && found) {
      emit({ phase: "Contradictions", label: "None found", detail: "No internal contradictions surfaced across the subject's claims and the evidence.", source: "AI analyst", tone: "good" });
    } else {
      emit({ phase: "Contradictions", label: "Incomplete", detail: "Contradiction analysis did not return a complete result.", source: "AI analyst", tone: "warn" });
    }
    if (scorerObserved && verdict) {
      evidence.axes = verdict.axes;
      evidence.headline = partialAxisScoring
        ? `Partial assessment: ARGUS scored ${verdict.axes.length} of ${requestedAxes.length} decision areas. ${scoringPreflight.missingSubstantiveAxes.map(axisLabel).join(" and ")} remain unmeasured, so ARGUS did not produce an overall score.`
        : verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({
        phase: "Analyst",
        label: partialAxisScoring ? "Partially scored" : "Scored",
        detail: partialAxisScoring
          ? `${verdict.axes.length} supported decision area${verdict.axes.length === 1 ? "" : "s"} scored; ${scoringPreflight.missingSubstantiveAxes.map(axisLabel).join(" and ")} remain unmeasured.`
          : `${verdict.axes.length} axes scored.`,
        source: "AI analyst",
        tone: partialAxisScoring ? "warn" : "good",
      });
    } else if (scoringPreflight.state === "packet_oversize") {
      evidence.headline = `Investigation incomplete: the analyst evidence packet could not preserve required coverage within ${ANALYST_EVIDENCE_MAX_CHARS.toLocaleString("en-US")} characters. No axis scores were inferred.`;
      emit({
        phase: "Analyst",
        label: "Packet budget exceeded",
        detail: "Scoring failed closed before any model call; the evidence packet was replaced by an explicit oversize marker instead of dropping required axis coverage.",
        tone: "warn",
      });
    } else if (scoringPreflight.state === "no_axes") {
      evidence.headline = "Investigation incomplete: no provider-backed role selected a scoring methodology. No axis scores were inferred.";
      emit({
        phase: "Analyst",
        label: "No methodology",
        detail: "No scorer call was made because provider-backed role routing produced no methodology axes.",
        tone: "warn",
      });
    } else if (scoringPreflight.state === "unsupported_axes") {
      const unsupportedAxes = scoringPreflight.unsupportedAxes.join(", ");
      evidence.headline = `Investigation incomplete: unsupported methodology axes were requested (${unsupportedAxes}). No axis scores were inferred.`;
      emit({
        phase: "Analyst",
        label: "Unsupported methodology",
        detail: `No scorer call was made because these axes have no deterministic evidence-routing rule: ${unsupportedAxes}.`,
        tone: "warn",
      });
    } else if (scoringPreflight.state === "insufficient_evidence") {
      const missingAxes = scoringPreflight.missingSubstantiveAxes.join(", ");
      evidence.headline = `Investigation incomplete: substantive evidence is missing for ${missingAxes}. No axis scores were inferred.`;
      emit({
        phase: "Analyst",
        label: "Coverage abstention",
        detail: `Scoring did not run because these axes lack substantive eligible evidence: ${missingAxes}. Coverage-only gaps were preserved; no zero scores were inferred.`,
        tone: "warn",
      });
    } else if (scoringPreflight.state === "invalid_catalog") {
      evidence.headline = "Investigation incomplete: the frozen analyst evidence catalog did not pass preflight validation.";
      emit({
        phase: "Analyst",
        label: "Preflight failed",
        detail: "The frozen evidence catalog was invalid, so no scorer call was made and no verdict score will be published.",
        tone: "warn",
      });
    } else if (!scorerObserved) {
      evidence.headline = "Investigation incomplete: the analyst scorer did not run within the available execution budget.";
      emit({
        phase: "Analyst",
        label: "Not run",
        detail: "Evidence preflight passed, but no scorer provider attempt was observed. No verdict score will be published.",
        tone: "warn",
      });
    } else {
      evidence.headline = "Investigation incomplete: the analyst did not return one valid score for every required axis.";
      emit({ phase: "Analyst", label: "Invalid response", detail: "The scorer response was unavailable, partial, duplicated an axis, or contained an invalid score. No verdict score will be published.", tone: "warn" });
    }
    const analystState: ProviderRunState = scoringPreflight.state === "packet_oversize"
      || scoringPreflight.state === "unsupported_axes"
      || scoringPreflight.state === "invalid_catalog"
      ? "failed"
      : !scorerCanRun || !scorerObserved
        ? "skipped"
        : verdict
          ? partialAxisScoring ? "partial" : "executed"
          : observedRunState(scorerAttempts) === "failed"
            ? "failed"
            : "partial";
    const analystDetail = scoringPreflight.state === "packet_oversize"
      ? `scoring packet exceeded the ${ANALYST_EVIDENCE_MAX_CHARS}-character structural budget while preserving required axis coverage; no scorer call made`
      : scoringPreflight.state === "no_axes"
        ? "no provider-backed methodology axes were requested; no scorer call made"
        : scoringPreflight.state === "unsupported_axes"
          ? `unsupported methodology axes: ${scoringPreflight.unsupportedAxes.join(", ")}; no scorer call made`
          : scoringPreflight.state === "insufficient_evidence"
            ? verdict
              ? `${scorerAttempts.total} observed scorer attempt${scorerAttempts.total === 1 ? "" : "s"}; scored ${verdict.axes.length} supported decision area${verdict.axes.length === 1 ? "" : "s"} and left ${scoringPreflight.missingSubstantiveAxes.map(axisLabel).join(" and ")} unmeasured`
              : `coverage preflight abstained; missing substantive evidence for ${scoringPreflight.missingSubstantiveAxes.join(", ")}; ${scoringAxes.length > 0 ? "supported-axis scorer did not return a valid result" : "no scorer call made"}`
            : scoringPreflight.state === "invalid_catalog"
              ? "scoring preflight rejected the frozen evidence or axis catalog; no scorer call made"
              : !scorerObserved
                ? "evidence preflight passed; no scorer provider attempt was observed"
                : `${scorerAttempts.total} observed scorer attempt${scorerAttempts.total === 1 ? "" : "s"}; ${verdict ? "complete axis set returned" : "axis result incomplete"}`;
    checkTracker.provider(
      "ai-analyst",
      "AI analyst",
      analystState,
      analystDetail,
    );
  } else {
    checkTracker.provider("ai-analyst", "AI analyst", "unavailable", "analyst provider is not configured");
  }
  finishRuntimeStage("analyst", analystStartedAt);

  // A report with no complete axis set is still a useful, honest artifact. The
  // engine emits INCOMPLETE with null totals instead of turning missing data into
  // an adverse score or dropping the investigation entirely.
  if (!evidence.axes.length) {
    if (!evidence.headline) evidence.headline = "Investigation incomplete: not enough validated evidence to score every required axis.";
    emit({ phase: "Finalize", label: "Incomplete", detail: "Not enough validated evidence to score every required axis; publishing an incomplete report with no verdict score.", tone: "warn" });
  }

  emit({ phase: "Finalize", label: "Govern composite", detail: "Applying caps and selecting the governing role.", tone: "neutral" });
  await delay(300);
  const cost = getCost();
  const checkScope = {
    resolvedRealName: hasResolvedRealName(ctx),
    organizationSubject: isOrganizationAccount(evidence),
  };
  const finalChecks = checkTracker.snapshot(evidence.roles, checkScope);
  const providerSnapshotAtDecision = checkTracker.providers();
  researchPlan = finalizeResearchPlan(researchPlan, finalChecks, providerSnapshotAtDecision.runs, {
    roleResolved: evidence.roles.length > 0,
    analystConclusionRecorded: evidence.axes.length > 0,
  });
  evidence.researchPlan = researchPlan;
  emit({
    phase: "Director",
    label: "Research delegation reconciled",
    detail: `${researchPlan.tasks.filter((task) => task.state === "completed").length} completed · ${researchPlan.tasks.filter((task) => task.state === "partial").length} partial · ${researchPlan.tasks.filter((task) => task.state === "unavailable").length} unavailable · ${researchPlan.tasks.filter((task) => task.state === "planned").length} still planned. Next best action: ${researchPlan.nextActions[0]?.action ?? "none; the selected plan is reconciled"}.`,
    source: "argus-research-director",
    tone: researchPlan.tasks.some((task) => task.priority === "critical" && (task.state === "unavailable" || task.state === "planned")) ? "warn" : "neutral",
  });
  const dossier = assembleDossier(evidence, cost.calls.some((line) => line.calls > 0));
  dossier.checkRuns = finalChecks;
  const checkCompleteness = checkTracker.completeness(evidence.roles, checkScope);
  // Coverage completeness and decision completeness are both required for an
  // authoritative graph contribution. A fully run collector with no valid
  // axis set is still a useful report, but it must remain partial and cannot
  // poison later trust-graph reconciliation with an INCOMPLETE verdict.
  dossier.completeness_state = dossier.report.composite_verdict === "INCOMPLETE"
    ? "partial"
    : checkCompleteness;
  // "Since last scan": one bounded read of the prior persisted outcome so a
  // repeat scan states its own delta (score/verdict/coverage movement) instead
  // of leaving the returning user to diff two frozen reports by hand.
  // Best-effort: first-ever scans and keyless local runs stay silent.
  if (options?.organizationId) {
    const prior = await readPriorOutcome(options.organizationId, evidence.profile.handle);
    if (prior) {
      const delta = describeOutcomeDelta(prior, {
        score: typeof dossier.report.governing_score === "number" ? dossier.report.governing_score : null,
        verdict: dossier.report.composite_verdict ?? null,
        completeness: dossier.completeness_state ?? null,
      });
      if (delta) {
        dossier.priorOutcome = { ...prior, delta };
        checkTracker.provider("prior-outcome", "Since last scan", "executed", delta);
        emit({ phase: "Finalize", label: "Since last scan", detail: delta, source: "argus", tone: "neutral" });
      }
    }
  }
  dossier.providerSnapshot = checkTracker.providers();
  // Attach what this run actually spent, so the report library can show it.
  dossier.cost = cost;
  // Owner policy: a failed provider fails VISIBLY. Stamp the failures into the
  // payload for the report banner and say it on screen in the live stream.
  const providerFailures = providerFailureLines(cost);
  if (providerFailures.length) {
    dossier.providerFailures = providerFailures;
    const summary = providerFailures.slice(0, 6)
      .map((line) => `${line.provider} ${line.op}${line.meta ? ` (${line.meta.slice(0, 80)})` : ""}`)
      .join(" · ");
    emit({
      phase: "Finalize",
      label: `Provider failures this run: ${providerFailures.length}`,
      detail: `${summary}${providerFallbacksEnabled() ? "" : ". Fallbacks are disabled: affected lanes completed without this provider instead of switching the spend elsewhere."}`,
      source: "argus",
      tone: "bad",
    });
  }
  emit({ phase: "Finalize", label: "Audit cost", detail: `~$${cost.usd.toFixed(2)} this audit (Grok $${cost.grokUsd.toFixed(2)} across ${cost.grokCalls} calls, ≈${cost.sources} search sources · Claude $${cost.claudeUsd.toFixed(2)} across ${cost.claudeCalls} calls).`, tone: "neutral" });
  // Knowledge base write-back: persist this audit's expensive-to-recompute
  // VERIFIED facts (identity/ventures/roles/token) so a later audit of the same
  // or an overlapping entity reuses them instead of re-paying discovery.
  // Best-effort, org-scoped, verified-only. Time-sensitive + legal signals are
  // intentionally EXCLUDED: BasicFact legal_regulatory_event, adverse findings,
  // and sanctions/legal source artifacts must all be re-screened live every run.
  if (options?.organizationId) {
    const verifiedBasicFacts = (evidence.basicFacts ?? []).filter((fact) =>
      fact.artifact_verified === true
      && (fact.status === "verified" || fact.status === "corroborated")
      && fact.predicate !== "legal_regulatory_event"
      // Provider-projection facts are regenerated fresh every run from free
      // providers; storing them only grows the row and re-injects stale
      // captures (the compounding "captured ..., captured ..." duplication).
      && fact.providerProjection !== true);
    const verifiedVentures = (evidence.ventures ?? []).filter((venture) =>
      venture.artifact_verified === true && venture.evidence_origin !== "model_lead");
    if (verifiedBasicFacts.length || verifiedVentures.length || evidence.projectToken?.verified === true) {
      void writeEntityFacts(options.organizationId, canonicalEntityKey({ handle: evidence.profile.handle }), {
        entityType: evidence.roles[0] ? String(evidence.roles[0]) : null,
        handle: evidence.profile.handle,
        displayName: evidence.profile.resolved_name || evidence.profile.display_name,
        facts: {
          schema: 1,
          basicFacts: verifiedBasicFacts,
          ventures: verifiedVentures,
          roles: evidence.roles.map((role) => String(role)),
          projectToken: evidence.projectToken?.verified ? evidence.projectToken : undefined,
        },
      });
    }
  }
  finishRuntimeStage("pipeline", runtimeStartedAt);
  return dossier;
}

export function runAudit(rawHandle: string, emit: Emit, options?: RunAuditOptions): Promise<Dossier | null> {
  return withCostLedger(() => runAuditWithLedger(rawHandle, emit, options));
}
