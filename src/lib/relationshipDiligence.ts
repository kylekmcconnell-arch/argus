import type { BasicFact, WebTeamMember } from "../data/evidence";

/** Relationships are multidimensional: a person can be a founder, contractor and shareholder. */
export const RELATIONSHIPS = {
  founder: "Founder", employee: "Employee", executive: "Executive", board_director: "Board director",
  board_observer: "Board observer", owner: "Owner / shareholder", governance: "Governance participant",
  advisor: "Advisor", mentor: "Mentor", contractor: "Contractor / fractional", volunteer: "Volunteer / contributor",
  equity_investor: "Equity investor", token_investor: "Token investor", investor: "Investor (instrument unspecified)",
  lender: "Lender", grantmaker: "Grant provider", sponsor: "Sponsor", accelerator: "Accelerator / incubator",
  infrastructure: "Infrastructure / technology supplier", credits_program: "Platform credits programme",
  integration: "Integration partner", distributor: "Distributor / reseller", affiliate: "Referral affiliate",
  development_partner: "Co-development partner", partner: "Partner (scope unspecified)",
  customer: "Customer", pilot_customer: "Pilot / design partner", user: "User (payment unspecified)",
  community: "Community participant", promoter: "Promoter / ambassador", agency: "Agency",
  legal_firm: "Legal counsel", accountant: "Accounting / tax provider", auditor: "Auditor / reviewer",
  trader: "Trader", holder: "Token holder", market_maker: "Market maker", liquidity_provider: "Liquidity provider",
  exchange: "Exchange / listing venue", custodian: "Custodian", validator: "Validator / node operator",
  launchpad: "Launchpad / distribution service", acquirer: "Acquirer", seller: "Seller / acquisition target",
  administrator: "Administrator / liquidator", unknown: "Relationship unresolved",
} as const;
export type RelationshipKind = keyof typeof RELATIONSHIPS;
export type RelationshipCapacity = "full_time" | "part_time" | "fractional" | "contract" | "volunteer" | "unknown";
export interface RoleClassification {
  relationships: RelationshipKind[];
  functions: string[];
  capacity: RelationshipCapacity;
  boundary: "internal_claim" | "external_claim" | "mixed_or_unspecified";
  temporal: "current_claim" | "former_claim" | "unknown";
}
const rules: Array<[RelationshipKind, RegExp]> = [
  ["founder", /\b(?:co[- ]?)?founder\b|\bfounded\b/i],
  ["executive", /\b(?:ceo|cto|coo|cfo|cmo|ciso|cio|chief|president|executive)\b/i],
  ["board_director", /\b(?:board (?:member|director)|director of the board|independent director|non.executive director)\b/i],
  ["board_observer", /\bboard observer\b/i], ["owner", /\b(?:shareholder|beneficial owner|co-owner)\b/i],
  ["governance", /\b(?:dao delegate|governance delegate|multisig signer|voting controller)\b/i],
  ["advisor", /\b(?:advisor|adviser|advisory)\b/i], ["mentor", /\bmentor\b/i],
  ["contractor", /\b(?:contractor|freelancer|fractional|outsourced|consultant)\b/i],
  ["volunteer", /\b(?:volunteer|contributor|bounty worker)\b/i],
  ["equity_investor", /\b(?:equity investor|safe investor|convertible investor|venture investor)\b/i],
  ["token_investor", /\b(?:token investor|token purchaser|saft investor)\b/i],
  ["investor", /\b(?:investor|invested|investment fund|venture capital)\b/i],
  ["lender", /\b(?:lender|creditor|debt financing)\b/i], ["grantmaker", /\b(?:grantmaker|grant provider|grantor)\b/i],
  ["sponsor", /\bsponsor\b/i], ["accelerator", /\b(?:accelerator|incubator|accelerated by|incubated by)\b/i],
  ["credits_program", /\b(?:cloud credits|platform credits|startup credits|compute credits|aws activate|nvidia inception|google for startups cloud)\b/i],
  ["infrastructure", /\b(?:infrastructure|cloud provider|hosting provider|api provider|technology supplier|white.label provider|rpc provider|hardware supplier)\b/i],
  ["integration", /\bintegration partner\b/i], ["distributor", /\b(?:distributor|reseller)\b/i],
  ["affiliate", /\b(?:affiliate|referral partner)\b/i], ["development_partner", /\b(?:co.development|joint venture)\b/i],
  ["partner", /\bpartner\b/i], ["pilot_customer", /\b(?:pilot customer|design partner)\b/i],
  ["customer", /\b(?:customer|client)\b/i], ["user", /\b(?:user|free user)\b/i],
  ["community", /\b(?:community member|moderator|community participant)\b/i],
  ["promoter", /\b(?:promoter|ambassador|influencer|shiller|raider)\b/i], ["agency", /\bagency\b/i],
  ["legal_firm", /\b(?:law firm|legal counsel|external counsel)\b/i], ["accountant", /\b(?:accounting firm|tax adviser|accountant)\b/i],
  ["auditor", /\b(?:auditor|audit firm|security reviewer|penetration tester|certification body)\b/i],
  ["trader", /\btrader\b/i], ["holder", /\b(?:token holder|tokenholder)\b/i], ["market_maker", /\bmarket maker\b/i],
  ["liquidity_provider", /\bliquidity provider\b/i], ["exchange", /\b(?:exchange|listing venue)\b/i],
  ["custodian", /\bcustodian\b/i], ["validator", /\b(?:validator|node operator)\b/i],
  ["launchpad", /\blaunchpad\b/i], ["acquirer", /\b(?:acquirer|acquired by)\b/i],
  ["seller", /\b(?:acquisition target|selling shareholder)\b/i], ["administrator", /\b(?:administrator|liquidator|receiver)\b/i],
  ["employee", /\b(?:employee|staff|employed)\b/i],
];
const functions: Array<[string, RegExp]> = [
  ["Leadership", /\b(?:founder|ceo|president|chief executive)\b/i],
  ["Engineering", /\b(?:engineer|engineering|developer|cto|architect|programmer)\b/i],
  ["Research", /\b(?:research|researcher|scientist|cryptographer)\b/i],
  ["Security", /\b(?:security|ciso|cryptographer|penetration)\b/i],
  ["Product / design", /\b(?:product|designer|design)\b/i],
  ["Marketing / PR", /\b(?:marketing|cmo|public relations|pr|socials)\b/i],
  ["Sales / BD", /\b(?:sales|business development|bd|commercial)\b/i],
  ["Operations", /\b(?:operations|ops|coo)\b/i], ["Finance", /\b(?:finance|cfo|accountant|treasury)\b/i],
  ["Legal / compliance", /\b(?:legal|compliance|counsel|lawyer)\b/i],
  ["People / HR", /\b(?:hr|human resources|recruiter|recruiting|people operations)\b/i],
  ["Token / mechanism design", /\b(?:tokenomics|token designer|token design|mechanism design|blockchain economist)\b/i],
  ["Community", /\b(?:community|moderator|ambassador)\b/i],
];
export function classifyRelationship(role: string): RoleClassification {
  // Preserve text as a claim; the classifier is not a verifier. Negated/unclear roles stay unresolved.
  if (/\b(?:not an?|never|rumou?red|possible|unconfirmed)\b/i.test(role)) return { relationships: ["unknown"], functions: [], capacity: "unknown", boundary: "mixed_or_unspecified", temporal: "unknown" };
  let relationships = rules.filter(([, pattern]) => pattern.test(role)).map(([kind]) => kind);
  if (relationships.includes("equity_investor") || relationships.includes("token_investor")) relationships = relationships.filter(r => r !== "investor");
  if (relationships.includes("pilot_customer")) relationships = relationships.filter(r => r !== "customer" && r !== "partner");
  if (relationships.some(r => ["integration", "distributor", "affiliate", "development_partner"].includes(r))) relationships = relationships.filter(r => r !== "partner");
  const capacity = /\bfractional\b/i.test(role) ? "fractional" : /\b(?:contractor|freelancer|outsourced|consultant)\b/i.test(role) ? "contract" : /\bvolunteer\b/i.test(role) ? "volunteer" : /\bpart.time\b/i.test(role) ? "part_time" : /\bfull.time\b/i.test(role) ? "full_time" : "unknown";
  const internal = relationships.some(r => ["employee", "executive"].includes(r));
  const external = relationships.some(r => !["founder", "employee", "executive", "owner", "governance", "board_director", "board_observer"].includes(r));
  return { relationships: relationships.length ? relationships : ["unknown"], functions: functions.filter(([, pattern]) => pattern.test(role)).map(([label]) => label), capacity,
    boundary: external && !internal ? "external_claim" : internal && !external ? "internal_claim" : "mixed_or_unspecified",
    temporal: /\b(?:former|previous|ex-|departed|resigned)\b/i.test(role) ? "former_claim" : /\b(?:current|since|full.time|employee)\b/i.test(role) ? "current_claim" : "unknown" };
}
export interface RelationshipEvidence {
  id: string;
  party: string;
  partyKey: string; // Local unless an explicit first-party identity is available.
  partyKind: "person" | "organization" | "unknown";
  claim: string;
  classification: RoleClassification;
  support: "source_backed_claim" | "discovery_lead" | "conflicted";
  sources: Array<{ url: string; excerpt?: string; capturedAt?: string; contentHash?: string; relation?: "supports" | "contradicts" }>;
  concern?: { kind: "claim_evidence_gap"; detail: string };
}
export interface TeamDiligence {
  version: 1;
  linkedPeople?: import("./linkedPersonEvidence.js").LinkedPersonEvidence[];
  linkedPeopleStatus?: "read" | "unavailable" | "not_requested";
  relationships: RelationshipEvidence[];
  capabilities: Array<{ function: string; roleRefs: string[]; workRefs: string[]; assessment: string }>;
  questions: string[];
  note: string;
}
const relationshipPredicates = new Set(["founder", "executive", "investor", "funding", "partnership", "governance", "control", "audit"]);
function sourceBacked(fact: BasicFact) { return fact.artifact_verified === true && fact.evidence_origin === "deterministic" && ["verified", "corroborated", "conflicted"].includes(fact.status) && fact.sources.some(s => s.artifactVerified); }

