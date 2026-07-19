// ARGUS-P v2 subject-class router — faithful TS port of argus_p/router.py
//
// Classifies a subject from lightweight signals (bio, KB roster presence,
// self-description). Advisory: the analyst can always override. Surfaces every
// class with a positive signal so multi-role subjects are caught.

import { SubjectClass } from "./taxonomy";

const PATTERNS: Record<SubjectClass, RegExp[]> = {
  // Professional capital allocation only. Bare "investing"/"angel" bio talk is
  // retail/KOL noise, not a fund — those words deliberately do NOT score here.
  [SubjectClass.INVESTOR]: [
    /\bventure\b/i, /\bcapital\b/i, /\bVC\b/i, /\bfund\b/i, /\bGP\b/i,
    /\bgeneral partner\b/i, /\blimited partner\b/i, /\bportfolio\b/i,
    /\bangel investor\b/i, /\blaunchpad\b/i, /\baccelerator\b/i,
  ],
  [SubjectClass.FOUNDER]: [
    /\bfounder\b/i, /\bco-?founder\b/i, /\bCEO\b/i, /\bCTO\b/i, /\bbuilding\b/i,
    /\bbuilder\b/i, /\bwe'?re building\b/i, /\bcreator of\b/i, /\bfounded\b/i,
  ],
  // A project/protocol's OWN brand account: an organization, not a person. Uses
  // "we/our", describes one product/token it ships. Distinct from a KOL (who
  // promotes OTHERS' tokens) and a founder (an individual).
  [SubjectClass.PROJECT]: [
    /\bprotocol\b/i, /\bnetwork\b/i, /\bdApp\b/i, /\becosystem\b/i, /\bDAO\b/i,
    /\b(?:prediction|betting|forecasting) market\b/i, /\b(?:decentralized )?exchange\b/i,
    /\bmarketplace\b/i,
    // "Product" is a useful brand-account signal, but not when it is plainly a
    // person's job title. Server routing additionally requires the resolved X
    // profile to link a credible official site before PROJECT can govern.
    /\bproduct\b(?!\s+(?:manager|management|lead|leader|designer|design|engineer|engineering|marketing|marketer|growth|strategy|strategist|ops|operations|at)\b)/i,
    /\bplatform\b/i, /\bthe official\b/i, /\bofficial account\b/i, /\bwe'?re building\b/i,
    /\bour (?:token|protocol|platform|app|mission|community)\b/i, /\b\$[A-Z]{2,6} token\b/i,
    /\bpowered by\b/i, /\bmainnet\b/i, /\btestnet\b/i,
    // Verb-phrase product bios: the account states what its product DOES
    // ("Launch coins on Robinhood", "Trade perps on-chain") without naming a
    // protocol/platform noun. These are brand accounts, not people.
    /\blaunch (?:coins?|tokens?|memecoins?)\b/i,
    /\b(?:create|deploy|mint) (?:a )?(?:coins?|tokens?|memecoins?)\b/i,
    /\btrade (?:perps?|futures|spot|coins?|tokens?|crypto)\b/i,
  ],
  [SubjectClass.ADVISOR]: [
    /\badvisor\b/i, /\badviser\b/i, /\badvisory\b/i, /\bboard member\b/i,
    /\bstrategic advisor\b/i, /\bmentor\b/i,
  ],
  [SubjectClass.AGENCY]: [
    /\bagency\b/i, /\bgrowth\b/i, /\bmarketing\b/i, /\bwe help projects\b/i,
    /\bKOL management\b/i, /\bmarket making\b/i, /\bmarket maker\b/i,
    /\bPR\b/i, /\bservices\b/i, /\bclients\b/i,
  ],
  [SubjectClass.KOL]: [
    /\balpha\b/i, /\bcalls?\b/i, /\btrader\b/i, /\binfluencer\b/i, /\bgems?\b/i,
    /\bdegen\b/i, /\bsignals?\b/i, /\bshill\b/i, /\bcaller\b/i,
  ],
  [SubjectClass.MEMBER]: [
    /\bambassador\b/i, /\bmod\b/i, /\bmoderator\b/i, /\bcommunity\b/i,
    /\bcontributor\b/i,
  ],
};

export interface KBResult {
  kb_hit?: boolean;
  roster_hit?: boolean;
  roster_prices?: string[];
}

export interface RouteResult {
  subject_class: SubjectClass | null;
  applicable_classes: SubjectClass[];
  confidence: string;
  rationale: string;
  scores: Record<SubjectClass, number>;
}

export function classifySubject(
  bio = "",
  kb: KBResult | null = null,
  selfLabel: string | string[] | null = null,
): RouteResult {
  const text = (bio || "").toLowerCase();
  const scores = Object.fromEntries(
    Object.values(SubjectClass).map((c) => [c, 0]),
  ) as Record<SubjectClass, number>;

  for (const cls of Object.keys(PATTERNS) as SubjectClass[]) {
    for (const p of PATTERNS[cls]) {
      if (p.test(text)) scores[cls] += 1;
    }
  }

  const rationale: string[] = [];
  if (kb?.kb_hit) {
    scores[SubjectClass.KOL] += 2;
    rationale.push("present in KOL roster KB (strong KOL prior)");
  }
  if (kb?.roster_hit) {
    scores[SubjectClass.KOL] += 1;
    rationale.push("appears on a paid roster with pricing");
  }

  if (selfLabel != null) {
    const labels = Array.isArray(selfLabel) ? selfLabel : [selfLabel];
    const roles: SubjectClass[] = [];
    for (const lbl of labels) {
      if ((Object.values(SubjectClass) as string[]).includes(lbl)) {
        roles.push(lbl as SubjectClass);
      }
    }
    if (roles.length) {
      return {
        subject_class: roles[0],
        applicable_classes: roles,
        confidence: "operator-set",
        rationale: "roles set explicitly by operator",
        scores,
      };
    }
  }

  const applicable = (Object.keys(scores) as SubjectClass[])
    .filter((c) => scores[c] > 0)
    .sort((a, b) => scores[b] - scores[a]);

  if (!applicable.length) {
    return {
      subject_class: null,
      applicable_classes: [],
      confidence: "none",
      rationale: "no classifying signal; operator must set the role set",
      scores,
    };
  }

  const primary = applicable[0];
  const ordered = Object.values(scores).sort((a, b) => b - a);
  const margin = ordered[0] - (ordered.length > 1 ? ordered[1] : 0);
  const confidence = margin >= 2 ? "high" : "low";
  if (applicable.length > 1) {
    rationale.push("multiple roles detected: " + applicable.join(", "));
  }
  rationale.push(`primary ${primary} (score ${scores[primary]}, margin ${margin})`);
  return {
    subject_class: primary,
    applicable_classes: applicable,
    confidence,
    rationale: rationale.join("; "),
    scores,
  };
}
