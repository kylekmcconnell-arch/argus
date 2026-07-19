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
import { env } from "./config";
import { assembleDossier, type Dossier } from "../src/data/dossier";
import { findSubject, toEvidence } from "../src/data/subjects";
import { emptyEvidence, type BasicFact, type WebTeamMember } from "../src/data/evidence";
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
import { getCost, withCostLedger } from "./cost";
import { PersonCheckTracker, type ProviderRunState } from "./checks";

import { xAdapter, getProfile as xProfile, getRecentPostsMeta, collectCorpus, fmtFollowers, discoverAffiliations, findTeam, findTeamOnSite, enrichTeamIdentities, scanPostsForRoles, followsSubject, handleHistory, searchAdverseSignals, detectManipulationTooling, type DiscoveredAffiliation, type AdverseSignal, type TeamMember } from "./adapters/x";
import { fetchTeamPage } from "./adapters/teampage";
import { checkSiteSubstance, type SiteSubstance } from "./adapters/sitecheck";
import { detectTokenLifecycle } from "./adapters/dexscreener";
import { analyzeCadence } from "../src/lib/cadence";
import { canonicalOfficialWebsite, canonicalPublicProfileWebsite } from "../src/lib/fundScaleEvidence";
import { personChecks } from "../src/lib/scanChecklist";
import { basicFactQuestionOutcome } from "../src/lib/basicFactQuestions";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  COLLECTION_ANALYST_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
} from "../src/lib/investigationRuntime";
import { peopledatalabsAdapter } from "./adapters/peopledatalabs";
import { githubAdapter } from "./adapters/github";
import { dexscreenerAdapter } from "./adapters/dexscreener";
import { coingeckoAdapter } from "./adapters/coingecko";
import { onchainAdapter } from "./adapters/onchain";
import { basicFactsAdapter, screenSecRegistryForNames } from "./adapters/basicFacts";
import {
  hasResolvedRealName,
  offchainAdapter,
  refreshResolvedNameOffchain,
  resolvedOffchainName,
} from "./adapters/offchain";
import { archivedAffiliation } from "./adapters/wayback";
import { resolveForHandle } from "./adapters/wallet";
import { collectTrustGraph } from "./adapters/trustgraph";
import { collectPortfolioRelationships } from "./adapters/portfolio";
import { collectFundScale } from "./adapters/fundScale";
import { collectProjectTokenIdentity, collectVentureTokenIdentity } from "./adapters/projectToken";
import { projectProviderBackedBasicFacts } from "./basicFactsProjection";
import { collectProtocolAuditLinks, collectProtocolFees, collectProtocolFunding, collectProtocolTvl } from "./adapters/defiLlama";
import { collectSecurityAudits } from "./adapters/securityAudits";
import { collectCompanyEnrichment } from "./adapters/monid";

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
const withWallClockBox = <T>(work: Promise<T>, budgetMs: number): Promise<T | null> =>
  Promise.race([
    work,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), budgetMs);
      // Do not hold the event loop open for the box itself.
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }),
  ]);

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
 * Keep the strongest source-backed row as the governing name, role, and
 * provenance, while carrying over non-governing identity links it lacks.
 */
