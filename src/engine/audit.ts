// ARGUS-P v2 audit orchestrator (multi-role) — faithful TS port of argus_p/audit.py
//
// A subject can hold several roles at once. Each held role is scored on its own
// track with its own axes, caps and identity rule; the composite verdict is
// governed by the most severe role and nothing is averaged across roles.

import {
  SubjectClass,
  VentureOutcome,
  DOX_BONUS,
  classifyFounderPattern,
  repeatBackingSignal,
  TestimonialVerdict,
  type IdentityConfidence,
  type RepeatBackingResult,
} from "./taxonomy";
import { getProfile, effectiveCaps, classForAxis, SHARED_CAPS } from "./profiles";
import { classifyTestimonial, scoreAxis, type AxisSummary } from "./corroboration";

export const VERDICT_BANDS: [string, number, number][] = [
  ["PASS", 70, 100],
  ["CAUTION", 40, 69],
  ["FAIL", 0, 39],
];

// AVOID (a confirmed disqualifying finding) outranks UNVERIFIABLE_IDENTITY.
export const SEVERITY: Record<string, number> = {
  AVOID: 5,
  UNVERIFIABLE_IDENTITY: 4,
  FAIL: 3,
  CAUTION: 2,
  PASS: 1,
  INCOMPLETE: 0,
};

export interface AxisScore {
  score: number;
  weight: number;
  rationale: string;
  role: string;
}

export interface RoleReport {
  role: string;
  verdict: string;
  raw_total: number | null;
  score_total: number | null;
  cap_applied: string | null;
  dox_bonus: number;
  axes: Record<string, AxisScore>;
}

export interface Finding {
  finding_type: string;
  claim: string;
  source_url: string;
  source_date: string;
  source_author?: string;
  verification_status: string; // Verified | Reported | Rumor
  independent_source_count: number;
  polarity: number;
}

export interface Venture {
  project_name: string;
  role: string;
  period: string;
  outcome: VentureOutcome;
  acquirer?: string | null;
  deal_type?: string | null;
  deal_value_usd?: number | null;
  investors?: string[];
  current_backers?: string[];
  evidence_url?: string | null;
  notes?: string | null;
}

export interface Testimonial {
  claimed_endorser_handle?: string;
  claimed_endorser_name?: string;
  claimed_project?: string;
  claimed_relationship?: string;
  appears_at?: string;
  follows_subject?: boolean | null;
  public_acknowledgment?: string | null;
  relationship_corroborated?: boolean | null;
  sentiment?: string | null;
  fud_present?: boolean;
  corroboration_verdict?: TestimonialVerdict;
  evidence_url?: string;
  notes?: string;
}

export interface AdvisedProject extends Testimonial {
  project_name: string;
  project_handle?: string;
  claimed_role?: string;
  paid_or_allocated?: boolean;
  project_outcome?: VentureOutcome | string | null;
}

export interface ClientEngagement {
  client_name: string;
  service_type: string;
  period?: string;
  client_outcome?: VentureOutcome | string | null;
  manipulation_service_flag?: boolean;
  evidence_url?: string;
  notes?: string;
}

export interface Wallet {
  address: string;
  chain: string;
  link_tier: string;
  link_evidence_url?: string;
  activity_summary?: string;
  sold_into_own_promo?: boolean;
  scam_adjacent_flow?: boolean;
  positive_signals?: string;
  notes?: string;
}

export interface Promotion {
  ticker: string;
  contract_address?: string;
  chain?: string;
  paid_promo?: boolean;
  outcome_was_rug?: boolean;
  perf_current?: number;
  notes?: string;
}

export interface AssociateInput {
  associate_handle: string;
  relation: string;
  in_cabal_kb?: boolean;
  evidence_url?: string;
  notes?: string;
}

export interface Associate {
  associate_key: string;
  relation: string;
  in_cabal_kb?: boolean;
  evidence_url?: string;
  notes?: string;
}

export interface AuditReport {
  audit_id: string;
  handle: string;
  roles: string[];
  identity_confidence: IdentityConfidence | null;
  role_reports: RoleReport[];
  composite_verdict: string;
  governing_role: string | null;
  governing_score: number | null;
  verdict: string;
  score_total: number | null;
  cap_applied: string | null;
  publishable_findings: Finding[];
  finalized_at: string;
  founder_summary?: { pattern: string; repeat_backing: RepeatBackingResult };
  advised_summary?: { advised: number; rugs: number; rugs_with_allocation: number; successes: number };
}

let _counter = 0;
function makeAuditId(handle: string): string {
  _counter += 1;
  const h = (handle + _counter).split("").reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
  return "PA-" + h.toString(16).toUpperCase().padStart(8, "0").slice(0, 12);
}

