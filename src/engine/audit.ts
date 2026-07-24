// ARGUS-P multi-role audit orchestrator, based on argus_p/audit.py and extended
// with project-specific scoring and evidence-integrity rules.
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
  /** Artifact IDs from the exact scorer packet that support this score. */
  evidenceRefs?: string[];
  /** Eligible artifacts that materially pull the score in the other direction. */
  counterEvidenceRefs?: string[];
  /** Explicit unresolved evidence gaps, preserved verbatim from the analyst. */
  gaps?: string[];
}

export interface AxisLineage {
  evidenceRefs?: string[];
  counterEvidenceRefs?: string[];
  gaps?: string[];
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

export type EvidenceOrigin = "deterministic" | "model_lead" | "human_verified";

interface EvidenceProvenance {
  // `model_lead` is discovery output only. It may be useful to an analyst, but
  // it can never establish the predicate for a hard cap by itself.
  evidence_origin?: EvidenceOrigin;
  artifact_verified?: boolean;
  /** Provider that established the frozen artifact, when known. */
  provider?: string;
}

export interface TrustGraphPredicate {
  tie_key: string;
  tie_type: string;
  tie_strength: "hard" | "medium" | "weak";
  subject_edge_types: string[];
  other_edge_types: string[];
  other_report_version_id: string;
  other_attestation: "server_collected" | "analyst_submitted" | "legacy_unattested";
  other_completeness: "complete" | "partial" | "failed";
  other_verdict: string;
}

/**
 * Structured protocol-loss data used by deterministic project risk rules.
 * Keep this separate from the prose claim so a dollar-sign regex can never
 * decide a final score ceiling.
 */
export interface ProtocolIncidentPredicate {
  incident_date: string | null;
  observed_at: string;
  amount_usd: number | null;
  reference_tvl_usd: number | null;
  recovery_status: "recorded_full_return" | "no_recorded_full_return";
  returned_amount_usd: number | null;
}

/**
 * Entity attribution for a finding. Related-entity evidence is deliberately a
 * separate class from evidence about the audited subject: an allegation about
 * an associate or venture must never be silently rewritten as an allegation
 * about the subject.
 */
export interface FindingScope {
  scope: "direct_subject" | "related_entity";
  target_entity_key: string;
  target_entity_type: "person" | "project";
  relationship_to_subject: "self" | "associate" | "venture";
  /** Human-readable relationship captured at discovery time. */
  relationship_label?: string;
}

export interface Finding extends EvidenceProvenance {
  finding_type: string;
  claim: string;
  source_url: string;
  source_date: string;
  source_author?: string;
  verification_status: string; // Verified | Reported | Rumor
  independent_source_count: number;
  polarity: number;
  /** Hash of a frozen internal artifact when there is no external source URL. */
  content_hash?: string;
  /** Structured, engine-validated predicate for a frozen cross-report graph cap. */
  trust_graph?: TrustGraphPredicate;
  /** Structured, provider-frozen predicate for protocol-loss severity rules. */
  protocol_incident?: ProtocolIncidentPredicate;
  /** Exact entity the claim is about and how that entity relates to the subject. */
  finding_scope?: FindingScope;
  // Model output may surface a lead, but only a deterministically fetched (or
  // human-verified) artifact is eligible to govern a hard cap.
}

export interface Venture extends EvidenceProvenance {
  project_name: string;
  x_handle?: string;   // the venture's own X account (canonical bridge key)
  domain?: string;     // the venture's website host (secondary bridge key)
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

export interface Testimonial extends EvidenceProvenance {
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

export interface ClientEngagement extends EvidenceProvenance {
  client_name: string;
  service_type: string;
  period?: string;
  client_outcome?: VentureOutcome | string | null;
  manipulation_service_flag?: boolean;
  evidence_url?: string;
  notes?: string;
}

export interface Wallet extends EvidenceProvenance {
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

export interface Promotion extends EvidenceProvenance {
  ticker: string;
  contract_address?: string;
  chain?: string;
  paid_promo?: boolean;
  outcome_was_rug?: boolean;
  perf_current?: number;
  notes?: string;
}

export interface AssociateInput extends EvidenceProvenance {
  associate_handle: string;
  relation: string;
  in_cabal_kb?: boolean;
  evidence_url?: string;
  notes?: string;
}

export interface Associate extends EvidenceProvenance {
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
  /** Discovery/context rows retained for analyst follow-up, never published as subject findings. */
  investigative_leads: Finding[];
  finalized_at: string;
  founder_summary?: { pattern: string; repeat_backing: RepeatBackingResult };
  advised_summary?: { advised: number; rugs: number; rugs_with_allocation: number; successes: number };
}

let _counter = 0;
function makeAuditId(handle: string): string {
  _counter += 1;
  // Immutable report idempotency keys must survive serverless cold starts. The
  // previous handle+process-counter hash repeated whenever a fresh instance
  // audited the same first handle, causing unrelated runs to share an ID.
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `PA-${uuid.replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  const seed = `${handle}:${Date.now()}:${_counter}:${Math.random()}`;
  const h = seed.split("").reduce((value, char) => (value * 33 + char.charCodeAt(0)) >>> 0, 5381);
  return `PA-${Date.now().toString(36).toUpperCase()}-${h.toString(16).toUpperCase().padStart(8, "0")}`;
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
  private finalizedAt?: string;

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
    // Associates arrive as provider identifiers, not only X handles: GitHub org
    // logins allow hyphens and single characters. Those must key by canonical
    // name (never a truncated @handle, which would bridge the trust graph to an
    // unrelated account) and must not fail the audit at finalize. Blank input
    // stays an error: an empty key would falsely merge across audits.
    let associate_key: string;
    try {
      associate_key = normalizeHandle(associate_handle);
    } catch (err) {
      associate_key = canonicalEntityKey({ name: associate_handle });
      if (!associate_key) throw err;
    }
    this.associates.push({ ...rest, associate_key });
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

  setAxis(axis: string, score: number, rationale = "", lineage: AxisLineage = {}) {
    const role = classForAxis(axis);
    if (!this.roles.includes(role)) {
      throw new Error(`axis ${axis} belongs to ${role}, not a held role`);
    }
    const w = getProfile(role).axes[axis];
    if (!Number.isFinite(score)) throw new Error(`axis ${axis} score must be finite`);
    this.axisScores[axis] = {
      score: Math.max(0, Math.min(score, w)),
      weight: w,
      rationale,
      role,
      ...(lineage.evidenceRefs ? { evidenceRefs: [...lineage.evidenceRefs] } : {}),
      ...(lineage.counterEvidenceRefs ? { counterEvidenceRefs: [...lineage.counterEvidenceRefs] } : {}),
      ...(lineage.gaps ? { gaps: [...lineage.gaps] } : {}),
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
        (f) => this.findingTargetsSubject(f) && f.finding_type === ftype && f.verification_status === status && f.independent_source_count >= n && this.findingHasVerifiedArtifact(f),
      );
    if (has("DeceptionFinding", "Verified")) keys.push("deception_confirmed");
    if (has("InvestigatorCallout", "Verified", 2)) keys.push("investigator_verified_fraud");
    const frozenGraphFinding = (strength: "hard" | "medium") =>
      this.findings.some((finding) => {
        const graph = finding.trust_graph;
        const tieKey = typeof graph?.tie_key === "string" ? graph.tie_key.trim() : "";
        const hardKey = /^(?:code:|email:|wallet:|funder:|mint:|token:|ga:|gtm:|adsense:|fbpixel:).+/i.test(tieKey);
        const weakKey = /^(?:holder|amm|dex|pool|lp|market)(?::|$)|^(?:ip|favicon):/i.test(tieKey);
        const tieType = typeof graph?.tie_type === "string" ? graph.tie_type.trim() : "";
        const relationshipEdges = new Set([
          "TEAM",
          "WORKED_ON",
          "ASSOCIATES_WITH",
          "FOUNDED",
          "ADVISED",
          "SERVICED",
          "CLAIMED_ENDORSEMENT",
        ]);
        const hasRelationshipEdge = (value: unknown) =>
          Array.isArray(value) && value.some((edgeType) => typeof edgeType === "string" && relationshipEdges.has(edgeType));
        const personTie = tieType === "Person"
          && hasRelationshipEdge(graph?.subject_edge_types)
          && hasRelationshipEdge(graph?.other_edge_types);
        const domainTie = /^(?:Domain|Website)$/i.test(tieType)
          && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(tieKey)
          && Array.isArray(graph?.subject_edge_types)
          && graph.subject_edge_types.includes("LINKS")
          && Array.isArray(graph?.other_edge_types)
          && graph.other_edge_types.includes("LINKS");
        const exactStrength = strength === "hard"
          ? hardKey && tieType.length > 0
          : tieKey.length > 0 && !hardKey && !weakKey && (personTie || domainTie);
        const validEdgeTypes = (value: unknown): value is string[] =>
          Array.isArray(value)
          && value.length > 0
          && value.every((edgeType) => typeof edgeType === "string" && edgeType.trim().length > 0);
        return this.findingTargetsSubject(finding)
        && finding.finding_type === "TrustGraphConnection"
        && finding.verification_status === "Verified"
        && finding.independent_source_count >= 1
        && finding.evidence_origin === "deterministic"
        && finding.artifact_verified === true
        && typeof finding.content_hash === "string"
        && /^[a-f0-9]{64}$/i.test(finding.content_hash)
        && graph?.tie_strength === strength
        && exactStrength
        && validEdgeTypes(graph?.subject_edge_types)
        && validEdgeTypes(graph?.other_edge_types)
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(graph.other_report_version_id)
        && graph.other_attestation === "server_collected"
        && graph.other_completeness === "complete"
        && (graph.other_verdict === "FAIL" || graph.other_verdict === "AVOID");
      });
    if (frozenGraphFinding("hard")) keys.push("trust_graph_hard_link");
    if (frozenGraphFinding("medium")) keys.push("trust_graph_medium_link");
    return keys;
  }

  private artifactIsEligible(
    url: string | undefined,
    origin: EvidenceOrigin | undefined,
    artifactVerified: boolean | undefined,
  ): boolean {
    if (origin === "model_lead" || artifactVerified === false) return false;
    // Existing deterministic fixtures predate the provenance fields, so a real
    // source URL remains the backwards-compatible artifact requirement. New
    // model-derived rows are tagged model_lead and fail closed above.
    return !!url && /^https?:\/\/[^\s]+$/i.test(url);
  }

  private findingHasVerifiedArtifact(f: Finding): boolean {
    return this.artifactIsEligible(f.source_url, f.evidence_origin, f.artifact_verified);
  }

  private findingTargetsSubject(f: Finding): boolean {
    const scope = f.finding_scope;
    // Curated and deterministic records created before entity scoping were
    // direct subject findings. Preserve those fixtures while requiring every
    // newly scoped row to prove both its relationship and exact target.
    if (!scope) return true;
    if (scope.scope !== "direct_subject" || scope.relationship_to_subject !== "self") return false;
    try {
      return normalizeHandle(scope.target_entity_key) === this.handle;
    } catch {
      return false;
    }
  }

  private roleCapsTriggered(role: SubjectClass): string[] {
    const keys: string[] = [];
    if (role === SubjectClass.FOUNDER) {
      // Cold-intake outcomes are model-extracted claims. Even if the model calls
      // one a rug, it stays a lead until a separate collector (or a human) has
      // verified the underlying artifact. Legacy curated fixtures have no
      // provenance marker and remain trusted for calibration compatibility.
      if (this.ventures.some((v) =>
        v.outcome === VentureOutcome.RUG &&
        v.evidence_origin !== "model_lead" &&
        v.artifact_verified !== false,
      )) keys.push("prior_rug_as_principal");
      // A founder who builds the means to rug/wash-trade undetectably (bundlers,
      // mixers, volume fakers): the tooling flag, verified from their own product
      // surfaces, is disqualifying on its own.
      if (this.findings.some((f) => this.findingTargetsSubject(f) && f.finding_type === "ManipulationTooling" && f.verification_status === "Verified" && this.findingHasVerifiedArtifact(f)))
        keys.push("operates_manipulation_tooling");
    } else if (role === SubjectClass.PROJECT) {
      const recentCriticalLoss = this.findings.some((finding) => {
        const incident = finding.protocol_incident;
        if (
          !incident
          || !this.findingTargetsSubject(finding)
          || finding.finding_type !== "ProtocolSecurityIncident"
          || finding.verification_status !== "Verified"
          || finding.independent_source_count < 1
          || finding.evidence_origin !== "deterministic"
          || finding.artifact_verified !== true
          || !this.findingHasVerifiedArtifact(finding)
          || incident.recovery_status !== "no_recorded_full_return"
          || typeof incident.amount_usd !== "number"
          || !Number.isFinite(incident.amount_usd)
          || incident.amount_usd <= 0
        ) return false;

        const incidentAt = incident.incident_date ? Date.parse(incident.incident_date) : Number.NaN;
        const observedAt = Date.parse(incident.observed_at);
        const ageDays = (observedAt - incidentAt) / 86_400_000;
        if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 365) return false;

        const tvl = typeof incident.reference_tvl_usd === "number"
          && Number.isFinite(incident.reference_tvl_usd)
          && incident.reference_tvl_usd > 0
          ? incident.reference_tvl_usd
          : null;
        const catastrophicRelativeLoss = tvl !== null
          && incident.amount_usd >= 10_000_000
          && incident.amount_usd >= tvl * 0.25;
        return incident.amount_usd >= 100_000_000 || catastrophicRelativeLoss;
      });
      if (recentCriticalLoss) keys.push("recent_critical_protocol_loss_without_recorded_recovery");
    } else if (role === SubjectClass.KOL) {
      if (
        this.wallets.some(
          (w) =>
            w.sold_into_own_promo &&
            (w.link_tier === "SelfDoxxed" || w.link_tier === "InvestigatorAttributed") &&
            w.evidence_origin !== "model_lead" &&
            w.artifact_verified !== false,
        )
      )
        keys.push("wallet_sold_into_promo");
      if (this.promotions.some((p) =>
        p.paid_promo && p.outcome_was_rug &&
        p.evidence_origin !== "model_lead" &&
        p.artifact_verified !== false,
      ))
        keys.push("paid_to_shill_confirmed_rug");
    } else if (role === SubjectClass.INVESTOR) {
      if (this.testimonials.some((t) =>
        t.corroboration_verdict === TestimonialVerdict.CONTRADICTED &&
        t.evidence_origin !== "model_lead" &&
        t.artifact_verified !== false,
      ))
        keys.push("contradicted_testimonial");
      if (this.findings.some((f) => this.findingTargetsSubject(f) && f.finding_type === "PredatoryTerms" && f.verification_status === "Verified" && this.findingHasVerifiedArtifact(f)))
        keys.push("predatory_terms_verified");
    } else if (role === SubjectClass.ADVISOR) {
      if (this.advisedProjects.some((p) =>
        p.corroboration_verdict === TestimonialVerdict.CONTRADICTED &&
        p.evidence_origin !== "model_lead" &&
        p.artifact_verified !== false,
      ))
        keys.push("claimed_advisory_contradicted");
      if (this.advisedProjects.some((p) =>
        p.project_outcome === "Rug" && p.paid_or_allocated &&
        p.evidence_origin !== "model_lead" &&
        p.artifact_verified !== false,
      ))
        keys.push("advised_rug_with_allocation");
    } else if (role === SubjectClass.AGENCY) {
      if (this.clientEngagements.some((c) => c.manipulation_service_flag && this.artifactIsEligible(c.evidence_url, c.evidence_origin, c.artifact_verified)))
        keys.push("market_manipulation_services");
    }
    return keys;
  }

  private identityBlocks(): boolean {
    return this.identity === "SuspectedImpersonation";
  }

  finalize(): AuditReport {
    const finalizedAt = this.finalizedAt ?? (this.finalizedAt = new Date().toISOString());
    const identity = this.identity;
    const sharedKeys = this.sharedCapsTriggered();
    const identityBonus = identity ? DOX_BONUS[identity] ?? 0 : 0;

    const roleReports: RoleReport[] = [];
    for (const role of this.roles) {
      // A project's accountable team and operating identity are already scored
      // directly in P1. Applying the person-level disclosure bonus again would
      // double-count identity and can move a weak raw project score across a
      // verdict boundary without any change in project fundamentals.
      const doxBonus = role === SubjectClass.PROJECT ? 0 : identityBonus;
      const axes: Record<string, AxisScore> = {};
      for (const [ax, a] of Object.entries(this.axisScores)) {
        if (classForAxis(ax) === role) axes[ax] = a;
      }
      const expectedAxes = Object.keys(getProfile(role).axes);
      const complete = expectedAxes.every((axis) => axes[axis] && Number.isFinite(axes[axis].score));
      if (!complete || Object.keys(axes).length !== expectedAxes.length) {
        roleReports.push({
          role,
          verdict: "INCOMPLETE",
          raw_total: null,
          score_total: null,
          cap_applied: null,
          dox_bonus: doxBonus,
          axes,
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
    if (scored.length === roleReports.length && roleReports.length > 0) {
      const governing = scored.reduce((current, candidate) => {
        const candidateSeverity = SEVERITY[candidate.verdict];
        const currentSeverity = SEVERITY[current.verdict];
        if (candidateSeverity !== currentSeverity) return candidateSeverity > currentSeverity ? candidate : current;
        // Two PASS (or CAUTION/FAIL) roles are not interchangeable. The weaker
        // applicable lens governs so a strong founder score cannot hide a weaker
        // investor score merely because Founder appeared first in the role list.
        const candidateScore = candidate.score_total;
        const currentScore = current.score_total;
        if (candidateScore != null && currentScore != null && candidateScore !== currentScore) {
          return candidateScore < currentScore ? candidate : current;
        }
        return current;
      });
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
      investigative_leads: this.investigativeLeads(),
      finalized_at: finalizedAt,
    };
    if (this.roles.includes(SubjectClass.FOUNDER)) report.founder_summary = this.founderSummary();
    if (this.roles.includes(SubjectClass.ADVISOR)) report.advised_summary = this.advisedOutcomeSummary();
    return report;
  }

  private publishable(): Finding[] {
    return this.findings.filter(
      (f) => this.findingTargetsSubject(f)
        && f.evidence_origin !== "model_lead"
        && f.artifact_verified !== false
        && f.independent_source_count >= 1
        && (f.verification_status === "Verified" || f.verification_status === "Reported"),
    );
  }

  private investigativeLeads(): Finding[] {
    return this.findings
      .filter((f) => f.evidence_origin === "model_lead" || !this.findingTargetsSubject(f))
      // A model role guess with no artifact or candidate URL is internal
      // routing state, not a customer-facing lead. Persist only something an
      // investigator can actually open or trace.
      .filter((f) => {
        if (f.content_hash?.trim()) return true;
        try {
          const source = new URL(f.source_url);
          return (source.protocol === "https:" || source.protocol === "http:")
            && Boolean(source.hostname);
        } catch {
          return false;
        }
      })
      // Keep the raw immutable report useful to exports and Ask ARGUS, not just
      // the React view that collapses this section. Direct-subject leads rank
      // ahead of related-entity leads and the dossier stays bounded.
      .sort((left, right) =>
        Number(this.findingTargetsSubject(right)) - Number(this.findingTargetsSubject(left)))
      .slice(0, 8);
  }

  toPanoptes(): { nodes: PanoptesNode[]; edges: PanoptesEdge[] } {
    const projectSubject = this.roles.length === 1 && this.roles[0] === SubjectClass.PROJECT;
    const nodes: PanoptesNode[] = [{
      type: projectSubject ? "Company" : "Person",
      ...(projectSubject ? { subtype: "Project" } : {}),
      key: this.handle,
      roles: this.roles,
      subject: true,
    }];
    const edges: PanoptesEdge[] = [];
    for (const a of this.associates) {
      nodes.push({ type: "Person", key: a.associate_key, in_cabal_kb: !!a.in_cabal_kb });
      edges.push({ src: this.handle, dst: a.associate_key, type: "ASSOCIATES_WITH", relation: a.relation });
    }
    for (const v of this.ventures) {
      const key = canonicalEntityKey({ handle: v.x_handle, domain: v.domain, name: v.project_name });
      nodes.push({ type: "Company", key, label: v.project_name, outcome: v.outcome });
      const role = (v.role ?? "").toLowerCase();
      const edgeType = /\b(?:founder|co-?founder|founding team)\b/.test(role)
        ? "FOUNDED"
        : /\b(?:investor|backer|angel investor|limited partner)\b|\binvested in\b/.test(role)
          ? "INVESTED_IN"
          : /advisor|adviser|board/.test(role)
            ? "ADVISED"
            : "WORKED_ON";
      edges.push({ src: this.handle, dst: key, type: edgeType, role: v.role, outcome: v.outcome });
    }
    for (const p of this.promotions) {
      // Strip an existing $ before re-prefixing — a ticker stored as "$SUSHI"
      // was rendering "$$SUSHI" in the connection web.
      const key = p.contract_address || "$" + (p.ticker ?? "").replace(/^\$+/, "");
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
      const key = canonicalEntityKey({ handle: p.project_handle, name: p.project_name });
      nodes.push({ type: "Company", key, label: p.project_name, outcome: p.project_outcome });
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
    for (const f of this.findings.filter((x) => this.findingTargetsSubject(x) && x.finding_type === "DeceptionFinding")) {
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

// Anchored at both ends: a partial match must never truncate a non-handle
// identifier onto an unrelated X handle ("ethereum-optimism" is not "@optimism").
const BARE_HANDLE = /^@?([A-Za-z0-9_]{2,30})$/;
export function normalizeHandle(raw: string): string {
  raw = raw.trim();
  const url = raw.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i);
  if (url) return "@" + url[1].toLowerCase();
  const m = raw.match(BARE_HANDLE);
  if (m) return "@" + m[1].toLowerCase();
  throw new Error(`cannot normalize handle: ${raw}`);
}

// The graph bridges two audits only when they emit the SAME node key for the same
// entity — so an entity must resolve to a stable identifier, never a fuzzy name
// ("Deks" vs "Deks Protocol" never merge). Prefer the X handle (matches how token/
// recon audits key a project's account, so a person→project→token web connects),
// then the domain host, and only fall back to a normalized name. Exported so every
// contribution builder can key entities the same way.
export function canonicalEntityKey(opts: { handle?: string | null; domain?: string | null; name?: string | null }): string {
  const h = (opts.handle ?? "").replace(/^@/, "").trim().toLowerCase();
  if (/^[a-z0-9_]{2,30}$/.test(h)) return "@" + h;
  const d = (opts.domain ?? "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").trim().toLowerCase();
  if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return d;
  return (opts.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
