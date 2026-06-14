// ARGUS-P v2 evaluation profiles — faithful TS port of argus_p/profiles.py
//
// One profile per subject class: axes (weights sum to 100), caps (score
// ceilings on disqualifying findings), red-flag patterns, evidence sources.

import { SubjectClass } from "./taxonomy";

export interface Profile {
  label: string;
  lens: string;
  axes: Record<string, number>;
  caps: Record<string, number>;
  flags: string[];
  sources: string[];
}

// Caps that apply to every class.
export const SHARED_CAPS: Record<string, number> = {
  deception_confirmed: 10,
  investigator_verified_fraud: 10,
};

export const PROFILES: Record<SubjectClass, Profile> = {
  [SubjectClass.FOUNDER]: {
    label: "Founder / Core Team",
    lens:
      "Evaluated as a collaborator or co-conspirator. The question is what this " +
      "person has built before and how each venture ended.",
    axes: {
      F1_identity_verifiability: 12,
      F2_track_record: 28,
      F3_repeat_backing: 15,
      F4_build_substance: 15,
      F5_reputation_integrity: 18,
      F6_network_quality: 12,
    },
    caps: { prior_rug_as_principal: 10 },
    flags: [
      "serial failure pattern: repeated silent shutdowns with no exits",
      "any prior rug or exit scam as a named principal",
      "claimed exits unverifiable against acquirer or press",
      "no prior backer or acquirer re-backed the new venture despite a claimed exit",
      "GitHub or product substance absent despite a builder persona",
    ],
    sources: [
      "LinkedIn",
      "Crunchbase",
      "Pitchbook",
      "company press / M&A coverage",
      "GitHub",
      "prior cap-table / round announcements",
      "X history",
    ],
  },

  [SubjectClass.KOL]: {
    label: "KOL / Promoter",
    lens:
      "Evaluated against the roster KB and on-chain behaviour. The question is " +
      "whether their calls create value for followers or extract it.",
    axes: {
      K1_identity_roster: 12,
      K2_call_performance: 30,
      K3_disclosure_deletion: 18,
      K4_onchain_conduct: 20,
      K5_cabal_fud: 20,
    },
    caps: { wallet_sold_into_promo: 35, paid_to_shill_confirmed_rug: 25 },
    flags: [
      "calls cluster at local price tops (exit-liquidity behaviour)",
      "a paid KOL cabal amplifying a token that then collapsed to zero, where the team had clear motive and means to use that social capital to exit (the rug-fuel pattern). A routine launch campaign on a project that did not rug is NOT itself a flag",
      "deleted promotional posts after a token failed",
      "undisclosed paid promotion",
      "selling into one's own calls (wallet evidence)",
    ],
    sources: [
      "ARGUS roster KB",
      "associated/smart wallets",
      "DexScreener/CoinGecko per token",
      "cabal graph",
      "ZachXBT and investigator corpus",
      "X history + archive",
    ],
  },

  [SubjectClass.INVESTOR]: {
    label: "Investor / Fund",
    lens:
      "Evaluated against fund databases and the reality of claimed relationships. " +
      "The question is whether the track record and endorsements are real.",
    axes: {
      I1_identity_legitimacy: 15,
      I2_portfolio_quality: 25,
      I3_fund_scale_tier: 15,
      I4_testimonial_corroboration: 20,
      I5_reputation_fud: 25,
    },
    caps: { contradicted_testimonial: 15, predatory_terms_verified: 35 },
    flags: [
      "identity fraud or impersonation (NOT mere pseudonymity, which is normal)",
      "claimed portfolio bought on the open market and presented as venture entries",
      "website testimonials that the named endorsers never publicly acknowledge",
      "claimed exits that cannot be corroborated",
      "press footprint that is entirely paid distribution with no organic coverage",
    ],
    sources: [
      "Pitchbook",
      "Crunchbase",
      "AngelList",
      "the fund's own site/testimonials",
      "X accounts of every named endorser and portfolio project",
      "LP/founder commentary",
      "investigator corpus",
    ],
  },

  [SubjectClass.AGENCY]: {
    label: "Agency / Contractor",
    lens:
      "Evaluated as a service contractor, not a principal. The question is whether " +
      "their services are legitimate growth or manufactured manipulation.",
    axes: {
      AG1_identity_legitimacy: 15,
      AG2_client_outcomes: 25,
      AG3_service_integrity: 25,
      AG4_reputation_fud: 35,
    },
    caps: { market_manipulation_services: 10 },
    flags: [
      "documented community FUD on the agency",
      "services that amount to wash trading, bot engagement, or coordinated raids",
      "client roster dominated by rugs or failed launches",
      "anonymous operators behind a paid service",
      "fake engagement or follower inflation as a product",
    ],
    sources: [
      "agency site and case studies",
      "client project outcomes",
      "community FUD threads",
      "investigator corpus",
      "engagement-authenticity checks",
    ],
  },

  [SubjectClass.ADVISOR]: {
    label: "Advisor / Board",
    lens:
      "Evaluated on the projects they have lent their name to and whether those " +
      "relationships are real. The question is whether the advisory record is " +
      "credibility or liability.",
    axes: {
      AD1_identity_verifiability: 12,
      AD2_advised_outcomes: 28,
      AD3_relationship_corroboration: 25,
      AD4_advisory_conduct: 20,
      AD5_reputation_fud: 15,
    },
    caps: { claimed_advisory_contradicted: 15, advised_rug_with_allocation: 25 },
    flags: [
      "advised projects that later rugged, especially with a token allocation",
      "advisory claims the named projects have never publicly acknowledged",
      "dumping advisory token allocations into retail",
      "a long advisory list with no verifiable contribution to any of it",
    ],
    sources: [
      "the subject's own advisory claims",
      "each advised project's site and X",
      "advised-project outcomes",
      "token-allocation and vesting disclosures",
      "investigator corpus",
    ],
  },

  [SubjectClass.MEMBER]: {
    label: "Community Member / Ambassador / Moderator",
    lens:
      "Low-stakes profile. The question is whether the contribution is authentic " +
      "participation or astroturf.",
    axes: {
      ME1_identity: 25,
      ME2_role_authenticity: 35,
      ME3_conduct_reputation: 40,
    },
    caps: {},
    flags: [
      "sockpuppet or astroturf participation",
      "coordinated shilling disguised as organic community voice",
    ],
    sources: ["platform activity", "ARGUS roster KB", "community context"],
  },
};

export function getProfile(subjectClass: SubjectClass): Profile {
  return PROFILES[subjectClass];
}

// Reverse map: every axis name resolves to exactly one class.
export const AXIS_TO_CLASS: Record<string, SubjectClass> = {};
for (const cls of Object.keys(PROFILES) as SubjectClass[]) {
  for (const ax of Object.keys(PROFILES[cls].axes)) {
    AXIS_TO_CLASS[ax] = cls;
  }
}

export function classForAxis(axis: string): SubjectClass {
  return AXIS_TO_CLASS[axis];
}

export function effectiveCaps(subjectClass: SubjectClass): Record<string, number> {
  return { ...SHARED_CAPS, ...getProfile(subjectClass).caps };
}

export function validateAxes(): Record<string, number> {
  const bad: Record<string, number> = {};
  for (const cls of Object.keys(PROFILES) as SubjectClass[]) {
    const total = Object.values(PROFILES[cls].axes).reduce((a, b) => a + b, 0);
    if (total !== 100) bad[cls] = total;
  }
  return bad;
}
