import type { BasicFact, CollectedEvidence } from "../data/evidence";
import { factTargetsAuditedSubject } from "../intelligence/archetypes";

export interface ProjectAxisTreatment {
  state: "contextual_project";
  axisTreatment: "not_applicable" | "deferred";
  reason: string;
  evidence: string[];
  determinedAt: string;
}
export interface ProjectDiligenceContext {
  version: "2026-09-23.1";
  launch: "fair_launch" | "unknown";
  productStage: "prelaunch" | "unknown";
  sourceUrls: string[];
  axes: Record<string, ProjectAxisTreatment>;
  optionalQuestions: string[];
}

/** Disclosed stage sets expectations, never a ticker, address suffix or tag.
 * Unknown stays unknown. A platform audit never establishes product safety. */
export function deriveProjectDiligenceContext(evidence: Readonly<CollectedEvidence>, determinedAt: string): ProjectDiligenceContext {
  const boundFacts = (evidence.basicFacts ?? []).filter((fact) => factTargetsAuditedSubject(fact, evidence.profile.handle));
  const facts = boundFacts.filter((fact) =>
    (fact.status === "verified" || fact.status === "corroborated")
    && fact.artifact_verified === true && fact.evidence_origin === "deterministic"
    && !fact.sources.some((source) => source.relation === "contradicts"));
  const official = (fact: BasicFact) => fact.sources.filter((source) => source.artifactVerified
    && source.relation === "supports" && source.sourceClass === "official_subject" && /^https?:\/\//.test(source.url));
  const fair = facts.filter((fact) => ["tokenomics", "official_token", "funding", "launched"].includes(fact.predicate))
    .flatMap(official).filter((source) => /\b(?:fair[- ]launch(?:ed)?|launched (?:on|via) pump\.fun)\b/i.test(source.excerpt)
      && !/\b(?:not|never|no longer)\b.{0,25}\b(?:fair[- ]launch|launched)\b/i.test(source.excerpt));
  const product = facts.filter((fact) => ["product", "launched"].includes(fact.predicate));
  const prelaunch = product.flatMap(official).filter((source) =>
    /\b(?:product|platform|protocol|app|mainnet)\b.{0,65}\b(?:coming soon|not yet live|not launched|pre[- ]launch|in development)\b/i.test(source.excerpt));
  const live = product.some((fact) => /\b(?:is live|now live|live on mainnet|accepts deposits|holds user funds)\b/i.test([fact.value, ...official(fact).map((s) => s.excerpt)].join(" ")));
  const context: ProjectDiligenceContext = {
    version: "2026-09-23.1", launch: fair.length ? "fair_launch" : "unknown",
    productStage: prelaunch.length && !live ? "prelaunch" : "unknown",
    sourceUrls: [...new Set([...fair, ...prelaunch].map((source) => source.url))], axes: {}, optionalQuestions: [],
  };
  const has = (...predicates: string[]) => boundFacts.some((fact) => predicates.includes(fact.predicate));
  const adverse = evidence.findings.some((finding) => finding.polarity === -1 && finding.evidence_origin !== "model_lead" && finding.artifact_verified === true);
  if (context.launch === "fair_launch") {
    for (const predicate of ["funding", "investor", "governance", "treasury", "vesting", "legal_entity", "public_security", "conflict_of_interest"]) {
      if (!has(predicate)) context.optionalQuestions.push(predicate);
    }
    if (!has("funding", "investor", "partnership") && !evidence.siteBackers?.names.length
      && !evidence.webTeam?.some((member) => member.kind === "org" || /\b(?:advisor|backer|investor|partner)\b/i.test(member.role))
      && !evidence.protocolFunding?.rounds.length && !evidence.companyEnrichment?.funding?.rounds.length && !adverse) {
      context.axes.P4_backing_and_partners = { state: "contextual_project", axisTreatment: "not_applicable",
        reason: "A source-disclosed fair launch does not require venture funding or named backers. No financing or operating relationship is established to assess on this axis.",
        evidence: fair.map((source) => source.url), determinedAt };
    }
  }
  if (context.productStage === "prelaunch") {
    if (!has("traction", "security_incident") && !evidence.protocolTvl && !adverse) {
      context.axes.P5_traction_and_liveness = { state: "contextual_project", axisTreatment: "deferred",
        reason: "The official source describes the product as not yet launched. Production usage is deferred; live token and security checks remain applicable.",
        evidence: prelaunch.map((source) => source.url), determinedAt };
    }
    for (const predicate of ["launched", "traction"]) if (!has(predicate)) context.optionalQuestions.push(predicate);
  }
  return context;
}

export function projectQuestionContext(predicate: string, context: ProjectDiligenceContext): string | null {
  if (!context.optionalQuestions.includes(predicate)) return null;
  if (predicate === "traction" || predicate === "launched") return "The product is described as prelaunch. A production launch date or usage history is not required yet; this does not describe the live token's age.";
  return "Optional disclosure for a source-disclosed fair launch. Its absence is not an adverse finding or a requirement to obtain venture funding, adopt corporate governance, or publish private treasury accounts. Any specific disclosed commitments remain assessable.";
}

/** Plain-language scope for saved legacy questions as well as new scans. */
export function projectQuestionGuidance(id: string): string | undefined {
  const predicate = id.split(".").at(-1);
  switch (predicate) {
    case "audit": return "Audit scope depends on what is deployed: distinguish the launchpad program from custom contracts, bridges and products handling user funds. A prelaunch product or standard launchpad token does not automatically require its own production audit.";
    case "control": return "For a token, this concerns powers such as minting, freezing, upgrading or moving pooled funds. Corporate boards and shareholder voting apply only when those structures exist.";
    case "conflict_of_interest": return "A related-party arrangement is a transaction with an insider-controlled counterparty or an overlapping financial interest affecting users. Shared team membership alone is not a conflict.";
    case "legal_regulatory_event": return "This asks about specific public proceedings or enforcement events tied to the exact subject, including their stated status. An unanswered search does not suggest wrongdoing.";
    case "funding": case "investor": return "Venture funding is optional. A fair launch, a named backer and a financing round are separate facts; a backer mention does not establish an amount raised.";
    case "treasury": return "Private operating assets are optional disclosures. Assess any explicit governance, reserve-backing or user-fund commitments against their published terms.";
    case "vesting": case "tokenomics": return "Use the documented launch and supply model. Equal reported market cap and FDV alone do not establish unlocked ownership or the absence of future minting.";
    default: return undefined;
  }
}
