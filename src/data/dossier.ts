// Dossier — the rendered report payload. Both the local fixture path and the
// live server path produce a Dossier, so <Report> renders identically for each.

import {
  Audit,
  SubjectClass,
  canonicalEntityKey,
  type AuditReport,
  type PanoptesNode,
  type PanoptesEdge,
} from "../engine";
import type {
  CollectedEvidence,
  NotableFollower,
  Contradiction,
  WebTeamMember,
  SourceArtifact,
  AxisEvidenceRecord,
  ProjectStrengthBandRecord,
  ProfileAuthenticityResult,
  ProjectTokenSnapshot,
  TrustGraphScreen,
  BasicFact,
  BasicFactLead,
  BasicFactQuestionLedgerEntry,
  BasicFactSource,
  GithubAssessment,
} from "./evidence";
import type { ReportPersistenceContext, ReportVersionContext } from "../lib/reportVersion";
import type { MaterialReportDelta } from "../lib/reportDelta";
import type { ScanCheck } from "../lib/scanChecklist";
import type { ResearchPlan } from "../lib/researchDirector";
import { isPlausiblePersonRosterName } from "../lib/personName";
import { teamCandidateSourceMatchesIdentity } from "../lib/teamCandidateIdentity";
import { portfolioRelationshipBinding } from "../lib/portfolioRelationshipBinding";
import { buildPointInTimeIntelligence } from "../intelligence/buildPointInTimeIntelligence";
import { buildEntityPointInTimeIntelligence } from "../intelligence/buildEntityPointInTimeIntelligence";
import type { IntelligenceSpineSnapshot } from "../intelligence/types";
import {
  cloneEvmControlRealitySnapshot,
  type EvmControlRealitySnapshot,
} from "./evmControlReality";

export type DossierBasicFactSource = BasicFactSource;
export type DossierBasicFact = BasicFact;
export type DossierBasicFactLead = BasicFactLead;
export type DossierBasicFactQuestion = BasicFactQuestionLedgerEntry;

/**
 * One earlier token tied to the operator behind a launchpad launch, with the
 * value it carries TODAY and how the tie was established.
 *
 * This is the CANONICAL shape of a carried prior launch. The collector's
 * PriorLaunch (server/adapters/operatorLaunches.ts) is structurally identical
 * and should import this type rather than restate it; the declaration lives in
 * src/ because src/ can never import server/ (the collector pulls in node
 * builtins, which the browser tsconfig does not type).
 */
export interface OperatorPriorLaunch {
  symbol: string;
  name?: string;
  mint: string;
  chain: string;
  /** Current fully diluted value: what the earlier launch is worth now. */
  fdvUsd: number | null;
  liquidityUsd: number | null;
  /** X handle carried in that token's own social metadata, when present. */
  xHandle?: string;
  createdAt?: string;
  /** When the launchpad itself minted the token, on the launchpad's own clock. */
  mintedAt?: string;
  /** Highest known value, present only when the peak survived verification. */
  athUsd?: number;
  /** When that peak printed, and only when the accepted peak carried a date. */
  athAt?: string;
  /** The operator's own post claiming this launch: a receipt the reader opens. */
  permalink?: string;
  url: string;
  /** How the launch was tied to the operator; never an inference. */
  link: "same_creator_wallet" | "operator_bio_project" | "operator_announcement";
  /** The operator's own words, when the tie came from a launch announcement. */
  announcement?: { text: string; at?: string; url?: string };
}

/**
 * A project the operator publicly claims to have launched whose token no
 * longer resolves to a live pool. ARGUS reports the CLAIM and its date in the
 * operator's own words; it never asserts the project was abandoned, because a
 * missing pool is an absence of market data, not proof of anything.
 */
export interface OperatorClaimedProject {
  label: string;
  at?: string;
  quote: string;
  /** Permalink to the claim, so the reader can open the operator's own post. */
  url?: string;
}

export interface OperatorLaunchHistory {
  creatorWallet?: string;
  launches: OperatorPriorLaunch[];
  /** When the launchpad minted the audited token, on PriorLaunch.mintedAt's clock. */
  subjectMintedAt?: string;
  /** This launch plus every prior one tied to the operator. */
  totalLaunches: number;
  claimedProjects: OperatorClaimedProject[];
}

// The collector resolves the full launch history and, until now, flattened it
// into a single finding sentence. It stamps the structure onto the evidence
// bag instead; declaring the field here keeps the write site (the collector)
// and the read site (this assembler) bound to one shape.
declare module "./evidence" {
  interface CollectedEvidence {
    operatorLaunches?: OperatorLaunchHistory;
  }
}

