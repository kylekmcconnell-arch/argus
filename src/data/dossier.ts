// Dossier — the rendered report payload. Both the local fixture path and the
// live server path produce a Dossier, so <Report> renders identically for each.

import {
  Audit,
  SubjectClass,
  type AuditReport,
  type PanoptesNode,
  type PanoptesEdge,
} from "../engine";
import type { CollectedEvidence, NotableFollower, Contradiction, WebTeamMember } from "./evidence";

export interface Dossier {
  handle: string;
  display_name: string;
  avatar: string;
  bio: string;
  followers: string;
  joined: string;
  days_since_post?: number;
  identity_note: string;
  prior_handles?: string[];
  headline: string;
  live: boolean;
  notableFollowers: NotableFollower[];
  contradictions: Contradiction[];
  webTeam: WebTeamMember[];
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
    const pkey = p.handle ?? p.name;
    if (!pkey) continue;
    if (!hasNode(pkey)) graph.nodes.push({ type: "Person", key: pkey, role: p.role });
    graph.edges.push({ src: subjectKey, dst: pkey, type: "TEAM", role: p.role });
    for (const pr of p.projects ?? []) {
      if (!pr.name) continue;
      if (!hasNode(pr.name)) graph.nodes.push({ type: "Company", key: pr.name });
      graph.edges.push({ src: pkey, dst: pr.name, type: "WORKED_ON", role: pr.role });
    }
  }

  return {
    handle: ev.profile.handle,
    display_name: ev.profile.display_name,
    avatar: ev.profile.avatar,
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
