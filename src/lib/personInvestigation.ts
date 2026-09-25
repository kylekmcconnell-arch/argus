import type { BasicFact } from "../data/evidence";
import { personFactBindsAccount } from "./personFactBinding.js";
import { classifyRelationship, type RoleClassification } from "./relationshipDiligence.js";

export interface CareerEntry {
  factId: string; claim: string; type: string; period: string; recordedAt?: string;
  status: string; role: RoleClassification; sources: BasicFact["sources"];
}
export interface InvestigationQuestion { id: string; question: string; reason: string; priority: "high" | "normal"; factIds: string[] }
export interface PersonInvestigation {
  version: 1; timeline: CareerEntry[]; questions: InvestigationQuestion[];
  referenceQuestions: string[]; note: string;
}
const career = new Set(["current_role", "prior_role", "founder", "executive", "track_record", "exit", "repository", "education", "partnership", "investor"]);
export function buildPersonInvestigation(profile: { handle: string; website?: string; identity_binding?: string }, facts: BasicFact[]): PersonInvestigation {
  const eligible = facts.slice(0, 160).filter(f => f.artifact_verified === true && f.evidence_origin === "deterministic" && ["verified", "corroborated", "conflicted"].includes(f.status) && personFactBindsAccount(f, profile));
  const timeline = eligible.filter(f => career.has(f.predicate)).slice(0, 80).map(f => ({ factId: f.factId, claim: f.value, type: f.predicate,
    // Observation dates are never employment dates; retain the source's period wording without inventing chronology.
    period: f.qualifier || "Event dates and period not established", recordedAt: f.sources[0]?.capturedAt,
    status: f.status, role: classifyRelationship(`${f.predicate === "founder" ? "Founder " : ""}${f.value} ${f.qualifier ?? ""}`), sources: f.sources,
  }));
  const questions: InvestigationQuestion[] = eligible.filter(f => f.status === "conflicted").slice(0, 3).map(f => ({ id: `reconcile:${f.factId}`, question: `Resolve the conflicting evidence for: ${f.value}`, reason: "Retrieved sources disagree; preserve both accounts until resolved.", priority: "high", factIds: [f.factId] }));
  const add = (id: string, question: string, reason: string, predicates: string[]) => {
    if (!eligible.some(f => predicates.includes(f.predicate) && f.status !== "conflicted")) questions.push({ id, question, reason, priority: id === "identity" || id === "responsibility" ? "high" : "normal", factIds: [] });
  };
  if (!profile.identity_binding) add("identity", "Which public professional profiles are explicitly linked to this account?", "A legal name is optional; attributable professional continuity is required.", ["official_identity"]);
  add("responsibility", "What responsibility, capacity and dates are established for the current role?", "Titles alone do not establish authority or time commitment.", ["current_role"]);
  add("contribution", "What work did this person personally deliver, and what happened afterward?", "A company's outcome is not automatically the individual's accomplishment.", ["track_record", "repository"]);
  add("collaboration", "Who worked directly with them, and would those people work with them again?", "A connection is not a reference or evidence of successful collaboration.", ["partnership"]);
  return { version: 1, timeline, questions: questions.slice(0, 8), referenceQuestions: [
    "What did this person personally own and deliver, and during which dates?",
    "Describe a missed commitment or difficult incident and their response.",
    "What would you hire them to do again, and what would you avoid assigning to them?",
    "Would you work with them again, and under what conditions?",
  ], note: "Evidence inventory, not a complete chronological CV. Event periods and capture dates remain separate. Reference questions are preparation only: no outreach has occurred. Private identity, wallet ownership and character are not inferred." };
}