export function coalesceTeamMembersByHandle(members: readonly WebTeamMember[]): WebTeamMember[] {
  const output: WebTeamMember[] = [];
  const indexByHandle = new Map<string, number>();
  for (const member of members) {
    const handle = member.handle?.trim().replace(/^@/, "").toLowerCase() ?? "";
    const existingIndex = handle ? indexByHandle.get(handle) : undefined;
    if (existingIndex === undefined) {
      output.push({ ...member });
      if (handle) indexByHandle.set(handle, output.length - 1);
      continue;
    }

    const existing = output[existingIndex];
    const preferred = teamEvidenceRank(member) > teamEvidenceRank(existing) ? member : existing;
    const secondary = preferred === existing ? member : existing;
    const merged: WebTeamMember = { ...preferred };
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

async function resolveProfile(ctx: CollectContext): Promise<void> {
  const prof = await xProfile(ctx.handle);
  if (prof) {
    ctx.evidence.profile.profile_collection_state = "resolved";
    ctx.evidence.profile.profile_provider = "twitterapi";
    ctx.evidence.profile.profile_captured_at = new Date().toISOString();
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
    if (prof.followers != null) ctx.evidence.profile.followers = fmtFollowers(prof.followers);
    if (prof.createdAt) {
      const d = new Date(prof.createdAt);
      if (!isNaN(d.getTime())) ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    ctx.emit({ phase: "P0 · Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle} · ${ctx.evidence.profile.followers} followers · joined ${ctx.evidence.profile.joined}`, source: "twitterapi.io", tone: "neutral" });
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

async function collectProjectSiteSubstance(ctx: CollectContext, domain: string): Promise<void> {
  if (!domain) return;
  const site = await checkSiteSubstance(domain).catch(() => null);
  if (!site) return;
  applySiteSubstanceOutcome(ctx, domain, site);
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
  const [hist, { corpus, foundWallets }] = await Promise.all([
    handleHistory(ctx.handle),
    (async () => {
      const corpus = await collectCorpus(ctx.handle);
      const foundWallets = await resolveForHandle(ctx.handle, [ctx.evidence.profile.bio, ...corpus.posts].join(" \n "));
      return { corpus, foundWallets };
    })(),
    // Site liveness is deterministic and should not disappear when the language
    // model is unavailable. Running token identity first means slogan-only project
    // accounts can supply their verified CoinGecko homepage here.
    collectProjectSiteSubstance(ctx, domain),
  ]);

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
    ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Assembled a ${posts.length}-post claim corpus (${corpus.count.originals} recent originals + ${corpus.count.searched} from keyword search over full history) to mine for self-claims.`, source: "twitterapi.io", tone: "neutral" });
  }

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
    findTeam(ctx.handle, ctx.evidence.profile.display_name, posts),
    // Run the deeper web/LinkedIn/press team search whenever we have EITHER a
    // domain or a project name — a big public project's roster lives off-X, and
    // many project accounts put no plain domain in the bio.
    domain || ctx.evidence.profile.display_name
      ? findTeamOnSite(domain, ctx.evidence.profile.display_name)
      : Promise.resolve([] as TeamMember[]),
    // Read the project's own /team page directly (Grok's summary can miss it).
    fetchTeamPage(teamDomain, ctx.evidence.profile.display_name),
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
  const [bySubject, people, siteTeam, pageTeam] = await discoveryPromise;

  // Auto-pivot team: merge everyone found across the website search, the account's
  // own X content, and a deterministic post role-word scan (founder/CEO/CTO...).
  // Named-only people are KEPT here (a real name + role is signal even with no
  // handle to audit) — this is what a plain handle audit used to drop.
  const postRoleTeam = scanPostsForRoles(posts, ctx.evidence.profile.display_name);
  const webTeam = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  // MERGE duplicates instead of dropping them: the team page gives the
  // authoritative name+role but no links; Grok gives the same person WITH their
  // @handle/LinkedIn. Keep the first occurrence and fill its missing fields from
  // later duplicates, so a page-roster name still gets its identity links.
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^@/, "");
  const byHandle = new Map<string, (typeof webTeam)[number]>();
  const byName = new Map<string, (typeof webTeam)[number]>();
  const teamCandidates = [
    ...pageTeam.map((member) => ({
      ...member,
      evidence_origin: domain ? "deterministic" as const : "model_lead" as const,
      artifact_verified: !!domain,
      provider: domain ? "team-page" : "team-page-candidate",
      identity_link_evidence_origin: domain ? "deterministic" as const : "model_lead" as const,
      projects_evidence_origin: domain ? "deterministic" as const : "model_lead" as const,
    })),
    ...siteTeam.map((member) => ({
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead" as const,
      projects_evidence_origin: "model_lead" as const,
    })),
    ...people.map((member) => ({
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead" as const,
      projects_evidence_origin: "model_lead" as const,
    })),
    ...postRoleTeam.map((member) => ({
      ...member,
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      provider: "twitterapi",
      identity_link_evidence_origin: "deterministic" as const,
      projects_evidence_origin: "deterministic" as const,
    })),
  ];
  for (const t of teamCandidates) {
    const h = t.handle ? norm(t.handle) : "";
    const n = norm(t.name);
    if (!h && !n) continue;
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
      continue;
    }
    const rec = {
      name: t.name,
      handle: t.handle,
      role: t.role,
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
    };
    webTeam.push(rec);
    if (h) byHandle.set(h, rec);
    if (n) byName.set(n, rec);
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
    || webTeam.some((t) => t.artifact_verified === true && norm(t.handle) === subj);
  if (webTeam.length && !accountVouchesTeam) {
    ctx.emit({ phase: "P1 · Team", label: "Uncorroborated team lead", detail: `Found a possible team for the name "${ctx.evidence.profile.display_name || ctx.handle}", but nothing ties THIS account to it. Its handle isn't independently matched, it links no site, and its own posts name no team. Preserved for follow-up but excluded from scoring and the trust graph.`, source: "team-search", tone: "warn" });
    for (const member of webTeam) {
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
  if (webTeam.length) {
    ctx.emit({ phase: "P1 · Team", label: "Team assembled", detail: `${webTeam.length} people behind the project: ${webTeam.slice(0, 6).map((t) => t.name + (t.handle ? ` ${t.handle}` : "")).join(", ")}${domain ? ` (site + posts)` : " (posts)"}.`, source: "team-search", tone: "good" });
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
    const backedTeam = [...(domain ? pageTeam : []), ...postRoleTeam].filter((candidate) =>
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
        try {
          if (v.domain) {
            // The archived page must name BOTH the subject AND the venture on its
            // own /team or /about page, so this is a genuine first-party team tie
            // (not a coincidental mention on a wrong or misguessed domain).
            const arch = await archivedAffiliation(v.domain, ctx.evidence.profile.display_name, v.name);
            if (arch) { corrob.push(`archived ${arch.where} page (${arch.year})`); rec.evidence_url = arch.url; archiveVerified = true; }
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
            rec.provider = "wayback";
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

/**
 * Select methodologies only from collector-owned evidence. A PROJECT label is
 * intentionally stricter than a generic bio keyword: the current X profile
 * must come from twitterapi and bind the account to a credible first-party
 * website. This makes brand accounts such as @world_xyz deterministic without
 * allowing a model-discovered role or an arbitrary shared-host URL to govern.
 */
export function providerBackedRoles(evidence: CollectedEvidence): SubjectClass[] {
  const roles = new Set<SubjectClass>();
  if (evidence.profile.profile_collection_state === "resolved" && evidence.profile.bio.trim()) {
    const profileRoles = classifySubject(evidence.profile.bio).applicable_classes;
    const providerCapturedAt = Date.parse(evidence.profile.profile_captured_at ?? "");
    const officialSite = canonicalOfficialWebsite(evidence.profile.website);
    const projectProfileVerified = evidence.profile.profile_provider === "twitterapi"
      && Number.isFinite(providerCapturedAt)
      && officialSite !== null;
    profileRoles.forEach((role) => {
      if (role !== SubjectClass.PROJECT || projectProfileVerified) roles.add(role);
    });
  }
  for (const venture of evidence.ventures) {
    if (venture.evidence_origin === "model_lead" || venture.artifact_verified !== true) continue;
    const role = (venture.role ?? "").toLowerCase();
    if (/founder|co-?founder|\bceo\b|\bcto\b|creator|owner/.test(role)) roles.add(SubjectClass.FOUNDER);
    else if (/advisor|adviser|board/.test(role)) roles.add(SubjectClass.ADVISOR);
    // Employment words outrank the investor keywords: this gate reads raw job
    // titles (PDL employment records), and "Principal Engineer" or
    // "Partnerships Lead" is staff, not the professional capital allocation
    // INVESTOR must mean. The investor terms are whole words for the same
    // reason ("Partnerships" is not "Partner"; "Capital Markets" is not a fund).
    else if (/contributor|engineer|developer|employee|manager|director|lead|role on record/.test(role)) roles.add(SubjectClass.MEMBER);
    else if (/\binvestor\b|\bpartner\b|\bprincipal\b|\bventure capital(?:ist)?\b|\bvc\b|\bgp\b/.test(role)) roles.add(SubjectClass.INVESTOR);
  }
  if (evidence.clientEngagements.some((row) => row.evidence_origin !== "model_lead" && row.artifact_verified === true)) {
    roles.add(SubjectClass.AGENCY);
  }
  if (evidence.projectToken?.verified === true) {
    roles.add(SubjectClass.PROJECT);
  }
  // A fund's brand account can use project-like language, but its governing
  // methodology remains INVESTOR unless it also ships a separately verified
  // product/token under the exact audited identity.
  if (roles.has(SubjectClass.INVESTOR) && !evidence.projectToken?.verified) {
    roles.delete(SubjectClass.PROJECT);
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
  return [...roles];
}

/**
 * Reuse source-fetched founder and executive facts in the human-readable team
 * roster. The search model only suggests candidates; every row admitted here
 * already passed an independent page fetch plus exact excerpt verification.
 */
export function projectVerifiedBasicFacts(ctx: CollectContext): void {
  if (!providerBackedRoles(ctx.evidence).includes(SubjectClass.PROJECT)) return;
  const facts = (ctx.evidence.basicFacts ?? []).filter((fact) =>
    fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated"),
  );
  if (!facts.length) return;

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
    if (
      ctx.evidence.profile.identity_confidence !== "SuspectedImpersonation"
      && ctx.evidence.profile.identity_confidence === "Unverified"
    ) {
      ctx.evidence.profile.identity_confidence = "Probable";
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
 * generic "partner" title into evidence of project backing. Transparency stays
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

  const verifiedInvestorFacts = (ctx.evidence.basicFacts ?? []).filter((fact) =>
    fact.predicate === "investor"
    && fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated"),
  );
  const backingCount = verifiedBackers.length + verifiedInvestorFacts.length;

  if (backingCount) {
    const providers = [...new Set([
      ...verifiedBackers.map((member) => member.provider!),
      ...(verifiedInvestorFacts.length ? ["basic-facts-web"] : []),
    ])];
    ctx.recordCheck?.({
      id: "project-backing-partners",
      status: "confirmed",
      note: `${backingCount} named advisor, backer, or investor record${backingCount === 1 ? " was" : "s were"} verified from fetched public evidence; funding terms and institutional investment were not inferred beyond these named records`,
      provider: providers.join("/"),
      sourceCount: verifiedBackers.length + verifiedInvestorFacts.reduce((total, fact) => total + fact.sources.length, 0),
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
        ? "assessed backing and partners across the collected first-party record (team roster, verified facts, official site): no verified financial backer, investor, or advisor appears; product partnerships require separate source verification, and model-only leads were excluded. A null result on this axis, not adverse evidence."
        : "bounded scan of up to 32 frozen first-party team and account records found no verified financial backer, investor, or advisor; product partnerships require separate source verification, and model-only leads were excluded",
      provider: "project-core-evidence",
    });
  }

  const verifiedDisclosures = (ctx.evidence.basicFacts ?? []).filter((fact) =>
    PROJECT_TRANSPARENCY_FACT_PREDICATES.has(fact.predicate)
    && fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated"),
  );
  if (verifiedDisclosures.length) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "confirmed",
      note: `${verifiedDisclosures.length} legal, governance, token-economic, repository, or security disclosure${verifiedDisclosures.length === 1 ? " was" : "s were"} verified against fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: verifiedDisclosures.reduce((total, fact) => total + fact.sources.length, 0),
    });
  } else if (options.transparencySearchExplicitlyEmpty) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "checked-empty",
      note: "bounded disclosure search completed with an explicit no-match; no source-linked legal, governance, token-economic, repository, or security disclosure candidate was returned",
      provider: "basic-facts-web",
    });
  } else {
    // Canonical token identity is not a transparency attestation. Without a
    // verified disclosure or explicit completed-empty search, the path remains
    // unavailable rather than looking checked.
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "unavailable",
      note: "no fetched governance or direct audit-report source passed verification; canonical token identity alone does not establish transparency",
      provider: "project-disclosure-collector",
    });
  }

  return {
    state: "partial",
    detail: `bounded frozen-evidence scan completed with ${backingCount} verified backing record${backingCount === 1 ? "" : "s"} and ${verifiedDisclosures.length} verified disclosure record${verifiedDisclosures.length === 1 ? "" : "s"}`,
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
  const drawdownPct = token?.history?.drawdownPct;
  const historySourceUrl = token?.history?.sourceUrl;
  if (
    !token
    || typeof drawdownPct !== "number"
    || !Number.isFinite(drawdownPct)
    || drawdownPct > -70
    || !historySourceUrl
  ) {
    return false;
  }
  if (evidence.findings.some((finding) =>
    finding.finding_type === "ProjectTokenDrawdown"
    && finding.source_url === historySourceUrl,
  )) return false;

  const timeframe = token.history!.timeframe === "hour" ? "hourly" : "daily";
  evidence.findings.push({
    finding_type: "ProjectTokenDrawdown",
    claim: `$${token.symbol} recorded a verified ${Math.abs(drawdownPct).toFixed(1)}% peak-to-latest drawdown in the captured GeckoTerminal ${timeframe} OHLCV window. CoinGecko and DexScreener established canonical token and pool context; price drawdown alone does not establish misconduct.`,
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

async function adverseSignalsAndTooling(ctx: CollectContext) {
  const { evidence } = ctx;
  const self = ctx.handle.replace(/^@/, "").toLowerCase();
  const ticker = evidence.promotions.find((p) => p.ticker)?.ticker;

  // Targets: the subject, and the top discovered ventures (as
  // projects), each with a recoverable @handle so the search is grounded.
  const subjectKind = evidence.roles.includes(SubjectClass.PROJECT) ? "project" : "person";
  const projectTargets = evidence.ventures
    .map((v) => ({
      name: v.project_name,
      role: v.role,
      handle: (v.x_handle ? v.x_handle.replace(/^@/, "") : undefined) ?? handleFrom(v.evidence_url) ?? handleFrom(v.notes),
    }))
    .filter((v) => v.handle && v.handle.toLowerCase() !== self)
    .slice(0, 4);
  const associateTargets = evidence.associates
    .map((a) => ({ handle: a.associate_handle, relation: a.relation }))
    .filter((a) => a.handle && a.handle.replace(/^@/, "").toLowerCase() !== self)
    .slice(0, 4);

  ctx.emit({ phase: "Adverse", label: "Scam / rug sweep", detail: `Searching for rug, slow-rug, liquidity-pull, drain, and FUD signals across the subject${ticker ? `, $${ticker.replace(/^\$/, "")}` : ""}, ${projectTargets.length} project${projectTargets.length === 1 ? "" : "s"}, and ${associateTargets.length} associate${associateTargets.length === 1 ? "" : "s"}…`, source: "grok", tone: "neutral" });

  // All searches + the tooling probe run concurrently and time-boxed, so the
  // whole sweep costs one slow call, not the sum.
  const [tooling, subjectSigs, projectSigs, assocSigs, ventureTeams] = await Promise.all([
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
  let totalSigs = 0;
  pushSigs(subjectSigs);
  totalSigs += subjectSigs.length;
  projectSigs.forEach((sigs) => { pushSigs(sigs); totalSigs += sigs.length; });
  assocSigs.forEach((sigs) => { pushSigs(sigs); totalSigs += sigs.length; });

  if (totalSigs) {
    const top = [...subjectSigs, ...projectSigs.flat(), ...assocSigs.flat()]
      .slice(0, 3)
      .map((s) => `${s.relationship_to_subject} ${s.target_entity_key} · ${s.category.replace(/_/g, " ")}: ${s.claim}`)
      .join(" · ");
    ctx.emit({ phase: "Adverse", label: `${totalSigs} adverse lead${totalSigs === 1 ? "" : "s"}`, detail: `Unverified candidate sources for follow-up. ${top}`, source: "grok", tone: "warn" });
  } else {
    ctx.emit({ phase: "Adverse", label: "No adverse leads surfaced", detail: "The model search returned no candidate rug/scam/drain/FUD source URLs for follow-up; this is not proof that none exist.", source: "grok", tone: "neutral" });
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
    webTeam: [],
    ventureTeams: [],
    basicFacts: [],
    basicFactLeads: [],
  };
}

interface RunAuditOptions {
  organizationId?: string;
  analystDeadlineAt?: number;
}

async function runAuditWithLedger(rawHandle: string, emit: Emit, options?: RunAuditOptions): Promise<Dossier | null> {
  const runtimeStartedAt = Date.now();
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

  // Resolve the provider-backed profile, then bind an official token before the
  // rest of intake. This lets a slogan-only project account inherit its exact
  // CoinGecko homepage before team, product, docs, and site discovery begin.
  if (!fixture) {
    const stageStartedAt = startRuntimeStage("cold-intake");
    await resolveProfile(ctx);
    await projectTokenPass();
    // Provider-backed backing/traction enrichment for a verified project token:
    // DeFiLlama TVL + funding (free), with a Monid/Akta private-company fallback
    // for funding + founder identity only when the free funding source is empty
    // (cost control — Monid enrichment is metered). Additive and never-throws;
    // feeds P4 (backing/partners) and P5 (traction) so an established project is
    // no longer published INCOMPLETE for a missing backing axis.
    if (evidence.projectToken?.verified) {
      const projectName = evidence.projectToken.name;
      const capturedAt = evidence.projectToken.capturedAt;
      try {
        const [tvlOutcome, fundingOutcome, feesOutcome] = await Promise.all([
          collectProtocolTvl(projectName),
          collectProtocolFunding(projectName),
          collectProtocolFees(projectName),
        ]);
        if (feesOutcome.available) evidence.protocolFees = { ...feesOutcome.value, capturedAt };
        if (tvlOutcome.available) {
          evidence.protocolTvl = { ...tvlOutcome.value, capturedAt };
          // Attach the protocol chain footprint to the verified token ONLY on
          // a CoinGecko-id join: a name-alike DeFiLlama entry can never lend
          // its chains to an impostor token.
          if (
            tvlOutcome.value.chains.length
            && tvlOutcome.value.geckoId
            && tvlOutcome.value.geckoId === evidence.projectToken.coingeckoId
          ) {
            evidence.projectToken = { ...evidence.projectToken, deployedChains: tvlOutcome.value.chains };
          }
        }
        if (fundingOutcome.available) evidence.protocolFunding = { ...fundingOutcome.value, capturedAt };
        // Independent audits: first-party security page plus the
        // auditor-domain corroboration hop. Wall-clock boxed: up to ~6
        // bounded fetches must degrade to a skipped enrichment, never a
        // stalled audit.
        {
          const auditLinks = await collectProtocolAuditLinks(projectName);
          const auditsResult = await withWallClockBox(
            collectSecurityAudits(
              projectName,
              evidence.projectToken.homepage ?? canonicalOfficialWebsite(evidence.profile.website)?.canonicalUrl,
              auditLinks.available ? auditLinks.value.auditLinks : [],
            ),
            SECURITY_AUDITS_BUDGET_MS,
          );
          if (auditsResult?.available) {
            evidence.securityAudits = {
              securityPageUrl: auditsResult.securityPageUrl,
              selfAttested: auditsResult.selfAttested,
              corroborated: auditsResult.corroborated,
              capturedAt: auditsResult.capturedAt,
            };
            emit({
              phase: "Token",
              label: auditsResult.corroborated.length
                ? `Independent audits confirmed · ${auditsResult.corroborated.map((entry) => entry.auditor).slice(0, 3).join(", ")}`
                : "Security page found · auditor confirmation pending",
              detail: auditsResult.corroborated.length
                ? `${auditsResult.corroborated.length} auditor${auditsResult.corroborated.length === 1 ? "" : "s"} name ${projectName} on their own sites; ${auditsResult.selfAttested.length} named on the project's security page.`
                : `${auditsResult.selfAttested.length} auditors are named on the project's own security page; none could be confirmed on an auditor's own site this run, so the claims stay research leads.`,
              source: "security-audits",
              tone: auditsResult.corroborated.length ? "good" : "neutral",
            });
          }
        }
        if (!fundingOutcome.available) {
          // Hard wall-clock box: Monid runs poll asynchronously (1-120s) and an
          // audit already runs minutes; an over-budget enrichment must degrade
          // to a skipped path, never push the whole run past the platform
          // function budget.
          const enrichment = await withWallClockBox(
            collectCompanyEnrichment(projectName, {
              sections: ["funding_detail", "management_profile", "firmographic"],
            }),
            MONID_ENRICHMENT_BUDGET_MS,
          );
          if (enrichment?.available) evidence.companyEnrichment = { ...enrichment.value, capturedAt };
        }
      } catch (error) {
        emit({ phase: "Token", label: "Backing enrichment error", detail: String(error), tone: "warn" });
      }
    }
    evidence.roles = providerBackedRoles(evidence);
    await coldIntake(ctx, true);
    finishRuntimeStage("cold-intake", stageStartedAt);
  }

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

  await runAdapter(basicFactsAdapter);
  flushLaneProviderRows();
  if (fixture) {
    await projectTokenPass();
    evidence.roles = providerBackedRoles(evidence);
  }
  // Founder financing recall: a verified founder's primary venture usually has
  // public funding rounds (the financing record the basic-facts pass otherwise
  // reports as a critical gap). When the project-token path has not already
  // enriched a company, resolve the venture through Monid/Akta so the
  // projection can mint a source-backed venture-financing fact. Self-gated on
  // MONID_API_KEY and never-throws; skipped for fixtures so canary runs stay
  // deterministic.
  if (!fixture && !evidence.companyEnrichment && evidence.roles.includes(SubjectClass.FOUNDER)) {
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
        const enrichment = await withWallClockBox(
          collectCompanyEnrichment(primaryVenture.project_name.trim(), {
            sections: ["funding_detail", "firmographic"],
          }),
          MONID_ENRICHMENT_BUDGET_MS,
        );
        if (enrichment?.available) {
          evidence.companyEnrichment = { ...enrichment.value, capturedAt: new Date().toISOString() };
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
    emit({ phase: "Collect", label: "Signal passes skipped", detail: "Collection time budget reached; skipping enrichment passes to leave time to score and persist a partial report.", tone: "warn" });
  } else {
    const signalPasses: Promise<void>[] = [
      trackedPass("token-lifecycle", "Promoted-token lifecycle", ["dexscreener"], () => tokenLifecycle(ctx), (e) => {
        emit({ phase: "Token", label: "Lifecycle error", detail: String(e), tone: "warn" });
      }),
    ];
    if (env("TWITTERAPI_KEY")) {
      signalPasses.push(trackedPass("post-cadence", "Posting cadence", ["twitterapi"], () => postCadence(ctx), (e) => {
        emit({ phase: "Cadence", label: "Cadence error", detail: String(e), tone: "warn" });
      }));
    } else {
      checkTracker.provider("post-cadence", "Posting cadence", "unavailable", "twitterapi.io provider is not configured");
    }
    if (analystAvailable() || env("XAI_API_KEY")) {
      signalPasses.push(trackedPass("adverse-sweep", "Adverse-signal sweep", ["grok", "cache"], () => adverseSignalsAndTooling(ctx), (e) => {
        emit({ phase: "Adverse", label: "Sweep error", detail: String(e), tone: "warn" });
      }));
    } else {
      checkTracker.provider("adverse-sweep", "Adverse-signal sweep", "unavailable", "model search provider is not configured");
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

  // Portfolio completion is source-agnostic. Crunchbase may enrich a company,
  // but company existence alone never proves that this investor backed it. Run
  // one bounded discovery + deterministic source-verification pass after the
  // provider-backed role set is known, then let that pass own the check outcome.
  if (evidence.roles.includes(SubjectClass.INVESTOR)) {
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
    } catch (error) {
      const detail = `Fund-scale verification failed: ${String(error)}`;
      checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", "failed", detail);
      emit({ phase: "Investor", label: "Fund scale incomplete", detail, source: "fund-scale-web", tone: "warn" });
    } finally {
      finishRuntimeStage("fund-scale-verification", fundScaleStartedAt);
    }
  } else {
    checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", "skipped", "not a provider-backed investor/fund role");
    checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", "skipped", "not a provider-backed investor/fund role");
  }

  // Final deterministic pre-analyst pass: join the freshly collected graph to
  // prior organization evidence, but allow only exact immutable, complete,
  // server-collected report versions to carry verdict text or govern a cap.
  // The provisional dossier is used only to materialize today's graph; its
  // score/verdict is deliberately omitted from the contribution.
  const trustGraphStartedAt = startRuntimeStage("trust-graph");
  if (collectionOverBudget()) {
    // Never-waive gate, but graph reconciliation (which scales with connectivity)
    // must not push the run past the ceiling. Record it unavailable so the report
    // persists as partial/not-decision-ready rather than not finishing at all.
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
  const baseEvidence = {
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
    basicFacts: evidence.basicFacts,
    checkOutcomes: checkTracker.snapshot(evidence.roles, { resolvedRealName: hasResolvedRealName(ctx) }),
    providerRuns: checkTracker.providers().runs,
  };

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
    const decisionPacketUsable = scoringPreflight.state === "ready"
      || scoringPreflight.state === "insufficient_evidence";
    if (decisionPacketUsable) {
      emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions…", tone: "neutral" });
    }
    if (scoringPreflight.state === "ready") {
      emit({ phase: "Analyst", label: "Score axes", detail: "AI analyst scoring every axis from the collected evidence…", tone: "neutral" });
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
      scoringPreflight.state === "ready"
        ? analyzeSubject(evidence.profile.handle, evidence.roles, requestedAxes, evidenceJson, {
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
      evidence.headline = verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({ phase: "Analyst", label: "Scored", detail: `${verdict.axes.length} axes scored.`, source: "AI analyst", tone: "good" });
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
      : scoringPreflight.state !== "ready" || !scorerObserved
        ? "skipped"
        : verdict
          ? "executed"
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
            ? `coverage preflight abstained; missing substantive evidence for ${scoringPreflight.missingSubstantiveAxes.join(", ")}; no scorer call made`
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
  const dossier = assembleDossier(evidence, cost.calls.some((line) => line.calls > 0));
  const checkScope = { resolvedRealName: hasResolvedRealName(ctx) };
  dossier.checkRuns = checkTracker.snapshot(evidence.roles, checkScope);
  const checkCompleteness = checkTracker.completeness(evidence.roles, checkScope);
  // Coverage completeness and decision completeness are both required for an
  // authoritative graph contribution. A fully run collector with no valid
  // axis set is still a useful report, but it must remain partial and cannot
  // poison later trust-graph reconciliation with an INCOMPLETE verdict.
  dossier.completeness_state = dossier.report.composite_verdict === "INCOMPLETE"
    ? "partial"
    : checkCompleteness;
  dossier.providerSnapshot = checkTracker.providers();
  // Attach what this run actually spent, so the report library can show it.
  dossier.cost = cost;
  emit({ phase: "Finalize", label: "Audit cost", detail: `~$${cost.usd.toFixed(2)} this audit (Grok $${cost.grokUsd.toFixed(2)} across ${cost.grokCalls} calls, ≈${cost.sources} search sources · Claude $${cost.claudeUsd.toFixed(2)} across ${cost.claudeCalls} calls).`, tone: "neutral" });
  finishRuntimeStage("pipeline", runtimeStartedAt);
  return dossier;
}

export function runAudit(rawHandle: string, emit: Emit, options?: RunAuditOptions): Promise<Dossier | null> {
  return withCostLedger(() => runAuditWithLedger(rawHandle, emit, options));
}