function asClass(x: SubjectClass | string): SubjectClass {
  return x as SubjectClass;
}

export class Audit {
  handle: string;
  roles: SubjectClass[];
  subject_class: SubjectClass | null;
  audit_id: string;
  axisScores: Record<string, AxisScore> = {};
  identity: IdentityConfidence | null = null;
  display_name?: string;

  private ventures: Venture[] = [];
  private testimonials: Testimonial[] = [];
  private advisedProjects: AdvisedProject[] = [];
  private clientEngagements: ClientEngagement[] = [];
  private wallets: Wallet[] = [];
  private promotions: Promotion[] = [];
  private associates: Associate[] = [];
  private findings: Finding[] = [];

  constructor(
    handle: string,
    opts: { subject_class?: SubjectClass; roles?: SubjectClass[]; display_name?: string } = {},
  ) {
    this.handle = normalizeHandle(handle);
    if (opts.roles) this.roles = opts.roles.map(asClass);
    else if (opts.subject_class != null) this.roles = [asClass(opts.subject_class)];
    else this.roles = [];
    this.subject_class = this.roles[0] ?? null;
    this.display_name = opts.display_name;
    this.audit_id = makeAuditId(this.handle);
  }

  setIdentity(confidence: IdentityConfidence) {
    this.identity = confidence;
  }

  addVenture(v: Venture) {
    this.ventures.push(v);
  }
  addWallet(w: Wallet) {
    this.wallets.push(w);
  }
  addPromotion(p: Promotion) {
    this.promotions.push(p);
  }
  addAssociate(a: AssociateInput) {
    const { associate_handle, ...rest } = a;
    this.associates.push({ ...rest, associate_key: normalizeHandle(associate_handle) });
  }
  addFinding(f: Finding) {
    this.findings.push(f);
  }

  addTestimonial(t: Testimonial): TestimonialVerdict {
    const verdict = classifyTestimonial(t);
    this.testimonials.push({ ...t, corroboration_verdict: verdict });
    return verdict;
  }

  addAdvisedProject(p: AdvisedProject): TestimonialVerdict {
    const verdict = classifyTestimonial(p);
    this.advisedProjects.push({ ...p, corroboration_verdict: verdict });
    return verdict;
  }

  addClientEngagement(c: ClientEngagement) {
    this.clientEngagements.push(c);
  }

  getAssociates() {
    return this.associates;
  }
  getVentures() {
    return this.ventures;
  }
  getTestimonials() {
    return this.testimonials;
  }
  getAdvisedProjects() {
    return this.advisedProjects;
  }
  getWallets() {
    return this.wallets;
  }
  getPromotions() {
    return this.promotions;
  }
  getClientEngagements() {
    return this.clientEngagements;
  }
  getFindings() {
    return this.findings;
  }

  founderSummary() {
    const outcomes = this.ventures.map((v) => v.outcome);
    return {
      pattern: classifyFounderPattern(outcomes),
      repeat_backing: repeatBackingSignal(
        this.ventures.map((v) => ({
          outcome: v.outcome,
          acquirer: v.acquirer ?? null,
          investors: v.investors ?? [],
          current_backers: v.current_backers ?? [],
        })),
      ),
    };
  }

  advisedOutcomeSummary() {
    const rows = this.advisedProjects;
    return {
      advised: rows.length,
      rugs: rows.filter((r) => r.project_outcome === "Rug").length,
      rugs_with_allocation: rows.filter((r) => r.project_outcome === "Rug" && r.paid_or_allocated).length,
      successes: rows.filter((r) => r.project_outcome === "IPO" || r.project_outcome === "Acquisition").length,
    };
  }

  setAxis(axis: string, score: number, rationale = "") {
    const role = classForAxis(axis);
    if (!this.roles.includes(role)) {
      throw new Error(`axis ${axis} belongs to ${role}, not a held role`);
    }
    const w = getProfile(role).axes[axis];
    this.axisScores[axis] = {
      score: Math.max(0, Math.min(score, w)),
      weight: w,
      rationale,
      role,
    };
  }

  corroborationAxis(axis = "I4_testimonial_corroboration"): [number, AxisSummary, string | null] {
    const w = getProfile(SubjectClass.INVESTOR).axes[axis];
    return scoreAxis(
      this.testimonials.map((t) => ({ corroboration_verdict: t.corroboration_verdict! })),
      w,
    );
  }

  advisoryCorroborationAxis(axis = "AD3_relationship_corroboration"): [number, AxisSummary, string | null] {
    const w = getProfile(SubjectClass.ADVISOR).axes[axis];
    return scoreAxis(
      this.advisedProjects.map((t) => ({ corroboration_verdict: t.corroboration_verdict! })),
      w,
    );
  }