export interface Dossier {
  handle: string;
  display_name: string;
  resolved_name?: string;
  avatar: string;
  avatar_url?: string;
  bio: string;
  website?: string;
  /** Grok's bound-source explanation of what this exact subject is and does. */
  subjectOrientation?: CollectedEvidence["subjectOrientation"];
  profile_collection_state?: CollectedEvidence["profile"]["profile_collection_state"];
  profile_provider?: string;
  profile_captured_at?: string;
  /** Exact account-to-person bridge retained for person-dependent report proofs. */
  identity_binding?: CollectedEvidence["profile"]["identity_binding"];
  x_account_status?: CollectedEvidence["profile"]["x_account_status"];
  x_account_status_source_url?: string;
  x_account_status_captured_at?: string;
  followers: string;
  joined: string;
  /** Exact provider timestamp for the latest observed post. */
  last_post_at?: string;
  days_since_post?: number;
  identity_note: string;
  prior_handles?: string[];
  headline: string;
  live: boolean;
  /** Strict evidence-to-axis lineage for newly scored live reports. */
  axisCitationVersion?: 1;
  /** Content-addressed artifacts from the exact post-pruning scorer packet. */
  axisEvidenceCatalog?: AxisEvidenceRecord[];
  /** Frozen evidence-strength ranges used to validate PROJECT axis scores. */
  projectStrengthBands?: Record<string, ProjectStrengthBandRecord>;
  // Live collector runs freeze the checks the server actually completed into
  // the immutable payload. Older curated fixtures may omit these fields.
  checkRuns?: ScanCheck[];
  /**
   * Provider calls that FAILED during this run, stamped at finalize. Owner
   * policy: failures surface on screen instead of silently switching the
   * spend to a fallback provider, so the affected lanes visibly completed
   * without their provider.
   */
  providerFailures?: Array<{ provider: string; op: string; failed: number; meta?: string }>;
  /**
   * The previous persisted version's outcome, stamped at finalize so a re-scan
   * can show its own delta org-wide (not just in one browser's local log).
   * Absent on first scans and on versions persisted before this field shipped.
   */
  priorOutcome?: {
    version: number;
    score: number | null;
    verdict: string | null;
    completeness: string | null;
    capturedAt: string | null;
    delta: string;
  };
  /** Highest-priority source-backed change from the exact prior report. */
  reportDelta?: MaterialReportDelta;
  /**
   * The operator's earlier launches and the earlier projects their own account
   * claims, carried as structure so a frozen report renders each launch, its
   * current value and how it was tied to the operator forever, instead of the
   * one flattened sentence the finding has always carried.
   */
  operatorLaunches?: OperatorLaunchHistory;
  completeness_state?: "complete" | "partial" | "failed";
  providerSnapshot?: {
    capturedAt: string;
    runs: Array<{
      id: string;
      label: string;
      state: "executed" | "partial" | "failed" | "unavailable" | "skipped";
      observedAt: string;
      detail?: string;
    }>;
  };
  // Present only when this payload was reopened from an immutable stored
  // version. Kept outside the immutable payload itself so loading metadata
  // never mutates (or silently rewrites) the evidence snapshot.
  versionContext?: ReportVersionContext;
  /** Snapshot framing inherited from a parent investigation facet. */
  viewVersionContext?: ReportVersionContext;
  /** Fresh persistence/cost capability inherited from a parent investigation. */
  viewPersistence?: ReportPersistenceContext;
  // Live SSE completion records whether the immutable version was activated.
  // Consumers must not bind fresh evidence to a durable case when this failed.
  persistence?: ReportPersistenceContext;
  notableFollowers: NotableFollower[];
  contradictions: Contradiction[];
  /** Independently collected team records that may ground identity context. */
  webTeam: WebTeamMember[];
  /** Source-backed funds, incubators, advisers, backers, and other linked organizations. */
  organizationRelationships?: WebTeamMember[];
  /**
   * Whether each named founder / C-level leader still lists this project as a
   * current role. A paid, bounded lookup: without this field the answer was
   * collected, charged for, and then dropped before it could ever render.
   */
  leaderDepartures?: CollectedEvidence["leaderDepartures"];
  /** Model-only or otherwise unverified team candidates; never grounded evidence. */
  webTeamLeads?: WebTeamMember[];
  githubAssessment?: GithubAssessment; // subject's resolved GitHub: quality/claims/history
  // The token threat leg of the FULL scan. Attached client-side by the runner
  // (the threat scanner runs in the browser, in parallel with the server
  // collection) and persisted with the report. Absent: no project token could
  // be attributed to this subject. null: a token was found but the scan failed.
  threat?: import("../threat/types").ThreatScan | null;
  // Why the threat leg ran on that token (or why it was skipped) - one line,
  // rendered with the section so the attribution is auditable.
  threatNote?: string;
  /** Second-hop discovery stays inspectable even when excluded from the graph. */
  ventureTeams?: CollectedEvidence["ventureTeams"];
  /** Cited model discoveries that did not govern the frozen result. */
  portfolioLeads?: CollectedEvidence["portfolioLeads"];
  sourceArtifacts?: SourceArtifact[];
  profileAuthenticity?: ProfileAuthenticityResult;
  trustGraphScreen?: TrustGraphScreen;
  /** Verified project-owned token plus frozen market/chart context. */
  projectToken?: ProjectTokenSnapshot;
  /** Frozen fixed-block observations from the canonical token contract. */
  evmControlReality?: EvmControlRealitySnapshot;
  /** Frozen protocol fundamentals (DeFiLlama), for the hero strip. */
  protocolTvl?: CollectedEvidence["protocolTvl"];
  /** Frozen public X conversation breadth and volume. Separate from the verdict. */
  socialActivity?: CollectedEvidence["socialActivity"];
  protocolFunding?: CollectedEvidence["protocolFunding"];
  /** Frozen protocol fee totals (DeFiLlama); the second dated usage metric for the charts. */
  protocolFees?: CollectedEvidence["protocolFees"];
  /** Frozen float-control profile (GoPlus holder register) for the concentration bar. */
  holderProfile?: CollectedEvidence["holderProfile"];
  /** Legacy frozen CryptoRank schedule retained only so historical reports remain readable. */
  tokenUnlocks?: CollectedEvidence["tokenUnlocks"];
  /** Exact official-domain-bound licensed company record. */
  companyEnrichment?: CollectedEvidence["companyEnrichment"];
  /** Frozen registration observation for the canonical official domain. */
  domainRegistration?: CollectedEvidence["domainRegistration"];
  /** Frozen predecessor, rebrand, migration and contract lineage evidence. */
  entityContinuity?: CollectedEvidence["entityContinuity"];
  /** Frozen pre-scoring token applicability decision. */
  tokenApplicability?: CollectedEvidence["tokenApplicability"];
  /**
   * Deterministic, score-neutral decision intelligence built from this exact
   * evidence capture. Older reports omit it and must not reconstruct it from
   * newer rules when reopened.
   */
  intelligence?: IntelligenceSpineSnapshot;
  /** Plain-language answers to the project's core diligence questions. */
  basicFacts?: DossierBasicFact[];
  /** Model-discovered candidates that remain unverified and unscored. */
  basicFactLeads?: DossierBasicFactLead[];
  /** Frozen role-aware research questions, verified answers, and explicit gaps. */
  basicFactQuestionLedger?: DossierBasicFactQuestion[];
  /** What the investigation director asked, delegated, and could not finish. */
  researchPlan?: ResearchPlan;
  report: AuditReport;
  // What the collector run spent on providers (attached server-side; persists
  // with the report so the library can show per-audit cost).
  cost?: { usd: number; grokUsd: number; claudeUsd: number; grokCalls: number; claudeCalls: number; sources: number; estimated: boolean; calls?: { provider: string; op: string; calls: number; usd: number; meta?: string }[] };
  graph: { nodes: PanoptesNode[]; edges: PanoptesEdge[] };
  founderSummary?: ReturnType<Audit["founderSummary"]>;
  evidence: {
    ventures: ReturnType<Audit["getVentures"]>;
    testimonials: ReturnType<Audit["getTestimonials"]>;
    advised: ReturnType<Audit["getAdvisedProjects"]>;
    associates: ReturnType<Audit["getAssociates"]>;
    wallets: ReturnType<Audit["getWallets"]>;
    promotions: ReturnType<Audit["getPromotions"]>;
  };
}

