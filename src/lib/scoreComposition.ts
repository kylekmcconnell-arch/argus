export interface CompositionRow {
  /** Stable key; also used to build the evidence anchor (#decision-basis-<axis>). */
  axis: string;
  label: string;
  /** Points earned. */
  score: number;
  /** Points available — the dimension's weight in the 100-point rubric. */
  weight: number;
  /** Investor-worded reason the dimension scored where it did. */
  rationale: string;
  supportCount?: number;
  evidenceStrength?: "verified" | "measured" | "attributed" | "self_reported";
  counterCount?: number;
  questionCount?: number;
  /** Where "Read the evidence" lands; defaults to #decision-basis-<axis>;
      null hides the link. */
  evidenceHref?: `#${string}` | null;
  /** Overrides the ratio-band color/word: a group with one flag reads
      flagged even when most of its checks are clean. */
  tone?: "pass" | "caution" | "fail";
  /** Replaces the "<weight>% of the score" chip (e.g. "6 checks"). */
  sublabel?: string;
  /** Replaces the sources/questions counts line under the rationale. */
  countsLine?: string;
  /** The dimension was deliberately excluded before scoring, never scored zero. */
  applicability?: "not_applicable" | "deferred" | "unassessed";
}

