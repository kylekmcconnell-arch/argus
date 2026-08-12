"""
ARGUS-P v2 testimonial corroboration.

Investors (and some founders) publish endorsements: "backed by X", quotes
from well-known founders, advisory claims. A claim is only worth points if
the named endorser actually acknowledges the relationship. This engine takes,
per claimed endorsement, the observations an analyst or the X-API adapter
collects, and returns a per-testimonial verdict plus an aggregate axis
suggestion and any cap trigger.

Observation collection is API/search-driven (no scraping), consistent with
the ARGUS data-acquisition rule. This module does not fetch; it classifies.
"""

from .taxonomy import TestimonialVerdict


def classify_testimonial(obs: dict) -> TestimonialVerdict:
    """Classify a single claimed endorsement from collected observations.

    obs keys (all optional; None = not observed):
      public_acknowledgment : 'none' | 'mention' | 'thanks' | 'endorsement'
      relationship_corroborated : bool   (interaction matches the CLAIMED role)
      follows_subject : bool
      sentiment : 'positive' | 'neutral' | 'negative' | 'none'
      fud_present : bool                 (endorser has posted FUD about subject)
    """
    ack = (obs.get("public_acknowledgment") or "none").lower()
    rel = obs.get("relationship_corroborated")
    follows = obs.get("follows_subject")
    sentiment = (obs.get("sentiment") or "none").lower()
    fud = bool(obs.get("fud_present"))

    # A denial, distancing, or active FUD overrides everything.
    if fud or sentiment == "negative":
        return TestimonialVerdict.CONTRADICTED

    # A public endorsement or thanks that confirms the claimed relationship.
    if ack in ("endorsement", "thanks") and rel:
        return TestimonialVerdict.CORROBORATED

    # Some public interaction, or a follow, but the relationship is unconfirmed.
    if ack in ("mention", "thanks", "endorsement") or follows:
        return TestimonialVerdict.PARTIAL

    # No public trace at all: the endorser has never acknowledged the subject.
    return TestimonialVerdict.UNCONFIRMED


# Per-verdict contribution to the corroboration axis, as a fraction of weight.
_VERDICT_WEIGHT = {
    TestimonialVerdict.CORROBORATED: 1.0,
    TestimonialVerdict.PARTIAL:      0.5,
    TestimonialVerdict.UNCONFIRMED:  0.1,   # near zero: an unacknowledged claim is almost worthless
    TestimonialVerdict.CONTRADICTED: 0.0,
}


def score_axis(testimonials, axis_weight):
    """Aggregate a list of classified testimonials into an axis score.

    `testimonials` is a list of dicts each containing at least
    'corroboration_verdict' (a TestimonialVerdict or its value).

    Returns: (score, summary_dict, cap_trigger_or_None)

    Scoring logic:
      - With no testimonial claims at all, return a neutral half-weight
        (absence of claims is not evidence of fraud).
      - Otherwise score is the mean per-verdict weight times the axis weight,
        with a floor pulled down hard when the majority are Unconfirmed.
      - Any Contradicted testimonial flags the contradicted_testimonial cap:
        a named endorser denying the relationship while the subject uses it
        to solicit capital is a misrepresentation finding.
    """
    if not testimonials:
        return axis_weight * 0.5, {"claims": 0}, None

    verdicts = []
    for t in testimonials:
        v = t.get("corroboration_verdict")
        if not isinstance(v, TestimonialVerdict):
            v = TestimonialVerdict(v)
        verdicts.append(v)

    counts = {v: verdicts.count(v) for v in TestimonialVerdict}
    mean_w = sum(_VERDICT_WEIGHT[v] for v in verdicts) / len(verdicts)
    score = axis_weight * mean_w

    # If most claims are wholly unacknowledged, this is the EnigmaFund risk:
    # a wall of testimonials nobody has ever confirmed. Cap the axis low.
    if counts[TestimonialVerdict.UNCONFIRMED] >= max(1, len(verdicts) / 2):
        score = min(score, axis_weight * 0.25)

    cap = "contradicted_testimonial" if counts[TestimonialVerdict.CONTRADICTED] > 0 else None

    summary = {
        "claims": len(verdicts),
        "corroborated": counts[TestimonialVerdict.CORROBORATED],
        "partial": counts[TestimonialVerdict.PARTIAL],
        "unconfirmed": counts[TestimonialVerdict.UNCONFIRMED],
        "contradicted": counts[TestimonialVerdict.CONTRADICTED],
    }
    return round(score, 2), summary, cap
