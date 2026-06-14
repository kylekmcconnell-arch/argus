"""
ARGUS-P v2 evaluation profiles.

One profile per subject class. Each profile defines:
  - axes:    {axis_name: weight}, weights sum to 100
  - caps:    {cap_name: ceiling}, total-score ceilings on disqualifying findings
  - flags:   documented red-flag patterns the class is built to catch
  - sources: the evidence sources the analyst is expected to consult

Caps below are merged with SHARED_CAPS at evaluation time.
"""

from .taxonomy import SubjectClass

# Caps that apply to every class.
SHARED_CAPS = {
    "deception_confirmed": 10,        # Verified DeceptionFinding (fabrication, not honest error)
    "investigator_verified_fraud": 10,  # Verified investigator finding, 2+ independent sources
}

PROFILES = {

    # ---------------------------------------------------------------- FOUNDER
    SubjectClass.FOUNDER: {
        "label": "Founder / Core Team",
        "lens": "Evaluated as a collaborator or co-conspirator. The question is "
                "what this person has built before and how each venture ended.",
        "axes": {
            "F1_identity_verifiability": 12,   # real name, LinkedIn, doxxed, consistent history
            "F2_track_record": 28,             # prior ventures and their outcomes (the core)
            "F3_repeat_backing": 15,           # did prior acquirers/investors back them again
            "F4_build_substance": 15,          # GitHub, shipped product, technical depth
            "F5_reputation_integrity": 18,     # FUD, investigator findings, litigation
            "F6_network_quality": 12,          # co-founders, cabal proximity, who they run with
        },
        "caps": {
            "prior_rug_as_principal": 10,      # confirmed rug/exit-scam as a principal
        },
        "flags": [
            "serial failure pattern: repeated silent shutdowns with no exits",
            "any prior rug or exit scam as a named principal",
            "claimed exits unverifiable against acquirer or press",
            "no prior backer or acquirer re-backed the new venture despite a claimed exit",
            "GitHub or product substance absent despite a builder persona",
        ],
        "sources": ["LinkedIn", "Crunchbase", "Pitchbook", "company press / M&A coverage",
                    "GitHub", "prior cap-table / round announcements", "X history"],
    },

    # -------------------------------------------------------------------- KOL
    SubjectClass.KOL: {
        "label": "KOL / Promoter",
        "lens": "Evaluated against the roster KB and on-chain behaviour. The question "
                "is whether their calls create value for followers or extract it.",
        "axes": {
            "K1_identity_roster": 12,          # KB hit, pricing, account stability
            "K2_call_performance": 30,         # winners vs paid rugs, relative to baseline (core)
            "K3_disclosure_deletion": 18,      # disclosed paid promos, deleted dumps
            "K4_onchain_conduct": 20,          # smart/associated wallets, selling into own calls
            "K5_cabal_fud": 20,                # cabal proximity, investigator findings, FUD
        },
        "caps": {
            "wallet_sold_into_promo": 35,      # attributed wallet sold into the subject's own call
            "paid_to_shill_confirmed_rug": 25, # paid promotion of a token later confirmed a rug
        },
        "flags": [
            "calls cluster at local price tops (Ansem-pattern exit-liquidity behaviour)",
            "a paid KOL cabal amplifying a token that then collapsed to zero, where the team had clear motive and means to use that social capital to exit (the rug-fuel pattern). A routine KOL launch campaign on a project that did not rug is NOT itself a flag",
            "deleted promotional posts after a token failed",
            "undisclosed paid promotion",
            "selling into one's own calls (wallet evidence)",
        ],
        "sources": ["ARGUS roster KB", "associated/smart wallets", "DexScreener/CoinGecko per token",
                    "cabal graph", "ZachXBT and investigator corpus", "X history + archive"],
    },

    # --------------------------------------------------------------- INVESTOR
    SubjectClass.INVESTOR: {
        "label": "Investor / Fund",
        "lens": "Evaluated against fund databases and the reality of claimed relationships. "
                "The question is whether the track record and endorsements are real.",
        "axes": {
            "I1_identity_legitimacy": 15,      # real fund, registry, named GP (pseudonymity gates)
            "I2_portfolio_quality": 25,        # Pitchbook/Crunchbase/AngelList; known vs unknown; exits
            "I3_fund_scale_tier": 15,          # funds raised, size each, angel->Tier1 ladder
            "I4_testimonial_corroboration": 20,  # do claimed endorsers actually vouch / interact
            "I5_reputation_fud": 25,           # LP/founder complaints, predatory terms, token dumping
        },
        "caps": {
            "contradicted_testimonial": 15,    # a claimed endorser publicly denies/distances
            "predatory_terms_verified": 35,    # verified predatory/fraudulent fund terms
        },
        "flags": [
            "identity fraud or impersonation (NOT mere pseudonymity, which is normal)",
            "claimed portfolio bought on the open market and presented as venture entries (genuine pre-ICO / seed / GP-commit positions are legitimate, even when the asset later became large)",
            "website testimonials that the named endorsers never publicly acknowledge",
            "claimed exits that cannot be corroborated",
            "press footprint that is entirely paid distribution with no organic coverage",
        ],
        "sources": ["Pitchbook", "Crunchbase", "AngelList", "the fund's own site/testimonials",
                    "X accounts of every named endorser and portfolio project",
                    "LP/founder commentary", "investigator corpus"],
    },

    # ----------------------------------------------------------------- AGENCY
    SubjectClass.AGENCY: {
        "label": "Agency / Contractor",
        "lens": "Evaluated as a service contractor, not a principal. The question is "
                "whether their services are legitimate growth or manufactured manipulation.",
        "axes": {
            "AG1_identity_legitimacy": 15,     # registered entity, named team, real footprint
            "AG2_client_outcomes": 25,         # who they served and how those projects ended
            "AG3_service_integrity": 25,       # transparent growth vs bots/wash/raids
            "AG4_reputation_fud": 35,          # community FUD on the agency itself (the core)
        },
        "caps": {
            "market_manipulation_services": 10,  # wash trading / bot networks sold as a service
        },
        "flags": [
            "documented community FUD on the agency (the pattern seen around some growth shops)",
            "services that amount to wash trading, bot engagement, or coordinated raids",
            "client roster dominated by rugs or failed launches",
            "anonymous operators behind a paid service",
            "fake engagement or follower inflation as a product",
        ],
        "sources": ["agency site and case studies", "client project outcomes",
                    "community FUD threads", "investigator corpus", "engagement-authenticity checks"],
    },

    # ---------------------------------------------------------------- ADVISOR
    SubjectClass.ADVISOR: {
        "label": "Advisor / Board",
        "lens": "Evaluated on the projects they have lent their name to and whether "
                "those relationships are real. The question is whether the advisory "
                "record is credibility or liability.",
        "axes": {
            "AD1_identity_verifiability": 12,
            "AD2_advised_outcomes": 28,            # advisor graveyard: did advised projects rug
            "AD3_relationship_corroboration": 25,  # do the projects actually acknowledge it
            "AD4_advisory_conduct": 20,            # token-dump / pump conduct, disclosure
            "AD5_reputation_fud": 15,
        },
        "caps": {
            "claimed_advisory_contradicted": 15,   # a named project denies the relationship
            "advised_rug_with_allocation": 25,     # paid/allocated advisor to a confirmed rug
        },
        "flags": [
            "advised projects that later rugged, especially with a token allocation",
            "advisory claims the named projects have never publicly acknowledged",
            "dumping advisory token allocations into retail (note: offering angels co-investment access to the same primary dealflow on the same terms is NOT a conflict)",
            "a long advisory list with no verifiable contribution to any of it",
        ],
        "sources": ["the subject's own advisory claims", "each advised project's site and X",
                    "advised-project outcomes", "token-allocation and vesting disclosures",
                    "investigator corpus"],
    },

    # ----------------------------------------------------------------- MEMBER
    SubjectClass.MEMBER: {
        "label": "Community Member / Ambassador / Moderator",
        "lens": "Low-stakes profile. The question is whether the contribution is "
                "authentic participation or astroturf.",
        "axes": {
            "ME1_identity": 25,
            "ME2_role_authenticity": 35,       # real contributor vs paid astroturf / sockpuppet
            "ME3_conduct_reputation": 40,
        },
        "caps": {},
        "flags": [
            "sockpuppet or astroturf participation",
            "coordinated shilling disguised as organic community voice",
        ],
        "sources": ["platform activity", "ARGUS roster KB", "community context"],
    },
}


def get_profile(subject_class):
    if isinstance(subject_class, str):
        subject_class = SubjectClass(subject_class)
    p = PROFILES[subject_class]
    return p


# Reverse map: every axis name resolves to exactly one class. Used by the
# orchestrator to group set axes by role when a subject holds several roles.
AXIS_TO_CLASS = {}
for _cls, _prof in PROFILES.items():
    for _ax in _prof["axes"]:
        AXIS_TO_CLASS[_ax] = _cls


def class_for_axis(axis):
    return AXIS_TO_CLASS[axis]


def effective_caps(subject_class):
    """Merge shared caps with the class-specific caps."""
    caps = dict(SHARED_CAPS)
    caps.update(get_profile(subject_class)["caps"])
    return caps


def validate_axes():
    """Sanity check: every profile's axis weights sum to 100."""
    bad = {}
    for cls, prof in PROFILES.items():
        total = sum(prof["axes"].values())
        if total != 100:
            bad[cls.value] = total
    return bad
