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
} from "./evidence";
import type { ReportPersistenceContext, ReportVersionContext } from "../lib/reportVersion";
import type { ScanCheck } from "../lib/scanChecklist";

export type DossierBasicFactSource = BasicFactSource;
export type DossierBasicFact = BasicFact;
export type DossierBasicFactLead = BasicFactLead;
export type DossierBasicFactQuestion = BasicFactQuestionLedgerEntry;

export interface Dossier {
  handle: string;
  display_name: string;
  resolved_name?: string;
  avatar: string;
  avatar_url?: string;
  bio: string;
  website?: string;
  profile_collection_state?: CollectedEvidence["profile"]["profile_collection_state"];
  profile_provider?: string;
  profile_captured_at?: string;
  followers: string;
  joined: string;
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
  /** Model-only or otherwise unverified team candidates; never grounded evidence. */
  webTeamLeads?: WebTeamMember[];
  /** Second-hop discovery stays inspectable even when excluded from the graph. */
  ventureTeams?: CollectedEvidence["ventureTeams"];
  /** Cited model discoveries that did not govern the frozen result. */
  portfolioLeads?: CollectedEvidence["portfolioLeads"];
  sourceArtifacts?: SourceArtifact[];
  profileAuthenticity?: ProfileAuthenticityResult;
  trustGraphScreen?: TrustGraphScreen;
  /** Verified project-owned token plus frozen market/chart context. */
  projectToken?: ProjectTokenSnapshot;
  /** Frozen protocol fundamentals (DeFiLlama), for the hero strip. */
  protocolTvl?: CollectedEvidence["protocolTvl"];
  protocolFunding?: CollectedEvidence["protocolFunding"];
  /** Plain-language answers to the project's core diligence questions. */
  basicFacts?: DossierBasicFact[];
  /** Model-discovered candidates that remain unverified and unscored. */
  basicFactLeads?: DossierBasicFactLead[];
  /** Frozen role-aware research questions, verified answers, and explicit gaps. */
  basicFactQuestionLedger?: DossierBasicFactQuestion[];
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
  graphAudit.setIdentity(ev.profile.identity_confidence);

  const governingEligible = (row: { evidence_origin?: string; artifact_verified?: boolean }) =>
    row.evidence_origin !== "model_lead" && row.artifact_verified !== false;
  const meaningfulTeamValue = (value: string) => Boolean(value.trim())
    && !/^(?:<\s*)?(?:unknown|n\/a|null|undefined)(?:\s*>)?$/i.test(value.trim());
  const identityGrounded = (row: WebTeamMember) =>
    meaningfulTeamValue(row.name)
    && meaningfulTeamValue(row.role)
    && row.evidence_origin !== "model_lead"
    && row.artifact_verified === true;
  const groundedWebTeam = (ev.webTeam ?? [])
    .filter(identityGrounded)
    .map((member) => ({
      ...member,
      ...(member.identity_link_evidence_origin === "model_lead"
        ? { handle: undefined, linkedin: undefined }
        : {}),
      ...(member.projects_evidence_origin === "model_lead" ? { projects: [] } : {}),
    }));
  const webTeamLeads = (ev.webTeam ?? []).flatMap((member) => {
    if (!meaningfulTeamValue(member.name) || !meaningfulTeamValue(member.role)) return [];
    if (!identityGrounded(member)) return [{ ...member }];
    if (member.identity_link_evidence_origin !== "model_lead" && member.projects_evidence_origin !== "model_lead") return [];
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
  ev.associates.forEach((as) => { a.addAssociate(as); if (governingEligible(as)) graphAudit.addAssociate(as); });
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
    graph.edges.push({ src: subjectKey, dst: pkey, type: "TEAM", role: p.role });
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
    artifact.kind === "portfolio_relationship"
    && artifact.match === "relationship_confirmed"
    && artifact.relationship === "invested_in"
    && artifact.projectName,
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

  return {
    handle: ev.profile.handle,
    display_name: ev.profile.display_name,
    resolved_name: ev.profile.resolved_name,
    avatar: ev.profile.avatar,
    avatar_url: ev.profile.avatar_url,
    bio: ev.profile.bio,
    website: ev.profile.website,
    profile_collection_state: ev.profile.profile_collection_state,
    profile_provider: ev.profile.profile_provider,
    profile_captured_at: ev.profile.profile_captured_at,
    followers: ev.profile.followers,
    joined: ev.profile.joined,
    days_since_post: ev.profile.days_since_post,
    identity_note: ev.profile.identity_note,
    prior_handles: ev.profile.prior_handles,
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
    ...(webTeamLeads.length ? { webTeamLeads } : {}),
    ventureTeams: ev.ventureTeams ?? [],
    portfolioLeads: ev.portfolioLeads ?? [],
    sourceArtifacts: ev.sourceArtifacts,
    profileAuthenticity: ev.profileAuthenticity,
    trustGraphScreen: ev.trustGraphScreen,
    ...(ev.protocolTvl ? { protocolTvl: { ...ev.protocolTvl, chains: [...ev.protocolTvl.chains], chainBreakdown: ev.protocolTvl.chainBreakdown.map((entry) => ({ ...entry })) } } : {}),
    ...(ev.protocolFunding ? { protocolFunding: { ...ev.protocolFunding, rounds: ev.protocolFunding.rounds.map((round) => ({ ...round })), leadInvestors: [...ev.protocolFunding.leadInvestors] } } : {}),
    projectToken: ev.projectToken ? {
      ...ev.projectToken,
      ...(ev.projectToken.providers ? { providers: [...ev.projectToken.providers] } : {}),
      ...(ev.projectToken.history ? {
        history: { ...ev.projectToken.history, points: [...ev.projectToken.history.points] },
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
