export type BasicFactsAudience = "project" | "founder" | "investor" | "person";

export type BasicFactQuestionDefinition = readonly [predicate: string, question: string];

/**
 * Minimal persisted-question shape used by both the report UI and the server
 * checklist. Keeping this structural avoids making presentation helpers depend
 * on the collector implementation.
 */
export interface BasicFactQuestionOutcomeInput {
  predicate: string;
  status: "answered" | "unanswered";
  providerRuns: ReadonlyArray<{
    state: "succeeded" | "partial" | "completed_empty" | "failed" | "skipped";
  }>;
}

export type BasicFactQuestionOutcome = "answered" | "checked_empty" | "unresolved";

const EXPLICIT_EMPTY_PREDICATES = new Set(["official_token", "public_security"]);

/** Only an explicit completed-empty pass establishes that no answer was found. */
export function basicFactQuestionOutcome(
  entry: BasicFactQuestionOutcomeInput | undefined,
): BasicFactQuestionOutcome {
  if (!entry) return "unresolved";
  if (entry.status === "answered") return "answered";
  // Runs are persisted in chronological order (primary, then targeted repair).
  // A later lead-producing, partial, failed, or skipped repair supersedes an
  // earlier empty pass. Otherwise stale `completed_empty` telemetry can hide a
  // newly discovered but still-unverified asset lead as "none found".
  return entry.providerRuns.at(-1)?.state === "completed_empty"
    ? "checked_empty"
    : "unresolved";
}

export function supportsExplicitEmptyBasicFact(predicate: string): boolean {
  return EXPLICIT_EMPTY_PREDICATES.has(canonicalBasicFactPredicate(predicate));
}

export function explicitEmptyBasicFactAnswer(predicate: string): string {
  switch (canonicalBasicFactPredicate(predicate)) {
    case "official_token":
      return "No verified official crypto token was found in this snapshot.";
    case "public_security":
      return "No verified public security was found in this snapshot.";
    default:
      return "No verified answer was found in the completed search.";
  }
}

const PROJECT_QUESTIONS: readonly BasicFactQuestionDefinition[] = [
  ["official_identity", "What is the project's official identity?"],
  ["product", "What does the project actually do?"],
  ["founder", "Who founded it?"],
  ["executive", "Who operates it today?"],
  ["founded", "When was it founded?"],
  ["launched", "When did the product launch?"],
  ["official_token", "Does it have an official token?"],
  ["network", "Which networks does it run on?"],
  ["legal_entity", "Which legal entity is responsible?"],
  ["funding", "How much funding has it raised?"],
  ["investor", "Who funded it?"],
  ["governance", "Who controls governance and the treasury?"],
  ["audit", "Has the code been independently audited?"],
  ["repository", "Where is the source code maintained?"],
  ["traction", "Is there evidence of real usage?"],
] as const;

const FOUNDER_QUESTIONS: readonly BasicFactQuestionDefinition[] = [
  ["official_identity", "Who is this person?"],
  ["current_role", "What do they lead or control today?"],
  ["founder", "Which companies or projects did they found?"],
  ["prior_role", "What did they do before?"],
  ["track_record", "What outcomes prove their track record?"],
  ["exit", "What exits or failures are verified?"],
  ["control", "What ownership, voting, or treasury control do they hold?"],
  ["conflict_of_interest", "What material conflicts are disclosed?"],
  ["legal_regulatory_event", "What legal or regulatory events actually name them?"],
  ["public_security", "Is a related asset a public security?"],
  ["official_token", "Is an official crypto token tied to a venture they control?"],
  ["education", "What education or credentials are verified?"],
] as const;

const INVESTOR_QUESTIONS: readonly BasicFactQuestionDefinition[] = [
  ["official_identity", "Who is this investor?"],
  ["current_role", "Which firm and fund do they represent today?"],
  ["investor", "Which investments are directly attributed to them?"],
  ["track_record", "What realized outcomes prove their track record?"],
  ["exit", "Which portfolio exits are verified?"],
  ["legal_entity", "Which legal entity manages the fund?"],
  ["control", "What board, voting, or investment control do they hold?"],
  ["conflict_of_interest", "What material conflicts are disclosed?"],
  ["legal_regulatory_event", "What legal or regulatory events name them or their firm?"],
  ["public_security", "Is a related asset a public security?"],
  ["official_token", "Is a crypto token directly tied to a venture they control?"],
] as const;

const PERSON_QUESTIONS: readonly BasicFactQuestionDefinition[] = [
  ["official_identity", "Who is this person?"],
  ["current_role", "What do they do today?"],
  ["prior_role", "What did they do before?"],
  ["founder", "What have they founded?"],
  ["track_record", "What outcomes are verified?"],
  ["legal_regulatory_event", "What material legal or regulatory events name them?"],
  ["official_token", "Is an official token tied to them?"],
] as const;

const QUESTION_SETS: Record<BasicFactsAudience, readonly BasicFactQuestionDefinition[]> = {
  project: PROJECT_QUESTIONS,
  founder: FOUNDER_QUESTIONS,
  investor: INVESTOR_QUESTIONS,
  person: PERSON_QUESTIONS,
};

const QUESTION_MAPS: Record<BasicFactsAudience, ReadonlyMap<string, string>> = {
  project: new Map(PROJECT_QUESTIONS),
  founder: new Map(FOUNDER_QUESTIONS),
  investor: new Map(INVESTOR_QUESTIONS),
  person: new Map(PERSON_QUESTIONS),
};

const PREDICATE_ALIASES: Record<string, string> = {
  identity: "official_identity",
  founders: "founder",
  cofounders: "founder",
  co_founders: "founder",
  team: "executive",
  leadership: "executive",
  core_team: "executive",
  token: "official_token",
  // A supply or allocation disclosure answers its own question. It must never
  // reconcile against the token symbol, where the singleton rule would present
  // it as a fake conflict with the verified official token.
  tokeneconomics: "tokenomics",
  launch_date: "launched",
  launch: "launched",
  founding_date: "founded",
  incorporation: "legal_entity",
  company: "legal_entity",
  investors: "investor",
  fundraising: "funding",
  security_audits: "audit",
  audits: "audit",
  github: "repository",
  repositories: "repository",
  usage: "traction",
  adoption: "traction",
};

export function canonicalBasicFactPredicate(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return PREDICATE_ALIASES[normalized] ?? normalized;
}

function humanizeBasicFactPredicate(value: string): string {
  return canonicalBasicFactPredicate(value).replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

const SUPPLEMENTAL_QUESTIONS: ReadonlyMap<string, string> = new Map([
  ["tokenomics", "What token allocation or supply disclosures are published?"],
  ["vesting", "What vesting, lockup, or unlock schedule is published?"],
  ["treasury", "What treasury assets, reports, wallets, or controls are disclosed?"],
]);

export function basicFactQuestionFor(predicate: string, audience: BasicFactsAudience): string {
  const canonical = canonicalBasicFactPredicate(predicate);
  return QUESTION_MAPS[audience].get(canonical)
    ?? QUESTION_MAPS.project.get(canonical)
    ?? SUPPLEMENTAL_QUESTIONS.get(canonical)
    ?? humanizeBasicFactPredicate(canonical);
}

export function basicFactQuestionsFor(audience: BasicFactsAudience): readonly BasicFactQuestionDefinition[] {
  return QUESTION_SETS[audience];
}
