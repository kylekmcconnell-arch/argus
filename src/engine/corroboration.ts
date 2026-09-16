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
