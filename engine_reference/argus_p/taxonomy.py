"""
ARGUS-P v2 taxonomy
===================

Defines the subject classes and the controlled vocabularies each class
depends on. The central correction in v2 is that a "person" is not one
thing: a founder, a KOL, an investor, an agency, and a community member
are evaluated against different evidence and different failure modes.

Nothing in this file changes the frozen entity-resolution contract
(see entity.py). It only adds classification on top of it.
"""

from enum import Enum


class SubjectClass(str, Enum):
    FOUNDER  = "FOUNDER"    # founders and core team / technical contributors
    KOL      = "KOL"        # influencers, callers, paid promoters
    INVESTOR = "INVESTOR"   # angels, super angels, launchpads, micro VCs, VCs
    AGENCY   = "AGENCY"     # marketing / growth / market-making contractors
    MEMBER   = "MEMBER"     # community, ambassadors, moderators
    ADVISOR  = "ADVISOR"    # named advisors / board / strategic to projects

# Classes are NOT mutually exclusive. A single subject can hold several roles
# at once (the common case: a builder who also invests and advises). Each held
# role is scored on its own track and the composite verdict is governed by the
# most severe role. Roles are never averaged together.


# Pseudonymity is NOT a flag. Many legitimate builders and investors in crypto
# operate under a persistent pseudonym with a verifiable on-chain or shipped
# track record (e.g. 0xdeveloper of $BNKR). Risk lives in behaviour and
# outcomes (rugs, dumping into own promotion, paid-cabal-then-collapse,
# fabrication, impersonation), not in identity state.
#
# Accordingly there is NO hard identity gate on pseudonymity. The only identity
# condition that blocks publication is genuine impersonation or identity fraud
# (SuspectedImpersonation), handled in the orchestrator. Instead of penalising
# pseudonymity, the model REWARDS disclosure: a verified real-world identity
# earns a doxxing bonus (DOX_BONUS) on top of the identity axis.
HARD_IDENTITY_GATE_CLASSES = set()   # intentionally empty; see note above

# Reward for verifiable real-world identity, added to each role's score.
DOX_BONUS = {"Confirmed": 5, "Probable": 3}


# --------------------------------------------------------------------------
# Founder / team controlled vocabularies
# --------------------------------------------------------------------------

class VentureOutcome(str, Enum):
    ACTIVE            = "Active"             # ongoing, no exit yet
    PAUSED            = "Paused"             # publicly paused / deprioritised, not abandoned (neutral)
    IPO               = "IPO"               # public listing (strong positive)
    ACQUISITION       = "Acquisition"        # genuine strategic/financial buy (positive)
    ACQUIHIRE         = "Acquihire"          # team absorbed, product sunset (ambiguous)
    ORDERLY_WINDDOWN  = "OrderlyWindDown"    # closed cleanly, capital returned (neutral)
    FAILURE           = "Failure"            # failed transparently (neutral / mild neg)
    SILENT_SHUTDOWN   = "SilentShutdown"     # disappeared quietly, no comms (negative)
    RUG               = "Rug"               # exit scam (severe negative, cap trigger)
    EXPLOIT           = "Exploit"            # hacked (context dependent)
    UNKNOWN           = "Unknown"

# Non-terminal outcomes are excluded from the founder-pattern completed set.
# A public pause is NOT a silent shutdown: SilentShutdown requires evidence of
# abandonment (no comms, no distribution, disappearance), not merely the
# absence of a launch the analyst happened to find.
NON_TERMINAL = {VentureOutcome.ACTIVE, VentureOutcome.PAUSED, VentureOutcome.UNKNOWN}

POSITIVE_OUTCOMES = {VentureOutcome.IPO, VentureOutcome.ACQUISITION}
SEVERE_OUTCOMES   = {VentureOutcome.RUG}
NEGATIVE_OUTCOMES = {VentureOutcome.SILENT_SHUTDOWN, VentureOutcome.RUG}


class FounderPattern(str, Enum):
    SERIAL_SUCCESS = "SerialSuccess"   # 2+ real exits, no rug
    PROVEN_ONCE    = "ProvenOnce"      # 1 real exit, no rug
    MIXED          = "Mixed"           # successes and failures
    SERIAL_FAILURE = "SerialFailure"   # 2+ silent shutdowns / failures, no success
    RUG_HISTORY    = "RugHistory"      # any confirmed rug as a principal (overrides)
    UNPROVEN       = "Unproven"        # no completed ventures
    FIRST_VENTURE  = "FirstVenture"


