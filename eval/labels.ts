// Ground-truth labels for the ARGUS eval harness.
//
// Each label is a PRODUCT judgment about what a correct report must contain for
// a well-known subject. The harness records a real audit once (live), then
// replays it offline forever and asserts these labels. A collection or scoring
// regression that drops a must-surface fact, mis-routes the role, or abstains a
// famous subject turns the assertion red.
//
// Scores are asserted as BANDS, never exact values: the analyst varies a few
// points run-to-run on identical evidence, so an exact-score assertion would be
// flaky. Verdict class, governing role, and must-surface/must-not-appear are
// the stable, meaningful checks.

export interface SubjectLabel {
  /** X handle to audit (the exact string a user would enter). */
  handle: string;
  /** Human name, for readable output only. */
  displayName: string;
  /** Expected governing role, or null when abstention is the correct answer. */
  expectedRole: "FOUNDER" | "PROJECT" | "INVESTOR" | "AGENCY" | null;
  /** A famous subject must never publish INCOMPLETE (Kyle's standing goal). */
  mustNotBeIncomplete: boolean;
  /** Facts a correct report MUST surface somewhere (headline/findings/facts). */
  mustSurface: RegExp[];
  /** Text that must NOT appear (false attribution, wrong adverse finding). */
  mustNotAppear?: RegExp[];
  /** Inclusive floor on the governing score, when the subject should score well. */
  minScore?: number;
  /** Inclusive ceiling on the governing score, when the subject should score low. */
  maxScore?: number;
  /** Which Grok-migration this subject primarily validates (documentation). */
  validates: string;
  /** Whether this subject is cleared to record live now (handle resolvable, label settled). */
  readyToRecord: boolean;
}

export const LABELS: SubjectLabel[] = [
  {
    handle: "@VitalikButerin",
    displayName: "Vitalik Buterin",
    expectedRole: "FOUNDER",
    mustNotBeIncomplete: true,
    mustSurface: [/ethereum/i],
    minScore: 70,
    validates: "founder pipeline end to end; basic-facts on a pseudonymous display name",
    readyToRecord: true,
  },
  {
    handle: "@Uniswap",
    displayName: "Uniswap",
    expectedRole: "PROJECT",
    mustNotBeIncomplete: true,
    mustSurface: [/uniswap/i],
    minScore: 65,
    validates: "Phase 1: findTeamOnSite moved to Claude web_search (project team from the web)",
    readyToRecord: true,
  },
  {
    handle: "@a16zcrypto",
    displayName: "a16z crypto",
    expectedRole: "INVESTOR",
    mustNotBeIncomplete: true,
    mustSurface: [/a16z|andreessen/i],
    minScore: 60,
    validates: "investor/fund-scale discovery moved to Claude web_search (fund recall, task #38)",
    readyToRecord: true,
  },
  {
    // Adverse ground truth. Handle status must be confirmed before recording;
    // a suspended account resolves to INCOMPLETE for the wrong reason. Kept for
    // the adverse-signals (#7) migration, not Phase 1.
    handle: "@stablekwon",
    displayName: "Do Kwon",
    expectedRole: "FOUNDER",
    mustNotBeIncomplete: true,
    mustSurface: [/terra|luna|fraud|charg|collapse|indict/i],
    maxScore: 40,
    validates: "adverse-signals recall (the 'do not miss the fraud' assertion)",
    readyToRecord: false,
  },
];

export function labelFor(handle: string): SubjectLabel | undefined {
  const norm = handle.replace(/^@/, "").toLowerCase();
  return LABELS.find((label) => label.handle.replace(/^@/, "").toLowerCase() === norm);
}
