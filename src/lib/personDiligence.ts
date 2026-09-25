import { personFactBindsAccount } from "./personFactBinding";
import type { Dossier } from "../data/dossier";
import type { DossierBasicFact } from "../data/dossier";

export type PersonLens = "founder" | "engineer" | "investor" | "executive" | "employee" | "commercial" | "operations" | "security" | "legal" | "token_designer" | "community" | "advisor";
export const PERSON_LENSES: Record<PersonLens, { title: string; question: string; evidence: string }> = {
  founder: { title: "Founder", question: "Can they build and lead this venture?", evidence: "Personal execution, prior venture outcomes, repeat collaborators, decisions and control." },
  engineer: { title: "Engineer", question: "What have they personally built and maintained?", evidence: "Attributable contributions, original work, releases, maintenance and security practice." },
  investor: { title: "Investor", question: "What investment responsibility and results are theirs?", evidence: "Principal or partner capacity, decision ownership, board work and attributable realized outcomes." },
  executive: { title: "Executive", question: "What operating responsibility have they demonstrated?", evidence: "Role scope, team leadership, dated delivery and measurable business outcomes." },
  commercial: { title: "Commercial", question: "What customer and distribution outcomes are attributable to them?", evidence: "Personal sales/BD responsibility, retained customers, distribution and dated outcomes; company-wide revenue is not personal performance." },
  operations: { title: "Operations and people", question: "Can they operate the responsibilities this company needs?", evidence: "Operating scope, finance/people processes, hiring, reliability and documented decisions; distinguish internal and outsourced capacity." },
  security: { title: "Security and research", question: "What security or research work is demonstrated?", evidence: "Attributable research, threat models, reviews, incident response and exact technical scope; publications or titles alone do not establish implementation ability." },
  legal: { title: "Legal and compliance", question: "What relevant professional scope is established?", evidence: "Verified professional role, applicable jurisdiction, engagement scope and responsibility; a law-firm logo is not a regulatory approval." },
  token_designer: { title: "Token and mechanism design", question: "What mechanisms have they designed and tested?", evidence: "Attributable economic design, assumptions, simulations, adversarial testing and observed outcomes; token price alone is not design quality." },
  community: { title: "Community and promotion", question: "What is their actual community or promotional role?", evidence: "Moderation, support, paid promotion and affiliate responsibility are separate; audience size is not customer adoption." },
  advisor: { title: "Advisory", question: "What advice, involvement and accountability are documented?", evidence: "Scope, dates, actual work and counterpart confirmation; advisory association does not establish operating responsibility or financial backing." },
  employee: { title: "Professional", question: "What contribution is established within their role?", evidence: "Verified employment dates, responsibilities and attributable work, without inheriting company-wide outcomes." },
};
const sourced = (fact: DossierBasicFact) => ["verified", "corroborated"].includes(fact.status)
  && fact.artifact_verified === true && fact.evidence_origin === "deterministic" && (fact.sources ?? []).some(s => s.artifactVerified);

export function personLenses(dossier: Dossier): PersonLens[] {
  const roleText = (dossier.basicFacts ?? []).filter(f => sourced(f) && personFactBindsAccount(f, dossier) && ["current_role", "executive", "founder"].includes(f.predicate))
    .map(f => `${f.value} ${f.qualifier ?? ""}`).join(" ");
  const roles = (dossier.report?.roles ?? []).map(String);
  const result: PersonLens[] = [];
  if (roles.includes("FOUNDER") || /\b(co.?founder|founded)\b/i.test(roleText)) result.push("founder");
  if (/\b(engineer|developer|cto|programmer|architect)\b/i.test(roleText) || dossier.githubAssessment?.confidence === "gold") result.push("engineer");
  if (roles.includes("INVESTOR")) result.push("investor");
  if (/\b(ceo|coo|cfo|chief|executive|president)\b/i.test(roleText)) result.push("executive");
  if (/\b(marketing|sales|business development|commercial|cmo)\b/i.test(roleText)) result.push("commercial");
  if (/\b(operations|ops|coo|cfo|finance|human resources|hr|recruiting)\b/i.test(roleText)) result.push("operations");
  if (/\b(security|ciso|researcher|cryptographer|scientist)\b/i.test(roleText)) result.push("security");
  if (/\b(legal|lawyer|counsel|compliance)\b/i.test(roleText)) result.push("legal");
  if (/\b(tokenomics|token designer|mechanism design)\b/i.test(roleText)) result.push("token_designer");
  if (/\b(community|moderator|ambassador|promoter|influencer)\b/i.test(roleText)) result.push("community");
  if (/\b(advisor|adviser|mentor)\b/i.test(roleText)) result.push("advisor");
  return result.length ? result : ["employee"];
}
export interface PersonRelationship {
  id: string;
  subject: string;
  target: string;
  targetKey: string;
  relation: string;
  period?: string;
  status: string;
  sources: Array<{ url: string; excerpt?: string; capturedAt?: string }>;
}
/** A local evidence graph only. Unbound names never join the shared graph. */
export function personRelationshipGraph(dossier: Dossier): PersonRelationship[] {
  const output: PersonRelationship[] = [];
  for (const fact of dossier.basicFacts ?? []) {
    if (!sourced(fact) || !["founder", "current_role", "prior_role", "partnership", "investor"].includes(fact.predicate)) continue;
    if (!personFactBindsAccount(fact, dossier)) continue;
    output.push({ id: fact.factId, subject: `x:${dossier.handle.replace(/^@/, "").toLowerCase()}`, target: fact.value,
      targetKey: `unresolved:${fact.factId}`, relation: ({ founder: "founded", current_role: "current role", prior_role: "previous role", partnership: "collaboration", investor: "investment" } as Record<string, string>)[fact.predicate],
      period: fact.qualifier, status: "Source-backed relationship; counterparty identity not independently bound",
      sources: fact.sources.map(source => ({ url: source.url, excerpt: source.excerpt, capturedAt: source.capturedAt })),
    });
  }
  for (const [index, venture] of (dossier.evidence?.ventures ?? []).entries()) {
    if (venture.artifact_verified !== true || venture.evidence_origin === "model_lead" || !venture.evidence_url) continue;
    const key = venture.domain && venture.domain_evidence_origin === "deterministic" ? `domain:${venture.domain.toLowerCase()}` : `unresolved:venture:${index}`;
    output.push({ id: `venture:${index}`, subject: `x:${dossier.handle.replace(/^@/, "").toLowerCase()}`, target: venture.project_name,
      targetKey: key, relation: venture.role, period: venture.period, status: `${venture.outcome}; ${key.startsWith("unresolved:") ? "counterparty identity unresolved" : "recorded venture identity"}`,
      sources: [{ url: venture.evidence_url, excerpt: venture.notes ?? undefined }],
    });
  }
  return output;
}

export function personIdentityStatus(dossier: Dossier): { label: string; detail: string } {
  if (dossier.resolved_name && dossier.identity_binding) return { label: "Public identity linked", detail: `${dossier.resolved_name}. The saved evidence links this public name to the account; this is not a separate legal-document check.` };
  if (/\b(pseudonymous|anonymous|anon)\b/i.test(dossier.bio ?? "")) return { label: "Self-described pseudonymous", detail: "The profile describes a pseudonymous or anonymous identity. No public name-to-account binding is established here." };
  return { label: "Public identity unresolved", detail: "A public name-to-account link has not been established. A display name alone does not establish identity or deliberate anonymity." };
}
