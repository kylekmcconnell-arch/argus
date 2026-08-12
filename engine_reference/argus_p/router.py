"""
ARGUS-P v2 subject-class router.

Classifies a subject into one of the five classes from lightweight signals
(bio text, KB roster presence, self-description). The router is advisory:
the analyst can always override. Auto-classification is deliberately
conservative and returns its confidence and rationale so the operator can
confirm before the class-specific track runs.
"""

import re
from .taxonomy import SubjectClass

_PATTERNS = {
    SubjectClass.INVESTOR: [
        r'\bventure\b', r'\bcapital\b', r'\bVC\b', r'\bfund\b', r'\bGP\b',
        r'\bgeneral partner\b', r'\blimited partner\b', r'\bportfolio\b',
        r'\bangel\b', r'\binvest(or|ing|ments?)\b', r'\blaunchpad\b', r'\baccelerator\b',
    ],
    SubjectClass.FOUNDER: [
        r'\bfounder\b', r'\bco-?founder\b', r'\bCEO\b', r'\bCTO\b', r'\bbuilding\b',
        r'\bbuilder\b', r'\bwe\'?re building\b', r'\bcreator of\b', r'\bfounded\b',
    ],
    SubjectClass.ADVISOR: [
        r'\badvisor\b', r'\badviser\b', r'\badvisory\b', r'\bboard member\b',
        r'\bstrategic advisor\b', r'\bmentor\b',
    ],
    SubjectClass.AGENCY: [
        r'\bagency\b', r'\bgrowth\b', r'\bmarketing\b', r'\bwe help projects\b',
        r'\bKOL management\b', r'\bmarket making\b', r'\bmarket maker\b',
        r'\bPR\b', r'\bservices\b', r'\bclients\b',
    ],
    SubjectClass.KOL: [
        r'\balpha\b', r'\bcalls?\b', r'\btrader\b', r'\binfluencer\b', r'\bgems?\b',
        r'\bdegen\b', r'\bsignals?\b', r'\bshill\b', r'\bcaller\b',
    ],
    SubjectClass.MEMBER: [
        r'\bambassador\b', r'\bmod\b', r'\bmoderator\b', r'\bcommunity\b',
        r'\bcontributor\b',
    ],
}


def classify_subject(bio: str = "", kb: dict = None, self_label=None) -> dict:
    """Return {'subject_class', 'applicable_classes', 'confidence', 'rationale', 'scores'}.

    Classes are not mutually exclusive. The router surfaces EVERY class with a
    positive signal in `applicable_classes` (ranked), and the strongest as the
    `subject_class` primary, for backward compatibility. A KB roster hit is a
    strong KOL prior. The operator confirms or edits the role set, and can pass
    `self_label` as a single class string or a list of class strings to set the
    roles explicitly.
    """
    text = (bio or "").lower()
    scores = {cls: 0 for cls in SubjectClass}

    for cls, pats in _PATTERNS.items():
        for p in pats:
            if re.search(p, text, re.I):
                scores[cls] += 1

    rationale = []
    if kb and kb.get("kb_hit"):
        scores[SubjectClass.KOL] += 2
        rationale.append("present in KOL roster KB (strong KOL prior)")
    if kb and kb.get("roster_hit"):
        scores[SubjectClass.KOL] += 1
        rationale.append("appears on a paid roster with pricing")

    if self_label is not None:
        labels = self_label if isinstance(self_label, (list, tuple, set)) else [self_label]
        roles = []
        for lbl in labels:
            try:
                roles.append(SubjectClass(lbl))
            except ValueError:
                pass
        if roles:
            return {"subject_class": roles[0], "applicable_classes": roles,
                    "confidence": "operator-set",
                    "rationale": "roles set explicitly by operator", "scores": scores}

    applicable = sorted([c for c, s in scores.items() if s > 0],
                        key=lambda c: scores[c], reverse=True)
    if not applicable:
        return {"subject_class": None, "applicable_classes": [], "confidence": "none",
                "rationale": "no classifying signal; operator must set the role set",
                "scores": scores}

    primary = applicable[0]
    ordered = sorted(scores.values(), reverse=True)
    margin = ordered[0] - (ordered[1] if len(ordered) > 1 else 0)
    confidence = "high" if margin >= 2 else "low"
    if len(applicable) > 1:
        rationale.append("multiple roles detected: " + ", ".join(c.value for c in applicable))
    rationale.append(f"primary {primary.value} (score {scores[primary]}, margin {margin})")
    return {"subject_class": primary, "applicable_classes": applicable,
            "confidence": confidence, "rationale": "; ".join(rationale), "scores": scores}