  private sharedCapsTriggered(): string[] {
    const keys: string[] = [];
    const has = (ftype: string, status: string, n = 1) =>
      this.findings.some(
        (f) => f.finding_type === ftype && f.verification_status === status && f.independent_source_count >= n,
      );
    if (has("DeceptionFinding", "Verified")) keys.push("deception_confirmed");
    if (has("InvestigatorCallout", "Verified", 2)) keys.push("investigator_verified_fraud");
    return keys;
  }

  private roleCapsTriggered(role: SubjectClass): string[] {
    const keys: string[] = [];
    if (role === SubjectClass.FOUNDER) {
      if (this.ventures.some((v) => v.outcome === VentureOutcome.RUG)) keys.push("prior_rug_as_principal");
      // A founder who builds the means to rug/wash-trade undetectably (bundlers,
      // mixers, volume fakers): the tooling flag, verified from their own product
      // surfaces, is disqualifying on its own.
      if (this.findings.some((f) => f.finding_type === "ManipulationTooling" && f.verification_status === "Verified"))
        keys.push("operates_manipulation_tooling");
    } else if (role === SubjectClass.KOL) {
      if (
        this.wallets.some(
          (w) =>
            w.sold_into_own_promo &&
            (w.link_tier === "SelfDoxxed" || w.link_tier === "InvestigatorAttributed"),
        )
      )
        keys.push("wallet_sold_into_promo");
      if (this.promotions.some((p) => p.paid_promo && p.outcome_was_rug))
        keys.push("paid_to_shill_confirmed_rug");
    } else if (role === SubjectClass.INVESTOR) {
      if (this.testimonials.some((t) => t.corroboration_verdict === TestimonialVerdict.CONTRADICTED))
        keys.push("contradicted_testimonial");
      if (this.findings.some((f) => f.finding_type === "PredatoryTerms" && f.verification_status === "Verified"))
        keys.push("predatory_terms_verified");
    } else if (role === SubjectClass.ADVISOR) {
      if (this.advisedProjects.some((p) => p.corroboration_verdict === TestimonialVerdict.CONTRADICTED))
        keys.push("claimed_advisory_contradicted");
      if (this.advisedProjects.some((p) => p.project_outcome === "Rug" && p.paid_or_allocated))
        keys.push("advised_rug_with_allocation");
    } else if (role === SubjectClass.AGENCY) {
      if (this.clientEngagements.some((c) => c.manipulation_service_flag))
        keys.push("market_manipulation_services");
    }
    return keys;
  }

  private identityBlocks(): boolean {
    return this.identity === "SuspectedImpersonation";
  }

  finalize(): AuditReport {
    const identity = this.identity;
    const sharedKeys = this.sharedCapsTriggered();
    const doxBonus = identity ? DOX_BONUS[identity] ?? 0 : 0;

    const roleReports: RoleReport[] = [];
    for (const role of this.roles) {
      const axes: Record<string, AxisScore> = {};
      for (const [ax, a] of Object.entries(this.axisScores)) {
        if (classForAxis(ax) === role) axes[ax] = a;
      }
      if (Object.keys(axes).length === 0) {
        roleReports.push({
          role,
          verdict: "INCOMPLETE",
          raw_total: null,
          score_total: null,
          cap_applied: null,
          dox_bonus: doxBonus,
          axes: {},
        });
        continue;
      }
      const raw = Math.round(Object.values(axes).reduce((a, x) => a + x.score, 0));
      const base = raw + doxBonus;
      const caps = effectiveCaps(role);
      const triggered: [number, string][] = [
        ...this.roleCapsTriggered(role).map((k) => [caps[k], k] as [number, string]),
        ...sharedKeys.map((k) => [SHARED_CAPS[k], k] as [number, string]),
      ];

      let ceiling: number | null = null;
      let applied: string | null = null;
      let total: number;
      if (triggered.length) {
        [ceiling, applied] = triggered.reduce((m, c) => (c[0] < m[0] ? c : m));
        total = Math.min(base, ceiling);
      } else {
        total = Math.min(100, base);
      }

      let verdict: string;
      let published: number | null;
      if (this.identityBlocks()) {
        verdict = "UNVERIFIABLE_IDENTITY";
        published = null;
      } else if (applied && ceiling! <= 10) {
        verdict = "AVOID";
        published = total;
      } else {
        published = total;
        verdict = VERDICT_BANDS.find(([, lo, hi]) => lo <= total && total <= hi)![0];
      }
      roleReports.push({
        role,
        axes,
        raw_total: raw,
        dox_bonus: doxBonus,
        cap_applied: applied,
        score_total: published,
        verdict,
      });
    }

    const scored = roleReports.filter((r) => r.verdict !== "INCOMPLETE");
    let composite = "INCOMPLETE";
    let govRole: string | null = null;
    let govScore: number | null = null;
    let govCap: string | null = null;
    if (scored.length) {
      const governing = scored.reduce((m, r) => (SEVERITY[r.verdict] > SEVERITY[m.verdict] ? r : m));
      composite = governing.verdict;
      govRole = governing.role;
      govScore = governing.score_total;
      govCap = governing.cap_applied;
    }

    const report: AuditReport = {
      audit_id: this.audit_id,
      handle: this.handle,
      roles: this.roles,
      identity_confidence: identity,
      role_reports: roleReports,
      composite_verdict: composite,
      governing_role: govRole,
      governing_score: govScore,
      verdict: composite,
      score_total: govScore,
      cap_applied: govCap,
      publishable_findings: this.publishable(),
      finalized_at: new Date(0).toISOString(),
    };
    if (this.roles.includes(SubjectClass.FOUNDER)) report.founder_summary = this.founderSummary();
    if (this.roles.includes(SubjectClass.ADVISOR)) report.advised_summary = this.advisedOutcomeSummary();
    return report;
  }