// Builds the Audit from a (fixture- or live-) collected evidence bag, runs the
// real engine, and packages the rendered dossier.
export function assembleDossier(ev: CollectedEvidence, live: boolean): Dossier {
  const a = new Audit(ev.profile.handle, { roles: ev.roles, display_name: ev.profile.display_name });
  const graphAudit = new Audit(ev.profile.handle, { roles: ev.roles, display_name: ev.profile.display_name });
  a.setIdentity(ev.profile.identity_confidence);
  a.setTokenApplicability(ev.tokenApplicability);
  graphAudit.setIdentity(ev.profile.identity_confidence);

  const governingEligible = (row: { evidence_origin?: string; artifact_verified?: boolean }) =>
    row.evidence_origin !== "model_lead" && row.artifact_verified !== false;
  const meaningfulTeamValue = (value: string) => Boolean(value.trim())
    && !/^(?:<\s*)?(?:unknown|n\/a|null|undefined)(?:\s*>)?$/i.test(value.trim());
  // A display name that is just the row's own handle is not a resolved
  // identity: a post-scan can bind a bystander account to a project-owned
  // role ("thanks @mediashow for having our CEO on"). Such rows stay leads.
  const teamNameIsOwnHandle = (row: WebTeamMember) => {
    const name = row.name.trim();
    if (name.startsWith("@")) return true;
    if (/[\s._-]/.test(name)) return false;
    const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return Boolean(row.handle) && compact(name) === compact((row.handle ?? "").replace(/^@/, ""));
  };
  const identityGrounded = (row: WebTeamMember) =>
    row.kind !== "org"
    && meaningfulTeamValue(row.name)
    && isPlausiblePersonRosterName(row.name)
    && meaningfulTeamValue(row.role)
    && row.evidence_origin !== "model_lead"
    && row.artifact_verified === true
    && (
      // A first-party handle is the unique id. Post-scan and reverse-bio rows
      // often use @handle as the display name until enrichment fills it.
      (row.handleProvenance === "subject_first_party" && Boolean(row.handle))
      || !teamNameIsOwnHandle(row)
    );
  const groundedWebTeam = (ev.webTeam ?? [])
    .filter(identityGrounded)
    .map((member) => ({
      ...member,
      ...(member.identity_link_evidence_origin === "model_lead"
        ? { handle: undefined, linkedin: undefined, github: undefined, developerProfiles: undefined }
        : {}),
      ...(member.projects_evidence_origin === "model_lead" ? { projects: [] } : {}),
    }));
  const organizationRelationships = (ev.webTeam ?? [])
    .filter((member) => member.kind === "org"
      && meaningfulTeamValue(member.name)
      && meaningfulTeamValue(member.role)
      && member.evidence_origin !== "model_lead"
      && member.artifact_verified === true)
    .map((member) => ({ ...member }));
  const webTeamLeads = (ev.webTeam ?? []).flatMap((member) => {
    if (member.kind === "org") return [];
    if (!meaningfulTeamValue(member.name) || !isPlausiblePersonRosterName(member.name) || !meaningfulTeamValue(member.role)) return [];
    if (!teamCandidateSourceMatchesIdentity(member)) return [];
    if (!identityGrounded(member)) return [{ ...member }];
    // Only an unproven identity LINK makes a verified person a candidate
    // again. Model-found projects alone are stripped from the verified row
    // (sanitization above) and must not re-render the person with a verify
    // button: a deterministically-bound founder is not a lead.
    if (member.identity_link_evidence_origin !== "model_lead") return [];
    return [{
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
      source: `${member.source} · unverified model-enriched links`,
    }];
  });

  ev.ventures.forEach((v) => { a.addVenture(v); if (governingEligible(v)) graphAudit.addVenture(v); });
  ev.testimonials.forEach((t) => { a.addTestimonial(t); if (governingEligible(t)) graphAudit.addTestimonial(t); });
  ev.advised.forEach((p) => { a.addAdvisedProject(p); if (governingEligible(p)) graphAudit.addAdvisedProject(p); });
  ev.wallets.forEach((w) => { a.addWallet(w); if (governingEligible(w)) graphAudit.addWallet(w); });
  ev.promotions.forEach((p) => { a.addPromotion(p); if (governingEligible(p)) graphAudit.addPromotion(p); });
  ev.clientEngagements.forEach((c) => { a.addClientEngagement(c); if (governingEligible(c)) graphAudit.addClientEngagement(c); });
  const organizationHandles = new Set(organizationRelationships
    .map((member) => (member.handle ?? "").replace(/^@/, "").toLowerCase())
    .filter(Boolean));
  ev.associates.forEach((associate) => {
    const normalizedHandle = associate.associate_handle.replace(/^@/, "").toLowerCase();
    const typedAssociate = associate.kind
      ? associate
      : organizationHandles.has(normalizedHandle)
        ? { ...associate, kind: "org" as const }
        : associate;
    a.addAssociate(typedAssociate);
    if (governingEligible(typedAssociate)) graphAudit.addAssociate(typedAssociate);
  });
  ev.findings.forEach((f) => { a.addFinding(f); if (governingEligible(f)) graphAudit.addFinding(f); });
  ev.axes.forEach((ax) => {
    try {
      a.setAxis(ax.axis, ax.score, ax.rationale, {
        evidenceRefs: ax.evidenceRefs,
        counterEvidenceRefs: ax.counterEvidenceRefs,
        gaps: ax.gaps,
      });
    } catch {
      // axis belongs to a role not held; skip defensively
    }
  });

  const report = a.finalize();

  // Enrich the graph with the web team + each member's OTHER projects, so the
  // connection web shows the people and cross-project ties behind the subject
  // (and they compound into the shared graph for future bridges).
  const graph = graphAudit.toPanoptes();
  const subjectKey = (graph.nodes.find((n) => (n as { subject?: boolean }).subject)?.key as string) ?? ev.profile.handle;
  const hasNode = (key: string) => graph.nodes.some((n) => String(n.key).toLowerCase() === key.toLowerCase());
  for (const p of groundedWebTeam) {
    const verifiedHandle = p.identity_link_evidence_origin === "model_lead" ? undefined : p.handle;
    const verifiedProjects = p.projects_evidence_origin === "model_lead" ? [] : p.projects ?? [];
    if (!verifiedHandle && !p.name) continue;
    // Canonical key (@handle when known) so a team member bridges to their own
    // audit, and their other projects merge onto those projects' nodes.
    const pkey = canonicalEntityKey({ handle: verifiedHandle, name: p.name });
    if (!pkey) continue;
    if (!hasNode(pkey)) graph.nodes.push({ type: "Person", key: pkey, label: p.name, role: p.role } as PanoptesNode);
    graph.edges.push({
      src: subjectKey,
      dst: pkey,
      type: "TEAM",
      role: p.role,
      ...(p.sourceUrl ? { source_url: p.sourceUrl } : {}),
      ...(p.provider ? { provider: p.provider } : {}),
      ...(p.evidence_origin ? { evidence_origin: p.evidence_origin } : {}),
      artifact_verified: p.artifact_verified === true,
    });
    for (const pr of verifiedProjects) {
      if (!pr.name) continue;
      const prKey = canonicalEntityKey({ name: pr.name });
      if (!prKey) continue;
      if (!hasNode(prKey)) graph.nodes.push({ type: "Company", key: prKey, label: pr.name } as PanoptesNode);
      graph.edges.push({ src: pkey, dst: prKey, type: "WORKED_ON", role: pr.role });
    }
  }
  // Second hop: the people behind the subject's ventures (subject → venture →
  // its team). Keyed canonically so a venture's team member bridges to their own
  // audit, and merges onto the subject's associate node when they're the same
  // person — turning the star into a web.
  for (const vt of ev.ventureTeams ?? []) {
    if (!governingEligible(vt)) continue;
    if (!vt.key) continue;
    if (!hasNode(vt.key)) graph.nodes.push({ type: "Company", key: vt.key, label: vt.name } as PanoptesNode);
    for (const person of vt.people) {
      const pk = canonicalEntityKey({ handle: person.handle, name: person.name });
      if (!pk) continue;
      if (!hasNode(pk)) graph.nodes.push({ type: "Person", key: pk, label: person.name, role: person.role } as PanoptesNode);
      graph.edges.push({ src: pk, dst: vt.key, type: "WORKED_ON", role: person.role });
    }
  }

  // Verified investment relationships are their own graph edge. Reusing Venture
  // would incorrectly render every fund position as FOUNDED, which overstates the
  // subject's role and contaminates cross-report graph reasoning.
  for (const relationship of (ev.sourceArtifacts ?? []).filter((artifact) =>
    Boolean(portfolioRelationshipBinding(artifact, ev)),
  )) {
    const investorKey = relationship.attribution === "affiliated_fund" && relationship.investorEntityName
      ? canonicalEntityKey({
          handle: relationship.investorEntityHandle,
          domain: relationship.investorEntityDomain,
          name: relationship.investorEntityName,
        })
      : subjectKey;
    if (investorKey !== subjectKey) {
      if (!hasNode(investorKey)) graph.nodes.push({ type: "Company", key: investorKey, label: relationship.investorEntityName } as PanoptesNode);
      const affiliationExists = graph.edges.some((edge) => edge.src === subjectKey && edge.dst === investorKey && edge.type === "AFFILIATED_WITH");
      if (!affiliationExists) graph.edges.push({
        src: subjectKey,
        dst: investorKey,
        type: "AFFILIATED_WITH",
        context: "portfolio attribution",
        ...(relationship.attributionSourceUrl ? { source_url: relationship.attributionSourceUrl } : {}),
      });
    }
    const projectKey = canonicalEntityKey({
      handle: relationship.projectHandle,
      domain: relationship.projectDomain,
      name: relationship.projectName,
    });
    if (!projectKey) continue;
    if (!hasNode(projectKey)) graph.nodes.push({ type: "Company", key: projectKey, label: relationship.projectName } as PanoptesNode);
    const exists = graph.edges.some((edge) => edge.src === investorKey && edge.dst === projectKey && edge.type === "INVESTED_IN");
    if (!exists) graph.edges.push({
      src: investorKey,
      dst: projectKey,
      type: "INVESTED_IN",
      source_url: relationship.sourceUrl,
      source_class: relationship.sourceClass,
    });
  }

  // PDL-resolved emails as graph nodes, keyed IDENTICALLY to the leaked GitHub
  // commit emails (email:<addr>) — so if a project's anon dev committed under an
  // email PDL ties to this named person, the two audits bridge to one node.
  for (const email of ev.profile.identity_emails ?? []) {
    const ekey = `email:${email.toLowerCase()}`;
    if (!hasNode(ekey)) graph.nodes.push({ type: "Identity", subtype: "Email", key: ekey, label: email } as PanoptesNode);
    graph.edges.push({ src: subjectKey, dst: ekey, type: "IDENTITY_EMAIL" });
  }

  // The resolved GitHub login as its own identity node (github:<login>), so two
  // audits that land on the same GitHub account bridge to one node - same pattern
  // as the email bridge above.
  const gh = ev.profile.githubAssessment;
  if (gh) {
    const gkey = `github:${gh.login.toLowerCase()}`;
    if (!hasNode(gkey)) graph.nodes.push({ type: "Identity", subtype: "GitHub", key: gkey, label: `github.com/${gh.login}` } as PanoptesNode);
    graph.edges.push({ src: subjectKey, dst: gkey, type: "IDENTITY_GITHUB" });
  }

  // The operator's launch record, frozen into the payload so a saved report
  // still renders each earlier launch, its current value and how it was tied
  // to the operator long after the pools are gone.
  //
  // An empty history is the same as no history: an operator who has shipped
  // nothing else must not render a hollow track-record panel, so the field is
  // omitted rather than carried empty. The record is spread and only its
  // arrays re-copied, because the collector keeps adding per-launch detail
  // (mint dates, peaks, permalinks) and a field-by-field rebuild here would
  // silently drop each new one on its way to the client.
  const rawLaunches = ev.operatorLaunches;
  const operatorLaunches: OperatorLaunchHistory | null =
    rawLaunches && (rawLaunches.launches.length > 0 || rawLaunches.claimedProjects.length > 0)
      ? {
          ...rawLaunches,
          launches: rawLaunches.launches.map((launch) => ({
            ...launch,
            ...(launch.announcement ? { announcement: { ...launch.announcement } } : {}),
          })),
          claimedProjects: rawLaunches.claimedProjects.map((project) => ({ ...project })),
        }
      : null;
  const intelligence = buildPointInTimeIntelligence(ev) ?? buildEntityPointInTimeIntelligence(ev);

  return {
    handle: ev.profile.handle,
    display_name: ev.profile.display_name,
    resolved_name: ev.profile.resolved_name,
    avatar: ev.profile.avatar,
    avatar_url: ev.profile.avatar_url,
    bio: ev.profile.bio,
    website: ev.profile.website,
    ...(ev.subjectOrientation ? { subjectOrientation: structuredClone(ev.subjectOrientation) } : {}),
    profile_collection_state: ev.profile.profile_collection_state,
    profile_provider: ev.profile.profile_provider,
    profile_captured_at: ev.profile.profile_captured_at,
    identity_binding: ev.profile.identity_binding,
    x_account_status: ev.profile.x_account_status,
    x_account_status_source_url: ev.profile.x_account_status_source_url,
    x_account_status_captured_at: ev.profile.x_account_status_captured_at,
    followers: ev.profile.followers,
    joined: ev.profile.joined,
    last_post_at: ev.profile.last_post_at,
    days_since_post: ev.profile.days_since_post,
    identity_note: ev.profile.identity_note,
    prior_handles: ev.profile.prior_handles,
    ...(ev.socialActivity ? { socialActivity: structuredClone(ev.socialActivity) } : {}),
    headline: ev.headline,
    live,
    ...(ev.axisCitationVersion === 1 && ev.axisEvidenceCatalog ? {
      axisCitationVersion: 1 as const,
      axisEvidenceCatalog: ev.axisEvidenceCatalog.map((artifact) => ({
        ...artifact,
        eligibleAxes: [...artifact.eligibleAxes],
        ...(artifact.counterEligibleAxes ? { counterEligibleAxes: [...artifact.counterEligibleAxes] } : {}),
      })),
      ...(ev.projectStrengthBands ? {
        projectStrengthBands: Object.fromEntries(Object.entries(ev.projectStrengthBands).map(([axis, band]) => [axis, {
          ...band,
          reasons: [...band.reasons],
          anchorArtifactIds: [...band.anchorArtifactIds],
        }])),
      } : {}),
    } : {}),
    notableFollowers: ev.notableFollowers,
    contradictions: ev.contradictions,
    webTeam: groundedWebTeam,
    ...(organizationRelationships.length ? { organizationRelationships } : {}),
    ...(webTeamLeads.length ? { webTeamLeads } : {}),
    ...(ev.leaderDepartures?.length
      ? { leaderDepartures: ev.leaderDepartures.map((row) => ({ ...row })) }
      : {}),
    ventureTeams: ev.ventureTeams ?? [],
    portfolioLeads: ev.portfolioLeads ?? [],
    sourceArtifacts: ev.sourceArtifacts,
    profileAuthenticity: ev.profileAuthenticity,
    trustGraphScreen: ev.trustGraphScreen,
    ...(ev.protocolTvl ? {
      protocolTvl: {
        ...ev.protocolTvl,
        chains: [...ev.protocolTvl.chains],
        chainBreakdown: ev.protocolTvl.chainBreakdown.map((entry) => ({ ...entry })),
        ...(ev.protocolTvl.trend ? { trend: ev.protocolTvl.trend.map((point) => ({ ...point })) } : {}),
        ...(ev.protocolTvl.governanceIds ? { governanceIds: [...ev.protocolTvl.governanceIds] } : {}),
        ...(ev.protocolTvl.hacks ? { hacks: ev.protocolTvl.hacks.map((incident) => ({ ...incident })) } : {}),
      },
    } : {}),
    ...(ev.protocolFunding ? {
      protocolFunding: {
        ...ev.protocolFunding,
        rounds: ev.protocolFunding.rounds.map((round) => ({
          ...round,
          leadInvestors: [...round.leadInvestors],
          otherInvestors: [...round.otherInvestors],
        })),
        leadInvestors: [...ev.protocolFunding.leadInvestors],
      },
    } : {}),
    ...(ev.protocolFees ? { protocolFees: { ...ev.protocolFees } } : {}),
    ...(ev.holderProfile ? {
      holderProfile: {
        ...ev.holderProfile,
        // The GoPlus flag sentences are the report's own copy once frozen; a
        // shared reference lets a later collector pass reword a published claim.
        ...(ev.holderProfile.contractFlags
          ? { contractFlags: ev.holderProfile.contractFlags.map((flag) => ({ ...flag })) }
          : {}),
      },
    } : {}),
    ...(ev.tokenUnlocks ? {
      tokenUnlocks: {
        ...ev.tokenUnlocks,
        ...(ev.tokenUnlocks.percentageValidation ? {
          percentageValidation: {
            ...ev.tokenUnlocks.percentageValidation,
            invalidFields: [...ev.tokenUnlocks.percentageValidation.invalidFields],
          },
        } : {}),
      },
    } : {}),
    ...(ev.companyEnrichment ? {
      companyEnrichment: {
        ...ev.companyEnrichment,
        ...(ev.companyEnrichment.funding ? {
          funding: {
            ...ev.companyEnrichment.funding,
            rounds: ev.companyEnrichment.funding.rounds.map((round) => ({
              ...round,
              leadInvestors: [...round.leadInvestors],
              otherInvestors: [...round.otherInvestors],
            })),
            leadInvestors: [...ev.companyEnrichment.funding.leadInvestors],
          },
        } : {}),
        ...(ev.companyEnrichment.management ? {
          management: ev.companyEnrichment.management.map((person) => ({
            ...person,
            priorCompanies: [...person.priorCompanies],
          })),
        } : {}),
        ...(ev.companyEnrichment.firmographic ? {
          firmographic: { ...ev.companyEnrichment.firmographic },
        } : {}),
      },
    } : {}),
    ...(ev.domainRegistration ? { domainRegistration: { ...ev.domainRegistration } } : {}),
    ...(ev.entityContinuity ? { entityContinuity: structuredClone(ev.entityContinuity) } : {}),
    ...(ev.tokenApplicability ? { tokenApplicability: structuredClone(ev.tokenApplicability) } : {}),
    ...(ev.evmControlReality
      ? { evmControlReality: cloneEvmControlRealitySnapshot(ev.evmControlReality) }
      : {}),
    ...(intelligence ? { intelligence } : {}),
    ...(ev.researchPlan ? {
      researchPlan: {
        ...ev.researchPlan,
        roles: [...ev.researchPlan.roles],
        tasks: ev.researchPlan.tasks.map((task) => ({
          ...task,
          delegates: [...task.delegates],
          checkIds: [...task.checkIds],
          triggeredBy: [...task.triggeredBy],
          blockedBy: [...task.blockedBy],
        })),
        nextActions: ev.researchPlan.nextActions.map((action) => ({
          ...action,
          delegates: [...action.delegates],
        })),
      },
    } : {}),
    ...(operatorLaunches ? { operatorLaunches } : {}),
    projectToken: ev.projectToken ? {
      ...ev.projectToken,
      ...(ev.projectToken.providers ? { providers: [...ev.projectToken.providers] } : {}),
      ...(ev.projectToken.producerSources ? {
        producerSources: {
          identity: { ...ev.projectToken.producerSources.identity },
          ...(ev.projectToken.producerSources.market
            ? { market: { ...ev.projectToken.producerSources.market } }
            : {}),
          ...(ev.projectToken.producerSources.liquidity
            ? { liquidity: { ...ev.projectToken.producerSources.liquidity } }
            : {}),
          ...(ev.projectToken.producerSources.history
            ? { history: { ...ev.projectToken.producerSources.history } }
            : {}),
        },
      } : {}),
      ...(ev.projectToken.ath ? { ath: { ...ev.projectToken.ath } } : {}),
      // The candle summary is two levels deep now: the range carries per-candle
      // high and low arrays, and the volume trend carries a window object a
      // side. Cloning only `points` would leave the rest pointing back at live
      // collector state, which is the one thing a freeze must not do.
      ...(ev.projectToken.history ? {
        history: {
          ...ev.projectToken.history,
          points: [...ev.projectToken.history.points],
          ...(ev.projectToken.history.range ? {
            range: {
              ...ev.projectToken.history.range,
              ...(ev.projectToken.history.range.highs ? { highs: [...ev.projectToken.history.range.highs] } : {}),
              ...(ev.projectToken.history.range.lows ? { lows: [...ev.projectToken.history.range.lows] } : {}),
            },
          } : {}),
          ...(ev.projectToken.history.volume ? {
            volume: {
              ...ev.projectToken.history.volume,
              recent: { ...ev.projectToken.history.volume.recent },
              prior: { ...ev.projectToken.history.volume.prior },
            },
          } : {}),
        },
      } : {}),
    } : undefined,
    ...(ev.basicFacts?.length ? {
      basicFacts: ev.basicFacts.map((fact) => ({
        ...fact,
        ...(fact.sources ? { sources: fact.sources.map((source) => ({ ...source })) } : {}),
      })),
    } : {}),
    ...(ev.basicFactLeads?.length ? {
      basicFactLeads: ev.basicFactLeads.map((lead) => ({
        ...lead,
        ...(lead.candidateUrls ? { candidateUrls: [...lead.candidateUrls] } : {}),
      })),
    } : {}),
    ...(ev.basicFactQuestionLedger?.length ? {
      basicFactQuestionLedger: ev.basicFactQuestionLedger.map((entry) => ({
        ...entry,
        answerRefs: [...entry.answerRefs],
        providerRuns: entry.providerRuns.map((run) => ({ ...run })),
      })),
    } : {}),
    ...(ev.profile.githubAssessment ? { githubAssessment: ev.profile.githubAssessment } : {}),
    report,
    graph,
    founderSummary: ev.roles.includes(SubjectClass.FOUNDER) ? a.founderSummary() : undefined,
    evidence: {
      ventures: a.getVentures(),
      testimonials: a.getTestimonials(),
      advised: a.getAdvisedProjects(),
      associates: a.getAssociates(),
      wallets: a.getWallets(),
      promotions: a.getPromotions(),
    },
  };
}
