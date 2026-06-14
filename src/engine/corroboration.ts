// ARGUS-P v2 testimonial corroboration — faithful TS port of argus_p/corroboration.py
//
// A claim is only worth points if the named endorser actually acknowledges the
// relationship. This module classifies collected observations; it does not fetch.

import { TestimonialVerdict } from "./taxonomy";

export interface Observation {
  public_acknowledgment?: string | null; // none | mention | thanks | endorsement
  relationship_corroborated?: boolean | null;
  follows_subject?: boolean | null;
  sentiment?: string | null; // positive | neutral | negative | none
  fud_present?: boolean | null;
}

export function classifyTestimonial(obs: Observation): TestimonialVerdict {
  const ack = (obs.public_acknowledgment ?? "none").toLowerCase();
  const rel = obs.relationship_corroborated;
  const follows = obs.follows_subject;
  const sentiment = (obs.sentiment ?? "none").toLowerCase();
  const fud = Boolean(obs.fud_present);

  // A denial, distancing, or active FUD overrides everything.
  if (fud || sentiment === "negative") return TestimonialVerdict.CONTRADICTED;

  // A public endorsement or thanks that confirms the claimed relationship.
  if ((ack === "endorsement" || ack === "thanks") && rel)
    return TestimonialVerdict.CORROBORATED;

  // Some public interaction, or a follow, but the relationship is unconfirmed.
  if (ack === "mention" || ack === "thanks" || ack === "endorsement" || follows)
    return TestimonialVerdict.PARTIAL;

  // No public trace at all.
  return TestimonialVerdict.UNCONFIRMED;
}

const VERDICT_WEIGHT: Record<TestimonialVerdict, number> = {
  [TestimonialVerdict.CORROBORATED]: 1.0,
  [TestimonialVerdict.PARTIAL]: 0.5,
  [TestimonialVerdict.UNCONFIRMED]: 0.1,
  [TestimonialVerdict.CONTRADICTED]: 0.0,
};

export interface AxisSummary {
  claims: number;
  corroborated?: number;
  partial?: number;
  unconfirmed?: number;
  contradicted?: number;
}

export interface ClassifiedTestimonial {
  corroboration_verdict: TestimonialVerdict | string;
}

export function scoreAxis(
  testimonials: ClassifiedTestimonial[],
  axisWeight: number,
): [number, AxisSummary, string | null] {
  if (!testimonials.length) {
    return [axisWeight * 0.5, { claims: 0 }, null];
  }

  const verdicts = testimonials.map((t) => t.corroboration_verdict as TestimonialVerdict);
  const counts: Record<TestimonialVerdict, number> = {
    [TestimonialVerdict.CORROBORATED]: 0,
    [TestimonialVerdict.PARTIAL]: 0,
    [TestimonialVerdict.UNCONFIRMED]: 0,
    [TestimonialVerdict.CONTRADICTED]: 0,
  };
  for (const v of verdicts) counts[v] += 1;

  const meanW = verdicts.reduce((a, v) => a + VERDICT_WEIGHT[v], 0) / verdicts.length;
  let score = axisWeight * meanW;

  // A wall of testimonials nobody has ever confirmed. Cap the axis low.
  if (counts[TestimonialVerdict.UNCONFIRMED] >= Math.max(1, verdicts.length / 2)) {
    score = Math.min(score, axisWeight * 0.25);
  }

  const cap =
    counts[TestimonialVerdict.CONTRADICTED] > 0 ? "contradicted_testimonial" : null;

  const summary: AxisSummary = {
    claims: verdicts.length,
    corroborated: counts[TestimonialVerdict.CORROBORATED],
    partial: counts[TestimonialVerdict.PARTIAL],
    unconfirmed: counts[TestimonialVerdict.UNCONFIRMED],
    contradicted: counts[TestimonialVerdict.CONTRADICTED],
  };
  return [Math.round(score * 100) / 100, summary, cap];
}