def classify_founder_pattern(outcomes):
    """Given an iterable of VentureOutcome, derive a founder-pattern label.

    A confirmed rug as a principal overrides everything else: it is the
    single most predictive negative signal for a repeat founder.
    """
    outs = [o if isinstance(o, VentureOutcome) else VentureOutcome(o) for o in outcomes]
    completed = [o for o in outs if o not in NON_TERMINAL]

    if any(o in SEVERE_OUTCOMES for o in outs):
        return FounderPattern.RUG_HISTORY
    if not outs:
        return FounderPattern.FIRST_VENTURE
    if not completed:
        return FounderPattern.UNPROVEN

    successes = sum(1 for o in completed if o in POSITIVE_OUTCOMES)
    failures  = sum(1 for o in completed if o in (VentureOutcome.SILENT_SHUTDOWN,
                                                  VentureOutcome.FAILURE))
    if successes >= 2 and failures == 0:
        return FounderPattern.SERIAL_SUCCESS
    if successes == 1 and failures == 0:
        return FounderPattern.PROVEN_ONCE
    if successes == 0 and failures >= 2:
        return FounderPattern.SERIAL_FAILURE
    if successes >= 1 and failures >= 1:
        return FounderPattern.MIXED
    return FounderPattern.UNPROVEN


def repeat_backing_signal(ventures):
    """Detect whether sophisticated prior backers re-backed the founder.

    `ventures` is a list of dicts with keys:
      outcome, investors (list), acquirer (str|None), current_backers (list)
    The strongest positive venture signal is a prior acquirer or prior
    investor in a *successful* venture choosing to back the new one again.

    Returns a dict: {repeat_backers: [...], from_successful_exit: bool,
                     strength: 'none'|'weak'|'strong'}.
    """
    current = set()
    repeat = set()
    from_success = False
    # current backers are recorded on the active/most-recent venture
    for v in ventures:
        if (v.get("outcome") in (VentureOutcome.ACTIVE, VentureOutcome.ACTIVE.value)):
            current |= set(map(_norm, v.get("current_backers", []) or []))
    for v in ventures:
        outcome = v.get("outcome")
        prior_parties = set(map(_norm, v.get("investors", []) or []))
        if v.get("acquirer"):
            prior_parties.add(_norm(v["acquirer"]))
        overlap = prior_parties & current
        if overlap:
            repeat |= overlap
            if outcome in POSITIVE_OUTCOMES or outcome in (VentureOutcome.IPO.value,
                                                           VentureOutcome.ACQUISITION.value):
                from_success = True
    if not repeat:
        strength = "none"
    elif from_success:
        strength = "strong"
    else:
        strength = "weak"
    return {"repeat_backers": sorted(repeat),
            "from_successful_exit": from_success,
            "strength": strength}


def _norm(name):
    return str(name).strip().lower()


# --------------------------------------------------------------------------
# Investor controlled vocabularies
# --------------------------------------------------------------------------

class FundTier(str, Enum):
    ANGEL        = "Angel"          # individual, small checks
    SUPER_ANGEL  = "SuperAngel"     # prolific individual
    LAUNCHPAD    = "Launchpad"      # IDO / launch platform (distinct model)
    MICRO_VC     = "MicroVC"        # institutional, sub ~50M typical
    VC_TIER3     = "VC_Tier3"
    VC_TIER2     = "VC_Tier2"
    VC_TIER1     = "VC_Tier1"       # established, brand-name
    UNKNOWN      = "Unknown"

TIER_RANK = {
    FundTier.ANGEL: 1, FundTier.SUPER_ANGEL: 2, FundTier.LAUNCHPAD: 2,
    FundTier.MICRO_VC: 3, FundTier.VC_TIER3: 4, FundTier.VC_TIER2: 5,
    FundTier.VC_TIER1: 6, FundTier.UNKNOWN: 0,
}


class TestimonialVerdict(str, Enum):
    CORROBORATED        = "Corroborated"          # public ack + claimed relationship confirmed
    PARTIAL             = "PartiallyCorroborated"  # some interaction, relationship unconfirmed
    UNCONFIRMED         = "Unconfirmed"            # no public trace either way
    CONTRADICTED        = "Contradicted"           # denial, distancing, or FUD present


# --------------------------------------------------------------------------
# Shared evidence-status vocabulary (carried from v1, unchanged)
# --------------------------------------------------------------------------

IDENTITY_CONFIDENCE = ("Confirmed", "Probable", "Unverified", "SuspectedImpersonation")
VERIFICATION_STATUS = ("Verified", "Reported", "Rumor")
WALLET_LINK_TIERS   = ("SelfDoxxed", "InvestigatorAttributed", "Inferred")
PROMO_DISCLOSURE    = ("Disclosed", "Undisclosed", "Unknown")