/** No third-party label, corporate logo or role alone is proof of investment, competence or endorsement. */
export function buildTeamDiligence(members: WebTeamMember[], facts: BasicFact[]): TeamDiligence {
  const relationships: RelationshipEvidence[] = members.slice(0, 80).map((member, index) => ({
    id: `roster:${index}`, party: member.name, partyKey: member.handleProvenance === "subject_first_party" && member.handle ? `x:${member.handle.replace(/^@/, "").toLowerCase()}` : `local:roster:${index}`,
    partyKind: member.kind === "org" ? "organization" : "person", claim: member.role,
    classification: classifyRelationship(member.role),
    support: member.artifact_verified === true && member.evidence_origin === "deterministic" && Boolean(member.sourceUrl) ? "source_backed_claim" : "discovery_lead",
    sources: member.sourceUrl ? [{ url: member.sourceUrl, excerpt: member.evidence }] : [],
    ...(/\b(?:investor|equity|backer)\b/i.test(member.role) && /\b(?:cloud|startup|platform|compute) credits\b|\baws activate\b|\bnvidia inception\b/i.test(member.evidence ?? "") ? {
      concern: { kind: "claim_evidence_gap" as const, detail: "The roster advertises financial backing while its passage describes programme support or credits. Establish any separate investment and its instrument; neither fraud nor financial backing is established by this passage alone." },
    } : {}),
  }));
  for (const fact of facts.filter(f => relationshipPredicates.has(f.predicate) && sourceBacked(f)).slice(0, 80)) {
    const claim = [fact.predicate, fact.value, fact.qualifier].filter(Boolean).join(": ");
    const classification = classifyRelationship(claim);
    const hasCreditEvidence = fact.sources.some(s => s.relation === "supports" && /\b(?:cloud|platform|startup|compute) credits\b|\baws activate\b|\bnvidia inception\b/i.test(s.excerpt));
    // A credit mention cannot disprove a separate investment. Flag the scope gap for investigation only.
    const concern = ["investor", "funding"].includes(fact.predicate) && hasCreditEvidence
      ? { kind: "claim_evidence_gap" as const, detail: "A cited passage describes credits or programme participation. Establish any separate capital investment before presenting this relationship as financial backing. This is not a finding of deception." } : undefined;
    relationships.push({ id: fact.factId, party: fact.value, partyKey: `local:fact:${fact.factId}`, partyKind: "unknown", claim, classification,
      support: fact.status === "conflicted" ? "conflicted" : "source_backed_claim", sources: fact.sources.map(s => ({ url: s.url, excerpt: s.excerpt, capturedAt: s.capturedAt, contentHash: s.contentHash, relation: s.relation })), concern });
  }
  const capabilities = ["Leadership", "Engineering", "Security", "Sales / BD", "Operations", "Finance", "Token / mechanism design"].map(fn => {
    const rows = relationships.filter(row => row.id.startsWith("roster:") && row.support === "source_backed_claim" && row.classification.temporal !== "former_claim" && row.classification.functions.includes(fn) && row.classification.relationships.some(kind => ["founder", "executive", "employee", "contractor", "agency", "unknown"].includes(kind)));
    const workRefs = fn === "Engineering" ? rows.filter(row => members[Number(row.id.split(":")[1])]?.github?.confidence === "gold").map(row => row.id) : [];
    return { function: fn, roleRefs: rows.map(row => row.id), workRefs,
      assessment: rows.length ? workRefs.length ? "Attributed public engineering work recorded; delivery capacity still needs assessment." : "Responsibility claimed in a retrieved source; individual delivery evidence is not established by the title." : "Responsibility not established in this snapshot; this does not prove the function is absent." };
  });
  const questions = [
    "Who owns the product's critical responsibilities, and in what full-time, fractional or external capacity?",
    "Which founders have delivered together before, what did each contribute, and what were the outcomes?",
    "Which external providers, contractors or key individuals would be difficult to replace?",
    "Which customer, investor, advisor and partner claims are independently confirmed and still current?",
    "What reference or work sample would most change the team assessment?",
  ];
  if (relationships.some(row => row.concern)) questions.unshift("Reconcile advertised financial backing with evidence of programme credits or services.");
  return { version: 1, relationships, capabilities, questions,
    note: "Relationships describe evidence and claims, not a team score. Person scores are not averaged. Local names are not globally joined; unclear capacity and dates stay unresolved. Capability relevance depends on product and stage." };
}