  private publishable(): Finding[] {
    return this.findings.filter(
      (f) => f.independent_source_count >= 1 && (f.verification_status === "Verified" || f.verification_status === "Reported"),
    );
  }

  toPanoptes(): { nodes: PanoptesNode[]; edges: PanoptesEdge[] } {
    const nodes: PanoptesNode[] = [{ type: "Person", key: this.handle, roles: this.roles, subject: true }];
    const edges: PanoptesEdge[] = [];
    for (const a of this.associates) {
      nodes.push({ type: "Person", key: a.associate_key, in_cabal_kb: !!a.in_cabal_kb });
      edges.push({ src: this.handle, dst: a.associate_key, type: "ASSOCIATES_WITH", relation: a.relation });
    }
    for (const v of this.ventures) {
      nodes.push({ type: "Company", key: v.project_name, outcome: v.outcome });
      edges.push({ src: this.handle, dst: v.project_name, type: "FOUNDED", outcome: v.outcome });
    }
    for (const p of this.promotions) {
      const key = p.contract_address || "$" + p.ticker;
      nodes.push({ type: "Company", key, was_rug: !!p.outcome_was_rug });
      edges.push({ src: this.handle, dst: key, type: "PROMOTED" });
    }
    for (const t of this.testimonials) {
      if (t.claimed_endorser_handle) {
        nodes.push({ type: "Person", key: t.claimed_endorser_handle });
        edges.push({
          src: t.claimed_endorser_handle,
          dst: this.handle,
          type: "CLAIMED_ENDORSEMENT",
          verdict: t.corroboration_verdict,
          claimed_relation: t.claimed_relationship,
        });
      }
    }
    for (const p of this.advisedProjects) {
      const key = p.project_handle || p.project_name;
      nodes.push({ type: "Company", key, outcome: p.project_outcome });
      edges.push({ src: this.handle, dst: key, type: "ADVISED", verdict: p.corroboration_verdict, outcome: p.project_outcome });
    }
    for (const c of this.clientEngagements) {
      nodes.push({ type: "Company", key: c.client_name });
      edges.push({ src: this.handle, dst: c.client_name, type: "SERVICED", manipulation: !!c.manipulation_service_flag });
    }
    for (const w of this.wallets) {
      const key = `${w.chain}:${w.address}`;
      nodes.push({ type: "Identity", subtype: "Wallet", key, link_tier: w.link_tier });
      edges.push({ src: this.handle, dst: key, type: "CONTROLS_WALLET", tier: w.link_tier });
    }
    for (const f of this.findings.filter((x) => x.finding_type === "DeceptionFinding")) {
      const key = "DF-" + f.claim.slice(0, 10);
      nodes.push({ type: "DeceptionFinding", key, claim: f.claim });
      edges.push({ src: key, dst: this.handle, type: "FLAGS", permanent: true });
    }
    return { nodes, edges };
  }
}

export interface PanoptesNode {
  type: string;
  key: string;
  [k: string]: unknown;
}
export interface PanoptesEdge {
  src: string;
  dst: string;
  type: string;
  [k: string]: unknown;
}

const HANDLE_TAIL = /@?([A-Za-z0-9_]{2,30})$/;
export function normalizeHandle(raw: string): string {
  raw = raw.trim();
  const url = raw.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i);
  if (url) return "@" + url[1].toLowerCase();
  const m = raw.match(HANDLE_TAIL);
  if (m) return "@" + m[1].toLowerCase();
  throw new Error(`cannot normalize handle: ${raw}`);
}
