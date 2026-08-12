"""
ARGUS-P v2: multi-class principal diligence.

A subject (identified by X handle) holds one or more of six roles. Each held
role is scored on its own track, with its own axes, evidence sources, hard caps
and a class-aware identity gate; the composite verdict is governed by the most
severe role and roles are never averaged:

    FOUNDER   - prior ventures, outcomes, repeat backing, build substance
    KOL       - roster KB, call performance, wallets, cabal/FUD
    INVESTOR  - fund databases, portfolio reality, testimonial corroboration
    ADVISOR   - advised-project outcomes and relationship corroboration
    AGENCY    - client outcomes, service integrity, agency-level FUD
    MEMBER    - lightweight authenticity check

Public API:
    from argus_p import Audit, classify_subject, kb_crossref
    from argus_p.taxonomy import SubjectClass, VentureOutcome, FundTier
"""

from .audit import Audit
from .router import classify_subject
from .core import kb_crossref, normalize_x_handle, normalize_gh
from .taxonomy import SubjectClass, VentureOutcome, FundTier, TestimonialVerdict
from .profiles import PROFILES, get_profile, effective_caps, validate_axes

__version__ = "2.2.0"
__all__ = ["Audit", "classify_subject", "kb_crossref", "normalize_x_handle",
           "normalize_gh", "SubjectClass", "VentureOutcome", "FundTier",
           "TestimonialVerdict", "PROFILES", "get_profile", "effective_caps",
           "validate_axes"]
