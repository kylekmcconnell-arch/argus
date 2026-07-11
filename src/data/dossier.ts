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
import type { CollectedEvidence, NotableFollower, Contradiction, WebTeamMember, SourceArtifact } from "./evidence";
import type { ReportPersistenceContext, ReportVersionContext } from "../lib/reportVersion";
import type { ScanCheck } from "../lib/scanChecklist";

export interface Dossier {
  handle: string;
  display_name: string;
  resolved_name?: string;
  avatar: string;
  avatar_url?: string;
  bio: string;
  followers: string;
  joined: string;
  days_since_post?: number;
  identity_note: string;
  prior_handles?: string[];
  headline: string;
  live: boolean;
  // Live collector runs freeze the checks the server actually completed into
  // the immutable payload. Older curated fixtures may omit these fields.
  checkRuns?: ScanCheck[];
  completeness_state?: "complete" | "partial" | "failed";
  providerSnapshot?: {
    capturedAt: string;
    runs: Array<{
      id: string;
      label: string;
      state: "executed" | "partial" | "failed" | "unavailable";
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
  webTeam: WebTeamMember[];
  sourceArtifacts?: SourceArtifact[];
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
  a.setIdentity(ev.profile.identity_confidence);

  ev.ventures.forEach((v) => a.addVenture(v));
  ev.testimonials.forEach((t) => a.addTestimonial(t));
  ev.advised.forEach((p) => a.addAdvisedProject(p));
  ev.wallets.forEach((w) => a.addWallet(w));
  ev.promotions.forEach((p) => a.addPromotion(p));
  ev.clientEngagements.forEach((c) => a.addClientEngagement(c));
  ev.associates.forEach((as) => a.addAssociate(as));
  ev.findings.forEach((f) => a.addFinding(f));
  ev.axes.forEach((ax) => {
    try {
      a.setAxis(ax.axis, ax.score, ax.rationale);
    } catch {
      // axis belongs to a role not held; skip defensively
    }
  });

  const report = a.finalize();

  // Enrich the graph with the web team + each member's OTHER projects, so the
  // connection web shows the people and cross-project ties behind the subject
  // (and they compound into the shared graph for future bridges).
  const graph = a.toPanoptes();
  const subjectKey = (graph.nodes.find((n) => (n as { subject?: boolean }).subject)?.key as string) ?? ev.profile.handle;
  const hasNode = (key: string) => graph.nodes.some((n) => String(n.key).toLowerCase() === key.toLowerCase());
  for (const p of ev.webTeam ?? []) {
    if (!p.handle && !p.name) continue;
    // Canonical key (@handle when known) so a team member bridges to their own
    // audit, and their other projects merge onto those projects' nodes.
    const pkey = canonicalEntityKey({ handle: p.handle, name: p.name });
    if (!pkey) continue;
    if (!hasNode(pkey)) graph.nodes.push({ type: "Person", key: pkey, label: p.name, role: p.role } as PanoptesNode);
    graph.edges.push({ src: subjectKey, dst: pkey, type: "TEAM", role: p.role });
    for (const pr of p.projects ?? []) {
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
    if (!vt.key) continue;
    if (!hasNode(vt.key)) graph.nodes.push({ type: "Company", key: vt.key, label: vt.name } as PanoptesNode);
    for (const person of vt.people) {
      const pk = canonicalEntityKey({ handle: person.handle, name: person.name });
      if (!pk) continue;
      if (!hasNode(pk)) graph.nodes.push({ type: "Person", key: pk, label: person.name, role: person.role } as PanoptesNode);
      graph.edges.push({ src: pk, dst: vt.key, type: "WORKED_ON", role: person.role });
    }
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
    followers: ev.profile.followers,
    joined: ev.profile.joined,
    days_since_post: ev.profile.days_since_post,
    identity_note: ev.profile.identity_note,
    prior_handles: ev.profile.prior_handles,
    headline: ev.headline,
    live,
    notableFollowers: ev.notableFollowers,
    contradictions: ev.contradictions,
    webTeam: ev.webTeam ?? [],
    sourceArtifacts: ev.sourceArtifacts,
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
